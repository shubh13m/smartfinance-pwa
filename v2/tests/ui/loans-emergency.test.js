import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, buttonByText, click, labelled, setConfirm, settle, submit, text, type } from '../helpers/dom.js';
import { makeViewCtx } from '../helpers/fixtures.js';
import { renderGoals } from '../../src/features/goals/view.js';
import { renderLoans } from '../../src/features/loans/view.js';

installDom();
beforeEach(resetDom);

const toastText = () => text(document.getElementById('toast'));
const addLoanForm = (view) => [...view.querySelectorAll('form')].find((f) => buttonByText('Add loan', f));
const loan = { name: 'Home loan', outstanding_paise: 50000000, rate_pct: 9, emi_paise: 600000 };
const block = (view, name = 'Home loan') => view.querySelector(`[data-loan="${name}"]`);

/* ---------- emergency fund flag on goals ---------- */

const goalForm = (view) => [...view.querySelectorAll('form')].find((f) => buttonByText('Add goal', f));

test('goals: the emergency-fund checkbox is offered and saves the flag', async () => {
  const ctx = await makeViewCtx();
  const form = goalForm(ctx.view(renderGoals));
  type(labelled('Goal', form), 'Rainy day');
  type(labelled('Target', form), '300000');
  form.querySelector('#is-emergency').checked = true;
  submit(form);
  await settle();
  assert.equal(ctx.data.goals[0].is_emergency, true);
});

test('goals: a normal goal is not flagged', async () => {
  const ctx = await makeViewCtx();
  const form = goalForm(ctx.view(renderGoals));
  type(labelled('Goal', form), 'Trip');
  type(labelled('Target', form), '1000');
  submit(form);
  await settle();
  assert.equal(ctx.data.goals[0].is_emergency, false);
});

test('goals: only one emergency fund — the checkbox disappears once there is one, and a second is refused', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addGoal({ name: 'EF', target_paise: 100000, deadline: null, is_emergency: true });
  await ctx.reload();
  assert.equal(goalForm(ctx.view(renderGoals)).querySelector('#is-emergency'), null);
  await assert.rejects(() => ctx.ledger.addGoal({ name: 'EF2', target_paise: 1, deadline: null, is_emergency: true }), /already have an emergency fund/);
});

test('goals: the emergency fund is labelled on its card', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addGoal({ name: 'EF', target_paise: 100000, deadline: null, is_emergency: true });
  await ctx.reload();
  assert.match(text(ctx.view(renderGoals)), /EF\s*Emergency fund/);
});

/* ---------- loans ---------- */

test('loans: empty state invites the first loan', async () => {
  const ctx = await makeViewCtx();
  assert.match(text(ctx.view(renderLoans)), /No loans added/);
});

test('loans: adding a loan validates and stores it', async () => {
  const ctx = await makeViewCtx();
  const form = addLoanForm(ctx.view(renderLoans));
  type(labelled('Loan name', form), 'Car loan');
  type(labelled('Outstanding balance', form), '5,00,000');
  type(labelled('Interest rate', form), '8.5');
  type(labelled('Monthly EMI', form), '12000');
  submit(form);
  await settle();
  const [saved] = ctx.data.loans;
  assert.deepEqual([saved.name, saved.outstanding_paise, saved.rate_pct, saved.emi_paise], ['Car loan', 50000000, 8.5, 1200000]);
  assert.match(toastText(), /Loan added/);
});

test('loans: bad input is rejected with a clear message', async () => {
  const ctx = await makeViewCtx();
  const fill = (form, values) => {
    type(labelled('Loan name', form), values.name);
    type(labelled('Outstanding balance', form), values.out);
    type(labelled('Interest rate', form), values.rate);
    type(labelled('Monthly EMI', form), values.emi);
  };
  let form = addLoanForm(ctx.view(renderLoans));
  fill(form, { name: 'X', out: 'abc', rate: '8', emi: '100' });
  submit(form);
  await settle();
  assert.match(toastText(), /Enter valid amounts/);

  document.body.replaceChildren();
  form = addLoanForm(ctx.view(renderLoans));
  fill(form, { name: 'X', out: '1000', rate: '99', emi: '100' });
  submit(form);
  await settle();
  assert.match(toastText(), /between 0 and 60 percent/);

  document.body.replaceChildren();
  form = addLoanForm(ctx.view(renderLoans));
  fill(form, { name: 'X', out: '1000', rate: '8', emi: '0' });
  submit(form);
  await settle();
  assert.match(toastText(), /EMI must be greater than zero/);
  assert.equal(ctx.data.loans.length, 0);
});

test('loans: each loan shows its facts and when it clears', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addLoan(loan);
  await ctx.reload();
  const b = block(ctx.view(renderLoans));
  assert.match(text(b), /Outstanding₹5,00,000\.00/);
  assert.match(text(b), /Interest9% a year/);
  assert.match(text(b), /EMI₹6,000\.00/);
  assert.match(text(b.querySelector('[data-testid=payoff]')), /Clears in \d+ months? \(.+\) · ₹[\d,]+\.\d\d interest still to pay/);
});

test('loans: an EMI that does not cover the interest is flagged', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addLoan({ ...loan, emi_paise: 100000 });
  await ctx.reload();
  assert.match(text(block(ctx.view(renderLoans))), /EMI is lower than the monthly interest/);
});

test('loans: a fully paid loan says so', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addLoan({ ...loan, outstanding_paise: 0 });
  await ctx.reload();
  assert.match(text(block(ctx.view(renderLoans))), /Fully paid off/);
});

test('prepay planner: starts neutral, then shows months and interest saved as you type', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addLoan(loan);
  await ctx.reload();
  const b = block(ctx.view(renderLoans));
  const result = () => text(b.querySelector('[data-testid=prepay-result]'));
  assert.match(result(), /Enter an amount to see the effect/);

  type(labelled('Extra every month', b), '1000');
  assert.match(result(), /Done \d+ months? sooner \(.+\) and ₹[\d,]+\.\d\d less interest/);

  type(labelled('Extra every month', b), '');
  type(labelled('One-time prepayment', b), '100000');
  assert.match(result(), /sooner/);
});

test('prepay planner: more money saves more interest', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addLoan(loan);
  await ctx.reload();
  const b = block(ctx.view(renderLoans));
  const saved = () => Number(text(b.querySelector('[data-testid=prepay-result]')).match(/₹([\d,]+)\.\d\d less/)[1].replaceAll(',', ''));
  type(labelled('Extra every month', b), '1000');
  const small = saved();
  type(labelled('Extra every month', b), '5000');
  assert.ok(saved() > small);
});

test('prepay planner: junk input is treated as zero, not as NaN', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addLoan(loan);
  await ctx.reload();
  const b = block(ctx.view(renderLoans));
  type(labelled('Extra every month', b), 'abc');
  assert.doesNotMatch(text(b.querySelector('[data-testid=prepay-result]')), /NaN/);
  assert.match(text(b.querySelector('[data-testid=prepay-result]')), /Enter an amount/);
});

test('prepay planner: an extra payment that rescues a too-low EMI says the loan would now clear', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addLoan({ ...loan, emi_paise: 100000 });
  await ctx.reload();
  const b = block(ctx.view(renderLoans));
  type(labelled('Extra every month', b), '5000');
  assert.match(text(b.querySelector('[data-testid=prepay-result]')), /would clear the loan in \d+ months?.*alone never would/);
});

test('prepay planner: "use safe to spend" fills the one-time prepayment from this month', async () => {
  const ctx = await makeViewCtx();
  const today = new Date().toISOString().slice(0, 7);
  const date = `${today}-01`;
  await ctx.ledger.addTransaction({ kind: 'income', amount_paise: 10000000, category: 'Salary', occurred_on: date, note: '' });
  await ctx.ledger.addLoan(loan);
  await ctx.reload();
  const b = block(ctx.view(renderLoans));
  const button_ = buttonByText('safe to spend', b);
  assert.ok(button_, 'offered when there is money safe to spend');
  click(button_);
  assert.equal(Number(labelled('One-time prepayment', b).value) > 0, true);
  assert.match(text(b.querySelector('[data-testid=prepay-result]')), /sooner/);
});

test('prepay planner: no safe-to-spend shortcut when nothing is safe', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addLoan(loan);
  await ctx.reload();
  assert.equal(buttonByText('safe to spend', block(ctx.view(renderLoans))), null);
});

test('loans: the outstanding balance can be updated and the rest of the loan is kept', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addLoan(loan);
  await ctx.reload();
  const b = block(ctx.view(renderLoans));
  type(b.querySelector('.inline-form input'), '4,50,000');
  submit(b.querySelector('.inline-form'));
  await settle();
  const [saved] = ctx.data.loans;
  assert.deepEqual([saved.outstanding_paise, saved.rate_pct, saved.emi_paise, saved.name], [45000000, 9, 600000, 'Home loan']);
  assert.match(toastText(), /Balance updated/);
});

test('loans: an invalid balance is rejected', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addLoan(loan);
  await ctx.reload();
  const b = block(ctx.view(renderLoans));
  type(b.querySelector('.inline-form input'), 'abc');
  submit(b.querySelector('.inline-form'));
  await settle();
  assert.match(toastText(), /Enter a valid balance/);
  assert.equal(ctx.data.loans[0].outstanding_paise, 50000000);
});

test('loans: deleting asks first', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addLoan(loan);
  await ctx.reload();
  const view = ctx.view(renderLoans);
  setConfirm(false);
  click(view.querySelector('[aria-label="Delete loan Home loan"]'));
  await settle();
  assert.equal(ctx.data.loans.length, 1);
  setConfirm(true);
  click(view.querySelector('[aria-label="Delete loan Home loan"]'));
  await settle();
  assert.equal(ctx.data.loans.length, 0);
});

test('loans: names are rendered as text, never markup', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addLoan({ ...loan, name: '<img src=x onerror="window.pwned=1">' });
  await ctx.reload();
  const view = ctx.view(renderLoans);
  assert.equal(view.querySelector('.loan img'), null);
  assert.equal(window.pwned, undefined);
});

test('loans: double-submitting the add form saves one loan', async () => {
  const ctx = await makeViewCtx();
  const form = addLoanForm(ctx.view(renderLoans));
  type(labelled('Loan name', form), 'Car');
  type(labelled('Outstanding balance', form), '1000');
  type(labelled('Interest rate', form), '8');
  type(labelled('Monthly EMI', form), '100');
  submit(form);
  submit(form);
  await settle(15);
  assert.equal(ctx.data.loans.length, 1);
});
