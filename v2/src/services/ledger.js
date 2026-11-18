import { DEFAULT_SPLIT } from '../config/constants.js';
import { dedupeMembers } from '../domain/members.js';
import {
  validateContribution, validateGoal, validateLoan, validateRecurring, validateSplit, validateTransaction,
} from '../domain/validation.js';

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.join(' '));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

function checked(result) {
  if (!result.ok) throw new ValidationError(result.errors);
  return result.value;
}

/**
 * The only thing UI code talks to. It scopes every read/write to the household,
 * stamps who created a row, and validates input before it reaches storage.
 * Everything is shared inside the household; created_by only records who entered it.
 */
export function createLedger({ adapter, session }) {
  const { householdId, userId } = session;
  const own = (table) => ({
    list: (where) => adapter.list(table, { householdId, where }),
    add: (row) => adapter.insert(table, { ...row, household_id: householdId, created_by: userId }),
    update: (id, patch) => adapter.update(table, id, patch),
    remove: (id) => adapter.remove(table, id),
  });

  const transactions = own('transactions');
  const recurring = own('recurring_items');
  const goals = own('goals');
  const contributions = own('goal_contributions');
  const loans = own('loans');
  const settings = () => adapter.list('budget_settings', { householdId });

  const getSplit = async () => {
    const [row] = await settings();
    return row ? { needs: row.needs_pct, wants: row.wants_pct, savings: row.savings_pct } : { ...DEFAULT_SPLIT };
  };

  return {
    householdId,
    userId,

    async loadAll() {
      const [members, txs, rec, gl, ctr, ln, split] = await Promise.all([
        adapter.list('household_members', { householdId }),
        transactions.list(),
        recurring.list(),
        goals.list(),
        contributions.list(),
        loans.list(),
        getSplit(),
      ]);
      // One entry per person even if they left and rejoined (several membership rows, same account).
      return { members: dedupeMembers(members), transactions: txs, recurring: rec, goals: gl, contributions: ctr, loans: ln, split };
    },

    addTransaction: async (input) => transactions.add(checked(validateTransaction(input))),
    updateTransaction: async (id, input) => transactions.update(id, checked(validateTransaction(input))),
    deleteTransaction: (id) => transactions.remove(id),

    addRecurring: async (input) => recurring.add(checked(validateRecurring(input))),
    updateRecurring: async (id, input) => recurring.update(id, checked(validateRecurring(input))),
    // Ends an item without losing the history of earlier months.
    endRecurring: (id, endOn) => recurring.update(id, { end_on: endOn }),
    deleteRecurring: (id) => recurring.remove(id),

    addGoal: async (input) => {
      const goal = checked(validateGoal(input));
      if (goal.is_emergency && (await goals.list()).some((g) => g.is_emergency)) {
        throw new ValidationError(['You already have an emergency fund goal.']);
      }
      return goals.add(goal);
    },

    addLoan: async (input) => loans.add(checked(validateLoan(input))),
    updateLoan: async (id, input) => loans.update(id, checked(validateLoan(input))),
    deleteLoan: (id) => loans.remove(id),
    deleteGoal: async (id) => {
      const related = await contributions.list({ goal_id: id });
      await Promise.all(related.map((c) => contributions.remove(c.id)));
      await goals.remove(id);
    },
    addContribution: async (input) => contributions.add(checked(validateContribution(input))),
    deleteContribution: (id) => contributions.remove(id),

    getSplit,
    async saveSplit(input) {
      const split = checked(validateSplit(input));
      const patch = { needs_pct: split.needs, wants_pct: split.wants, savings_pct: split.savings };
      const [row] = await settings();
      if (row) await adapter.update('budget_settings', row.id, patch);
      else await adapter.insert('budget_settings', { ...patch, household_id: householdId });
      return split;
    },

    // Bulk insert used by the v1 importer; rows are validated one by one.
    async importRows({ transactions: txs = [], recurring: rec = [] }) {
      let imported = 0;
      for (const row of txs) {
        const { created_by, ...input } = row;
        await adapter.insert('transactions', { ...checked(validateTransaction(input)), household_id: householdId, created_by: created_by || userId });
        imported += 1;
      }
      for (const row of rec) {
        const { created_by, ...input } = row;
        await adapter.insert('recurring_items', { ...checked(validateRecurring(input)), household_id: householdId, created_by: created_by || userId });
        imported += 1;
      }
      return imported;
    },

    // Re-render when either person changes anything in the household.
    subscribe(callback) {
      const tables = ['transactions', 'recurring_items', 'goals', 'goal_contributions', 'loans', 'budget_settings', 'household_members'];
      const unsubscribers = tables.map((table) => adapter.subscribe(table, householdId, callback));
      return () => unsubscribers.forEach((off) => off());
    },
  };
}
