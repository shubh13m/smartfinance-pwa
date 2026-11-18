-- Migration 002: make creating/joining a household safe against simultaneous requests.
-- Run AFTER 001_init.sql, once, in the Supabase SQL editor. Safe to run again (create or replace).
--
-- Problem: two requests from the same user at the same instant (a double-click) both passed the
-- "already in a household?" check before either had saved, so the second one failed with a
-- confusing "duplicate key value violates unique constraint" error. Likewise two people joining a
-- full household at once could both slip past the size limit.
-- Fix: take a transaction-scoped advisory lock so concurrent calls run one after another. The
-- second call then sees the first one's result and reports the clear "already in a household".

create or replace function public.create_household(household_name text, member_name text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  perform pg_advisory_xact_lock(hashtextextended('household-user:' || auth.uid()::text, 0));
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
  perform pg_advisory_xact_lock(hashtextextended('household-user:' || auth.uid()::text, 0));
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'already in a household';
  end if;
  select * into h from public.households where invite_code = lower(trim(code));
  if not found then raise exception 'invalid invite code'; end if;
  -- Serialise everyone joining this household so the size limit cannot be exceeded by a race.
  perform pg_advisory_xact_lock(hashtextextended('household:' || h.id::text, 0));
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
