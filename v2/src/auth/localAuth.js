import { newId } from '../core/ids.js';

export const LOCAL_HOUSEHOLD_ID = 'local-household';
const PROFILE_KEY = 'sf2_local_profile';

/**
 * Local mode: no cloud, one browser. Different "people" can be added by name so the
 * combined / per-person views can be tried on a single device.
 * Auth contract shared with supabaseAuth.js:
 *   getSession() -> { userId, displayName, householdId, householdName, inviteCode, email } | null
 *   signIn(credentials), signOut(), onChange(cb)
 */
export function createLocalAuth({ adapter, storage = globalThis.localStorage }) {
  const listeners = new Set();
  const emit = () => listeners.forEach((cb) => cb());
  const activeMembers = async () => (await adapter.list('household_members', { householdId: LOCAL_HOUSEHOLD_ID })).filter((m) => !m.left_at);
  const profile = () => {
    const raw = storage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  };

  async function markLeft(userId) {
    const members = await activeMembers();
    const target = members.find((m) => m.user_id === userId);
    if (!target) throw new Error('that person is not in your household');
    if (members.length <= 1) throw new Error('you are the only member');
    await adapter.update('household_members', target.id, { left_at: new Date().toISOString() });
  }

  return {
    mode: 'local',

    async getSession() {
      const saved = profile();
      if (!saved) return null;
      // A profile whose person was removed (e.g. in another tab) is no longer signed in.
      if (!(await activeMembers()).some((m) => m.user_id === saved.userId)) {
        storage.removeItem(PROFILE_KEY);
        return null;
      }
      return {
        userId: saved.userId,
        email: null,
        displayName: saved.displayName,
        householdId: LOCAL_HOUSEHOLD_ID,
        householdName: 'This device',
        inviteCode: null,
      };
    },

    async signIn({ displayName }) {
      const name = String(displayName ?? '').trim();
      if (!name) throw new Error('Enter a name.');
      if (name.length > 60) throw new Error('Name is too long.');
      let member = (await activeMembers()).find((m) => m.display_name.toLowerCase() === name.toLowerCase());
      if (!member) {
        member = await adapter.insert('household_members', {
          household_id: LOCAL_HOUSEHOLD_ID, user_id: newId(), display_name: name, left_at: null,
        });
      }
      storage.setItem(PROFILE_KEY, JSON.stringify({ userId: member.user_id, displayName: member.display_name }));
      emit();
    },

    async removeMember(userId) {
      if (userId === profile()?.userId) throw new Error('use leave_household to remove yourself');
      await markLeft(userId);
    },

    async leaveHousehold() {
      await markLeft(profile()?.userId);
      storage.removeItem(PROFILE_KEY);
      emit();
    },

    // Invite codes only exist in cloud mode.
    async rotateInviteCode() {
      return null;
    },

    async signOut() {
      storage.removeItem(PROFILE_KEY);
      emit();
    },

    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
