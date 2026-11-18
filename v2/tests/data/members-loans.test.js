import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryAdapter } from '../../src/data/adapters/memoryAdapter.js';
import { createLedger, ValidationError } from '../../src/services/ledger.js';
import { createLocalAuth, LOCAL_HOUSEHOLD_ID } from '../../src/auth/localAuth.js';
import { createSupabaseAuth } from '../../src/auth/supabaseAuth.js';
import { createSupabaseAdapter } from '../../src/data/adapters/supabaseAdapter.js';
import { friendlyDataError } from '../../src/data/errors.js';
import { validateGoal, validateLoan } from '../../src/domain/validation.js';
import { createFakeBackend } from '../helpers/fakeSupabase.js';

const sessionFor = (userId, householdId = 'h1') => ({ userId, householdId });
const loan = { name: 'Home loan', outstanding_paise: 50000000, rate_pct: 9, emi_paise: 600000 };

/* ---------- validation ---------- */

test('validateLoan: accepts a normal loan, trims the name and rounds the rate to two decimals', () => {
  const r = validateLoan({ ...loan, name: '  Home  ', rate_pct: '8.555' });
  assert.equal(r.ok, true);
  assert.deepEqual([r.value.name, r.value.rate_pct], ['Home', 8.56]);
});

test('validateLoan: rate must be 0-60 and present', () => {
  for (const rate_pct of [-1, 60.01, 99, 'abc', '', null, undefined, NaN]) {
    assert.equal(validateLoan({ ...loan, rate_pct }).ok, false, String(rate_pct));
  }
  for (const rate_pct of [0, 60, '8.5', 12]) assert.equal(validateLoan({ ...loan, rate_pct }).ok, true, String(rate_pct));
});

test('validateLoan: amounts must be whole paise; the balance may be zero but the EMI may not', () => {
  assert.equal(validateLoan({ ...loan, outstanding_paise: 0 }).ok, true);
  assert.equal(validateLoan({ ...loan, outstanding_paise: -1 }).ok, false);
  assert.equal(validateLoan({ ...loan, outstanding_paise: 1.5 }).ok, false);
  assert.equal(validateLoan({ ...loan, emi_paise: 0 }).ok, false);
  assert.equal(validateLoan({ ...loan, emi_paise: '100' }).ok, false);
  assert.equal(validateLoan({ ...loan, name: '' }).ok, false);
  assert.equal(validateLoan({ ...loan, name: 'x'.repeat(81) }).ok, false);
});

test('validateGoal: is_emergency is a strict boolean that defaults to false', () => {
  assert.equal(validateGoal({ name: 'x', target_paise: 1 }).value.is_emergency, false);
  assert.equal(validateGoal({ name: 'x', target_paise: 1, is_emergency: true }).value.is_emergency, true);
  assert.equal(validateGoal({ name: 'x', target_paise: 1, is_emergency: 'yes' }).value.is_emergency, false);
});

/* ---------- ledger ---------- */

test('ledger: loans are shared between the people, validated, and listed by loadAll', async () => {
  const adapter = createMemoryAdapter();
  const me = createLedger({ adapter, session: sessionFor('me') });
  const wife = createLedger({ adapter, session: sessionFor('wife') });
  const saved = await me.addLoan(loan);
  assert.equal(saved.created_by, 'me');
  assert.equal((await wife.loadAll()).loans.length, 1);
  await assert.rejects(() => me.addLoan({ ...loan, emi_paise: 0 }), ValidationError);
  await wife.updateLoan(saved.id, { ...loan, outstanding_paise: 40000000 });
  assert.equal((await me.loadAll()).loans[0].outstanding_paise, 40000000);
  await wife.deleteLoan(saved.id);
  assert.equal((await me.loadAll()).loans.length, 0);
});

test('ledger: loans of another household are invisible', async () => {
  const adapter = createMemoryAdapter();
  await createLedger({ adapter, session: sessionFor('me', 'h1') }).addLoan(loan);
  assert.equal((await createLedger({ adapter, session: sessionFor('x', 'h2') }).loadAll()).loans.length, 0);
});

test('ledger: a household can only have one emergency fund; other goals are unaffected', async () => {
  const adapter = createMemoryAdapter();
  const ledger = createLedger({ adapter, session: sessionFor('me') });
  await ledger.addGoal({ name: 'EF', target_paise: 100, deadline: null, is_emergency: true });
  await assert.rejects(() => ledger.addGoal({ name: 'EF2', target_paise: 100, deadline: null, is_emergency: true }), /already have an emergency fund/);
  await ledger.addGoal({ name: 'Trip', target_paise: 100, deadline: null });
  assert.equal((await ledger.loadAll()).goals.length, 2);
  const other = createLedger({ adapter, session: sessionFor('x', 'h2') });
  await other.addGoal({ name: 'EF', target_paise: 100, deadline: null, is_emergency: true });
});

test('ledger: subscribers hear about loan changes', async () => {
  const adapter = createMemoryAdapter();
  const me = createLedger({ adapter, session: sessionFor('me') });
  const wife = createLedger({ adapter, session: sessionFor('wife') });
  let calls = 0;
  me.subscribe(() => { calls += 1; });
  await wife.addLoan(loan);
  assert.equal(calls, 1);
});

/* ---------- friendly data errors ---------- */

test('friendlyDataError: an out-of-date database gets a clear instruction', () => {
  for (const message of [
    'column household_members.left_at does not exist',
    'relation "public.loans" does not exist',
    'Could not find the table \'public.loans\' in the schema cache',
    'Could not find the function public.rotate_invite_code without parameters in the schema cache',
  ]) {
    assert.match(friendlyDataError(message), /database is out of date.*newest SQL files/, message);
  }
});

test('regression: a missing Postgres function is shown as the real error, not as "out of date"', () => {
  // This is what rotate_invite_code failed with; the old translator hid it behind "database is out of date".
  const real = 'function gen_random_bytes(integer) does not exist';
  assert.equal(friendlyDataError(real), real);
  for (const message of ['function foo(integer) does not exist', 'type "citext" does not exist', 'schema "extensions" does not exist']) {
    assert.equal(friendlyDataError(message), message, message);
  }
});

test('friendlyDataError: other messages pass through untouched', () => {
  assert.equal(friendlyDataError('network down'), 'network down');
  assert.equal(friendlyDataError(''), '');
  assert.equal(friendlyDataError(), '');
});

/* ---------- local auth: removal ---------- */

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
};

async function localPair() {
  const adapter = createMemoryAdapter();
  const storage = memoryStorage();
  const auth = createLocalAuth({ adapter, storage });
  await auth.signIn({ displayName: 'Priya' });
  const priya = (await auth.getSession()).userId;
  await auth.signOut();
  await auth.signIn({ displayName: 'Shubham' });
  const shubham = (await auth.getSession()).userId;
  return { adapter, storage, auth, priya, shubham };
}

test('local auth: removing someone keeps their row as a former member', async () => {
  const { adapter, auth, priya } = await localPair();
  await auth.removeMember(priya);
  const rows = await adapter.list('household_members', { householdId: LOCAL_HOUSEHOLD_ID });
  const row = rows.find((m) => m.user_id === priya);
  assert.ok(row.left_at, 'marked as left');
  assert.equal(row.display_name, 'Priya', 'name kept for attribution');
});

test('local auth: you cannot remove yourself, a stranger, or the last member', async () => {
  const { auth, priya, shubham } = await localPair();
  await assert.rejects(() => auth.removeMember(shubham), /leave_household/);
  await assert.rejects(() => auth.removeMember('nobody'), /not in your household/);
  await auth.removeMember(priya);
  await assert.rejects(() => auth.removeMember(priya), /not in your household/, 'already removed');
});

test('local auth: leaving signs you out; the last member cannot leave', async () => {
  const { auth, adapter } = await localPair();
  await auth.leaveHousehold();
  assert.equal(await auth.getSession(), null);
  const active = (await adapter.list('household_members', {})).filter((m) => !m.left_at);
  assert.equal(active.length, 1);
  await auth.signIn({ displayName: 'Priya' });
  await assert.rejects(() => auth.leaveHousehold(), /only member/);
});

test('local auth: a removed person is no longer signed in, and signing in again makes a fresh person', async () => {
  const { auth, priya } = await localPair();
  await auth.signOut();
  await auth.signIn({ displayName: 'Priya' });
  const before = (await auth.getSession()).userId;
  assert.equal(before, priya);
  await auth.signOut();
  await auth.signIn({ displayName: 'Shubham' });
  await auth.removeMember(priya);
  // Priya's stale profile in storage is rejected now that she was removed.
  await auth.signOut();
  await auth.signIn({ displayName: 'Priya' });
  assert.notEqual((await auth.getSession()).userId, priya, 'a new person, not the removed one');
});

test('local auth: invite codes do not exist locally', async () => {
  const { auth } = await localPair();
  assert.equal(await auth.rotateInviteCode(), null);
});

/* ---------- cloud auth + backend: removal ---------- */

const cloud = async (backend) => createSupabaseAuth({ url: 'u', anonKey: 'k', createClient: backend.createClient });

async function twoPhones() {
  const backend = createFakeBackend();
  const a = await cloud(backend);
  await a.signUp({ email: 'a@x.com', password: 'password1' });
  await a.createHousehold({ name: 'Home', displayName: 'Shubham' });
  const sessionA = await a.getSession();
  const b = await cloud(backend);
  await b.signUp({ email: 'b@x.com', password: 'password1' });
  await b.joinHousehold({ code: sessionA.inviteCode, displayName: 'Priya' });
  const sessionB = await b.getSession();
  return { backend, a, b, sessionA, sessionB };
}

test('cloud: removing someone cuts their access immediately but keeps what they entered', async () => {
  const { backend, a, b, sessionA, sessionB } = await twoPhones();
  const ledgerB = createLedger({ adapter: createSupabaseAdapter(b.client), session: sessionB });
  await ledgerB.addTransaction({ kind: 'income', amount_paise: 100, category: 'Salary', occurred_on: '2026-03-01', note: '' });

  await a.removeMember(sessionB.userId);

  // Priya can now see nothing and cannot write.
  assert.equal((await ledgerB.loadAll()).transactions.length, 0);
  await assert.rejects(() => ledgerB.addTransaction({ kind: 'income', amount_paise: 1, category: 'x', occurred_on: '2026-03-01', note: '' }), /row-level security/);
  assert.equal((await b.getSession()).householdId, null, 'her session no longer has a household');

  // Shubham still sees her entry, and her member row now shows she left.
  const ledgerA = createLedger({ adapter: createSupabaseAdapter(a.client), session: sessionA });
  const all = await ledgerA.loadAll();
  assert.equal(all.transactions.length, 1);
  assert.ok(all.members.find((m) => m.user_id === sessionB.userId).left_at);
  assert.equal(backend.db.transactions.length, 1, 'data was not deleted');
});

test('cloud: removing someone replaces the invite code so they cannot rejoin with the old one', async () => {
  const { a, b, sessionA, sessionB } = await twoPhones();
  const oldCode = sessionA.inviteCode;
  await a.removeMember(sessionB.userId);
  const fresh = await a.getSession();
  assert.notEqual(fresh.inviteCode, oldCode);
  await assert.rejects(() => b.joinHousehold({ code: oldCode, displayName: 'Priya' }), /invalid invite code/);
  await b.joinHousehold({ code: fresh.inviteCode, displayName: 'Priya again' });
  assert.equal((await b.getSession()).displayName, 'Priya again', 'a new code lets them back in as a new membership');
});

test('cloud: you cannot remove yourself, a stranger, or an already-removed person', async () => {
  const { a, sessionA, sessionB } = await twoPhones();
  await assert.rejects(() => a.removeMember(sessionA.userId), /leave_household/);
  await assert.rejects(() => a.removeMember('11111111-1111-1111-1111-111111111111'), /not in your household/);
  await a.removeMember(sessionB.userId);
  await assert.rejects(() => a.removeMember(sessionB.userId), /not in your household/);
});

test('cloud: someone outside the household cannot remove anyone', async () => {
  const { backend, sessionA } = await twoPhones();
  const stranger = await cloud(backend);
  await stranger.signUp({ email: 'c@x.com', password: 'password1' });
  await assert.rejects(() => stranger.removeMember(sessionA.userId), /not in a household/);
});

test('cloud: leaving works while someone else remains, and the last person cannot leave', async () => {
  const { a, b, sessionB } = await twoPhones();
  await b.leaveHousehold();
  assert.equal((await b.getSession()).householdId, null);
  await assert.rejects(() => a.leaveHousehold(), /only member/);
  assert.equal((await a.getSession()).householdId !== null, true);
  assert.ok(sessionB.userId);
});

test('cloud: a person who left can start or join another household (history is kept, only one active)', async () => {
  const { backend, b, sessionB } = await twoPhones();
  await b.leaveHousehold();
  await b.createHousehold({ name: 'My own', displayName: 'Priya' });
  const rows = backend.db.household_members.filter((m) => m.user_id === sessionB.userId);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((m) => !m.left_at).length, 1, 'exactly one active membership');
  assert.equal((await b.getSession()).householdName, 'My own');
});

test('cloud: a new invite code can be created and the old one stops working', async () => {
  const { backend, a, sessionA } = await twoPhones();
  const code = await a.rotateInviteCode();
  assert.notEqual(code, sessionA.inviteCode);
  assert.equal((await a.getSession()).inviteCode, code);
  const c = await cloud(backend);
  await c.signUp({ email: 'c@x.com', password: 'password1' });
  await assert.rejects(() => c.joinHousehold({ code: sessionA.inviteCode, displayName: 'C' }), /invalid invite code/);
  await c.joinHousehold({ code, displayName: 'C' });
});

test('cloud: household size limit counts only active members', async () => {
  const { backend, a, sessionA } = await twoPhones();
  const code = (await a.getSession()).inviteCode;
  const others = [];
  for (let i = 0; i < 4; i += 1) {
    const x = await cloud(backend);
    await x.signUp({ email: `x${i}@x.com`, password: 'password1' });
    await x.joinHousehold({ code, displayName: `X${i}` });
    others.push(x);
  }
  const full = await cloud(backend);
  await full.signUp({ email: 'full@x.com', password: 'password1' });
  await assert.rejects(() => full.joinHousehold({ code, displayName: 'Z' }), /full/);
  await others[0].leaveHousehold();
  await full.joinHousehold({ code, displayName: 'Z' });
  assert.ok(sessionA.userId);
});
