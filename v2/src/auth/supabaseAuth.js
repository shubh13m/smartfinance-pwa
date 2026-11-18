const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Plain-language versions of the sign-in errors people actually run into.
// Anything not listed keeps the server's own wording.
const FRIENDLY_AUTH_ERRORS = [
  [/rate limit/i, 'Too many emails were sent recently. Wait about an hour and try again, or ask the admin to create the account.'],
  [/signups? (are )?(not allowed|disabled)/i, 'Sign-ups are turned off. Ask the admin to enable email sign-in.'],
  [/email address .*(is )?invalid|unable to validate email/i, 'That email address was not accepted. Use a real address you can receive mail at.'],
  [/email not confirmed/i, 'Please confirm your email first (check your inbox), then sign in.'],
  [/password .*(at least|should be|too short|weak)/i, 'Choose a longer password (at least 8 characters).'],
];

export function friendlyAuthMessage(message = '') {
  return FRIENDLY_AUTH_ERRORS.find(([pattern]) => pattern.test(message))?.[1] ?? message;
}

function must({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// Household errors people can fix themselves get a plain-language message; the rest keep the server wording.
const FRIENDLY_HOUSEHOLD_ERRORS = [
  [/name is already used/i, 'Someone in this household already uses that name (capitals don’t matter). Add an initial or a nickname so you can tell each other apart.'],
  [/enter your name/i, 'Enter your name.'],
];

export function friendlyHouseholdMessage(message = '') {
  return FRIENDLY_HOUSEHOLD_ERRORS.find(([pattern]) => pattern.test(message))?.[1] ?? message;
}

function mustHousehold({ data, error }) {
  if (error) throw new Error(friendlyHouseholdMessage(error.message));
  return data;
}

// Same as must(), but for sign-in/sign-up where the raw messages are cryptic.
function mustAuth({ data, error }) {
  if (error) throw new Error(friendlyAuthMessage(error.message));
  return data;
}

// Cloud mode: email + password accounts, then create or join a household with an invite code.
// `createClient` is injectable so tests can supply a fake instead of loading supabase-js from the CDN.
export async function createSupabaseAuth({ url, anonKey, createClient }) {
  const factory = createClient || (await import(SUPABASE_ESM)).createClient;
  const client = factory(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  return {
    mode: 'cloud',
    client,

    async getSession() {
      const { data } = await client.auth.getSession();
      const user = data.session?.user;
      if (!user) return null;
      const membership = must(await client
        .from('household_members')
        .select('household_id, display_name, households(name, invite_code)')
        .eq('user_id', user.id)
        .is('left_at', null)
        .maybeSingle());
      return {
        userId: user.id,
        email: user.email,
        displayName: membership?.display_name ?? user.email,
        householdId: membership?.household_id ?? null,
        householdName: membership?.households?.name ?? null,
        inviteCode: membership?.households?.invite_code ?? null,
      };
    },

    async signIn({ email, password }) {
      mustAuth(await client.auth.signInWithPassword({ email, password }));
    },

    async signUp({ email, password }) {
      const data = mustAuth(await client.auth.signUp({ email, password }));
      return { needsConfirmation: !data.session };
    },

    async createHousehold({ name, displayName }) {
      mustHousehold(await client.rpc('create_household', { household_name: name, member_name: displayName }));
    },

    async joinHousehold({ code, displayName }) {
      mustHousehold(await client.rpc('join_household', { code, member_name: displayName }));
    },

    // Removes someone else. Their entries stay; the invite code is replaced.
    async removeMember(userId) {
      must(await client.rpc('remove_member', { target_user: userId }));
    },

    async leaveHousehold() {
      must(await client.rpc('leave_household'));
    },

    // Returns the new invite code.
    async rotateInviteCode() {
      return must(await client.rpc('rotate_invite_code'));
    },

    async signOut() {
      await client.auth.signOut();
    },

    onChange(cb) {
      const { data } = client.auth.onAuthStateChange(() => cb());
      return () => data.subscription.unsubscribe();
    },
  };
}
