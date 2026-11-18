import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { resolveTheme } from '../../src/ui/theme.js';

const bootCode = readFileSync(fileURLToPath(new URL('../../src/theme-boot.js', import.meta.url)), 'utf8');

function runBoot({ stored, prefersDark, storageThrows = false, hasMatchMedia = true }) {
  const attrs = {};
  const meta = { content: '', setAttribute(k, v) { this.content = v; } };
  const sandbox = {
    localStorage: { getItem: () => { if (storageThrows) throw new Error('blocked'); return stored; } },
    window: hasMatchMedia ? { matchMedia: () => ({ matches: prefersDark }) } : {},
    document: {
      documentElement: { setAttribute: (k, v) => { attrs[k] = v; } },
      querySelector: () => meta,
    },
  };
  vm.runInNewContext(bootCode, sandbox);
  return { theme: attrs['data-theme'], color: meta.content };
}

test('theme boot script agrees with resolveTheme for every stored/OS combination', () => {
  for (const stored of ['dark', 'light', null, 'garbage']) {
    for (const prefersDark of [true, false]) {
      assert.equal(runBoot({ stored, prefersDark }).theme, resolveTheme({ stored, prefersDark }), `${stored}/${prefersDark}`);
    }
  }
});

test('theme boot script sets a matching browser theme colour', () => {
  assert.equal(runBoot({ stored: 'dark' }).color, '#0b1020');
  assert.equal(runBoot({ stored: 'light' }).color, '#4f46e5');
});

test('theme boot script survives blocked storage and missing matchMedia', () => {
  assert.equal(runBoot({ storageThrows: true, prefersDark: true }).theme, 'dark');
  assert.equal(runBoot({ stored: null, hasMatchMedia: false }).theme, 'light');
});

test('theme boot script is loaded in <head> before the app and is precached', () => {
  const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /<script src="src\/theme-boot\.js"><\/script>/);
  assert.ok(html.indexOf('theme-boot.js') < html.indexOf('src/main.js'));
  assert.match(readFileSync(fileURLToPath(new URL('../../sw.js', import.meta.url)), 'utf8'), /src\/theme-boot\.js/);
});

test('the meta theme-color in index.html matches the light theme colour', () => {
  const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
  assert.match(html, /<meta name="theme-color" content="#4f46e5"/);
});
