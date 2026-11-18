import { monthIdOf, monthNumber } from '../core/dates.js';

export function isActiveInMonth(item, monthId) {
  if (monthIdOf(item.start_on) > monthId) return false;
  if (item.end_on && monthIdOf(item.end_on) < monthId) return false;
  return true;
}

// Cash view: what actually leaves (or arrives) in this month.
export function dueInMonth(item, monthId) {
  if (!isActiveInMonth(item, monthId)) return 0;
  if (item.frequency === 'monthly') return item.amount_paise;
  return item.due_month === monthNumber(monthId) ? item.amount_paise : 0;
}

// Smoothed view: yearly items spread evenly over twelve months.
export function monthlyEquivalent(item, monthId) {
  if (!isActiveInMonth(item, monthId)) return 0;
  return item.frequency === 'monthly' ? item.amount_paise : Math.round(item.amount_paise / 12);
}

export function amountInMonth(item, monthId, basis = 'smoothed') {
  return basis === 'cash' ? dueInMonth(item, monthId) : monthlyEquivalent(item, monthId);
}
