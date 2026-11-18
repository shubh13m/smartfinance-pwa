import { EXPENSE_CATEGORIES } from '../config/constants.js';
import { toPaise } from '../core/money.js';
import { lastDayOfMonth } from '../core/dates.js';

const LEGACY_CATEGORY_BUCKETS = {
  'Food & Dining': 'needs',
  'Savings & Invest': 'savings',
  'Debt & Loans': 'needs',
  Housing: 'needs',
  Transportation: 'needs',
  Utilities: 'needs',
  Health: 'needs',
};

export function bucketForCategory(category) {
  return EXPENSE_CATEGORIES[category] || LEGACY_CATEGORY_BUCKETS[category] || 'wants';
}

function safePaise(value) {
  try {
    return toPaise(value);
  } catch {
    return 0;
  }
}

/**
 * Converts the v1 "one document per month" shape into v2 rows.
 * v1 copies recurring items into every month, so items are de-duplicated by
 * their `ts` id and given a start (first month seen) and end (last month seen,
 * unless the item is still present in the newest month).
 */
export function convertLegacyMonths(months, { createdBy }) {
  const transactions = [];
  const recurringByTs = new Map();
  const sorted = [...months].sort((a, b) => a.id.localeCompare(b.id));
  const newestMonth = sorted.at(-1)?.id;

  for (const month of sorted) {
    const income = typeof month.income === 'number' ? { base: month.income, extras: [] } : month.income || {};
    const base = safePaise(income.base);
    if (base > 0) {
      transactions.push({
        kind: 'income', amount_paise: base, category: 'Salary', note: 'Imported base income',
        occurred_on: `${month.id}-01`, bucket: null, created_by: createdBy,
      });
    }
    for (const extra of income.extras || []) {
      const amount = safePaise(extra.amount);
      if (amount <= 0) continue;
      transactions.push({
        kind: 'income', amount_paise: amount, category: 'Other', note: String(extra.label || extra.name || 'Extra income').slice(0, 200),
        occurred_on: `${month.id}-01`, bucket: null, created_by: createdBy,
      });
    }
    for (const entry of month.daily || []) {
      const amount = safePaise(entry.amount);
      if (amount <= 0 || !entry.date) continue;
      const category = String(entry.category || 'Miscellaneous').trim().slice(0, 60) || 'Miscellaneous';
      transactions.push({
        kind: 'expense', amount_paise: amount, category, note: String(entry.note || '').slice(0, 200),
        occurred_on: entry.date, bucket: bucketForCategory(category), created_by: createdBy,
      });
    }

    const track = (items, frequency) => {
      for (const item of items || []) {
        const key = `${frequency}:${item.ts ?? `${item.name}:${item.amount}`}`;
        const seen = recurringByTs.get(key) || { item, frequency, first: month.id, last: month.id };
        seen.last = month.id;
        recurringByTs.set(key, seen);
      }
    };
    track(month.recurringMonthly, 'monthly');
    track(month.recurringYearly, 'yearly');
  }

  const recurring = [];
  for (const { item, frequency, first, last } of recurringByTs.values()) {
    const amount = safePaise(item.amount);
    if (amount <= 0) continue;
    const dueMonth = Number(item.month);
    if (frequency === 'yearly' && !(dueMonth >= 1 && dueMonth <= 12)) continue;
    const category = frequency === 'yearly' ? 'Insurance' : 'Housing';
    recurring.push({
      kind: 'expense',
      name: String(item.name || 'Recurring item').slice(0, 80),
      amount_paise: amount,
      frequency,
      due_month: frequency === 'yearly' ? dueMonth : null,
      start_on: `${first}-01`,
      end_on: last < newestMonth ? lastDayOfMonth(last) : null,
      category,
      bucket: 'needs',
      created_by: createdBy,
    });
  }

  return { transactions, recurring };
}

export async function readLegacyMonths(dbName = 'SmartFinanceDB_v1', storeName = 'months') {
  if (!globalThis.indexedDB) return [];
  // open() would create an empty database if the original app was never used here.
  if (indexedDB.databases) {
    const known = await indexedDB.databases();
    if (!known.some((entry) => entry.name === dbName)) return [];
  }
  return new Promise((resolve) => {
    const request = indexedDB.open(dbName);
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        return resolve([]);
      }
      const read = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      read.onsuccess = () => { db.close(); resolve(read.result || []); };
      read.onerror = () => { db.close(); resolve([]); };
    };
  });
}
