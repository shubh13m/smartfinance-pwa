import { h } from '../../core/dom.js';
import { monthIdOf } from '../../core/dates.js';
import { formatINR } from '../../core/money.js';
import { sumPaise } from '../../core/money.js';
import { button, card, emptyState, iconButton, avatarFor, memberName } from '../../ui/components.js';
import { openEntrySheet } from './entryForm.js';

const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

export function renderTransactions(container, ctx) {
  const { data, state } = ctx;
  const { monthId, personId } = state.get();
  const rows = data.transactions
    .filter((t) => monthIdOf(t.occurred_on) === monthId && (personId === 'all' || t.created_by === personId))
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));

  const income = sumPaise(rows.filter((t) => t.kind === 'income'));
  const spent = sumPaise(rows.filter((t) => t.kind === 'expense'));

  const groups = new Map();
  for (const t of rows) groups.set(t.occurred_on, [...(groups.get(t.occurred_on) || []), t]);

  container.append(card(
    {
      title: 'Entries',
      subtitle: `${rows.length} this month · in ${formatINR(income)} · out ${formatINR(spent)}`,
      action: button('Add', { icon: 'plus', class: 'primary sm', onClick: () => openEntrySheet(ctx) }),
    },
    rows.length === 0
      ? emptyState('No entries yet', 'Tap “New entry” to record income or an expense.', 'wallet')
      : [...groups].map(([day, items]) => h('div', { class: 'day' },
        h('p', { class: 'date-head' }, dayLabel(day)),
        h('ul', { class: 'list' }, items.map((t) => entryRow(ctx, t)))))));
}

function entryRow(ctx, t) {
  const { data, mutate } = ctx;
  const sign = t.kind === 'income' ? '+' : '−';
  const detail = `${t.note ? `${t.note} · ` : ''}${memberName(data.members, t.created_by)}`;
  return h('li', { class: 'list-item entry' },
    avatarFor(data.members, t.created_by),
    h('div', { class: 'grow' },
      h('div', { class: 'item-title' }, t.category),
      h('div', { class: 'item-sub', title: detail }, detail)),
    h('div', { class: `item-amount num ${t.kind === 'income' ? 'pos' : ''}` }, `${sign}${formatINR(t.amount_paise)}`),
    h('div', { class: 'item-actions' },
      iconButton('edit', `Edit ${t.category}`, { onClick: () => openEntrySheet(ctx, t) }),
      iconButton('trash', `Delete ${t.category}`, {
        onClick: () => confirm('Delete this entry for both of you?') && mutate(() => ctx.ledger.deleteTransaction(t.id), 'Entry deleted'),
      })));
}
