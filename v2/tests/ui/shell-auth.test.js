import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, root, buttonByText, click, settle, submit, text, type, labelled } from '../helpers/dom.js';
import { makeViewCtx } from '../helpers/fixtures.js';
import { renderShell } from '../../src/app/shell.js';
import { renderAuthScreen } from '../../src/app/authScreen.js';
import { ROUTES } from '../../src/app/router.js';

installDom();
beforeEach(resetDom);

const toastText = () => text(document.getElementById('toast'));

async function shell(opts = {}) {
  const ctx = await makeViewCtx(opts);
  let rerenders = 0;
  ctx.rerender = () => { rerenders += 1; renderShell(root(), ctx); };
  renderShell(root(), ctx);
  return { ctx, rerenders: () => rerenders };
}

/* ---------- shell ---------- */

test('shell: sidebar and bottom tabs list every route with the active one marked', async () => {
  await shell({ route: 'goals' });
  for (const container of ['.sidebar', '.tabs']) {
    const links = [...root().querySelectorAll(`${container} a`)];
    assert.deepEqual(links.map((a) => a.getAttribute('href')), ROUTES.map((r) => `#/${r.id}`), container);
    const active = links.filter((a) => a.getAttribute('aria-current') === 'page');
    assert.equal(active.length, 1);
    assert.equal(active[0].getAttribute('href'), '#/goals');
    assert.ok(links.every((a) => a.querySelector('svg')), 'each link has an icon');
  }
});

test('shell: the page title follows the route', async () => {
  for (const route of ROUTES) {
    document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'app' }));
    await shell({ route: route.id });
    assert.equal(text(root().querySelector('.topbar h1')), route.title, route.id);
  }
});

test('shell: the month switcher appears only where a month matters', async () => {
  for (const [route, expected] of [['dashboard', true], ['entries', true], ['recurring', true], ['goals', false], ['settings', false]]) {
    document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'app' }));
    await shell({ route });
    assert.equal(Boolean(root().querySelector('.month-switch')), expected, route);
  }
});

test('shell: previous/next month buttons move the viewed month across year ends', async () => {
  const { ctx } = await shell({ monthId: '2026-01' });
  assert.match(text(root().querySelector('.month-switch')), /January 2026/);
  click(root().querySelector('[aria-label="Previous month"]'));
  assert.equal(ctx.state.get().monthId, '2025-12');
  click(root().querySelector('[aria-label="Next month"]'));
  click(root().querySelector('[aria-label="Next month"]'));
  assert.equal(ctx.state.get().monthId, '2026-02');
});

test('shell: the person filter lists everyone and changes state when clicked', async () => {
  const { ctx } = await shell();
  const buttons = [...root().querySelectorAll('.toolbar .segmented button')];
  assert.deepEqual(buttons.map(text), ['Together', 'Shubham', 'Priya'].map((n) => (n === 'Together' ? n : `${n[0]}${n}`)));
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
  click(buttons[2]);
  assert.equal(ctx.state.get().personId, ctx.members[1].user_id);
});

test('shell: the person filter is hidden on other screens and when you are the only member', async () => {
  await shell({ route: 'recurring' });
  assert.equal(root().querySelector('.toolbar .segmented'), null);
  document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'app' }));
  await shell({ names: ['Solo'] });
  assert.equal(root().querySelector('.toolbar .segmented'), null);
});

test('shell: the floating action button opens the new-entry sheet from any screen', async () => {
  await shell({ route: 'goals' });
  click(root().querySelector('.fab'));
  assert.equal(text(document.querySelector('.sheet h2')), 'New entry');
});

test('shell: the theme toggle flips the theme and re-renders', async () => {
  const { rerenders } = await shell();
  assert.equal(document.documentElement.dataset.theme, undefined);
  click(root().querySelector('[aria-label="Toggle dark mode"]'));
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(rerenders(), 1);
  assert.ok(root().querySelector('[aria-label="Toggle dark mode"] svg'), 'icon re-rendered');
});

test('shell: shows who is signed in and their household', async () => {
  await shell({ active: 1 });
  const user = text(root().querySelector('.side-user'));
  assert.match(user, /Priya/);
  assert.match(user, /Test home/);
});

test('shell: renders the active feature into the content area', async () => {
  await shell({ route: 'dashboard' });
  assert.ok(root().querySelector('#content .hero'));
  document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'app' }));
  await shell({ route: 'entries' });
  assert.ok(root().querySelector('#content .card'));
  assert.equal(root().querySelector('#content .hero'), null);
});

test('shell: an unknown route falls back to the first screen', async () => {
  await shell({ route: 'does-not-exist' });
  assert.equal(text(root().querySelector('.topbar h1')), ROUTES[0].title);
});

/* ---------- auth screens ---------- */

const fakeAuth = (mode, overrides = {}) => {
  const calls = [];
  const record = (name) => async (...args) => { calls.push([name, ...args]); };
  return {
    mode, calls, signIn: record('signIn'), signUp: async (...a) => { calls.push(['signUp', ...a]); return { needsConfirmation: false }; },
    createHousehold: record('createHousehold'), joinHousehold: record('joinHousehold'), signOut: record('signOut'), ...overrides,
  };
};

test('auth screen (local): asks for a name and signs in with it', async () => {
  const auth = fakeAuth('local');
  renderAuthScreen(root(), { auth, session: null, refresh: async () => {} });
  assert.match(text(root()), /Who is using the app\?/);
  type(labelled('Your name'), 'Shubham');
  submit(root().querySelector('form'));
  await settle();
  assert.deepEqual(auth.calls, [['signIn', { displayName: 'Shubham' }]]);
});

test('auth screen: errors from sign-in are shown, not thrown', async () => {
  const auth = fakeAuth('local', { signIn: async () => { throw new Error('Enter a name.'); } });
  renderAuthScreen(root(), { auth, session: null, refresh: async () => {} });
  submit(root().querySelector('form'));
  await settle();
  assert.match(toastText(), /Enter a name/);
});

test('auth screen (cloud): sign in sends email and password', async () => {
  const auth = fakeAuth('cloud');
  renderAuthScreen(root(), { auth, session: null, refresh: async () => {} });
  type(labelled('Email'), 'a@x.com');
  type(labelled('Password'), 'password1');
  submit(root().querySelector('form'));
  await settle();
  assert.deepEqual(auth.calls, [['signIn', { email: 'a@x.com', password: 'password1' }]]);
});

test('auth screen (cloud): create account, with and without email confirmation', async () => {
  let confirm = true;
  const auth = fakeAuth('cloud', { signUp: async () => ({ needsConfirmation: confirm }) });
  renderAuthScreen(root(), { auth, session: null, refresh: async () => {} });
  type(labelled('Email'), 'a@x.com');
  type(labelled('Password'), 'password1');
  click(buttonByText('Create account'));
  await settle();
  assert.match(toastText(), /Check your email/);
  confirm = false;
  click(buttonByText('Create account'));
  await settle();
  assert.match(toastText(), /Account created/);
});

test('auth screen (cloud): create account sends nothing when the form is invalid', async () => {
  const auth = fakeAuth('cloud');
  renderAuthScreen(root(), { auth, session: null, refresh: async () => {} });
  click(buttonByText('Create account'));
  await settle();
  assert.equal(auth.calls.filter(([n]) => n === 'signUp').length, 0);
});

test('auth screen (cloud): a signed-in user without a household can create or join one', async () => {
  const auth = fakeAuth('cloud');
  let refreshes = 0;
  const session = { userId: 'u1', householdId: null };
  renderAuthScreen(root(), { auth, session, refresh: async () => { refreshes += 1; } });
  const [createForm, joinForm] = root().querySelectorAll('form');

  type(labelled('Household name', createForm), 'Our home');
  type(labelled('Your name', createForm), 'Shubham');
  submit(createForm);
  await settle();
  assert.deepEqual(auth.calls.at(-1), ['createHousehold', { name: 'Our home', displayName: 'Shubham' }]);
  assert.equal(refreshes, 1);

  type(labelled('Invite code', joinForm), 'abc123');
  type(labelled('Your name', joinForm), 'Priya');
  submit(joinForm);
  await settle();
  assert.deepEqual(auth.calls.at(-1), ['joinHousehold', { code: 'abc123', displayName: 'Priya' }]);
  assert.equal(refreshes, 2);
});

test('auth screen: pressing Create household repeatedly sends one request', async () => {
  let release;
  const auth = fakeAuth('cloud', { createHousehold: (args) => { auth.calls.push(['createHousehold', args]); return new Promise((r) => { release = r; }); } });
  renderAuthScreen(root(), { auth, session: { householdId: null }, refresh: async () => {} });
  const form = root().querySelectorAll('form')[0];
  type(labelled('Household name', form), 'Our home');
  type(labelled('Your name', form), 'Shubham');
  submit(form);
  submit(form);
  click(buttonByText('Create household', form));
  assert.equal(auth.calls.filter(([n]) => n === 'createHousehold').length, 1);
  assert.equal(buttonByText('Create household', form).disabled, true, 'button is disabled while waiting');
  release();
  await settle();
});

test('auth screen: "already in a household" means it worked, so it carries on instead of showing an error', async () => {
  const auth = fakeAuth('cloud', { createHousehold: async () => { throw new Error('already in a household'); } });
  let refreshes = 0;
  renderAuthScreen(root(), { auth, session: { householdId: null }, refresh: async () => { refreshes += 1; } });
  const form = root().querySelectorAll('form')[0];
  type(labelled('Household name', form), 'Our home');
  type(labelled('Your name', form), 'Shubham');
  submit(form);
  await settle();
  assert.equal(refreshes, 1);
  assert.doesNotMatch(toastText(), /already in a household/);
});

test('auth screen: joining when already in a household also carries on', async () => {
  const auth = fakeAuth('cloud', { joinHousehold: async () => { throw new Error('already in a household'); } });
  let refreshes = 0;
  renderAuthScreen(root(), { auth, session: { householdId: null }, refresh: async () => { refreshes += 1; } });
  const joinForm = root().querySelectorAll('form')[1];
  type(labelled('Invite code', joinForm), 'abc');
  type(labelled('Your name', joinForm), 'Priya');
  submit(joinForm);
  await settle();
  assert.equal(refreshes, 1);
});

test('auth screen: other household errors are still reported (only "already in" is treated as success)', async () => {
  for (const message of ['household is full', 'invalid invite code', 'duplicate key value violates unique constraint']) {
    document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'app' }));
    const auth = fakeAuth('cloud', { joinHousehold: async () => { throw new Error(message); } });
    let refreshes = 0;
    renderAuthScreen(root(), { auth, session: { householdId: null }, refresh: async () => { refreshes += 1; } });
    const joinForm = root().querySelectorAll('form')[1];
    type(labelled('Invite code', joinForm), 'abc');
    type(labelled('Your name', joinForm), 'Priya');
    submit(joinForm);
    await settle();
    assert.equal(refreshes, 0, message);
    assert.match(toastText(), new RegExp(message.split(' ')[0]), message);
  }
});

test('auth screen: the sign-in form cannot be double-submitted either', async () => {
  let release;
  const auth = fakeAuth('cloud', { signIn: (args) => { auth.calls.push(['signIn', args]); return new Promise((r) => { release = r; }); } });
  renderAuthScreen(root(), { auth, session: null, refresh: async () => {} });
  type(labelled('Email'), 'a@x.com');
  type(labelled('Password'), 'password1');
  const form = root().querySelector('form');
  submit(form);
  submit(form);
  assert.equal(auth.calls.filter(([n]) => n === 'signIn').length, 1);
  release();
  await settle();
});

test('auth screen: a failed join shows the server message and does not refresh', async () => {
  const auth = fakeAuth('cloud', { joinHousehold: async () => { throw new Error('invalid invite code'); } });
  let refreshes = 0;
  renderAuthScreen(root(), { auth, session: { householdId: null }, refresh: async () => { refreshes += 1; } });
  const joinForm = root().querySelectorAll('form')[1];
  type(labelled('Invite code', joinForm), 'bad');
  type(labelled('Your name', joinForm), 'Priya');
  submit(joinForm);
  await settle();
  assert.match(toastText(), /invalid invite code/);
  assert.equal(refreshes, 0);
});

test('auth screen: a user without a household can sign out', async () => {
  const auth = fakeAuth('cloud');
  renderAuthScreen(root(), { auth, session: { householdId: null }, refresh: async () => {} });
  click(buttonByText('Sign out'));
  assert.deepEqual(auth.calls, [['signOut']]);
});

test('auth screen: re-rendering replaces the previous screen', async () => {
  const auth = fakeAuth('local');
  renderAuthScreen(root(), { auth, session: null, refresh: async () => {} });
  renderAuthScreen(root(), { auth, session: null, refresh: async () => {} });
  assert.equal(root().querySelectorAll('.auth-wrap').length, 1);
});
