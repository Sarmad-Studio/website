const RECONNECT_BASE_DELAY_MS = 800;
const RECONNECT_MAX_DELAY_MS = 10_000;

class Emitter {
  #listeners = new Map();

  on(event, handler) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    this.#listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    this.#listeners.get(event)?.forEach((fn) => fn(payload));
    this.#listeners.get('*')?.forEach((fn) => fn(event, payload));
  }
}

function nextSnowflake() {
  const time = BigInt(Date.now());
  const rand = BigInt(Math.floor(Math.random() * 0x3fffff));
  return ((time << 22n) | rand).toString();
}

export class CharlatanNetwork extends Emitter {
  constructor({ baseUrl, wsBaseUrl }) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.wsBaseUrl = (wsBaseUrl ?? this.baseUrl.replace(/^http/, 'ws')).replace(/\/$/, '');

    this.userUuid = crypto.randomUUID();
    this.roomId = null;

    this.ws = null;
    this.connectionState = 'disconnected';
    this._reconnectAttempt = 0;
    this._manualClose = false;
  }

  async #post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`POST ${path} failed (${res.status}): ${detail}`);
    }
    return res.json();
  }

  async createRoom(userName) {
    const data = await this.#post('/create', {
      user_uuid: this.userUuid,
      user_name: userName,
    });
    this.roomId = data.room_id;
    return data;
  }

  async joinRoom(userName, roomCode) {
    const data = await this.#post('/join', {
      user_uuid: this.userUuid,
      user_name: userName,
      room_code: roomCode,
    });
    this.roomId = data.room_id;
    return data;
  }

  async fetchWsTicket(roomId = this.roomId) {
    const data = await this.#post(`/room/${roomId}/ws-ticket`, {
      user_uuid: this.userUuid,
    });
    return data.ticket;
  }

  async connect(roomId = this.roomId) {
    this.roomId = roomId;
    const ticket = await this.fetchWsTicket(roomId);
    this.#openSocket(ticket);
  }

  #openSocket(ticket) {
    this._manualClose = false;
    this.#setConnectionState('connecting');

    const url = `${this.wsBaseUrl}/room/${this.roomId}/ws?ticket=${encodeURIComponent(ticket)}`;
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this._reconnectAttempt = 0;
      this.#setConnectionState('connected');
    });

    this.ws.addEventListener('message', (evt) => {
      this.#handleMessage(evt.data);
    });

    this.ws.addEventListener('close', () => {
      if (this._manualClose) {
        this.#setConnectionState('disconnected');
        return;
      }
      this.#setConnectionState('disconnected');
      this.#scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      this.#setConnectionState('error');
    });
  }

  #handleMessage(raw) {
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return;
    }
    const { event, payload } = envelope;
    if (!event) return;
    this.emit(event, payload);
  }

  send(event, payload = {}) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn(`[network] dropped "${event}" — socket not open`);
      return false;
    }
    this.ws.send(JSON.stringify({ event, payload, id: nextSnowflake() }));
    return true;
  }

  async #scheduleReconnect() {
    if (!this.roomId) return;
    this._reconnectAttempt += 1;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this._reconnectAttempt,
      RECONNECT_MAX_DELAY_MS,
    );
    this.#setConnectionState('connecting');
    await new Promise((r) => setTimeout(r, delay));
    if (this._manualClose) return;
    try {
      const ticket = await this.fetchWsTicket(this.roomId);
      this.#openSocket(ticket);
    } catch {
      this.#setConnectionState('error');
      this.#scheduleReconnect();
    }
  }

  disconnect() {
    this._manualClose = true;
    this.ws?.close();
  }

  #setConnectionState(state) {
    this.connectionState = state;
    this.emit('__connection_state', state);
  }

  async startVoiceSession(roomId = this.roomId) {
    return this.#post(`/room/${roomId}/sfu/session`, { user_uuid: this.userUuid });
  }
}
