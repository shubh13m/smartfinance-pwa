import { SUPABASE, isCloudMode } from '../config/env.js';
import { createIdbAdapter } from '../data/adapters/idbAdapter.js';
import { createSupabaseAdapter } from '../data/adapters/supabaseAdapter.js';
import { createLocalAuth } from '../auth/localAuth.js';
import { createSupabaseAuth } from '../auth/supabaseAuth.js';
import { createLedger } from '../services/ledger.js';
import { createStore } from '../core/store.js';
import { currentMonthId } from '../core/dates.js';
import { h, clear } from '../core/dom.js';
import { membersWithData } from '../domain/members.js';
import { friendlyDataError } from '../data/errors.js';
import { button, emptyState, toast } from '../ui/components.js';
import { renderAuthScreen } from './authScreen.js';
import { renderShell } from './shell.js';
import { routeFromHash } from './router.js';

function renderLoadError(root, { message, retry, signOut }) {
  clear(root).append(h('main', { class: 'auth-wrap' }, h('div', { class: 'card auth-card' },
    h('h1', null, 'SmartFinance'),
    emptyState('Couldn’t load your data', message, 'x'),
    h('div', { class: 'actions' },
      button('Try again', { class: 'primary', icon: 'repeat', onClick: retry }),
      button('Sign out', { icon: 'logout', onClick: signOut })))));
}

// Composition root: the only place that decides which backend is used.
// `cloud` and `createClient` are injectable so tests can run the cloud flow against a fake backend.
export async function start(root, { cloud = isCloudMode() ? SUPABASE : null, createClient } = {}) {
  let auth;
  let adapter;
  try {
    if (cloud) {
      auth = await createSupabaseAuth({ ...cloud, createClient });
      adapter = createSupabaseAdapter(auth.client);
    } else {
      adapter = createIdbAdapter();
      auth = createLocalAuth({ adapter });
    }
  } catch (error) {
    clear(root).append(h('main', { class: 'auth-wrap' }, h('div', { class: 'card auth-card' },
      h('h1', null, 'SmartFinance'), emptyState('Could not start', error.message, 'x'))));
    return { stop() {} };
  }

  let teardown = () => {};
  let mountedKey = null;
  const show = async () => {
    let session;
    try {
      session = await auth.getSession();
    } catch (error) {
      toast(error.message, 'error');
    }
    const key = session?.householdId ? `${session.userId}:${session.householdId}` : null;
    // Token refreshes re-fire auth events; only remount when who/where actually changed.
    if (key && key === mountedKey) return;
    teardown();
    teardown = () => {};
    mountedKey = key;
    if (!key) return renderAuthScreen(root, { auth, session, refresh: show });
    teardown = await mountApp(root, { auth, adapter, session, onMembershipLost: show });
  };

  const unsubscribeAuth = auth.onChange(show);
  await show();
  return {
    stop() {
      unsubscribeAuth?.();
      teardown();
    },
  };
}

async function mountApp(root, { auth, adapter, session, onMembershipLost }) {
  const ledger = createLedger({ adapter, session });
  const state = createStore({
    route: routeFromHash(), monthId: currentMonthId(), personId: 'all', basis: 'smoothed',
  });
  const ctx = { auth, ledger, session, state, data: null, mutate: null, rerender: null, refreshSession: null };
  let alive = true;
  let loadToken = 0;

  const paint = () => {
    if (!alive || !ctx.data) return;
    const { personId } = state.get();
    // A filter pointing at someone who no longer has entries or access falls back to Together.
    if (personId !== 'all' && !membersWithData(ctx.data.members, ctx.data).some((m) => m.user_id === personId)) {
      state.set({ personId: 'all' });
      return;
    }
    renderShell(root, ctx);
  };

  const reload = async () => {
    const token = ++loadToken;
    const data = await ledger.loadAll();
    if (!alive || token !== loadToken) return;
    // If we were removed from the household the database shows us nothing; go back to the join screen.
    if (!data.members.some((m) => m.user_id === session.userId && !m.left_at)) {
      alive = false;
      onMembershipLost?.();
      return;
    }
    ctx.data = data;
    paint();
  };

  ctx.rerender = paint;

  // Picks up a changed invite code / household name after members are added or removed.
  ctx.refreshSession = async () => {
    const fresh = await auth.getSession();
    if (!fresh?.householdId) {
      alive = false;
      onMembershipLost?.();
      return;
    }
    Object.assign(session, { inviteCode: fresh.inviteCode, householdName: fresh.householdName, displayName: fresh.displayName });
    paint();
  };

  // Resolves true when the action succeeded so callers (e.g. a sheet) know whether to close.
  ctx.mutate = async (action, message) => {
    try {
      await action();
      if (message) toast(message, 'success');
      await reload();
      return true;
    } catch (error) {
      toast(friendlyDataError(error.message) || 'Something went wrong.', 'error');
      return false;
    }
  };

  // A change made by the other person must not wipe a form you are typing in.
  let retryTimer;
  const reloadWhenIdle = () => {
    clearTimeout(retryTimer);
    if (!alive) return;
    const typing = root.contains(document.activeElement)
      && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (typing) retryTimer = setTimeout(reloadWhenIdle, 2000);
    else reload().catch((error) => toast(friendlyDataError(error.message), 'error'));
  };

  const onHash = () => state.set({ route: routeFromHash() });
  window.addEventListener('hashchange', onHash);
  const unsubscribeState = state.subscribe(paint);
  const unsubscribeRemote = ledger.subscribe(reloadWhenIdle);

  const load = async () => {
    try {
      await reload();
    } catch (error) {
      renderLoadError(root, { message: friendlyDataError(error.message), retry: load, signOut: () => auth.signOut() });
    }
  };
  await load();

  return () => {
    alive = false;
    clearTimeout(retryTimer);
    window.removeEventListener('hashchange', onHash);
    unsubscribeState();
    unsubscribeRemote();
  };
}
