import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { bucketForCategory, convertLegacyMonths, readLegacyMonths } from '../../src/data/legacyImport.js';

const month = (id, extra = {}) => ({ id, income: { base: 0, extras: [] }, daily: [], recurringMonthly: [], recurringYearly: [], ...extra });

test('bucketForCategory maps known, legacy and unknown categories', () => {
  assert.equal(bucketForCategory('Housing'), 'needs');
  assert.equal(bucketForCategory('Dining Out'), 'wants');
  assert.equal(bucketForCategory('Savings & Invest'), 'savings');
  assert.equal(bucketForCategory('Food & Dining'), 'needs');
  assert.equal(bucketForCategory('Something New'), 'wants');
});

test('converts base income, extras and daily expenses', () => {
  const { transactions } = convertLegacyMonths([
    month('2026-01', {
      income: { base: 50000, extras: [{ label: 'Bonus', amount: 1000 }] },
      daily: [{ amount: 120.5, category: 'Food & Dining', note: 'Tea', date: '2026-01-02' }],
    }),
  ], { createdBy: 'me' });
  assert.equal(transactions.length, 3);
  const [base, bonus, tea] = transactions;
  assert.deepEqual([base.kind, base.amount_paise, base.occurred_on, base.category], ['income', 5000000, '2026-01-01', 'Salary']);
  assert.deepEqual([bonus.amount_paise, bonus.note], [100000, 'Bonus']);
  assert.deepEqual([tea.kind, tea.amount_paise, tea.bucket, tea.note, tea.created_by], ['expense', 12050, 'needs', 'Tea', 'me']);
});

test('accepts the oldest format where income is a plain number', () => {
  const { transactions } = convertLegacyMonths([{ id: '2025-12', income: 40000, daily: [] }], { createdBy: 'me' });
  assert.equal(transactions[0].amount_paise, 4000000);
});

test('skips zero, negative, non-numeric and undated entries', () => {
  const { transactions } = convertLegacyMonths([
    month('2026-01', {
      income: { base: 'abc', extras: [{ label: 'x', amount: -5 }, { label: 'y', amount: 0 }] },
      daily: [{ amount: 0, date: '2026-01-02' }, { amount: 'x', date: '2026-01-02' }, { amount: 5, category: 'A' }],
    }),
  ], { createdBy: 'me' });
  assert.equal(transactions.length, 0);
});

test('long text is truncated to the database limits', () => {
  const { transactions, recurring } = convertLegacyMonths([
    month('2026-01', {
      daily: [{ amount: 1, category: 'c'.repeat(100), note: 'n'.repeat(500), date: '2026-01-02' }],
      recurringMonthly: [{ name: 'r'.repeat(200), amount: 1, ts: 1 }],
    }),
  ], { createdBy: 'me' });
  assert.equal(transactions[0].category.length, 60);
  assert.equal(transactions[0].note.length, 200);
  assert.equal(recurring[0].name.length, 80);
});

test('blank category falls back to Miscellaneous', () => {
  const { transactions } = convertLegacyMonths([month('2026-01', { daily: [{ amount: 1, category: '  ', date: '2026-01-02' }] })], { createdBy: 'me' });
  assert.equal(transactions[0].category, 'Miscellaneous');
});

test('recurring items that were copied into every month are de-duplicated by ts', () => {
  const rent = { name: 'Rent', amount: 12000, ts: 11 };
  const { recurring } = convertLegacyMonths([
    month('2026-01', { recurringMonthly: [rent] }),
    month('2026-02', { recurringMonthly: [rent] }),
    month('2026-03', { recurringMonthly: [rent] }),
  ], { createdBy: 'me' });
  assert.equal(recurring.length, 1);
  assert.deepEqual([recurring[0].start_on, recurring[0].end_on, recurring[0].amount_paise], ['2026-01-01', null, 1200000]);
});

test('an item missing from the newest month is ended at its last month', () => {
  const { recurring } = convertLegacyMonths([
    month('2026-01', { recurringMonthly: [{ name: 'Gym', amount: 500, ts: 12 }] }),
    month('2026-02', {}),
  ], { createdBy: 'me' });
  assert.equal(recurring[0].end_on, '2026-01-31');
});

test('yearly items keep their due month; ones without a valid month are dropped', () => {
  const { recurring } = convertLegacyMonths([
    month('2026-01', {
      recurringYearly: [{ name: 'Insurance', amount: 12000, month: 4, ts: 13 }, { name: 'Broken', amount: 100, ts: 14 }, { name: 'Bad', amount: 100, month: 13, ts: 15 }],
    }),
  ], { createdBy: 'me' });
  assert.equal(recurring.length, 1);
  assert.deepEqual([recurring[0].frequency, recurring[0].due_month], ['yearly', 4]);
});

test('items without a ts are still de-duplicated by name and amount', () => {
  const { recurring } = convertLegacyMonths([
    month('2026-01', { recurringMonthly: [{ name: 'Net', amount: 800 }] }),
    month('2026-02', { recurringMonthly: [{ name: 'Net', amount: 800 }] }),
  ], { createdBy: 'me' });
  assert.equal(recurring.length, 1);
});

test('months are processed in chronological order regardless of input order', () => {
  const rent = { name: 'Rent', amount: 100, ts: 1 };
  const { recurring } = convertLegacyMonths([month('2026-03', { recurringMonthly: [rent] }), month('2026-01', { recurringMonthly: [rent] })], { createdBy: 'me' });
  assert.equal(recurring[0].start_on, '2026-01-01');
});

test('no months converts to nothing', () => {
  assert.deepEqual(convertLegacyMonths([], { createdBy: 'me' }), { transactions: [], recurring: [] });
});

test('readLegacyMonths: returns [] when the original app never ran here', async () => {
  globalThis.indexedDB = new IDBFactory();
  assert.deepEqual(await readLegacyMonths(), []);
  assert.equal((await indexedDB.databases()).length, 0, 'must not create an empty database as a side effect');
});

test('readLegacyMonths: reads the months store of the original database', async () => {
  globalThis.indexedDB = new IDBFactory();
  await new Promise((resolve, reject) => {
    const open = indexedDB.open('SmartFinanceDB_v1', 2);
    open.onupgradeneeded = () => open.result.createObjectStore('months', { keyPath: 'id' });
    open.onsuccess = () => {
      const tx = open.result.transaction('months', 'readwrite');
      tx.objectStore('months').put(month('2026-01', { income: { base: 10, extras: [] } }));
      tx.objectStore('months').put(month('2026-02'));
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
  const months = await readLegacyMonths();
  assert.deepEqual(months.map((m) => m.id).sort(), ['2026-01', '2026-02']);
});

test('readLegacyMonths: a database without the months store yields []', async () => {
  globalThis.indexedDB = new IDBFactory();
  await new Promise((resolve) => {
    const open = indexedDB.open('SmartFinanceDB_v1', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('other');
    open.onsuccess = () => { open.result.close(); resolve(); };
  });
  assert.deepEqual(await readLegacyMonths(), []);
});
