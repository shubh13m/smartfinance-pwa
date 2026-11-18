import { h } from '../../core/dom.js';
import { todayISO } from '../../core/dates.js';
import { formatINR, toPaise } from '../../core/money.js';
import { goalProgress } from '../../domain/goals.js';
import { button, card, emptyState, field, iconButton, input, moneyInput, progressBar, singleFlight, toast } from '../../ui/components.js';

export function renderGoals(container, ctx) {
  container.append(h('div', { class: 'grid-2 three' },
    h('div', { class: 'stack' }, ...buildGoalCards(ctx)),
    buildGoalForm(ctx)));
}

function buildGoalForm(ctx) {
  const name = input({ type: 'text', maxlength: 80, required: true, placeholder: 'Emergency fund, Goa trip…' });
  const target = moneyInput({ required: true });
  const deadline = input({ type: 'date' });
  const alreadyHasEmergency = ctx.data.goals.some((g) => g.is_emergency);
  const emergency = input({ type: 'checkbox', id: 'is-emergency' });

  const submit = singleFlight(async () => {
    let target_paise;
    try { target_paise = toPaise(target.querySelector('input').value); } catch { return toast('Enter a valid target.', 'error'); }
    await ctx.mutate(() => ctx.ledger.addGoal({
      name: name.value, target_paise, deadline: deadline.value || null, is_emergency: emergency.checked,
    }), 'Goal added');
  });

  return card({ title: 'New shared goal', subtitle: 'Saved for together' },
    h('form', { class: 'form', onSubmit: submit },
      field('Goal', name), field('Target (₹)', target), field('Deadline (optional)', deadline),
      alreadyHasEmergency
        ? null
        : h('label', { class: 'check' }, emergency, h('span', null, 'This is our emergency fund'),
          h('small', { class: 'hint' }, 'We’ll show how many months of essentials it covers.')),
      h('div', { class: 'actions' }, button('Add goal', { type: 'submit', class: 'primary', icon: 'plus' }))));
}

function goalNote(goal, progress) {
  if (progress.done) return 'Goal reached 🎉';
  if (progress.overdue) return 'The deadline has passed.';
  if (progress.requiredMonthlyPaise !== null) {
    return `Save ${formatINR(progress.requiredMonthlyPaise)}/month for ${progress.monthsLeft} month(s) to finish by ${goal.deadline}.`;
  }
  return 'Set a deadline to see the monthly amount needed.';
}

function buildGoalCards(ctx) {
  const { data } = ctx;
  if (data.goals.length === 0) {
    return [card('Goals', emptyState('No goals yet', 'Add your first shared goal — a trip, an emergency fund, a down payment.', 'target'))];
  }

  return data.goals.map((goal) => {
    const progress = goalProgress(goal, data.contributions);
    const amount = moneyInput({ 'aria-label': `Add to ${goal.name}`, placeholder: 'Add amount' });
    const contribute = singleFlight(async () => {
      let amount_paise;
      try { amount_paise = toPaise(amount.querySelector('input').value); } catch { return toast('Enter a valid amount.', 'error'); }
      await ctx.mutate(() => ctx.ledger.addContribution({
        goal_id: goal.id, amount_paise, contributed_on: todayISO(), note: '',
      }), 'Contribution added');
    });

    return card({
      title: goal.is_emergency ? h('span', null, goal.name, ' ', h('span', { class: 'chip brand' }, 'Emergency fund')) : goal.name,
      subtitle: goal.deadline ? `By ${goal.deadline}` : 'No deadline',
      action: iconButton('trash', `Delete goal ${goal.name}`, {
        onClick: () => confirm(`Delete "${goal.name}" and its contributions?`)
          && ctx.mutate(() => ctx.ledger.deleteGoal(goal.id), 'Goal deleted'),
      }),
    },
    h('div', { class: 'meter' },
      h('div', { class: 'meter-head' },
        h('strong', { class: 'num' }, formatINR(progress.savedPaise)),
        h('span', { class: 'muted num' }, `of ${formatINR(goal.target_paise)} · ${progress.pct}%`)),
      progressBar(progress.pct, progress.done ? 'ahead' : progress.overdue ? 'over' : 'ok')),
    h('p', { class: 'hint' }, goalNote(goal, progress)),
    h('form', { class: 'inline-form', onSubmit: contribute }, amount, button('Add', { type: 'submit', class: 'primary', icon: 'plus' })));
  });
}
