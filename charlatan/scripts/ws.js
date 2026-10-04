/*
 * Envelope from server: { event, payload, id }
 */

import { emit } from './state.js';

const PING_INTERVAL_MS = 15000;    // keep-alive ping
const RECONNECT_WINDOW_MS = 30000; // 30s - matches server graceful-reconnect window
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 5000;
const EPOCH = 1712793600000n;      // Spirit Epoch 2024-4-11

let socket = null;
let roomId = null;
let manualClose = false;
let reconnectDeadline = 0;
let reconnectAttempts = 0;
let pingTimer = null;
let reconnectTimer = null;
let ID_last_Time = 0n;
let ID_seq = 0n;

/**
 * Generate snowflake id as string.
 */
function generateSnowflakeID() {
  let now = BigInt(Date.now());

  if (now === ID_last_Time) {
    ID_seq = (ID_seq + 1n) & 16383n; // 14 sequence bits max
    if (ID_seq === 0n) {
      // Busy wait for next millisecond if sequence exhausted
      while ((now = BigInt(Date.now())) === ID_last_Time) { }
    }
  } else {
    ID_seq = 0n;
  }

  ID_last_Time = now;

  return String(((now - EPOCH) << 22n) | (1 << 14n) | ID_seq);
}

export function encode(event, payload) {
  return JSON.stringify({ event, payload, id: generateSnowflakeID() });
}

export function decode(text) {
  try {
    const msg = JSON.parse(text);
    if (msg && typeof msg.event === 'string') {
      return { event: msg.event, payload: msg.payload, id: msg.id };
    }
  } catch (_) { /* ignore malformed frames */ }
  return null;
}

function wsUrl(id, tkt) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.hostname.startsWith('api.') ? location.host : `api.${location.host}`;
  return `${proto}//${host}/charlatan/room/${encodeURIComponent(id)}/ws?ticket=${encodeURIComponent(tkt)}`;
}

// kind: 'connecting' | 'connected' | 'lost' | 'offline'
function setStatus(kind) {
  emit('connection_status', kind);
}

function stopTimers() {
  if (pingTimer) clearInterval(pingTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  pingTimer = null;
  reconnectTimer = null;
}

function schedulePing() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      send('ping', {});
    }
  }, PING_INTERVAL_MS);
}

function scheduleReconnect() {
  const now = Date.now();
  if (!reconnectDeadline) reconnectDeadline = now;
  const elapsed = now - reconnectDeadline;
  if (elapsed >= RECONNECT_WINDOW_MS) {
    setStatus('lost');
    emit('connection_lost', {});
    return;
  }
  setStatus('connecting');
  const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, reconnectAttempts), BACKOFF_MAX_MS);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(open, delay);
}

async function fetchTicket() {
  const tktRes = await api(`/room/${roomId}/ws-ticket`, {
    method: 'POST',
    body: JSON.stringify({ user_uuid })
  });
  return tktRes.ticket;
}

async function open() {
  if (!roomId) return;
  manualClose = false;

  if (socket) {
    try { socket.close(); } catch (_) { }
    socket = null;
  }

  setStatus('connecting');

  let activeTicket
  try {
    activeTicket = await fetchTicket();
  } catch (err) {
    scheduleReconnect();
    return;
  }

  if (!activeTicket) return;

  socket = new WebSocket(wsUrl(roomId, activeTicket));

  socket.onopen = () => {
    reconnectDeadline = 0;
    reconnectAttempts = 0;
    setStatus('connected');
    schedulePing();
    emit('ws_open', {});
  };

  socket.onmessage = (ev) => {
    const msg = decode(ev.data);
    if (!msg) return;
    emit(`ws:${msg.event}`, msg.payload);
  };

  socket.onclose = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    emit('ws_close', {});
    if (!manualClose) scheduleReconnect();
  };

  socket.onerror = () => { /* onclose follows and handles retry */ };
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isConnected()) {
      send('ping', {});
      schedulePing(); // Reset the interval timer so it doesn't double-ping
    }
  });
}

/**
 * Accepts (newRoomId)
 */
export function connect(newRoomId) {
  if (!newRoomId) throw new Error("Faild to get room data")

  roomId = newRoomId;
  reconnectDeadline = 0;
  reconnectAttempts = 0;
  open();
}

export function send(event, payload) {
  const frame = encode(event, payload || {});
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(frame);
    return true;
  }
  emit('ws_send_failed', { event });
  return false;
}

export function close() {
  manualClose = true;
  stopTimers();
  if (socket) {
    try { socket.close(); } catch (_) { }
    socket = null;
  }
}

export function isConnected() {
  return socket && socket.readyState === WebSocket.OPEN;
}
