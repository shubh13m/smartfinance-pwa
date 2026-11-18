import { h } from '../../core/dom.js';
import { currentMonthId, monthLabel, todayISO } from '../../core/dates.js';
import { formatINR, toPaise } from '../../core/money.js';
import { planMonth } from '../../domain/cashflow.js';
import { amortize, payoffMonth, prepaymentImpact } from '../../domain/loans.js';
import {
  button, card, emptyState, field, iconButton, input, moneyInput, singleFlight, toast,
} from '../../ui/components.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function parseRupees(value) {
  try { return Math.max(0, toPaise(value)); } catch { return 0; }
}

export function renderLoans(container, ctx) {
  container.append(h('div', { class: 'grid-2 three' }, buildList(ctx), buildForm(ctx)));
}

function buildForm(ctx) {
  const name = input({ type: 'text', maxlength: 80, required: true, placeholder: 'Home loan, Car loan…' });
  const outstanding = moneyInput({ required: true });
  const rate = input({ type: 'text', inputmode: 'decimal', required: true, placeholder: 'e.g. 8.5' });
  const emi = moneyInput({ required: true });

  const submit = singleFlight(async () => {
    let outstanding_paise;
    let emi_paise;
    try {
      outstanding_paise = toPaise(outstanding.querySelector('input').value);
      emi_paise = toPaise(emi.querySelector('input').value);
    } catch { return toast('Enter valid amounts.', 'error'); }
    await ctx.mutate(() => ctx.ledger.addLoan({
      name: name.value, outstanding_paise, emi_paise, rate_pct: rate.value.trim(),
    }), 'Loan added');
  });

  return card({ title: 'Add a loan', subtitle: 'To see how prepaying would help' },
    h('form', { class: 'form', onSubmit: submit },
      field('Loan name', name),
      field('Outstanding balance (₹)', outstanding),
      field('Interest rate (% a year)', rate),
      field('Monthly EMI (₹)', emi),
      h('p', { class: 'hint' }, 'Add the EMI under Recurring too, so it counts in your monthly budget.'),
      h('div', { class: 'actions' }, button('Add loan', { type: 'submit', class: 'primary', icon: 'plus' }))));
}

function buildList(ctx) {
  const { data } = ctx;
  return card({ title: 'Loans & EMIs', subtitle: data.loans.length ? `${plural(data.loans.length, 'loan')}` : null },
    data.loans.length === 0
      ? emptyState('No loans added', 'Add a loan to see when it ends and what prepaying could save.', 'wallet')
      : h('div', null, data.loans.map((loan) => loanBlock(ctx, loan))));
}

function loanBlock(ctx, loan) {
  const today = todayISO();
  const base = amortize({ balancePaise: loan.outstanding_paise, annualRatePct: Number(loan.rate_pct), emiPaise: loan.emi_paise });

  const fact = (label, value) => h('div', { class: 'loan-fact' }, h('span', null, label), h('strong', { class: 'num' }, value));

  const lump = moneyInput({ 'aria-label': `One-time prepayment for ${loan.name}`, placeholder: '0' });
  const extra = moneyInput({ 'aria-label': `Extra every month for ${loan.name}`, placeholder: '0' });
  const result = h('p', { class: 'result', 'data-testid': 'prepay-result' });

  const recalc = () => {
    const impact = prepaymentImpact(loan, {
      lumpSumPaise: parseRupees(lump.querySelector('input').value),
      extraMonthlyPaise: parseRupees(extra.querySelector('input').value),
    });
    const plan = impact.plan;
    if (plan.neverPaidOff) {
      result.textContent = 'Even with this, the payment does not cover the interest, so the loan would never clear.';
    } else if (impact.emiTooLow) {
      result.textContent = `This would clear the loan in ${plural(plan.months, 'month')} (by ${monthLabel(payoffMonth(today, plan.months))}). Your current EMI alone never would.`;
    } else if (impact.monthsSaved === 0 && impact.interestSavedPaise === 0) {
      result.textContent = 'Enter an amount to see the effect.';
    } else {
      result.textContent = `Done ${plural(impact.monthsSaved, 'month')} sooner (${monthLabel(payoffMonth(today, plan.months))}) and ${formatINR(impact.interestSavedPaise)} less interest.`;
    }
  };
  lump.addEventListener('input', recalc);
  extra.addEventListener('input', recalc);
  recalc();

  const planNow = planMonth({
    monthId: currentMonthId(), today, transactions: ctx.data.transactions, recurring: ctx.data.recurring, split: ctx.data.split,
  });
  const useSafe = () => {
    const safe = Math.max(0, planNow.safePaise);
    lump.querySelector('input').value = String(Math.floor(safe / 100));
    recalc();
  };

  const balance = moneyInput({ 'aria-label': `New outstanding balance for ${loan.name}`, placeholder: 'New balance' });
  const updateBalance = singleFlight(async () => {
    let outstanding_paise;
    try { outstanding_paise = toPaise(balance.querySelector('input').value); } catch { return toast('Enter a valid balance.', 'error'); }
    await ctx.mutate(() => ctx.ledger.updateLoan(loan.id, {
      name: loan.name, outstanding_paise, rate_pct: loan.rate_pct, emi_paise: loan.emi_paise,
    }), 'Balance updated');
  });

  return h('div', { class: 'loan', 'data-loan': loan.name },
    h('div', { class: 'loan-head' },
      h('div', null, h('strong', null, loan.name),
        base.neverPaidOff
          ? h('p', { class: 'hint' }, 'The EMI is lower than the monthly interest, so this loan never clears.')
          : h('p', { class: 'hint', 'data-testid': 'payoff' }, loan.outstanding_paise === 0
            ? 'Fully paid off'
            : `Clears in ${plural(base.months, 'month')} (${monthLabel(payoffMonth(today, base.months))}) · ${formatINR(base.interestPaise)} interest still to pay`)),
      iconButton('trash', `Delete loan ${loan.name}`, {
        onClick: () => confirm(`Delete "${loan.name}"?`) && ctx.mutate(() => ctx.ledger.deleteLoan(loan.id), 'Loan deleted'),
      })),
    h('div', { class: 'loan-facts' },
      fact('Outstanding', formatINR(loan.outstanding_paise)),
      fact('Interest', `${Number(loan.rate_pct)}% a year`),
      fact('EMI', formatINR(loan.emi_paise))),
    h('div', { class: 'whatif' },
      h('h3', null, 'What if I prepay?'),
      h('div', { class: 'form-grid' }, field('One-time prepayment', lump), field('Extra every month', extra)),
      planNow.safePaise > 0
        ? h('div', { class: 'actions' }, button(`Use this month’s safe to spend (${formatINR(planNow.safePaise)})`, { class: 'sm', onClick: useSafe }))
        : null,
      result),
    h('form', { class: 'inline-form', onSubmit: updateBalance }, balance, button('Update balance', { type: 'submit', icon: 'check' })));
}
