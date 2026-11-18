import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths, currentMonthId, isValidISODate, lastDayOfMonth, monthIdOf, monthLabel, monthName, monthNumber, monthsBetween, todayISO,
} from '../../src/core/dates.js';

test('todayISO uses local calendar date, zero padded', () => {
  assert.equal(todayISO(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(todayISO(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
});

test('currentMonthId / monthIdOf / monthNumber', () => {
  assert.equal(currentMonthId(new Date(2026, 2, 9)), '2026-03');
  assert.equal(monthIdOf('2026-03-09'), '2026-03');
  assert.equal(monthNumber('2026-03'), 3);
  assert.equal(monthNumber('2026-12'), 12);
});

test('addMonths crosses year boundaries both ways and by many months', () => {
  assert.equal(addMonths('2025-12', 1), '2026-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-03', 0), '2026-03');
  assert.equal(addMonths('2026-03', 12), '2027-03');
  assert.equal(addMonths('2026-03', -15), '2024-12');
  assert.equal(addMonths('2026-01', -5), '2025-08');
});

test('monthsBetween is signed', () => {
  assert.equal(monthsBetween('2026-01', '2026-11'), 10);
  assert.equal(monthsBetween('2026-11', '2026-01'), -10);
  assert.equal(monthsBetween('2025-11', '2026-02'), 3);
  assert.equal(monthsBetween('2026-05', '2026-05'), 0);
});

test('lastDayOfMonth handles leap years and 30/31 day months', () => {
  assert.equal(lastDayOfMonth('2024-02'), '2024-02-29');
  assert.equal(lastDayOfMonth('2026-02'), '2026-02-28');
  assert.equal(lastDayOfMonth('2026-04'), '2026-04-30');
  assert.equal(lastDayOfMonth('2026-12'), '2026-12-31');
});

test('isValidISODate rejects impossible and malformed dates', () => {
  for (const bad of ['2026-02-30', '2026-2-3', '2026-13-01', '2026-00-10', '26-01-01', '', null, undefined, 20260101, '2026-01-01T00:00']) {
    assert.equal(isValidISODate(bad), false, String(bad));
  }
  for (const good of ['2026-02-28', '2024-02-29', '2026-12-31']) assert.equal(isValidISODate(good), true, good);
  assert.equal(isValidISODate('2025-02-29'), false);
});

test('month labels are human readable', () => {
  assert.match(monthLabel('2026-03'), /March 2026/);
  assert.equal(monthName(1), 'January');
  assert.equal(monthName(12), 'December');
});
