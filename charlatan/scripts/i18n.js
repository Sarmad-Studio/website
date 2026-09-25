const SUPPORTED = ['en', 'ar'];

let locale = 'en';
let dict = {};

export function detectLocale() {
  const parts = location.pathname.split('/').filter(Boolean);
  while (parts.length && /\.[a-z0-9]+$/i.test(parts[parts.length - 1])) parts.pop();
  const last = parts[parts.length - 1];
  if (SUPPORTED.includes(last)) locale = last;
  else locale = 'en';
  return locale;
}

export function getLocale() {
  return locale;
}

export function isRTL() {
  return locale === 'ar';
}

// Base path of the app, derived from this module's URL: .../scripts/i18n.js
function appBase() {
  const url = new URL(import.meta.url);
  return url.pathname.replace(/\/scripts\/[^/]+$/, '');
}

export async function loadLocale() {
  detectLocale();
  try {
    const res = await fetch(`${appBase()}/locales/${locale}.json`);
    dict = await res.json();
  } catch (_) {
    dict = {};
  }
  document.documentElement.lang = locale;
  document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';
  return dict;
}

function lookup(key) {
  return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), dict);
}

/**
 * t('lobby.title') or t('lobby.greet', { name: 'Spirit' })
 * Falls back to the key itself when missing.
 */
export function t(key, vars) {
  let str = lookup(key);
  if (typeof str !== 'string') str = key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

/** Swap text nodes marked with data-i18n on an already-rendered subtree. */
export function hydrate(root) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  return root;
}

/** Link hrefs/labels for switching between locales on the same page. */
export function localeSwitchHref(other) {
  const segs = location.pathname.split('/');
  const idx = [...segs].reverse().findIndex((s) => SUPPORTED.includes(s));
  if (idx >= 0) segs[segs.length - 1 - idx] = other;
  return segs.join('/') || '/';
}
