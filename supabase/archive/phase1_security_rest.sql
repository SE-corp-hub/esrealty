-- Phase 1 security, items 3 to 13 (2026-10-17)
--
-- Run in the Supabase SQL editor. Safe to run more than once, and safe to run
-- before or after the PMS files. Nothing is deleted: every table, bucket and
-- function stays (owner's decision).
--
-- What it closes (found in the live schema snapshot of 2026-10-16):
--   3. compliance_records: anyone, even a visitor who is not signed in, could
--      add rows (the write rule's check was "true").
--   4. password_resets: anyone could add fake reset requests directly. The app
--      uses admin_request_password_reset(), which keeps working.
--   5. An approved broker could change their own PRC/RESA numbers after
--      approval; any signed-in user could write audit rows about themselves.
--   6. The old admin_create_account() database function was still callable by
--      visitors (it refused them inside, but should not be reachable at all).
--      Accounts are made by the admin-create-account edge function.
--   7. listing-photos: any signed-in account (even a pending buyer) could
--      upload into the public photo bucket.
--   8. compliance_schedule_renewals() could be run by visitors.
--  13. Visitors had insert/update/delete rights on every table, and signed-in
--      users had TRUNCATE. Row rules stopped them through the API, but the
--      rights themselves are removed now as a second wall.

-- 3. compliance_records: only approved users, only their own rows (or the chain
--    that could already read and change them) ---------------------------------
drop policy if exists "compliance_write_own_chain" on public.compliance_records;
drop policy if exists "compliance insert own" on public.compliance_records;
drop policy if exists "compliance change own chain" on public.compliance_records;
drop policy if exists "compliance delete own chain" on public.compliance_records;

create policy "compliance insert own" on public.compliance_records
  for insert to authenticated
  with check (
    owner = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.registration_status = 'approved')
  );

create policy "compliance change own chain" on public.compliance_records
  for update to authenticated
  using ((auth.uid() = owner) or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.registration_status = 'approved'
      and ((p.role = any (array['super-admin'::app_role, 'broker'::app_role]))
           or public.address_book_profile_accessible(coalesce((compliance_records.owner)::text, ''), p.id))))
  with check ((auth.uid() = owner) or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.registration_status = 'approved'
      and ((p.role = any (array['super-admin'::app_role, 'broker'::app_role]))
           or public.address_book_profile_accessible(coalesce((compliance_records.owner)::text, ''), p.id))));

create policy "compliance delete own chain" on public.compliance_records
  for delete to authenticated
  using ((auth.uid() = owner) or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.registration_status = 'approved'
      and ((p.role = any (array['super-admin'::app_role, 'broker'::app_role]))
           or public.address_book_profile_accessible(coalesce((compliance_records.owner)::text, ''), p.id))));

-- 4. password_resets: requests only through admin_request_password_reset() ------
drop policy if exists "password_resets insert pending" on public.password_resets;

-- 5a. Verified PRC/RESA numbers: an approved account can't change them itself --
create or replace function public.profiles_protect_licence()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.prc is distinct from old.prc or new.resa is distinct from old.resa)
     and old.registration_status = 'approved'
     and auth.uid() is not null            -- the service role and SQL editor have no user
     and not public.is_super_admin() then
    raise exception 'Your PRC and RESA numbers have been verified. Ask a super-admin to change them.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.profiles_protect_licence() from public, anon, authenticated;
drop trigger if exists profiles_protect_licence on public.profiles;
create trigger profiles_protect_licence before update of prc, resa on public.profiles
  for each row execute function public.profiles_protect_licence();

-- 5b. Audit rows are written by the server only (security-definer functions and
--     edge functions); users keep reading their own.
drop policy if exists "audit owner insert" on public.audit_events;

-- 6. The old database function for making accounts ------------------------------
do $$
begin
  if to_regprocedure('public.admin_create_account(text, text, text, public.app_role, text, text, text, uuid)') is not null then
    revoke all on function public.admin_create_account(text, text, text, public.app_role, text, text, text, uuid) from public, anon, authenticated;
  end if;
end $$;

-- 7. listing-photos: uploads only by approved publishers (and super-admins) -----
drop policy if exists "listing photos insert own folder" on storage.objects;
create policy "listing photos insert own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and (auth.uid())::text = (storage.foldername(name))[1]
    and (public.listing_current_user_can_publish() or public.is_super_admin())
  );
drop policy if exists "listing photos update own folder" on storage.objects;
create policy "listing photos update own folder" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'listing-photos'
    and (auth.uid())::text = (storage.foldername(name))[1]
    and (public.listing_current_user_can_publish() or public.is_super_admin())
  );

-- 8. Compliance renewals: approved super-admins and brokers only ------------------
do $$
declare def text;
begin
  if to_regprocedure('public.compliance_schedule_renewals(integer)') is null then return; end if;
  revoke all on function public.compliance_schedule_renewals(integer) from public, anon;
  grant execute on function public.compliance_schedule_renewals(integer) to authenticated;
end $$;

create or replace function public.compliance_can_schedule()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.registration_status = 'approved'
                   and p.role::text in ('super-admin', 'broker'));
$$;
revoke all on function public.compliance_can_schedule() from public, anon;
grant execute on function public.compliance_can_schedule() to authenticated;

-- The renewal function itself refuses anyone else (added as a guard in front of
-- the existing body, which is otherwise unchanged).
create or replace function public.compliance_schedule_renewals(p_window_days integer default 60)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  r record;
begin
  if not public.compliance_can_schedule() then
    raise exception 'Only approved brokers and super-admins can schedule renewals' using errcode = '42501';
  end if;
  if to_regclass('public.agent_tasks') is null then
    return 0;
  end if;
  for r in
    select c.* from public.compliance_records c
    where c.status <> 'revoked'
      and c.expires_at is not null
      and c.expires_at between current_date and current_date + (p_window_days || ' days')::interval
      and not exists (
        select 1 from public.agent_tasks t
        where t.kind = 'compliance'
          and t.payload ->> 'record_id' = c.id
          and t.state in ('due', 'working')
      )
  loop
    insert into public.agent_tasks (lead_id, kind, reason, payload, task_meta, due_at, state)
    values (
      '',
      'compliance',
      format('Compliance record expiring: %s (%s) — %s', r.name, r.number, r.expires_at),
      jsonb_build_object('record_id', r.id, 'type', r.type, 'name', r.name, 'expires_at', r.expires_at),
      jsonb_build_object('compliance', true, 'record', r.name, 'expires_at', r.expires_at),
      case when r.expires_at <= current_date then now() else (r.expires_at || 'T00:00:00')::timestamptz end,
      'due'
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.compliance_schedule_renewals(integer) from public, anon;
grant execute on function public.compliance_schedule_renewals(integer) to authenticated;

-- 13. Table rights: visitors read only; nobody truncates through the API ---------
-- Every visitor-facing write goes through an edge function or a security-definer
-- function, which these rights don't affect. Row rules stay the first wall.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

-- Check: each line should read 0.
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'password_resets' and cmd = 'INSERT') as reset_insert_rules,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'audit_events' and cmd = 'INSERT') as audit_insert_rules,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'compliance_records' and with_check = 'true') as open_compliance_rules,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')) as visitor_write_rights,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'TRUNCATE') as truncate_rights;
