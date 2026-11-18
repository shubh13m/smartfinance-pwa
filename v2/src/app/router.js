import { renderDashboard } from '../features/dashboard/view.js';
import { renderTransactions } from '../features/transactions/view.js';
import { renderRecurring } from '../features/recurring/view.js';
import { renderGoals } from '../features/goals/view.js';
import { renderSettings } from '../features/settings/view.js';
import { renderLoans } from '../features/loans/view.js';

// Goals and loans share one screen: saving towards things, and paying debts down.
function renderGoalsAndLoans(container, ctx) {
  renderGoals(container, ctx);
  renderLoans(container, ctx);
}

// Adding a screen = one feature folder + one line here.
export const ROUTES = [
  { id: 'dashboard', label: 'Overview', title: 'Overview', icon: 'home', render: renderDashboard },
  { id: 'entries', label: 'Entries', title: 'Income & expenses', icon: 'list', render: renderTransactions },
  { id: 'recurring', label: 'Recurring', title: 'Recurring', icon: 'repeat', render: renderRecurring },
  { id: 'goals', label: 'Goals', title: 'Goals & loans', icon: 'target', render: renderGoalsAndLoans },
  { id: 'settings', label: 'Settings', title: 'Settings', icon: 'settings', render: renderSettings },
];

export function routeFromHash(hash = location.hash) {
  const id = hash.replace(/^#\/?/, '');
  return ROUTES.some((r) => r.id === id) ? id : ROUTES[0].id;
}
