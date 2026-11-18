export const THEME_KEY = 'sf2_theme';
const COLORS = { light: '#4f46e5', dark: '#0b1020' };

export function resolveTheme({ stored, prefersDark }) {
  if (stored === 'dark' || stored === 'light') return stored;
  return prefersDark ? 'dark' : 'light';
}

export function applyTheme(theme, doc = document) {
  doc.documentElement.dataset.theme = theme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[theme]);
  return theme;
}

export function currentTheme(doc = document) {
  return doc.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function initTheme({ storage = globalThis.localStorage, matchMedia = globalThis.matchMedia, doc = document } = {}) {
  const prefersDark = Boolean(matchMedia?.('(prefers-color-scheme: dark)')?.matches);
  return applyTheme(resolveTheme({ stored: storage?.getItem(THEME_KEY), prefersDark }), doc);
}

export function toggleTheme({ storage = globalThis.localStorage, doc = document } = {}) {
  const next = currentTheme(doc) === 'dark' ? 'light' : 'dark';
  storage?.setItem(THEME_KEY, next);
  return applyTheme(next, doc);
}
