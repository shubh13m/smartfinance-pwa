import test, { beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createMemoryAdapter } from '../../src/data/adapters/memoryAdapter.js';
import { createIdbAdapter } from '../../src/data/adapters/idbAdapter.js';
import { TABLES } from '../../src/config/constants.js';

const factories = {
  memory: () => createMemoryAdapter(),
  indexeddb: () => { globalThis.indexedDB = new IDBFactory(); return createIdbAdapter(); },
};

for (const [name, make] of Object.entries(factories)) {
  describe(`adapter contract: ${name}`, () => {
    let adapter;
    beforeEach(() => { adapter = make(); });

    test('insert assigns id and timestamps and keeps supplied fields', async () => {
      const row = await adapter.insert('transactions', { household_id: 'h1', amount_paise: 5 });
      assert.match(row.id, /^[0-9a-f-]{36}$/);
      assert.ok(row.created_at && row.updated_at);
      assert.equal(row.amount_paise, 5);
    });

    test('insert honours a caller supplied id', async () => {
      const row = await adapter.insert('goals', { id: 'fixed-id', household_id: 'h1' });
      assert.equal(row.id, 'fixed-id');
    });

    test('list returns only the requested household', async () => {
      await adapter.insert('transactions', { household_id: 'h1', n: 1 });
      await adapter.insert('transactions', { household_id: 'h2', n: 2 });
      const rows = await adapter.list('transactions', { householdId: 'h1' });
      assert.deepEqual(rows.map((r) => r.n), [1]);
    });

    test('list filters by where clauses and combines them', async () => {
      await adapter.insert('goal_contributions', { household_id: 'h1', goal_id: 'a', n: 1 });
      await adapter.insert('goal_contributions', { household_id: 'h1', goal_id: 'b', n: 2 });
      await adapter.insert('goal_contributions', { household_id: 'h1', goal_id: 'a', n: 3 });
      const rows = await adapter.list('goal_contributions', { householdId: 'h1', where: { goal_id: 'a', n: 3 } });
      assert.deepEqual(rows.map((r) => r.n), [3]);
    });

    test('list on an empty table or without options returns an array', async () => {
      assert.deepEqual(await adapter.list('goals', { householdId: 'h1' }), []);
      await adapter.insert('goals', { household_id: 'h9' });
      assert.equal((await adapter.list('goals')).length, 1);
    });

    test('tables are independent of each other', async () => {
      await adapter.insert('goals', { household_id: 'h1' });
      assert.equal((await adapter.list('transactions', { householdId: 'h1' })).length, 0);
    });

    test('update merges the patch, keeps id and refreshes updated_at', async () => {
      const row = await adapter.insert('transactions', { household_id: 'h1', a: 1, b: 2 });
      await new Promise((r) => setTimeout(r, 5));
      const updated = await adapter.update('transactions', row.id, { b: 3, id: 'tampered' });
      assert.equal(updated.id, row.id);
      assert.deepEqual([updated.a, updated.b], [1, 3]);
      assert.ok(updated.updated_at > row.updated_at);
      const [stored] = await adapter.list('transactions', { householdId: 'h1' });
      assert.equal(stored.b, 3);
    });

    test('update of a missing row rejects', async () => {
      await assert.rejects(() => adapter.update('transactions', 'nope', { a: 1 }), /not found/);
    });

    test('remove deletes the row and tolerates a missing one', async () => {
      const row = await adapter.insert('goals', { household_id: 'h1' });
      await adapter.remove('goals', row.id);
      assert.equal((await adapter.list('goals', { householdId: 'h1' })).length, 0);
      await adapter.remove('goals', row.id);
    });

    test('subscribe notifies for matching household and table only', async () => {
      let calls = 0;
      adapter.subscribe('transactions', 'h1', () => { calls += 1; });
      await adapter.insert('transactions', { household_id: 'h1' });
      await adapter.insert('transactions', { household_id: 'h2' });
      await adapter.insert('goals', { household_id: 'h1' });
      assert.equal(calls, 1);
    });

    test('subscribe fires for update and remove, and unsubscribe stops it', async () => {
      let calls = 0;
      const off = adapter.subscribe('transactions', 'h1', () => { calls += 1; });
      const row = await adapter.insert('transactions', { household_id: 'h1' });
      await adapter.update('transactions', row.id, { x: 1 });
      await adapter.remove('transactions', row.id);
      assert.equal(calls, 3);
      off();
      await adapter.insert('transactions', { household_id: 'h1' });
      assert.equal(calls, 3);
    });

    test('every table the app uses can be written and read', async () => {
      for (const table of TABLES) {
        await adapter.insert(table, { household_id: 'h1', marker: table });
        const rows = await adapter.list(table, { householdId: 'h1' });
        assert.equal(rows[0].marker, table, table);
      }
    });
  });
}

test('memory adapter returns copies so callers cannot mutate stored rows', async () => {
  const adapter = createMemoryAdapter();
  const row = await adapter.insert('goals', { household_id: 'h1', name: 'a' });
  row.name = 'changed';
  const [stored] = await adapter.list('goals', { householdId: 'h1' });
  assert.equal(stored.name, 'a');
});

test('indexeddb adapter persists across adapter instances', async () => {
  globalThis.indexedDB = new IDBFactory();
  const first = createIdbAdapter();
  await first.insert('goals', { household_id: 'h1', name: 'kept' });
  const second = createIdbAdapter();
  const rows = await second.list('goals', { householdId: 'h1' });
  assert.equal(rows[0].name, 'kept');
});
