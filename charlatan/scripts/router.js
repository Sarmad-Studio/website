import { on, getState } from './state.js';
import lobby from './screens/lobby.js';

const ROUTES = { lobby };

let currentKey = null;
let currentScreen = null;
let container = null;
let unsubs = [];

// `initial` shares the lobby.
export function resolveKey() {
  const s = getState();
  const phase = s.session?.phase;
  if (phase === 'initial') return 'lobby';
  if (phase && ROUTES[phase]) return phase;
  const stage = s.room && s.room.stage;
  return stage === 'ended' ? 'ended' : 'lobby';
}

export function swap(key) {
  if (key === currentKey) return;
  if (currentScreen) currentScreen.unmount();
  container.innerHTML = '';
  currentScreen = ROUTES[key];
  currentKey = key;
  currentScreen.mount(container, getState());
}

export function refresh() {
  if (!currentScreen) return;
  currentScreen.unmount();
  container.innerHTML = '';
  currentScreen.mount(container, getState());
}

export function boot(mountEl) {
  stop();
  container = mountEl;
  const go = () => swap(resolveKey());
  unsubs = [on('phase_change', go), on('state_sync', go)];
  go();
}

export function stop() {
  unsubs.forEach((u) => u());
  unsubs = [];
  if (currentScreen) currentScreen.unmount();
  if (container) container.innerHTML = '';
  currentScreen = null;
  currentKey = null;
}
