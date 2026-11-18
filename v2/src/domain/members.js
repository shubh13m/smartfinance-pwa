// A removed member keeps their row (with `left_at` set) so their past entries stay attributed
// to a name; they just lose access and no longer appear as someone you can view or remove.
//
// If the same person (same account) is removed and later rejoins, the database holds one row per
// membership. People are identified by account (`user_id`), so those rows collapse into one person:
// the active membership wins, otherwise the most recent one.

export function dedupeMembers(members = []) {
  const best = new Map();
  const order = [];
  for (const m of members) {
    if (!best.has(m.user_id)) order.push(m.user_id);
    const current = best.get(m.user_id);
    const better = !current
      || (!m.left_at && current.left_at)
      || (m.left_at && current.left_at && String(m.left_at) > String(current.left_at));
    if (better) best.set(m.user_id, m);
  }
  return order.map((id) => best.get(id));
}

export const activeMembers = (members = []) => members.filter((m) => !m.left_at);
export const formerMembers = (members = []) => members.filter((m) => m.left_at);

export const memberLabel = (member) => (member.left_at ? `${member.display_name} (former)` : member.display_name);

/** Active members plus any former member who still has entries (so their history can be viewed). */
export function membersWithData(members = [], { transactions = [], recurring = [] } = {}) {
  const authors = new Set([...transactions, ...recurring].map((row) => row.created_by));
  return members.filter((m) => !m.left_at || authors.has(m.user_id));
}

export function canRemove(members, targetUserId, currentUserId) {
  const active = activeMembers(members);
  return active.length > 1 && targetUserId !== currentUserId && active.some((m) => m.user_id === targetUserId);
}

export function canLeave(members, currentUserId) {
  const active = activeMembers(members);
  return active.length > 1 && active.some((m) => m.user_id === currentUserId);
}
