const SESSION_KEY = 'charlatan.session';

const state = {
  room: null,      // { id, code, host_id, stage }
  session: null,   // server session payload (phase, round...)
  players: [],     // [{ id, name, alive, is_host }]
  self: null,      // player object for this client
  role: null,      // { role, ... } from role_assigned
  trait: null,     // { trait, ... } from role_assigned
  task: null,      // current Task payload
  votes: {},       // target_id -> count
};

const listeners = new Map(); // event -> Set<fn>

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  const set = listeners.get(event);
  if (set) set.delete(fn);
}

export function emit(event, data) {
  const set = listeners.get(event);
  if (set) for (const fn of [...set]) fn(data);
  const all = listeners.get('*');
  if (all) for (const fn of [...all]) fn({ event, data });
}

export function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      room: state.room,
      session: state.session,
      selfId: state.self ? state.self.id : null,
    }));
  } catch (_) { /* storage unavailable */ }
}

export function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* noop */ }
}

export function applySync(payload) {
  if (!payload) return;
  if (payload.room !== undefined) state.room = payload.room;
  if (payload.session !== undefined) state.session = payload.session;
  if (payload.players !== undefined) state.players = payload.players;
  if (payload.self !== undefined) state.self = payload.self;
  if (payload.role !== undefined) {
    state.role = payload.role && payload.role.role !== undefined ? payload.role.role : payload.role;
  }
  if (payload.trait !== undefined) state.trait = payload.trait;
  if (payload.task !== undefined) state.task = payload.task;
  if (payload.votes !== undefined) state.votes = payload.votes;
  saveSession();
  emit('state_sync', payload);
  if (payload.session && payload.session.phase !== undefined) {
    emit('phase_change', payload.session.phase);
  }
}

export function upsertPlayer(player) {
  const idx = state.players.findIndex((p) => p.id === player.id);
  if (idx >= 0) state.players[idx] = { ...state.players[idx], ...player };
  else state.players.push(player);
  if (state.self && state.self.id === player.id) state.self = { ...state.self, ...player };
  emit('players_update', state.players);
}

export function removePlayer(id) {
  state.players = state.players.filter((p) => p.id !== id);
  emit('players_update', state.players);
}

export function setPhase(phase) {
  if (state.session) state.session.phase = phase;
  saveSession();
  emit('phase_change', phase);
}

export function getOrCreateUserUUID() {
  const LOCAL_KEY = 'charlatan.user_uuid';
  try {
    let id = localStorage.getItem(LOCAL_KEY);
    if (!id || id.length !== 36) {
      // Generate a random UUID v4
      id = ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
      );
      localStorage.setItem(LOCAL_KEY, id);
    }
    return id;
  } catch (_) {
    return '00000000-0000-4000-8000-000000000000';
  }
}

export function getState() {
  return state;
}

export function findPlayer(id) {
  return state.players.find((p) => String(p.id) === String(id)) || null;
}
