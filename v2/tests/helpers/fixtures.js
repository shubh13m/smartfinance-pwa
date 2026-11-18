import { createMemoryAdapter } from '../../src/data/adapters/memoryAdapter.js';
import { createLedger } from '../../src/services/ledger.js';
import { createStore } from '../../src/core/store.js';
import { toast } from '../../src/ui/components.js';

export const HOUSEHOLD_ID = 'h1';

let counter = 0;
const nextId = () => `row-${++counter}`;

export function tx(overrides = {}) {
  return {
    id: nextId(), kind: 'expense', amount_paise: 10000, category: 'Groceries', bucket: 'needs',
    occurred_on: '2026-03-05', note: '', created_by: 'me', created_at: '2026-03-05T10:00:00.000Z', ...overrides,
  };
}

export function recurringItem(overrides = {}) {
  return {
    id: nextId(), kind: 'expense', name: 'Rent', amount_paise: 1000000, frequency: 'monthly', due_month: null,
    start_on: '2026-01-01', end_on: null, category: 'Housing', bucket: 'needs', created_by: 'me', ...overrides,
  };
}

/**
 * A fully wired view context (real ledger on the in-memory adapter, real state store)
 * for rendering a single feature view without booting the whole app.
 */
export async function makeViewCtx({
  names = ['Shubham', 'Priya'], active = 0, monthId = '2026-03', personId = 'all', basis = 'smoothed', route = 'dashboard',
} = {}) {
  const adapter = createMemoryAdapter();
  const members = [];
  for (const name of names) {
    members.push(await adapter.insert('household_members', {
      household_id: HOUSEHOLD_ID, user_id: `u-${name.toLowerCase()}`, display_name: name,
    }));
  }
  const sessionFor = (member) => ({
    userId: member.user_id, displayName: member.display_name, householdId: HOUSEHOLD_ID, householdName: 'Test home', inviteCode: null, email: null,
  });
  const ledgers = Object.fromEntries(members.map((m) => [m.display_name, createLedger({ adapter, session: sessionFor(m) })]));
  const session = sessionFor(members[active]);
  const ledger = ledgers[members[active].display_name];
  const state = createStore({ route, monthId, personId, basis });
  const signOut = { calls: 0 };
  const authCalls = [];

  // Mirrors what the real auth does to household members, recording every call.
  const markLeft = async (userId) => {
    const [row] = await adapter.list('household_members', { householdId: HOUSEHOLD_ID, where: { user_id: userId } });
    await adapter.update('household_members', row.id, { left_at: new Date().toISOString() });
  };

  const ctx = {
    adapter, ledger, ledgers, session, state, members,
    auth: {
      signOut: async () => { signOut.calls += 1; },
      removeMember: async (userId) => { authCalls.push(['removeMember', userId]); await markLeft(userId); },
      leaveHousehold: async () => { authCalls.push(['leaveHousehold']); await markLeft(session.userId); },
      rotateInviteCode: async () => { authCalls.push(['rotateInviteCode']); session.inviteCode = 'rotated-code'; return 'rotated-code'; },
    },
    authCalls,
    signOut,
    data: await ledger.loadAll(),
    async reload() { ctx.data = await ledger.loadAll(); },
    rerender() {},
    async refreshSession() { authCalls.push(['refreshSession']); },
    async mutate(action, message) {
      try {
        await action();
        if (message) toast(message, 'success');
        await ctx.reload();
        return true;
      } catch (error) {
        toast(error.message, 'error');
        return false;
      }
    },
    // Renders a feature into a fresh container using the current data.
    view(render) {
      const container = document.createElement('div');
      render(container, ctx);
      document.body.append(container);
      return container;
    },
  };
  return ctx;
}
