import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataCache, isPatchable } from '../../src/services/dataCache.js';

const empty = () => ({ members: [], transactions: [], recurring: [], goals: [], contributions: [], loans: [], split: { needs: 50, wants: 30, savings: 20 } });
const tx = (id, extra = {}) => ({ id, amount_paise: 100, category: 'Food', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...extra });
const cacheWith = (data = {}) => createDataCache({ ...empty(), ...data });

test('cache: knows which tables it can patch', () => {
  for (const table of ['transactions', 'recurring_items', 'goals', 'goal_contributions', 'loans', 'budget_settings']) assert.equal(isPatchable(table), true);
  assert.equal(isPatchable('household_members'), false, 'members need a re-read (dedupe, left_at, invite code)');
  assert.equal(isPatchable(undefined), false);
});

test('cache: a new row is added, a repeated one is not duplicated', () => {
  const cache = cacheWith();
  assert.equal(cache.apply({ table: 'transactions', type: 'upsert', row: tx('a') }), true);
  assert.equal(cache.apply({ table: 'transactions', type: 'upsert', row: tx('a') }), false, 'an echo of the same row changes nothing');
  assert.equal(cache.get().transactions.length, 1);
});

test('cache: data is replaced, never mutated, so views holding the old data are safe', () => {
  const cache = cacheWith();
  const before = cache.get();
  cache.apply({ table: 'transactions', type: 'upsert', row: tx('a') });
  assert.equal(before.transactions.length, 0);
  assert.notEqual(cache.get(), before);
});

test('cache: a change to what is shown asks for a repaint; a change only to timestamps does not', () => {
  const cache = cacheWith({ transactions: [tx('a')] });
  assert.equal(cache.apply({ table: 'transactions', type: 'upsert', row: tx('a', { updated_at: '2026-01-02T00:00:00Z' }) }), false);
  assert.equal(cache.get().transactions[0].updated_at, '2026-01-02T00:00:00Z', 'the newer timestamp is still kept');
  assert.equal(cache.apply({ table: 'transactions', type: 'upsert', row: tx('a', { amount_paise: 999, updated_at: '2026-01-03T00:00:00Z' }) }), true);
  assert.equal(cache.get().transactions[0].amount_paise, 999);
});

test('cache: a slow, older echo cannot undo a newer version', () => {
  const cache = cacheWith({ transactions: [tx('a', { amount_paise: 500, updated_at: '2026-01-05T00:00:00Z' })] });
  assert.equal(cache.apply({ table: 'transactions', type: 'upsert', row: tx('a', { amount_paise: 100, updated_at: '2026-01-01T00:00:00Z' }) }), false);
  assert.equal(cache.get().transactions[0].amount_paise, 500);
});

test('cache: the server\'s own answer always wins, even if this phone\'s clock ran ahead', () => {
  const cache = cacheWith();
  cache.apply({ table: 'transactions', type: 'upsert', row: tx('a', { updated_at: '2030-01-01T00:00:00Z' }) });
  cache.apply({ table: 'transactions', type: 'confirm', row: tx('a', { updated_at: '2026-01-01T00:00:00Z' }) });
  assert.equal(cache.get().transactions[0].updated_at, '2026-01-01T00:00:00Z');
  assert.equal(cache.apply({ table: 'transactions', type: 'upsert', row: tx('a', { amount_paise: 42, updated_at: '2026-02-01T00:00:00Z' }) }), true, 'a later edit by the other person is not ignored');
});

test('cache: a local patch changes only the given fields and ignores rows it does not have', () => {
  const cache = cacheWith({ transactions: [tx('a')] });
  assert.equal(cache.apply({ table: 'transactions', type: 'patch', row: { id: 'a', category: 'Fuel' } }), true);
  assert.deepEqual([cache.get().transactions[0].category, cache.get().transactions[0].amount_paise], ['Fuel', 100]);
  assert.equal(cache.apply({ table: 'transactions', type: 'patch', row: { id: 'zzz', category: 'Fuel' } }), false);
  assert.equal(cache.apply({ table: 'transactions', type: 'patch', row: { id: 'a', category: 'Fuel' } }), false, 'patching to the same value is not a change');
});

test('cache: a delete removes the row, and a late echo cannot bring it back', () => {
  const cache = cacheWith({ transactions: [tx('a'), tx('b')] });
  assert.equal(cache.apply({ table: 'transactions', type: 'delete', row: { id: 'a' } }), true);
  assert.deepEqual(cache.get().transactions.map((t) => t.id), ['b']);
  assert.equal(cache.apply({ table: 'transactions', type: 'upsert', row: tx('a') }), false, 'the echo of its own insert arrives after the delete');
  assert.equal(cache.apply({ table: 'transactions', type: 'patch', row: { id: 'a', category: 'x' } }), false);
  assert.deepEqual(cache.get().transactions.map((t) => t.id), ['b']);
});

test('cache: deleting something it never had is a quiet no-op', () => {
  const cache = cacheWith({ transactions: [tx('a')] });
  assert.equal(cache.apply({ table: 'transactions', type: 'delete', row: { id: 'someone-elses' } }), false);
  assert.equal(cache.get().transactions.length, 1);
});

test('cache: a deleted id may be reused after the tombstone expires', () => {
  let now = 0;
  const cache = createDataCache(empty(), () => now);
  cache.apply({ table: 'transactions', type: 'delete', row: { id: 'a' } });
  now = 61_000;
  assert.equal(cache.apply({ table: 'transactions', type: 'upsert', row: tx('a') }), true);
});

test('cache: deleting a goal also drops its contributions, as the database does', () => {
  const cache = cacheWith({
    goals: [{ id: 'g1', name: 'Trip' }, { id: 'g2', name: 'Car' }],
    contributions: [{ id: 'c1', goal_id: 'g1' }, { id: 'c2', goal_id: 'g2' }],
  });
  assert.equal(cache.apply({ table: 'goals', type: 'delete', row: { id: 'g1' } }), true);
  assert.deepEqual(cache.get().goals.map((g) => g.id), ['g2']);
  assert.deepEqual(cache.get().contributions.map((c) => c.id), ['c2']);
});

test('cache: each table lands in its own collection', () => {
  const cache = cacheWith();
  const row = (id) => ({ id, updated_at: '2026-01-01T00:00:00Z' });
  const map = { transactions: 'transactions', recurring_items: 'recurring', goals: 'goals', goal_contributions: 'contributions', loans: 'loans' };
  for (const [table, key] of Object.entries(map)) {
    cache.apply({ table, type: 'upsert', row: row(`${table}-1`) });
    assert.deepEqual(cache.get()[key].map((r) => r.id), [`${table}-1`]);
  }
});

test('cache: the 50/30/20 plan updates from a settings row, and ignores partial or deleted ones', () => {
  const cache = cacheWith();
  assert.equal(cache.apply({ table: 'budget_settings', type: 'upsert', row: { id: 's', needs_pct: 60, wants_pct: 20, savings_pct: 20 } }), true);
  assert.deepEqual(cache.get().split, { needs: 60, wants: 20, savings: 20 });
  assert.equal(cache.apply({ table: 'budget_settings', type: 'upsert', row: { id: 's', needs_pct: 60, wants_pct: 20, savings_pct: 20 } }), false);
  assert.equal(cache.apply({ table: 'budget_settings', type: 'upsert', row: { id: 's', note: 'no percentages' } }), false);
  assert.equal(cache.apply({ table: 'budget_settings', type: 'delete', row: { id: 's' } }), false);
  assert.deepEqual(cache.get().split, { needs: 60, wants: 20, savings: 20 });
});

test('cache: before anything is loaded, or for unknown tables, nothing happens', () => {
  assert.equal(createDataCache().apply({ table: 'transactions', type: 'upsert', row: tx('a') }), false);
  assert.equal(cacheWith().apply({ table: 'households', type: 'upsert', row: { id: 'h' } }), false);
  assert.equal(cacheWith().apply({ table: 'transactions', type: 'upsert', row: null }), false);
});

test('cache: replace swaps in freshly loaded data', () => {
  const cache = cacheWith({ transactions: [tx('a')] });
  const fresh = { ...empty(), transactions: [tx('z')] };
  cache.replace(fresh);
  assert.equal(cache.get(), fresh);
});
