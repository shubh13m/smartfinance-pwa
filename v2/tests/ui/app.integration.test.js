import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, buttonByText, click, labelled, setConfirm, settle, submit, tick, text, type } from '../helpers/dom.js';
import { createFakeBackend } from '../helpers/fakeSupabase.js';
import { start } from '../../src/app/bootstrap.js';
import { todayISO } from '../../src/core/dates.js';

installDom();

let apps = [];
beforeEach(resetDom);
afterEach(() => { apps.forEach((a) => a.stop()); apps = []; });

const mountPoint = (id = 'app') => {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; document.body.append(el); }
  return el;
};
const launch = async (root, options = { cloud: null }) => { const app = await start(root, options); apps.push(app); await settle(); return app; };
const toastText = () => text(document.getElementById('toast'));

async function signInLocal(root, name) {
  type(labelled('Your name', root), name);
  submit(root.querySelector('form'));
  await settle(15);
}

async function addEntry(root, { kind = 'expense', amount, category, note = '' }) {
  click(root.querySelector('.fab'));
  const sheet = document.querySelector('.sheet');
  if (kind === 'income') click(buttonByText('Income', sheet));
  type(labelled('Amount', sheet), String(amount));
  type(labelled('Category', sheet), category);
  if (note) type(labelled('Note', sheet), note);
  submit(sheet.querySelector('form'));
  await settle(15);
}

/* ---------- local mode ---------- */

test('local mode: first visit shows the name screen, then the app', async () => {
  const root = mountPoint();
  await launch(root);
  assert.ok(root.querySelector('.auth-wrap'));
  assert.match(text(root), /Who is using the app\?/);
  await signInLocal(root, 'Shubham');
  assert.ok(root.querySelector('.topbar'));
  assert.equal(root.querySelector('.auth-wrap'), null);
  assert.match(text(root.querySelector('.side-user')), /Shubham/);
});

test('local mode: add an entry from the + button and see it on the dashboard and entries list', async () => {
  const root = mountPoint();
  await launch(root);
  await signInLocal(root, 'Shubham');
  await addEntry(root, { kind: 'income', amount: 80000, category: 'Salary' });
  await addEntry(root, { amount: 25000, category: 'Housing', note: 'Rent' });

  assert.equal(document.querySelector('.sheet'), null, 'sheet closes after saving');
  assert.match(text(root.querySelector('.hero-value')), /₹55,000\.00/);

  location.hash = '#/entries';
  await settle();
  const items = [...root.querySelectorAll('.list-item')].map(text);
  assert.equal(items.length, 2);
  assert.ok(items.some((t) => /Housing.*Rent.*−₹25,000\.00/.test(t)));
});

test('local mode: data survives closing and reopening the app', async () => {
  let root = mountPoint();
  let app = await launch(root);
  await signInLocal(root, 'Shubham');
  await addEntry(root, { amount: 1234, category: 'Groceries' });
  app.stop();
  root.replaceChildren();

  app = await launch(root);
  assert.ok(root.querySelector('.topbar'), 'still signed in');
  location.hash = '#/entries';
  await settle();
  assert.match(text(root.querySelector('.content')), /₹1,234\.00/);
});

test('local mode: two people on one device share data and get combined/individual views', async () => {
  const root = mountPoint();
  await launch(root);
  await signInLocal(root, 'Shubham');
  await addEntry(root, { kind: 'income', amount: 90000, category: 'Salary' });

  location.hash = '#/settings';
  await settle();
  click(buttonByText('Sign out', root));
  await settle();
  await signInLocal(root, 'Priya');
  await addEntry(root, { kind: 'income', amount: 65000, category: 'Salary' });

  location.hash = '#/dashboard';
  await settle();
  assert.match(text(root.querySelector('.hero-value')), /₹1,55,000\.00/, 'combined total');
  const filter = [...root.querySelectorAll('.toolbar .segmented button')];
  assert.equal(filter.length, 3);
  click(filter.find((b) => text(b).includes('Shubham')));
  assert.match(text(root.querySelector('.hero-value')), /₹90,000\.00/);
  click([...root.querySelectorAll('.toolbar .segmented button')].find((b) => text(b).includes('Priya')));
  assert.match(text(root.querySelector('.hero-value')), /₹65,000\.00/);
});

test('local mode: signing out returns to the name screen', async () => {
  const root = mountPoint();
  await launch(root);
  await signInLocal(root, 'Shubham');
  location.hash = '#/settings';
  await settle();
  click(buttonByText('Sign out', root));
  await settle();
  assert.ok(root.querySelector('.auth-wrap'));
});

test('hash navigation switches screens and unknown hashes fall back to the overview', async () => {
  const root = mountPoint();
  await launch(root);
  await signInLocal(root, 'Shubham');
  for (const [hash, title] of [['#/entries', 'Income & expenses'], ['#/goals', 'Goals & loans'], ['#/recurring', 'Recurring'], ['#/settings', 'Settings'], ['#/nope', 'Overview']]) {
    location.hash = hash;
    await settle();
    assert.equal(text(root.querySelector('.topbar h1')), title, hash);
  }
});

test('a validation problem keeps the sheet open and tells the user', async () => {
  const root = mountPoint();
  await launch(root);
  await signInLocal(root, 'Shubham');
  await addEntry(root, { amount: 0, category: 'Groceries' });
  assert.ok(document.querySelector('.sheet'));
  assert.match(toastText(), /greater than zero/);
});

test('changing the budget plan in settings changes the dashboard targets', async () => {
  const root = mountPoint();
  await launch(root);
  await signInLocal(root, 'Shubham');
  await addEntry(root, { kind: 'income', amount: 100000, category: 'Salary' });

  location.hash = '#/settings';
  await settle();
  const form = [...root.querySelectorAll('form')].find((f) => buttonByText('Save plan', f));
  type(labelled('Needs %', form), '60');
  type(labelled('Wants %', form), '20');
  submit(form);
  await settle(15);

  location.hash = '#/dashboard';
  await settle();
  assert.match(text(root.querySelector('.ring-card[data-bucket=needs]')), /₹0\.00 of ₹60,000\.00/);
});

/* ---------- cloud mode (fake backend) ---------- */

const cloudOptions = (backend) => ({ cloud: { url: 'https://fake.supabase.co', anonKey: 'anon' }, createClient: backend.createClient });

async function signUpAndCreate(root, backend, { email, household = 'Our home', name }) {
  await launch(root, cloudOptions(backend));
  type(labelled('Email', root), email);
  type(labelled('Password', root), 'password1');
  click(buttonByText('Create account', root));
  await settle(15);
  const [createForm] = root.querySelectorAll('form');
  type(labelled('Household name', createForm), household);
  type(labelled('Your name', createForm), name);
  submit(createForm);
  await settle(20);
}

async function signUpAndJoin(root, backend, { email, code, name }) {
  await launch(root, cloudOptions(backend));
  type(labelled('Email', root), email);
  type(labelled('Password', root), 'password1');
  click(buttonByText('Create account', root));
  await settle(15);
  const joinForm = root.querySelectorAll('form')[1];
  type(labelled('Invite code', joinForm), code);
  type(labelled('Your name', joinForm), name);
  submit(joinForm);
  await settle(20);
}

test('cloud: a new user creates a household and lands in the app with an invite code', async () => {
  const backend = createFakeBackend();
  const root = mountPoint();
  await signUpAndCreate(root, backend, { email: 'a@x.com', name: 'Shubham' });
  assert.ok(root.querySelector('.topbar'));
  location.hash = '#/settings';
  await settle();
  assert.match(text(root.querySelector('[data-testid=invite-code]')), /^[0-9a-f]{12}$/);
  assert.equal(backend.db.household_members.length, 1);
});

test('cloud: wrong password shows an error and stays on the sign-in screen', async () => {
  const backend = createFakeBackend();
  const root = mountPoint();
  await launch(root, cloudOptions(backend));
  type(labelled('Email', root), 'nobody@x.com');
  type(labelled('Password', root), 'wrongpass1');
  submit(root.querySelector('form'));
  await settle(15);
  assert.match(toastText(), /Invalid login credentials/);
  assert.ok(root.querySelector('.auth-wrap'));
});

test('cloud: two people share a household and each sees the other\'s entries live', async () => {
  const backend = createFakeBackend();
  const rootA = mountPoint('app');
  const rootB = mountPoint('app-b');

  await signUpAndCreate(rootA, backend, { email: 'a@x.com', name: 'Shubham' });
  location.hash = '#/settings';
  await settle();
  const code = text(rootA.querySelector('[data-testid=invite-code]'));
  await signUpAndJoin(rootB, backend, { email: 'b@x.com', code, name: 'Priya' });
  assert.equal(backend.db.household_members.length, 2);

  location.hash = '#/entries';
  await settle();
  await addEntry(rootA, { kind: 'income', amount: 90000, category: 'Salary' });
  await settle(20);

  assert.match(text(rootB.querySelector('.content')), /\+₹90,000\.00/, 'B sees A\'s entry without reloading');
  assert.match(text(rootB.querySelector('.content')), /Shubham/);

  await addEntry(rootB, { amount: 4800, category: 'Shopping', note: 'Clothes' });
  await settle(20);
  const aList = text(rootA.querySelector('.content'));
  assert.match(aList, /Shopping/);
  assert.match(aList, /Clothes · Priya/);
  assert.equal(backend.db.transactions.length, 2);
  assert.ok(backend.db.transactions.every((t) => t.household_id === backend.db.households[0].id));
});

test('cloud: entries are stored with the signed-in user as creator', async () => {
  const backend = createFakeBackend();
  const root = mountPoint();
  await signUpAndCreate(root, backend, { email: 'a@x.com', name: 'Shubham' });
  await addEntry(root, { amount: 100, category: 'Groceries' });
  assert.equal(backend.db.transactions[0].created_by, backend.db.household_members[0].user_id);
});

test('cloud: a change from the other phone does not wipe a form you are typing in, and appears once you stop', async () => {
  const backend = createFakeBackend();
  const clients = [];
  const options = { cloud: { url: 'u', anonKey: 'k' }, createClient: (...args) => { const c = backend.createClient(...args); clients.push(c); return c; } };
  const rootA = mountPoint('app');
  const rootB = mountPoint('app-b');

  await launch(rootA, options);
  type(labelled('Email', rootA), 'a@x.com');
  type(labelled('Password', rootA), 'password1');
  click(buttonByText('Create account', rootA));
  await settle(15);
  let [createForm] = rootA.querySelectorAll('form');
  type(labelled('Household name', createForm), 'Our home');
  type(labelled('Your name', createForm), 'Shubham');
  submit(createForm);
  await settle(20);
  location.hash = '#/settings';
  await settle();
  const code = text(rootA.querySelector('[data-testid=invite-code]'));

  await launch(rootB, options);
  type(labelled('Email', rootB), 'b@x.com');
  type(labelled('Password', rootB), 'password1');
  click(buttonByText('Create account', rootB));
  await settle(15);
  const joinForm = rootB.querySelectorAll('form')[1];
  type(labelled('Invite code', joinForm), code);
  type(labelled('Your name', joinForm), 'Priya');
  submit(joinForm);
  await settle(20);

  location.hash = '#/goals';
  await settle();
  const typing = labelled('Goal', rootB.querySelector('form'));
  typing.focus();
  type(typing, 'Half-written goal');

  // Phone A writes directly through its own client, so focus in B is untouched.
  const [clientA] = clients;
  const { household_id, user_id } = backend.db.household_members[0];
  await clientA.from('transactions').insert({
    household_id, created_by: user_id, kind: 'expense', amount_paise: 50000, category: 'Groceries', bucket: 'needs', occurred_on: todayISO(), note: '',
  }).select().single();
  await settle(20);

  assert.equal(labelled('Goal', rootB.querySelector('form')).value, 'Half-written goal', 'typed text survives a remote refresh');

  typing.blur();
  await tick(2300);
  location.hash = '#/entries';
  await settle(20);
  assert.match(text(rootB.querySelector('.content')), /Groceries/, 'remote change appears after typing stops');
});

test('cloud: auth refresh events do not remount the app (open forms stay intact)', async () => {
  const backend = createFakeBackend();
  let client;
  const root = mountPoint();
  await launch(root, { cloud: { url: 'u', anonKey: 'k' }, createClient: (...args) => { client = backend.createClient(...args); return client; } });
  type(labelled('Email', root), 'a@x.com');
  type(labelled('Password', root), 'password1');
  click(buttonByText('Create account', root));
  await settle(15);
  const [createForm] = root.querySelectorAll('form');
  type(labelled('Household name', createForm), 'Our home');
  type(labelled('Your name', createForm), 'Shubham');
  submit(createForm);
  await settle(20);

  location.hash = '#/goals';
  await settle();
  const appBefore = root.querySelector('.app');
  type(labelled('Goal', root.querySelector('form')), 'Typing…');

  client.__emitAuth('TOKEN_REFRESHED');
  client.__emitAuth('SIGNED_IN');
  await settle(20);

  assert.equal(root.querySelector('.app'), appBefore, 'same DOM, not remounted');
  assert.equal(labelled('Goal', root.querySelector('form')).value, 'Typing…');
});

test('cloud: if the backend cannot start, the user sees an error screen instead of a blank page', async () => {
  const root = mountPoint();
  await launch(root, { cloud: { url: 'u', anonKey: 'k' }, createClient: () => { throw new Error('boom'); } });
  assert.match(text(root), /Could not start/);
  assert.match(text(root), /boom/);
});

test('cloud: signing out of the app returns to the sign-in screen', async () => {
  const backend = createFakeBackend();
  const root = mountPoint();
  await signUpAndCreate(root, backend, { email: 'a@x.com', name: 'Shubham' });
  location.hash = '#/settings';
  await settle();
  click(buttonByText('Sign out', root));
  await settle(15);
  assert.ok(root.querySelector('.auth-wrap'));
  assert.match(text(root), /Welcome back/);
});

test('cloud: a returning user signs in and goes straight to their household', async () => {
  const backend = createFakeBackend();
  let root = mountPoint();
  await signUpAndCreate(root, backend, { email: 'a@x.com', name: 'Shubham' });
  location.hash = '#/settings';
  await settle();
  click(buttonByText('Sign out', root));
  await settle(15);

  type(labelled('Email', root), 'a@x.com');
  type(labelled('Password', root), 'password1');
  submit(root.querySelector('form'));
  await settle(20);
  assert.ok(root.querySelector('.topbar'));
  assert.match(text(root.querySelector('.side-user')), /Shubham/);
});

test('cloud: the second person cannot see data from a different household', async () => {
  const backend = createFakeBackend();
  const rootA = mountPoint('app');
  const rootB = mountPoint('app-b');
  await signUpAndCreate(rootA, backend, { email: 'a@x.com', name: 'Shubham', household: 'Home A' });
  await addEntry(rootA, { amount: 777, category: 'Groceries' });
  await signUpAndCreate(rootB, backend, { email: 'b@x.com', name: 'Stranger', household: 'Home B' });
  location.hash = '#/entries';
  await settle(20);
  assert.doesNotMatch(text(rootB.querySelector('.content')), /777/);
});

/* ---------- failure and edge handling ---------- */

// A fake client whose behaviour tests can sabotage and later repair.
function flakyBackend() {
  const backend = createFakeBackend();
  const flags = { failData: false, failSession: false };
  const createClient = (...args) => {
    const client = backend.createClient(...args);
    const realFrom = client.from;
    client.from = (table) => {
      if (flags.failData && table === 'transactions') {
        const failing = { select: () => failing, eq: () => failing, then: (resolve) => resolve({ data: null, error: { message: 'db down' } }) };
        return failing;
      }
      return realFrom(table);
    };
    const realGetSession = client.auth.getSession;
    client.auth.getSession = async () => {
      if (flags.failSession) throw new Error('network down');
      return realGetSession();
    };
    return client;
  };
  return { backend, flags, createClient };
}

async function createHouseholdVia(root, options, email = 'a@x.com', name = 'Shubham') {
  await launch(root, options);
  type(labelled('Email', root), email);
  type(labelled('Password', root), 'password1');
  click(buttonByText('Create account', root));
  await settle(15);
  const [form] = root.querySelectorAll('form');
  type(labelled('Household name', form), 'Our home');
  type(labelled('Your name', form), name);
  submit(form);
  await settle(20);
}

test('failure: if the session lookup fails the user is told and sees the sign-in screen', async () => {
  const { flags, createClient } = flakyBackend();
  flags.failSession = true;
  const root = mountPoint();
  await launch(root, { cloud: { url: 'u', anonKey: 'k' }, createClient });
  assert.match(toastText(), /network down/);
  assert.ok(root.querySelector('.auth-wrap'));
});

test('failure: if the first data load fails an error screen offers a retry that recovers', async () => {
  const { flags, createClient } = flakyBackend();
  const root = mountPoint();
  flags.failData = true;
  await createHouseholdVia(root, { cloud: { url: 'u', anonKey: 'k' }, createClient });

  assert.match(text(root), /Couldn’t load your data/);
  assert.match(text(root), /db down/);
  assert.equal(root.querySelector('.topbar'), null);

  flags.failData = false;
  click(buttonByText('Try again', root));
  await settle(20);
  assert.ok(root.querySelector('.topbar'), 'the app appears once the backend is back');
  assert.equal(root.querySelector('.auth-wrap'), null);
});

test('failure: the error screen lets the user sign out', async () => {
  const { flags, createClient } = flakyBackend();
  const root = mountPoint();
  flags.failData = true;
  await createHouseholdVia(root, { cloud: { url: 'u', anonKey: 'k' }, createClient });
  click(buttonByText('Sign out', root));
  await settle(15);
  assert.match(text(root), /Welcome back/);
});

test('failure: a failing save keeps the app usable and reports the error', async () => {
  const { backend, createClient } = flakyBackend();
  const root = mountPoint();
  await createHouseholdVia(root, { cloud: { url: 'u', anonKey: 'k' }, createClient });
  backend.db.household_members.length = 0; // simulate losing membership: RLS now rejects writes
  await addEntry(root, { amount: 100, category: 'Groceries' });
  await settle(15);
  assert.match(toastText(), /Not saved, and undone/);
  assert.match(toastText(), /row-level security/);
  const sheet = document.querySelector('.sheet');
  assert.ok(sheet, 'the form comes back so nothing typed is lost');
  assert.match(sheet.querySelector('input[inputmode=decimal]').value, /^100/);
  assert.doesNotMatch(text(root), /Groceries/, 'the entry that never saved is not left on screen');
});

/* ---------- removing someone, and them coming back ---------- */

async function twoPhonesInApp() {
  const backend = createFakeBackend();
  const rootA = mountPoint('app');
  const rootB = mountPoint('app-b');
  await signUpAndCreate(rootA, backend, { email: 'a@x.com', name: 'Shubham' });
  location.hash = '#/settings';
  await settle();
  const code = text(rootA.querySelector('[data-testid=invite-code]'));
  await signUpAndJoin(rootB, backend, { email: 'b@x.com', code, name: 'Priya' });
  return { backend, rootA, rootB, code };
}

test('cloud: a removed person is sent back to the join screen at once, and cannot rejoin with the old code', async () => {
  const { rootA, rootB, code } = await twoPhonesInApp();
  assert.ok(rootB.querySelector('.topbar'), 'Priya is in the app');

  click(rootA.querySelector('[aria-label="Remove Priya"]'));
  await settle(30);

  assert.match(text(rootB), /Start a household/, 'her screen changed without a reload');
  assert.equal(rootB.querySelector('.topbar'), null, 'she can no longer see the household');
  assert.match(text(rootA.querySelector('[data-testid=former-members]')), /Priya/);
  const newCode = text(rootA.querySelector('[data-testid=invite-code]'));
  assert.notEqual(newCode, code, 'the code was replaced on removal');

  const joinForm = rootB.querySelectorAll('form')[1];
  type(labelled('Invite code', joinForm), code);
  type(labelled('Your name', joinForm), 'Priya');
  submit(joinForm);
  await settle(20);
  assert.match(toastText(), /invalid invite code/);
});

test('cloud: the same person rejoining with the new code is the same account — listed once, entries still hers', async () => {
  const { backend, rootA, rootB } = await twoPhonesInApp();
  location.hash = '#/entries';
  await settle();
  await addEntry(rootB, { kind: 'income', amount: 65000, category: 'Salary' });
  await settle(20);

  location.hash = '#/settings';
  await settle();
  click(rootA.querySelector('[aria-label="Remove Priya"]'));
  await settle(30);
  const newCode = text(rootA.querySelector('[data-testid=invite-code]'));

  // Rejoin, typing the name in different capitals: her old row is a former member, so it does not clash.
  const joinForm = rootB.querySelectorAll('form')[1];
  type(labelled('Invite code', joinForm), newCode);
  type(labelled('Your name', joinForm), 'PRIYA');
  submit(joinForm);
  await settle(40);

  assert.ok(rootB.querySelector('.topbar'), 'back in the app');
  const rows = backend.db.household_members.filter((m) => m.display_name.toLowerCase() === 'priya');
  assert.equal(rows.length, 2, 'two membership rows');
  assert.equal(new Set(rows.map((m) => m.user_id)).size, 1, 'but one account');

  const people = [...rootA.querySelectorAll('[data-testid=members] li')].map(text);
  assert.equal(people.length, 2);
  assert.ok(people.some((t) => /PRIYA/.test(t)), 'listed once, active, with her new spelling');
  assert.equal(rootA.querySelector('[data-testid=former-members]'), null, 'not also shown as a former member');

  location.hash = '#/entries';
  await settle(20);
  assert.match(text(rootA.querySelector('.content')), /\+₹65,000\.00/, 'her earlier entry is still there');
  assert.doesNotMatch(text(rootA.querySelector('.content')), /\(former\)/, 'and is not labelled former');
});

test('cloud: joining with a name someone already uses (any capitals) is refused with a helpful message', async () => {
  const { backend, rootA, code } = await twoPhonesInApp();
  assert.ok(rootA);
  const rootC = mountPoint('app-c');
  await launch(rootC, cloudOptions(backend));
  type(labelled('Email', rootC), 'c@x.com');
  type(labelled('Password', rootC), 'password1');
  click(buttonByText('Create account', rootC));
  await settle(15);
  const joinForm = rootC.querySelectorAll('form')[1];
  type(labelled('Invite code', joinForm), code);
  type(labelled('Your name', joinForm), 'sHuBhAm');
  submit(joinForm);
  await settle(20);
  assert.match(toastText(), /already uses that name/);
  assert.match(toastText(), /capitals don’t matter/);
  assert.equal(rootC.querySelector('.topbar'), null, 'still on the join screen');

  type(labelled('Your name', joinForm), 'Shubham S');
  submit(joinForm);
  await settle(30);
  assert.ok(rootC.querySelector('.topbar'), 'a different name works');
});

test('a person filter that points at someone who left falls back to Together', async () => {
  const root = mountPoint();
  await launch(root);
  await signInLocal(root, 'Shubham');
  location.hash = '#/settings';
  await settle();
  click(buttonByText('Sign out', root));
  await settle();
  await signInLocal(root, 'Priya');
  location.hash = '#/dashboard';
  await settle();
  click([...root.querySelectorAll('.toolbar .segmented button')].find((b) => text(b).includes('Shubham')));
  assert.ok(root.querySelector('.toolbar .segmented'));

  // Shubham is removed from the household behind the app's back.
  await new Promise((resolve, reject) => {
    const open = indexedDB.open('SmartFinanceDB_v2', 1);
    open.onsuccess = () => {
      const store = open.result.transaction('household_members', 'readwrite').objectStore('household_members');
      const all = store.getAll();
      all.onsuccess = () => {
        all.result.filter((m) => m.display_name === 'Shubham').forEach((m) => store.delete(m.id));
        store.transaction.oncomplete = () => { open.result.close(); resolve(); };
      };
      all.onerror = () => reject(all.error);
    };
  });
  await addEntry(root, { kind: 'income', amount: 1000, category: 'Salary' });
  window.dispatchEvent(new Event('online')); // the app re-reads when the phone is back online
  await settle(15);

  assert.equal(root.querySelector('.toolbar .segmented'), null, 'only one member left, so no filter');
  assert.match(text(root.querySelector('.hero-value')), /₹1,000\.00/);
});

test('stopping the app cancels the "wait until you stop typing" retry', async () => {
  const backend = createFakeBackend();
  const clients = [];
  const options = { cloud: { url: 'u', anonKey: 'k' }, createClient: (...a) => { const c = backend.createClient(...a); clients.push(c); return c; } };
  const rootA = mountPoint('app');
  const rootB = mountPoint('app-b');
  await createHouseholdVia(rootA, options);
  location.hash = '#/settings';
  await settle();
  const code = text(rootA.querySelector('[data-testid=invite-code]'));

  const appB = await start(rootB, options);
  type(labelled('Email', rootB), 'b@x.com');
  type(labelled('Password', rootB), 'password1');
  click(buttonByText('Create account', rootB));
  await settle(15);
  const joinForm = rootB.querySelectorAll('form')[1];
  type(labelled('Invite code', joinForm), code);
  type(labelled('Your name', joinForm), 'Priya');
  submit(joinForm);
  await settle(20);

  location.hash = '#/goals';
  await settle();
  const typing = labelled('Goal', rootB.querySelector('form'));
  typing.focus();
  const { household_id, user_id } = backend.db.household_members[0];
  await clients[0].from('transactions').insert({
    household_id, created_by: user_id, kind: 'expense', amount_paise: 100, category: 'X', bucket: 'needs', occurred_on: todayISO(), note: '',
  }).select().single();
  await settle(10);

  appB.stop();
  const callsAfterStop = backend.calls.length;
  await tick(2300);
  assert.equal(backend.calls.length, callsAfterStop, 'no further backend calls after stop');
});

/* ---------- speed: patch, don't re-download ---------- */

const selectCount = (backend) => backend.calls.filter((c) => c.op === 'select').length;

test('sync: the other person\'s add, edit and delete arrive on screen without anyone re-downloading the data', async () => {
  const { backend, rootA, rootB } = await twoPhonesInApp();
  location.hash = '#/entries';
  await settle();
  const reads = selectCount(backend);

  await addEntry(rootA, { amount: 300, category: 'Groceries' });
  await settle(20);
  assert.match(text(rootB.querySelector('.content')), /₹300\.00/, 'B sees the new entry');
  assert.match(text(rootA.querySelector('.content')), /₹300\.00/);

  click(rootA.querySelector('[aria-label="Edit Groceries"]'));
  const sheet = document.querySelector('.sheet');
  type(labelled('Amount', sheet), '450');
  submit(sheet.querySelector('form'));
  await settle(20);
  assert.match(text(rootB.querySelector('.content')), /₹450\.00/, 'B sees the edit');
  assert.doesNotMatch(text(rootB.querySelector('.content')), /₹300\.00/);

  setConfirm(true);
  click(rootA.querySelector('[aria-label="Delete Groceries"]'));
  await settle(20);
  assert.doesNotMatch(text(rootB.querySelector('.content')), /Groceries/, 'B sees the delete (deletes cannot be filtered by household)');
  assert.doesNotMatch(text(rootA.querySelector('.content')), /Groceries/);
  assert.equal(backend.db.transactions.length, 0);

  assert.equal(selectCount(backend), reads, 'nothing was re-read from the database');
});

test('speed: your own entry is on screen and the sheet is closed before the server has answered', async () => {
  const backend = createFakeBackend();
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  // Every insert waits until the test lets it through.
  const slow = (...args) => {
    const client = backend.createClient(...args);
    const from = client.from;
    client.from = (table) => {
      const api = from(table);
      const insert = api.insert;
      api.insert = (row) => {
        const pending = insert(row);
        const run = pending.then.bind(pending);
        pending.then = (resolve, reject) => hold.then(() => run(resolve, reject));
        return pending;
      };
      return api;
    };
    return client;
  };
  const root = mountPoint();
  await launch(root, { cloud: { url: 'u', anonKey: 'k' }, createClient: slow });
  type(labelled('Email', root), 'a@x.com');
  type(labelled('Password', root), 'password1');
  click(buttonByText('Create account', root));
  await settle(15);
  // Creating the household uses an RPC, which is not held back.
  const [createForm] = root.querySelectorAll('form');
  type(labelled('Household name', createForm), 'Our home');
  type(labelled('Your name', createForm), 'Shubham');
  submit(createForm);
  await settle(20);
  location.hash = '#/entries';
  await settle();

  await addEntry(root, { amount: 777, category: 'Groceries' });
  assert.equal(backend.db.transactions.length, 0, 'the server has not been reached yet');
  assert.match(text(root.querySelector('.content')), /Groceries/);
  assert.match(text(root.querySelector('.content')), /₹777\.00/);
  assert.equal(document.querySelector('.sheet'), null, 'the sheet closed without waiting');
  assert.match(toastText(), /Entry saved/);

  release();
  await settle(20);
  assert.equal(backend.db.transactions.length, 1);
  assert.equal(root.querySelectorAll('li.entry').length, 1, 'the confirmed row replaced the guess instead of doubling it');
});

test('sync: a slow re-read that started before your change cannot wipe it from the screen', async () => {
  const backend = createFakeBackend();
  let readGate = null;
  // Reads run immediately but their answer is held back (so it is stale by the time it arrives).
  const gated = (...args) => {
    const client = backend.createClient(...args);
    const from = client.from;
    client.from = (table) => {
      const api = from(table);
      const run = api.then.bind(api);
      let isWrite = false;
      const insert = api.insert;
      api.insert = (row) => { isWrite = true; return insert(row); };
      const gate = () => readGate;
      api.then = (resolve, reject) => {
        const held = gate();
        return run(isWrite || !held ? resolve : (value) => held.then(() => resolve(value)), reject);
      };
      return api;
    };
    return client;
  };
  const root = mountPoint();
  await signUpAndCreate(root, { createClient: gated }, { email: 'a@x.com', name: 'Shubham' });
  location.hash = '#/entries';
  await settle();

  let releaseRead;
  readGate = new Promise((resolve) => { releaseRead = resolve; });
  window.dispatchEvent(new Event('online'));
  await settle(4);
  await addEntry(root, { amount: 250, category: 'Groceries' });
  assert.equal(root.querySelectorAll('li.entry').length, 1);

  releaseRead();
  readGate = null;
  await settle(10);
  assert.equal(root.querySelectorAll('li.entry').length, 1, 'the stale answer did not remove the new entry');
  await tick(600);
  await settle(10);
  assert.equal(root.querySelectorAll('li.entry').length, 1, 'and the follow-up read agrees with the database');
  assert.equal(backend.db.transactions.length, 1);
});

test('sync: a phone that lost its connection re-reads what it missed when the connection returns', async () => {
  const { backend, rootB } = await twoPhonesInApp();
  location.hash = '#/entries';
  await settle();
  const { household_id, user_id } = backend.db.household_members[0];
  // Happens while B is offline, so no realtime event reaches it.
  backend.db.transactions.push({
    id: crypto.randomUUID(), household_id, created_by: user_id, kind: 'expense', amount_paise: 123400, category: 'Travel', bucket: 'wants', occurred_on: todayISO(), note: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  assert.doesNotMatch(text(rootB.querySelector('.content')), /Travel/);

  backend.reconnect();
  await settle(20);
  assert.match(text(rootB.querySelector('.content')), /Travel/);
});

