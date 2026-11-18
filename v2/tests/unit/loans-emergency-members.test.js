import test from 'node:test';
import assert from 'node:assert/strict';
import { amortize, payoffMonth, prepaymentImpact } from '../../src/domain/loans.js';
import { emergencyStatus, essentialMonthly, TARGET_MONTHS } from '../../src/domain/emergency.js';
import { activeMembers, canLeave, canRemove, formerMembers, memberLabel, membersWithData } from '../../src/domain/members.js';

/* ---------- loans ---------- */

test('amortize: an interest-free loan takes balance / EMI months', () => {
  const r = amortize({ balancePaise: 12000000, annualRatePct: 0, emiPaise: 1000000 });
  assert.deepEqual([r.months, r.interestPaise, r.neverPaidOff], [12, 0, false]);
  assert.equal(amortize({ balancePaise: 1050000, annualRatePct: 0, emiPaise: 1000000 }).months, 2, 'a partial last payment still takes a month');
});

test('amortize: ₹1,00,000 at 12% with an EMI of ₹8,885 clears in 12 months for about ₹6,600 interest', () => {
  const r = amortize({ balancePaise: 10000000, annualRatePct: 12, emiPaise: 888500 });
  assert.equal(r.months, 12);
  assert.ok(r.interestPaise > 650000 && r.interestPaise < 670000, `interest ${r.interestPaise}`);
});

test('amortize: an EMI that cannot cover the interest never pays the loan off', () => {
  const r = amortize({ balancePaise: 100000000, annualRatePct: 12, emiPaise: 900000 });
  assert.deepEqual([r.months, r.interestPaise, r.neverPaidOff], [null, null, true]);
});

test('amortize: a lump sum covering the whole balance leaves nothing to pay', () => {
  const r = amortize({ balancePaise: 5000000, annualRatePct: 10, emiPaise: 100000, lumpSumPaise: 9000000 });
  assert.deepEqual([r.months, r.interestPaise], [0, 0]);
});

test('amortize: a zero balance is already paid off', () => {
  assert.equal(amortize({ balancePaise: 0, annualRatePct: 9, emiPaise: 100 }).months, 0);
});

test('amortize: stops at the safety cap instead of looping forever', () => {
  const r = amortize({ balancePaise: 1e12, annualRatePct: 0.0001, emiPaise: 1e7 });
  assert.equal(r.neverPaidOff, true);
});

const loan = { outstanding_paise: 50000000, rate_pct: 9, emi_paise: 600000 };

test('prepayment: paying extra every month saves time and interest', () => {
  const r = prepaymentImpact(loan, { extraMonthlyPaise: 100000 });
  assert.ok(r.monthsSaved > 0);
  assert.ok(r.interestSavedPaise > 0);
  assert.equal(r.base.months - r.plan.months, r.monthsSaved);
  assert.equal(r.emiTooLow, false);
});

test('prepayment: a lump sum saves time and interest too, and more money saves more', () => {
  const small = prepaymentImpact(loan, { lumpSumPaise: 5000000 });
  const big = prepaymentImpact(loan, { lumpSumPaise: 10000000 });
  assert.ok(small.interestSavedPaise > 0);
  assert.ok(big.interestSavedPaise > small.interestSavedPaise);
  assert.ok(big.monthsSaved >= small.monthsSaved);
  assert.ok(prepaymentImpact(loan, { extraMonthlyPaise: 200000 }).interestSavedPaise > prepaymentImpact(loan, { extraMonthlyPaise: 100000 }).interestSavedPaise);
});

test('prepayment: paying nothing extra saves nothing', () => {
  const r = prepaymentImpact(loan);
  assert.deepEqual([r.monthsSaved, r.interestSavedPaise], [0, 0]);
});

test('prepayment: warns when the EMI is below the interest', () => {
  const r = prepaymentImpact({ outstanding_paise: 100000000, rate_pct: 12, emi_paise: 900000 }, { extraMonthlyPaise: 50000 });
  assert.equal(r.emiTooLow, true);
  assert.equal(r.monthsSaved, null);
});

test('prepayment: an extra payment can rescue an EMI that was too low', () => {
  const r = prepaymentImpact({ outstanding_paise: 100000000, rate_pct: 12, emi_paise: 900000 }, { extraMonthlyPaise: 500000 });
  assert.equal(r.emiTooLow, true, 'the base plan is still a problem');
  assert.ok(r.plan.months > 0, 'but the boosted plan does pay it off');
});

test('payoffMonth adds months to a date, crossing year ends', () => {
  assert.equal(payoffMonth('2026-03-15', 12), '2027-03');
  assert.equal(payoffMonth('2026-11-30', 3), '2027-02');
  assert.equal(payoffMonth('2026-11-30', 0), '2026-11');
});

/* ---------- emergency fund ---------- */

const needs = (month, paise) => ({ kind: 'expense', amount_paise: paise, category: 'Housing', bucket: 'needs', occurred_on: `${month}-05`, created_by: 'me' });

test('essentialMonthly averages the months that have needs spending', () => {
  const transactions = [needs('2026-01', 3000000), needs('2026-03', 4000000)];
  assert.equal(essentialMonthly({ monthId: '2026-03', transactions }), 3500000, 'February had none and is ignored');
});

test('essentialMonthly includes recurring needs, and returns 0 with no data', () => {
  const rent = { kind: 'expense', name: 'Rent', amount_paise: 2500000, frequency: 'monthly', start_on: '2026-01-01', end_on: null, category: 'Housing', bucket: 'needs', created_by: 'me' };
  assert.equal(essentialMonthly({ monthId: '2026-03', recurring: [rent] }), 2500000);
  assert.equal(essentialMonthly({ monthId: '2026-03' }), 0);
});

test('essentialMonthly can be limited to one person', () => {
  const transactions = [needs('2026-03', 1000000), { ...needs('2026-03', 500000), created_by: 'wife' }];
  assert.equal(essentialMonthly({ monthId: '2026-03', transactions, personId: 'wife' }), 500000);
});

test('emergencyStatus: months covered, target and level', () => {
  const low = emergencyStatus({ fundPaise: 10000000, essentialPaise: 5000000 });
  assert.deepEqual([low.monthsCovered, low.targetPaise, low.pct, low.level], [2, 30000000, 33, 'low']);
  assert.equal(emergencyStatus({ fundPaise: 20000000, essentialPaise: 5000000 }).level, 'building');
  assert.equal(emergencyStatus({ fundPaise: 15000000, essentialPaise: 5000000 }).level, 'building', 'exactly 3 months is no longer low');
  const ready = emergencyStatus({ fundPaise: 30000000, essentialPaise: 5000000 });
  assert.deepEqual([ready.level, ready.pct, ready.monthsCovered], ['ready', 100, TARGET_MONTHS]);
  assert.equal(emergencyStatus({ fundPaise: 99999999999, essentialPaise: 5000000 }).pct, 100, 'capped');
});

test('emergencyStatus: the boundaries are 3 and 6 months', () => {
  const level = (months) => emergencyStatus({ fundPaise: months * 1000000, essentialPaise: 1000000 }).level;
  assert.deepEqual([level(2.99), level(3), level(5.99), level(6)], ['low', 'building', 'building', 'ready']);
});

test('emergencyStatus: without spending history the answer is unknown, not infinite', () => {
  const s = emergencyStatus({ fundPaise: 5000000, essentialPaise: 0 });
  assert.deepEqual([s.level, s.monthsCovered, s.targetPaise], ['unknown', null, 0]);
});

/* ---------- members ---------- */

const members = [
  { user_id: 'a', display_name: 'Shubham', left_at: null },
  { user_id: 'b', display_name: 'Priya', left_at: null },
  { user_id: 'c', display_name: 'Asha', left_at: '2026-03-01T00:00:00Z' },
];

test('members: active vs former, and labels', () => {
  assert.deepEqual(activeMembers(members).map((m) => m.user_id), ['a', 'b']);
  assert.deepEqual(formerMembers(members).map((m) => m.user_id), ['c']);
  assert.equal(memberLabel(members[0]), 'Shubham');
  assert.equal(memberLabel(members[2]), 'Asha (former)');
  assert.deepEqual(activeMembers(undefined), []);
});

test('members: former members stay visible only while they still have entries', () => {
  assert.deepEqual(membersWithData(members, {}).map((m) => m.user_id), ['a', 'b']);
  assert.deepEqual(membersWithData(members, { transactions: [{ created_by: 'c' }] }).map((m) => m.user_id), ['a', 'b', 'c']);
  assert.deepEqual(membersWithData(members, { recurring: [{ created_by: 'c' }] }).map((m) => m.user_id), ['a', 'b', 'c']);
});

test('members: you can remove someone else, not yourself, not a former member, and never the last one', () => {
  assert.equal(canRemove(members, 'b', 'a'), true);
  assert.equal(canRemove(members, 'a', 'a'), false, 'use Leave instead');
  assert.equal(canRemove(members, 'c', 'a'), false, 'already gone');
  assert.equal(canRemove(members, 'zzz', 'a'), false, 'not a member');
  assert.equal(canRemove([members[0]], 'a', 'b'), false);
  assert.equal(canRemove([members[0], members[2]], 'c', 'a'), false, 'only one active member left');
});

test('members: you can leave only when someone else remains', () => {
  assert.equal(canLeave(members, 'a'), true);
  assert.equal(canLeave([members[0], members[2]], 'a'), false);
  assert.equal(canLeave(members, 'c'), false, 'a former member is not in the household');
});
