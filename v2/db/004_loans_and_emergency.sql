-- Migration 004: loans (for the EMI prepayment planner) and the emergency-fund flag on goals.
-- Run AFTER 001-003 in the Supabase SQL editor. Safe to run more than once: every statement
-- either checks first or replaces what is there, so a second run changes nothing and never errors.

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  name text not null check (char_length(name) between 1 and 80),
  outstanding_paise bigint not null check (outstanding_paise >= 0),
  rate_pct numeric(5, 2) not null check (rate_pct >= 0 and rate_pct <= 60),
  emi_paise bigint not null check (emi_paise > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loans_household_id_idx on public.loans (household_id);

alter table public.loans enable row level security;

drop policy if exists loans_read on public.loans;
create policy loans_read on public.loans
  for select using (public.is_household_member(household_id));
drop policy if exists loans_insert on public.loans;
create policy loans_insert on public.loans
  for insert with check (public.is_household_member(household_id));
drop policy if exists loans_update on public.loans;
create policy loans_update on public.loans
  for update using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
drop policy if exists loans_delete on public.loans;
create policy loans_delete on public.loans
  for delete using (public.is_household_member(household_id));
drop policy if exists loans_creator on public.loans;
create policy loans_creator on public.loans as restrictive
  for insert with check (created_by = auth.uid());

drop trigger if exists loans_touch on public.loans;
create trigger loans_touch before update on public.loans
  for each row execute function public.touch_updated_at();
drop trigger if exists loans_lock on public.loans;
create trigger loans_lock before update on public.loans
  for each row execute function public.lock_ownership();

alter table public.loans replica identity full;

-- "add table" fails if the table is already published, so check first.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'loans'
  ) then
    alter publication supabase_realtime add table public.loans;
  end if;
end $$;

-- One goal per household can be marked as the emergency fund.
alter table public.goals add column if not exists is_emergency boolean not null default false;
create unique index if not exists goals_one_emergency_per_household
  on public.goals (household_id) where is_emergency;
