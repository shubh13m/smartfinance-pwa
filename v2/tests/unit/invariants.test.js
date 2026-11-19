import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const V2 = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SRC = join(V2, 'src');

function walk(dir, ext = '.js') {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, ext) : full.endsWith(ext) ? [full] : [];
  });
}

const sources = walk(SRC).map((file) => ({ file, rel: relative(SRC, file).replaceAll('\\', '/'), code: readFileSync(file, 'utf8') }));
const importsOf = (code) => [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
const layer = (rel) => rel.split('/')[0];

test('security: source never uses innerHTML, document.write, eval or new Function', () => {
  const banned = /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/;
  for (const { rel, code } of sources) assert.doesNotMatch(code, banned, rel);
});

test('security: no inline style attributes in UI code (the CSP forbids them); widths are set via the DOM API', () => {
  for (const { rel, code } of sources.filter((s) => ['ui', 'features', 'app'].includes(layer(s.rel)))) {
    assert.doesNotMatch(code, /setAttribute\(\s*'style'/, rel);
    assert.doesNotMatch(code, /\bstyle\s*:\s*[`'"]/, rel);
  }
});

test('security: index.html ships a strict CSP without unsafe-inline or unsafe-eval', () => {
  const html = readFileSync(join(V2, 'index.html'), 'utf8');
  const csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
  assert.ok(csp, 'CSP meta tag present');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  const scriptSrc = csp.match(/script-src ([^;]+)/)[1].split(/\s+/);
  assert.deepEqual(scriptSrc.sort(), ["'self'", 'https://cdn.jsdelivr.net']);
});

test('security: the committed public config never contains a service-role key', () => {
  const env = readFileSync(join(SRC, 'config/env.js'), 'utf8');
  const withoutComments = env.replace(/\/\/.*$/gm, '');
  const key = withoutComments.match(/anonKey:\s*'([^']*)'/)?.[1] ?? '';
  assert.doesNotMatch(withoutComments, /service_role/);
  if (key.split('.').length === 3) {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    assert.notEqual(payload.role, 'service_role', 'a service_role key must never be committed');
  }
});

test('architecture: domain is pure (imports only core/config and itself)', () => {
  for (const { rel, code } of sources.filter((s) => layer(s.rel) === 'domain')) {
    for (const spec of importsOf(code)) {
      assert.match(spec, /^(\.\/|\.\.\/core\/|\.\.\/config\/)/, `${rel} imports ${spec}`);
    }
  }
});

test('architecture: core and config import nothing outside themselves', () => {
  for (const { rel, code } of sources.filter((s) => ['core', 'config'].includes(layer(s.rel)))) {
    for (const spec of importsOf(code)) assert.match(spec, /^\.\/|^\.\.\/(core|config)\//, `${rel} imports ${spec}`);
  }
});

test('architecture: UI components never reach into data, services, auth or features', () => {
  for (const { rel, code } of sources.filter((s) => layer(s.rel) === 'ui')) {
    for (const spec of importsOf(code)) assert.doesNotMatch(spec, /\/(data|services|auth|features|app)\//, `${rel} imports ${spec}`);
  }
});

test('architecture: features use the ledger service, not storage adapters or the backend directly', () => {
  for (const { rel, code } of sources.filter((s) => layer(s.rel) === 'features')) {
    for (const spec of importsOf(code)) {
      assert.doesNotMatch(spec, /data\/adapters|supabase/i, `${rel} imports ${spec}`);
    }
    assert.doesNotMatch(code, /indexedDB|fetch\(/, rel);
  }
});

test('architecture: only the composition root picks a backend', () => {
  for (const { rel, code } of sources) {
    // The factories themselves live in data/ and auth/; everyone else must go through bootstrap.
    if (rel === 'app/bootstrap.js' || ['data', 'auth'].includes(layer(rel))) continue;
    assert.doesNotMatch(code, /createSupabaseAdapter|createIdbAdapter|createSupabaseAuth|createLocalAuth\(/, rel);
  }
});

test('architecture: data layer does not import UI or features', () => {
  for (const { rel, code } of sources.filter((s) => ['data', 'services', 'auth'].includes(layer(s.rel)))) {
    for (const spec of importsOf(code)) assert.doesNotMatch(spec, /\/(ui|features|app)\//, `${rel} imports ${spec}`);
  }
});

test('every relative import resolves to a real file', () => {
  for (const { file, rel, code } of sources) {
    for (const spec of importsOf(code).filter((s) => s.startsWith('.'))) {
      assert.ok(existsSync(resolve(dirname(file), spec)), `${rel} -> ${spec}`);
    }
  }
});

test('router: every route has a title, a known icon and a render function; ids are unique', async () => {
  const { ROUTES } = await import('../../src/app/router.js');
  const { ICON_NAMES } = await import('../../src/ui/icons.js');
  assert.equal(new Set(ROUTES.map((r) => r.id)).size, ROUTES.length);
  for (const route of ROUTES) {
    assert.ok(route.title && route.label, route.id);
    assert.ok(ICON_NAMES.includes(route.icon), `${route.id} icon ${route.icon}`);
    assert.equal(typeof route.render, 'function', route.id);
  }
});

test('router: routeFromHash falls back to the first route', async () => {
  const { ROUTES, routeFromHash } = await import('../../src/app/router.js');
  assert.equal(routeFromHash(''), ROUTES[0].id);
  assert.equal(routeFromHash('#/nonsense'), ROUTES[0].id);
  assert.equal(routeFromHash('#/goals'), 'goals');
  assert.equal(routeFromHash('#recurring'), 'recurring');
});

test('index.html: every linked stylesheet, script, manifest and icon exists', () => {
  const html = readFileSync(join(V2, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('http'));
  assert.ok(refs.length >= 6);
  for (const ref of refs) assert.ok(existsSync(resolve(V2, ref)), ref);
});

test('index.html: preconnect hints point at the configured database and the CDN, and the CSP allows both', async () => {
  const html = readFileSync(join(V2, 'index.html'), 'utf8');
  const hints = [...html.matchAll(/rel="preconnect" href="([^"]+)"/g)].map((m) => m[1]);
  const { SUPABASE } = await import('../../src/config/env.js');
  assert.ok(hints.includes(new URL(SUPABASE.url).origin), 'a stale project URL would warm the wrong host');
  assert.ok(hints.includes('https://cdn.jsdelivr.net'));
  const connect = html.match(/connect-src ([^;]+)/)[1];
  assert.match(connect, /https:\/\/\*\.supabase\.co/);
  assert.match(connect, /https:\/\/cdn\.jsdelivr\.net/);
});

test('manifest: valid PWA fields and real icon files', () => {
  const manifest = JSON.parse(readFileSync(join(V2, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.name && manifest.short_name);
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512'));
  for (const icon of manifest.icons) assert.ok(existsSync(resolve(V2, icon.src)), icon.src);
});
