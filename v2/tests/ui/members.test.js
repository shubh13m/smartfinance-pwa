import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, buttonByText, click, setConfirm, settle, text } from '../helpers/dom.js';
import { makeViewCtx, HOUSEHOLD_ID } from '../helpers/fixtures.js';
import { renderSettings } from '../../src/features/settings/view.js';
import { renderTransactions } from '../../src/features/transactions/view.js';
import { renderDashboard } from '../../src/features/dashboard/view.js';

installDom();
beforeEach(resetDom);

const toastText = () => text(document.getElementById('toast'));
const membersCard = (view) => [...view.querySelectorAll('.card')].find((c) => text(c.querySelector('.card-title')) === 'Test home');
const income = { kind: 'income', amount_paise: 5000000, category: 'Salary', occurred_on: '2026-03-01', note: '' };

test('members: every active person is listed, you are marked, and only others can be removed', async () => {
  const ctx = await makeViewCtx();
  const card = membersCard(ctx.view(renderSettings));
  assert.match(text(card), /2 member\(s\)/);
  const rows = [...card.querySelectorAll('[data-testid=members] li')];
  assert.equal(rows.length, 2);
  assert.match(text(rows[0]), /Shubham.*You/);
  assert.equal(rows[0].querySelector('[aria-label^="Remove"]'), null, 'you cannot remove yourself');
  assert.ok(rows[1].querySelector('[aria-label="Remove Priya"]'));
});

test('members: removing someone asks first and explains what happens', async () => {
  const ctx = await makeViewCtx();
  const asked = [];
  setConfirm((message) => { asked.push(message); return false; });
  click(ctx.view(renderSettings).querySelector('[aria-label="Remove Priya"]'));
  await settle();
  assert.match(asked[0], /Remove Priya/);
  assert.match(asked[0], /lose access/);
  assert.match(asked[0], /Priya \(former\)/);
  assert.match(asked[0], /invite code changes/);
  assert.deepEqual(ctx.authCalls, [], 'declining does nothing');
});

test('members: confirming removes them, refreshes the session, and lists them as former', async () => {
  const ctx = await makeViewCtx();
  setConfirm(true);
  click(ctx.view(renderSettings).querySelector('[aria-label="Remove Priya"]'));
  await settle(15);
  assert.deepEqual(ctx.authCalls.map(([name]) => name), ['removeMember', 'refreshSession']);
  assert.match(toastText(), /Priya was removed/);

  document.body.replaceChildren();
  const card = membersCard(ctx.view(renderSettings));
  assert.match(text(card), /1 member\(s\)/);
  assert.match(text(card.querySelector('[data-testid=former-members]')), /Priya/);
  assert.match(text(card), /Their past entries stay in your totals/);
});

test('members: a person who left and rejoined is listed once, as an active member (regression: shown twice)', async () => {
  const ctx = await makeViewCtx();
  const priya = ctx.members[1];
  await ctx.adapter.update('household_members', priya.id, { left_at: '2026-01-01T00:00:00Z' });
  await ctx.adapter.insert('household_members', { household_id: HOUSEHOLD_ID, user_id: priya.user_id, display_name: 'Priya', left_at: null });
  await ctx.ledgers.Priya.addTransaction(income);
  await ctx.reload();

  const card = membersCard(ctx.view(renderSettings));
  assert.match(text(card), /2 member\(s\)/);
  assert.equal(card.querySelectorAll('[data-testid=members] li').length, 2);
  assert.equal(card.querySelector('[data-testid=former-members]'), null);

  document.body.replaceChildren();
  const entries = text(ctx.view(renderTransactions));
  assert.match(entries, /Priya/);
  assert.doesNotMatch(entries, /\(former\)/, 'her entries are not labelled former');
  document.body.replaceChildren();
  const rows = [...ctx.view(renderDashboard).querySelectorAll('.table tbody tr')].map(text);
  assert.equal(rows.length, 2, 'both active people, each once');
  assert.equal(rows.filter((r) => r.includes('Priya')).length, 1, 'Priya is not duplicated');
});

test('members: names are shown in full, the "You" chip is a separate element, and long names wrap safely', async () => {
  const ctx = await makeViewCtx({ names: ['Shubham', 'Priya Venkataramanan-Iyer'] });
  const card = membersCard(ctx.view(renderSettings));
  const rows = [...card.querySelectorAll('[data-testid=members] li')];
  assert.equal(text(rows[0].querySelector('.chip')), 'You');
  assert.match(text(rows[1]), /Priya Venkataramanan-Iyer/);
  assert.ok(rows[1].querySelector('.grow'), 'the name lives in a shrinkable column');
});

test('members: the last remaining person has no Remove or Leave buttons', async () => {
  const ctx = await makeViewCtx({ names: ['Solo'] });
  const card = membersCard(ctx.view(renderSettings));
  assert.equal(card.querySelector('[aria-label^="Remove"]'), null);
  assert.equal(buttonByText('Leave household', card), null);
});

test('members: once only one person is left nobody can be removed or leave', async () => {
  const ctx = await makeViewCtx();
  setConfirm(true);
  click(ctx.view(renderSettings).querySelector('[aria-label="Remove Priya"]'));
  await settle(15);
  document.body.replaceChildren();
  const card = membersCard(ctx.view(renderSettings));
  assert.equal(card.querySelector('[aria-label^="Remove"]'), null);
  assert.equal(buttonByText('Leave household', card), null);
});

test('members: leaving asks first and calls the leave action', async () => {
  const ctx = await makeViewCtx();
  const view = ctx.view(renderSettings);
  setConfirm(false);
  click(buttonByText('Leave household', view));
  await settle();
  assert.deepEqual(ctx.authCalls, []);
  setConfirm((message) => /lose access/.test(message));
  click(buttonByText('Leave household', view));
  await settle(15);
  assert.equal(ctx.authCalls[0][0], 'leaveHousehold');
});

test('members: a failing removal is reported and changes nothing', async () => {
  const ctx = await makeViewCtx();
  ctx.auth.removeMember = async () => { throw new Error('that person is not in your household'); };
  setConfirm(true);
  click(ctx.view(renderSettings).querySelector('[aria-label="Remove Priya"]'));
  await settle(15);
  assert.match(toastText(), /not in your household/);
});

test('invite code: a new one can be created (after confirming) and the session is refreshed', async () => {
  const ctx = await makeViewCtx();
  ctx.session.inviteCode = 'abc123def456';
  const view = ctx.view(renderSettings);
  setConfirm(false);
  click(buttonByText('New invite code', view));
  await settle();
  assert.deepEqual(ctx.authCalls, []);
  setConfirm(true);
  click(buttonByText('New invite code', view));
  await settle(15);
  assert.deepEqual(ctx.authCalls.map(([name]) => name), ['rotateInviteCode', 'refreshSession']);
  assert.match(toastText(), /New invite code created/);
});

test('invite code: local mode has no code to rotate', async () => {
  const ctx = await makeViewCtx();
  assert.equal(buttonByText('New invite code', ctx.view(renderSettings)), null);
});

test('former members: their entries stay, labelled "(former)", in lists, tables and the person filter data', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledgers.Priya.addTransaction(income);
  await ctx.ledgers.Priya.addTransaction({ kind: 'expense', amount_paise: 100000, category: 'Groceries', bucket: 'needs', occurred_on: '2026-03-02', note: 'Veg' });
  await ctx.auth.removeMember(ctx.members[1].user_id);
  await ctx.reload();

  const entries = ctx.view(renderTransactions);
  assert.match(text(entries), /Veg · Priya \(former\)/);

  const dash = ctx.view(renderDashboard);
  const table = text(dash.querySelector('.table'));
  assert.match(table, /Priya \(former\)/);
  assert.match(table, /₹50,000\.00/, 'their income still counts');
});

test('former members: someone who never entered anything is not shown in the who-contributed table', async () => {
  const ctx = await makeViewCtx();
  await ctx.ledgers.Shubham.addTransaction(income);
  await ctx.auth.removeMember(ctx.members[1].user_id);
  await ctx.reload();
  assert.equal(ctx.view(renderDashboard).querySelector('.table'), null, 'only one person left with data');
});

test('former members: a person filter on someone removed with no entries is not offered', async () => {
  const ctx = await makeViewCtx();
  await ctx.auth.removeMember(ctx.members[1].user_id);
  await ctx.reload();
  const { membersWithData } = await import('../../src/domain/members.js');
  assert.deepEqual(membersWithData(ctx.data.members, ctx.data).map((m) => m.display_name), ['Shubham']);
});
