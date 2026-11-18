import { DEFAULT_SPLIT } from '../config/constants.js';
import { dayOfMonth, daysInMonth, monthIdOf } from '../core/dates.js';
import { bucketTargets } from './budget503020.js';
import { summarizeMonth } from './summary.js';

export const MIN_DAYS_FOR_FORECAST = 3;

export function monthPhase(monthId, today) {
  const current = monthIdOf(today);
  if (monthId === current) return 'current';
  return monthId < current ? 'past' : 'future';
}

/**
 * The month at a glance for one person or the whole household.
 *
 *   leftPaise  = income − everything spent (investments count as money gone)
 *   safePaise  = leftPaise − what you still have to invest to hit the plan's savings target
 *              = income − bills & spending so far − the investment you are protecting
 *
 * All of this month's recurring bills count as committed from day one (conservative on purpose).
 */
export function planMonth({
  monthId, today, transactions = [], recurring = [], split = DEFAULT_SPLIT, personId = 'all', basis = 'smoothed',
}) {
  const base = { monthId, transactions, recurring, personId, basis };
  const all = summarizeMonth(base);
  const entries = summarizeMonth({ ...base, recurring: [] });
  const bills = summarizeMonth({ ...base, transactions: [] });
  const notInvested = (s) => s.byBucket.needs + s.byBucket.wants;

  const incomePaise = all.incomePaise;
  const spentPaise = all.expensePaise;
  const investedPaise = all.byBucket.savings;
  const billsPaise = notInvested(bills);
  const variablePaise = notInvested(entries);
  const leftPaise = incomePaise - spentPaise;

  const targetPaise = bucketTargets(incomePaise, split).savings;
  const stillToInvestPaise = Math.max(0, targetPaise - investedPaise);
  const safePaise = leftPaise - stillToInvestPaise;

  const phase = monthPhase(monthId, today);
  const totalDays = daysInMonth(monthId);
  const day = phase === 'current' ? dayOfMonth(today) : phase === 'past' ? totalDays : 0;
  const daysLeft = phase === 'current' ? totalDays - day + 1 : 0;

  const dailyAllowancePaise = phase === 'current' && safePaise > 0 ? Math.floor(safePaise / daysLeft) : 0;

  // Projects the day-to-day spending so far across the rest of the month.
  let forecastSafePaise = null;
  if (phase === 'current' && day >= MIN_DAYS_FOR_FORECAST && variablePaise > 0) {
    const projectedExtra = Math.round((variablePaise / day) * (totalDays - day));
    forecastSafePaise = safePaise - projectedExtra;
  }

  let status = 'ok';
  if (incomePaise === 0) status = spentPaise > 0 ? 'no_income' : 'empty';
  else if (safePaise < 0) status = 'over';
  else if ((forecastSafePaise !== null && forecastSafePaise < 0) || safePaise < incomePaise * 0.05) status = 'tight';

  return {
    phase, day, totalDays, daysLeft, status,
    incomePaise, spentPaise, investedPaise, billsPaise, variablePaise,
    leftPaise, targetPaise, stillToInvestPaise, safePaise, dailyAllowancePaise, forecastSafePaise,
  };
}
