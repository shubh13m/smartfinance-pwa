import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, click } from '../helpers/dom.js';
import { clear, h, mount } from '../../src/core/dom.js';

installDom();
beforeEach(resetDom);

test('h: builds an element with class, attributes and text children', () => {
  const el = h('a', { class: 'link', href: '#/x', 'aria-label': 'Go' }, 'Hello ', 'world');
  assert.equal(el.tagName, 'A');
  assert.equal(el.className, 'link');
  assert.equal(el.getAttribute('href'), '#/x');
  assert.equal(el.getAttribute('aria-label'), 'Go');
  assert.equal(el.textContent, 'Hello world');
});

test('h: nested arrays, numbers and nodes are flattened; null/undefined/false are skipped', () => {
  const inner = h('b', null, 'B');
  const el = h('div', null, [1, [2, null, [3]]], undefined, false, inner, 0);
  assert.equal(el.textContent, '123B0');
  assert.equal(el.querySelector('b'), inner);
});

test('h: event handlers are attached and fire', () => {
  let clicks = 0;
  const btn = h('button', { onClick: () => { clicks += 1; } }, 'go');
  click(btn);
  click(btn);
  assert.equal(clicks, 2);
});

test('h: value, checked, disabled and selected are set as properties', () => {
  assert.equal(h('input', { value: 'abc' }).value, 'abc');
  assert.equal(h('input', { type: 'checkbox', checked: true }).checked, true);
  assert.equal(h('button', { disabled: true }).disabled, true);
  assert.equal(h('input', { value: 0 }).value, '0');
});

test('h: false/null/undefined props are omitted; true becomes an empty attribute', () => {
  const el = h('input', { required: true, hidden: false, title: null, 'data-x': undefined });
  assert.equal(el.hasAttribute('required'), true);
  assert.equal(el.hasAttribute('hidden'), false);
  assert.equal(el.hasAttribute('title'), false);
  assert.equal(el.hasAttribute('data-x'), false);
});

test('h: dataset props are applied', () => {
  assert.equal(h('div', { dataset: { bucket: 'needs' } }).dataset.bucket, 'needs');
});

test('XSS: text content is never parsed as HTML', () => {
  const payloads = ['<img src=x onerror=alert(1)>', '<script>window.pwned=1</script>', '"><svg onload=alert(1)>', '&lt;b&gt;'];
  for (const payload of payloads) {
    const el = h('div', null, payload);
    assert.equal(el.children.length, 0, payload);
    assert.equal(el.textContent, payload);
  }
  assert.equal(window.pwned, undefined);
});

test('XSS: attribute values are escaped, not interpreted', () => {
  const el = h('div', { title: '" onmouseover="alert(1)' });
  assert.equal(el.getAttribute('title'), '" onmouseover="alert(1)');
  assert.equal(el.hasAttribute('onmouseover'), false);
});

test('mount: appends children and skips null/false instead of printing "null"', () => {
  const container = document.createElement('div');
  mount(container, h('p', null, 'a'), null, undefined, false, [h('p', null, 'b'), null]);
  assert.equal(container.children.length, 2);
  assert.equal(container.textContent, 'ab');
  assert.doesNotMatch(container.textContent, /null|undefined|false/);
});

test('mount returns the container for chaining', () => {
  const container = document.createElement('div');
  assert.equal(mount(container, 'x'), container);
});

test('clear: removes all children and returns the element', () => {
  const el = h('div', null, h('p'), h('p'));
  assert.equal(clear(el), el);
  assert.equal(el.childNodes.length, 0);
});
