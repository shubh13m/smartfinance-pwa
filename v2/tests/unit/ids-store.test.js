import test from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '../../src/core/ids.js';
import { createStore } from '../../src/core/store.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('newId returns unique RFC 4122 v4 ids', () => {
  const ids = new Set(Array.from({ length: 500 }, newId));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, UUID_V4);
});

test('newId falls back to getRandomValues when randomUUID is unavailable', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: (bytes) => real.getRandomValues(bytes) },
  });
  try {
    const id = newId();
    assert.match(id, UUID_V4);
    assert.notEqual(newId(), id);
  } finally {
    Object.defineProperty(globalThis, 'crypto', original);
  }
});

test('store: get/set merges patches and notifies subscribers', () => {
  const store = createStore({ a: 1, b: 2 });
  const seen = [];
  store.subscribe((state) => seen.push(state));
  store.set({ b: 3 });
  assert.deepEqual(store.get(), { a: 1, b: 3 });
  assert.deepEqual(seen, [{ a: 1, b: 3 }]);
});

test('store: unsubscribe stops notifications; multiple subscribers all fire', () => {
  const store = createStore({ n: 0 });
  let first = 0;
  let second = 0;
  const off = store.subscribe(() => { first += 1; });
  store.subscribe(() => { second += 1; });
  store.set({ n: 1 });
  off();
  store.set({ n: 2 });
  assert.equal(first, 1);
  assert.equal(second, 2);
});

test('store: state objects are replaced, not mutated', () => {
  const store = createStore({ n: 0 });
  const before = store.get();
  store.set({ n: 1 });
  assert.equal(before.n, 0);
  assert.notEqual(store.get(), before);
});
