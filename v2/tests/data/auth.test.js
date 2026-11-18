import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryAdapter } from '../../src/data/adapters/memoryAdapter.js';
import { createLocalAuth, LOCAL_HOUSEHOLD_ID } from '../../src/auth/localAuth.js';
import { createSupabaseAuth, friendlyAuthMessage } from '../../src/auth/supabaseAuth.js';
import { createFakeBackend } from '../helpers/fakeSupabase.js';

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
};

const localAuth = () => {
  const adapter = createMemoryAdapter();
  return { adapter, auth: createLocalAuth({ adapter, storage: memoryStorage() }) };
};

test('local auth: no session until someone signs in', async () => {
  assert.equal(await localAuth().auth.getSession(), null);
});

test('local auth: signing in creates a member and a session in the shared local household', async () => {
  const { adapter, auth } = localAuth();
  await auth.signIn({ displayName: 'Shubham' });
  const session = await auth.getSession();
  assert.equal(session.displayName, 'Shubham');
  assert.equal(session.householdId, LOCAL_HOUSEHOLD_ID);
  assert.equal(session.inviteCode, null);
  const members = await adapter.list('household_members', { householdId: LOCAL_HOUSEHOLD_ID });
  assert.equal(members.length, 1);
  assert.equal(members[0].user_id, session.userId);
});

test('local auth: the same name (any case, padded) reuses the same person', async () => {
  const { adapter, auth } = localAuth();
  await auth.signIn({ displayName: 'Priya' });
  const first = (await auth.getSession()).userId;
  await auth.signOut();
  await auth.signIn({ displayName: '  priya ' });
  assert.equal((await auth.getSession()).userId, first);
  assert.equal((await adapter.list('household_members', {})).length, 1);
});

test('local auth: different names are different people with different ids', async () => {
  const { auth } = localAuth();
  await auth.signIn({ displayName: 'Shubham' });
  const a = (await auth.getSession()).userId;
  await auth.signOut();
  await auth.signIn({ displayName: 'Priya' });
  assert.notEqual((await auth.getSession()).userId, a);
});

test('local auth: rejects empty and over-long names', async () => {
  const { auth } = localAuth();
  await assert.rejects(() => auth.signIn({ displayName: '   ' }), /name/i);
  await assert.rejects(() => auth.signIn({ displayName: undefined }), /name/i);
  await assert.rejects(() => auth.signIn({ displayName: 'x'.repeat(61) }), /too long/i);
  assert.equal(await auth.getSession(), null);
});

test('local auth: signOut clears the session; onChange fires on sign in/out and can unsubscribe', async () => {
  const { auth } = localAuth();
  let changes = 0;
  const off = auth.onChange(() => { changes += 1; });
  await auth.signIn({ displayName: 'A' });
  await auth.signOut();
  assert.equal(changes, 2);
  assert.equal(await auth.getSession(), null);
  off();
  await auth.signIn({ displayName: 'A' });
  assert.equal(changes, 2);
});

/* ---------- supabase auth (against the fake backend) ---------- */

const cloud = (backend = createFakeBackend()) => createSupabaseAuth({ url: 'u', anonKey: 'k', createClient: backend.createClient });

test('supabase auth: signed-out has no session', async () => {
  assert.equal(await (await cloud()).getSession(), null);
});

test('supabase auth: sign up, sign in, and wrong password', async () => {
  const backend = createFakeBackend();
  const auth = await cloud(backend);
  assert.deepEqual(await auth.signUp({ email: 'a@x.com', password: 'password1' }), { needsConfirmation: false });
  await auth.signOut();
  await assert.rejects(() => auth.signIn({ email: 'a@x.com', password: 'wrong' }), /Invalid login credentials/);
  await auth.signIn({ email: 'a@x.com', password: 'password1' });
  assert.equal((await auth.getSession()).email, 'a@x.com');
});

test('supabase auth: sign up reports when email confirmation is required', async () => {
  const auth = await cloud(createFakeBackend({ confirmEmail: true }));
  assert.deepEqual(await auth.signUp({ email: 'a@x.com', password: 'password1' }), { needsConfirmation: true });
  assert.equal(await auth.getSession(), null);
});

test('supabase auth: duplicate sign up fails with the server message', async () => {
  const auth = await cloud();
  await auth.signUp({ email: 'a@x.com', password: 'password1' });
  await assert.rejects(() => auth.signUp({ email: 'a@x.com', password: 'password1' }), /already registered/);
});

test('supabase auth: a new user has no household until they create or join one', async () => {
  const auth = await cloud();
  await auth.signUp({ email: 'a@x.com', password: 'password1' });
  const session = await auth.getSession();
  assert.equal(session.householdId, null);
  assert.equal(session.displayName, 'a@x.com');
});

test('supabase auth: creating a household yields an invite code and a session in it', async () => {
  const auth = await cloud();
  await auth.signUp({ email: 'a@x.com', password: 'password1' });
  await auth.createHousehold({ name: 'Our home', displayName: 'Shubham' });
  const session = await auth.getSession();
  assert.equal(session.householdName, 'Our home');
  assert.equal(session.displayName, 'Shubham');
  assert.match(session.inviteCode, /^[0-9a-f]{12}$/);
});

test('supabase auth: a partner joins with the invite code and lands in the same household', async () => {
  const backend = createFakeBackend();
  const a = await cloud(backend);
  await a.signUp({ email: 'a@x.com', password: 'password1' });
  await a.createHousehold({ name: 'Our home', displayName: 'Shubham' });
  const { inviteCode, householdId } = await a.getSession();

  const b = await cloud(backend);
  await b.signUp({ email: 'b@x.com', password: 'password1' });
  await b.joinHousehold({ code: `  ${inviteCode.toUpperCase()} `, displayName: 'Priya' });
  assert.equal((await b.getSession()).householdId, householdId);
  assert.equal(backend.db.household_members.length, 2);
});

test('supabase auth: bad invite code, double join and a full household are rejected', async () => {
  const backend = createFakeBackend();
  const a = await cloud(backend);
  await a.signUp({ email: 'a@x.com', password: 'password1' });
  await a.createHousehold({ name: 'Home', displayName: 'A' });
  const { inviteCode } = await a.getSession();
  await assert.rejects(() => a.createHousehold({ name: 'Again', displayName: 'A' }), /already in a household/);

  const b = await cloud(backend);
  await b.signUp({ email: 'b@x.com', password: 'password1' });
  await assert.rejects(() => b.joinHousehold({ code: 'nope', displayName: 'B' }), /invalid invite code/);

  for (let i = 0; i < 5; i += 1) {
    const extra = await cloud(backend);
    await extra.signUp({ email: `e${i}@x.com`, password: 'password1' });
    await extra.joinHousehold({ code: inviteCode, displayName: `E${i}` });
  }
  await assert.rejects(() => b.joinHousehold({ code: inviteCode, displayName: 'B' }), /full/);
});

test('supabase auth: signOut clears the session; onChange can be unsubscribed', async () => {
  const auth = await cloud();
  let changes = 0;
  const off = auth.onChange(() => { changes += 1; });
  await auth.signUp({ email: 'a@x.com', password: 'password1' });
  await auth.signOut();
  assert.equal(changes, 2);
  assert.equal(await auth.getSession(), null);
  off();
  await auth.signIn({ email: 'a@x.com', password: 'password1' });
  assert.equal(changes, 2);
});

test('supabase auth: exposes the client so the adapter can share its session', async () => {
  const auth = await cloud();
  assert.equal(auth.mode, 'cloud');
  assert.equal(typeof auth.client.from, 'function');
});

/* ---------- plain-language sign-in errors ---------- */

test('friendlyAuthMessage: rewrites the cryptic messages people actually hit', () => {
  assert.match(friendlyAuthMessage('email rate limit exceeded'), /Wait about an hour/);
  assert.match(friendlyAuthMessage('Email signups are disabled'), /Ask the admin to enable email sign-in/);
  assert.match(friendlyAuthMessage('Signups not allowed for this instance'), /turned off/);
  assert.match(friendlyAuthMessage('Email address "test@gmail.com" is invalid'), /real address/);
  assert.match(friendlyAuthMessage('Unable to validate email address: invalid format'), /real address/);
  assert.match(friendlyAuthMessage('Email not confirmed'), /confirm your email/);
  assert.match(friendlyAuthMessage('Password should be at least 8 characters'), /longer password/);
});

test('friendlyAuthMessage: unknown or empty messages pass through unchanged', () => {
  assert.equal(friendlyAuthMessage('Something unexpected'), 'Something unexpected');
  assert.equal(friendlyAuthMessage(''), '');
  assert.equal(friendlyAuthMessage(), '');
  assert.equal(friendlyAuthMessage('Invalid login credentials'), 'Invalid login credentials');
});

test('supabase auth: sign-up and sign-in failures reach the user in plain language', async () => {
  const failing = (message) => () => ({
    auth: {
      signUp: async () => ({ data: null, error: { message } }),
      signInWithPassword: async () => ({ data: null, error: { message } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  });
  const limited = await createSupabaseAuth({ url: 'u', anonKey: 'k', createClient: failing('email rate limit exceeded') });
  await assert.rejects(() => limited.signUp({ email: 'a@x.com', password: 'password1' }), /Wait about an hour/);
  const disabled = await createSupabaseAuth({ url: 'u', anonKey: 'k', createClient: failing('Email signups are disabled') });
  await assert.rejects(() => disabled.signUp({ email: 'a@x.com', password: 'password1' }), /enable email sign-in/);
  const unconfirmed = await createSupabaseAuth({ url: 'u', anonKey: 'k', createClient: failing('Email not confirmed') });
  await assert.rejects(() => unconfirmed.signIn({ email: 'a@x.com', password: 'password1' }), /confirm your email/);
});

test('supabase auth: database errors (not sign-in) keep their original wording', async () => {
  const backend = createFakeBackend();
  const a = await cloud(backend);
  await a.signUp({ email: 'a@x.com', password: 'password1' });
  await assert.rejects(() => a.joinHousehold({ code: 'nope', displayName: 'A' }), /^Error: invalid invite code$/);
});
