import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, buttonByText, click, text } from '../helpers/dom.js';
import { makeViewCtx } from '../helpers/fixtures.js';
import { renderDashboard } from '../../src/features/dashboard/view.js';

installDom();
beforeEach(resetDom);

const base = { kind: 'expense', amount_paise: 100, category: 'Groceries', bucket: 'needs', occurred_on: '2026-03-05', note: '' };
const salary = (amount) => ({ kind: 'income', amount_paise: amount, category: 'Salary', occurred_on: '2026-03-01', note: '' });

async function seed(ctx) {
  const [a, b] = Object.values(ctx.ledgers);
  await a.addTransaction(salary(9000000));
  await b.addTransaction(salary(6500000));
  await a.addTransaction({ ...base, amount_paise: 2800000, category: 'Housing' });
  await a.addTransaction({ ...base, amount_paise: 350000, category: 'Dining Out', bucket: 'wants' });
  await b.addTransaction({ ...base, amount_paise: 1500000, category: 'Savings & Invest', bucket: 'savings' });
  await ctx.reload();
}

const hero = (c) => text(c.querySelector('.hero'));

test('dashboard: hero shows left this month and safe to spend, with income, spent and invested', async () => {
  const ctx = await makeViewCtx();
  await seed(ctx);
  const view = ctx.view(renderDashboard);
  // Income 1,55,000 − spent 46,500 = 1,08,500 left; 20% plan target 31,000 − invested 15,000 = 16,000 still to invest.
  assert.equal(text(view.querySelector('.hero-value')), '₹1,08,500.00');
  assert.equal(text(view.querySelector('[data-testid=safe-to-spend]')), '₹92,500.00');
  const h = hero(view);
  assert.match(h, /March 2026 · Month closed/);
  assert.match(h, /Left this month/);
  assert.match(h, /Safe to spend/);
  assert.match(h, /after holding back ₹16,000 to invest/);
  assert.match(h, /Income₹1,55,000/);
  assert.match(h, /Spent₹46,500/);
  assert.match(h, /Invested \(20% plan\)₹15,000/);
});

test('dashboard: three budget rings with 50/30/20 targets and statuses', async () => {
  const ctx = await makeViewCtx();
  await seed(ctx);
  const view = ctx.view(renderDashboard);
  const cards = [...view.querySelectorAll('.ring-card')];
  assert.deepEqual(cards.map((c) => c.dataset.bucket), ['needs', 'wants', 'savings']);
  assert.match(text(cards[0]), /Needs.*On track.*₹28,000\.00 of ₹77,500\.00/);
  assert.match(text(cards[1]), /Wants.*On track.*₹3,500\.00 of ₹46,500\.00/);
  assert.match(text(cards[2]), /Savings & Investments.*Below target.*₹15,000\.00 of ₹31,000\.00/);
  assert.match(text(view), /Your split: 50 \/ 30 \/ 20/);
});

test('dashboard: ring statuses react to overspending and to meeting the savings target', async () => {
  const ctx = await makeViewCtx();
  const [a] = Object.values(ctx.ledgers);
  await a.addTransaction(salary(1000000));
  await a.addTransaction({ ...base, amount_paise: 600000, category: 'Housing' });
  await a.addTransaction({ ...base, amount_paise: 250000, category: 'Savings & Invest', bucket: 'savings' });
  await ctx.reload();
  const cards = [...ctx.view(renderDashboard).querySelectorAll('.ring-card')];
  assert.match(text(cards[0]), /Over budget/);
  assert.match(text(cards[2]), /On target/);
  assert.ok(cards[0].querySelector('.ring-fill').classList.contains('over'));
});

test('dashboard: no income shows an empty plan instead of zero targets', async () => {
  const ctx = await makeViewCtx();
  const view = ctx.view(renderDashboard);
  assert.match(text(view), /Add income to see targets/);
  assert.equal(view.querySelectorAll('.ring-card').length, 0);
  assert.match(text(view), /Nothing here yet/);
  assert.doesNotMatch(text(view), /null|undefined|NaN/);
});

test('dashboard: who-contributed table lists each person with their own totals', async () => {
  const ctx = await makeViewCtx();
  await seed(ctx);
  const rows = [...ctx.view(renderDashboard).querySelectorAll('.table tbody tr')].map(text);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.includes('Shubham')), 'SShubham₹90,000.00₹31,500.00');
  assert.equal(rows.find((r) => r.includes('Priya')), 'PPriya₹65,000.00₹15,000.00');
});

test('dashboard: the people table is hidden when there is only one member', async () => {
  const ctx = await makeViewCtx({ names: ['Solo'] });
  await ctx.ledger.addTransaction(salary(100000));
  await ctx.reload();
  assert.equal(ctx.view(renderDashboard).querySelector('.table'), null);
});

test('dashboard: person filter narrows every number to that person', async () => {
  const ctx = await makeViewCtx();
  await seed(ctx);
  ctx.state.set({ personId: ctx.members[1].user_id });
  const view = ctx.view(renderDashboard);
  assert.match(hero(view), /₹65,000/);
  assert.match(hero(view), /₹15,000/);
  assert.match(text(view.querySelector('.hero-value')), /₹50,000\.00/);
});

test('dashboard: categories are ranked by spend', async () => {
  const ctx = await makeViewCtx();
  await seed(ctx);
  const names = [...ctx.view(renderDashboard).querySelectorAll('.meter .meter-head span')].map(text);
  assert.deepEqual(names.slice(0, 3), ['Housing', 'Savings & Invest', 'Dining Out']);
});

test('dashboard: the basis toggle updates state and the explanatory hint', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addRecurring({ kind: 'expense', name: 'Insurance', amount_paise: 1200000, frequency: 'yearly', due_month: 3, start_on: '2026-01-01', category: 'Insurance', bucket: 'needs' });
  await ctx.reload();

  let view = ctx.view(renderDashboard);
  assert.match(text(view), /spread over 12 months/);
  assert.match(text(view.querySelector('.hero-stats')), /₹1,000/);

  click(buttonByText('Cash flow', view));
  assert.equal(ctx.state.get().basis, 'cash');
  document.body.replaceChildren();
  view = ctx.view(renderDashboard);
  assert.match(text(view), /appear when paid/);
  assert.match(text(view.querySelector('.hero-stats')), /₹12,000/);
});

test('dashboard: upcoming bills lists what falls due in the 30 days from the viewed month', async () => {
  const ctx = await makeViewCtx();
  const rec = { kind: 'expense', start_on: '2026-01-01', category: 'Insurance', bucket: 'needs' };
  await ctx.ledger.addRecurring({ ...rec, name: 'Rent', amount_paise: 1000000, frequency: 'monthly' });
  await ctx.ledger.addRecurring({ ...rec, name: 'Car insurance', amount_paise: 2400000, frequency: 'yearly', due_month: 3 });
  await ctx.ledger.addRecurring({ ...rec, name: 'Gym yearly', amount_paise: 600000, frequency: 'yearly', due_month: 9 });
  await ctx.ledger.addRecurring({ ...rec, kind: 'income', bucket: null, name: 'Salary SIP', amount_paise: 100, frequency: 'monthly' });
  await ctx.reload();
  const view = ctx.view(renderDashboard);
  const dueCard = [...view.querySelectorAll('.card')].find((c) => text(c.querySelector('.card-title')) === 'Upcoming bills');
  const due = text(dueCard);
  assert.match(due, /Rent/);
  assert.match(due, /Car insurance/);
  assert.doesNotMatch(due, /Gym yearly/);
  assert.doesNotMatch(due, /Salary SIP/);
  assert.match(due, /2 payments/);
  assert.match(due, /₹34,000\.00/);
});

test('dashboard: six-month trend with the viewed month highlighted', async () => {
  const ctx = await makeViewCtx();
  await seed(ctx);
  const cols = [...ctx.view(renderDashboard).querySelectorAll('.trend-col')];
  assert.equal(cols.length, 6);
  assert.deepEqual(cols.map((c) => text(c.querySelector('.trend-label'))), ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']);
  assert.ok(cols.at(-1).classList.contains('current'));
  const bars = cols.at(-1).querySelectorAll('.trend-bar');
  assert.equal(bars[0].style.height, '100%');
  assert.equal(cols[0].querySelector('.trend-bar').style.height, '0%');
});

test('dashboard: nothing renders the literal text "null"', async () => {
  const ctx = await makeViewCtx({ names: ['Solo'] });
  assert.doesNotMatch(text(ctx.view(renderDashboard)), /\bnull\b/);
});

test('dashboard: navigating months changes the figures', async () => {
  const ctx = await makeViewCtx();
  await seed(ctx);
  ctx.state.set({ monthId: '2026-04' });
  const view = ctx.view(renderDashboard);
  assert.match(hero(view), /April 2026/);
  assert.match(text(view.querySelector('.hero-value')), /₹0\.00/);
});
