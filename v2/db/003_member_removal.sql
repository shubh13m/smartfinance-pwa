-- Migration 003: removing a person from a household.
-- Run AFTER 001 and 002, once, in the Supabase SQL editor. Safe to re-run.
--
-- A removed person keeps their row (left_at is set) so the entries they made stay attributed to a
-- name ("Former member"), but they immediately lose access to everything in the household.
-- The invite code is replaced on removal so they cannot simply rejoin with the old one.
-- The last remaining member can never be removed and can never leave (the data would be orphaned).

alter table public.household_members add column if not exists left_at timestamptz;

-- "One household per person" now means one ACTIVE household; old memberships are kept as history.
alter table public.household_members drop constraint if exists household_members_user_id_key;
create unique index if not exists household_members_one_active_per_user
  on public.household_members (user_id) where left_at is null;

-- Everything is scoped by this helper, so cutting access here cuts it everywhere.
create or replace function public.is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid() and left_at is null
  );
$$;

-- A former member can no longer edit their old row.
drop policy if exists members_update_self on public.household_members;
create policy members_update_self on public.household_members
  for update using (user_id = auth.uid() and left_at is null)
  with check (user_id = auth.uid() and left_at is null);

-- create/join now only consider ACTIVE memberships (and keep 002's locking).
create or replace function public.create_household(household_name text, member_name text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  perform pg_advisory_xact_lock(hashtextextended('household-user:' || auth.uid()::text, 0));
  if exists (select 1 from public.household_members where user_id = auth.uid() and left_at is null) then
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
  if exists (select 1 from public.household_members where user_id = auth.uid() and left_at is null) then
    raise exception 'already in a household';
  end if;
  select * into h from public.households where invite_code = lower(trim(code));
  if not found then raise exception 'invalid invite code'; end if;
  perform pg_advisory_xact_lock(hashtextextended('household:' || h.id::text, 0));
  if (select count(*) from public.household_members where household_id = h.id and left_at is null) >= 6 then
    raise exception 'household is full';
  end if;
  insert into public.household_members (household_id, user_id, display_name)
    values (h.id, auth.uid(), member_name);
  return h;
end $$;

-- Remove someone else. Any active member may do this.
create or replace function public.remove_member(target_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select household_id into hid from public.household_members
    where user_id = auth.uid() and left_at is null;
  if hid is null then raise exception 'not in a household'; end if;
  perform pg_advisory_xact_lock(hashtextextended('household:' || hid::text, 0));
  if target_user = auth.uid() then raise exception 'use leave_household to remove yourself'; end if;
  if not exists (
    select 1 from public.household_members
    where household_id = hid and user_id = target_user and left_at is null
  ) then
    raise exception 'that person is not in your household';
  end if;
  update public.household_members set left_at = now()
    where household_id = hid and user_id = target_user and left_at is null;
  -- Invalidate the old invite code so the removed person cannot rejoin with it.
  -- (gen_random_uuid is built in; pgcrypto's gen_random_bytes is not on this function's search_path.)
  update public.households set invite_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
    where id = hid;
end $$;

-- Leave on your own. Not allowed for the last remaining member.
create or replace function public.leave_household()
returns void language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select household_id into hid from public.household_members
    where user_id = auth.uid() and left_at is null;
  if hid is null then raise exception 'not in a household'; end if;
  perform pg_advisory_xact_lock(hashtextextended('household:' || hid::text, 0));
  if (select count(*) from public.household_members where household_id = hid and left_at is null) <= 1 then
    raise exception 'you are the only member';
  end if;
  update public.household_members set left_at = now()
    where user_id = auth.uid() and household_id = hid and left_at is null;
end $$;

-- Replace the invite code on demand (for example if it was shared by mistake).
create or replace function public.rotate_invite_code()
returns text language plpgsql security definer set search_path = public as $$
declare hid uuid; new_code text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select household_id into hid from public.household_members
    where user_id = auth.uid() and left_at is null;
  if hid is null then raise exception 'not in a household'; end if;
  update public.households set invite_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
    where id = hid returning invite_code into new_code;
  return new_code;
end $$;

revoke all on function public.create_household(text, text) from public, anon;
revoke all on function public.join_household(text, text) from public, anon;
revoke all on function public.remove_member(uuid) from public, anon;
revoke all on function public.leave_household() from public, anon;
revoke all on function public.rotate_invite_code() from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.leave_household() to authenticated;
grant execute on function public.rotate_invite_code() to authenticated;
