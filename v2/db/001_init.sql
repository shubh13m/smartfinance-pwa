-- SmartFinance v2 schema. Run once in the Supabase SQL editor.
-- Every table is protected by row-level security: a signed-in user can only
-- touch rows whose household they belong to.

create extension if not exists pgcrypto;

-- ---------- households and membership ----------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique default substr(encode(gen_random_bytes(8), 'hex'), 1, 12),
  created_at timestamptz not null default now()
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.household_members (household_id);

create or replace function public.is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

-- ---------- finance tables ----------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  kind text not null check (kind in ('income', 'expense')),
  occurred_on date not null,
  amount_paise bigint not null check (amount_paise > 0),
  category text not null check (char_length(category) between 1 and 60),
  bucket text check (bucket in ('needs', 'wants', 'savings')),
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'expense') = (bucket is not null))
);
create index on public.transactions (household_id, occurred_on);

create table public.recurring_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  kind text not null check (kind in ('income', 'expense')),
  name text not null check (char_length(name) between 1 and 80),
  amount_paise bigint not null check (amount_paise > 0),
  frequency text not null check (frequency in ('monthly', 'yearly')),
  due_month smallint check (due_month between 1 and 12),
  start_on date not null,
  end_on date,
  category text not null check (char_length(category) between 1 and 60),
  bucket text check (bucket in ('needs', 'wants', 'savings')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((frequency = 'yearly') = (due_month is not null)),
  check ((kind = 'expense') = (bucket is not null)),
  check (end_on is null or end_on >= start_on)
);
create index on public.recurring_items (household_id);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  name text not null check (char_length(name) between 1 and 80),
  target_paise bigint not null check (target_paise > 0),
  deadline date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.goals (household_id);

create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  amount_paise bigint not null check (amount_paise > 0),
  contributed_on date not null,
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.goal_contributions (household_id, goal_id);

create table public.budget_settings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references public.households(id) on delete cascade,
  needs_pct smallint not null default 50 check (needs_pct between 0 and 100),
  wants_pct smallint not null default 30 check (wants_pct between 0 and 100),
  savings_pct smallint not null default 20 check (savings_pct between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (needs_pct + wants_pct + savings_pct = 100)
);

-- A goal contribution must belong to a goal in the same household.
create or replace function public.check_contribution_household()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.goals g where g.id = new.goal_id and g.household_id = new.household_id) then
    raise exception 'goal belongs to a different household';
  end if;
  return new;
end $$;
create trigger goal_contributions_household
  before insert or update on public.goal_contributions
  for each row execute function public.check_contribution_household();

-- ---------- updated_at ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['household_members','transactions','recurring_items','goals','goal_contributions','budget_settings']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- Ownership columns are immutable after insert.
create or replace function public.lock_ownership()
returns trigger language plpgsql as $$
begin
  if new.household_id is distinct from old.household_id or new.created_by is distinct from old.created_by then
    raise exception 'household_id and created_by cannot be changed';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['transactions','recurring_items','goals','goal_contributions']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.lock_ownership()', t || '_lock', t);
  end loop;
end $$;

-- ---------- row-level security ----------
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring_items enable row level security;
alter table public.goals enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.budget_settings enable row level security;

create policy households_read on public.households
  for select using (public.is_household_member(id));

create policy members_read on public.household_members
  for select using (public.is_household_member(household_id));
create policy members_update_self on public.household_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- A member may only rename themselves; they can never move to another household.
revoke update on public.household_members from authenticated, anon;
grant update (display_name) on public.household_members to authenticated;

do $$
declare t text;
begin
  foreach t in array array['transactions','recurring_items','goals','goal_contributions','budget_settings']
  loop
    execute format('create policy %I on public.%I for select using (public.is_household_member(household_id))', t || '_read', t);
    execute format('create policy %I on public.%I for insert with check (public.is_household_member(household_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (public.is_household_member(household_id)) with check (public.is_household_member(household_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (public.is_household_member(household_id))', t || '_delete', t);
  end loop;
end $$;

-- The creator must be the signed-in user (nobody can forge "entered by").
create policy transactions_creator on public.transactions as restrictive
  for insert with check (created_by = auth.uid());
create policy recurring_creator on public.recurring_items as restrictive
  for insert with check (created_by = auth.uid());
create policy goals_creator on public.goals as restrictive
  for insert with check (created_by = auth.uid());
create policy contributions_creator on public.goal_contributions as restrictive
  for insert with check (created_by = auth.uid());

-- ---------- joining a household (the only way to create a membership) ----------
create or replace function public.create_household(household_name text, member_name text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'already in a household';
  end if;
  insert into public.households (name) values (household_name) returning * into h;
  insert into public.household_members (household_id, user_id, display_name)
    values (h.id, auth.uid(), member_name);
  insert into public.budget_settings (household_id) values (h.id);
  return h;
end $$;

create or replace function public.join_household(code text, member_name text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'already in a household';
  end if;
  select * into h from public.households where invite_code = lower(trim(code));
  if not found then raise exception 'invalid invite code'; end if;
  if (select count(*) from public.household_members where household_id = h.id) >= 6 then
    raise exception 'household is full';
  end if;
  insert into public.household_members (household_id, user_id, display_name)
    values (h.id, auth.uid(), member_name);
  return h;
end $$;

revoke all on function public.create_household(text, text) from public, anon;
revoke all on function public.join_household(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;

-- ---------- realtime ----------
-- FULL replica identity lets delete events carry household_id for the realtime filter.
alter table public.household_members replica identity full;
alter table public.transactions replica identity full;
alter table public.recurring_items replica identity full;
alter table public.goals replica identity full;
alter table public.goal_contributions replica identity full;
alter table public.budget_settings replica identity full;
alter publication supabase_realtime add table
  public.household_members, public.transactions, public.recurring_items,
  public.goals, public.goal_contributions, public.budget_settings;
