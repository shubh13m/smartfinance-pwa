import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAppServer } from '../../scripts/serve.mjs';

let server;
let base;
let dir;

before(async () => {
  dir = resolve(mkdtempSync(join(tmpdir(), 'sf-serve-')));
  mkdirSync(join(dir, 'v2/styles'), { recursive: true });
  mkdirSync(join(dir, 'v2/empty-dir'));
  writeFileSync(join(dir, 'v2/index.html'), '<h1>home</h1>');
  writeFileSync(join(dir, 'v2/styles/app.css'), 'body{}');
  writeFileSync(join(dir, 'v2/manifest.webmanifest'), '{}');
  writeFileSync(join(dir, 'secret.txt'), 'outside the app folder');
  server = createAppServer({ root: join(dir, 'v2') });
  await new Promise((resolveListen) => server.listen(0, resolveListen));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const get = (path) => fetch(`${base}${path}`);

test('serves index.html for a folder URL with the right content type', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(await res.text(), '<h1>home</h1>');
});

test('serves static files with correct content types', async () => {
  assert.match((await get('/styles/app.css')).headers.get('content-type'), /text\/css/);
  assert.match((await get('/manifest.webmanifest')).headers.get('content-type'), /manifest\+json/);
});

test('a missing file is a clean 404 and the server keeps running (regression: it used to crash)', async () => {
  for (const path of ['/favicon.ico', '/nope.js', '/styles/missing.css']) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
    await res.text();
  }
  assert.equal((await get('/')).status, 200, 'still serving after 404s');
});

test('a directory without an index is a 404, not a crash', async () => {
  const res = await get('/empty-dir');
  assert.equal(res.status, 404);
  assert.equal((await get('/')).status, 200);
});

test('path traversal cannot escape the served folder', async () => {
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/styles/../../secret.txt']) {
    const res = await get(path);
    assert.ok([403, 404].includes(res.status), `${path} -> ${res.status}`);
    assert.doesNotMatch(await res.text(), /outside the app folder/);
  }
});

test('a malformed URL gets a 400 instead of crashing', async () => {
  const res = await get('/%E0%A4%A');
  assert.equal(res.status, 400);
  assert.equal((await get('/')).status, 200);
});

test('responses are not cached so edits show up on reload', async () => {
  assert.equal((await get('/')).headers.get('cache-control'), 'no-cache');
});
