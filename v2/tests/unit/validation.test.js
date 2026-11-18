import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateContribution, validateGoal, validateRecurring, validateSplit, validateTransaction,
} from '../../src/domain/validation.js';

const goodTx = { kind: 'expense', amount_paise: 100, category: 'Food', occurred_on: '2026-03-05', bucket: 'needs', note: '' };

test('transaction: accepts valid expense and trims text', () => {
  const r = validateTransaction({ ...goodTx, category: '  Food  ', note: '  tea  ' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { kind: 'expense', amount_paise: 100, category: 'Food', note: 'tea', occurred_on: '2026-03-05', bucket: 'needs' });
});

test('transaction: income needs no bucket and drops any supplied one', () => {
  const r = validateTransaction({ ...goodTx, kind: 'income', bucket: 'wants' });
  assert.equal(r.ok, true);
  assert.equal(r.value.bucket, null);
});

test('transaction: every invalid field is reported together', () => {
  const r = validateTransaction({ kind: 'transfer', amount_paise: 0, category: '', occurred_on: '2026-13-40', bucket: 'misc' });
  assert.equal(r.ok, false);
  assert.equal(r.value, null);
  assert.ok(r.errors.length >= 4, r.errors.join('|'));
});

test('transaction: amount must be a positive integer number of paise', () => {
  for (const amount_paise of [0, -1, 1.5, '12', NaN, undefined, null]) {
    assert.equal(validateTransaction({ ...goodTx, amount_paise }).ok, false, String(amount_paise));
  }
  assert.equal(validateTransaction({ ...goodTx, amount_paise: 1 }).ok, true);
});

test('transaction: expense requires a known bucket', () => {
  for (const bucket of [undefined, null, '', 'misc', 'NEEDS']) {
    assert.equal(validateTransaction({ ...goodTx, bucket }).ok, false, String(bucket));
  }
  for (const bucket of ['needs', 'wants', 'savings']) assert.equal(validateTransaction({ ...goodTx, bucket }).ok, true);
});

test('transaction: text length limits (category 60, note 200)', () => {
  assert.equal(validateTransaction({ ...goodTx, category: 'x'.repeat(60) }).ok, true);
  assert.equal(validateTransaction({ ...goodTx, category: 'x'.repeat(61) }).ok, false);
  assert.equal(validateTransaction({ ...goodTx, note: 'n'.repeat(200) }).ok, true);
  assert.equal(validateTransaction({ ...goodTx, note: 'n'.repeat(201) }).ok, false);
  assert.equal(validateTransaction({ ...goodTx, category: '   ' }).ok, false);
});

test('transaction: date must be a real calendar date', () => {
  assert.equal(validateTransaction({ ...goodTx, occurred_on: '2026-02-30' }).ok, false);
  assert.equal(validateTransaction({ ...goodTx, occurred_on: '' }).ok, false);
  assert.equal(validateTransaction({ ...goodTx, occurred_on: '2024-02-29' }).ok, true);
});

test('transaction: markup is kept verbatim (escaping happens at render time)', () => {
  const r = validateTransaction({ ...goodTx, note: '<img src=x onerror=alert(1)>' });
  assert.equal(r.ok, true);
  assert.equal(r.value.note, '<img src=x onerror=alert(1)>');
});

const goodRec = { name: 'Insurance', amount_paise: 100, frequency: 'yearly', due_month: 4, start_on: '2026-01-01', category: 'Insurance', bucket: 'needs' };

test('recurring: yearly needs due month 1-12; monthly ignores due month', () => {
  assert.equal(validateRecurring({ ...goodRec, due_month: undefined }).ok, false);
  assert.equal(validateRecurring({ ...goodRec, due_month: 0 }).ok, false);
  assert.equal(validateRecurring({ ...goodRec, due_month: 13 }).ok, false);
  assert.equal(validateRecurring({ ...goodRec, due_month: 1.5 }).ok, false);
  assert.equal(validateRecurring({ ...goodRec, due_month: 12 }).ok, true);
  const monthly = validateRecurring({ ...goodRec, frequency: 'monthly', due_month: 7 });
  assert.equal(monthly.ok, true);
  assert.equal(monthly.value.due_month, null);
});

test('recurring: frequency, name and amount are validated', () => {
  assert.equal(validateRecurring({ ...goodRec, frequency: 'weekly' }).ok, false);
  assert.equal(validateRecurring({ ...goodRec, name: '' }).ok, false);
  assert.equal(validateRecurring({ ...goodRec, name: 'n'.repeat(81) }).ok, false);
  assert.equal(validateRecurring({ ...goodRec, amount_paise: -5 }).ok, false);
});

test('recurring: end date cannot precede start date; equal is fine', () => {
  assert.equal(validateRecurring({ ...goodRec, end_on: '2025-12-31' }).ok, false);
  assert.equal(validateRecurring({ ...goodRec, end_on: '2026-01-01' }).ok, true);
  assert.equal(validateRecurring({ ...goodRec, end_on: 'nope' }).ok, false);
  assert.equal(validateRecurring({ ...goodRec, end_on: '' }).value.end_on, null);
});

test('recurring: income items carry no bucket; expenses require one', () => {
  const income = validateRecurring({ ...goodRec, kind: 'income', bucket: undefined, frequency: 'monthly' });
  assert.equal(income.ok, true);
  assert.equal(income.value.bucket, null);
  assert.equal(validateRecurring({ ...goodRec, bucket: undefined }).ok, false);
});

test('goal: name and positive target required, deadline optional', () => {
  assert.equal(validateGoal({ name: 'Trip', target_paise: 5000, deadline: '2027-01-01' }).ok, true);
  assert.equal(validateGoal({ name: 'Trip', target_paise: 5000 }).value.deadline, null);
  assert.equal(validateGoal({ name: '', target_paise: 5000 }).ok, false);
  assert.equal(validateGoal({ name: 'Trip', target_paise: 0 }).ok, false);
  assert.equal(validateGoal({ name: 'Trip', target_paise: 1.2 }).ok, false);
  assert.equal(validateGoal({ name: 'Trip', target_paise: 5000, deadline: '2027-02-31' }).ok, false);
  assert.equal(validateGoal({ name: 'x'.repeat(81), target_paise: 5 }).ok, false);
});

test('contribution: needs goal, amount and valid date', () => {
  const good = { goal_id: 'g1', amount_paise: 100, contributed_on: '2026-03-01' };
  assert.equal(validateContribution(good).ok, true);
  assert.equal(validateContribution({ ...good, goal_id: '' }).ok, false);
  assert.equal(validateContribution({ ...good, amount_paise: 0 }).ok, false);
  assert.equal(validateContribution({ ...good, contributed_on: 'x' }).ok, false);
  assert.equal(validateContribution({ ...good, note: 'n'.repeat(201) }).ok, false);
});

test('split: must be whole percentages adding to exactly 100', () => {
  assert.equal(validateSplit({ needs: 50, wants: 30, savings: 20 }).ok, true);
  assert.equal(validateSplit({ needs: 100, wants: 0, savings: 0 }).ok, true);
  assert.equal(validateSplit({ needs: 50, wants: 30, savings: 30 }).ok, false);
  assert.equal(validateSplit({ needs: 50, wants: 30, savings: 10 }).ok, false);
  assert.equal(validateSplit({ needs: 'x', wants: 30, savings: 20 }).ok, false);
  assert.equal(validateSplit({ needs: 50.5, wants: 29.5, savings: 20 }).ok, false);
  assert.equal(validateSplit({ needs: -10, wants: 90, savings: 20 }).ok, false);
  assert.equal(validateSplit({ needs: 101, wants: 0, savings: -1 }).ok, false);
  assert.equal(validateSplit(undefined).ok, false);
  assert.deepEqual(validateSplit({ needs: '60', wants: '20', savings: '20' }).value, { needs: 60, wants: 20, savings: 20 });
});
