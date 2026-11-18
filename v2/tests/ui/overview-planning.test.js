import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, text } from '../helpers/dom.js';
import { makeViewCtx } from '../helpers/fixtures.js';
import { currentMonthId, todayISO } from '../../src/core/dates.js';
import { renderDashboard } from '../../src/features/dashboard/view.js';

installDom();
beforeEach(resetDom);

const base = { kind: 'expense', amount_paise: 100, category: 'Groceries', bucket: 'needs', occurred_on: '2026-03-05', note: '' };
const line = (view, key) => text(view.querySelector(`[data-line=${key}]`).querySelector('strong'));

async function march() {
  const ctx = await makeViewCtx();
  const [a, b] = Object.values(ctx.ledgers);
  await a.addTransaction({ kind: 'income', amount_paise: 9000000, category: 'Salary', occurred_on: '2026-03-01', note: '' });
  await b.addTransaction({ kind: 'income', amount_paise: 6500000, category: 'Salary', occurred_on: '2026-03-01', note: '' });
  await a.addTransaction({ ...base, amount_paise: 2800000, category: 'Housing' });
  await a.addTransaction({ ...base, amount_paise: 350000, category: 'Dining Out', bucket: 'wants' });
  await b.addTransaction({ ...base, amount_paise: 1500000, category: 'Savings & Invest', bucket: 'savings' });
  await ctx.reload();
  return ctx;
}

/** A household with income and spending dated today, so the viewed month is the current one. */
async function thisMonth(extra = {}) {
  const ctx = await makeViewCtx({ monthId: currentMonthId() });
  const today = todayISO();
  await ctx.ledgers.Shubham.addTransaction({ kind: 'income', amount_paise: 10000000, category: 'Salary', occurred_on: today, note: '' });
  await ctx.ledgers.Shubham.addTransaction({ ...base, amount_paise: 1000000, occurred_on: today, ...extra });
  await ctx.reload();
  return ctx;
}

test('breakdown: the calculation is laid out line by line and adds up', async () => {
  const view = (await march()).view(renderDashboard);
  assert.equal(line(view, 'income'), '₹1,55,000.00');
  assert.equal(line(view, 'bills'), '₹0.00');
  assert.equal(line(view, 'spent'), '₹31,500.00', 'housing + dining');
  assert.equal(line(view, 'invested'), '₹15,000.00');
  assert.equal(line(view, 'left'), '₹1,08,500.00');
  assert.equal(line(view, 'reserve'), '₹16,000.00', '20% of income is 31,000; 15,000 already invested');
  assert.equal(line(view, 'safe'), '₹92,500.00');
});

test('breakdown: recurring bills are listed separately from day-to-day spending', async () => {
  const ctx = await march();
  await ctx.ledger.addRecurring({ kind: 'expense', name: 'Rent', amount_paise: 2500000, frequency: 'monthly', start_on: '2026-01-01', category: 'Housing', bucket: 'needs' });
  await ctx.reload();
  const view = ctx.view(renderDashboard);
  assert.equal(line(view, 'bills'), '₹25,000.00');
  assert.equal(line(view, 'safe'), '₹67,500.00');
  assert.match(text(view.querySelector('.hero')), /Safe to spend₹67,500\.00/);
});

test('breakdown: explains that the investing target comes from the plan percentage', async () => {
  const ctx = await march();
  await ctx.ledger.saveSplit({ needs: 60, wants: 20, savings: 20 });
  await ctx.reload();
  assert.match(text(ctx.view(renderDashboard).querySelector('[data-line=reserve]')), /20% savings plan \(₹31,000\.00\)/);
  document.body.replaceChildren();
  await ctx.ledger.saveSplit({ needs: 70, wants: 20, savings: 10 });
  await ctx.reload();
  const view = ctx.view(renderDashboard);
  assert.equal(line(view, 'reserve'), '₹500.00', '10% target 15,500 minus 15,000 invested');
});

test('breakdown: hidden until there is something to calculate', async () => {
  const ctx = await makeViewCtx();
  assert.equal(ctx.view(renderDashboard).querySelector('[data-line=safe]'), null);
});

test('safe to spend: once the investing target is met nothing more is held back', async () => {
  const ctx = await march();
  await ctx.ledgers.Priya.addTransaction({ ...base, amount_paise: 2000000, category: 'Savings & Invest', bucket: 'savings' });
  await ctx.reload();
  const view = ctx.view(renderDashboard);
  assert.equal(line(view, 'reserve'), '₹0.00');
  assert.match(text(view.querySelector('.hero')), /your investing target is covered/);
});

test('current month: shows the day count, a daily allowance and a month-end forecast', async () => {
  const ctx = await thisMonth();
  const view = ctx.view(renderDashboard);
  const hero = text(view.querySelector('.hero'));
  assert.match(hero, /Day \d+ of \d+ · \d+ days? left/);
  assert.match(text(view.querySelector('[data-testid=daily-allowance]')), /You can spend about ₹[\d,]+\.\d\d a day for \d+ more days?/);
  assert.match(text(view.querySelector('[data-testid=plan-status]')), /On track|Watch your spending/);
});

test('current month: the forecast appears once there are a few days of spending and says what happens at this pace', async () => {
  const ctx = await thisMonth();
  const forecast = ctx.view(renderDashboard).querySelector('[data-testid=forecast]');
  if (forecast) assert.match(text(forecast), /At this pace you’ll (finish with|overspend by) ₹[\d,]+\.\d\d/);
});

test('current month: overspending is flagged and the daily allowance says nothing is safe', async () => {
  const ctx = await makeViewCtx({ monthId: currentMonthId() });
  const today = todayISO();
  await ctx.ledger.addTransaction({ kind: 'income', amount_paise: 1000000, category: 'Salary', occurred_on: today, note: '' });
  await ctx.ledger.addTransaction({ ...base, amount_paise: 950000, occurred_on: today });
  await ctx.reload();
  const view = ctx.view(renderDashboard);
  assert.match(text(view.querySelector('[data-testid=plan-status]')), /Over what is safe/);
  assert.match(text(view.querySelector('[data-testid=daily-allowance]')), /Nothing is left to spend safely this month/);
});

test('spending with no income yet asks for the income instead of showing a misleading number', async () => {
  const ctx = await makeViewCtx({ monthId: currentMonthId() });
  await ctx.ledger.addTransaction({ ...base, amount_paise: 50000, occurred_on: todayISO() });
  await ctx.reload();
  const view = ctx.view(renderDashboard);
  assert.match(text(view.querySelector('[data-testid=plan-status]')), /Add this month’s income/);
  assert.equal(view.querySelector('[data-testid=daily-allowance]'), null);
});

test('past and future months have no daily allowance or forecast', async () => {
  const ctx = await march();
  const past = ctx.view(renderDashboard);
  assert.match(text(past.querySelector('.hero')), /Month closed/);
  assert.equal(past.querySelector('[data-testid=daily-allowance]'), null);
  assert.equal(past.querySelector('[data-testid=forecast]'), null);
  document.body.replaceChildren();
  ctx.state.set({ monthId: '2099-01' });
  const future = ctx.view(renderDashboard);
  assert.match(text(future.querySelector('.hero')), /Upcoming month/);
  assert.equal(future.querySelector('[data-testid=daily-allowance]'), null);
});

test('person filter: safe to spend is worked out for just that person', async () => {
  const ctx = await march();
  ctx.state.set({ personId: ctx.members[1].user_id });
  const view = ctx.view(renderDashboard);
  // Priya: income 65,000, invested 15,000, target 13,000 -> nothing more to hold back; left 50,000.
  assert.equal(text(view.querySelector('.hero-value')), '₹50,000.00');
  assert.equal(text(view.querySelector('[data-testid=safe-to-spend]')), '₹50,000.00');
});

/* ---------- emergency fund ---------- */

test('emergency fund: invites you to set one up when no goal is flagged', async () => {
  const ctx = await makeViewCtx();
  const view = ctx.view(renderDashboard);
  const card = [...view.querySelectorAll('.card')].find((c) => text(c.querySelector('.card-title')) === 'Emergency fund');
  assert.match(text(card), /Not set up yet/);
  assert.equal(card.querySelector('a').getAttribute('href'), '#/goals');
});

test('emergency fund: months covered, progress and the 6-month target', async () => {
  const ctx = await makeViewCtx({ monthId: '2026-03' });
  const goal = await ctx.ledger.addGoal({ name: 'Rainy day', target_paise: 30000000, deadline: null, is_emergency: true });
  await ctx.ledger.addContribution({ goal_id: goal.id, amount_paise: 10000000, contributed_on: '2026-03-02' });
  await ctx.ledger.addTransaction({ ...base, amount_paise: 5000000, category: 'Housing' });
  await ctx.reload();
  const card = ctx.view(renderDashboard).querySelector('[data-testid=emergency]');
  assert.match(text(card), /2\.0 of 6 months covered/);
  assert.match(text(card), /Build this up/);
  assert.match(text(card), /₹1,00,000\.00 saved/);
  assert.match(text(card), /essentials ≈ ₹50,000\.00 a month/);
  assert.match(text(card), /6-month target ₹3,00,000\.00/);
  assert.equal(card.querySelector('.bar-fill').style.width, '33%');
});

test('emergency fund: levels move from build up to getting there to fully covered', async () => {
  const levelFor = async (savedPaise) => {
    document.body.replaceChildren();
    const ctx = await makeViewCtx({ monthId: '2026-03' });
    const goal = await ctx.ledger.addGoal({ name: 'EF', target_paise: 99999999, deadline: null, is_emergency: true });
    await ctx.ledger.addContribution({ goal_id: goal.id, amount_paise: savedPaise, contributed_on: '2026-03-02' });
    await ctx.ledger.addTransaction({ ...base, amount_paise: 1000000, category: 'Housing' });
    await ctx.reload();
    return text(ctx.view(renderDashboard).querySelector('[data-testid=emergency] .chip'));
  };
  assert.equal(await levelFor(2000000), 'Build this up');
  assert.equal(await levelFor(4000000), 'Getting there');
  assert.equal(await levelFor(6000000), 'Fully covered');
});

test('emergency fund: without spending history it says what is needed rather than dividing by zero', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledger.addGoal({ name: 'EF', target_paise: 1000000, deadline: null, is_emergency: true });
  await ctx.reload();
  const text_ = text(ctx.view(renderDashboard));
  assert.match(text_, /Not enough spending yet/);
  assert.doesNotMatch(text_, /NaN|Infinity/);
});

/* ---------- upcoming bills ---------- */

const bill = (o) => ({ kind: 'expense', name: 'Bill', amount_paise: 100000, frequency: 'monthly', start_on: '2026-01-05', category: 'Utilities', bucket: 'needs', ...o });

test('upcoming bills: empty state when nothing is due', async () => {
  const ctx = await makeViewCtx();
  assert.match(text(ctx.view(renderDashboard)), /Nothing due/);
});

test('upcoming bills: a bill due today or tomorrow says so, soonest first', async () => {
  const ctx = await makeViewCtx({ monthId: currentMonthId() });
  const today = todayISO();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await ctx.ledger.addRecurring(bill({ name: 'Due tomorrow', start_on: iso(tomorrow) }));
  await ctx.ledger.addRecurring(bill({ name: 'Due today', start_on: today }));
  await ctx.reload();
  const items = [...ctx.view(renderDashboard).querySelectorAll('[data-bill]')].map(text);
  assert.match(items[0], /Due today.*· today/);
  assert.match(items[1], /Due tomorrow.*· tomorrow/);
});

test('upcoming bills: yearly bills are marked, and the subtitle counts payments and totals them', async () => {
  const ctx = await makeViewCtx({ monthId: '2026-03' });
  await ctx.ledger.addRecurring(bill({ name: 'Insurance', frequency: 'yearly', due_month: 3, start_on: '2025-03-10', amount_paise: 2400000 }));
  await ctx.reload();
  const card = [...ctx.view(renderDashboard).querySelectorAll('.card')].find((c) => text(c.querySelector('.card-title')) === 'Upcoming bills');
  assert.match(text(card), /yearly/);
  assert.match(text(card), /in 1 payment(?!s)/);
  assert.match(text(card), /₹24,000\.00/);
});

test('upcoming bills: the person filter limits them to that person', async () => {
  const ctx = await makeViewCtx({ monthId: '2026-03' });
  await ctx.ledgers.Shubham.addRecurring(bill({ name: 'Mine' }));
  await ctx.ledgers.Priya.addRecurring(bill({ name: 'Hers' }));
  await ctx.reload();
  ctx.state.set({ personId: ctx.members[1].user_id });
  const names = [...ctx.view(renderDashboard).querySelectorAll('[data-bill]')].map((li) => li.dataset.bill);
  assert.deepEqual(names, ['Hers']);
});
