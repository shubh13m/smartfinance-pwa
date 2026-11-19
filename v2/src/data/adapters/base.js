import { newId } from '../../core/ids.js';

// Storage adapter contract (all adapters implement exactly this):
//   list(table, { householdId, where })  -> row[]
//   insert(table, row)                   -> row (with id and timestamps)
//   update(table, id, patch)             -> row
//   remove(table, id)                    -> void
//   subscribe(table, householdId, cb)    -> unsubscribe()
// Rows are plain objects whose fields match the database columns.
// Subscribers receive { type: 'upsert' | 'delete', row } so callers can patch what they
// already have instead of re-reading everything. Deletes may carry only { id }.
// An adapter may also send { type: 'resync' } after a lost connection, meaning "re-read".

export function stamp(row, now = new Date().toISOString()) {
  return { id: newId(), created_at: now, updated_at: now, ...row };
}

export function matches(row, householdId, where = {}) {
  if (householdId && row.household_id !== householdId) return false;
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

export function createListeners() {
  const listeners = new Map();
  return {
    add(table, householdId, cb) {
      const entry = { householdId, cb };
      if (!listeners.has(table)) listeners.set(table, new Set());
      listeners.get(table).add(entry);
      return () => listeners.get(table).delete(entry);
    },
    emit(table, row, type = 'upsert') {
      for (const { householdId, cb } of listeners.get(table) || []) {
        if (!householdId || row.household_id === householdId) cb({ type, row: { ...row } });
      }
    },
  };
}
