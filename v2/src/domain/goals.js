import { monthIdOf, monthsBetween, todayISO } from '../core/dates.js';
import { sumPaise } from '../core/money.js';

export function goalProgress(goal, contributions = [], today = todayISO()) {
  const savedPaise = sumPaise(contributions.filter((c) => c.goal_id === goal.id));
  const remainingPaise = Math.max(goal.target_paise - savedPaise, 0);
  const pct = Math.min(100, Math.round((savedPaise / goal.target_paise) * 100));
  const done = remainingPaise === 0;

  let monthsLeft = null;
  let requiredMonthlyPaise = null;
  let overdue = false;
  if (goal.deadline && !done) {
    if (goal.deadline < today) {
      overdue = true;
    } else {
      monthsLeft = Math.max(monthsBetween(monthIdOf(today), monthIdOf(goal.deadline)), 1);
      requiredMonthlyPaise = Math.ceil(remainingPaise / monthsLeft);
    }
  }

  return { savedPaise, remainingPaise, pct, done, monthsLeft, requiredMonthlyPaise, overdue };
}
