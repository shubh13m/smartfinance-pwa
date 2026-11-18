import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  installDom, resetDom, buttonByText, click, labelled, setConfirm, settle, submit, text, type,
} from '../helpers/dom.js';
import { makeViewCtx } from '../helpers/fixtures.js';
import { renderTransactions } from '../../src/features/transactions/view.js';
import { openEntrySheet } from '../../src/features/transactions/entryForm.js';

installDom();
beforeEach(resetDom);

const exp = (o = {}) => ({ kind: 'expense', amount_paise: 25000, category: 'Groceries', bucket: 'needs', occurred_on: '2026-03-05', note: '', ...o });
const toastText = () => text(document.getElementById('toast'));
const sheet = () => document.querySelector('.sheet');

async function seeded() {
  const ctx = await makeViewCtx();
  const [a, b] = Object.values(ctx.ledgers);
  await a.addTransaction({ kind: 'income', amount_paise: 9000000, category: 'Salary', occurred_on: '2026-03-01', note: '' });
  await a.addTransaction(exp({ amount_paise: 2800000, category: 'Housing', note: 'Rent', occurred_on: '2026-03-02' }));
  await b.addTransaction(exp({ amount_paise: 480000, category: 'Shopping', bucket: 'wants', note: 'Clothes', occurred_on: '2026-03-10' }));
  await b.addTransaction(exp({ amount_paise: 99900, category: 'Groceries', occurred_on: '2026-04-02' }));
  await ctx.reload();
  return ctx;
}

test('entries: each day is its own block, rows are entry rows, and long notes carry the full text as a tooltip', async () => {
  const ctx = await seeded();
  const long = 'x'.repeat(150);
  await ctx.ledger.addTransaction(exp({ note: long, occurred_on: '2026-03-15' }));
  await ctx.reload();
  const view = ctx.view(renderTransactions);
  const days = [...view.querySelectorAll('.day')];
  assert.equal(days.length, 4);
  for (const day of days) {
    assert.ok(day.querySelector('.date-head'), 'each day has its heading');
    assert.ok(day.querySelector('ul.list'));
    assert.ok(day.querySelector('li.entry'));
  }
  assert.equal(view.querySelectorAll('.card > .date-head').length, 0, 'headings are not direct card children (that dropped their spacing)');
  const sub = [...view.querySelectorAll('.entry .item-sub')].find((el) => el.textContent.includes(long));
  assert.equal(sub.getAttribute('title'), sub.textContent, 'the full note is available even when the text is clamped');
});

test('entries: an empty month has no day blocks', async () => {
  const ctx = await makeViewCtx();
  assert.equal(ctx.view(renderTransactions).querySelectorAll('.day').length, 0);
});

test('entries: the amount, the text and both buttons are all present in each row', async () => {
  const ctx = await seeded();
  const row = ctx.view(renderTransactions).querySelector('li.entry');
  assert.ok(row.querySelector('.avatar'));
  assert.ok(row.querySelector('.grow .item-title'));
  assert.ok(row.querySelector('.item-amount'));
  assert.equal(row.querySelectorAll('.item-actions button').length, 2);
});

/* ---------- list ---------- */

test('entries: lists the month grouped by day, newest first, with who entered each', async () => {
  const ctx = await seeded();
  const view = ctx.view(renderTransactions);
  const heads = [...view.querySelectorAll('.date-head')].map(text);
  assert.equal(heads.length, 3);
  assert.match(heads[0], /10 Mar/);
  assert.match(heads[2], /1 Mar/);
  const items = [...view.querySelectorAll('.list-item')].map(text);
  assert.equal(items.length, 3, 'April entry is not shown in March');
  assert.match(items[0], /Shopping.*Clothes · Priya.*−₹4,800\.00/);
  assert.match(items[1], /Housing.*Rent · Shubham.*−₹28,000\.00/);
  assert.match(items[2], /Salary.*Shubham.*\+₹90,000\.00/);
});

test('entries: subtitle summarises count, money in and money out', async () => {
  const ctx = await seeded();
  assert.match(text(ctx.view(renderTransactions).querySelector('.card-sub')), /3 this month · in ₹90,000\.00 · out ₹32,800\.00/);
});

test('entries: income is styled as positive', async () => {
  const ctx = await seeded();
  const amounts = [...ctx.view(renderTransactions).querySelectorAll('.item-amount')];
  assert.ok(amounts.at(-1).classList.contains('pos'));
  assert.ok(!amounts[0].classList.contains('pos'));
});

test('entries: person filter shows only that person\'s entries and totals', async () => {
  const ctx = await seeded();
  ctx.state.set({ personId: ctx.members[1].user_id });
  const view = ctx.view(renderTransactions);
  assert.equal(view.querySelectorAll('.list-item').length, 1);
  assert.match(text(view.querySelector('.card-sub')), /1 this month · in ₹0\.00 · out ₹4,800\.00/);
});

test('entries: month navigation changes what is listed', async () => {
  const ctx = await seeded();
  ctx.state.set({ monthId: '2026-04' });
  const view = ctx.view(renderTransactions);
  assert.equal(view.querySelectorAll('.list-item').length, 1);
  assert.match(text(view), /₹999\.00/);
});

test('entries: an empty month shows a friendly empty state', async () => {
  const ctx = await makeViewCtx();
  const view = ctx.view(renderTransactions);
  assert.match(text(view), /No entries yet/);
  assert.equal(view.querySelectorAll('.list-item').length, 0);
});

test('entries: markup in notes and categories is shown as plain text (XSS)', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addTransaction(exp({ category: '<b>Bold</b>', note: '<img src=x onerror="window.pwned=1">' }));
  await ctx.reload();
  const view = ctx.view(renderTransactions);
  assert.equal(view.querySelector('.list-item img'), null);
  assert.equal(view.querySelector('.list-item b'), null);
  assert.match(text(view.querySelector('.list-item')), /<b>Bold<\/b>/);
  assert.equal(window.pwned, undefined);
});

/* ---------- row actions ---------- */

test('entries: delete asks first, and only deletes when confirmed', async () => {
  const ctx = await seeded();
  let view = ctx.view(renderTransactions);
  setConfirm(false);
  click(view.querySelector('[aria-label="Delete Housing"]'));
  await settle();
  assert.equal(ctx.data.transactions.length, 4);

  setConfirm(true);
  click(view.querySelector('[aria-label="Delete Housing"]'));
  await settle();
  assert.equal(ctx.data.transactions.length, 3);
  assert.match(toastText(), /Entry deleted/);
  document.body.replaceChildren();
  view = ctx.view(renderTransactions);
  assert.equal(view.querySelectorAll('.list-item').length, 2);
});

test('entries: either person can delete the other person\'s entry', async () => {
  const ctx = await seeded();
  const view = ctx.view(renderTransactions);
  click(view.querySelector('[aria-label="Delete Shopping"]'));
  await settle();
  assert.ok(!ctx.data.transactions.some((t) => t.category === 'Shopping'));
});

test('entries: the Add button opens an empty "New entry" sheet', async () => {
  const ctx = await seeded();
  click(buttonByText('Add', ctx.view(renderTransactions).querySelector('.card-head')));
  assert.equal(text(sheet().querySelector('h2')), 'New entry');
  assert.equal(labelled('Amount').value, '');
});

/* ---------- entry form ---------- */

test('form: valid expense is saved, the sheet closes and data refreshes', async () => {
  const ctx = await makeViewCtx();
  openEntrySheet(ctx);
  type(labelled('Amount'), '1,250.50');
  type(labelled('Date'), '2026-03-09');
  type(labelled('Category'), 'Groceries');
  type(labelled('Note'), 'Weekly shop');
  submit(sheet().querySelector('form'));
  await settle();

  assert.equal(sheet(), null);
  assert.match(toastText(), /Entry saved/);
  const [saved] = ctx.data.transactions;
  assert.deepEqual(
    [saved.kind, saved.amount_paise, saved.category, saved.bucket, saved.note, saved.occurred_on, saved.created_by],
    ['expense', 125050, 'Groceries', 'needs', 'Weekly shop', '2026-03-09', ctx.session.userId],
  );
});

test('form: a non-numeric amount shows an error and keeps the sheet open', async () => {
  const ctx = await makeViewCtx();
  openEntrySheet(ctx);
  type(labelled('Amount'), 'abc');
  type(labelled('Category'), 'Groceries');
  submit(sheet().querySelector('form'));
  await settle();
  assert.ok(sheet());
  assert.match(toastText(), /Enter a valid amount/);
  assert.equal(ctx.data.transactions.length, 0);
});

test('form: a server-side validation error is shown and nothing is saved', async () => {
  const ctx = await makeViewCtx();
  openEntrySheet(ctx);
  type(labelled('Amount'), '0');
  type(labelled('Category'), 'Groceries');
  submit(sheet().querySelector('form'));
  await settle();
  assert.ok(sheet());
  assert.match(toastText(), /Amount must be greater than zero/);
  assert.equal(ctx.data.transactions.length, 0);
});

test('form: choosing Income hides the plan bucket, switches categories, and saves without a bucket', async () => {
  const ctx = await makeViewCtx();
  openEntrySheet(ctx);
  const bucketField = labelled('Plan bucket').closest('label');
  assert.equal(bucketField.hidden, false);
  assert.ok([...document.querySelectorAll('#entry-categories option')].some((o) => o.value === 'Groceries'));

  click(buttonByText('Income', sheet()));
  assert.equal(bucketField.hidden, true);
  const options = [...document.querySelectorAll('#entry-categories option')].map((o) => o.value);
  assert.ok(options.includes('Salary'));
  assert.ok(!options.includes('Groceries'));

  type(labelled('Amount'), '50000');
  type(labelled('Category'), 'Salary');
  submit(sheet().querySelector('form'));
  await settle();
  assert.deepEqual([ctx.data.transactions[0].kind, ctx.data.transactions[0].bucket], ['income', null]);
});

test('form: toggling back to Expense shows the bucket again', async () => {
  const ctx = await makeViewCtx();
  openEntrySheet(ctx);
  click(buttonByText('Income', sheet()));
  click(buttonByText('Expense', sheet()));
  assert.equal(labelled('Plan bucket').closest('label').hidden, false);
});

test('form: typing a known category pre-selects its plan bucket; unknown ones leave it alone', async () => {
  const ctx = await makeViewCtx();
  openEntrySheet(ctx);
  type(labelled('Category'), 'Dining Out');
  assert.equal(labelled('Plan bucket').value, 'wants');
  type(labelled('Category'), 'Savings & Invest');
  assert.equal(labelled('Plan bucket').value, 'savings');
  type(labelled('Category'), 'Totally custom');
  assert.equal(labelled('Plan bucket').value, 'savings');
});

test('form: a manually chosen bucket is used', async () => {
  const ctx = await makeViewCtx();
  openEntrySheet(ctx);
  type(labelled('Amount'), '10');
  type(labelled('Category'), 'Custom thing');
  type(labelled('Plan bucket'), 'savings');
  submit(sheet().querySelector('form'));
  await settle();
  assert.equal(ctx.data.transactions[0].bucket, 'savings');
});

test('form: editing pre-fills every field and updates the same entry', async () => {
  const ctx = await seeded();
  const target = ctx.data.transactions.find((t) => t.category === 'Housing');
  openEntrySheet(ctx, target);

  assert.equal(text(sheet().querySelector('h2')), 'Edit entry');
  assert.equal(labelled('Amount').value, '28000');
  assert.equal(labelled('Category').value, 'Housing');
  assert.equal(labelled('Note').value, 'Rent');
  assert.equal(labelled('Date').value, '2026-03-02');
  assert.equal(labelled('Plan bucket').value, 'needs');
  assert.ok(buttonByText('Save changes', sheet()));

  type(labelled('Amount'), '30000');
  submit(sheet().querySelector('form'));
  await settle();

  assert.match(toastText(), /Entry updated/);
  assert.equal(ctx.data.transactions.length, 4, 'no duplicate created');
  const updated = ctx.data.transactions.find((t) => t.id === target.id);
  assert.equal(updated.amount_paise, 3000000);
  assert.equal(updated.created_by, target.created_by);
});

test('form: editing an income entry opens in income mode', async () => {
  const ctx = await seeded();
  openEntrySheet(ctx, ctx.data.transactions.find((t) => t.kind === 'income'));
  assert.equal(labelled('Plan bucket').closest('label').hidden, true);
  assert.equal(buttonByText('Income', sheet()).getAttribute('aria-pressed'), 'true');
});

test('form: the date defaults to today', async () => {
  const ctx = await makeViewCtx();
  openEntrySheet(ctx);
  assert.match(labelled('Date').value, /^\d{4}-\d{2}-\d{2}$/);
});

test('form: submitting twice at once (double-click) saves exactly one entry', async () => {
  const ctx = await makeViewCtx();
  openEntrySheet(ctx);
  type(labelled('Amount'), '100');
  type(labelled('Category'), 'Groceries');
  const form = sheet().querySelector('form');
  submit(form);
  submit(form);
  submit(form);
  await settle(15);
  assert.equal(ctx.data.transactions.length, 1);
});

test('form: after a failed save the form works again for a retry', async () => {
  const ctx = await makeViewCtx();
  openEntrySheet(ctx);
  type(labelled('Amount'), '0');
  type(labelled('Category'), 'Groceries');
  const form = sheet().querySelector('form');
  submit(form);
  await settle();
  assert.equal(buttonByText('Add entry', form).disabled, false);
  type(labelled('Amount'), '50');
  submit(form);
  await settle();
  assert.equal(ctx.data.transactions.length, 1);
});
