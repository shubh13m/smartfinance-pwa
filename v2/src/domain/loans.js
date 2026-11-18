import { addMonths, monthIdOf } from '../core/dates.js';

export const MAX_PAYOFF_MONTHS = 1200;

/**
 * Month-by-month loan payoff. Interest accrues monthly on the outstanding balance;
 * the payment (EMI + any extra) first covers interest, the rest reduces the balance.
 * `neverPaidOff` is true when the payment cannot even cover the interest.
 */
export function amortize({ balancePaise, annualRatePct, emiPaise, extraMonthlyPaise = 0, lumpSumPaise = 0 }) {
  let balance = Math.max(0, balancePaise - lumpSumPaise);
  const monthlyRate = annualRatePct / 100 / 12;
  const payment = emiPaise + extraMonthlyPaise;
  let months = 0;
  let interestPaise = 0;

  while (balance > 0 && months < MAX_PAYOFF_MONTHS) {
    const interest = Math.round(balance * monthlyRate);
    if (payment <= interest) return { months: null, interestPaise: null, neverPaidOff: true };
    interestPaise += interest;
    balance = Math.max(0, balance + interest - payment);
    months += 1;
  }
  return { months, interestPaise, neverPaidOff: balance > 0 };
}

export function payoffMonth(from, months) {
  return addMonths(monthIdOf(from), months);
}

/** What a lump-sum and/or a higher monthly payment would save compared with just paying the EMI. */
export function prepaymentImpact(loan, { lumpSumPaise = 0, extraMonthlyPaise = 0 } = {}) {
  const input = { balancePaise: loan.outstanding_paise, annualRatePct: Number(loan.rate_pct), emiPaise: loan.emi_paise };
  const base = amortize(input);
  const plan = amortize({ ...input, lumpSumPaise, extraMonthlyPaise });
  if (base.neverPaidOff) return { base, plan, monthsSaved: null, interestSavedPaise: null, emiTooLow: true };
  return {
    base,
    plan,
    monthsSaved: base.months - plan.months,
    interestSavedPaise: base.interestPaise - plan.interestPaise,
    emiTooLow: false,
  };
}
