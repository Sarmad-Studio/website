import { CharlatanNetwork } from './network.js';

const API_BASE = document.body.dataset.apiBase || `${window.location.protocol}//api.${window.location.host}/charlatan/`;

const ROLE_META = {
  human: { color: 'var(--purple)', team: 'Crew · Human', icon: 'H' },
  captain: { color: 'var(--purple)', team: 'Crew · Captain', icon: 'C' },
  alien: { color: 'var(--green)', team: 'Infiltrator · Alien', icon: 'A' },
  hunter: { color: 'var(--red)', team: 'Infiltrator · Hunter', icon: 'X' },
};

const PHASE_META = {
  initial: { label: 'Role Assignment' },
  mission: { label: 'Mission' },
  debate: { label: 'Debate' },
  hunter: { label: 'Final Move' },
  voting: { label: 'Ejection Vote' },
  ended: { label: 'Debrief' },
};

class GameApp {
  constructor() {
    this.net = new CharlatanNetwork({ baseUrl: API_BASE });
    this.mode = 'join';
    this.timerHandle = null;
    this.players = new Map();
    this.pendingTaskValue = null;

    this.#cacheDom();
    this.#bindEntryForm();
    this.#bindMissionActions();
    this.#bindNetworkEvents();
  }

  #cacheDom() {
    this.dom = {
      connectionStatus: document.getElementById('connection-status'),
      connectionLabel: document.getElementById('connection-label'),

      viewLobby: document.getElementById('view-lobby'),
      viewMission: document.getElementById('view-mission'),

      modeTabs: document.querySelectorAll('.mode-tab'),
      entryForm: document.getElementById('entry-form'),
      entrySubmit: document.getElementById('entry-submit'),
      userNameInput: document.getElementById('user-name'),
      roomCodeField: document.getElementById('room-code-field'),
      roomCodeInput: document.getElementById('room-code'),

      lobbyEntry: document.getElementById('lobby-entry'),
      lobbyRoster: document.getElementById('lobby-roster'),
      roomCodeDisplay: document.getElementById('room-code-display'),
      rosterList: document.getElementById('roster-list'),
      startMissionBtn: document.getElementById('start-mission-btn'),
      voiceToggleBtn: document.getElementById('voice-toggle-btn'),

      phaseLabel: document.getElementById('phase-label'),
      phaseTimer: document.getElementById('phase-timer'),

      roleCard: document.getElementById('role-card'),
      roleIcon: document.getElementById('role-icon'),
      roleName: document.getElementById('role-name'),
      roleTeam: document.getElementById('role-team'),
      roleObjective: document.getElementById('role-objective'),

      taskTitle: document.getElementById('task-title'),
      taskHint: document.getElementById('task-hint'),
      taskBody: document.getElementById('task-body'),
      taskSubmit: document.getElementById('task-submit'),

      playerStrip: document.getElementById('player-strip'),
    };
  }

  #bindEntryForm() {
    this.dom.modeTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        this.mode = tab.dataset.mode;
        const isCreate = this.mode === 'create';

        this.dom.modeTabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
        this.dom.roomCodeField.classList.toggle('is-collapsed', isCreate);
        this.dom.roomCodeInput.required = !isCreate;
        if (isCreate) this.dom.roomCodeInput.value = '';
        this.dom.entrySubmit.textContent = isCreate ? 'Build a Ship' : 'Board the Ship';
      });
    });

    this.dom.roomCodeInput.addEventListener('input', (e) => {
      e.target.value = e.target.value
        .toUpperCase()
        .replace(/[^0-9A-F]/g, '')
        .slice(0, 6);
    });

    this.dom.entryForm.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const name = this.dom.userNameInput.value.trim();
      const roomCode = this.dom.roomCodeInput.value.trim().toUpperCase();
      if (!name) return;
      if (this.mode === 'join' && !roomCode) return;

      this.dom.entrySubmit.disabled = true;
      try {
        const data = this.mode === 'create'
          ? await this.net.createRoom(name)
          : await this.net.joinRoom(name, roomCode);

        await this.net.connect(data.room?.id);
        this.dom.roomCodeDisplay.textContent = data.room?.join_code || "——————";
        this.dom.lobbyEntry.classList.add('hidden');
        this.dom.lobbyRoster.classList.remove('hidden');
      } catch (err) {
        console.error('[game] failed to enter room', err);
        this.dom.connectionLabel.textContent = 'Connection failed';
      } finally {
        this.dom.entrySubmit.disabled = false;
      }
    });

    this.dom.startMissionBtn.addEventListener('click', () => {
      this.net.send('game_start', {});
    });

    this.dom.voiceToggleBtn.addEventListener('click', async () => {
      this.dom.voiceToggleBtn.disabled = true;
      this.dom.voiceToggleBtn.textContent = 'Connecting…';
      try {
        await this.net.startVoiceSession();
        this.dom.voiceToggleBtn.textContent = 'Voice Comms Live';
      } catch (err) {
        console.error('[game] voice session failed', err);
        this.dom.voiceToggleBtn.textContent = 'Voice Unavailable';
      }
    });
  }

  #bindMissionActions() {
    this.dom.taskSubmit.addEventListener('click', () => {
      this.net.send('task_submit', { value: this.pendingTaskValue });
      this.dom.taskSubmit.disabled = true;
    });
  }

  #bindNetworkEvents() {
    this.net.on('__connection_state', (state) => this.#renderConnectionState(state));

    this.net.on('room_state', (payload) => this.#renderRoster(payload));
    this.net.on('role_assigned', (payload) => this.#renderRole(payload));
    this.net.on('phase_change', (payload) => this.#renderPhase(payload));
    this.net.on('mission_started', (payload) => this.#renderMission(payload));
  }

  #renderConnectionState(state) {
    this.dom.connectionStatus.dataset.state = state;
    const labels = {
      disconnected: 'Offline',
      connecting: 'Connecting…',
      connected: 'Connected',
      error: 'Connection Error',
    };
    this.dom.connectionLabel.textContent = labels[state] ?? state;
  }

  #renderRoster(payload) {
    this.players = new Map((payload.players ?? []).map((p) => [p.uuid, p]));

    if (this.players.size === 0) {
      this.dom.rosterList.innerHTML = '<li class="roster-empty">Waiting for the crew to assemble…</li>';
    } else {
      this.dom.rosterList.innerHTML = '';
      for (const p of this.players.values()) {
        const li = document.createElement('li');
        li.className = 'roster-row';
        li.innerHTML = `
          <span class="presence"></span>
          <span class="name">${escapeHtml(p.name)}</span>
          <span class="tag">${p.is_host ? 'Host' : ''}</span>
        `;
        this.dom.rosterList.appendChild(li);
      }
    }

    this.dom.startMissionBtn.disabled = this.players.size < 3;
    this.#renderPlayerStrip();
  }

  #renderRole(payload) {
    const meta = ROLE_META[payload.role] ?? ROLE_META.human;
    this.dom.roleCard.style.setProperty('--role-color', meta.color);
    this.dom.roleIcon.textContent = meta.icon;
    this.dom.roleName.textContent = capitalize(payload.role);
    this.dom.roleTeam.textContent = meta.team;
    this.dom.roleObjective.textContent = payload.objective
      ?? 'Await further instructions from the server.';
  }

  #renderPhase(payload) {
    this.dom.viewLobby.classList.add('hidden');
    this.dom.viewMission.classList.remove('hidden');

    const meta = PHASE_META[payload.phase] ?? { label: payload.phase };
    const missionSuffix = payload.mission_index ? ` ${String(payload.mission_index).padStart(2, '0')}` : '';
    this.dom.phaseLabel.textContent = `${meta.label}${missionSuffix}`;

    this.#startTimer(payload.duration_seconds ?? 0);
    this.#renderTaskShellForPhase(payload.phase);
  }

  #renderTaskShellForPhase(phase) {
    const copy = {
      initial: ['Standing By', 'Roles are being dealt out.'],
      mission: ['Awaiting Task', 'The server will push your task shortly.'],
      debate: ['Open Floor', 'Discuss with the crew before the vote.'],
      hunter: ['Final Move', 'A decisive action is being made.'],
      voting: ['Cast Your Vote', 'Choose who to send to the airlock.'],
      ended: ['Debrief', 'The mission has concluded.'],
    }[phase] ?? ['Standing By', 'Waiting on the server.'];

    this.dom.taskTitle.textContent = copy[0];
    this.dom.taskHint.textContent = copy[1];
    this.dom.taskBody.textContent = 'No active task';
    this.dom.taskSubmit.classList.add('hidden');
    this.dom.taskSubmit.disabled = false;
  }

  #renderMission(payload) {
    this.dom.taskTitle.textContent = payload.title ?? 'Mission Task';
    this.dom.taskHint.textContent = payload.prompt ?? '';
    this.dom.taskBody.textContent = `[${payload.type ?? 'task'} widget renders here]`;
    this.dom.taskSubmit.classList.remove('hidden');
  }

  #renderPlayerStrip() {
    this.dom.playerStrip.innerHTML = '';
    for (const p of this.players.values()) {
      const chip = document.createElement('span');
      chip.className = 'player-chip';
      chip.dataset.alive = String(p.alive !== false);
      chip.innerHTML = `<span class="dot"></span>${escapeHtml(p.name)}`;
      this.dom.playerStrip.appendChild(chip);
    }
  }

  #startTimer(seconds) {
    clearInterval(this.timerHandle);
    let remaining = seconds;
    const tick = () => {
      const m = String(Math.max(0, Math.floor(remaining / 60))).padStart(2, '0');
      const s = String(Math.max(0, remaining % 60)).padStart(2, '0');
      this.dom.phaseTimer.textContent = `${m}:${s}`;
      if (remaining <= 0) clearInterval(this.timerHandle);
      remaining -= 1;
    };
    tick();
    if (seconds > 0) this.timerHandle = setInterval(tick, 1000);
  }
}

function capitalize(str = '') {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str = '') {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  window.charlatan = new GameApp();
});
