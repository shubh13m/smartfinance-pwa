// Keeps the household's data in memory and patches it as changes arrive (your own,
// optimistically, and the other person's from realtime) so a screen never has to wait for
// a full re-download. Data is replaced, never mutated, so views can safely hold a reference.

const COLLECTIONS = {
  transactions: 'transactions',
  recurring_items: 'recurring',
  goals: 'goals',
  goal_contributions: 'contributions',
  loans: 'loans',
};
const TOMBSTONE_MS = 60_000;

/** True for tables the cache can patch; anything else needs a re-read. */
export const isPatchable = (table) => table in COLLECTIONS || table === 'budget_settings';

const time = (row) => {
  const t = Date.parse(row?.updated_at);
  return Number.isNaN(t) ? 0 : t;
};

// Timestamps are not shown, so a row that differs only there needs no repaint.
const sameVisible = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .every((key) => key === 'created_at' || key === 'updated_at' || a[key] === b[key]);

export function createDataCache(initial = null, now = Date.now) {
  let data = initial;
  // A deleted id must not come back from a late echo of its own insert or update.
  const gone = new Map();
  const isGone = (id) => {
    const at = gone.get(id);
    if (at === undefined) return false;
    if (now() - at <= TOMBSTONE_MS) return true;
    gone.delete(id);
    return false;
  };

  function applySplit(type, row) {
    if (type === 'delete') return false;
    const split = { needs: row.needs_pct, wants: row.wants_pct, savings: row.savings_pct };
    if (Object.values(split).some((v) => v === undefined)) return false;
    if (split.needs === data.split.needs && split.wants === data.split.wants && split.savings === data.split.savings) return false;
    data = { ...data, split };
    return true;
  }

  function remove(key, table, id) {
    gone.set(id, now());
    let next = data;
    if (data[key].some((r) => r.id === id)) next = { ...next, [key]: data[key].filter((r) => r.id !== id) };
    // The database cascades goal deletes to their contributions; mirror that here.
    if (table === 'goals' && data.contributions.some((c) => c.goal_id === id)) {
      next = { ...next, contributions: data.contributions.filter((c) => c.goal_id !== id) };
    }
    if (next === data) return false;
    data = next;
    return true;
  }

  return {
    get: () => data,
    replace(next) { data = next; },

    /**
     * Applies { table, type: 'upsert' | 'confirm' | 'patch' | 'delete', row }.
     * Returns true when something visible changed (so the screen should repaint).
     */
    apply({ table, type, row }) {
      if (!data || !row) return false;
      if (table === 'budget_settings') return applySplit(type, row);
      const key = COLLECTIONS[table];
      if (!key) return false;
      if (type === 'delete') return remove(key, table, row.id);
      if (isGone(row.id)) return false;

      const rows = data[key];
      const at = rows.findIndex((r) => r.id === row.id);
      if (type === 'patch') {
        if (at < 0) return false;
        const merged = { ...rows[at], ...row };
        if (sameVisible(rows[at], merged)) return false;
        data = { ...data, [key]: rows.map((r, i) => (i === at ? merged : r)) };
        return true;
      }
      if (at < 0) {
        data = { ...data, [key]: [...rows, row] };
        return true;
      }
      // An older version of a row (a slow echo) must not undo a newer one. The server's own
      // answer to our write ('confirm') always wins, so a skewed phone clock cannot pin a row.
      if (type !== 'confirm' && time(row) < time(rows[at])) return false;
      const visible = !sameVisible(rows[at], row);
      data = { ...data, [key]: rows.map((r, i) => (i === at ? row : r)) };
      return visible;
    },
  };
}
