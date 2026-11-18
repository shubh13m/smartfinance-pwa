import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DB = fileURLToPath(new URL('../../db/', import.meta.url));
const files = readdirSync(DB).filter((f) => f.endsWith('.sql')).sort();
const read = (name) => readFileSync(join(DB, name), 'utf8');
const migration2 = read('002_serialize_household_membership.sql');

const fn = (sql, name) => sql.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?end \\$\\$;`))?.[0] ?? '';

test('migrations are numbered consecutively with no gaps or duplicates', () => {
  const numbers = files.map((f) => Number(f.match(/^(\d{3})_/)?.[1]));
  assert.ok(numbers.every(Number.isInteger), files.join(','));
  assert.deepEqual(numbers, numbers.map((_, i) => i + 1));
});

test('migration 002 redefines both membership RPCs as security definer with a pinned search_path', () => {
  for (const name of ['create_household', 'join_household']) {
    assert.match(fn(migration2, name), /security definer set search_path = public/, name);
  }
});

test('regression: both RPCs take a per-user advisory lock BEFORE checking membership (double-click race)', () => {
  for (const name of ['create_household', 'join_household']) {
    const body = fn(migration2, name);
    const lock = body.indexOf("pg_advisory_xact_lock(hashtextextended('household-user:'");
    const check = body.indexOf('already in a household');
    assert.ok(lock > 0, `${name} takes the user lock`);
    assert.ok(lock < check, `${name} locks before it checks`);
  }
});

test('regression: joining serialises per household BEFORE counting members (size-limit race)', () => {
  const body = fn(migration2, 'join_household');
  const lock = body.indexOf("pg_advisory_xact_lock(hashtextextended('household:'");
  const count = body.indexOf('count(*)');
  assert.ok(lock > 0 && lock < count);
});

test('migration 002 keeps the original behaviour and error messages the app relies on', () => {
  const create = fn(migration2, 'create_household');
  assert.match(create, /insert into public\.budget_settings/);
  assert.match(create, /raise exception 'not signed in'/);
  const join = fn(migration2, 'join_household');
  for (const message of ['invalid invite code', 'household is full', 'already in a household']) assert.match(join + create, new RegExp(message));
  assert.match(join, />= 6/);
});

test('migration 002 keeps anonymous users locked out of the RPCs', () => {
  for (const signature of ['create_household(text, text)', 'join_household(text, text)']) {
    const escaped = signature.replace(/[()]/g, '\\$&');
    assert.match(migration2, new RegExp(`revoke all on function public\\.${escaped} from public, anon`));
    assert.match(migration2, new RegExp(`grant execute on function public\\.${escaped} to authenticated`));
  }
});

test('migration 002 is safe to run on top of 001 and to re-run (create or replace, no table changes)', () => {
  assert.doesNotMatch(migration2, /create table|drop table|alter table/i);
  assert.match(migration2, /create or replace function/);
});

/* ---------- migration 003: removing people ---------- */

const m3 = read('003_member_removal.sql');
const body = (sql, name) => fn(sql, name);

test('003: former members are kept as history (left_at) and only one ACTIVE membership per user is allowed', () => {
  assert.match(m3, /add column if not exists left_at timestamptz/);
  assert.match(m3, /drop constraint if exists household_members_user_id_key/);
  assert.match(m3, /create unique index if not exists household_members_one_active_per_user[\s\S]*where left_at is null/);
});

test('003: access is cut at the single membership helper that every policy uses', () => {
  const helper = body(m3, 'is_household_member');
  assert.match(helper, /left_at is null/);
  assert.match(helper, /security definer set search_path = public/);
  assert.match(helper, /user_id = auth\.uid\(\)/);
});

test('003: a former member can no longer edit their old row', () => {
  assert.match(m3, /create policy members_update_self[\s\S]*left_at is null/);
});

test('003: every membership function is security definer with a pinned search_path', () => {
  for (const name of ['create_household', 'join_household', 'remove_member', 'leave_household', 'rotate_invite_code']) {
    assert.match(body(m3, name), /security definer set search_path = public/, name);
  }
});

test('003: create and join only look at ACTIVE memberships and keep the locking from 002', () => {
  for (const name of ['create_household', 'join_household']) {
    const f = body(m3, name);
    assert.match(f, /where user_id = auth\.uid\(\) and left_at is null/, name);
    assert.ok(f.indexOf('pg_advisory_xact_lock') < f.indexOf('already in a household'), `${name} locks first`);
  }
  assert.match(body(m3, 'join_household'), /household_id = h\.id and left_at is null\) >= 6/, 'size limit counts active members only');
});

test('003: removing someone checks the caller and target, forbids self-removal, and replaces the invite code', () => {
  const f = body(m3, 'remove_member');
  assert.match(f, /raise exception 'not signed in'/);
  assert.match(f, /where user_id = auth\.uid\(\) and left_at is null/, 'caller must be an active member');
  assert.match(f, /target_user = auth\.uid\(\) then raise exception 'use leave_household/);
  assert.match(f, /user_id = target_user and left_at is null[\s\S]*raise exception 'that person is not in your household'/);
  assert.match(f, /set left_at = now\(\)/);
  assert.match(f, /update public\.households set invite_code = substr\(replace\(gen_random_uuid\(\)::text, '-', ''\), 1, 12\)/);
  assert.doesNotMatch(f, /delete from/i, 'history is kept, never deleted');
});

test('003: the removal target must be in the CALLER\'s household (cannot remove people from other households)', () => {
  const f = body(m3, 'remove_member');
  assert.match(f, /household_id = hid and user_id = target_user/);
});

test('003: the last member can never leave', () => {
  const f = body(m3, 'leave_household');
  assert.match(f, /count\(\*\) from public\.household_members where household_id = hid and left_at is null\) <= 1 then\s+raise exception 'you are the only member'/);
});

test('003: removal and leaving serialise per household so two people cannot remove each other at once', () => {
  for (const name of ['remove_member', 'leave_household']) {
    assert.match(body(m3, name), /pg_advisory_xact_lock\(hashtextextended\('household:'/, name);
  }
});

test('003: new RPCs are not callable by anonymous users', () => {
  for (const signature of ['remove_member(uuid)', 'leave_household()', 'rotate_invite_code()']) {
    const escaped = signature.replace(/[()]/g, '\\$&');
    assert.match(m3, new RegExp(`revoke all on function public\\.${escaped} from public, anon`), signature);
    assert.match(m3, new RegExp(`grant execute on function public\\.${escaped} to authenticated`), signature);
  }
});

test('003: never drops data tables or rows', () => {
  assert.doesNotMatch(m3, /drop table|truncate|delete from/i);
});

/* ---------- migration 004: loans and the emergency flag ---------- */

const m4 = read('004_loans_and_emergency.sql');

test('004: loans are protected exactly like the other household tables', () => {
  assert.match(m4, /alter table public\.loans enable row level security/);
  for (const verb of ['select', 'insert', 'update', 'delete']) {
    assert.match(m4, new RegExp(`create policy loans_\\w+ on public\\.loans\\s+for ${verb}`), verb);
  }
  assert.equal([...m4.matchAll(/public\.is_household_member\(household_id\)/g)].length >= 5, true);
  assert.doesNotMatch(m4, /using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
  assert.match(m4, /create policy loans_creator on public\.loans as restrictive\s+for insert with check \(created_by = auth\.uid\(\)\)/);
});

test('004: loan values are constrained in the database too', () => {
  assert.match(m4, /outstanding_paise bigint not null check \(outstanding_paise >= 0\)/);
  assert.match(m4, /emi_paise bigint not null check \(emi_paise > 0\)/);
  assert.match(m4, /rate_pct numeric\(5, 2\) not null check \(rate_pct >= 0 and rate_pct <= 60\)/);
  assert.match(m4, /household_id uuid not null references public\.households\(id\) on delete cascade/);
});

test('004: ownership is immutable and updated_at is maintained for loans', () => {
  assert.match(m4, /create trigger loans_lock before update on public\.loans[\s\S]*lock_ownership/);
  assert.match(m4, /create trigger loans_touch before update on public\.loans[\s\S]*touch_updated_at/);
});

test('004: loans are published to realtime with FULL replica identity (checked first, so re-running cannot fail)', () => {
  assert.match(m4, /alter table public\.loans replica identity full/);
  assert.match(m4, /alter publication supabase_realtime add table public\.loans/);
  assert.match(m4, /if not exists \(\s*select 1 from pg_publication_tables[\s\S]*tablename = 'loans'/);
});

test('004: at most one emergency-fund goal per household is enforced by the database', () => {
  assert.match(m4, /add column if not exists is_emergency boolean not null default false/);
  assert.match(m4, /create unique index if not exists goals_one_emergency_per_household\s+on public\.goals \(household_id\) where is_emergency/);
});

/* ---------- re-running a migration must never error (regression: "relation loans already exists") ---------- */

// Statements that fail the second time they are run, unless guarded.
const UNGUARDED = [
  [/create table (?!if not exists)/i, 'create table needs "if not exists"'],
  [/create (unique )?index (?!if not exists)/i, 'create index needs "if not exists"'],
  [/add column (?!if not exists)/i, 'add column needs "if not exists"'],
];

test('migrations 002-004 are re-runnable: every create/add is guarded or replaced', () => {
  for (const name of files.filter((f) => !f.startsWith('001_'))) {
    const sql = read(name).replace(/--.*$/gm, '');
    for (const [pattern, message] of UNGUARDED) assert.doesNotMatch(sql, pattern, `${name}: ${message}`);
  }
});

test('migrations 002-004: every policy and trigger is dropped before it is created', () => {
  for (const name of files.filter((f) => !f.startsWith('001_'))) {
    const sql = read(name).replace(/--.*$/gm, '');
    for (const m of sql.matchAll(/create policy (\w+) on (public\.\w+)/g)) {
      assert.match(sql, new RegExp(`drop policy if exists ${m[1]} on ${m[2].replace('.', '\\.')}`), `${name}: policy ${m[1]}`);
    }
    for (const m of sql.matchAll(/create trigger (\w+)\s+before update on (public\.\w+)/g)) {
      assert.match(sql, new RegExp(`drop trigger if exists ${m[1]} on ${m[2].replace('.', '\\.')}`), `${name}: trigger ${m[1]}`);
    }
  }
});

test('migrations 002-004: publishing a table to realtime is guarded against "already member"', () => {
  for (const name of files.filter((f) => !f.startsWith('001_'))) {
    const sql = read(name).replace(/--.*$/gm, '');
    if (/alter publication supabase_realtime add table/.test(sql)) {
      assert.match(sql, /select 1 from pg_publication_tables/, name);
    }
  }
});

test('migrations 002-004: every function is create-or-replace', () => {
  for (const name of files.filter((f) => !f.startsWith('001_'))) {
    const sql = read(name).replace(/--.*$/gm, '');
    assert.doesNotMatch(sql, /create function/i, name);
  }
});

/* ---------- migration 005 + extension-function regression ---------- */

// Every `create or replace function` block in migrations 002+ (001 has the original column default).
function functionBlocks() {
  return files.filter((f) => !f.startsWith('001_')).flatMap((name) =>
    [...read(name).matchAll(/create or replace function public\.(\w+)[\s\S]*?\$\$;?[\s\S]*?end \$\$;|create or replace function public\.(\w+)[\s\S]*?as \$\$[\s\S]*?\$\$;/g)]
      .map((m) => ({ file: name, name: m[1] || m[2], sql: m[0] })));
}

test('regression: no function pinned to search_path = public calls an extension function (gen_random_bytes, crypt, digest…)', () => {
  // pgcrypto lives in the "extensions" schema on Supabase, so these calls fail with
  // "function … does not exist" when the function's search_path is only "public".
  const EXTENSION_CALLS = /\b(gen_random_bytes|gen_salt|crypt|digest|hmac|pgp_sym_encrypt|uuid_generate_v[1-5])\s*\(/;
  const blocks = functionBlocks().filter((b) => /set search_path = public/.test(b.sql));
  assert.ok(blocks.length >= 6, `found ${blocks.length} pinned functions`);
  for (const b of blocks) assert.doesNotMatch(b.sql, EXTENSION_CALLS, `${b.file}: ${b.name} uses an extension function`);
});

const m5 = read('005_fix_invite_code_generation.sql');

test('005: both functions that make a new invite code use the built-in generator', () => {
  for (const name of ['remove_member', 'rotate_invite_code']) {
    const f = fn(m5, name);
    assert.match(f, /substr\(replace\(gen_random_uuid\(\)::text, '-', ''\), 1, 12\)/, name);
    assert.match(f, /security definer set search_path = public/, name);
    assert.doesNotMatch(f, /gen_random_bytes/, name);
  }
});

test('005: the invite code keeps its shape (12 hex characters), so existing codes and the app are unaffected', () => {
  // gen_random_uuid() text minus dashes is 32 hex chars; the first 12 are all random (the version nibble is the 13th).
  const sample = '3f2b9c1e-7a4d-4e8b-9c5a-1d2e3f4a5b6c'.replace(/-/g, '').slice(0, 12);
  assert.match(sample, /^[0-9a-f]{12}$/);
  assert.equal(sample.length, 12);
});

test('005: behaviour and error messages are unchanged from 003', () => {
  const remove = fn(m5, 'remove_member');
  for (const message of ['not signed in', 'not in a household', 'use leave_household to remove yourself', 'that person is not in your household']) {
    assert.match(remove, new RegExp(message), message);
  }
  assert.match(remove, /pg_advisory_xact_lock\(hashtextextended\('household:'/);
  assert.match(remove, /set left_at = now\(\)/);
  assert.doesNotMatch(remove, /delete from/i);
  assert.match(fn(m5, 'rotate_invite_code'), /returning invite_code into new_code/);
});

test('005: stays locked to signed-in users', () => {
  for (const signature of ['remove_member(uuid)', 'rotate_invite_code()']) {
    const escaped = signature.replace(/[()]/g, '\\$&');
    assert.match(m5, new RegExp(`revoke all on function public\\.${escaped} from public, anon`), signature);
    assert.match(m5, new RegExp(`grant execute on function public\\.${escaped} to authenticated`), signature);
  }
});

test('migrations never mention the service role and never grant anything to anon', () => {
  for (const name of files) {
    const sql = read(name);
    assert.doesNotMatch(sql, /service_role/, name);
    assert.doesNotMatch(sql, /grant [^;]* to anon/i, name);
  }
});
