import { BUCKETS } from '../config/constants.js';
import { monthIdOf } from '../core/dates.js';
import { amountInMonth } from './recurring.js';

const emptyBuckets = () => Object.fromEntries(BUCKETS.map((b) => [b, 0]));

function matchesPerson(row, personId) {
  return !personId || personId === 'all' || row.created_by === personId;
}

/**
 * Builds the numbers for one month.
 * personId: 'all' (combined) or a user id (that person's own entries).
 * basis: 'smoothed' spreads yearly bills over 12 months, 'cash' shows when they are paid.
 */
export function summarizeMonth({ monthId, transactions = [], recurring = [], personId = 'all', basis = 'smoothed' }) {
  const byBucket = emptyBuckets();
  const byCategory = {};
  let incomePaise = 0;
  let expensePaise = 0;

  const addExpense = (category, bucket, amount) => {
    if (!amount) return;
    expensePaise += amount;
    byBucket[bucket] = (byBucket[bucket] || 0) + amount;
    byCategory[category] = (byCategory[category] || 0) + amount;
  };

  for (const tx of transactions) {
    if (monthIdOf(tx.occurred_on) !== monthId || !matchesPerson(tx, personId)) continue;
    if (tx.kind === 'income') incomePaise += tx.amount_paise;
    else addExpense(tx.category, tx.bucket, tx.amount_paise);
  }

  for (const item of recurring) {
    if (!matchesPerson(item, personId)) continue;
    const amount = amountInMonth(item, monthId, basis);
    if (item.kind === 'income') incomePaise += amount;
    else addExpense(item.category, item.bucket, amount);
  }

  const savedPaise = byBucket.savings;
  return {
    incomePaise,
    expensePaise,
    byBucket,
    byCategory,
    netPaise: incomePaise - expensePaise,
    savingsRatePct: incomePaise > 0 ? Math.round((savedPaise / incomePaise) * 100) : 0,
  };
}

export function summarizeByPerson({ members, ...rest }) {
  return members.map((member) => ({
    member,
    summary: summarizeMonth({ ...rest, personId: member.user_id }),
  }));
}

export function topCategories(byCategory, limit = 8) {
  return Object.entries(byCategory)
    .map(([category, paise]) => ({ category, paise }))
    .sort((a, b) => b.paise - a.paise)
    .slice(0, limit);
}

export function monthlyTrend({ monthIds, transactions, recurring, personId, basis }) {
  return monthIds.map((monthId) => ({
    monthId,
    ...summarizeMonth({ monthId, transactions, recurring, personId, basis }),
  }));
}
