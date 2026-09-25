import { t, hydrate } from '../i18n.js';
import { on, getState } from '../state.js';
import * as ws from '../ws.js';

let root = null;
const subs = [];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderRoster() {
  const s = getState();
  const list = root.querySelector('.roster');
  list.innerHTML = '';
  for (const p of s.players) {
    const row = el('li', 'roster-row');
    const dot = el('span', `dot ${p.alive === false ? 'red' : 'green'}`);
    dot.title = p.alive === false ? 'disconnected' : 'connected';
    row.appendChild(dot);
    row.appendChild(el('span', 'name', p.name || p.id));
    if (s.room && String(p.id) === String(s.room.host_id)) {
      row.appendChild(el('span', 'host-tag', t('lobby.host')));
    }
    list.appendChild(row);
  }
  const count = root.querySelector('.player-count');
  if (count) count.textContent = t('lobby.players_count', { n: s.players.length });

  const startBtn = root.querySelector('#start-btn');
  if (startBtn) {
    const isHost = s.room && s.self && String(s.room.host_id) === String(s.self.id);
    startBtn.hidden = !isHost;
  }
}

export default {
  mount(container) {
    root = hydrate(el('div', 'stack lobby-screen'));
    root.innerHTML = `
      <div class="terminal-frame panel room-code-block">
        <span class="label" data-i18n="lobby.room_code"></span>
        <div class="code" id="room-code">------</div>
        <p class="muted" data-i18n="lobby.share_hint"></p>
      </div>

      <div class="split">
        <div class="task-shell panel">
          <div class="panel-title">
            <h2 data-i18n="lobby.players"></h2>
            <span class="muted player-count"></span>
          </div>
          <ul class="roster"></ul>
        </div>

        <div class="terminal-frame panel stack">
          <h2 data-i18n="lobby.waiting"></h2>
          <p class="muted" data-i18n="lobby.waiting_hint"></p>
          <div class="btn-group">
            <button class="btn-primary" id="start-btn" hidden data-i18n="lobby.start"></button>
            <button class="btn-ghost" id="leave-btn" data-i18n="lobby.leave"></button>
          </div>
        </div>
      </div>
    `;
    container.appendChild(root);

    const s = getState();
    const codeEl = root.querySelector('#room-code');
    codeEl.textContent = (s.room && s.room.join_code) || '------';

    renderRoster();

    root.querySelector('#start-btn').addEventListener('click', () => {
      ws.send('game_start', {});
    });
    root.querySelector('#leave-btn').addEventListener('click', () => {
      ws.close();
      sessionStorage.removeItem('charlatan.session');
      location.reload();
    });

    subs.push(on('players_update', renderRoster));
    subs.push(on('ws:player_joined', renderRoster));
    subs.push(on('ws:player_left', renderRoster));
    subs.push(on('state_sync', () => {
      const st = getState();
      codeEl.textContent = (st.room && st.room.join_code) || '------';
      renderRoster();
    }));
  },

  unmount() {
    while (subs.length) subs.pop()();
    if (root) root.remove();
    root = null;
  },
};
