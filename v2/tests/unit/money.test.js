import test from 'node:test';
import assert from 'node:assert/strict';
import { formatINR, formatINRShort, fromPaise, percentOf, sumPaise, toPaise } from '../../src/core/money.js';

test('toPaise: parses decimals exactly, avoiding float drift', () => {
  assert.equal(toPaise('1.005'), 101);
  assert.equal(toPaise('0.1') + toPaise('0.2'), 30);
  assert.equal(toPaise('19.99'), 1999);
  assert.equal(toPaise('1234567.89'), 123456789);
  assert.equal(toPaise(200), 20000);
  assert.equal(toPaise(0.29), 29);
});

test('toPaise: strips currency symbol, commas and spaces', () => {
  assert.equal(toPaise('₹1,25,000.50'), 12500050);
  assert.equal(toPaise(' 1 000 '), 100000);
  assert.equal(toPaise('.5'), 50);
});

test('toPaise: keeps sign so validation can reject it later', () => {
  assert.equal(toPaise('-5'), -500);
  assert.equal(toPaise('0'), 0);
});

test('toPaise: rejects non-numeric input', () => {
  for (const bad of ['', '   ', 'abc', '1.2.3', null, undefined, 'NaN', '1e5', '12abc', '--1', '1,,2x']) {
    assert.throws(() => toPaise(bad), RangeError, `should reject ${JSON.stringify(bad)}`);
  }
});

test('fromPaise handles bad input as zero', () => {
  assert.equal(fromPaise(12345), 123.45);
  assert.equal(fromPaise(undefined), 0);
  assert.equal(fromPaise('abc'), 0);
});

test('sumPaise adds a key, ignoring missing and non-numeric values', () => {
  assert.equal(sumPaise([{ amount_paise: 10 }, { amount_paise: 5 }, {}, { amount_paise: 'x' }]), 15);
  assert.equal(sumPaise([]), 0);
  assert.equal(sumPaise(undefined), 0);
  assert.equal(sumPaise([{ v: 4 }, { v: 6 }], 'v'), 10);
});

test('percentOf rounds to whole paise', () => {
  assert.equal(percentOf(100000, 30), 30000);
  assert.equal(percentOf(333, 50), 167);
  assert.equal(percentOf(0, 50), 0);
});

test('formatINR uses Indian digit grouping and two decimals', () => {
  assert.match(formatINR(12345600), /₹1,23,456\.00/);
  assert.match(formatINR(5), /₹0\.05/);
  assert.match(formatINR(0), /₹0\.00/);
  assert.match(formatINR(-250000), /-₹2,500\.00/);
});

test('formatINRShort drops paise and rounds to whole rupees', () => {
  assert.match(formatINRShort(15500000), /₹1,55,000$/);
  assert.match(formatINRShort(149), /₹1$/);
  assert.match(formatINRShort(150), /₹2$/);
});
