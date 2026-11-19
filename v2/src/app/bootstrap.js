import { SUPABASE, isCloudMode } from '../config/env.js';
import { createIdbAdapter } from '../data/adapters/idbAdapter.js';
import { createSupabaseAdapter } from '../data/adapters/supabaseAdapter.js';
import { createLocalAuth } from '../auth/localAuth.js';
import { createSupabaseAuth } from '../auth/supabaseAuth.js';
import { createLedger } from '../services/ledger.js';
import { createDataCache, isPatchable } from '../services/dataCache.js';
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
  const cache = createDataCache();
  let alive = true;
  let loadToken = 0;
  let localVersion = 0; // bumps on every write made here, so a slow re-read cannot undo it
  let pendingWrites = 0;
  let paintQueued = false;
  const waiting = new Set();
  const isTyping = () => root.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);

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

  // Several changes in the same moment (e.g. a goal and its contributions) cost one repaint.
  const paintSoon = () => {
    if (paintQueued) return;
    paintQueued = true;
    queueMicrotask(() => { paintQueued = false; paint(); });
  };

  const report = (error) => toast(friendlyDataError(error.message) || 'Something went wrong.', 'error');

  const reload = async (force = false) => {
    const token = ++loadToken;
    const startedAt = localVersion;
    const data = await ledger.loadAll();
    if (!alive || token !== loadToken) return;
    // We changed something while this was in flight; its answer may predate our change, so ask again.
    if (localVersion !== startedAt || (!force && pendingWrites > 0)) {
      setTimeout(() => { if (alive) reload().catch(report); }, 400);
      return;
    }
    // If we were removed from the household the database shows us nothing; go back to the join screen.
    if (!data.members.some((m) => m.user_id === session.userId && !m.left_at)) {
      alive = false;
      onMembershipLost?.();
      return;
    }
    cache.replace(data);
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

  // Our own writes: the screen shows the result at once, before the server has answered.
  const unsubscribeLocal = ledger.onChange((change) => {
    localVersion += 1;
    if (cache.apply(change)) paintSoon();
    ctx.data = cache.get();
    waiting.forEach((release) => release());
  });

  // Resolves true when the action succeeded, or as soon as its result is on screen (so a
  // sheet can close without waiting on the network). A write the server later rejects is
  // undone by re-reading the truth, with a message, and `onFail` lets the caller bring its form back.
  ctx.mutate = async (action, message, { onFail } = {}) => {
    const before = localVersion;
    let release;
    const shown = new Promise((resolve) => { release = resolve; });
    waiting.add(release);
    pendingWrites += 1;
    const finished = (async () => {
      await action();
      // Anything that did not go through the ledger (members, imports) is picked up by a re-read.
      if (localVersion === before) await reload(true);
    })();
    const settle = () => { waiting.delete(release); pendingWrites -= 1; };
    try {
      await Promise.race([finished, shown]);
    } catch (error) {
      settle();
      report(error);
      reload().catch(report);
      return false;
    }
    if (message) toast(message, 'success');
    finished.then(settle, (error) => {
      settle();
      toast(`Not saved, and undone. ${friendlyDataError(error.message) || ''}`.trim(), 'error');
      reload().catch(report);
      onFail?.(error);
    });
    return true;
  };

  // A change made by the other person must not wipe a form you are typing in.
  let idleTimer;
  const whenIdle = (run) => {
    clearTimeout(idleTimer);
    if (!alive) return;
    if (isTyping()) idleTimer = setTimeout(() => whenIdle(run), 2000);
    else run();
  };
  const reloadWhenIdle = () => whenIdle(() => reload().catch(report));

  // The other person's change is patched in directly; only things we cannot patch trigger a re-read.
  const onRemote = (change) => {
    if (change?.type === 'resync' || !isPatchable(change?.table)) return reloadWhenIdle();
    const visible = cache.apply(change);
    ctx.data = cache.get();
    if (visible) whenIdle(paintSoon);
  };

  // A phone that was asleep or offline missed events; catch up when it wakes or reconnects.
  const onVisible = () => { if (document.visibilityState !== 'hidden') reloadWhenIdle(); };

  const onHash = () => state.set({ route: routeFromHash() });
  window.addEventListener('hashchange', onHash);
  window.addEventListener('online', reloadWhenIdle);
  document.addEventListener('visibilitychange', onVisible);
  const unsubscribeState = state.subscribe(paint);
  const unsubscribeRemote = ledger.subscribe(onRemote);

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
    clearTimeout(idleTimer);
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('online', reloadWhenIdle);
    document.removeEventListener('visibilitychange', onVisible);
    unsubscribeState();
    unsubscribeLocal();
    unsubscribeRemote();
  };
}
