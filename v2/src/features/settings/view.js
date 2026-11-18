import { h } from '../../core/dom.js';
import { BUCKETS, BUCKET_LABELS } from '../../config/constants.js';
import { convertLegacyMonths, readLegacyMonths } from '../../data/legacyImport.js';
import { avatar, button, card, field, iconButton, input, segmented, singleFlight, toast } from '../../ui/components.js';
import { activeMembers, canLeave, canRemove, formerMembers } from '../../domain/members.js';
import { currentTheme, applyTheme, THEME_KEY } from '../../ui/theme.js';

export const IMPORT_FLAG = 'sf2_legacy_imported';

export function renderSettings(container, ctx) {
  container.append(
    h('div', { class: 'grid-2' },
      h('div', { class: 'stack' }, buildSplit(ctx), buildAppearance(ctx)),
      h('div', { class: 'stack' }, buildHousehold(ctx), buildData(ctx), buildAccount(ctx))));
}

function buildSplit(ctx) {
  const inputs = Object.fromEntries(BUCKETS.map((bucket) => [
    bucket, input({ type: 'number', min: 0, max: 100, step: 1, value: ctx.data.split[bucket], required: true }),
  ]));
  const total = h('strong', { class: 'num' });
  const refreshTotal = () => {
    const sum = BUCKETS.reduce((acc, b) => acc + Number(inputs[b].value || 0), 0);
    total.textContent = `Total ${sum}%`;
    total.className = `num ${sum === 100 ? 'pos' : 'neg'}`;
  };
  Object.values(inputs).forEach((el) => el.addEventListener('input', refreshTotal));
  refreshTotal();

  const submit = singleFlight(() => {
    const split = Object.fromEntries(BUCKETS.map((b) => [b, Number(inputs[b].value)]));
    return ctx.mutate(() => ctx.ledger.saveSplit(split), 'Budget plan saved');
  });

  return card({ title: 'Budget plan', subtitle: 'Percent of household income. The classic rule is 50 / 30 / 20.' },
    h('form', { class: 'form', onSubmit: submit },
      h('div', { class: 'form-grid' }, BUCKETS.map((b) => field(`${BUCKET_LABELS[b]} %`, inputs[b]))),
      total,
      h('div', { class: 'actions' }, button('Save plan', { type: 'submit', class: 'primary', icon: 'check' }))));
}

function buildAppearance({ rerender }) {
  const choose = (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    rerender?.();
  };
  return card({ title: 'Appearance' },
    segmented([{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], currentTheme(), choose));
}

function buildHousehold(ctx) {
  const { session, data } = ctx;
  const active = activeMembers(data.members);
  const former = formerMembers(data.members);

  const removeMember = (m) => {
    const ok = confirm(`Remove ${m.display_name} from the household?\n\nThey lose access immediately. What they entered stays, shown as “${m.display_name} (former)”. The invite code changes so they cannot rejoin with the old one.`);
    if (!ok) return undefined;
    return ctx.mutate(async () => {
      await ctx.auth.removeMember(m.user_id);
      await ctx.refreshSession?.();
    }, `${m.display_name} was removed`);
  };

  const leave = () => {
    if (!confirm('Leave this household?\n\nYou will lose access to its data. Everything you entered stays for the others.')) return undefined;
    return ctx.mutate(() => ctx.auth.leaveHousehold(), 'You left the household');
  };

  const newCode = () => {
    if (!confirm('Create a new invite code? The old code stops working straight away.')) return undefined;
    return ctx.mutate(async () => {
      await ctx.auth.rotateInviteCode();
      await ctx.refreshSession?.();
    }, 'New invite code created');
  };

  const invite = session.inviteCode
    ? [
      h('p', { class: 'hint' }, 'Share this code. Your partner signs up, then chooses “Join household”.'),
      h('code', { class: 'invite', 'data-testid': 'invite-code' }, session.inviteCode),
      h('div', { class: 'actions' }, button('New invite code', { icon: 'repeat', class: 'sm', onClick: newCode })),
    ]
    : [h('p', { class: 'notice' }, 'Local mode: data stays on this device. Connect Supabase to share between phones.')];

  return card({ title: session.householdName || 'Household', subtitle: `${active.length} member(s)` },
    h('ul', { class: 'list', 'data-testid': 'members' }, active.map((m) => {
      const isMe = m.user_id === session.userId;
      return h('li', { class: 'list-item', 'data-member': m.display_name },
        avatar(m, data.members),
        h('span', { class: 'grow item-title' }, m.display_name, isMe ? h('span', { class: 'chip brand' }, 'You') : null),
        canRemove(data.members, m.user_id, session.userId)
          ? iconButton('x', `Remove ${m.display_name}`, { onClick: () => removeMember(m) })
          : null);
    })),
    canLeave(data.members, session.userId)
      ? h('div', { class: 'actions' }, button('Leave household', { icon: 'logout', class: 'sm danger', onClick: leave }))
      : null,
    former.length
      ? h('div', null,
        h('p', { class: 'date-head' }, 'Former members'),
        h('ul', { class: 'list', 'data-testid': 'former-members' }, former.map((m) => h('li', { class: 'list-item inactive' },
          avatar(m, data.members), h('span', { class: 'grow' }, m.display_name)))),
        h('small', { class: 'hint' }, 'Their past entries stay in your totals.'))
      : null,
    ...invite);
}

function buildData(ctx) {
  const importLegacy = async () => {
    if (localStorage.getItem(IMPORT_FLAG) && !confirm('You already imported your old data. Import again and create duplicates?')) return;
    const months = await readLegacyMonths();
    if (months.length === 0) return toast('No data from the original app was found in this browser.', 'error');
    const rows = convertLegacyMonths(months, { createdBy: ctx.session.userId });
    await ctx.mutate(async () => {
      await ctx.ledger.importRows(rows);
      localStorage.setItem(IMPORT_FLAG, new Date().toISOString());
    }, `Imported ${rows.transactions.length + rows.recurring.length} items from the original app`);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(ctx.data, null, 2)], { type: 'application/json' });
    const link = h('a', { href: URL.createObjectURL(blob), download: `smartfinance-${new Date().toISOString().slice(0, 10)}.json` });
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return card({ title: 'Your data', subtitle: 'Bring your old data over or take a backup.' },
    h('div', { class: 'actions' },
      button('Import from original app', { icon: 'upload', onClick: importLegacy }),
      button('Export backup', { icon: 'download', onClick: exportJson })));
}

function buildAccount(ctx) {
  return card({ title: 'Account', subtitle: `Signed in as ${ctx.session.displayName}` },
    h('div', { class: 'actions' }, button('Sign out', { icon: 'logout', class: 'danger', onClick: () => ctx.auth.signOut() })));
}
