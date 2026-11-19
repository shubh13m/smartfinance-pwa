// Cloud adapter. `client` is a supabase-js client created in auth/supabaseAuth.js.
// Row-level security (db/001_init.sql) is the real access control; the household
// filter here only narrows the query.

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export function createSupabaseAdapter(client) {
  return {
    async list(table, { householdId, where = {} } = {}) {
      let query = client.from(table).select('*');
      if (householdId) query = query.eq('household_id', householdId);
      for (const [key, value] of Object.entries(where)) query = query.eq(key, value);
      return unwrap(await query);
    },
    async insert(table, row) {
      return unwrap(await client.from(table).insert(row).select().single());
    },
    async update(table, id, patch) {
      return unwrap(await client.from(table).update(patch).eq('id', id).select().single());
    },
    async remove(table, id) {
      unwrap(await client.from(table).delete().eq('id', id));
    },
    // Realtime keeps both phones current. Each event carries the changed row, so the
    // other phone patches it in place instead of re-downloading everything.
    subscribe(table, householdId, cb) {
      const scoped = { schema: 'public', table, filter: `household_id=eq.${householdId}` };
      let connected = false;
      const channel = client
        .channel(`sf-${table}-${householdId}`)
        .on('postgres_changes', { event: 'INSERT', ...scoped }, (p) => cb({ type: 'upsert', row: p.new }))
        .on('postgres_changes', { event: 'UPDATE', ...scoped }, (p) => cb({ type: 'upsert', row: p.new }))
        // Realtime cannot filter deletes and, under row-level security, sends only the id.
        // Matching by id is safe: an id from another household simply matches nothing here.
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (p) => cb({ type: 'delete', row: p.old }))
        .subscribe((status) => {
          if (status !== 'SUBSCRIBED') return;
          // Events missed while the connection was down (phone asleep, tunnel) are caught up by a re-read.
          if (connected) cb({ type: 'resync' });
          connected = true;
        });
      return () => client.removeChannel(channel);
    },
  };
}
