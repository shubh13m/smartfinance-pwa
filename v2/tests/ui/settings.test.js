import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { installDom, resetDom, buttonByText, click, labelled, setConfirm, settle, submit, text, type } from '../helpers/dom.js';
import { makeViewCtx } from '../helpers/fixtures.js';
import { renderSettings, IMPORT_FLAG } from '../../src/features/settings/view.js';
import { THEME_KEY } from '../../src/ui/theme.js';

installDom();
beforeEach(resetDom);

const toastText = () => text(document.getElementById('toast'));
const splitForm = (view) => [...view.querySelectorAll('form')].find((f) => buttonByText('Save plan', f));

async function seedLegacyDb() {
  globalThis.indexedDB = new IDBFactory();
  await new Promise((resolve, reject) => {
    const open = indexedDB.open('SmartFinanceDB_v1', 2);
    open.onupgradeneeded = () => open.result.createObjectStore('months', { keyPath: 'id' });
    open.onsuccess = () => {
      const tx = open.result.transaction('months', 'readwrite');
      tx.objectStore('months').put({
        id: '2026-01', income: { base: 50000, extras: [] },
        daily: [{ amount: 120, category: 'Food & Dining', note: 'Tea', date: '2026-01-02', ts: 1 }],
        recurringMonthly: [{ name: 'Rent', amount: 12000, ts: 11 }], recurringYearly: [],
      });
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/* ---------- budget plan ---------- */

test('settings: the plan form shows the current split and a live total', async () => {
  const ctx = await makeViewCtx();
  const form = splitForm(ctx.view(renderSettings));
  assert.deepEqual(['Needs %', 'Wants %', 'Savings & Investments %'].map((l) => labelled(l, form).value), ['50', '30', '20']);
  assert.match(text(form), /Total 100%/);
  assert.ok(form.querySelector('strong').classList.contains('pos'));
});

test('settings: the total updates as you type and turns red when it is not 100', async () => {
  const ctx = await makeViewCtx();
  const form = splitForm(ctx.view(renderSettings));
  type(labelled('Needs %', form), '60');
  assert.match(text(form), /Total 110%/);
  assert.ok(form.querySelector('strong').classList.contains('neg'));
  type(labelled('Wants %', form), '20');
  assert.match(text(form), /Total 100%/);
});

test('settings: a valid plan is saved and shared', async () => {
  const ctx = await makeViewCtx();
  const form = splitForm(ctx.view(renderSettings));
  type(labelled('Needs %', form), '60');
  type(labelled('Wants %', form), '20');
  submit(form);
  await settle();
  assert.deepEqual(ctx.data.split, { needs: 60, wants: 20, savings: 20 });
  assert.match(toastText(), /Budget plan saved/);
  assert.deepEqual(await ctx.ledgers.Priya.getSplit(), { needs: 60, wants: 20, savings: 20 });
});

test('settings: a plan that does not add to 100 is rejected and not saved', async () => {
  const ctx = await makeViewCtx();
  const form = splitForm(ctx.view(renderSettings));
  type(labelled('Needs %', form), '70');
  submit(form);
  await settle();
  assert.match(toastText(), /add up to 100/);
  assert.deepEqual(ctx.data.split, { needs: 50, wants: 30, savings: 20 });
});

/* ---------- appearance ---------- */

test('settings: choosing a theme applies it, remembers it and asks for a re-render', async () => {
  const ctx = await makeViewCtx();
  let rerenders = 0;
  ctx.rerender = () => { rerenders += 1; };
  const view = ctx.view(renderSettings);
  click(buttonByText('Dark', view));
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(localStorage.getItem(THEME_KEY), 'dark');
  assert.equal(rerenders, 1);
  click(buttonByText('Light', view));
  assert.equal(document.documentElement.dataset.theme, 'light');
});

test('settings: the active theme button is marked pressed', async () => {
  const ctx = await makeViewCtx();
  document.documentElement.dataset.theme = 'dark';
  const view = ctx.view(renderSettings);
  assert.equal(buttonByText('Dark', view).getAttribute('aria-pressed'), 'true');
  assert.equal(buttonByText('Light', view).getAttribute('aria-pressed'), 'false');
});

/* ---------- household ---------- */

test('settings: lists household members', async () => {
  const ctx = await makeViewCtx();
  const view = ctx.view(renderSettings);
  const card = [...view.querySelectorAll('.card')].find((c) => text(c).includes('Test home'));
  assert.match(text(card), /2 member\(s\)/);
  assert.match(text(card), /Shubham/);
  assert.match(text(card), /Priya/);
});

test('settings: local mode explains that data stays on the device', async () => {
  const ctx = await makeViewCtx();
  const view = ctx.view(renderSettings);
  assert.match(text(view), /Local mode/);
  assert.equal(view.querySelector('[data-testid=invite-code]'), null);
});

test('settings: cloud mode shows the invite code to share', async () => {
  const ctx = await makeViewCtx();
  ctx.session.inviteCode = 'abc123def456';
  const view = ctx.view(renderSettings);
  assert.equal(text(view.querySelector('[data-testid=invite-code]')), 'abc123def456');
  assert.doesNotMatch(text(view), /Local mode/);
});

test('settings: sign out calls the auth service', async () => {
  const ctx = await makeViewCtx();
  click(buttonByText('Sign out', ctx.view(renderSettings)));
  assert.equal(ctx.signOut.calls, 1);
});

test('settings: the account card names who is signed in', async () => {
  const ctx = await makeViewCtx({ active: 1 });
  assert.match(text(ctx.view(renderSettings)), /Signed in as Priya/);
});

/* ---------- import / export ---------- */

test('import: with no data from the original app, tells the user and imports nothing', async () => {
  const ctx = await makeViewCtx();
  globalThis.indexedDB = new IDBFactory();
  click(buttonByText('Import from original app', ctx.view(renderSettings)));
  await settle(20);
  assert.match(toastText(), /No data from the original app/);
  assert.equal(ctx.data.transactions.length, 0);
});

test('import: brings over income, expenses and recurring items attributed to the importer', async () => {
  const ctx = await makeViewCtx();
  await seedLegacyDb();
  click(buttonByText('Import from original app', ctx.view(renderSettings)));
  await settle(30);
  assert.match(toastText(), /Imported 3 items/);
  assert.equal(ctx.data.transactions.length, 2);
  assert.equal(ctx.data.recurring.length, 1);
  assert.ok(ctx.data.transactions.every((t) => t.created_by === ctx.session.userId));
  assert.ok(localStorage.getItem(IMPORT_FLAG));
});

test('import: a second import asks for confirmation and does nothing if declined', async () => {
  const ctx = await makeViewCtx();
  await seedLegacyDb();
  localStorage.setItem(IMPORT_FLAG, 'earlier');
  setConfirm(false);
  click(buttonByText('Import from original app', ctx.view(renderSettings)));
  await settle(30);
  assert.equal(ctx.data.transactions.length, 0);
});

test('import: a confirmed second import goes ahead', async () => {
  const ctx = await makeViewCtx();
  await seedLegacyDb();
  localStorage.setItem(IMPORT_FLAG, 'earlier');
  setConfirm(true);
  click(buttonByText('Import from original app', ctx.view(renderSettings)));
  await settle(30);
  assert.equal(ctx.data.transactions.length, 2);
});

test('export: downloads a JSON backup of the household data', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addTransaction({ kind: 'income', amount_paise: 100, category: 'Salary', occurred_on: '2026-03-01', note: '' });
  await ctx.reload();
  let blob;
  const created = URL.createObjectURL;
  const revoked = URL.revokeObjectURL;
  URL.createObjectURL = (b) => { blob = b; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  const clicked = [];
  const proto = window.HTMLAnchorElement.prototype;
  const original = proto.click;
  proto.click = function click() { clicked.push({ href: this.href, download: this.download }); };
  try {
    click(buttonByText('Export backup', ctx.view(renderSettings)));
  } finally {
    URL.createObjectURL = created;
    URL.revokeObjectURL = revoked;
    proto.click = original;
  }
  assert.equal(clicked.length, 1);
  assert.match(clicked[0].download, /^smartfinance-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(await blob.text());
  assert.equal(exported.transactions.length, 1);
  assert.deepEqual(Object.keys(exported).sort(), ['contributions', 'goals', 'loans', 'members', 'recurring', 'split', 'transactions']);
});
