import { h, clear } from '../core/dom.js';
import { addMonths, monthLabel } from '../core/dates.js';
import { avatar, iconButton, segmented } from '../ui/components.js';
import { memberLabel, membersWithData } from '../domain/members.js';
import { icon } from '../ui/icons.js';
import { currentTheme, toggleTheme } from '../ui/theme.js';
import { openEntrySheet } from '../features/transactions/entryForm.js';
import { ROUTES } from './router.js';

const FILTERED_ROUTES = new Set(['dashboard', 'entries']);
const MONTH_ROUTES = new Set(['dashboard', 'entries', 'recurring']);
const brandMark = () => h('span', { class: 'brand-mark' }, icon('wallet', { size: 20 }));

export function renderShell(root, ctx) {
  const { state, data, session } = ctx;
  const { route, monthId, personId } = state.get();
  const active = ROUTES.find((r) => r.id === route) || ROUTES[0];
  const me = data.members.find((m) => m.user_id === session.userId) || { user_id: session.userId, display_name: session.displayName };

  const people = [
    { value: 'all', label: 'Together', leading: h('span', { class: 'avatar all' }, icon('users', { size: 16 })) },
    ...membersWithData(data.members, data).map((m) => ({ value: m.user_id, label: memberLabel(m), leading: avatar(m, data.members) })),
  ];

  const content = h('main', { class: 'content', id: 'content' });
  active.render(content, ctx);

  const themeButton = iconButton(currentTheme() === 'dark' ? 'sun' : 'moon', 'Toggle dark mode', {
    class: 'bordered',
    onClick: () => { toggleTheme(); ctx.rerender(); },
  });

  clear(root).append(h('div', { class: 'app' },
    h('aside', { class: 'sidebar', 'aria-label': 'Sidebar' },
      h('div', { class: 'brand' }, brandMark(), 'SmartFinance'),
      ROUTES.map((r) => h('a', {
        href: `#/${r.id}`, class: r.id === active.id ? 'side-link active' : 'side-link', 'aria-current': r.id === active.id ? 'page' : null,
      }, icon(r.icon), r.label)),
      h('div', { class: 'side-spacer' }),
      h('div', { class: 'side-user' }, avatar(me, data.members, { large: true }),
        h('div', null, h('strong', null, session.displayName), h('small', { class: 'muted' }, session.householdName || '')))),

    h('div', { class: 'main' },
      h('header', { class: 'topbar' },
        h('div', { class: 'topbar-title' }, h('span', { class: 'topbar-brand' }, brandMark()), h('h1', null, active.title)),
        h('div', { class: 'topbar-actions' }, themeButton)),
      MONTH_ROUTES.has(active.id) ? h('div', { class: 'toolbar' },
        h('div', { class: 'month-switch' },
          iconButton('chevronLeft', 'Previous month', { onClick: () => state.set({ monthId: addMonths(monthId, -1) }) }),
          h('strong', null, monthLabel(monthId)),
          iconButton('chevronRight', 'Next month', { onClick: () => state.set({ monthId: addMonths(monthId, 1) }) })),
        FILTERED_ROUTES.has(active.id) && people.length > 2
          ? segmented(people, personId, (value) => state.set({ personId: value }))
          : null) : null,
      content),

    h('nav', { class: 'tabs', 'aria-label': 'Main' }, ROUTES.map((r) =>
      h('a', { href: `#/${r.id}`, class: r.id === active.id ? 'tab active' : 'tab', 'aria-current': r.id === active.id ? 'page' : null },
        icon(r.icon), r.label))),

    h('button', { type: 'button', class: 'fab', onClick: () => openEntrySheet(ctx) }, icon('plus', { size: 22 }), 'New entry')));
}
