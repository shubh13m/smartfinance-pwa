import { h } from '../../core/dom.js';
import { lastDayOfMonth, monthName, todayISO } from '../../core/dates.js';
import { formatINR, toPaise } from '../../core/money.js';
import { BUCKETS, BUCKET_LABELS, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../config/constants.js';
import { isActiveInMonth } from '../../domain/recurring.js';
import {
  avatarFor,   button, card, emptyState, field, iconButton, input, memberName, moneyInput, select, singleFlight, toast,
} from '../../ui/components.js';

export function renderRecurring(container, ctx) {
  container.append(h('div', { class: 'grid-2 three' }, buildList(ctx), buildForm(ctx)));
}

function buildForm(ctx) {
  const kind = select([{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]);
  const name = input({ type: 'text', maxlength: 80, required: true, placeholder: 'Rent, SIP, Insurance…' });
  const amount = moneyInput({ required: true });
  const frequency = select([{ value: 'monthly', label: 'Every month' }, { value: 'yearly', label: 'Once a year' }]);
  const dueMonth = select(Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: monthName(i + 1) })));
  const dueField = field('Due month', dueMonth);
  const start = input({ type: 'date', value: todayISO(), required: true });
  const category = input({ type: 'text', list: 'rec-categories', maxlength: 60, required: true, autocomplete: 'off' });
  const datalist = h('datalist', { id: 'rec-categories' });
  const bucket = select(BUCKETS.map((b) => ({ value: b, label: BUCKET_LABELS[b] })));
  const bucketField = field('Plan bucket', bucket);

  const sync = () => {
    dueField.hidden = frequency.value !== 'yearly';
    const isExpense = kind.value === 'expense';
    bucketField.hidden = !isExpense;
    datalist.replaceChildren(...(isExpense ? Object.keys(EXPENSE_CATEGORIES) : INCOME_CATEGORIES)
      .map((n) => h('option', { value: n })));
  };
  kind.addEventListener('change', sync);
  frequency.addEventListener('change', sync);
  category.addEventListener('input', () => {
    if (kind.value === 'expense' && EXPENSE_CATEGORIES[category.value]) bucket.value = EXPENSE_CATEGORIES[category.value];
  });
  sync();

  const submit = singleFlight(async () => {
    let amount_paise;
    try { amount_paise = toPaise(amount.querySelector('input').value); } catch { return toast('Enter a valid amount.', 'error'); }
    await ctx.mutate(() => ctx.ledger.addRecurring({
      kind: kind.value, name: name.value, amount_paise, frequency: frequency.value,
      due_month: frequency.value === 'yearly' ? Number(dueMonth.value) : null,
      start_on: start.value, end_on: null, category: category.value,
      bucket: kind.value === 'expense' ? bucket.value : null,
    }), 'Recurring item added');
  });

  return card({ title: 'Add recurring item', subtitle: 'Rent, EMIs, SIPs, salary, insurance…' },
    h('form', { class: 'form', onSubmit: submit },
      h('div', { class: 'form-grid' },
        field('Type', kind), field('How often', frequency),
        h('div', { class: 'span-2' }, field('Name', name)),
        field('Amount (₹)', amount), dueField,
        field('Starts on', start), field('Category', category), bucketField),
      datalist,
      h('div', { class: 'actions' }, button('Add item', { type: 'submit', class: 'primary', icon: 'plus' }))));
}

function buildList(ctx) {
  const { data, state, mutate } = ctx;
  const { monthId } = state.get();
  const items = [...data.recurring].sort((a, b) => a.name.localeCompare(b.name));

  return card({ title: 'Recurring items', subtitle: `${items.length} set up` },
    items.length === 0
      ? emptyState('Nothing recurring yet', 'Add rent, EMIs, SIPs or yearly premiums once and they count every month.', 'repeat')
      : h('ul', { class: 'list' }, items.map((item) => {
        const active = isActiveInMonth(item, monthId);
        const detail = item.frequency === 'yearly'
          ? `${formatINR(item.amount_paise)} every ${monthName(item.due_month)}`
          : `${formatINR(item.amount_paise)} / month`;
        return h('li', { class: `list-item ${active ? '' : 'inactive'}` },
          avatarFor(data.members, item.created_by),
          h('div', { class: 'grow' },
            h('div', { class: 'item-title' }, item.name),
            h('div', { class: 'item-sub' }, `${item.kind === 'income' ? 'Income' : item.category} · ${detail}`),
            h('div', { class: 'item-sub' },
              `from ${item.start_on}${item.end_on ? ` to ${item.end_on}` : ''} · ${memberName(data.members, item.created_by)}`)),
          h('div', { class: 'item-actions' },
            active && !item.end_on
              ? button('Stop', {
                class: 'sm', title: 'Stop after this month',
                onClick: () => mutate(() => ctx.ledger.endRecurring(item.id, lastDayOfMonth(monthId)), 'Stopped after this month'),
              })
              : null,
            iconButton('trash', `Delete ${item.name}`, {
              onClick: () => confirm('Delete this item from all months, including history?')
                && mutate(() => ctx.ledger.deleteRecurring(item.id), 'Recurring item deleted'),
            })));
      })));
}
