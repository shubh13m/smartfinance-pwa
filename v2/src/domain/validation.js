import { BUCKETS, FREQUENCIES } from '../config/constants.js';
import { isValidISODate } from '../core/dates.js';

const text = (value) => String(value ?? '').trim();

function finish(errors, value) {
  return errors.length ? { ok: false, errors, value: null } : { ok: true, errors: [], value };
}

function checkAmount(input, errors) {
  const amount = input.amount_paise;
  if (!Number.isInteger(amount) || amount <= 0) errors.push('Amount must be greater than zero.');
  return amount;
}

function checkText(input, field, label, errors, { required = true, max = 80 } = {}) {
  const value = text(input[field]);
  if (required && !value) errors.push(`${label} is required.`);
  if (value.length > max) errors.push(`${label} must be at most ${max} characters.`);
  return value;
}

export function validateTransaction(input) {
  const errors = [];
  const kind = input.kind;
  if (kind !== 'income' && kind !== 'expense') errors.push('Type must be income or expense.');
  const amount_paise = checkAmount(input, errors);
  const category = checkText(input, 'category', 'Category', errors, { max: 60 });
  const note = checkText(input, 'note', 'Note', errors, { required: false, max: 200 });
  if (!isValidISODate(input.occurred_on)) errors.push('Date is invalid.');
  let bucket = null;
  if (kind === 'expense') {
    bucket = input.bucket;
    if (!BUCKETS.includes(bucket)) errors.push('Pick needs, wants or savings.');
  }
  return finish(errors, { kind, amount_paise, category, note, occurred_on: input.occurred_on, bucket });
}

export function validateRecurring(input) {
  const errors = [];
  const kind = input.kind === 'income' ? 'income' : 'expense';
  const name = checkText(input, 'name', 'Name', errors);
  const amount_paise = checkAmount(input, errors);
  const frequency = input.frequency;
  if (!FREQUENCIES.includes(frequency)) errors.push('Frequency must be monthly or yearly.');
  let due_month = null;
  if (frequency === 'yearly') {
    due_month = Number(input.due_month);
    if (!Number.isInteger(due_month) || due_month < 1 || due_month > 12) {
      errors.push('Pick the month a yearly item is due.');
    }
  }
  if (!isValidISODate(input.start_on)) errors.push('Start date is invalid.');
  const end_on = input.end_on || null;
  if (end_on && !isValidISODate(end_on)) errors.push('End date is invalid.');
  if (end_on && isValidISODate(input.start_on) && end_on < input.start_on) {
    errors.push('End date cannot be before the start date.');
  }
  const category = checkText(input, 'category', 'Category', errors, { max: 60 });
  let bucket = null;
  if (kind === 'expense') {
    bucket = input.bucket;
    if (!BUCKETS.includes(bucket)) errors.push('Pick needs, wants or savings.');
  }
  return finish(errors, {
    kind, name, amount_paise, frequency, due_month, start_on: input.start_on, end_on, category, bucket,
  });
}

export function validateGoal(input) {
  const errors = [];
  const name = checkText(input, 'name', 'Goal name', errors);
  const target_paise = input.target_paise;
  if (!Number.isInteger(target_paise) || target_paise <= 0) errors.push('Target must be greater than zero.');
  const deadline = input.deadline || null;
  if (deadline && !isValidISODate(deadline)) errors.push('Deadline is invalid.');
  return finish(errors, { name, target_paise, deadline, is_emergency: input.is_emergency === true });
}

export function validateLoan(input) {
  const errors = [];
  const name = checkText(input, 'name', 'Loan name', errors);
  const { outstanding_paise, emi_paise } = input;
  if (!Number.isInteger(outstanding_paise) || outstanding_paise < 0) errors.push('Outstanding amount cannot be negative.');
  if (!Number.isInteger(emi_paise) || emi_paise <= 0) errors.push('EMI must be greater than zero.');
  const rate_pct = Number(input.rate_pct);
  if (input.rate_pct === '' || input.rate_pct === null || input.rate_pct === undefined || !Number.isFinite(rate_pct) || rate_pct < 0 || rate_pct > 60) {
    errors.push('Interest rate must be between 0 and 60 percent a year.');
  }
  return finish(errors, { name, outstanding_paise, rate_pct: Math.round(rate_pct * 100) / 100, emi_paise });
}

export function validateContribution(input) {
  const errors = [];
  const amount_paise = checkAmount(input, errors);
  if (!input.goal_id) errors.push('Goal is required.');
  if (!isValidISODate(input.contributed_on)) errors.push('Date is invalid.');
  const note = checkText(input, 'note', 'Note', errors, { required: false, max: 200 });
  return finish(errors, { goal_id: input.goal_id, amount_paise, contributed_on: input.contributed_on, note });
}

export function validateSplit(split) {
  const errors = [];
  for (const bucket of BUCKETS) {
    const pct = Number(split?.[bucket]);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) errors.push(`${bucket} must be a whole number from 0 to 100.`);
  }
  if (!errors.length && BUCKETS.reduce((sum, b) => sum + Number(split[b]), 0) !== 100) {
    errors.push('Needs, wants and savings must add up to 100%.');
  }
  return finish(errors, {
    needs: Number(split?.needs), wants: Number(split?.wants), savings: Number(split?.savings),
  });
}
