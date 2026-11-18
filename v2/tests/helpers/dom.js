import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

const GLOBALS = [
  'window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'Event',
  'KeyboardEvent', 'MouseEvent', 'SubmitEvent', 'localStorage', 'location', 'matchMedia', 'confirm', 'alert',
];

let current;

/**
 * Installs a jsdom window as the global environment so UI modules can run in Node.
 * Call once per test file; use resetDom() in beforeEach for a clean page.
 */
export function installDom({ url = 'http://localhost/v2/' } = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta name="theme-color" content="#4f46e5"></head><body><div id="app"></div></body></html>',
    { url, pretendToBeVisual: true },
  );
  const { window } = dom;
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  window.confirm = () => true;
  window.alert = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};

  for (const name of GLOBALS) {
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true });
  }
  current = { dom, window };
  return current;
}

export function resetDom() {
  const { window } = current;
  window.document.body.innerHTML = '<div id="app"></div>';
  window.document.documentElement.removeAttribute('data-theme');
  window.localStorage.clear();
  window.location.hash = '';
  window.confirm = () => true;
  globalThis.confirm = window.confirm;
  globalThis.indexedDB = new IDBFactory();
}

export function setConfirm(answer) {
  const fn = typeof answer === 'function' ? answer : () => answer;
  current.window.confirm = fn;
  globalThis.confirm = fn;
}

export const root = () => document.getElementById('app');

/* ---------- small DOM driving helpers ---------- */

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

export async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) await tick(5);
}

export function text(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

export function byText(selector, content, scope = document) {
  return [...scope.querySelectorAll(selector)].find((el) => text(el).includes(content)) || null;
}

export function buttonByText(content, scope = document) {
  return byText('button', content, scope);
}

export function labelled(labelText, scope = document) {
  const label = [...scope.querySelectorAll('label')].find((l) => text(l.querySelector('.field-label') || l).startsWith(labelText));
  return label?.querySelector('input, select, textarea') || null;
}

export function type(el, value) {
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

export function click(el) {
  if (!el) throw new Error('click(): element not found');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

export function submit(form) {
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

export function pressKey(key, target = document, init = {}) {
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}
