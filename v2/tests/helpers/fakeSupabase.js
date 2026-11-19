import { randomUUID } from 'node:crypto';

const TABLES = ['households', 'household_members', 'transactions', 'recurring_items', 'goals', 'goal_contributions', 'budget_settings', 'loans'];

const rlsError = { message: 'new row violates row-level security policy' };

/**
 * An in-memory stand-in for Supabase that mimics the behaviour the app relies on:
 * email/password auth, row-level security scoped to the signed-in user's household,
 * the create/join household RPCs, and realtime change notifications.
 * Several clients can share one backend to simulate two phones.
 */
export function createFakeBackend({ confirmEmail = false } = {}) {
  const db = Object.fromEntries(TABLES.map((t) => [t, []]));
  const users = new Map();
  const channels = new Set();
  const calls = [];

  // Only an ACTIVE membership grants access (mirrors is_household_member in the SQL).
  const householdOf = (userId) => db.household_members.find((m) => m.user_id === userId && !m.left_at)?.household_id ?? null;

  // Mirrors Supabase Realtime: inserts/updates honour the household filter and carry the row;
  // deletes cannot be filtered and (under row-level security) carry only the primary key.
  function notify(table, row, eventType = 'UPDATE') {
    for (const channel of channels) {
      for (const handler of channel.handlers) {
        if (handler.table !== table) continue;
        if (handler.event !== '*' && handler.event !== eventType) continue;
        if (eventType === 'DELETE') {
          if (!handler.filter) handler.callback({ eventType, new: {}, old: { id: row.id } });
        } else if (handler.filter === `household_id=eq.${row.household_id}`) {
          handler.callback({ eventType, new: { ...row }, old: {} });
        }
      }
    }
  }

  function createClient(url = 'https://fake.supabase.co', key = 'anon') {
    let session = null;
    const authListeners = new Set();
    const emitAuth = (event) => authListeners.forEach((cb) => cb(event, session));
    const me = () => session?.user ?? null;

    function builder(table) {
      const q = { op: 'select', columns: '*', filters: [], single: false, payload: null };
      const api = {
        select(columns = '*') { q.columns = columns; return api; },
        insert(row) { q.op = 'insert'; q.payload = row; return api; },
        update(patch) { q.op = 'update'; q.payload = patch; return api; },
        delete() { q.op = 'delete'; return api; },
        eq(column, value) { q.filters.push([column, value, 'eq']); return api; },
        is(column, value) { q.filters.push([column, value, 'is']); return api; },
        single() { q.single = 'one'; return api; },
        maybeSingle() { q.single = 'maybe'; return api; },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
      };

      function visibleRows() {
        const user = me();
        if (!user) return [];
        const hid = householdOf(user.id);
        return db[table].filter((row) => {
          if (table === 'households') return row.id === hid;
          return row.household_id === hid;
        });
      }

      const matching = () => visibleRows().filter((row) => q.filters.every(([k, v, op]) => (op === 'is' ? (row[k] ?? null) === v : row[k] === v)));

      function shape(rows) {
        if (q.single === 'one') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
        if (q.single === 'maybe') return { data: rows[0] ?? null, error: null };
        return { data: rows, error: null };
      }

      function withEmbeds(rows) {
        if (table === 'household_members' && q.columns.includes('households(')) {
          return rows.map((row) => ({ ...row, households: db.households.find((h) => h.id === row.household_id) }));
        }
        return rows;
      }

      function execute() {
        calls.push({ table, op: q.op, filters: q.filters });
        const user = me();
        if (!user) return { data: null, error: { message: 'JWT required' } };
        if (q.op === 'select') return shape(withEmbeds(matching()).map((r) => ({ ...r })));

        if (q.op === 'insert') {
          if (table === 'households' || table === 'household_members') return { data: null, error: rlsError };
          const row = { id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...q.payload };
          if (row.household_id !== householdOf(user.id)) return { data: null, error: rlsError };
          if ('created_by' in row && row.created_by !== user.id) return { data: null, error: rlsError };
          // Mirrors the partial unique index: one emergency-fund goal per household.
          if (table === 'goals' && row.is_emergency && db.goals.some((g) => g.household_id === row.household_id && g.is_emergency)) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint "goals_one_emergency_per_household"' } };
          }
          db[table].push(row);
          notify(table, row, 'INSERT');
          return shape([{ ...row }]);
        }

        const rows = matching();
        if (q.op === 'update') {
          if ('household_id' in q.payload || 'created_by' in q.payload) return { data: null, error: { message: 'household_id and created_by cannot be changed' } };
          rows.forEach((row) => { Object.assign(row, q.payload, { updated_at: new Date().toISOString() }); notify(table, row); });
          return shape(rows.map((r) => ({ ...r })));
        }
        rows.forEach((row) => {
          db[table].splice(db[table].indexOf(row), 1);
          notify(table, row, 'DELETE');
        });
        return { data: null, error: null };
      }
      return api;
    }

    const rpcs = {
      create_household({ household_name, member_name }) {
        const user = me();
        const clean = String(member_name ?? '').trim();
        if (!clean) return { data: null, error: { message: 'enter your name' } };
        if (householdOf(user.id)) return { data: null, error: { message: 'already in a household' } };
        const household = { id: randomUUID(), name: household_name, invite_code: randomUUID().replaceAll('-', '').slice(0, 12), created_at: new Date().toISOString() };
        db.households.push(household);
        db.household_members.push({ id: randomUUID(), household_id: household.id, user_id: user.id, display_name: clean, left_at: null, created_at: new Date().toISOString() });
        db.budget_settings.push({ id: randomUUID(), household_id: household.id, needs_pct: 50, wants_pct: 30, savings_pct: 20 });
        return { data: household, error: null };
      },
      join_household({ code, member_name }) {
        const user = me();
        const clean = String(member_name ?? '').trim();
        if (!clean) return { data: null, error: { message: 'enter your name' } };
        if (householdOf(user.id)) return { data: null, error: { message: 'already in a household' } };
        const household = db.households.find((h) => h.invite_code === String(code).toLowerCase().trim());
        if (!household) return { data: null, error: { message: 'invalid invite code' } };
        const active = db.household_members.filter((m) => m.household_id === household.id && !m.left_at);
        if (active.length >= 6) return { data: null, error: { message: 'household is full' } };
        // Mirrors 006: no two active members may share a name, ignoring capitals.
        if (active.some((m) => m.display_name.toLowerCase() === clean.toLowerCase())) {
          return { data: null, error: { message: 'that name is already used in this household' } };
        }
        const member = { id: randomUUID(), household_id: household.id, user_id: user.id, display_name: clean, left_at: null, created_at: new Date().toISOString() };
        db.household_members.push(member);
        notify('household_members', member, 'INSERT');
        return { data: household, error: null };
      },
      remove_member({ target_user }) {
        const user = me();
        const hid = householdOf(user.id);
        if (!hid) return { data: null, error: { message: 'not in a household' } };
        if (target_user === user.id) return { data: null, error: { message: 'use leave_household to remove yourself' } };
        const target = db.household_members.find((m) => m.household_id === hid && m.user_id === target_user && !m.left_at);
        if (!target) return { data: null, error: { message: 'that person is not in your household' } };
        target.left_at = new Date().toISOString();
        const household = db.households.find((h) => h.id === hid);
        household.invite_code = randomUUID().replaceAll('-', '').slice(0, 12);
        notify('household_members', target);
        return { data: null, error: null };
      },
      leave_household() {
        const user = me();
        const hid = householdOf(user.id);
        if (!hid) return { data: null, error: { message: 'not in a household' } };
        if (db.household_members.filter((m) => m.household_id === hid && !m.left_at).length <= 1) return { data: null, error: { message: 'you are the only member' } };
        const mine = db.household_members.find((m) => m.household_id === hid && m.user_id === user.id && !m.left_at);
        mine.left_at = new Date().toISOString();
        notify('household_members', mine);
        return { data: null, error: null };
      },
      rotate_invite_code() {
        const user = me();
        const hid = householdOf(user.id);
        if (!hid) return { data: null, error: { message: 'not in a household' } };
        const household = db.households.find((h) => h.id === hid);
        household.invite_code = randomUUID().replaceAll('-', '').slice(0, 12);
        return { data: household.invite_code, error: null };
      },
    };

    return {
      url,
      key,
      from: builder,
      async rpc(name, args) {
        if (!me()) return { data: null, error: { message: 'not signed in' } };
        return rpcs[name](args);
      },
      channel(name) {
        const channel = { name, handlers: [] };
        channel.on = (_type, opts, callback) => { channel.handlers.push({ table: opts.table, filter: opts.filter, event: opts.event, callback }); return channel; };
        channel.subscribe = (onStatus) => { channels.add(channel); channel.onStatus = onStatus; onStatus?.('SUBSCRIBED'); return channel; };
        return channel;
      },
      removeChannel(channel) { channels.delete(channel); },
      auth: {
        async getSession() { return { data: { session } }; },
        async signInWithPassword({ email, password }) {
          const user = users.get(email);
          if (!user || user.password !== password) return { data: { session: null }, error: { message: 'Invalid login credentials' } };
          session = { user: { id: user.id, email } };
          emitAuth('SIGNED_IN');
          return { data: { session }, error: null };
        },
        async signUp({ email, password }) {
          if (users.has(email)) return { data: null, error: { message: 'User already registered' } };
          const user = { id: randomUUID(), password };
          users.set(email, user);
          if (confirmEmail) return { data: { session: null }, error: null };
          session = { user: { id: user.id, email } };
          emitAuth('SIGNED_IN');
          return { data: { session }, error: null };
        },
        async signOut() { session = null; emitAuth('SIGNED_OUT'); return { error: null }; },
        onAuthStateChange(cb) {
          authListeners.add(cb);
          return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
        },
      },
      // Test-only hook to simulate a token refresh event.
      __emitAuth: emitAuth,
    };
  }

  // Test-only: every realtime channel reconnects (as after a phone wakes from sleep).
  const reconnect = () => channels.forEach((channel) => channel.onStatus?.('SUBSCRIBED'));

  return { db, users, calls, channels, createClient, reconnect };
}
