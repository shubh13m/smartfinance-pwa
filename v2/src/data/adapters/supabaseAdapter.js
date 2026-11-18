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
    // Realtime keeps both phones current: any change in the household refetches.
    subscribe(table, householdId, cb) {
      const channel = client
        .channel(`sf-${table}-${householdId}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}`,
        }, () => cb())
        .subscribe();
      return () => client.removeChannel(channel);
    },
  };
}
