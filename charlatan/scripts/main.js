import { loadLocale, t, hydrate, localeSwitchHref } from './i18n.js';
import * as state from './state.js';
import * as ws from './ws.js';
import * as router from './router.js';

const API = () => `${location.protocol}//api.${location.host}`;

async function api(path, opts) {
  const res = await fetch(`${API()}/charlatan${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function renderConnStatus(kind) {
  const box = document.getElementById('connection-status');
  if (!box) return;
  box.innerHTML = '';
  const dot = document.createElement('span');
  dot.className = 'dot ' + ({ connecting: 'amber', connected: 'green', lost: 'red' }[kind] || '');
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = t(`conn.${kind || 'offline'}`);
  box.appendChild(dot);
  box.appendChild(label);
}

function showLostOverlay() {
  let ov = document.getElementById('lost-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'lost-overlay';
    ov.className = 'overlay';
    ov.innerHTML = `
      <div class="terminal-frame panel stack" style="max-width:44rem;text-align:center">
        <h2 data-i18n="conn.lost"></h2>
        <p class="muted" data-i18n="conn.lost_hint"></p>
        <button class="btn-primary" id="retry-btn" data-i18n="conn.retry"></button>
      </div>`;
    document.body.appendChild(ov);
    hydrate(ov);
    ov.querySelector('#retry-btn').addEventListener('click', () => location.reload());
  }
  ov.hidden = false;
}

function wireEvents() {
  state.on('ws:session_state_sync', (payload) => {
    state.applySync(payload);
    if (payload && payload.stage !== undefined) state.emit('stage_change', payload.stage);
  });
  state.on('ws:room_update', (payload) => state.applySync(payload));
  state.on('ws:phase_change', (payload) => {
    const phase = payload && payload.phase !== undefined ? payload.phase : payload;
    state.setPhase(phase);
  });
  state.on('ws:player_joined', (p) => state.upsertPlayer(p));
  state.on('ws:player_left', (p) => state.removePlayer(p && p.id !== undefined ? p.id : p));
  state.on('ws:role_assigned', (payload) => {
    const s = state.getState();
    if (payload) {
      s.role = payload.role !== undefined ? payload.role : payload;
      s.trait = payload.trait !== undefined ? payload.trait : s.trait;
    }
    state.saveSession();
    state.emit('role_assigned', payload);
  });
  state.on('ws:task', (payload) => {
    state.getState().task = payload;
    state.emit('task', payload);
  });
  state.on('ws:vote_result', (payload) => {
    const s = state.getState();
    if (payload && payload.tally) s.votes = payload.tally;
    state.emit('vote_result', payload);
  });
}

function mountGate() {
  const screen = document.getElementById('screen');
  screen.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'stack';
  wrap.innerHTML = `
    <header class="screen-header">
      <h1><span class="highlight" data-i18n="gate.title"></span></h1>
      <p class="subtitle" data-i18n="gate.subtitle"></p>
    </header>

    <div class="terminal-frame panel" style="width: 100%; max-width: 580px; margin: 0 auto; padding: 3.2rem;">
      <div class="mode-tabs" role="tablist">
        <button class="mode-tab active" id="tab-join" role="tab" data-i18n="gate.join">Join by Code</button>
        <button class="mode-tab" id="tab-host" role="tab" data-i18n="gate.host">Host a Room</button>
      </div>

      <form id="gate-form" style="width: 100%; margin-top: 2rem;">
        <div class="field-group field">
          <label class="field-label" data-i18n="gate.name_label">Your Callsign</label>
          <input type="text" name="name" maxlength="24" placeholder="Callsign">
        </div>

        <div class="field-collapse" id="code-group">
          <div class="field-group field">
            <label class="field-label" data-i18n="gate.code_label">Room Code</label>
            <input type="text" name="code" maxlength="8" placeholder="ABC123" required
                   style="width: 100%;font-family:var(--font-display);letter-spacing:0.2em;text-transform:uppercase">
          </div>
        </div>

        <button class="btn-primary" type="submit" id="gate-submit" style="width: 100%; margin-top: 1rem;" data-i18n="gate.join">Join Room</button>
      </form>
      <p class="task-status" id="gate-error" role="alert"></p>
    </div>
  `;
  screen.appendChild(hydrate(wrap));

  let mode = 'join';
  const form = wrap.querySelector('#gate-form');
  const codeGroup = wrap.querySelector('#code-group');
  const codeInput = form.elements.code;
  const submit = wrap.querySelector('#gate-submit');
  const errEl = wrap.querySelector('#gate-error');

  form.elements.name.placeholder = t("gate.name_placeholder")

  function setMode(m) {
    mode = m;
    wrap.querySelector('#tab-host').classList.toggle('active', m === 'host');
    wrap.querySelector('#tab-join').classList.toggle('active', m === 'join');
    codeGroup.classList.toggle('is-collapsed', m !== 'join');
    codeInput.required = m === 'join';
    submit.textContent = t(m === 'host' ? 'gate.host' : 'gate.join');
  }
  wrap.querySelector('#tab-host').addEventListener('click', () => setMode('host'));
  wrap.querySelector('#tab-join').addEventListener('click', () => setMode('join'));

  codeInput.addEventListener('input', (e) => {
    e.target.value = e.target.value
      .toUpperCase()
      .replace(/[^0-9A-F]/g, '')
      .slice(0, 6);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    submit.disabled = true;
    try {
      const name = form.elements.name.value.trim();
      const user_uuid = state.getOrCreateUserUUID();
      let data;
      if (mode === 'host') {
        data = await api('/create', { method: 'POST', body: JSON.stringify({ user_uuid, user_name: name }) });
      } else {
        const room_code = codeInput.value.trim().toUpperCase();
        data = await api('/join', {
          method: 'POST',
          body: JSON.stringify({ user_uuid, user_name: name, room_code }),
        });
      }
      enterRoom(data);
    } catch (err) {
      errEl.textContent = t('gate.error') + ': ' + err.message;
      submit.disabled = false;
    }
  });
}

async function enterRoom(sessionSnapshot) {
  const s = state.getState();
  s.room = sessionSnapshot.room;
  s.session = sessionSnapshot;
  s.players = sessionSnapshot.room.users ? sessionSnapshot.room.users.map(id => ({ id })) : [];
  state.saveSession();

  const user_uuid = state.getOrCreateUserUUID();
  const roomId = s.room.id;

  const fetchTicket = async () => {
    const tktRes = await api(`/room/${roomId}/ws-ticket`, {
      method: 'POST',
      body: JSON.stringify({ user_uuid })
    });
    return tktRes.ticket;
  };

  try {
    wireEvents();
    router.boot(document.getElementById('screen'));
    ws.connect(roomId, fetchTicket);
  } catch (err) {
    console.error('Failed to initialize ws connection:', err);
    mountGate();
  }
}

async function boot() {
  await loadLocale();
  hydrate(document.body);

  const langLink = document.getElementById('lang-switch');
  if (langLink) {
    langLink.href = localeSwitchHref(langLink.dataset.locale);
  }

  renderConnStatus('offline');
  state.on('connection_status', renderConnStatus);
  state.on('connection_lost', showLostOverlay);

  const saved = state.loadSession();
  if (saved && saved.room) {
    state.getState().room = saved.room;
    if (saved.session) {
      enterRoom(saved.session);
      return;
    }
  }
  mountGate();
}

boot().catch((err) => {
  console.error('charlatan boot failed', err);
  const screen = document.getElementById('screen');
  if (screen) screen.innerHTML = `<p class="waiting">${t('gate.error')}</p>`;
});
