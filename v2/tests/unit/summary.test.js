import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyTrend, summarizeByPerson, summarizeMonth, topCategories } from '../../src/domain/summary.js';

const me = 'me';
const wife = 'wife';
const t = (o) => ({ kind: 'expense', amount_paise: 100, category: 'Groceries', bucket: 'needs', occurred_on: '2026-03-05', created_by: me, ...o });
const income = (o) => t({ kind: 'income', category: 'Salary', bucket: null, ...o });

const txs = [
  income({ amount_paise: 8000000 }),
  income({ amount_paise: 6000000, created_by: wife }),
  t({ amount_paise: 50000, created_by: wife }),
  t({ amount_paise: 20000, category: 'Dining Out', bucket: 'wants' }),
  t({ amount_paise: 15000, category: 'SIP', bucket: 'savings', created_by: wife }),
  t({ amount_paise: 99999, occurred_on: '2026-04-01' }),
];

test('summary: combined view totals both people and ignores other months', () => {
  const s = summarizeMonth({ monthId: '2026-03', transactions: txs });
  assert.equal(s.incomePaise, 14000000);
  assert.equal(s.expensePaise, 85000);
  assert.deepEqual(s.byBucket, { needs: 50000, wants: 20000, savings: 15000 });
  assert.equal(s.netPaise, 13915000);
  assert.deepEqual(s.byCategory, { Groceries: 50000, 'Dining Out': 20000, SIP: 15000 });
});

test('summary: per-person view only counts that person\'s entries', () => {
  const w = summarizeMonth({ monthId: '2026-03', transactions: txs, personId: wife });
  assert.equal(w.incomePaise, 6000000);
  assert.equal(w.expensePaise, 65000);
  const m = summarizeMonth({ monthId: '2026-03', transactions: txs, personId: me });
  assert.equal(m.incomePaise, 8000000);
  assert.equal(m.expensePaise, 20000);
  assert.equal(w.incomePaise + m.incomePaise, summarizeMonth({ monthId: '2026-03', transactions: txs }).incomePaise);
});

test('summary: savings rate is the savings bucket over income, 0 when no income', () => {
  assert.equal(summarizeMonth({ monthId: '2026-03', transactions: txs }).savingsRatePct, 0);
  const s = summarizeMonth({ monthId: '2026-03', transactions: [income({ amount_paise: 10000 }), t({ amount_paise: 2500, bucket: 'savings' })] });
  assert.equal(s.savingsRatePct, 25);
  assert.equal(summarizeMonth({ monthId: '2026-03', transactions: [t({ amount_paise: 100 })] }).savingsRatePct, 0);
});

test('summary: an empty month is all zeros', () => {
  const s = summarizeMonth({ monthId: '2030-01' });
  assert.deepEqual([s.incomePaise, s.expensePaise, s.netPaise], [0, 0, 0]);
  assert.deepEqual(s.byCategory, {});
});

const yearlyBill = { kind: 'expense', frequency: 'yearly', due_month: 3, amount_paise: 1200000, start_on: '2026-01-01', end_on: null, category: 'Insurance', bucket: 'needs', created_by: me };
const salary = { kind: 'income', frequency: 'monthly', amount_paise: 500000, start_on: '2026-01-01', end_on: null, category: 'Salary', bucket: null, created_by: wife };

test('summary: recurring honours the cash vs smoothed basis', () => {
  const recurring = [yearlyBill];
  assert.equal(summarizeMonth({ monthId: '2026-04', recurring, basis: 'smoothed' }).expensePaise, 100000);
  assert.equal(summarizeMonth({ monthId: '2026-04', recurring, basis: 'cash' }).expensePaise, 0);
  assert.equal(summarizeMonth({ monthId: '2026-03', recurring, basis: 'cash' }).expensePaise, 1200000);
  assert.equal(summarizeMonth({ monthId: '2026-03', recurring }).expensePaise, 100000);
});

test('summary: recurring income counts toward income and is attributed to its owner', () => {
  const all = summarizeMonth({ monthId: '2026-05', recurring: [salary, yearlyBill] });
  assert.equal(all.incomePaise, 500000);
  assert.equal(summarizeMonth({ monthId: '2026-05', recurring: [salary, yearlyBill], personId: me }).incomePaise, 0);
  assert.equal(summarizeMonth({ monthId: '2026-05', recurring: [salary, yearlyBill], personId: wife }).expensePaise, 0);
});

test('summary: transactions and recurring combine into the same buckets and categories', () => {
  const s = summarizeMonth({ monthId: '2026-03', transactions: [t({ amount_paise: 1000, category: 'Insurance' })], recurring: [yearlyBill], basis: 'cash' });
  assert.equal(s.byBucket.needs, 1201000);
  assert.equal(s.byCategory.Insurance, 1201000);
});

test('summary: byPerson returns one summary per member', () => {
  const members = [{ user_id: me }, { user_id: wife }];
  const rows = summarizeByPerson({ members, monthId: '2026-03', transactions: txs, recurring: [] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].summary.incomePaise, 8000000);
  assert.equal(rows[1].summary.incomePaise, 6000000);
  assert.equal(rows[0].member, members[0]);
});

test('topCategories sorts by amount and honours the limit', () => {
  const top = topCategories({ a: 5, b: 9, c: 1, d: 7 }, 3);
  assert.deepEqual(top.map((x) => x.category), ['b', 'd', 'a']);
  assert.deepEqual(topCategories({}), []);
  assert.equal(topCategories(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`c${i}`, i]))).length, 8);
});

test('monthlyTrend returns one point per month id in order', () => {
  const points = monthlyTrend({ monthIds: ['2026-02', '2026-03', '2026-04'], transactions: txs, recurring: [], personId: 'all', basis: 'smoothed' });
  assert.deepEqual(points.map((p) => p.monthId), ['2026-02', '2026-03', '2026-04']);
  assert.equal(points[0].incomePaise, 0);
  assert.equal(points[1].incomePaise, 14000000);
  assert.equal(points[2].expensePaise, 99999);
});
