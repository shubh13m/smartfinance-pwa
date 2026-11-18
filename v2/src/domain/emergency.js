import { addMonths } from '../core/dates.js';
import { summarizeMonth } from './summary.js';

export const TARGET_MONTHS = 6;
export const LOW_MONTHS = 3;

/** Average monthly spend on needs over the last `months` months (ignoring months with none). */
export function essentialMonthly({ monthId, transactions = [], recurring = [], personId = 'all', basis = 'smoothed', months = 3 }) {
  const amounts = Array.from({ length: months }, (_, i) => addMonths(monthId, -i))
    .map((id) => summarizeMonth({ monthId: id, transactions, recurring, personId, basis }).byBucket.needs)
    .filter((paise) => paise > 0);
  return amounts.length ? Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length) : 0;
}

/** How many months of essentials the emergency fund would cover, against a 6-month target. */
export function emergencyStatus({ fundPaise, essentialPaise }) {
  if (essentialPaise <= 0) return { monthsCovered: null, targetPaise: 0, pct: 0, level: 'unknown', essentialPaise };
  const monthsCovered = fundPaise / essentialPaise;
  const targetPaise = essentialPaise * TARGET_MONTHS;
  let level = 'ready';
  if (monthsCovered < LOW_MONTHS) level = 'low';
  else if (monthsCovered < TARGET_MONTHS) level = 'building';
  return { monthsCovered, targetPaise, pct: Math.min(100, Math.round((fundPaise / targetPaise) * 100)), level, essentialPaise };
}
