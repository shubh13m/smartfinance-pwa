import { start } from './app/bootstrap.js';
import { initTheme } from './ui/theme.js';

initTheme();
start(document.getElementById('app'));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Service worker failed', error));
}
