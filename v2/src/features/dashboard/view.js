import { h, mount } from '../../core/dom.js';
import { addMonths, monthLabel, todayISO } from '../../core/dates.js';
import { formatINR, formatINRShort } from '../../core/money.js';
import { BUCKETS, BUCKET_LABELS } from '../../config/constants.js';
import { computeBudget } from '../../domain/budget503020.js';
import { planMonth } from '../../domain/cashflow.js';
import { emergencyStatus, essentialMonthly, TARGET_MONTHS } from '../../domain/emergency.js';
import { goalProgress } from '../../domain/goals.js';
import { membersWithData } from '../../domain/members.js';
import { monthlyTrend, summarizeByPerson, summarizeMonth, topCategories } from '../../domain/summary.js';
import { upcomingBills } from '../../domain/upcoming.js';
import { avatar, card, emptyState, progressBar, ring, segmented } from '../../ui/components.js';
import { icon } from '../../ui/icons.js';

export const STATUS_TEXT = {
  ok: 'On track', warn: 'Near limit', over: 'Over budget', ahead: 'On target', behind: 'Below target',
};
export const PLAN_STATUS = {
  ok: ['ok', 'On track'], tight: ['warn', 'Watch your spending'], over: ['over', 'Over what is safe'],
  no_income: ['warn', 'Add this month’s income'], empty: ['', ''],
};
const TREND_MONTHS = 6;

const shortMonth = (monthId) => {
  const [y, m] = monthId.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short' });
};
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function renderDashboard(container, ctx) {
  const { data, state } = ctx;
  const { monthId, personId, basis } = state.get();
  const { transactions, recurring, members, split, goals, contributions } = data;
  const today = todayISO();

  const summary = summarizeMonth({ monthId, transactions, recurring, personId, basis });
  const plan = planMonth({ monthId, today, transactions, recurring, split, personId, basis });
  const budget = computeBudget({ incomePaise: summary.incomePaise, spentByBucket: summary.byBucket, split });
  const hasAnything = summary.incomePaise > 0 || summary.expensePaise > 0;

  mount(container,
    hero(plan, monthId, split),
    h('div', { class: 'row' },
      segmented(
        [{ value: 'smoothed', label: 'Monthly average' }, { value: 'cash', label: 'Cash flow' }],
        basis, (value) => state.set({ basis: value })),
      h('span', { class: 'hint' }, basis === 'cash' ? 'Yearly bills appear when paid' : 'Yearly bills spread over 12 months')),
    hasAnything ? null : card(null, emptyState('Nothing here yet', 'Use the + button to add your first income or expense.', 'wallet')),
    hasAnything ? breakdownCard(plan, split) : null,
    planCard(budget, split, summary.incomePaise),
    emergencyCard({ monthId, data, today }),
    h('div', { class: 'grid-2' },
      peopleCard(members, { monthId, transactions, recurring, basis }),
      categoriesCard(summary)),
    trendCard({ monthId, transactions, recurring, personId, basis }),
    upcomingCard({ recurring, monthId, personId, today }),
  );
}

/* ---------- hero ---------- */

function phaseText(plan) {
  if (plan.phase === 'current') return `Day ${plan.day} of ${plan.totalDays} · ${plural(plan.daysLeft, 'day')} left`;
  return plan.phase === 'past' ? 'Month closed' : 'Upcoming month';
}

function pace(plan) {
  if (plan.phase !== 'current' || plan.status === 'empty' || plan.status === 'no_income') return null;
  const lines = [];
  if (plan.safePaise > 0) {
    lines.push(h('p', { class: 'hero-pace', 'data-testid': 'daily-allowance' },
      icon('calendar', { size: 16 }), `You can spend about ${formatINR(plan.dailyAllowancePaise)} a day for ${plural(plan.daysLeft, 'more day')}.`));
  } else {
    lines.push(h('p', { class: 'hero-pace', 'data-testid': 'daily-allowance' },
      icon('calendar', { size: 16 }), 'Nothing is left to spend safely this month.'));
  }
  if (plan.forecastSafePaise !== null) {
    lines.push(h('p', { class: 'hero-forecast', 'data-testid': 'forecast' },
      plan.forecastSafePaise >= 0
        ? `At this pace you’ll finish with ${formatINR(plan.forecastSafePaise)} still safe to spend.`
        : `At this pace you’ll overspend by ${formatINR(-plan.forecastSafePaise)}.`));
  }
  return lines;
}

function hero(plan, monthId, split) {
  const [tone, statusLabel] = PLAN_STATUS[plan.status];
  const stat = (iconName, label, value) => h('div', { class: 'hero-stat' },
    h('span', null, icon(iconName, { size: 14 }), label), h('strong', { class: 'num' }, value));

  return h('section', { class: 'hero', 'aria-label': 'Month summary' },
    h('div', { class: 'hero-top' },
      h('p', { class: 'hero-label' }, `${monthLabel(monthId)} · ${phaseText(plan)}`),
      statusLabel ? h('span', { class: `chip ${tone}`, 'data-testid': 'plan-status' }, statusLabel) : null),
    h('div', { class: 'hero-pair' },
      h('div', { class: 'hero-main' },
        h('p', { class: 'hero-label' }, 'Left this month'),
        h('p', { class: 'hero-value num' }, formatINR(plan.leftPaise)),
        h('small', null, 'income − everything spent')),
      h('div', { class: 'hero-main' },
        h('p', { class: 'hero-label' }, 'Safe to spend'),
        h('p', { class: 'hero-safe num', 'data-testid': 'safe-to-spend' }, formatINR(plan.safePaise)),
        h('small', null, plan.stillToInvestPaise > 0
          ? `after holding back ${formatINRShort(plan.stillToInvestPaise)} to invest`
          : 'your investing target is covered'))),
    pace(plan),
    h('div', { class: 'hero-stats' },
      stat('trendUp', 'Income', formatINRShort(plan.incomePaise)),
      stat('trendDown', 'Spent', formatINRShort(plan.spentPaise)),
      stat('piggy', `Invested (${split.savings}% plan)`, formatINRShort(plan.investedPaise))));
}

/* ---------- how it is worked out ---------- */

function breakdownCard(plan, split) {
  const line = (key, label, value, { sign = '', strong = false, hint } = {}) => h('div', { class: `calc-row ${strong ? 'total' : ''}`, 'data-line': key },
    h('span', null, sign ? h('i', { class: 'calc-sign' }, sign) : null, label, hint ? h('small', { class: 'hint' }, hint) : null),
    h('strong', { class: 'num' }, formatINR(value)));

  return card({ title: 'How safe to spend is worked out', subtitle: 'Bills count as committed from day one, so nothing surprises you later.' },
    h('div', { class: 'calc' },
      line('income', 'Income this month', plan.incomePaise),
      line('bills', 'Bills & recurring', plan.billsPaise, { sign: '−' }),
      line('spent', 'Spent so far', plan.variablePaise, { sign: '−' }),
      line('invested', 'Invested so far', plan.investedPaise, { sign: '−' }),
      line('left', 'Left this month', plan.leftPaise, { sign: '=', strong: true }),
      line('reserve', 'Still to invest', plan.stillToInvestPaise, { sign: '−', hint: `to reach your ${split.savings}% savings plan (${formatINR(plan.targetPaise)})` }),
      line('safe', 'Safe to spend', plan.safePaise, { sign: '=', strong: true })));
}

/* ---------- 50/30/20 ---------- */

function planCard(budget, split, incomePaise) {
  return card(
    { title: '50/30/20 plan', subtitle: `Your split: ${split.needs} / ${split.wants} / ${split.savings}` },
    incomePaise === 0
      ? emptyState('Add income to see targets', 'Targets are calculated from your household income.', 'target')
      : h('div', { class: 'rings' }, BUCKETS.map((bucket) => {
        const b = budget.buckets[bucket];
        const tone = ['over', 'behind', 'warn'].includes(b.status) ? b.status : bucket;
        return h('div', { class: 'ring-card', 'data-bucket': bucket },
          ring(b.usedPct, tone),
          h('div', { class: 'ring-body' },
            h('strong', null, BUCKET_LABELS[bucket]),
            h('span', { class: `chip ${b.status}` }, STATUS_TEXT[b.status]),
            h('small', { class: 'hint num' }, `${formatINR(b.actualPaise)} of ${formatINR(b.targetPaise)}`)));
      })));
}

/* ---------- emergency fund ---------- */

function emergencyCard({ monthId, data, today }) {
  const goal = (data.goals || []).find((g) => g.is_emergency);
  if (!goal) {
    return card({ title: 'Emergency fund', subtitle: 'A cushion of 6 months of essentials' },
      emptyState('Not set up yet', 'Create a goal and tick “This is our emergency fund” to track how many months it covers.', 'piggy'),
      h('div', { class: 'actions' }, h('a', { class: 'btn sm', href: '#/goals' }, 'Set it up')));
  }
  const fundPaise = goalProgress(goal, data.contributions, today).savedPaise;
  const essentialPaise = essentialMonthly({ monthId, transactions: data.transactions, recurring: data.recurring });
  const status = emergencyStatus({ fundPaise, essentialPaise });
  const tone = { low: 'over', building: 'warn', ready: 'ahead', unknown: '' }[status.level];
  const label = { low: 'Build this up', building: 'Getting there', ready: 'Fully covered', unknown: 'Needs spending data' }[status.level];

  return card({ title: 'Emergency fund', subtitle: goal.name.trim().toLowerCase() === 'emergency fund' ? 'A cushion of 6 months of essentials' : goal.name },
    status.level === 'unknown'
      ? emptyState('Not enough spending yet', 'Add a few weeks of needs (rent, groceries, bills) so we can estimate your monthly essentials.', 'inbox')
      : h('div', { class: 'meter', 'data-testid': 'emergency' },
        h('div', { class: 'meter-head' },
          h('strong', { class: 'num' }, `${status.monthsCovered.toFixed(1)} of ${TARGET_MONTHS} months covered`),
          h('span', { class: `chip ${tone}` }, label)),
        progressBar(status.pct, tone || 'ok'),
        h('small', { class: 'hint' }, `${formatINR(fundPaise)} saved · essentials ≈ ${formatINR(essentialPaise)} a month · ${TARGET_MONTHS}-month target ${formatINR(status.targetPaise)}`)));
}

/* ---------- people, categories, trend ---------- */

function peopleCard(members, rest) {
  const list = membersWithData(members, rest);
  if (list.length < 2) return null;
  const rows = summarizeByPerson({ members: list, ...rest });
  return card('Who contributed',
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Person', 'Income', 'Spent'].map((t) => h('th', null, t)))),
        h('tbody', null, rows.map(({ member, summary }) => h('tr', null,
          h('td', null, h('span', { class: 'person' }, avatar(member, members),
            h('span', { class: 'person-name' }, member.left_at ? `${member.display_name} (former)` : member.display_name))),
          h('td', { class: 'num' }, formatINR(summary.incomePaise)),
          h('td', { class: 'num' }, formatINR(summary.expensePaise))))))));
}

function categoriesCard(summary) {
  const top = topCategories(summary.byCategory);
  return card('Where the money goes',
    top.length === 0
      ? emptyState('No spending yet', null, 'inbox')
      : h('div', { class: 'stack' }, top.map(({ category, paise }) => h('div', { class: 'meter' },
        h('div', { class: 'meter-head' }, h('span', null, category), h('strong', { class: 'num' }, formatINR(paise))),
        progressBar(Math.round((paise / summary.expensePaise) * 100))))));
}

function trendCard({ monthId, ...rest }) {
  const monthIds = Array.from({ length: TREND_MONTHS }, (_, i) => addMonths(monthId, i - (TREND_MONTHS - 1)));
  const points = monthlyTrend({ monthIds, ...rest });
  const max = Math.max(1, ...points.flatMap((p) => [p.incomePaise, p.expensePaise]));
  const bar = (paise, cls) => {
    const el = h('div', { class: `trend-bar ${cls}`, title: formatINR(paise) });
    el.style.height = `${Math.round((paise / max) * 100)}%`;
    return el;
  };
  return card(
    {
      title: 'Last 6 months',
      action: h('div', { class: 'legend' }, h('span', null, h('i'), 'Income'), h('span', null, h('i', { class: 'expense' }), 'Spent')),
    },
    h('div', { class: 'trend', role: 'img', 'aria-label': 'Income and spending for the last six months' },
      points.map((p) => h('div', { class: `trend-col ${p.monthId === monthId ? 'current' : ''}` },
        h('div', { class: 'trend-bars' }, bar(p.incomePaise, 'income'), bar(p.expensePaise, 'expense')),
        h('span', { class: 'trend-label' }, shortMonth(p.monthId))))));
}

/* ---------- upcoming bills ---------- */

function upcomingCard({ recurring, monthId, personId, today }) {
  const current = monthId === today.slice(0, 7);
  const from = current ? today : `${monthId}-01`;
  const { bills, totalPaise } = upcomingBills({ recurring, from, personId });
  return card(
    {
      title: 'Upcoming bills',
      subtitle: bills.length ? `Next 30 days from ${dayLabel(from)} · ${formatINR(totalPaise)} in ${plural(bills.length, 'payment')}` : 'Next 30 days',
    },
    bills.length === 0
      ? emptyState('Nothing due', 'Recurring bills, EMIs and SIPs show up here as their due date approaches.', 'calendar')
      : h('ul', { class: 'list' }, bills.map(({ item, date, amountPaise, daysAway }) => h('li', { class: 'list-item', 'data-bill': item.name },
        h('div', { class: 'grow' },
          h('div', { class: 'item-title' }, item.name),
          h('div', { class: 'item-sub' }, `${dayLabel(date)} · ${daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : `in ${daysAway} days`}${item.frequency === 'yearly' ? ' · yearly' : ''}`)),
        h('strong', { class: 'num' }, formatINR(amountPaise))))));
}
