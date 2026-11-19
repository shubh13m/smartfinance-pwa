import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAdapter } from '../../src/data/adapters/supabaseAdapter.js';

/** A recording stand-in for a supabase-js query builder. */
function fakeClient({ result = { data: [], error: null } } = {}) {
  const log = [];
  const channels = [];
  const builder = (table) => {
    const call = { table, steps: [] };
    log.push(call);
    const api = new Proxy({}, {
      get(_, method) {
        if (method === 'then') return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
        return (...args) => { call.steps.push([method, ...args]); return api; };
      },
    });
    return api;
  };
  return {
    log,
    channels,
    removed: [],
    from: builder,
    channel(name) {
      const ch = { name, handlers: [], subscribed: false };
      ch.on = (type, opts, cb) => { ch.handlers.push({ type, opts, cb }); return ch; };
      ch.subscribe = () => { ch.subscribed = true; return ch; };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) { this.removed.push(ch); },
  };
}

test('list selects all columns, scoped to the household and extra filters', async () => {
  const client = fakeClient({ result: { data: [{ id: 1 }], error: null } });
  const rows = await createSupabaseAdapter(client).list('transactions', { householdId: 'h1', where: { goal_id: 'g' } });
  assert.deepEqual(rows, [{ id: 1 }]);
  assert.deepEqual(client.log[0].steps, [['select', '*'], ['eq', 'household_id', 'h1'], ['eq', 'goal_id', 'g']]);
});

test('list without a household does not add a household filter', async () => {
  const client = fakeClient();
  await createSupabaseAdapter(client).list('goals');
  assert.deepEqual(client.log[0].steps, [['select', '*']]);
});

test('insert sends the row and returns the single created row', async () => {
  const client = fakeClient({ result: { data: { id: 'new' }, error: null } });
  const row = await createSupabaseAdapter(client).insert('goals', { name: 'x' });
  assert.deepEqual(row, { id: 'new' });
  assert.deepEqual(client.log[0].steps, [['insert', { name: 'x' }], ['select'], ['single']]);
});

test('update targets a row by id and returns it', async () => {
  const client = fakeClient({ result: { data: { id: 'a', n: 2 }, error: null } });
  const row = await createSupabaseAdapter(client).update('goals', 'a', { n: 2 });
  assert.equal(row.n, 2);
  assert.deepEqual(client.log[0].steps, [['update', { n: 2 }], ['eq', 'id', 'a'], ['select'], ['single']]);
});

test('remove deletes by id', async () => {
  const client = fakeClient({ result: { data: null, error: null } });
  await createSupabaseAdapter(client).remove('goals', 'a');
  assert.deepEqual(client.log[0].steps, [['delete'], ['eq', 'id', 'a']]);
});

test('database errors surface as thrown errors with the server message', async () => {
  const client = fakeClient({ result: { data: null, error: { message: 'row-level security violated' } } });
  const adapter = createSupabaseAdapter(client);
  await assert.rejects(() => adapter.list('goals', { householdId: 'h' }), /row-level security violated/);
  await assert.rejects(() => adapter.insert('goals', {}), /row-level security violated/);
  await assert.rejects(() => adapter.update('goals', 'a', {}), /row-level security violated/);
  await assert.rejects(() => adapter.remove('goals', 'a'), /row-level security violated/);
});

test('subscribe sends changed rows to the callback, filters inserts/updates by household, and cleans up', () => {
  const client = fakeClient();
  const seen = [];
  const off = createSupabaseAdapter(client).subscribe('transactions', 'h1', (change) => seen.push(change));
  const [channel] = client.channels;
  assert.equal(channel.subscribed, true);
  const scoped = { schema: 'public', table: 'transactions', filter: 'household_id=eq.h1' };
  assert.deepEqual(channel.handlers.map((h) => h.opts), [
    { event: 'INSERT', ...scoped },
    { event: 'UPDATE', ...scoped },
    { event: 'DELETE', schema: 'public', table: 'transactions' },
  ]);
  const [insert, update, remove] = channel.handlers.map((h) => h.cb);
  insert({ new: { id: 'a' } });
  update({ new: { id: 'a', n: 2 } });
  remove({ old: { id: 'a' } });
  assert.deepEqual(seen, [
    { type: 'upsert', row: { id: 'a' } },
    { type: 'upsert', row: { id: 'a', n: 2 } },
    { type: 'delete', row: { id: 'a' } },
  ]);
  off();
  assert.equal(client.removed[0], channel);
});

test('subscribe asks for a re-read after the connection comes back, but not on the first connect', () => {
  const client = fakeClient();
  const seen = [];
  let onStatus;
  client.channel = (name) => {
    const ch = { name, handlers: [] };
    ch.on = () => ch;
    ch.subscribe = (cb) => { onStatus = cb; return ch; };
    return ch;
  };
  createSupabaseAdapter(client).subscribe('goals', 'h1', (change) => seen.push(change));
  onStatus('SUBSCRIBED');
  assert.deepEqual(seen, []);
  onStatus('CHANNEL_ERROR');
  onStatus('SUBSCRIBED');
  assert.deepEqual(seen, [{ type: 'resync' }]);
});
