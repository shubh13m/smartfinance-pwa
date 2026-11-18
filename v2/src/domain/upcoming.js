import { addDays, daysBetween, daysInMonth, addMonths, monthIdOf, monthNumber } from '../core/dates.js';

const pad = (n) => String(n).padStart(2, '0');

// The day of the month an item falls due is the day of its first due date.
function dueDateIn(item, monthId) {
  if (item.frequency === 'yearly' && item.due_month !== monthNumber(monthId)) return null;
  const day = Math.min(Number(item.start_on.slice(8, 10)), daysInMonth(monthId));
  return `${monthId}-${pad(day)}`;
}

/**
 * Recurring expenses (bills, EMIs, SIPs) falling due from `from` for the next `days` days.
 * Amounts are the full cash amount on the due date, not the monthly average.
 */
export function upcomingBills({ recurring, from, days = 30, personId = 'all' }) {
  const end = addDays(from, days);
  const firstMonth = monthIdOf(from);
  const months = [firstMonth, addMonths(firstMonth, 1), addMonths(firstMonth, 2)];
  const result = [];

  for (const item of recurring) {
    if (item.kind !== 'expense') continue;
    if (personId !== 'all' && item.created_by !== personId) continue;
    for (const monthId of months) {
      const date = dueDateIn(item, monthId);
      // The window is half-open ([from, from + days)) so a monthly bill due today is not listed again 30 days later.
      if (!date || date < from || date >= end) continue;
      if (date < item.start_on || (item.end_on && date > item.end_on)) continue;
      result.push({ item, date, amountPaise: item.amount_paise, daysAway: daysBetween(from, date) });
    }
  }

  result.sort((a, b) => a.date.localeCompare(b.date) || a.item.name.localeCompare(b.item.name));
  return { bills: result, totalPaise: result.reduce((sum, b) => sum + b.amountPaise, 0), until: end };
}
