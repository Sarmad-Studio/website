import { getOrCreateUserUUID } from './state.js';

const TIMEOUT_MS = 10000;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status; // 0 = network error / timeout
  }
}

export function apiHost() {
  return location.hostname.startsWith('api.') ? location.host : `api.${location.host}`;
}

export function apiOrigin() {
  return `${location.protocol}//${apiHost()}`;
}

export async function api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${apiOrigin()}/charlatan${path}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      ...opts,
    });
  } catch (e) {
    throw new ApiError(0, e.name === 'AbortError' ? 'timeout' : 'network error');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).trim();
    throw new ApiError(res.status, text || res.statusText);
  }
  return res.json();
}

export const post = (path, body) =>
  api(path, { method: 'POST', body: JSON.stringify({ user_uuid: getOrCreateUserUUID(), ...body }) });
