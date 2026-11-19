import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = fileURLToPath(new URL('../../styles/', import.meta.url));
const read = (name) => readFileSync(join(STYLES, name), 'utf8');
const tokens = read('tokens.css');

function block(css, selector) {
  const start = css.indexOf(selector);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return '';
}

const parseVars = (css) => Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = parseVars(block(tokens, ':root'));
const dark = { ...light, ...parseVars(block(tokens, "[data-theme='dark']")) };

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('every var(--token) used in the stylesheets is defined in tokens.css', () => {
  const used = new Set();
  for (const file of readdirSync(STYLES).filter((f) => f.endsWith('.css') && f !== 'tokens.css')) {
    for (const m of read(file).matchAll(/var\((--[\w-]+)/g)) used.add(m[1]);
  }
  assert.ok(used.size > 20);
  for (const token of used) assert.ok(token in light, `${token} is used but not defined`);
});

test('dark theme redefines every colour token (except avatars, which stay vivid in both)', () => {
  const darkOnly = parseVars(block(tokens, "[data-theme='dark']"));
  const colourTokens = Object.entries(light).filter(([name, v]) => /^#[0-9a-f]{6}$/i.test(v) && !name.startsWith('--avatar'));
  for (const [name] of colourTokens) assert.ok(name in darkOnly, `${name} missing from dark theme`);
});

test('dark theme declares color-scheme so form controls and scrollbars match', () => {
  assert.match(block(tokens, "[data-theme='dark']"), /color-scheme:\s*dark/);
  assert.match(block(tokens, ':root'), /color-scheme:\s*light/);
});

const pairs = [
  ['--text', '--bg', 7], ['--text', '--surface', 7], ['--text-2', '--surface', 4.5], ['--text-2', '--bg', 4.5],
  ['--text-3', '--surface', 4.5], ['--on-brand', '--brand', 4.5],
  ['--good', '--good-soft', 4.5], ['--bad', '--bad-soft', 4.5], ['--warn', '--warn-soft', 4.5], ['--brand', '--brand-soft', 4.5],
  ['--good', '--surface', 4.5], ['--bad', '--surface', 4.5],
];

for (const [themeName, vars] of [['light', light], ['dark', dark]]) {
  test(`accessibility: ${themeName} theme text/background pairs meet WCAG contrast`, () => {
    for (const [fg, bg, min] of pairs) {
      const ratio = contrast(vars[fg], vars[bg]);
      assert.ok(ratio >= min, `${themeName}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
  });
}

test('accessibility: white text on the hero gradient stays readable in both themes', () => {
  const heroStops = (theme) => [...(theme['--hero'].match(/#[0-9a-f]{6}/gi) || [])];
  for (const theme of [light, dark]) {
    const stops = heroStops(theme);
    assert.ok(stops.length >= 2);
    for (const stop of stops) assert.ok(contrast('#ffffff', stop) >= 4.5, `white on ${stop}`);
  }
});

test('accessibility: avatar colours carry white initials legibly', () => {
  for (let i = 1; i <= 6; i += 1) assert.ok(contrast('#ffffff', light[`--avatar-${i}`]) >= 3, `avatar-${i}`);
});

test('base styles respect reduced motion and keyboard focus', () => {
  const base = read('base.css');
  assert.match(base, /prefers-reduced-motion: reduce/);
  assert.match(base, /:focus-visible/);
  assert.match(base, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('layout has a phone layout and a desktop layout', () => {
  const layout = read('layout.css');
  assert.match(layout, /min-width:\s*960px/);
  assert.match(layout, /\.tabs/);
  assert.match(layout, /\.sidebar/);
});

test('speed: taps respond at once on phones (no tap delay, no grey flash, pressed feedback)', () => {
  const base = read('base.css');
  assert.match(base, /-webkit-tap-highlight-color:\s*transparent/);
  assert.match(base, /touch-action:\s*manipulation/);
  assert.match(read('components.css'), /\.btn:active\s*\{[^}]*background/);
  assert.match(read('layout.css'), /\.tab:active/);
});

test('speed: nothing on the scrolling page uses a blur filter, which janks scrolling on mid-range phones', () => {
  for (const file of readdirSync(STYLES).filter((f) => f.endsWith('.css'))) {
    assert.doesNotMatch(read(file), /backdrop-filter|filter:\s*blur/, file);
  }
});

test('speed: sheets open quickly (under 0.25s) and do not scroll the page behind them', () => {
  const css = read('components.css');
  const durations = [...css.matchAll(/animation:\s*(?:fade|rise)\s+([\d.]+)s/g)].map((m) => Number(m[1]));
  assert.ok(durations.length >= 2);
  assert.ok(durations.every((d) => d <= 0.25), `opening animations ${durations.join(', ')}s`);
  assert.match(css, /\.sheet\s*\{[^}]*overscroll-behavior:\s*contain/);
});

test('accessibility: the sign-in brand text is explicitly light because it sits on the gradient, not on a card', () => {
  const css = read('components.css');
  assert.match(css, /\.auth-brand\s*\{[^}]*color:\s*#fff/);
  assert.match(css, /\.auth-title\s*\{[^}]*color:\s*#fff/);
  assert.match(css, /\.auth-brand \.hint\s*\{[^}]*color:\s*#fff/);
});

/* ---------- spacing and overflow rules (each pins a bug found in the layout audit) ---------- */

const components = () => read('components.css');
const rule = (css, selector) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

test('every card has one vertical rhythm: blocks after the first are separated', () => {
  assert.match(components(), /\.card > :not\(\.card-head\) \+ :not\(\.card-head\)\s*\{\s*margin-top:\s*14px/);
});

test('grid children may shrink, so long names and big numbers cannot stretch a column off screen', () => {
  assert.match(components(), /\.content > \*,\s*\.grid-2 > \*,[^{]*\{\s*min-width:\s*0/);
  assert.match(rule(components(), '.card'), /min-width:\s*0/);
});

test('day headings get their spacing from the wrapper (the heading is its own wrapper\'s first child)', () => {
  const css = components();
  assert.doesNotMatch(rule(css, '.date-head'), /margin:\s*18px/);
  assert.match(css, /\.card > \.day \+ \.day\s*\{\s*margin-top:\s*18px/);
  assert.doesNotMatch(css, /\.date-head:first-child/);
});

test('calculation rows keep the sign inline with the label (it used to be a grid and stacked above)', () => {
  const css = components();
  assert.match(rule(css, '.calc-row > span'), /display:\s*block/);
  assert.doesNotMatch(rule(css, '.calc-row > span'), /display:\s*grid/);
  assert.match(rule(css, '.calc-row > strong'), /white-space:\s*nowrap/);
});

test('entry rows put the buttons on their own line on phones and back inline on wider screens', () => {
  const css = components();
  assert.match(rule(css, '.entry'), /display:\s*grid/);
  assert.match(rule(css, '.entry .item-actions'), /grid-column:\s*2 \/ -1/);
  assert.match(rule(css, '.entry .item-sub'), /-webkit-line-clamp:\s*2/);
  assert.match(css, /@media \(min-width: 640px\)\s*\{[^@]*\.entry\s*\{\s*display:\s*flex/);
});

test('money tiles and amounts never wrap mid-number', () => {
  const css = components();
  assert.match(rule(css, '.loan-fact strong'), /white-space:\s*nowrap/);
  assert.match(rule(css, '.item-amount'), /white-space:\s*nowrap/);
  assert.match(css, /\.table td\.num\s*\{\s*white-space:\s*nowrap/);
});

test('inline forms let the input shrink and keep the button on one line', () => {
  const css = components();
  assert.match(css, /\.inline-form > \.money-input,\s*\.inline-form > input\s*\{[^}]*min-width:\s*0/);
  assert.match(rule(css, '.inline-form > .btn'), /white-space:\s*nowrap/);
});

test('long person names are truncated in filters and wrap in tables, never stretching the row', () => {
  const css = components();
  assert.match(rule(css, '.seg-label'), /text-overflow:\s*ellipsis/);
  assert.match(rule(css, '.seg-label'), /max-width:\s*11rem/);
  assert.match(rule(css, '.person-name'), /overflow-wrap:\s*break-word/);
  assert.match(rule(css, '.table-wrap'), /overflow-x:\s*auto/);
});

test('the summary card has a small-phone layout (below 360px it stacks instead of squeezing)', () => {
  const css = components();
  const narrow = css.match(/@media \(max-width: 359px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(narrow, /\.hero-pair\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(narrow, /\.hero-stats\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.hero-pair\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.hero-stats\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
});

test('every stylesheet rule block is balanced (no stray or missing braces)', () => {
  for (const file of readdirSync(STYLES).filter((f) => f.endsWith('.css'))) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, file);
  }
});
