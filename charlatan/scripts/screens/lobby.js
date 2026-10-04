import { t, hydrate } from '../i18n.js';
import { on, getState, getOrCreateUserUUID } from '../state.js';
import * as ws from '../ws.js';

const MIN_PLAYERS = 3;
const PALETTE = ['#8b6ef0', '#2ee6a6', '#ffb454', '#4cc9f0', '#f472b6', '#a3e635', '#fb923c', '#60a5fa'];

let root = null;
let seen = null;
let starting = false;
let leaveArmed = false;
let leaveTimer = null;
const timers = [];
const subs = [];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
const q = (sel) => root.querySelector(sel);

function colorFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function playerCard(p, i, selfId, hostId) {
  const id = String(p.id);
  const name = p.name || t('lobby.player_fallback', { n: i + 1 });
  const offline = p.alive === false || p.connected === false;
  const isNew = seen && !seen.has(id);

  const li = el('li', 'lobby-player' + (offline ? ' is-offline' : '') + (isNew ? ' is-new' : ''));
  li.style.setProperty('--c', colorFor(id));

  li.appendChild(el('span', 'avatar', Array.from(name)[0].toUpperCase()));

  const info = el('span', 'info');
  info.appendChild(el('span', 'name', name));
  const tags = el('span', 'tags');
  if (id === selfId) tags.appendChild(el('span', 'tag tag-you', t('lobby.you')));
  if (id === hostId) tags.appendChild(el('span', 'tag tag-host', t('lobby.host')));
  if (tags.childNodes.length) info.appendChild(tags);
  li.appendChild(info);

  const dot = el('span', `dot ${offline ? 'red' : 'green'}`);
  dot.title = offline ? 'offline' : 'online';
  li.appendChild(dot);
  return li;
}

function render() {
  if (!root) return;
  const s = getState();
  const players = s.players || [];
  const selfId = String((s.self && s.self.id) ?? getOrCreateUserUUID());
  const hostId = s.room && s.room.host_id !== undefined ? String(s.room.host_id) : null;
  const isHost = hostId !== null && hostId === selfId;
  const missing = Math.max(0, MIN_PLAYERS - players.length);
  const ready = missing === 0;

  // Room code tiles
  const code = (s.room && s.room.join_code) || '';
  const codeEl = q('#room-code');
  codeEl.replaceChildren(...Array.from(code || '------').map((c) => el('span', 'code-char' + (code ? '' : ' is-empty'), c)));
  codeEl.setAttribute('aria-label', code);
  q('#copy-btn').disabled = !code;

  // Roster: joined players, then placeholder seats up to the minimum
  const cards = players.map((p, i) => playerCard(p, i, selfId, hostId));
  const slots = Array.from({ length: missing }, () => {
    const li = el('li', 'lobby-slot');
    li.appendChild(el('span', 'avatar'));
    li.appendChild(el('span', 'name', t('lobby.empty_slot')));
    return li;
  });
  q('.lobby-roster').replaceChildren(...cards, ...slots);
  seen = new Set(players.map((p) => String(p.id)));

  // Count + meter
  q('.player-count').textContent = t('lobby.players_count', { n: players.length });
  const meter = q('.lobby-meter');
  meter.classList.toggle('is-full', ready);
  meter.firstElementChild.style.width = `${Math.min(100, (players.length / MIN_PLAYERS) * 100)}%`;
  meter.setAttribute('aria-valuenow', String(players.length));

  // Status line + host controls
  q('.lobby-status .dot').className = `dot ${ready && isHost ? 'green' : 'amber'}`;
  q('.lobby-status .text').textContent = !isHost
    ? t('lobby.waiting_host')
    : ready ? t('lobby.ready') : t('lobby.need_more', { n: missing });

  const startBtn = q('#start-btn');
  startBtn.hidden = !isHost;
  startBtn.disabled = !ready || starting;
  startBtn.textContent = starting ? t('lobby.starting') : t('lobby.start');
}

async function copyCode() {
  const btn = q('#copy-btn');
  const code = (getState().room || {}).join_code;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(q('#room-code'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  btn.textContent = t('lobby.copied');
  btn.classList.add('is-done');
  later(() => { btn.textContent = t('lobby.copy_code'); btn.classList.remove('is-done'); }, 1600);
}

function shareCode() {
  const code = (getState().room || {}).join_code;
  if (!code || !navigator.share) return;
  navigator.share({ title: 'Charlatan', text: `${t('lobby.share_text')} ${code}`, url: location.href }).catch(() => {});
}

function onLeave() {
  const btn = q('#leave-btn');
  if (!leaveArmed) {
    leaveArmed = true;
    btn.textContent = t('lobby.leave_confirm');
    btn.classList.add('is-armed');
    leaveTimer = later(disarmLeave, 3000);
    return;
  }
  ws.close();
  sessionStorage.removeItem('charlatan.session');
  location.reload();
}

function disarmLeave() {
  if (!root) return;
  leaveArmed = false;
  clearTimeout(leaveTimer);
  const btn = q('#leave-btn');
  btn.textContent = t('lobby.leave');
  btn.classList.remove('is-armed');
}

function onStart() {
  if (starting) return;
  starting = true;
  ws.send('game_start', {});
  render();
  // If the phase doesn't change, let the host try again.
  later(() => { starting = false; render(); }, 4000);
}

export default {
  mount(container) {
    starting = false;
    leaveArmed = false;
    seen = null;

    root = el('div', 'stack lobby-screen');
    root.innerHTML = `
      <section class="terminal-frame panel lobby-code">
        <span class="label" data-i18n="lobby.room_code"></span>
        <div class="lobby-code-chars" id="room-code" dir="ltr" role="img"></div>
        <div class="btn-group">
          <button class="btn-primary" id="copy-btn" type="button"></button>
          <button class="btn-ghost" id="share-btn" type="button" hidden data-i18n="lobby.share"></button>
        </div>
        <p class="muted" data-i18n="lobby.share_hint"></p>
      </section>

      <section class="terminal-frame panel lobby-crew">
        <div class="panel-title">
          <h2 data-i18n="lobby.players"></h2>
          <span class="lobby-count player-count"></span>
        </div>
        <div class="lobby-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${MIN_PLAYERS}"><span></span></div>
        <ul class="lobby-roster"></ul>
        <div class="lobby-actions">
          <p class="lobby-status" aria-live="polite"><span class="dot amber"></span><span class="text"></span></p>
          <div class="btn-group">
            <button class="btn-ghost" id="leave-btn" type="button"></button>
            <button class="btn-primary" id="start-btn" type="button" hidden></button>
          </div>
        </div>
      </section>

      <details class="lobby-how">
        <summary data-i18n="lobby.how_title"></summary>
        <ul>
          <li data-i18n="lobby.how_1"></li>
          <li data-i18n="lobby.how_2"></li>
          <li data-i18n="lobby.how_3"></li>
          <li data-i18n="lobby.how_4"></li>
        </ul>
      </details>
    `;
    hydrate(root); // must run after innerHTML so data-i18n nodes exist
    container.appendChild(root);

    q('#copy-btn').textContent = t('lobby.copy_code');
    q('#leave-btn').textContent = t('lobby.leave');
    if (navigator.share) q('#share-btn').hidden = false;

    q('#copy-btn').addEventListener('click', copyCode);
    q('#share-btn').addEventListener('click', shareCode);
    q('#leave-btn').addEventListener('click', onLeave);
    q('#start-btn').addEventListener('click', onStart);

    render();

    subs.push(on('players_update', render));
    subs.push(on('ws:player_joined', render));
    subs.push(on('ws:player_left', render));
    subs.push(on('state_sync', render));
  },

  unmount() {
    while (subs.length) subs.pop()();
    while (timers.length) clearTimeout(timers.pop());
    if (root) root.remove();
    root = null;
  },
};
