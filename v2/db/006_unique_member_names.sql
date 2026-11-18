-- Migration 006: names inside a household.
-- Run AFTER 001-005 in the Supabase SQL editor. Safe to run more than once.
--
-- People are identified by their ACCOUNT, never by their name. The name is only a label, but
-- two people with the same label in one household would be confusing ("Priya" vs "priya"), so:
--   * names are trimmed;
--   * a name must not be blank;
--   * no two ACTIVE members of a household may share a name, ignoring capitals.
-- Someone who left and rejoins is the same account, so their old name is not "taken" by themselves.

create or replace function public.create_household(household_name text, member_name text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h public.households; clean_name text := btrim(member_name);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if clean_name is null or clean_name = '' then raise exception 'enter your name'; end if;
  perform pg_advisory_xact_lock(hashtextextended('household-user:' || auth.uid()::text, 0));
  if exists (select 1 from public.household_members where user_id = auth.uid() and left_at is null) then
    raise exception 'already in a household';
  end if;
  insert into public.households (name) values (btrim(household_name)) returning * into h;
  insert into public.household_members (household_id, user_id, display_name)
    values (h.id, auth.uid(), clean_name);
  insert into public.budget_settings (household_id) values (h.id);
  return h;
end $$;

create or replace function public.join_household(code text, member_name text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h public.households; clean_name text := btrim(member_name);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if clean_name is null or clean_name = '' then raise exception 'enter your name'; end if;
  perform pg_advisory_xact_lock(hashtextextended('household-user:' || auth.uid()::text, 0));
  if exists (select 1 from public.household_members where user_id = auth.uid() and left_at is null) then
    raise exception 'already in a household';
  end if;
  select * into h from public.households where invite_code = lower(btrim(code));
  if not found then raise exception 'invalid invite code'; end if;
  perform pg_advisory_xact_lock(hashtextextended('household:' || h.id::text, 0));
  if (select count(*) from public.household_members where household_id = h.id and left_at is null) >= 6 then
    raise exception 'household is full';
  end if;
  if exists (
    select 1 from public.household_members
    where household_id = h.id and left_at is null and lower(display_name) = lower(clean_name)
  ) then
    raise exception 'that name is already used in this household';
  end if;
  insert into public.household_members (household_id, user_id, display_name)
    values (h.id, auth.uid(), clean_name);
  return h;
end $$;

revoke all on function public.create_household(text, text) from public, anon;
revoke all on function public.join_household(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;

-- Backstop for anything that bypasses the functions (for example renaming yourself).
-- Skipped, with a notice, if a household already has two active members with the same name.
do $$
begin
  if exists (
    select 1 from public.household_members where left_at is null
    group by household_id, lower(display_name) having count(*) > 1
  ) then
    raise notice 'Skipped the unique-name index: a household already has two active members with the same name. Rename one, then run this file again.';
  else
    create unique index if not exists household_members_unique_active_name
      on public.household_members (household_id, lower(display_name)) where left_at is null;
  end if;
end $$;
