// Fills the local-mode app with deliberately awkward data (long names, a former member, several
// months, loans, goals, an emergency fund) so layout problems show up. Used by the layout audit.
export async function seedRichData(page) {
  await page.getByLabel('Your name').fill('Shubham');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.topbar').waitFor();

  await page.evaluate(async () => {
    const { createIdbAdapter } = await import('/v2/src/data/adapters/idbAdapter.js');
    const { createLedger } = await import('/v2/src/services/ledger.js');
    const adapter = createIdbAdapter();
    const me = JSON.parse(localStorage.getItem('sf2_local_profile'));
    const household_id = 'local-household';
    const long = 'Wolfeschlegelsteinhausenbergerdorff';

    const partner = await adapter.insert('household_members', { household_id, user_id: crypto.randomUUID(), display_name: 'Priya Venkataramanan-Iyer', left_at: null });
    const former = await adapter.insert('household_members', { household_id, user_id: crypto.randomUUID(), display_name: 'Asha', left_at: new Date().toISOString() });
    const ledger = (userId) => createLedger({ adapter, session: { userId, householdId: household_id } });
    const [a, b, c] = [ledger(me.userId), ledger(partner.user_id), ledger(former.user_id)];

    const now = new Date();
    const iso = (monthsAgo, day) => {
      const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, day);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const today = iso(0, now.getDate());

    for (let back = 0; back < 6; back += 1) {
      await a.addTransaction({ kind: 'income', amount_paise: 12000000 + back * 150000, category: 'Salary', occurred_on: iso(back, 1), note: '' });
      await b.addTransaction({ kind: 'income', amount_paise: 8500000, category: 'Salary', occurred_on: iso(back, 2), note: 'Net pay after tax and every deduction imaginable' });
      await a.addTransaction({ kind: 'expense', amount_paise: 2800000 + back * 90000, category: 'Housing', bucket: 'needs', occurred_on: iso(back, 3), note: 'Rent' });
      await b.addTransaction({ kind: 'expense', amount_paise: 650000, category: 'Groceries', bucket: 'needs', occurred_on: iso(back, 8), note: 'Weekly vegetables, fruit, milk, eggs and bread from the market' });
      await a.addTransaction({ kind: 'expense', amount_paise: 420000, category: 'Dining Out', bucket: 'wants', occurred_on: iso(back, 12), note: '' });
      await b.addTransaction({ kind: 'expense', amount_paise: 1500000, category: 'Savings & Invest', bucket: 'savings', occurred_on: iso(back, 5), note: 'SIP' });
    }
    await c.addTransaction({ kind: 'expense', amount_paise: 210000, category: 'Travel', bucket: 'wants', occurred_on: today, note: 'Left before this was entered' });
    await a.addTransaction({ kind: 'expense', amount_paise: 99900, category: `${long} and more`.slice(0, 60), bucket: 'wants', occurred_on: today, note: `${long}${long}${long}`.slice(0, 200) });
    await b.addTransaction({ kind: 'expense', amount_paise: 12345678, category: 'Shopping', bucket: 'wants', occurred_on: today, note: 'A very large purchase to test wide numbers' });

    const rec = { start_on: iso(5, 1), end_on: null, kind: 'expense', bucket: 'needs' };
    await a.addRecurring({ ...rec, name: 'Home loan EMI', amount_paise: 4500000, frequency: 'monthly', category: 'Debt & Loans', start_on: iso(5, Math.min(28, now.getDate() + 2)) });
    await b.addRecurring({ ...rec, name: `${long} subscription`.slice(0, 80), amount_paise: 49900, frequency: 'monthly', category: 'Subscriptions', bucket: 'wants', start_on: iso(5, Math.min(28, now.getDate() + 9)) });
    await a.addRecurring({ ...rec, name: 'Car insurance', amount_paise: 3800000, frequency: 'yearly', due_month: ((now.getMonth() + 1) % 12) + 1, category: 'Insurance', start_on: iso(5, Math.min(28, now.getDate() + 4)) });

    const ef = await a.addGoal({ name: 'Emergency fund', target_paise: 90000000, deadline: null, is_emergency: true });
    await a.addContribution({ goal_id: ef.id, amount_paise: 25000000, contributed_on: today, note: '' });
    const trip = await b.addGoal({ name: `Anniversary trip to ${long} and back`.slice(0, 80), target_paise: 30000000, deadline: iso(-8, 28) });
    await b.addContribution({ goal_id: trip.id, amount_paise: 4000000, contributed_on: today, note: '' });
    await a.addGoal({ name: 'New laptop', target_paise: 12000000, deadline: iso(1, 1) });

    await a.addLoan({ name: `Home loan from the ${long} cooperative bank`.slice(0, 80), outstanding_paise: 450000000, rate_pct: 8.65, emi_paise: 4500000 });
    await b.addLoan({ name: 'Car loan', outstanding_paise: 90000000, rate_pct: 9.4, emi_paise: 1800000 });
  });
  await page.reload();
  await page.locator('.topbar').waitFor();
}

export const ROUTES = ['dashboard', 'entries', 'recurring', 'goals', 'settings'];
