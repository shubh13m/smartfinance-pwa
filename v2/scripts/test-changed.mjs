// Picks and runs the smallest test subset that covers what changed.
//   npm run test:changed                 tests for uncommitted changes (working tree)
//   npm run test:changed -- --base main  tests for everything that differs from main
//   npm run test:changed -- --dry        print the plan without running it
//   npm run test:changed -- --all        run everything
//   npm run test:changed -- --no-e2e     skip the browser tests
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_ALL = ['tests/unit/*.test.js', 'tests/data/*.test.js', 'tests/ui/*.test.js'];

// First matching rule wins. `node` lists test globs/files; `e2e` lists spec names or 'all'.
export const RULES = [
  // Infrastructure that can affect anything.
  { when: /^v2\/(package(-lock)?\.json|playwright\.config\.js|scripts\/)/, node: NODE_ALL, e2e: 'all' },
  { when: /^\.github\/(workflows\/v2-tests\.yml|copilot-instructions\.md)$/, node: NODE_ALL, e2e: 'all' },

  // Shared test plumbing.
  { when: /^v2\/tests\/e2e\/(helpers|seed)\.js$/, node: [], e2e: 'all' },
  { when: /^v2\/tests\/helpers\//, node: ['tests/data/*.test.js', 'tests/ui/*.test.js'], e2e: [] },

  // Individual test files run themselves.
  { when: /^v2\/tests\/e2e\/(.+)\.spec\.js$/, node: [], e2e: (m) => [m[1]] },
  { when: /^v2\/(tests\/(unit|data|ui)\/.+\.test\.js)$/, node: (m) => [m[1]], e2e: [] },

  // Pure logic: fast layers plus a representative end-to-end flow.
  { when: /^v2\/src\/(core|config|domain)\//, node: NODE_ALL, e2e: ['household', 'entries', 'planning'] },
  // Storage, services and auth.
  { when: /^v2\/src\/(data|services|auth)\//, node: NODE_ALL, e2e: ['onboarding', 'household', 'settings', 'planning'] },
  // Everything the user sees.
  { when: /^v2\/src\/(ui|features|app)\//, node: ['tests/unit/*.test.js', 'tests/ui/*.test.js'], e2e: 'all' },
  { when: /^v2\/src\/theme-boot\.js$|^v2\/(index\.html|sw\.js|manifest\.webmanifest)$/, node: ['tests/unit/*.test.js'], e2e: ['platform', 'settings'] },
  { when: /^v2\/styles\//, node: ['tests/unit/design-tokens.test.js', 'tests/unit/invariants.test.js'], e2e: ['platform', 'settings', 'visual', 'layout'] },
  { when: /^v2\/db\//, node: ['tests/unit/schema.test.js', 'tests/unit/migrations.test.js'], e2e: [] },
  { when: /^v2\/README\.md$|^v2\/TESTING\.md$|^v2\/\.gitignore$/, node: [], e2e: [] },

  // Anything else inside v2 we do not recognise: be safe and run everything.
  { when: /^v2\//, node: NODE_ALL, e2e: 'all' },
];

/** Pure: given changed file paths (repo-relative, forward slashes), returns what to run. */
export function planFor(files, { includeE2e = true } = {}) {
  const node = new Set();
  let e2e = new Set();
  let e2eAll = false;
  const unmatched = [];

  for (const raw of files) {
    const file = raw.replaceAll('\\', '/');
    const rule = RULES.find((r) => r.when.test(file));
    if (!rule) { unmatched.push(file); continue; }
    const match = file.match(rule.when);
    const nodeTests = typeof rule.node === 'function' ? rule.node(match) : rule.node;
    nodeTests.forEach((t) => node.add(t));
    const specs = typeof rule.e2e === 'function' ? rule.e2e(match) : rule.e2e;
    if (specs === 'all') e2eAll = true;
    else specs.forEach((s) => e2e.add(s));
  }

  // A wildcard (e.g. every unit test) already covers specific files inside the same folder.
  const globs = NODE_ALL.filter((g) => node.has(g));
  const nodeList = [...node].filter((t) => t.includes('*') || !globs.some((g) => t.startsWith(g.slice(0, g.indexOf('*')))));
  if (!includeE2e) { e2e = new Set(); e2eAll = false; }
  return {
    node: nodeList,
    e2e: e2eAll ? 'all' : [...e2e],
    ignored: unmatched,
    nothingToRun: nodeList.length === 0 && !e2eAll && e2e.size === 0,
  };
}

/* ---------------- CLI ---------------- */

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

export function changedFiles({ base, cwd }) {
  const root = git(['rev-parse', '--show-toplevel'], cwd).trim();
  const files = new Set();
  if (base) git(['diff', '--name-only', `${base}...HEAD`], root).split('\n').forEach((f) => f && files.add(f));
  for (const line of git(['status', '--porcelain', '--untracked-files=all'], root).split('\n')) {
    if (!line.trim()) continue;
    const path = line.slice(3).split(' -> ').at(-1).replace(/^"|"$/g, '');
    files.add(path);
  }
  return [...files];
}

function run(cmd, args, cwd) {
  console.log(`\n$ ${cmd} ${args.join(' ')}\n`);
  return spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1;
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => argv.includes(name);
  const base = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : null;
  const v2 = resolve(fileURLToPath(new URL('../', import.meta.url)));

  const files = flag('--all') ? ['v2/package.json'] : changedFiles({ base, cwd: v2 });
  const plan = planFor(files, { includeE2e: !flag('--no-e2e') });

  console.log(`Changed files (${files.length}):\n${files.map((f) => `  ${f}`).join('\n') || '  (none)'}`);
  if (plan.ignored.length) console.log(`\nOutside v2 (no tests needed):\n${plan.ignored.map((f) => `  ${f}`).join('\n')}`);
  console.log(`\nPlan:\n  unit/data/ui: ${plan.node.join(', ') || '(none)'}\n  browser:      ${plan.e2e === 'all' ? 'all specs' : plan.e2e.join(', ') || '(none)'}`);

  if (flag('--dry')) return 0;
  if (plan.nothingToRun) { console.log('\nNothing to run for these changes.'); return 0; }

  let status = 0;
  if (plan.node.length) status ||= run(process.execPath, ['--test', ...plan.node], v2);
  if (plan.e2e === 'all') status ||= run('npx', ['playwright', 'test'], v2);
  else if (plan.e2e.length) status ||= run('npx', ['playwright', 'test', ...plan.e2e], v2);
  return status;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
