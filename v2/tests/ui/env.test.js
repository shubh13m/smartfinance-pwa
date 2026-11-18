import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom } from '../helpers/dom.js';
import { LOCAL_MODE_KEY, SUPABASE, isCloudMode } from '../../src/config/env.js';

installDom();
beforeEach(resetDom);

const configured = { url: 'https://x.supabase.co', anonKey: 'k' };

test('env: cloud mode needs both a URL and a key', () => {
  assert.equal(isCloudMode(configured, localStorage), true);
  assert.equal(isCloudMode({ url: '', anonKey: 'k' }, localStorage), false);
  assert.equal(isCloudMode({ url: 'u', anonKey: '' }, localStorage), false);
  assert.equal(isCloudMode({ url: '', anonKey: '' }, localStorage), false);
});

test('env: a browser pinned to local mode ignores the configuration', () => {
  localStorage.setItem(LOCAL_MODE_KEY, 'local');
  assert.equal(isCloudMode(configured, localStorage), false);
  localStorage.setItem(LOCAL_MODE_KEY, 'cloud');
  assert.equal(isCloudMode(configured, localStorage), true);
});

test('env: blocked or missing storage falls back to the configured mode', () => {
  assert.equal(isCloudMode(configured, undefined), true);
  const throwing = { getItem() { throw new Error('blocked'); } };
  assert.equal(isCloudMode(configured, throwing), true);
});

test('env: the committed configuration points at a supabase.co project with a public (anon) key', () => {
  assert.match(SUPABASE.url, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
  const payload = JSON.parse(Buffer.from(SUPABASE.anonKey.split('.')[1], 'base64url').toString());
  assert.equal(payload.role, 'anon', 'only the public anon key may be committed');
  assert.equal(SUPABASE.url, `https://${payload.ref}.supabase.co`, 'URL and key belong to the same project');
});
