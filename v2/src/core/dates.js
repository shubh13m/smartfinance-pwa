// Dates are plain 'YYYY-MM-DD' strings and months are 'YYYY-MM' ids.
// Local time is used on purpose: toISOString() would shift dates by timezone.

const pad = (n) => String(n).padStart(2, '0');

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthIdOf(dateStr) {
  return String(dateStr).slice(0, 7);
}

export function currentMonthId(now = new Date()) {
  return monthIdOf(todayISO(now));
}

export function addMonths(monthId, delta) {
  const [y, m] = monthId.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

export function monthNumber(monthId) {
  return Number(monthId.split('-')[1]);
}

export function monthsBetween(fromMonthId, toMonthId) {
  const [fy, fm] = fromMonthId.split('-').map(Number);
  const [ty, tm] = toMonthId.split('-').map(Number);
  return ty * 12 + tm - (fy * 12 + fm);
}

export function lastDayOfMonth(monthId) {
  const [y, m] = monthId.split('-').map(Number);
  return `${monthId}-${pad(new Date(y, m, 0).getDate())}`;
}

export function daysInMonth(monthId) {
  const [y, m] = monthId.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function dayOfMonth(dateStr) {
  return Number(String(dateStr).slice(8, 10));
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Whole days from a to b (negative if b is earlier).
export function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86_400_000);
}

export function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function monthLabel(monthId, locale = 'en-IN') {
  const [y, m] = monthId.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(locale, { month: 'long', year: 'numeric' });
}

export function monthName(monthNum, locale = 'en-IN') {
  return new Date(2000, monthNum - 1, 1).toLocaleString(locale, { month: 'long' });
}
