import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryAdapter } from '../../src/data/adapters/memoryAdapter.js';
import { createLedger, ValidationError } from '../../src/services/ledger.js';

const sessionFor = (userId, householdId = 'h1') => ({ userId, householdId });
const expense = { kind: 'expense', amount_paise: 25000, category: 'Groceries', bucket: 'needs', occurred_on: '2026-03-05', note: '' };
const income = { kind: 'income', amount_paise: 900000, category: 'Salary', occurred_on: '2026-03-01', note: '' };
const monthlyRec = { kind: 'expense', name: 'Rent', amount_paise: 1000000, frequency: 'monthly', start_on: '2026-01-01', category: 'Housing', bucket: 'needs' };

const pair = () => {
  const adapter = createMemoryAdapter();
  return { adapter, me: createLedger({ adapter, session: sessionFor('me') }), wife: createLedger({ adapter, session: sessionFor('wife') }) };
};

test('two people share one household ledger and see each other\'s entries', async () => {
  const { me, wife } = pair();
  await me.addTransaction(expense);
  await wife.addTransaction({ ...expense, amount_paise: 1000 });
  const seen = await wife.loadAll();
  assert.equal(seen.transactions.length, 2);
  assert.deepEqual(seen.transactions.map((t) => t.created_by).sort(), ['me', 'wife']);
});

test('rows are stamped with the household and the creator, ignoring forged values', async () => {
  const { me } = pair();
  const row = await me.addTransaction({ ...expense, household_id: 'evil', created_by: 'someone-else' });
  assert.equal(row.household_id, 'h1');
  assert.equal(row.created_by, 'me');
});

test('another household never sees the data', async () => {
  const adapter = createMemoryAdapter();
  const mine = createLedger({ adapter, session: sessionFor('me', 'h1') });
  await mine.addTransaction(expense);
  await mine.addRecurring(monthlyRec);
  await mine.addGoal({ name: 'Trip', target_paise: 5000, deadline: null });
  const stranger = await createLedger({ adapter, session: sessionFor('x', 'h2') }).loadAll();
  assert.deepEqual([stranger.transactions.length, stranger.recurring.length, stranger.goals.length], [0, 0, 0]);
});

test('invalid input is rejected with a ValidationError before reaching storage', async () => {
  const { me } = pair();
  await assert.rejects(() => me.addTransaction({ ...expense, amount_paise: -5 }), (e) => e instanceof ValidationError && e.errors.length >= 1);
  await assert.rejects(() => me.addRecurring({ ...monthlyRec, frequency: 'weekly' }), ValidationError);
  await assert.rejects(() => me.addGoal({ name: '', target_paise: 1 }), ValidationError);
  await assert.rejects(() => me.addContribution({ goal_id: '', amount_paise: 1, contributed_on: '2026-01-01' }), ValidationError);
  await assert.rejects(() => me.updateTransaction('x', { ...expense, category: '' }), ValidationError);
  const all = await me.loadAll();
  assert.equal(all.transactions.length + all.recurring.length + all.goals.length, 0);
});

test('ValidationError rejects as a promise rather than throwing synchronously', () => {
  const { me } = pair();
  let thrown = false;
  let promise;
  try { promise = me.addTransaction({ ...expense, amount_paise: 0 }); } catch { thrown = true; }
  assert.equal(thrown, false);
  return assert.rejects(promise, ValidationError);
});

test('either person can edit and delete entries', async () => {
  const { me, wife } = pair();
  const row = await me.addTransaction(expense);
  await wife.updateTransaction(row.id, { ...expense, amount_paise: 99900 });
  const edited = (await me.loadAll()).transactions[0];
  assert.equal(edited.amount_paise, 99900);
  assert.equal(edited.created_by, 'me', 'editing does not change who created it');
  await wife.deleteTransaction(row.id);
  assert.equal((await me.loadAll()).transactions.length, 0);
});

test('switching an entry between income and expense maintains the bucket rule', async () => {
  const { me } = pair();
  const row = await me.addTransaction(expense);
  await me.updateTransaction(row.id, income);
  assert.equal((await me.loadAll()).transactions[0].bucket, null);
  await me.updateTransaction(row.id, expense);
  assert.equal((await me.loadAll()).transactions[0].bucket, 'needs');
});

test('recurring: add, end after a month, update and delete', async () => {
  const { me, wife } = pair();
  const rec = await me.addRecurring(monthlyRec);
  await wife.endRecurring(rec.id, '2026-06-30');
  assert.equal((await me.loadAll()).recurring[0].end_on, '2026-06-30');
  await me.updateRecurring(rec.id, { ...monthlyRec, amount_paise: 1200000, end_on: '2026-06-30' });
  assert.equal((await me.loadAll()).recurring[0].amount_paise, 1200000);
  await wife.deleteRecurring(rec.id);
  assert.equal((await me.loadAll()).recurring.length, 0);
});

test('goals: contributions from both people accumulate; deleting a goal removes only its own', async () => {
  const { me, wife } = pair();
  const trip = await me.addGoal({ name: 'Trip', target_paise: 100000, deadline: null });
  const car = await me.addGoal({ name: 'Car', target_paise: 500000, deadline: '2027-01-01' });
  await me.addContribution({ goal_id: trip.id, amount_paise: 5000, contributed_on: '2026-03-01' });
  await wife.addContribution({ goal_id: trip.id, amount_paise: 7000, contributed_on: '2026-03-02' });
  await me.addContribution({ goal_id: car.id, amount_paise: 100, contributed_on: '2026-03-02' });
  await me.deleteGoal(trip.id);
  const all = await wife.loadAll();
  assert.deepEqual(all.goals.map((g) => g.name), ['Car']);
  assert.deepEqual(all.contributions.map((c) => c.goal_id), [car.id]);
});

test('a single contribution can be removed', async () => {
  const { me } = pair();
  const goal = await me.addGoal({ name: 'Trip', target_paise: 1000, deadline: null });
  const c = await me.addContribution({ goal_id: goal.id, amount_paise: 100, contributed_on: '2026-03-01' });
  await me.deleteContribution(c.id);
  assert.equal((await me.loadAll()).contributions.length, 0);
});

test('budget split defaults to 50/30/20, can be changed, and is shared', async () => {
  const { me, wife } = pair();
  assert.deepEqual(await me.getSplit(), { needs: 50, wants: 30, savings: 20 });
  await me.saveSplit({ needs: 55, wants: 25, savings: 20 });
  await wife.saveSplit({ needs: 60, wants: 20, savings: 20 });
  assert.deepEqual(await me.getSplit(), { needs: 60, wants: 20, savings: 20 });
  assert.equal((await me.loadAll()).split.needs, 60);
});

test('an invalid split is rejected and the old one is kept', async () => {
  const { me } = pair();
  await me.saveSplit({ needs: 60, wants: 20, savings: 20 });
  await assert.rejects(() => me.saveSplit({ needs: 60, wants: 20, savings: 30 }), ValidationError);
  assert.deepEqual(await me.getSplit(), { needs: 60, wants: 20, savings: 20 });
});

test('loadAll returns members, entries and settings together', async () => {
  const { adapter, me } = pair();
  await adapter.insert('household_members', { household_id: 'h1', user_id: 'me', display_name: 'Shubham' });
  await me.addTransaction(expense);
  const all = await me.loadAll();
  assert.deepEqual(Object.keys(all).sort(), ['contributions', 'goals', 'loans', 'members', 'recurring', 'split', 'transactions']);
  assert.equal(all.members[0].display_name, 'Shubham');
});

test('methods work when destructured from the ledger (no reliance on this)', async () => {
  const { me } = pair();
  const { loadAll, getSplit } = me;
  assert.equal((await loadAll()).transactions.length, 0);
  assert.equal((await getSplit()).needs, 50);
});

test('subscribers hear about the other person\'s changes, until they unsubscribe', async () => {
  const { me, wife } = pair();
  let calls = 0;
  const off = me.subscribe(() => { calls += 1; });
  await wife.addTransaction(expense);
  await wife.addRecurring(monthlyRec);
  assert.equal(calls, 2);
  off();
  await wife.addTransaction(expense);
  assert.equal(calls, 2);
});

test('subscribers ignore other households', async () => {
  const adapter = createMemoryAdapter();
  const mine = createLedger({ adapter, session: sessionFor('me', 'h1') });
  const other = createLedger({ adapter, session: sessionFor('x', 'h2') });
  let calls = 0;
  mine.subscribe(() => { calls += 1; });
  await other.addTransaction(expense);
  assert.equal(calls, 0);
});

test('importRows validates every row, stamps ownership and reports a count', async () => {
  const { me } = pair();
  const n = await me.importRows({
    transactions: [{ ...expense, created_by: 'legacy-user' }, income],
    recurring: [monthlyRec],
  });
  assert.equal(n, 3);
  const all = await me.loadAll();
  assert.equal(all.transactions.find((t) => t.kind === 'income').created_by, 'me');
  assert.equal(all.transactions.find((t) => t.kind === 'expense').created_by, 'legacy-user');
});

test('importRows stops at the first invalid row', async () => {
  const { me } = pair();
  await assert.rejects(() => me.importRows({ transactions: [expense, { ...expense, amount_paise: 0 }, expense] }), ValidationError);
  assert.equal((await me.loadAll()).transactions.length, 1);
});

test('importRows with nothing is a no-op', async () => {
  const { me } = pair();
  assert.equal(await me.importRows({}), 0);
});
