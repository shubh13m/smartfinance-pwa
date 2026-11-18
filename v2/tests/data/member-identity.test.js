import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMemoryAdapter } from '../../src/data/adapters/memoryAdapter.js';
import { createLedger } from '../../src/services/ledger.js';
import { createLocalAuth } from '../../src/auth/localAuth.js';
import { createSupabaseAuth, friendlyHouseholdMessage } from '../../src/auth/supabaseAuth.js';
import { createSupabaseAdapter } from '../../src/data/adapters/supabaseAdapter.js';
import { dedupeMembers, activeMembers, formerMembers } from '../../src/domain/members.js';
import { createFakeBackend } from '../helpers/fakeSupabase.js';

const m = (user_id, name, left_at = null, extra = {}) => ({ id: `${user_id}-${name}-${left_at}`, user_id, display_name: name, left_at, ...extra });

/* ---------- one person, however many memberships ---------- */

test('dedupe: someone who left and rejoined is one person, shown as active', () => {
  const rows = [m('a', 'Shubham'), m('b', 'Pandey', '2026-11-18T10:00:00Z'), m('b', 'Pandey')];
  const people = dedupeMembers(rows);
  assert.equal(people.length, 2);
  const pandey = people.find((p) => p.user_id === 'b');
  assert.equal(pandey.left_at, null);
  assert.deepEqual(activeMembers(people).map((p) => p.display_name), ['Shubham', 'Pandey']);
  assert.deepEqual(formerMembers(people), [], 'not listed as a former member as well');
});

test('dedupe: the active membership wins regardless of row order', () => {
  const left = m('b', 'Old name', '2026-01-01T00:00:00Z');
  const active = m('b', 'New name');
  assert.equal(dedupeMembers([left, active])[0].display_name, 'New name');
  assert.equal(dedupeMembers([active, left])[0].display_name, 'New name');
});

test('dedupe: with only past memberships the most recent one is used', () => {
  const people = dedupeMembers([m('b', 'First', '2026-01-01T00:00:00Z'), m('b', 'Second', '2026-06-01T00:00:00Z'), m('b', 'Third', '2026-03-01T00:00:00Z')]);
  assert.equal(people.length, 1);
  assert.equal(people[0].display_name, 'Second');
  assert.equal(formerMembers(people).length, 1);
});

test('dedupe: keeps first-seen order, handles empty input, and never merges different accounts that share a name', () => {
  assert.deepEqual(dedupeMembers([m('x', 'A'), m('y', 'B'), m('x', 'A', '2026-01-01T00:00:00Z')]).map((p) => p.user_id), ['x', 'y']);
  assert.deepEqual(dedupeMembers(), []);
  assert.deepEqual(dedupeMembers([m('x', 'Priya'), m('y', 'priya', '2026-01-01T00:00:00Z')]).map((p) => p.user_id), ['x', 'y']);
});

test('ledger: loadAll returns one entry per person even when the database has several membership rows', async () => {
  const adapter = createMemoryAdapter();
  const me = createLedger({ adapter, session: { userId: 'a', householdId: 'h1' } });
  await adapter.insert('household_members', { household_id: 'h1', user_id: 'a', display_name: 'Shubham', left_at: null });
  await adapter.insert('household_members', { household_id: 'h1', user_id: 'b', display_name: 'Pandey', left_at: '2026-01-01T00:00:00Z' });
  await adapter.insert('household_members', { household_id: 'h1', user_id: 'b', display_name: 'Pandey', left_at: null });
  const { members } = await me.loadAll();
  assert.deepEqual(members.map((p) => [p.display_name, Boolean(p.left_at)]), [['Shubham', false], ['Pandey', false]]);
});

/* ---------- names: local mode ---------- */

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
};

test('local: names match ignoring capitals and spaces, so "  PRIYA " is the existing Priya', async () => {
  const adapter = createMemoryAdapter();
  const auth = createLocalAuth({ adapter, storage: memoryStorage() });
  await auth.signIn({ displayName: 'Priya' });
  const id = (await auth.getSession()).userId;
  await auth.signOut();
  for (const variant of ['priya', 'PRIYA', '  Priya  ', 'pRiYa']) {
    await auth.signIn({ displayName: variant });
    assert.equal((await auth.getSession()).userId, id, variant);
    await auth.signOut();
  }
  assert.equal((await adapter.list('household_members', {})).length, 1, 'no duplicate people were created');
});

/* ---------- names: cloud mode ---------- */

const cloud = async (backend) => createSupabaseAuth({ url: 'u', anonKey: 'k', createClient: backend.createClient });
async function household() {
  const backend = createFakeBackend();
  const a = await cloud(backend);
  await a.signUp({ email: 'a@x.com', password: 'password1' });
  await a.createHousehold({ name: 'Home', displayName: 'Shubham' });
  const sessionA = await a.getSession();
  const join = async (email, name, code = sessionA.inviteCode) => {
    const x = await cloud(backend);
    await x.signUp({ email, password: 'password1' });
    await x.joinHousehold({ code, displayName: name });
    return x;
  };
  return { backend, a, sessionA, join };
}

test('cloud: a second active member cannot take a name that is already used, whatever the capitals or spacing', async () => {
  const { backend, sessionA } = await household();
  for (const [i, clash] of ['Shubham', 'shubham', 'SHUBHAM', '  Shubham  '].entries()) {
    const x = await cloud(backend);
    await x.signUp({ email: `x${i}@x.com`, password: 'password1' });
    await assert.rejects(() => x.joinHousehold({ code: sessionA.inviteCode, displayName: clash }), /already uses that name/, JSON.stringify(clash));
  }
});

test('cloud: the name-clash message is plain language and says capitals do not matter', () => {
  const message = friendlyHouseholdMessage('that name is already used in this household');
  assert.match(message, /already uses that name/);
  assert.match(message, /capitals don’t matter/);
  assert.match(message, /initial or a nickname/);
  assert.equal(friendlyHouseholdMessage('household is full'), 'household is full');
  assert.equal(friendlyHouseholdMessage('enter your name'), 'Enter your name.');
});

test('cloud: names are trimmed when stored, and a blank name is refused', async () => {
  const { backend, sessionA, join } = await household();
  await join('b@x.com', '   Priya   ');
  assert.ok(backend.db.household_members.some((x) => x.display_name === 'Priya'));
  const blank = await cloud(backend);
  await blank.signUp({ email: 'c@x.com', password: 'password1' });
  await assert.rejects(() => blank.joinHousehold({ code: sessionA.inviteCode, displayName: '   ' }), /Enter your name/);
  await assert.rejects(() => blank.createHousehold({ name: 'H', displayName: '' }), /Enter your name/);
});

test('cloud: the same name is fine in a different household', async () => {
  const { backend } = await household();
  const other = await cloud(backend);
  await other.signUp({ email: 'o@x.com', password: 'password1' });
  await other.createHousehold({ name: 'Elsewhere', displayName: 'Shubham' });
  assert.equal((await other.getSession()).displayName, 'Shubham');
});

test('cloud: a person who left can rejoin with the same name — their own old row does not count as a clash', async () => {
  const { backend, a, sessionA, join } = await household();
  const priya = await join('b@x.com', 'Priya');
  const priyaId = (await priya.getSession()).userId;
  await a.removeMember(priyaId);
  const newCode = (await a.getSession()).inviteCode;
  await priya.joinHousehold({ code: newCode, displayName: 'priya' });
  assert.equal((await priya.getSession()).displayName, 'priya');
  assert.equal(backend.db.household_members.filter((x) => x.user_id === priyaId).length, 2, 'two membership rows, one account');
  assert.ok(sessionA.userId);
});

test('cloud: after rejoining, the household lists that person once, active, and their old entries are still theirs', async () => {
  const { backend, a, sessionA, join } = await household();
  const priya = await join('b@x.com', 'Priya');
  const sessionP = await priya.getSession();
  const ledgerP = createLedger({ adapter: createSupabaseAdapter(priya.client), session: sessionP });
  await ledgerP.addTransaction({ kind: 'income', amount_paise: 100, category: 'Salary', occurred_on: '2026-03-01', note: '' });
  await a.removeMember(sessionP.userId);
  await priya.joinHousehold({ code: (await a.getSession()).inviteCode, displayName: 'Priya' });

  const ledgerA = createLedger({ adapter: createSupabaseAdapter(a.client), session: sessionA });
  const all = await ledgerA.loadAll();
  assert.deepEqual(all.members.map((p) => [p.display_name, Boolean(p.left_at)]), [['Shubham', false], ['Priya', false]]);
  assert.equal(all.transactions[0].created_by, sessionP.userId, 'attributed to the same account');
  assert.equal(backend.db.transactions.length, 1);
});

test('cloud: a DIFFERENT account taking a former member\'s name is a different person', async () => {
  const { backend, a, sessionA, join } = await household();
  const priya = await join('b@x.com', 'Priya');
  const oldId = (await priya.getSession()).userId;
  await a.removeMember(oldId);
  const impostor = await cloud(backend);
  await impostor.signUp({ email: 'z@x.com', password: 'password1' });
  await impostor.joinHousehold({ code: (await a.getSession()).inviteCode, displayName: 'Priya' });
  const ledgerA = createLedger({ adapter: createSupabaseAdapter(a.client), session: sessionA });
  const people = (await ledgerA.loadAll()).members;
  assert.equal(people.filter((p) => p.display_name === 'Priya').length, 2, 'two different accounts');
  assert.notEqual((await impostor.getSession()).userId, oldId);
});

/* ---------- migration 006 ---------- */

const m6 = readFileSync(fileURLToPath(new URL('../../db/006_unique_member_names.sql', import.meta.url)), 'utf8');
const fn = (name) => m6.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?end \\$\\$;`))?.[0] ?? '';

test('006: names are trimmed, a blank name is refused, and the household name is trimmed too', () => {
  for (const name of ['create_household', 'join_household']) {
    const f = fn(name);
    assert.match(f, /clean_name text := btrim\(member_name\)/, name);
    assert.match(f, /clean_name is null or clean_name = '' then raise exception 'enter your name'/, name);
    assert.match(f, /values \(h\.id, auth\.uid\(\), clean_name\)/, name);
    assert.match(f, /security definer set search_path = public/, name);
  }
  assert.match(fn('create_household'), /btrim\(household_name\)/);
});

test('006: joining rejects a name used by an ACTIVE member, ignoring capitals, inside the household lock', () => {
  const f = fn('join_household');
  const lock = f.indexOf("pg_advisory_xact_lock(hashtextextended('household:'");
  const clash = f.indexOf('lower(display_name) = lower(clean_name)');
  assert.ok(lock > 0 && clash > lock, 'checked after taking the household lock, so two simultaneous joins cannot both pass');
  assert.match(f, /household_id = h\.id and left_at is null and lower\(display_name\)/, 'former members do not block a name');
  assert.match(f, /raise exception 'that name is already used in this household'/);
});

test('006: keeps the earlier rules: one household at a time, valid code, size limit, case-insensitive code', () => {
  const f = fn('join_household');
  for (const text of ['already in a household', 'invalid invite code', 'household is full']) assert.match(f, new RegExp(text), text);
  assert.match(f, />= 6/);
  assert.match(f, /lower\(btrim\(code\)\)/);
  assert.match(f, /user_id = auth\.uid\(\) and left_at is null/);
});

test('006: a unique index is the backstop, and is skipped safely if duplicates already exist', () => {
  assert.match(m6, /create unique index if not exists household_members_unique_active_name\s+on public\.household_members \(household_id, lower\(display_name\)\) where left_at is null/);
  assert.match(m6, /having count\(\*\) > 1/);
  assert.match(m6, /raise notice 'Skipped the unique-name index/);
});

test('006: functions stay locked to signed-in users', () => {
  for (const signature of ['create_household(text, text)', 'join_household(text, text)']) {
    const escaped = signature.replace(/[()]/g, '\\$&');
    assert.match(m6, new RegExp(`revoke all on function public\\.${escaped} from public, anon`));
    assert.match(m6, new RegExp(`grant execute on function public\\.${escaped} to authenticated`));
  }
});
