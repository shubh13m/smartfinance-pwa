import test from 'node:test';
import assert from 'node:assert/strict';
import { planMonth, monthPhase, MIN_DAYS_FOR_FORECAST } from '../../src/domain/cashflow.js';
import { upcomingBills } from '../../src/domain/upcoming.js';
import { addDays, dayOfMonth, daysBetween, daysInMonth } from '../../src/core/dates.js';

const tx = (o) => ({ kind: 'expense', amount_paise: 0, category: 'x', bucket: 'needs', occurred_on: '2026-03-05', created_by: 'me', ...o });
const salary = (paise, who = 'me') => tx({ kind: 'income', amount_paise: paise, category: 'Salary', bucket: null, created_by: who });
const rent = { kind: 'expense', name: 'Rent', amount_paise: 2500000, frequency: 'monthly', start_on: '2026-01-05', end_on: null, category: 'Housing', bucket: 'needs', created_by: 'me' };

// ₹1,00,000 income; ₹20,000 groceries (needs), ₹10,000 dining (wants), ₹5,000 SIP, ₹25,000 rent.
const march = () => ({
  monthId: '2026-03',
  today: '2026-03-10',
  transactions: [
    salary(10000000),
    tx({ amount_paise: 2000000, category: 'Groceries' }),
    tx({ amount_paise: 1000000, category: 'Dining Out', bucket: 'wants' }),
    tx({ amount_paise: 500000, category: 'SIP', bucket: 'savings' }),
  ],
  recurring: [rent],
});

test('date helpers: days in month, day of month, adding and counting days', () => {
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2024-02'), 29);
  assert.equal(daysInMonth('2026-03'), 31);
  assert.equal(dayOfMonth('2026-03-07'), 7);
  assert.equal(addDays('2026-03-30', 5), '2026-04-04');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-03-01', '2026-03-31'), 30);
  assert.equal(daysBetween('2026-03-10', '2026-03-01'), -9);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
});

test('planMonth: "left this month" is income minus every expense, including investments', () => {
  const p = planMonth(march());
  assert.equal(p.incomePaise, 10000000);
  assert.equal(p.spentPaise, 6000000);
  assert.equal(p.leftPaise, 4000000);
  assert.equal(p.investedPaise, 500000);
});

test('planMonth: safe to spend protects the plan\'s savings target', () => {
  const p = planMonth(march());
  assert.equal(p.targetPaise, 2000000, '20% of income');
  assert.equal(p.stillToInvestPaise, 1500000, 'target minus already invested');
  assert.equal(p.safePaise, 2500000, 'left minus the investment still to make');
});

test('planMonth: safe = income − bills and spending − the investment being protected', () => {
  const p = planMonth(march());
  assert.equal(p.safePaise, p.incomePaise - p.billsPaise - p.variablePaise - Math.max(p.targetPaise, p.investedPaise));
  assert.equal(p.billsPaise, 2500000);
  assert.equal(p.variablePaise, 3000000);
});

test('planMonth: identity safe = left − still-to-invest holds across many situations', () => {
  const cases = [
    { income: 10000000, groceries: 0, invested: 0 },
    { income: 10000000, groceries: 9000000, invested: 0 },
    { income: 10000000, groceries: 1000000, invested: 2000000 },
    { income: 10000000, groceries: 1000000, invested: 5000000 },
    { income: 3333333, groceries: 1234567, invested: 100001 },
    { income: 0, groceries: 500, invested: 0 },
  ];
  for (const c of cases) {
    const p = planMonth({
      monthId: '2026-03', today: '2026-03-15',
      transactions: [salary(c.income), tx({ amount_paise: c.groceries }), tx({ amount_paise: c.invested, bucket: 'savings' })].filter((t) => t.amount_paise > 0),
    });
    assert.equal(p.safePaise, p.leftPaise - p.stillToInvestPaise, JSON.stringify(c));
  }
});

test('planMonth: investing more than the target never creates a negative reserve', () => {
  const p = planMonth({ ...march(), transactions: [...march().transactions, tx({ amount_paise: 3000000, bucket: 'savings' })] });
  assert.equal(p.stillToInvestPaise, 0);
  assert.equal(p.safePaise, p.leftPaise, 'nothing left to protect, so safe equals left');
});

test('planMonth: daily allowance spreads safe money over the days left, including today', () => {
  const p = planMonth(march());
  assert.equal(p.day, 10);
  assert.equal(p.daysLeft, 22);
  assert.equal(p.dailyAllowancePaise, Math.floor(2500000 / 22));
});

test('planMonth: forecast projects day-to-day spending across the rest of the month', () => {
  const p = planMonth(march());
  // ₹30,000 over 10 days = ₹3,000/day; 21 more days after today.
  assert.equal(p.forecastSafePaise, 2500000 - Math.round((3000000 / 10) * 21));
  assert.equal(p.status, 'tight', 'still positive today, but heading below zero at this pace');
});

test('planMonth: calm spending forecasts a comfortable month-end', () => {
  const p = planMonth({
    monthId: '2026-03', today: '2026-03-10',
    transactions: [salary(10000000), tx({ amount_paise: 100000 })],
  });
  assert.ok(p.forecastSafePaise > 0);
  assert.equal(p.status, 'ok');
});

test('planMonth: no forecast until there are a few days of data', () => {
  const early = planMonth({ ...march(), today: `2026-03-0${MIN_DAYS_FOR_FORECAST - 1}` });
  assert.equal(early.forecastSafePaise, null);
  assert.notEqual(planMonth({ ...march(), today: `2026-03-0${MIN_DAYS_FOR_FORECAST}` }).forecastSafePaise, null);
  assert.equal(planMonth({ monthId: '2026-03', today: '2026-03-20', transactions: [salary(100)] }).forecastSafePaise, null, 'nothing spent');
});

test('planMonth: overspending is flagged as over', () => {
  const p = planMonth({ monthId: '2026-03', today: '2026-03-20', transactions: [salary(1000000), tx({ amount_paise: 900000 })] });
  assert.ok(p.safePaise < 0);
  assert.equal(p.status, 'over');
  assert.equal(p.dailyAllowancePaise, 0, 'no daily allowance when there is nothing safe to spend');
});

test('planMonth: income but nothing protected spent yet is ok; spending without income is its own status', () => {
  assert.equal(planMonth({ monthId: '2026-03', today: '2026-03-05', transactions: [salary(1000000)] }).status, 'ok');
  assert.equal(planMonth({ monthId: '2026-03', today: '2026-03-05', transactions: [tx({ amount_paise: 100 })] }).status, 'no_income');
  assert.equal(planMonth({ monthId: '2026-03', today: '2026-03-05' }).status, 'empty');
});

test('planMonth: past and future months have no daily allowance or forecast', () => {
  const past = planMonth({ ...march(), today: '2026-05-01' });
  assert.deepEqual([past.phase, past.daysLeft, past.dailyAllowancePaise, past.forecastSafePaise], ['past', 0, 0, null]);
  assert.equal(past.safePaise, 2500000, 'the money figures still work for a finished month');
  const future = planMonth({ ...march(), today: '2026-02-01' });
  assert.deepEqual([future.phase, future.daysLeft, future.dailyAllowancePaise], ['future', 0, 0]);
});

test('monthPhase compares the viewed month with today', () => {
  assert.equal(monthPhase('2026-03', '2026-03-31'), 'current');
  assert.equal(monthPhase('2026-02', '2026-03-01'), 'past');
  assert.equal(monthPhase('2027-01', '2026-12-31'), 'future');
});

test('planMonth: honours a custom split and a different person', () => {
  const split = { needs: 70, wants: 20, savings: 10 };
  assert.equal(planMonth({ ...march(), split }).targetPaise, 1000000);
  const wife = planMonth({ ...march(), personId: 'wife' });
  assert.equal(wife.incomePaise, 0);
  const mine = planMonth({ ...march(), personId: 'me' });
  assert.equal(mine.safePaise, planMonth(march()).safePaise);
});

test('planMonth: yearly bills follow the cash vs smoothed basis', () => {
  const insurance = { kind: 'expense', name: 'Insurance', amount_paise: 2400000, frequency: 'yearly', due_month: 3, start_on: '2026-01-01', end_on: null, category: 'Insurance', bucket: 'needs', created_by: 'me' };
  const base = { monthId: '2026-03', today: '2026-03-10', transactions: [salary(10000000)], recurring: [insurance] };
  assert.equal(planMonth({ ...base, basis: 'smoothed' }).billsPaise, 200000);
  assert.equal(planMonth({ ...base, basis: 'cash' }).billsPaise, 2400000);
});

test('planMonth: recurring income counts toward income', () => {
  const pay = { kind: 'income', name: 'Pay', amount_paise: 8000000, frequency: 'monthly', start_on: '2026-01-01', end_on: null, category: 'Salary', bucket: null, created_by: 'me' };
  assert.equal(planMonth({ monthId: '2026-03', today: '2026-03-10', recurring: [pay] }).incomePaise, 8000000);
});

/* ---------- upcoming bills ---------- */

const bill = (o) => ({ kind: 'expense', name: 'Bill', amount_paise: 100000, frequency: 'monthly', due_month: null, start_on: '2026-01-05', end_on: null, category: 'Utilities', bucket: 'needs', created_by: 'me', ...o });

test('upcoming: a bill due today is not listed a second time 30 days later (regression: Rent appeared twice)', () => {
  // 18 Nov + 30 days = 18 Dec, which must be outside the window.
  const { bills } = upcomingBills({ from: '2026-11-18', recurring: [bill({ name: 'Rent', start_on: '2026-01-18' })] });
  assert.deepEqual(bills.map((b) => b.date), ['2026-11-18']);
  const edge = upcomingBills({ from: '2026-03-01', days: 30, recurring: [bill({ name: 'Edge', start_on: '2026-01-31' })] });
  assert.deepEqual(edge.bills, [], 'day 30 itself (31 Mar) is excluded');
  assert.deepEqual(upcomingBills({ from: '2026-03-01', days: 30, recurring: [bill({ start_on: '2026-01-30' })] }).bills.map((b) => b.date), ['2026-03-30'], 'day 29 is included');
});

test('upcoming: lists monthly bills falling due in the next 30 days, soonest first', () => {
  const { bills, totalPaise, until } = upcomingBills({
    from: '2026-03-20',
    recurring: [bill({ name: 'Rent', amount_paise: 2500000, start_on: '2026-01-05' }), bill({ name: 'Internet', amount_paise: 100000, start_on: '2026-01-25' })],
  });
  assert.equal(until, '2026-04-19');
  assert.deepEqual(bills.map((b) => [b.item.name, b.date, b.daysAway]), [['Internet', '2026-03-25', 5], ['Rent', '2026-04-05', 16]]);
  assert.equal(totalPaise, 2600000);
});

test('upcoming: a bill is not listed twice when its day recurs inside the window, but both months appear when they fit', () => {
  const { bills } = upcomingBills({ from: '2026-03-01', days: 45, recurring: [bill({ name: 'Rent', start_on: '2026-01-10' })] });
  assert.deepEqual(bills.map((b) => b.date), ['2026-03-10', '2026-04-10']);
});

test('upcoming: yearly bills appear only in their due month', () => {
  const insurance = bill({ name: 'Insurance', frequency: 'yearly', due_month: 4, start_on: '2025-04-12', amount_paise: 2400000 });
  assert.deepEqual(upcomingBills({ from: '2026-03-20', recurring: [insurance] }).bills.map((b) => b.date), ['2026-04-12']);
  assert.equal(upcomingBills({ from: '2026-06-01', recurring: [insurance] }).bills.length, 0);
});

test('upcoming: the due day is clamped to short months', () => {
  const { bills } = upcomingBills({ from: '2026-02-10', recurring: [bill({ start_on: '2026-01-31' })] });
  assert.deepEqual(bills.map((b) => b.date), ['2026-02-28']);
});

test('upcoming: respects start and end dates', () => {
  const ended = bill({ name: 'Gym', end_on: '2026-02-28' });
  const notStarted = bill({ name: 'Future', start_on: '2026-04-10' });
  const { bills } = upcomingBills({ from: '2026-03-01', days: 60, recurring: [ended, notStarted] });
  assert.deepEqual(bills.map((b) => [b.item.name, b.date]), [['Future', '2026-04-10']], 'nothing before its first due date, nothing after it ended');
});

test('upcoming: ignores income and can be limited to one person', () => {
  const income = bill({ name: 'Pay', kind: 'income', bucket: null });
  const mine = bill({ name: 'Mine', created_by: 'me' });
  const hers = bill({ name: 'Hers', created_by: 'wife' });
  assert.deepEqual(upcomingBills({ from: '2026-03-01', recurring: [income, mine, hers] }).bills.map((b) => b.item.name).sort(), ['Hers', 'Mine']);
  assert.deepEqual(upcomingBills({ from: '2026-03-01', recurring: [mine, hers], personId: 'wife' }).bills.map((b) => b.item.name), ['Hers']);
});

test('upcoming: works across a year end and with an empty list', () => {
  const { bills } = upcomingBills({ from: '2026-12-20', recurring: [bill({ start_on: '2026-01-05' })] });
  assert.deepEqual(bills.map((b) => b.date), ['2027-01-05']);
  assert.deepEqual(upcomingBills({ from: '2026-03-01', recurring: [] }), { bills: [], totalPaise: 0, until: '2026-03-31' });
});
