// Runs synchronously in <head> so the saved/OS theme is in place before first paint
// (no flash of the wrong theme). Mirrors initTheme() in src/ui/theme.js; a unit test keeps them identical.
(function applyEarlyTheme() {
  var stored = null;
  try { stored = localStorage.getItem('sf2_theme'); } catch (e) { /* storage blocked */ }
  var dark = stored === 'dark' || (stored !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0b1020' : '#4f46e5');
}());
