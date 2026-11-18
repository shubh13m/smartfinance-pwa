import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, planFor } from '../../scripts/test-changed.mjs';

const V2 = resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('domain/core/config changes run every non-browser layer plus a representative flow', () => {
  for (const file of ['v2/src/domain/summary.js', 'v2/src/core/money.js', 'v2/src/config/constants.js']) {
    const plan = planFor([file]);
    assert.deepEqual(plan.node, ['tests/unit/*.test.js', 'tests/data/*.test.js', 'tests/ui/*.test.js'], file);
    assert.deepEqual(plan.e2e, ['household', 'entries', 'planning'], file);
  }
});

test('data, service and auth changes include onboarding and sharing flows', () => {
  const plan = planFor(['v2/src/services/ledger.js']);
  assert.ok(plan.node.includes('tests/data/*.test.js'));
  assert.deepEqual(plan.e2e, ['onboarding', 'household', 'settings', 'planning']);
});

test('UI changes run unit + ui layers and every browser spec', () => {
  for (const file of ['v2/src/features/goals/view.js', 'v2/src/ui/components.js', 'v2/src/app/shell.js']) {
    const plan = planFor([file]);
    assert.deepEqual(plan.node, ['tests/unit/*.test.js', 'tests/ui/*.test.js'], file);
    assert.equal(plan.e2e, 'all', file);
  }
});

test('style changes run the design-token checks and the visual/accessibility specs', () => {
  const plan = planFor(['v2/styles/components.css']);
  assert.ok(plan.node.includes('tests/unit/design-tokens.test.js'));
  assert.deepEqual(plan.e2e, ['platform', 'settings', 'visual', 'layout']);
});

test('schema changes only need the schema and migration checks', () => {
  assert.deepEqual(planFor(['v2/db/001_init.sql']), { node: ['tests/unit/schema.test.js', 'tests/unit/migrations.test.js'], e2e: [], ignored: [], nothingToRun: false });
});

test('PWA shell files run the PWA checks', () => {
  for (const file of ['v2/sw.js', 'v2/index.html', 'v2/manifest.webmanifest', 'v2/src/theme-boot.js']) {
    const plan = planFor([file]);
    assert.deepEqual(plan.node, ['tests/unit/*.test.js'], file);
    assert.deepEqual(plan.e2e, ['platform', 'settings'], file);
  }
});

test('a changed test file runs just itself', () => {
  assert.deepEqual(planFor(['v2/tests/unit/money.test.js']).node, ['tests/unit/money.test.js']);
  assert.deepEqual(planFor(['v2/tests/ui/entries.test.js']).node, ['tests/ui/entries.test.js']);
  assert.deepEqual(planFor(['v2/tests/e2e/goals.spec.js']).e2e, ['goals']);
  assert.equal(planFor(['v2/tests/ui/entries.test.js']).e2e.length, 0);
});

test('shared test helpers rerun the suites that use them', () => {
  assert.deepEqual(planFor(['v2/tests/helpers/fixtures.js']).node, ['tests/data/*.test.js', 'tests/ui/*.test.js']);
  assert.equal(planFor(['v2/tests/e2e/helpers.js']).e2e, 'all');
  assert.equal(planFor(['v2/tests/e2e/seed.js']).e2e, 'all', 'the layout data is shared by the browser specs');
});

test('tooling and dependency changes run everything', () => {
  for (const file of ['v2/package.json', 'v2/playwright.config.js', 'v2/scripts/serve.mjs', '.github/workflows/v2-tests.yml']) {
    const plan = planFor([file]);
    assert.equal(plan.e2e, 'all', file);
    assert.equal(plan.node.length, 3, file);
  }
});

test('docs need no tests; the original app outside v2 is ignored', () => {
  assert.equal(planFor(['v2/README.md', 'v2/TESTING.md']).nothingToRun, true);
  const outside = planFor(['app.js', 'index.html', 'README.md']);
  assert.equal(outside.nothingToRun, true);
  assert.deepEqual(outside.ignored, ['app.js', 'index.html', 'README.md']);
});

test('unknown files inside v2 fall back to running everything', () => {
  const plan = planFor(['v2/something/new.txt']);
  assert.equal(plan.e2e, 'all');
  assert.equal(plan.node.length, 3);
});

test('mixed changes merge plans without duplicates, and wildcards absorb specific files', () => {
  const plan = planFor(['v2/src/domain/goals.js', 'v2/src/data/legacyImport.js', 'v2/tests/unit/money.test.js', 'v2/styles/base.css']);
  assert.equal(new Set(plan.node).size, plan.node.length);
  assert.ok(!plan.node.includes('tests/unit/money.test.js'), 'covered by tests/unit/*.test.js');
  assert.ok(plan.node.includes('tests/unit/*.test.js'));
  assert.ok(plan.e2e.includes('platform') && plan.e2e.includes('onboarding'));
});

test('--no-e2e drops the browser tests', () => {
  assert.deepEqual(planFor(['v2/src/features/goals/view.js'], { includeE2e: false }).e2e, []);
});

test('Windows-style paths are understood', () => {
  assert.deepEqual(planFor(['v2\\src\\domain\\goals.js']).e2e, ['household', 'entries', 'planning']);
});

test('every rule target exists: referenced test files and browser specs are real', () => {
  const unit = new Set(readdirSync(join(V2, 'tests/unit')));
  const specs = new Set(readdirSync(join(V2, 'tests/e2e')).filter((f) => f.endsWith('.spec.js')).map((f) => f.replace('.spec.js', '')));
  for (const rule of RULES) {
    for (const t of Array.isArray(rule.node) ? rule.node : []) {
      if (t.includes('*')) assert.ok(existsSync(join(V2, t.slice(0, t.lastIndexOf('/')))), t);
      else assert.ok(unit.has(t.split('/').pop()) || existsSync(join(V2, t)), `missing ${t}`);
    }
    for (const spec of Array.isArray(rule.e2e) ? rule.e2e : []) assert.ok(specs.has(spec), `missing spec ${spec}`);
  }
});
