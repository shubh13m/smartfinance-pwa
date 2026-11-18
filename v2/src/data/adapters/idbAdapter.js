import { TABLES } from '../../config/constants.js';
import { createListeners, matches, stamp } from './base.js';

const DB_NAME = 'SmartFinanceDB_v2';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const table of TABLES) {
        if (!db.objectStoreNames.contains(table)) db.createObjectStore(table, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

// Local-only adapter: data stays in this browser. Used when no cloud is configured.
export function createIdbAdapter() {
  let dbPromise;
  const listeners = createListeners();
  const store = async (table, mode) => {
    dbPromise ||= openDb();
    const db = await dbPromise;
    return db.transaction(table, mode).objectStore(table);
  };

  return {
    async list(table, { householdId, where } = {}) {
      const all = await done((await store(table, 'readonly')).getAll());
      return all.filter((row) => matches(row, householdId, where));
    },
    async insert(table, row) {
      const saved = stamp(row);
      await done((await store(table, 'readwrite')).add(saved));
      listeners.emit(table, saved);
      return saved;
    },
    async update(table, id, patch) {
      const existing = await done((await store(table, 'readonly')).get(id));
      if (!existing) throw new Error(`${table} row not found`);
      const saved = { ...existing, ...patch, id, updated_at: new Date().toISOString() };
      await done((await store(table, 'readwrite')).put(saved));
      listeners.emit(table, saved);
      return saved;
    },
    async remove(table, id) {
      const existing = await done((await store(table, 'readonly')).get(id));
      await done((await store(table, 'readwrite')).delete(id));
      if (existing) listeners.emit(table, existing);
    },
    subscribe: (table, householdId, cb) => listeners.add(table, householdId, cb),
  };
}
