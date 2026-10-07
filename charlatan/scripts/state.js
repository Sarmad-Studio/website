const SESSION_KEY = 'charlatan.session';
const UUID_KEY = 'charlatan.user_uuid';

const blank = () => ({
  session: {
    room: null, // { id, join_code, created_at, stage, visibility, owner_id, max_users }
    started_at: null,
    phase: 'initial',
  },
  players: [],    // [{ user: { id, created_at }, name, connected }]
  self: { user: { id: null, created_at: null }, name: "", connected: true },
  role: null,
  trait: null,
  mission: null,
  task: null,
  votes: null,
  ejected: [],
});
const state = blank();

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
  if (set) for (const fn of [...set]) { try { fn(data); } catch (e) { console.error(event, e); } }
}

export const getState = () => state;

export const findPlayer = (id) => state.players.find((p) => (p.user.id) === id) || null;

export function resetState() {
  Object.assign(state, blank());
}

export function saveSession() {
  try {
    const room = state.session.room
    if (!room) return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      room,
      self: { user: { id: state.self.user.id, created_at: state.self.user.created_at }, name: state.self.name },
    }));
  } catch (_) { /* storage unavailable */ }
}

export function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; }
}

export function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* noop */ }
}

const normPlayer = (p) => p && {
  user: { id: p.user.id, created_at: p.user.created_at },
  name: p.name,
  connected: p.connected ?? true,
};

function normRoom(r) {
  return {
    id: r.id,
    join_code: r.join_code,
    created_at: r.created_at,
    stage: r.stage,
    visibility: r.visibility,
    owner_id: r.owner_id,
    max_users: r.max_users,
  };
}

function refreshSelf() {
  state.self = state.self.user.id ? findPlayer(state.self.user.id) || state.self : null;
}

// Accepts a Session snapshot: { room, started_at, phase }
export function applySession(sess) {
  if (!sess) return;
  state.session = {
    room: normRoom(sess.room),
    started_at: sess.started_at,
    phase: sess.phase
  }
  refreshSelf();
  saveSession();
}

export function setSelf(id) {
  if (id === state.self.user.id) return;
  state.self.user.id = id;
  refreshSelf();
  saveSession();
  emit('self', state.self.user.id);
}

export function upsertPlayer(raw) {
  const p = normPlayer(raw);
  if (!p) return;
  const i = state.players.findIndex((x) => x.user.id === p.user.id);
  if (i < 0) state.players.push(p);
  else state.players[i] = p;
  refreshSelf();
  emit('players_update', [...state.players]);
}

export function removePlayer(id) {
  state.players = state.players.filter((p) => p.user.id !== id);
  refreshSelf();
  emit('players_update', [...state.players]);
}

function setPhase(phase) {
  if (phase === undefined) return;
  state.session.phase = phase;
  if (phase !== 'mission') state.task = null;
  if (phase === 'voting') { state.votes = null; state.ejected = []; }
  emit('phase_change', phase);
}

// Wire server events (ws.js emits `ws:<event>`). Call once.
let bound = false;
export function bindServerEvents() {
  if (bound) return;
  bound = true;

  on('ws:connect', (p) => setSelf(p && p.player_id));

  on('ws:session_state_sync', (p) => {
    if (!p) return;
    applySession(p.session);
    if (Array.isArray(p.players)) state.players = p.players.map(normPlayer).filter(Boolean);
    refreshSelf();
    emit('state_sync', p);
    setPhase(state.session.phase);
  });

  on('ws:player_joined', (p) => upsertPlayer({ ...(p && p.player), connected: true }));
  on('ws:player_left', (p) => p && removePlayer(p.player_id));
  on('ws:disconnect', (p) => {
    if (!p || p.player_id === state.self.user.id) return;
    const pl = findPlayer(p.player_id);
    if (!pl) return;
    pl.connected = false;
    emit('players_update', [...state.players]);
  });
  on('ws:owner_changed', (p) => {
    if (!p?.owner_id || !state.session.room) return;
    state.session.room.owner_id = p.owner_id;
    emit('room_update', state.session.room);
  });

  on('ws:phase_change', (p) => setPhase(p.phase));
  on('ws:mission_started', (p) => { state.mission = p && p.mission; emit('mission_started', p); });
  on('ws:role_assigned', (p) => {
    if (!p) return;
    state.role = p.role ?? null;
    state.trait = p.trait ?? null;
    emit('role_assigned', p);
  });
  on('ws:task', (p) => { state.task = p; emit('task', p); });
  on('ws:vote_result', (p) => {
    if (!p) return;
    state.votes = p.tally ?? null;
    state.ejected = p.ejected || [];
    emit('vote_result', p);
  });

  on('ws:error', (p) => emit('notice', (p && p.message) || 'error'));
  on('ws:room_closed', (p) => emit('room_closed', p));
}

export function getOrCreateUserUUID() {
  let id = null;
  try { id = localStorage.getItem(UUID_KEY); } catch (_) { /* ignore */ }
  if (id && id.length === 36) return id;
  id = memUUID || (memUUID = makeUUID());
  try { localStorage.setItem(UUID_KEY, id); } catch (_) { /* memory only */ }
  return id;
}
let memUUID = null; // fallback so storage-less browsers still get a unique id

function makeUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
