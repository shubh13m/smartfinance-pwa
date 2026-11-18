-- Migration 005: fix "function gen_random_bytes(integer) does not exist" when removing a person
-- or creating a new invite code.
-- Run AFTER 001-004 in the Supabase SQL editor. Safe to run more than once.
--
-- Cause: these functions are pinned to `search_path = public` (a security measure), but
-- gen_random_bytes comes from the pgcrypto extension, which Supabase installs in the
-- `extensions` schema, so the function could not find it. gen_random_uuid() is built into
-- Postgres and is always found. The invite code keeps the same shape: 12 hex characters.

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
  update public.households set invite_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
    where id = hid;
end $$;

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

revoke all on function public.remove_member(uuid) from public, anon;
revoke all on function public.rotate_invite_code() from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.rotate_invite_code() to authenticated;
