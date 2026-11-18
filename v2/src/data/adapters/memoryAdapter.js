import { createListeners, matches, stamp } from './base.js';

export function createMemoryAdapter() {
  const tables = new Map();
  const listeners = createListeners();
  const rows = (table) => {
    if (!tables.has(table)) tables.set(table, new Map());
    return tables.get(table);
  };

  return {
    async list(table, { householdId, where } = {}) {
      return [...rows(table).values()]
        .filter((row) => matches(row, householdId, where))
        .map((row) => ({ ...row }));
    },
    async insert(table, row) {
      const saved = stamp(row);
      rows(table).set(saved.id, saved);
      listeners.emit(table, saved);
      return { ...saved };
    },
    async update(table, id, patch) {
      const existing = rows(table).get(id);
      if (!existing) throw new Error(`${table} row not found`);
      const saved = { ...existing, ...patch, id, updated_at: new Date().toISOString() };
      rows(table).set(id, saved);
      listeners.emit(table, saved);
      return { ...saved };
    },
    async remove(table, id) {
      const existing = rows(table).get(id);
      rows(table).delete(id);
      if (existing) listeners.emit(table, existing);
    },
    subscribe: (table, householdId, cb) => listeners.add(table, householdId, cb),
  };
}
