import { on, getState } from './state.js';
import lobby from './screens/lobby.js';

const ROUTES = { lobby };

let currentKey = null;
let currentScreen = null;
let container = null;

// `initial` shares the lobby.
export function resolveKey() {
  const s = getState();
  const phase = s.session && s.session.phase;
  if (phase === 'initial') return 'lobby';
  if (phase && ROUTES[phase]) return phase;
  const stage = s.room && s.room.stage;
  return stage === 'ended' ? 'ended' : 'lobby';
}

export function swap(key) {
  if (key === currentKey) return;
  if (currentScreen && typeof currentScreen.unmount === 'function') {
    currentScreen.unmount();
  }
  container.innerHTML = '';
  currentScreen = ROUTES[key] || ROUTES.lobby;
  currentKey = key;
  currentScreen.mount(container, getState());
}

export function refresh() {
  if (!currentScreen) return;
  const key = currentKey;
  if (currentScreen.unmount) currentScreen.unmount();
  container.innerHTML = '';
  currentScreen = ROUTES[key];
  currentScreen.mount(container, getState());
}

export function boot(mountEl) {
  container = mountEl;
  on('phase_change', () => swap(resolveKey()));
  on('stage_change', () => swap(resolveKey()));
  swap(resolveKey());
}
