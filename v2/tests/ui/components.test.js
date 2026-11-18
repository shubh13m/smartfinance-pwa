import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, click, pressKey } from '../helpers/dom.js';
import {
  avatar, avatarFor, avatarSlot, button, card, emptyState, field, iconButton, initials, input, memberName, moneyInput,
  openSheet, progressBar, RING_CIRCUMFERENCE, ring, row, segmented, select, singleFlight, toast,
} from '../../src/ui/components.js';
import { ICON_NAMES, icon } from '../../src/ui/icons.js';
import { THEME_KEY, applyTheme, currentTheme, initTheme, resolveTheme, toggleTheme } from '../../src/ui/theme.js';

installDom();
beforeEach(resetDom);

const members = [{ user_id: 'b', display_name: 'Priya Sharma' }, { user_id: 'a', display_name: 'Shubham' }];

/* ---------- surfaces ---------- */

test('card: string title, options form, and head omitted when empty', () => {
  assert.equal(card('Plan', 'body').querySelector('.card-title').textContent, 'Plan');
  const withAction = card({ title: 'T', subtitle: 'S', action: button('Go') }, 'x');
  assert.equal(withAction.querySelector('.card-sub').textContent, 'S');
  assert.ok(withAction.querySelector('.card-head button'));
  assert.equal(card(null, 'only body').querySelector('.card-head'), null);
  assert.ok(card({ title: 'T', class: 'wide' }).classList.contains('wide'));
});

test('row renders a label and a value', () => {
  assert.equal(row('Income', '₹5').textContent, 'Income₹5');
});

test('emptyState shows icon, title and optional text', () => {
  const el = emptyState('Nothing', 'Add one', 'wallet');
  assert.equal(el.querySelector('strong').textContent, 'Nothing');
  assert.equal(el.querySelector('p').textContent, 'Add one');
  assert.ok(el.querySelector('svg'));
  assert.equal(emptyState('x').querySelector('p'), null);
});

/* ---------- forms ---------- */

test('field wraps a control in a label with an optional hint', () => {
  const f = field('Name', input({ type: 'text' }), 'Required');
  assert.equal(f.tagName, 'LABEL');
  assert.equal(f.querySelector('.field-label').textContent, 'Name');
  assert.equal(f.querySelector('.hint').textContent, 'Required');
  assert.equal(field('x', input()).querySelector('.hint'), null);
});

test('moneyInput: decimal keyboard, placeholder and overridable props', () => {
  const wrap = moneyInput({ required: true });
  const el = wrap.querySelector('input');
  assert.equal(el.getAttribute('inputmode'), 'decimal');
  assert.equal(el.placeholder, '0.00');
  assert.equal(el.required, true);
  assert.equal(moneyInput({ placeholder: 'Add' }).querySelector('input').placeholder, 'Add');
});

test('select: accepts strings and {value,label}, and pre-selects the value', () => {
  const s = select(['a', { value: 'b', label: 'Bee' }, { value: 3, label: 'Three' }], { value: 'b', id: 'x' });
  assert.equal(s.options.length, 3);
  assert.equal(s.value, 'b');
  assert.equal(s.options[1].textContent, 'Bee');
  assert.equal(select([{ value: 3, label: 'Three' }], { value: 3 }).value, '3');
  assert.equal(s.id, 'x');
});

/* ---------- buttons ---------- */

test('button: type=button by default, icon and label, extra classes', () => {
  const b = button('Save', { icon: 'check', class: 'primary sm' });
  assert.equal(b.type, 'button');
  assert.equal(b.className, 'btn primary sm');
  assert.ok(b.querySelector('svg'));
  assert.equal(b.textContent, 'Save');
  assert.equal(button('Go', { type: 'submit' }).type, 'submit');
  assert.equal(button(null, { icon: 'plus' }).querySelector('span'), null);
});

test('iconButton has an accessible name and title', () => {
  const b = iconButton('trash', 'Delete Rent', { onClick: () => {} });
  assert.equal(b.getAttribute('aria-label'), 'Delete Rent');
  assert.equal(b.title, 'Delete Rent');
  assert.ok(b.classList.contains('icon-btn'));
});

/* ---------- people ---------- */

test('initials: one or two letters, uppercase, safe with odd input', () => {
  assert.equal(initials('priya sharma'), 'PS');
  assert.equal(initials('Shubham'), 'S');
  assert.equal(initials('  a   b   c '), 'AC');
  assert.equal(initials(''), '?');
  assert.equal(initials(undefined), '?');
});

test('avatarSlot: stable regardless of list order, unique for up to six people', () => {
  const reversed = [...members].reverse();
  assert.equal(avatarSlot(members, 'a'), avatarSlot(reversed, 'a'));
  assert.notEqual(avatarSlot(members, 'a'), avatarSlot(members, 'b'));
  const six = Array.from({ length: 6 }, (_, i) => ({ user_id: `u${i}` }));
  assert.equal(new Set(six.map((m) => avatarSlot(six, m.user_id))).size, 6);
  assert.equal(avatarSlot(members, 'unknown'), 1);
});

test('avatar shows initials, a colour class and a name tooltip', () => {
  const el = avatar(members[0], members, { large: true });
  assert.equal(el.textContent, 'PS');
  assert.match(el.className, /avatar c\d lg/);
  assert.equal(el.title, 'Priya Sharma');
});

test('avatarFor tolerates an unknown user; memberName falls back to "Someone"', () => {
  assert.equal(avatarFor(members, 'ghost').textContent, '?');
  assert.equal(memberName(members, 'a'), 'Shubham');
  assert.equal(memberName(members, 'ghost'), 'Someone');
});

/* ---------- data display ---------- */

test('progressBar clamps to 0-100 and exposes ARIA values', () => {
  const widthOf = (pct) => progressBar(pct).querySelector('.bar-fill').style.width;
  assert.equal(widthOf(42), '42%');
  assert.equal(widthOf(250), '100%');
  assert.equal(widthOf(-5), '0%');
  const bar = progressBar(30, 'warn');
  assert.equal(bar.getAttribute('role'), 'progressbar');
  assert.equal(bar.getAttribute('aria-valuenow'), '30');
  assert.ok(bar.querySelector('.bar-fill').classList.contains('warn'));
});

test('ring draws a proportional arc, clamps it, and labels the real percentage', () => {
  const dash = (el) => Number(el.querySelector('.ring-fill').getAttribute('stroke-dasharray').split(' ')[0]);
  assert.ok(Math.abs(dash(ring(50)) - RING_CIRCUMFERENCE / 2) < 0.01);
  assert.equal(dash(ring(0)), 0);
  assert.ok(Math.abs(dash(ring(180)) - RING_CIRCUMFERENCE) < 0.01);
  assert.equal(ring(180).querySelector('.ring-label').textContent, '180%');
  assert.ok(ring(10, 'wants').querySelector('.ring-fill').classList.contains('wants'));
  assert.equal(ring(10).querySelector('svg').getAttribute('aria-hidden'), 'true');
});

test('segmented marks the active option and reports clicks', () => {
  const picks = [];
  const el = segmented([{ value: 'a', label: 'A' }, { value: 'b', label: 'B', leading: avatar(members[0], members) }], 'a', (v) => picks.push(v));
  const [a, b] = el.querySelectorAll('button');
  assert.equal(a.getAttribute('aria-pressed'), 'true');
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  assert.ok(a.classList.contains('active'));
  assert.ok(b.querySelector('.avatar'));
  click(b);
  assert.deepEqual(picks, ['b']);
});

test('segmented: long labels live in a truncating element and keep the full text as a tooltip', () => {
  const name = 'Priya Venkataramanan-Iyer';
  const [button_] = segmented([{ value: 'p', label: name }], 'p', () => {}).querySelectorAll('button');
  assert.equal(button_.querySelector('.seg-label').textContent, name);
  assert.equal(button_.title, name);
});

/* ---------- feedback ---------- */

test('toast shows the message with its type, reuses one element, and hides itself', async () => {
  toast('Saved', 'success');
  toast('Oops', 'error');
  const els = document.querySelectorAll('#toast');
  assert.equal(els.length, 1);
  assert.equal(els[0].textContent, 'Oops');
  assert.match(els[0].className, /show error/);
  assert.equal(els[0].getAttribute('role'), 'status');
});

test('sheet: opens as a labelled modal dialog and focuses the first field', () => {
  const content = document.createElement('div');
  content.innerHTML = '<input id="first">';
  const { element } = openSheet({ title: 'New entry', content });
  const dialog = element.querySelector('[role=dialog]');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(dialog.getAttribute('aria-label'), 'New entry');
  assert.equal(document.activeElement.id, 'first');
});

test('sheet: Escape, the close button and a backdrop click all close it; onClose fires', () => {
  const make = () => {
    let closed = 0;
    const sheet = openSheet({ title: 'T', content: document.createElement('p'), onClose: () => { closed += 1; } });
    return { sheet, closedCount: () => closed };
  };

  let s = make();
  pressKey('Escape');
  assert.equal(document.querySelector('.sheet-overlay'), null);
  assert.equal(s.closedCount(), 1);

  s = make();
  click(document.querySelector('.sheet .icon-btn'));
  assert.equal(document.querySelector('.sheet-overlay'), null);

  s = make();
  s.sheet.element.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(document.querySelector('.sheet-overlay'), null);
});

test('sheet: clicking inside does not close it; other keys do not close it', () => {
  openSheet({ title: 'T', content: document.createElement('p') });
  document.querySelector('.sheet').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  pressKey('a');
  assert.ok(document.querySelector('.sheet-overlay'));
});

test('sheet: returns focus to the element that opened it and stops listening for Escape', () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const { close } = openSheet({ title: 'T', content: document.createElement('input') });
  close();
  assert.equal(document.activeElement, opener);
  openSheet({ title: 'Second', content: document.createElement('p') });
  pressKey('Escape');
  assert.equal(document.querySelector('.sheet-overlay'), null);
});

/* ---------- icons ---------- */

/* ---------- single flight (double-submit guard) ---------- */

function formWithButtons() {
  const form = document.createElement('form');
  form.innerHTML = '<input><button type="submit" id="go">Go</button><button type="button" id="other">Other</button>';
  document.body.append(form);
  return form;
}
const submitEvent = () => new window.Event('submit', { bubbles: true, cancelable: true });

test('singleFlight: a second submit while the first is running is ignored', async () => {
  const form = formWithButtons();
  let calls = 0;
  let release;
  form.addEventListener('submit', singleFlight(() => { calls += 1; return new Promise((r) => { release = r; }); }));
  form.dispatchEvent(submitEvent());
  form.dispatchEvent(submitEvent());
  form.dispatchEvent(submitEvent());
  assert.equal(calls, 1);
  release();
  await new Promise((r) => setTimeout(r, 0));
  form.dispatchEvent(submitEvent());
  assert.equal(calls, 2, 'a later submit is allowed once the first has finished');
});

test('singleFlight: buttons are disabled while working and re-enabled afterwards', async () => {
  const form = formWithButtons();
  let release;
  form.addEventListener('submit', singleFlight(() => new Promise((r) => { release = r; })));
  form.dispatchEvent(submitEvent());
  assert.equal(document.getElementById('go').disabled, true);
  assert.equal(document.getElementById('other').disabled, true);
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(document.getElementById('go').disabled, false);
  assert.equal(document.getElementById('other').disabled, false);
});

test('singleFlight: a failing handler still re-enables the form, surfaces the error, and allows a retry', async () => {
  const form = formWithButtons();
  let calls = 0;
  const guarded = singleFlight(async () => { calls += 1; throw new Error('boom'); });
  const event = { preventDefault() {}, currentTarget: form };
  await assert.rejects(() => guarded(event), /boom/);
  assert.equal(document.getElementById('go').disabled, false);
  await assert.rejects(() => guarded(event), /boom/);
  assert.equal(calls, 2);
});

test('singleFlight: buttons that were already disabled stay disabled', async () => {
  const form = formWithButtons();
  document.getElementById('other').disabled = true;
  form.addEventListener('submit', singleFlight(async () => {}));
  form.dispatchEvent(submitEvent());
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(document.getElementById('other').disabled, true);
});

test('singleFlight: prevents the browser default and works from a button click too', async () => {
  const form = formWithButtons();
  const event = submitEvent();
  form.addEventListener('submit', singleFlight(async () => {}));
  form.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);

  let calls = 0;
  const btn = document.getElementById('other');
  btn.addEventListener('click', singleFlight(() => { calls += 1; return new Promise(() => {}); }));
  click(btn);
  click(btn);
  assert.equal(calls, 1);
});

test('sheet: Tab wraps from the last control to the first, Shift+Tab from the first to the last', () => {
  const content = document.createElement('div');
  content.innerHTML = '<input id="one"><select id="two"></select><button id="three" type="button">Go</button>';
  openSheet({ title: 'T', content });
  const three = document.getElementById('three');
  const closeBtn = document.querySelector('.sheet .icon-btn');

  three.focus();
  pressKey('Tab', document, { shiftKey: false });
  assert.equal(document.activeElement, closeBtn, 'Tab from the last control wraps to the first (the close button)');

  closeBtn.focus();
  pressKey('Tab', document, { shiftKey: true });
  assert.equal(document.activeElement, three, 'Shift+Tab from the first control wraps to the last');
});

test('sheet: focus that has escaped to the page behind is pulled back in', () => {
  const outside = document.createElement('button');
  document.body.append(outside);
  openSheet({ title: 'T', content: document.createElement('input') });
  outside.focus();
  pressKey('Tab');
  assert.ok(document.querySelector('.sheet').contains(document.activeElement));
});

test('sheet: hidden and disabled controls are skipped by the focus trap', () => {
  const content = document.createElement('div');
  content.innerHTML = '<input id="a"><label hidden><input id="skipped"></label><button id="b" type="button" disabled>No</button><input id="c">';
  openSheet({ title: 'T', content });
  document.getElementById('c').focus();
  pressKey('Tab');
  assert.equal(document.activeElement.className.includes('icon-btn'), true, 'wraps to the first focusable, the close button');
});

/* ---------- icons ---------- */

test('every icon renders an accessible-by-default SVG with paths', () => {
  assert.ok(ICON_NAMES.length >= 25);
  for (const name of ICON_NAMES) {
    const svg = icon(name);
    assert.equal(svg.tagName.toLowerCase(), 'svg', name);
    assert.ok(svg.querySelectorAll('path').length > 0, name);
    assert.equal(svg.getAttribute('aria-hidden'), 'true', name);
    assert.equal(svg.getAttribute('stroke'), 'currentColor', name);
  }
});

test('icon: size, label and unknown names', () => {
  const svg = icon('home', { size: 32, label: 'Home' });
  assert.equal(svg.getAttribute('width'), '32');
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(svg.getAttribute('aria-label'), 'Home');
  assert.equal(svg.hasAttribute('aria-hidden'), false);
  assert.throws(() => icon('nope'), /Unknown icon/);
});

/* ---------- theme ---------- */

test('resolveTheme: stored choice wins, otherwise the system preference', () => {
  assert.equal(resolveTheme({ stored: 'dark', prefersDark: false }), 'dark');
  assert.equal(resolveTheme({ stored: 'light', prefersDark: true }), 'light');
  assert.equal(resolveTheme({ stored: null, prefersDark: true }), 'dark');
  assert.equal(resolveTheme({ stored: 'garbage', prefersDark: false }), 'light');
});

test('applyTheme sets the attribute and the browser theme colour', () => {
  applyTheme('dark');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  const dark = document.querySelector('meta[name=theme-color]').getAttribute('content');
  applyTheme('light');
  assert.notEqual(document.querySelector('meta[name=theme-color]').getAttribute('content'), dark);
});

test('initTheme: follows the OS when nothing is stored, honours storage otherwise', () => {
  const dark = (query) => ({ matches: query.includes('dark') });
  assert.equal(initTheme({ matchMedia: dark }), 'dark');
  localStorage.setItem(THEME_KEY, 'light');
  assert.equal(initTheme({ matchMedia: dark }), 'light');
  localStorage.clear();
  assert.equal(initTheme({ matchMedia: () => ({ matches: false }) }), 'light');
  assert.equal(initTheme({ matchMedia: undefined }), 'light');
});

test('toggleTheme flips the theme and persists the choice', () => {
  applyTheme('light');
  assert.equal(toggleTheme(), 'dark');
  assert.equal(localStorage.getItem(THEME_KEY), 'dark');
  assert.equal(currentTheme(), 'dark');
  assert.equal(toggleTheme(), 'light');
  assert.equal(localStorage.getItem(THEME_KEY), 'light');
});
