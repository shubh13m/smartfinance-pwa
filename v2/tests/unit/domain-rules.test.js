import test from 'node:test';
import assert from 'node:assert/strict';
import { amountInMonth, dueInMonth, isActiveInMonth, monthlyEquivalent } from '../../src/domain/recurring.js';
import { bucketTargets, computeBudget } from '../../src/domain/budget503020.js';
import { goalProgress } from '../../src/domain/goals.js';

const monthly = { frequency: 'monthly', amount_paise: 1000000, start_on: '2026-02-15', end_on: '2026-06-10' };
const yearly = { frequency: 'yearly', due_month: 3, amount_paise: 1200000, start_on: '2026-01-15', end_on: null };

test('recurring: active from the start month (any day) to the end month (any day)', () => {
  assert.equal(isActiveInMonth(monthly, '2026-01'), false);
  assert.equal(isActiveInMonth(monthly, '2026-02'), true);
  assert.equal(isActiveInMonth(monthly, '2026-06'), true);
  assert.equal(isActiveInMonth(monthly, '2026-07'), false);
  assert.equal(isActiveInMonth(yearly, '2099-01'), true);
});

test('recurring: monthly item is due every active month', () => {
  assert.equal(dueInMonth(monthly, '2026-04'), 1000000);
  assert.equal(dueInMonth(monthly, '2026-07'), 0);
});

test('recurring: yearly item is due only in its month and only while active', () => {
  assert.equal(dueInMonth(yearly, '2026-03'), 1200000);
  assert.equal(dueInMonth(yearly, '2027-03'), 1200000);
  assert.equal(dueInMonth(yearly, '2026-04'), 0);
  assert.equal(dueInMonth({ ...yearly, start_on: '2026-04-01' }, '2026-03'), 0);
});

test('recurring: smoothed view spreads yearly over 12 with rounding', () => {
  assert.equal(monthlyEquivalent(yearly, '2026-09'), 100000);
  assert.equal(monthlyEquivalent({ ...yearly, amount_paise: 1000 }, '2026-09'), 83);
  assert.equal(monthlyEquivalent(monthly, '2026-04'), 1000000);
  assert.equal(monthlyEquivalent(yearly, '2025-12'), 0);
});

test('recurring: amountInMonth picks the basis, defaulting to smoothed', () => {
  assert.equal(amountInMonth(yearly, '2026-05', 'cash'), 0);
  assert.equal(amountInMonth(yearly, '2026-03', 'cash'), 1200000);
  assert.equal(amountInMonth(yearly, '2026-05'), 100000);
  assert.equal(amountInMonth(yearly, '2026-05', 'smoothed'), 100000);
});

test('budget: targets always add up exactly to income', () => {
  for (const income of [0, 1, 2, 3, 99, 100000, 3333333, 9999999, 123456789]) {
    const t = bucketTargets(income);
    assert.equal(t.needs + t.wants + t.savings, income, `income ${income}`);
  }
  assert.deepEqual(bucketTargets(1000000), { needs: 500000, wants: 300000, savings: 200000 });
});

test('budget: custom splits are honoured', () => {
  assert.deepEqual(bucketTargets(100000, { needs: 60, wants: 20, savings: 20 }), { needs: 60000, wants: 20000, savings: 20000 });
  assert.deepEqual(bucketTargets(100000, { needs: 100, wants: 0, savings: 0 }), { needs: 100000, wants: 0, savings: 0 });
});

test('budget: spending buckets are ok -> warn at 90% -> over above 100%', () => {
  const run = (needs) => computeBudget({ incomePaise: 1000000, spentByBucket: { needs, wants: 0, savings: 0 } }).buckets.needs;
  assert.equal(run(100000).status, 'ok');
  assert.equal(run(449999).status, 'ok');
  assert.equal(run(450000).status, 'warn');
  assert.equal(run(500000).status, 'warn');
  assert.equal(run(500001).status, 'over');
  assert.equal(run(600000).usedPct, 120);
});

test('budget: savings is ahead once the target is met, otherwise behind', () => {
  const run = (savings) => computeBudget({ incomePaise: 1000000, spentByBucket: { savings } }).buckets.savings;
  assert.equal(run(199999).status, 'behind');
  assert.equal(run(200000).status, 'ahead');
  assert.equal(run(900000).status, 'ahead');
});

test('budget: zero income gives zero targets and never divides by zero', () => {
  const none = computeBudget({ incomePaise: 0, spentByBucket: {} });
  assert.equal(none.buckets.needs.usedPct, 0);
  assert.equal(none.unallocatedPaise, 0);
  const spending = computeBudget({ incomePaise: 0, spentByBucket: { needs: 500 } });
  assert.equal(spending.buckets.needs.usedPct, 100);
  assert.equal(spending.buckets.needs.status, 'over');
  assert.equal(spending.unallocatedPaise, -500);
});

test('budget: unallocated is what is left after all three buckets', () => {
  const r = computeBudget({ incomePaise: 1000000, spentByBucket: { needs: 300000, wants: 100000, savings: 50000 } });
  assert.equal(r.unallocatedPaise, 550000);
  assert.equal(r.buckets.needs.remainingPaise, 200000);
});

test('goals: progress, percent cap, completion', () => {
  const goal = { id: 'g1', target_paise: 1000, deadline: null };
  const part = goalProgress(goal, [{ goal_id: 'g1', amount_paise: 250 }, { goal_id: 'other', amount_paise: 999 }], '2026-07-10');
  assert.deepEqual([part.savedPaise, part.pct, part.remainingPaise, part.done], [250, 25, 750, false]);
  const over = goalProgress(goal, [{ goal_id: 'g1', amount_paise: 5000 }], '2026-07-10');
  assert.deepEqual([over.pct, over.remainingPaise, over.done], [100, 0, true]);
  assert.equal(over.requiredMonthlyPaise, null);
});

test('goals: required monthly amount rounds up and counts at least one month', () => {
  const goal = { id: 'g1', target_paise: 1000, deadline: '2026-12-31' };
  const p = goalProgress(goal, [], '2026-07-10');
  assert.equal(p.monthsLeft, 5);
  assert.equal(p.requiredMonthlyPaise, 200);
  const sameMonth = goalProgress({ ...goal, deadline: '2026-07-31' }, [], '2026-07-10');
  assert.equal(sameMonth.monthsLeft, 1);
  assert.equal(sameMonth.requiredMonthlyPaise, 1000);
  const monthsTwo = goalProgress({ ...goal, target_paise: 1001, deadline: '2026-09-30' }, [], '2026-07-10');
  assert.equal(monthsTwo.monthsLeft, 2);
  assert.equal(monthsTwo.requiredMonthlyPaise, 501);
});

test('goals: overdue and no-deadline cases', () => {
  const goal = { id: 'g1', target_paise: 1000, deadline: '2026-01-01' };
  const late = goalProgress(goal, [], '2026-07-10');
  assert.equal(late.overdue, true);
  assert.equal(late.requiredMonthlyPaise, null);
  assert.equal(goalProgress({ ...goal, deadline: null }, [], '2026-07-10').overdue, false);
  assert.equal(goalProgress(goal, [{ goal_id: 'g1', amount_paise: 1000 }], '2026-07-10').overdue, false);
});
