/*
 * Envelope both ways: { event, payload, id }
 * Emits `ws:<event>` for every server event, plus:
 *   connection_status: connecting | connected | lost | offline
 *   connection_lost   : retry window exhausted (call resume() to try again)
 *   connection_fatal  : { reason } server says we don't belong here (room gone / not a member)
 */

import { emit } from './state.js';
import { post, apiHost, ApiError } from './api.js';

const PING_MS = 10000;             // server evicts after 90s without an app-level message
const RECONNECT_WINDOW_MS = 30000;
const CONNECT_TIMEOUT_MS = 8000;
const BACKOFF_BASE_MS = 300;
const BACKOFF_MAX_MS = 3000;
const STALE_HIDDEN_MS = 20000;     // tab hidden longer than this -> socket may be frozen, reopen
const EPOCH = 1712793600000n;      // Spirit Epoch 2024-4-11

let sock = null;
let roomId = null;
let wantOpen = false;
let gen = 0;                       // invalidates in-flight open() calls
let deadline = 0;
let attempts = 0;
let pingTimer = null, retryTimer = null, connTimer = null;
let hiddenAt = 0;
let status = 'offline';
let idLast = 0n, idSeq = 0n;

function snowflake() {
  let now = BigInt(Date.now());
  if (now < idLast) now = idLast; // clock went backwards
  if (now === idLast) {
    idSeq = (idSeq + 1n) & 16383n;
    if (idSeq === 0n) now = idLast + 1n;
  } else idSeq = 0n;
  idLast = now;
  return String(((now - EPOCH) << 22n) | (1n << 14n) | idSeq);
}

export const encode = (event, payload) => JSON.stringify({ event, payload, id: snowflake() });

export function decode(text) {
  try {
    const m = JSON.parse(text);
    if (m && typeof m.event === 'string') return m;
  } catch (_) { /* malformed */ }
  return null;
}

function setStatus(k) {
  if (k === status) return;
  status = k;
  emit('connection_status', k);
}

const clearTimers = () => {
  clearInterval(pingTimer); clearTimeout(retryTimer); clearTimeout(connTimer);
  pingTimer = retryTimer = connTimer = null;
};

function closeSock() {
  const s = sock;
  sock = null;
  clearInterval(pingTimer); pingTimer = null;
  clearTimeout(connTimer); connTimer = null;
  if (s) {
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    try { s.close(1000); } catch (_) { /* noop */ }
  }
}

function retry() {
  if (!wantOpen) return;
  const now = Date.now();
  if (!deadline) deadline = now;
  if (now - deadline >= RECONNECT_WINDOW_MS) {
    wantOpen = false;
    setStatus('lost');
    emit('connection_lost', {});
    return;
  }
  setStatus('connecting');
  const base = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_MAX_MS);
  attempts += 1;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(open, base * (0.75 + Math.random() * 0.5));
}

function fatal(reason) {
  wantOpen = false;
  clearTimers();
  closeSock();
  setStatus('offline');
  emit('connection_fatal', { reason });
}

async function open() {
  if (!wantOpen || !roomId) return;
  const my = ++gen;
  clearTimeout(retryTimer);
  closeSock();
  setStatus('connecting');

  let ticket;
  try {
    ticket = (await post(`/room/${encodeURIComponent(roomId)}/ws-ticket`, {})).ticket;
  } catch (err) {
    if (my !== gen) return;
    if (err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) {
      return fatal(err.status === 404 ? 'room_gone' : 'not_member');
    }
    return retry(); // network, 429, 5xx
  }
  if (my !== gen || !wantOpen) return;
  if (!ticket) return retry();

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let s;
  try {
    s = new WebSocket(`${proto}//${apiHost()}/charlatan/room/${encodeURIComponent(roomId)}/ws?ticket=${encodeURIComponent(ticket)}`);
  } catch (_) {
    return retry();
  }
  sock = s;

  connTimer = setTimeout(() => { if (sock === s && s.readyState === WebSocket.CONNECTING) { closeSock(); retry(); } }, CONNECT_TIMEOUT_MS);

  s.onopen = () => {
    if (sock !== s) return;
    clearTimeout(connTimer);
    deadline = 0;
    attempts = 0;
    setStatus('connected');
    clearInterval(pingTimer);
    pingTimer = setInterval(() => send('ping', {}), PING_MS);
    emit('ws_open', {});
  };
  s.onmessage = (ev) => {
    if (sock !== s) return;
    const m = decode(ev.data);
    if (m) emit(`ws:${m.event}`, m.payload);
  };
  s.onclose = () => {
    if (sock !== s) return;
    closeSock();
    emit('ws_close', {});
    retry();
  };
  s.onerror = () => { /* onclose follows */ };
}

// Reopen now if we're not healthy (tab wake, network back)
function nudge(force = false) {
  if (!wantOpen) return;
  if (!force && sock?.readyState <= WebSocket.OPEN) return;
  attempts = 0;
  open();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => nudge(true));
  window.addEventListener('pageshow', (e) => { if (e.persisted) nudge(true); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (!wantOpen) return;
    if (away > STALE_HIDDEN_MS) nudge(true);
    else if (isConnected()) send('ping', {});
    else nudge();
  });
}

export function connect(newRoomId) {
  if (!newRoomId) throw new Error('missing room id');
  newRoomId = String(newRoomId);
  if (roomId === newRoomId && wantOpen) return;
  clearTimers(); closeSock();
  roomId = newRoomId;
  wantOpen = true;
  deadline = 0;
  attempts = 0;
  open();
}

// After 'lost': user clicked retry
export function resume() {
  if (!roomId) return;
  wantOpen = true;
  deadline = 0;
  nudge(true);
}

export function send(event, payload) {
  if (sock && sock.readyState === WebSocket.OPEN) {
    sock.send(encode(event, payload || {}));
    return true;
  }
  emit('ws_send_failed', { event });
  return false;
}

export function close() {
  wantOpen = false;
  gen++;
  clearTimers();
  closeSock();
  roomId = null;
  setStatus('offline');
}

export const isConnected = () => !!sock && sock.readyState === WebSocket.OPEN;
