import { loadLocale, t, hydrate, localeSwitchHref } from './i18n.js';
import * as state from './state.js';
import * as ws from './ws.js';
import * as router from './router.js';
import { post, ApiError } from './api.js';

const screenEl = () => document.getElementById('screen');

function renderConnStatus(kind) {
  const box = document.getElementById('connection-status');
  if (!box) return;
  box.innerHTML = '';
  const dot = document.createElement('span');
  dot.className = 'dot ' + ({ connecting: 'amber', connected: 'green', lost: 'red' }[kind] || '');
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = t(`conn.${kind || 'offline'}`);
  box.append(dot, label);
}

function toast(msg) {
  const n = document.createElement('div');
  n.className = 'toast';
  n.setAttribute('role', 'status');
  n.textContent = msg;
  n.style.cssText = 'position:fixed;left:50%;bottom:1.5rem;transform:translateX(-50%);z-index:50;padding:.8rem 1.4rem;background:var(--panel-bg,#1b1b24);border:1px solid currentColor';
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 4000);
}

function showLostOverlay() {
  let ov = document.getElementById('err-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'err-overlay';
    ov.className = 'overlay';
    ov.innerHTML = `
      <div class="terminal-frame panel stack" style="max-width:44rem;text-align:center">
        <h2 data-i18n="conn.lost"></h2>
        <p class="muted" data-i18n="conn.lost_hint"></p>
        <div style="display:flex;gap:1rem;justify-content:center">
          <button class="btn-primary" id="retry-btn" data-i18n="conn.retry">Retry</button>
          <button class="btn-ghost" id="leave-btn"></button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    hydrate(ov);
    ov.querySelector('#leave-btn').textContent = t('lobby.leave', 'Leave');
    ov.querySelector('#retry-btn').addEventListener('click', () => { hideOverlay(); ws.resume(); });
    ov.querySelector('#leave-btn').addEventListener('click', leaveRoom);
  }
  ov.hidden = false;
}
function hideOverlay() {
  const ov = document.getElementById('err-overlay');
  if (ov) ov.hidden = true;
}

function exitToGate(notice) {
  hideOverlay();
  ws.close();
  router.stop();
  state.clearSession();
  state.resetState();
  mountGate(notice);
}

function leaveRoom() {
  const id = state.getState().session.room?.id;
  if (id) post(`/room/${encodeURIComponent(id)}/leave`, {}).catch(() => { }); // best effort
  exitToGate();
}

function enterRoom(snapshot) {
  hideOverlay();
  state.applySession(snapshot);
  router.boot(screenEl());
  ws.connect(snapshot.room.id);
}

function wireEvents() {
  state.bindServerEvents();
  state.on('connection_status', (k) => { renderConnStatus(k); if (k === 'connected') hideOverlay(); });
  state.on('connection_lost', showLostOverlay);
  state.on('connection_fatal', ({ reason }) => exitToGate(reason === 'room_gone' ? t('gate.room_gone') : t('gate.not_member')));
  state.on('room_closed', () => { if (state.getState().session.room) exitToGate(t('gate.room_closed')); });
  state.on('request_leave', leaveRoom);
  state.on('notice', toast);
  state.on('ws_send_failed', () => toast(t('conn.lost')));
}

function errText(err) {
  if (err instanceof ApiError) {
    if (err.status === 429) return t('gate.rate_limited');
    if (err.status === 409) return t('gate.already_in');
    if (err.status === 0) return t('conn.lost');
  }
  return err.message;
}

function mountGate(notice = '') {
  ws.close();
  const screen = screenEl();
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
        <button class="mode-tab active" id="tab-join" role="tab" type="button" data-i18n="gate.join">Join by Code</button>
        <button class="mode-tab" id="tab-host" role="tab" type="button" data-i18n="gate.host">Host a Room</button>
      </div>

      <form id="gate-form" style="width: 100%; margin-top: 2rem;">
        <div class="field-group field">
          <label for="name" class="field-label" data-i18n="gate.name_label">Your Callsign</label>
          <input type="text" id="name" name="name" maxlength="24" autocomplete="nickname">
        </div>

        <div class="field-collapse" id="code-group">
          <div class="field-group field">
            <label for="code" class="field-label" data-i18n="gate.code_label">Room Code</label>
            <input type="text" id="code" name="code" maxlength="8" placeholder="ABC123" autocomplete="off" required
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
  errEl.textContent = notice;
  form.elements.name.placeholder = t('gate.name_placeholder');

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
    e.target.value = e.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 6);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    submit.disabled = true;
    try {
      const user_name = form.elements.name.value.trim();
      const session = mode === 'host'
        ? await post('/create', { user_name })
        : await post('/join', { user_name, room_code: codeInput.value.trim().toUpperCase() });
      if (!session?.room?.id) throw new Error('Invalid server response, try again');
      state.resetState();
      if (mode === 'host') state.setSelf(session.room.owner_id);
      enterRoom(session);
    } catch (err) {
      errEl.textContent = `${t('gate.error')}: ${errText(err)}`;
      submit.disabled = false;
    }
  });
}

async function boot() {
  await loadLocale();
  hydrate(document.body);

  const langLink = document.getElementById('lang-switch');
  if (langLink) langLink.href = localeSwitchHref(langLink.dataset.locale);

  renderConnStatus('offline');
  wireEvents();

  // Resume after reload: fatal -> back to gate
  const saved = state.loadSession();
  if (saved?.session?.room?.id && saved?.self?.user?.id) {
    state.setSelf(saved.self.user.id);
    enterRoom(saved.session);
    return;
  }
  mountGate();
}

boot().catch((err) => {
  console.error('charlatan boot failed', err);
  const screen = screenEl();
  if (screen) screen.innerHTML = `<p class="waiting">${t('gate.error')}</p>`;
});
