import { h } from '../../core/dom.js';
import { todayISO } from '../../core/dates.js';
import { fromPaise, toPaise } from '../../core/money.js';
import { BUCKETS, BUCKET_LABELS, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../config/constants.js';
import { button, field, input, moneyInput, openSheet, segmented, select, singleFlight, toast } from '../../ui/components.js';

/**
 * Add / edit form for a single income or expense. Used inside the sheet
 * opened by the floating "+" button and by the Edit action on a row.
 */
export function buildEntryForm(ctx, { editing = null, onDone = () => {} } = {}) {
  let kind = editing?.kind || 'expense';

  const amount = moneyInput({ required: true, value: editing ? fromPaise(editing.amount_paise) : '' });
  const date = input({ type: 'date', value: editing?.occurred_on || todayISO(), required: true });
  const category = input({ type: 'text', list: 'entry-categories', maxlength: 60, required: true, autocomplete: 'off', value: editing?.category || '' });
  const datalist = h('datalist', { id: 'entry-categories' });
  const bucket = select(BUCKETS.map((b) => ({ value: b, label: BUCKET_LABELS[b] })), { value: editing?.bucket || 'needs' });
  const bucketField = field('Plan bucket', bucket, 'Which part of your 50/30/20 plan this belongs to');
  const note = input({ type: 'text', maxlength: 200, value: editing?.note || '', placeholder: 'Optional' });
  const toggle = h('div');

  const sync = () => {
    const isExpense = kind === 'expense';
    bucketField.hidden = !isExpense;
    datalist.replaceChildren(...(isExpense ? Object.keys(EXPENSE_CATEGORIES) : INCOME_CATEGORIES)
      .map((name) => h('option', { value: name })));
    toggle.replaceChildren(segmented(
      [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }],
      kind,
      (value) => { kind = value; sync(); },
    ));
  };
  category.addEventListener('input', () => {
    if (kind === 'expense' && EXPENSE_CATEGORIES[category.value]) bucket.value = EXPENSE_CATEGORIES[category.value];
  });
  sync();

  const submit = singleFlight(async () => {
    let amount_paise;
    try { amount_paise = toPaise(amount.querySelector('input').value); } catch { return toast('Enter a valid amount.', 'error'); }
    const payload = {
      kind, amount_paise, occurred_on: date.value, category: category.value,
      bucket: kind === 'expense' ? bucket.value : null, note: note.value,
    };
    // If the server rejects the save after the sheet has closed, bring the form back with what was typed.
    const ok = await ctx.mutate(
      () => (editing ? ctx.ledger.updateTransaction(editing.id, payload) : ctx.ledger.addTransaction(payload)),
      editing ? 'Entry updated' : 'Entry saved',
      { onFail: () => openEntrySheet(ctx, editing ? { ...payload, id: editing.id } : payload) },
    );
    if (ok) onDone();
  });

  return h('form', { class: 'form', onSubmit: submit },
    toggle,
    h('div', { class: 'form-grid' },
      field('Amount (₹)', amount), field('Date', date),
      field('Category', category), bucketField,
      h('div', { class: 'span-2' }, field('Note', note))),
    datalist,
    h('div', { class: 'actions' },
      button(editing ? 'Save changes' : 'Add entry', { type: 'submit', class: 'primary', icon: 'check' })));
}

export function openEntrySheet(ctx, editing = null) {
  let sheet;
  const content = buildEntryForm(ctx, { editing, onDone: () => sheet.close() });
  sheet = openSheet({ title: editing ? 'Edit entry' : 'New entry', content });
  return sheet;
}
