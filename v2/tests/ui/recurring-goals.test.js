import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, buttonByText, click, labelled, setConfirm, settle, submit, text, type } from '../helpers/dom.js';
import { makeViewCtx } from '../helpers/fixtures.js';
import { renderRecurring } from '../../src/features/recurring/view.js';
import { renderGoals } from '../../src/features/goals/view.js';

installDom();
beforeEach(resetDom);

const toastText = () => text(document.getElementById('toast'));
const rent = { kind: 'expense', name: 'Rent', amount_paise: 2800000, frequency: 'monthly', start_on: '2026-01-01', category: 'Housing', bucket: 'needs' };
const insurance = { kind: 'expense', name: 'Car insurance', amount_paise: 2400000, frequency: 'yearly', due_month: 9, start_on: '2026-01-01', category: 'Insurance', bucket: 'needs' };
const formOf = (view) => [...view.querySelectorAll('form')].find((f) => buttonByText('Add item', f));

/* ---------- recurring ---------- */

test('recurring: empty state explains what to do', async () => {
  const ctx = await makeViewCtx();
  assert.match(text(ctx.view(renderRecurring)), /Nothing recurring yet/);
});

test('recurring: list shows amount, frequency, owner and period', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledgers.Shubham.addRecurring(rent);
  await ctx.ledgers.Priya.addRecurring(insurance);
  await ctx.reload();
  const items = [...ctx.view(renderRecurring).querySelectorAll('.list-item')].map(text);
  assert.equal(items.length, 2);
  assert.match(items[0], /Car insurance.*₹24,000\.00 every September.*Priya/);
  assert.match(items[1], /Rent.*₹28,000\.00 \/ month.*from 2026-01-01.*Shubham/);
});

test('recurring: ended and not-yet-started items are dimmed', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addRecurring({ ...rent, name: 'Past', end_on: '2026-02-28' });
  await ctx.ledger.addRecurring({ ...rent, name: 'Future', start_on: '2026-09-01' });
  await ctx.ledger.addRecurring({ ...rent, name: 'Current' });
  await ctx.reload();
  const items = Object.fromEntries([...ctx.view(renderRecurring).querySelectorAll('.list-item')].map((li) => [text(li.querySelector('.item-title')), li]));
  assert.ok(items.Past.classList.contains('inactive'));
  assert.ok(items.Future.classList.contains('inactive'));
  assert.ok(!items.Current.classList.contains('inactive'));
});

test('recurring: the due-month field only appears for yearly items', async () => {
  const ctx = await makeViewCtx();
  const form = formOf(ctx.view(renderRecurring));
  const dueField = labelled('Due month', form).closest('label');
  assert.equal(dueField.hidden, true);
  type(labelled('How often', form), 'yearly');
  assert.equal(dueField.hidden, false);
  type(labelled('How often', form), 'monthly');
  assert.equal(dueField.hidden, true);
});

test('recurring: the plan bucket is hidden for income and categories follow the type', async () => {
  const ctx = await makeViewCtx();
  const form = formOf(ctx.view(renderRecurring));
  const bucket = labelled('Plan bucket', form).closest('label');
  assert.equal(bucket.hidden, false);
  type(labelled('Type', form), 'income');
  assert.equal(bucket.hidden, true);
  assert.ok([...document.querySelectorAll('#rec-categories option')].some((o) => o.value === 'Salary'));
  type(labelled('Type', form), 'expense');
  assert.ok([...document.querySelectorAll('#rec-categories option')].some((o) => o.value === 'Housing'));
});

test('recurring: adds a monthly item', async () => {
  const ctx = await makeViewCtx();
  const form = formOf(ctx.view(renderRecurring));
  type(labelled('Name', form), 'Internet');
  type(labelled('Amount', form), '1,199');
  type(labelled('Category', form), 'Utilities');
  submit(form);
  await settle();
  const [item] = ctx.data.recurring;
  assert.deepEqual([item.name, item.amount_paise, item.frequency, item.due_month, item.bucket, item.end_on], ['Internet', 119900, 'monthly', null, 'needs', null]);
  assert.match(toastText(), /Recurring item added/);
});

test('recurring: adds a yearly item with its due month, and recurring income without a bucket', async () => {
  const ctx = await makeViewCtx();
  let form = formOf(ctx.view(renderRecurring));
  type(labelled('Name', form), 'Insurance');
  type(labelled('Amount', form), '12000');
  type(labelled('How often', form), 'yearly');
  type(labelled('Due month', form), '4');
  type(labelled('Category', form), 'Insurance');
  submit(form);
  await settle();

  document.body.replaceChildren();
  form = formOf(ctx.view(renderRecurring));
  type(labelled('Type', form), 'income');
  type(labelled('Name', form), 'Salary');
  type(labelled('Amount', form), '80000');
  type(labelled('Category', form), 'Salary');
  submit(form);
  await settle();

  const yearly = ctx.data.recurring.find((r) => r.name === 'Insurance');
  assert.deepEqual([yearly.frequency, yearly.due_month], ['yearly', 4]);
  const income = ctx.data.recurring.find((r) => r.name === 'Salary');
  assert.deepEqual([income.kind, income.bucket], ['income', null]);
});

test('recurring: invalid input is reported and nothing is saved', async () => {
  const ctx = await makeViewCtx();
  let form = formOf(ctx.view(renderRecurring));
  type(labelled('Name', form), 'X');
  type(labelled('Amount', form), 'nope');
  type(labelled('Category', form), 'Utilities');
  submit(form);
  await settle();
  assert.match(toastText(), /Enter a valid amount/);

  document.body.replaceChildren();
  form = formOf(ctx.view(renderRecurring));
  type(labelled('Name', form), '   ');
  type(labelled('Amount', form), '10');
  type(labelled('Category', form), 'Utilities');
  submit(form);
  await settle();
  assert.match(toastText(), /Name is required/);
  assert.equal(ctx.data.recurring.length, 0);
});

test('recurring: "Stop" ends an active item after the viewed month and keeps history', async () => {
  const ctx = await makeViewCtx({ monthId: '2026-05' });
  await ctx.ledger.addRecurring(rent);
  await ctx.reload();
  const view = ctx.view(renderRecurring);
  click(buttonByText('Stop', view));
  await settle();
  assert.equal(ctx.data.recurring[0].end_on, '2026-05-31');
  assert.match(toastText(), /Stopped/);
  document.body.replaceChildren();
  assert.equal(buttonByText('Stop', ctx.view(renderRecurring)), null, 'already-ended items cannot be stopped again');
});

test('recurring: no Stop button for items that are not active this month', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addRecurring({ ...rent, start_on: '2026-09-01' });
  await ctx.reload();
  assert.equal(buttonByText('Stop', ctx.view(renderRecurring)), null);
});

test('recurring: delete asks first and removes the item entirely', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addRecurring(rent);
  await ctx.reload();
  const view = ctx.view(renderRecurring);
  setConfirm(false);
  click(view.querySelector('[aria-label="Delete Rent"]'));
  await settle();
  assert.equal(ctx.data.recurring.length, 1);
  setConfirm(true);
  click(view.querySelector('[aria-label="Delete Rent"]'));
  await settle();
  assert.equal(ctx.data.recurring.length, 0);
});

/* ---------- goals ---------- */

const goalCards = (view) => [...view.querySelectorAll('.card')].filter((c) => c.querySelector('.meter'));
const addGoalForm = (view) => [...view.querySelectorAll('form')].find((f) => buttonByText('Add goal', f));

test('goals: empty state invites the first goal', async () => {
  const ctx = await makeViewCtx();
  assert.match(text(ctx.view(renderGoals)), /No goals yet/);
});

test('goals: adding a goal validates and stores it', async () => {
  const ctx = await makeViewCtx();
  let view = ctx.view(renderGoals);
  let form = addGoalForm(view);
  type(labelled('Goal', form), 'Goa trip');
  type(labelled('Target', form), '60,000');
  type(labelled('Deadline', form), '2027-03-31');
  submit(form);
  await settle();
  assert.deepEqual([ctx.data.goals[0].name, ctx.data.goals[0].target_paise, ctx.data.goals[0].deadline], ['Goa trip', 6000000, '2027-03-31']);

  document.body.replaceChildren();
  view = ctx.view(renderGoals);
  form = addGoalForm(view);
  type(labelled('Goal', form), 'Bad');
  type(labelled('Target', form), 'zero');
  submit(form);
  await settle();
  assert.match(toastText(), /Enter a valid target/);
  assert.equal(ctx.data.goals.length, 1);
});

test('goals: a goal can be added without a deadline', async () => {
  const ctx = await makeViewCtx();
  const form = ctx.view(renderGoals).querySelector('form');
  type(labelled('Goal', form), 'Rainy day');
  type(labelled('Target', form), '1000');
  submit(form);
  await settle();
  assert.equal(ctx.data.goals[0].deadline, null);
});

test('goals: shows saved vs target, percent, and the monthly amount needed', async () => {
  const ctx = await makeViewCtx();
  const goal = await ctx.ledger.addGoal({ name: 'Trip', target_paise: 6000000, deadline: '2099-12-31' });
  await ctx.ledger.addContribution({ goal_id: goal.id, amount_paise: 1000000, contributed_on: '2026-03-01' });
  await ctx.ledgers.Priya.addContribution({ goal_id: goal.id, amount_paise: 500000, contributed_on: '2026-03-02' });
  await ctx.reload();
  const [card] = goalCards(ctx.view(renderGoals));
  assert.match(text(card), /Trip/);
  assert.match(text(card), /₹15,000\.00of ₹60,000\.00 · 25%/);
  assert.match(text(card), /Save ₹[\d,]+\.\d\d\/month for \d+ month\(s\) to finish by 2099-12-31/);
  assert.equal(card.querySelector('.bar-fill').style.width, '25%');
});

test('goals: messages for completed, overdue and open-ended goals', async () => {
  const ctx = await makeViewCtx();
  const done = await ctx.ledger.addGoal({ name: 'Done', target_paise: 1000, deadline: null });
  await ctx.ledger.addContribution({ goal_id: done.id, amount_paise: 1000, contributed_on: '2026-03-01' });
  await ctx.ledger.addGoal({ name: 'Late', target_paise: 1000, deadline: '2020-01-01' });
  await ctx.ledger.addGoal({ name: 'Open', target_paise: 1000, deadline: null });
  await ctx.reload();
  const cards = Object.fromEntries(goalCards(ctx.view(renderGoals)).map((c) => [text(c.querySelector('.card-title')), c]));
  assert.match(text(cards.Done), /Goal reached/);
  assert.ok(cards.Done.querySelector('.bar-fill').classList.contains('ahead'));
  assert.match(text(cards.Late), /deadline has passed/);
  assert.ok(cards.Late.querySelector('.bar-fill').classList.contains('over'));
  assert.match(text(cards.Open), /Set a deadline/);
});

test('goals: contributing adds to progress; bad amounts are rejected', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addGoal({ name: 'Trip', target_paise: 100000, deadline: null });
  await ctx.reload();
  let [card] = goalCards(ctx.view(renderGoals));
  type(card.querySelector('.inline-form input'), '250');
  submit(card.querySelector('.inline-form'));
  await settle();
  assert.equal(ctx.data.contributions[0].amount_paise, 25000);
  assert.match(toastText(), /Contribution added/);

  document.body.replaceChildren();
  [card] = goalCards(ctx.view(renderGoals));
  assert.match(text(card), /₹250\.00of ₹1,000\.00 · 25%/);
  type(card.querySelector('.inline-form input'), 'abc');
  submit(card.querySelector('.inline-form'));
  await settle();
  assert.match(toastText(), /Enter a valid amount/);
  assert.equal(ctx.data.contributions.length, 1);
});

test('goals: deleting asks first and removes the goal with its contributions', async () => {
  const ctx = await makeViewCtx();
  const goal = await ctx.ledger.addGoal({ name: 'Trip', target_paise: 1000, deadline: null });
  await ctx.ledger.addContribution({ goal_id: goal.id, amount_paise: 100, contributed_on: '2026-03-01' });
  await ctx.reload();
  const view = ctx.view(renderGoals);
  setConfirm(false);
  click(view.querySelector('[aria-label="Delete goal Trip"]'));
  await settle();
  assert.equal(ctx.data.goals.length, 1);
  setConfirm(true);
  click(view.querySelector('[aria-label="Delete goal Trip"]'));
  await settle();
  assert.deepEqual([ctx.data.goals.length, ctx.data.contributions.length], [0, 0]);
});

test('goals: goal names are rendered as text, not markup', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addGoal({ name: '<img src=x onerror="window.pwned=1">', target_paise: 1000, deadline: null });
  await ctx.reload();
  const view = ctx.view(renderGoals);
  assert.equal(view.querySelector('.card img'), null);
  assert.equal(window.pwned, undefined);
});
