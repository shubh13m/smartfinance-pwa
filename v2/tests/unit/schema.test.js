import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_HOUSEHOLD_MEMBERS } from '../../src/config/constants.js';
import { validateContribution, validateGoal, validateLoan, validateRecurring, validateTransaction } from '../../src/domain/validation.js';

const sql = readFileSync(fileURLToPath(new URL('../../db/001_init.sql', import.meta.url)), 'utf8');

const ALL_TABLES = ['households', 'household_members', 'transactions', 'recurring_items', 'goals', 'goal_contributions', 'budget_settings'];
const HOUSEHOLD_TABLES = ALL_TABLES.filter((t) => t !== 'households');
const FINANCE_TABLES = ['transactions', 'recurring_items', 'goals', 'goal_contributions', 'budget_settings'];

const tableBlock = (name) => sql.match(new RegExp(`create table public\\.${name} \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? '';

// The table list of the `do $$ ... foreach t in array array[...]` block that mentions `marker`.
const loopFor = (marker) => {
  const block = sql.split('do $$').slice(1).map((b) => b.split('end $$;')[0]).find((b) => b.includes(marker));
  return block?.match(/array\[([^\]]+)\]/)?.[1].match(/'([^']+)'/g).map((s) => s.replaceAll("'", ''));
};

test('schema: every table is created and has row-level security enabled', () => {
  for (const table of ALL_TABLES) {
    assert.ok(tableBlock(table), `create table ${table}`);
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `RLS on ${table}`);
  }
});

test('schema: no table is left without RLS (guards against new tables added unprotected)', () => {
  const created = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
  const secured = [...sql.matchAll(/alter table public\.(\w+) enable row level security/g)].map((m) => m[1]);
  assert.deepEqual([...created].sort(), [...secured].sort());
});

test('schema: finance tables get select/insert/update/delete policies scoped to household membership', () => {
  assert.deepEqual([...loopFor('create policy %I')].sort(), [...FINANCE_TABLES].sort(), 'policy loop must list every finance table');
  for (const verb of ['select', 'insert', 'update', 'delete']) {
    assert.match(sql, new RegExp(`for ${verb} (using|with check) \\(public\\.is_household_member\\(household_id\\)\\)`), verb);
  }
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /with check\s*\(\s*true\s*\)/i);
});

test('schema: households and members are readable only by members and never insertable directly', () => {
  assert.match(sql, /create policy households_read on public\.households\s+for select using \(public\.is_household_member\(id\)\)/);
  assert.match(sql, /create policy members_read on public\.household_members\s+for select using \(public\.is_household_member\(household_id\)\)/);
  assert.doesNotMatch(sql, /create policy \w+ on public\.households\s+for insert/);
  assert.doesNotMatch(sql, /create policy \w+ on public\.household_members\s+for insert/);
});

test('schema: a member can only rename themselves, never change household or user', () => {
  assert.match(sql, /revoke update on public\.household_members from authenticated, anon/);
  assert.match(sql, /grant update \(display_name\) on public\.household_members to authenticated/);
});

test('schema: the creator of a row must be the signed-in user (restrictive insert policies)', () => {
  for (const table of ['transactions', 'recurring_items', 'goals', 'goal_contributions']) {
    assert.match(sql, new RegExp(`as restrictive\\s+for insert with check \\(created_by = auth\\.uid\\(\\)\\)`), table);
  }
  assert.equal([...sql.matchAll(/as restrictive/g)].length, 4);
});

test('schema: household_id and created_by cannot be rewritten after insert', () => {
  assert.match(sql, /function public\.lock_ownership/);
  assert.deepEqual([...loopFor('lock_ownership()')].sort(), ['goal_contributions', 'goals', 'recurring_items', 'transactions']);
});

test('schema: membership helper and RPCs are security definer with a pinned search_path', () => {
  for (const fn of ['is_household_member', 'create_household', 'join_household']) {
    const body = sql.match(new RegExp(`function public\\.${fn}[\\s\\S]*?\\$\\$;?`))?.[0] ?? '';
    assert.match(body, /security definer set search_path = public/, fn);
  }
});

test('schema: RPCs are not callable by anonymous users', () => {
  for (const signature of ['create_household(text, text)', 'join_household(text, text)']) {
    const escaped = signature.replace(/[()]/g, '\\$&');
    assert.match(sql, new RegExp(`revoke all on function public\\.${escaped} from public, anon`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${escaped} to authenticated`));
  }
});

test('schema: household size limit matches the app constant', () => {
  assert.match(sql, new RegExp(`>= ${MAX_HOUSEHOLD_MEMBERS}\\b`));
});

test('schema: one household per user and cascading deletes', () => {
  assert.match(tableBlock('household_members'), /user_id uuid not null unique references auth\.users\(id\) on delete cascade/);
  for (const table of HOUSEHOLD_TABLES) assert.match(tableBlock(table), /references public\.households\(id\) on delete cascade/, table);
});

test('schema: money is stored as positive integer paise', () => {
  for (const table of ['transactions', 'recurring_items', 'goal_contributions']) {
    assert.match(tableBlock(table), /amount_paise bigint not null check \(amount_paise > 0\)/, table);
  }
  assert.match(tableBlock('goals'), /target_paise bigint not null check \(target_paise > 0\)/);
});

test('schema: budget split must add up to 100', () => {
  assert.match(tableBlock('budget_settings'), /check \(needs_pct \+ wants_pct \+ savings_pct = 100\)/);
});

test('schema: bucket/kind and frequency/due_month consistency is enforced in the database', () => {
  assert.match(tableBlock('transactions'), /check \(\(kind = 'expense'\) = \(bucket is not null\)\)/);
  assert.match(tableBlock('recurring_items'), /check \(\(kind = 'expense'\) = \(bucket is not null\)\)/);
  assert.match(tableBlock('recurring_items'), /check \(\(frequency = 'yearly'\) = \(due_month is not null\)\)/);
  assert.match(tableBlock('recurring_items'), /check \(end_on is null or end_on >= start_on\)/);
});

test('schema: contributions must reference a goal of the same household', () => {
  assert.match(sql, /goal belongs to a different household/);
  assert.match(sql, /create trigger goal_contributions_household/);
});

test('schema: realtime publishes every household table with FULL replica identity', () => {
  const publication = sql.match(/alter publication supabase_realtime add table([\s\S]*?);/)[1];
  for (const table of HOUSEHOLD_TABLES) {
    assert.match(publication, new RegExp(`public\\.${table}\\b`), `published ${table}`);
    assert.match(sql, new RegExp(`alter table public\\.${table} replica identity full`), `replica identity ${table}`);
  }
});

test('schema: updated_at is maintained by a trigger on every household table', () => {
  assert.deepEqual([...loopFor('touch_updated_at()')].sort(), [...HOUSEHOLD_TABLES].sort(), 'touch loop must list every household table');
  assert.match(sql, /function public\.touch_updated_at/);
});

test('schema: never references the service role', () => {
  assert.doesNotMatch(sql, /service_role/);
});

const allMigrations = readdirSync(fileURLToPath(new URL('../../db/', import.meta.url)))
  .filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(fileURLToPath(new URL(`../../db/${f}`, import.meta.url)), 'utf8')).join('\n');

// A table's columns = its create-table block plus any later "alter table ... add column".
const columnsOf = (table) => tableBlock(table)
  + [...allMigrations.matchAll(new RegExp(`alter table public\\.${table} add column (?:if not exists )?(\\w+)`, 'g'))].map((m) => ` ${m[1]} `).join('')
  + (table === 'loans' ? allMigrations.match(/create table (?:if not exists )?public\.loans \(([\s\S]*?)\n\);/)?.[1] ?? '' : '');

test('schema columns cover every field the validators produce', () => {
  const sample = {
    transactions: validateTransaction({ kind: 'expense', amount_paise: 1, category: 'x', occurred_on: '2026-01-01', bucket: 'needs', note: '' }).value,
    recurring_items: validateRecurring({ name: 'x', amount_paise: 1, frequency: 'yearly', due_month: 1, start_on: '2026-01-01', category: 'x', bucket: 'needs' }).value,
    goals: validateGoal({ name: 'x', target_paise: 1 }).value,
    goal_contributions: validateContribution({ goal_id: 'g', amount_paise: 1, contributed_on: '2026-01-01' }).value,
    loans: validateLoan({ name: 'x', outstanding_paise: 1, rate_pct: 8, emi_paise: 1 }).value,
  };
  for (const [table, row] of Object.entries(sample)) {
    const columns = columnsOf(table);
    for (const column of Object.keys(row)) assert.match(columns, new RegExp(`\\b${column}\\b`), `${table}.${column}`);
  }
  for (const column of ['needs_pct', 'wants_pct', 'savings_pct', 'household_id']) assert.match(tableBlock('budget_settings'), new RegExp(`\\b${column}\\b`));
  for (const column of ['household_id', 'user_id', 'display_name']) assert.match(tableBlock('household_members'), new RegExp(`\\b${column}\\b`));
});
