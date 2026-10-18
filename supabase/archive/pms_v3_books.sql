-- PMS books: brokers and super-admins each manage their own records (2026-10-17)
--
-- Run AFTER supabase/archive/pms_v2_tables.sql and supabase/archive/pms_v2_receipts.sql, in the
-- Supabase SQL editor. Safe to run more than once.
--
-- Decided by the owner (claude/pms-broker-books-2026-10-17.md):
--   - Every PMS record belongs to one book.
--   - The company book holds the super-admins' records; all super-admins share
--     it, and every record that exists today goes there.
--   - Each approved broker has a book of their own. Only that broker can see
--     or change it.
--   - Super-admins can look at any broker's book (read only) for support.
--   - Agents, buyers and sellers have no PMS. Owners and tenants keep their
--     read-only portals, across whichever books list them.
--   - Brokers can make owner and tenant logins (the admin-create-account
--     function); they work straight away.
--
-- What this script does:
--   1. adds book_id to the nine PMS tables (existing rows -> company book)
--   2. pms_my_book() / pms_can_manage(): who manages which book
--   3. row rules: managers do everything in their own book; super-admins read
--      every book; owner and tenant read rules are unchanged
--   4. a check that refuses links between books and moving rows between books
--   5. receipt photo rules per book
--   6. lookups for brokers: login status of their own people, and "is there an
--      owner/tenant login with this email" (logged)
--   7. for super-admins: the list of books, and moving a whole book
--   8. Users & Access shows which broker added a login

-- 1. book_id ------------------------------------------------------------------
create or replace function public.pms_company_book()
returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;

-- The book the caller manages: the company book for an approved super-admin,
-- their own id for an approved broker, nothing for anyone else.
create or replace function public.pms_my_book()
returns uuid language sql stable security definer set search_path = public as $$
  select case p.role::text
           when 'super-admin' then public.pms_company_book()
           when 'broker' then p.id
         end
  from public.profiles p
  where p.id = auth.uid() and p.registration_status = 'approved';
$$;

create or replace function public.pms_can_manage(b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select b is not null and b = public.pms_my_book();
$$;

revoke all on function public.pms_company_book() from public, anon;
revoke all on function public.pms_my_book() from public, anon;
revoke all on function public.pms_can_manage(uuid) from public, anon;
grant execute on function public.pms_company_book(), public.pms_my_book(), public.pms_can_manage(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['pms_owners','pms_tenants','pms_properties','pms_units','pms_leases','pms_payments','pms_maintenance','pms_expenses','pms_documents'] loop
    execute format('alter table public.%I add column if not exists book_id uuid', t);
    execute format('update public.%I set book_id = public.pms_company_book() where book_id is null', t);
    -- An app that does not send book_id yet saves into the caller's own book.
    execute format('alter table public.%I alter column book_id set default public.pms_my_book()', t);
    execute format('alter table public.%I alter column book_id set not null', t);
    execute format('create index if not exists %I on public.%I (book_id)', t || '_book_idx', t);
  end loop;
end $$;

-- 2/3. Row rules ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pms_owners','pms_tenants','pms_properties','pms_units','pms_leases','pms_payments','pms_maintenance','pms_expenses','pms_documents'] loop
    execute format('drop policy if exists %I on public.%I', t || ' staff all', t);
    execute format('drop policy if exists %I on public.%I', t || ' manager all', t);
    execute format('create policy %I on public.%I for all using (public.pms_can_manage(book_id)) with check (public.pms_can_manage(book_id))', t || ' manager all', t);
    execute format('drop policy if exists %I on public.%I', t || ' super-admin read', t);
    execute format('create policy %I on public.%I for select using (public.is_super_admin())', t || ' super-admin read', t);
  end loop;
end $$;

-- 4. Same-book check -------------------------------------------------------------
-- A record may only point at records in its own book, and never changes book
-- except through pms_transfer_book below.
create or replace function public.pms_same_book()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  j jsonb := to_jsonb(new);
  links text[] := array['owner_id:pms_owners', 'property_id:pms_properties', 'unit_id:pms_units', 'tenant_id:pms_tenants', 'lease_id:pms_leases'];
  l text; col text; tbl text; v text; b uuid;
begin
  if coalesce(current_setting('pms.transfer', true), '') = 'on' then return new; end if;
  if tg_op = 'UPDATE' and new.book_id is distinct from old.book_id then
    raise exception 'A PMS record cannot move to another book' using errcode = '42501';
  end if;
  foreach l in array links loop
    col := split_part(l, ':', 1); tbl := split_part(l, ':', 2);
    v := j ->> col;
    if v is not null and v <> '' then
      execute format('select book_id from public.%I where id = $1', tbl) into b using v;
      if b is not null and b <> new.book_id then
        raise exception 'PMS records from different books cannot be linked (%.%)', tg_table_name, col using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.pms_same_book() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['pms_owners','pms_tenants','pms_properties','pms_units','pms_leases','pms_payments','pms_maintenance','pms_expenses','pms_documents'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_same_book', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.pms_same_book()', t || '_same_book', t);
  end loop;
end $$;

-- 5. Receipt photos per book ----------------------------------------------------
-- Files are saved at <book id>/<payment id>/<file>. Photos moved before this
-- script sit at payments/<payment id>/<file> and belong to the company book.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pms-receipts', 'pms-receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pms receipts staff all" on storage.objects;
drop policy if exists "pms receipts manager write" on storage.objects;
create policy "pms receipts manager write" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'pms-receipts' and (
      (storage.foldername(name))[1] = public.pms_my_book()::text
      or ((storage.foldername(name))[1] = 'payments' and public.pms_my_book() = public.pms_company_book())
      or exists (select 1 from public.pms_payments p
                 where p.id = (storage.foldername(name))[2] and public.pms_can_manage(p.book_id))
    ))
  with check (
    bucket_id = 'pms-receipts' and (
      (storage.foldername(name))[1] = public.pms_my_book()::text
      or ((storage.foldername(name))[1] = 'payments' and public.pms_my_book() = public.pms_company_book())
      or exists (select 1 from public.pms_payments p
                 where p.id = (storage.foldername(name))[2] and public.pms_can_manage(p.book_id))
    ));

-- Reading: whoever can read the payment (its book's manager, a super-admin, or
-- that payment's owner and tenant).
drop policy if exists "pms receipts linked read" on storage.objects;
create policy "pms receipts linked read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pms-receipts'
    and exists (
      select 1 from public.pms_payments p
      where p.id = (storage.foldername(name))[2]
        and not p.archived
    )
  );

-- 6. Lookups for managers -------------------------------------------------------
-- Login status of the owners and tenants linked in the caller's own book
-- (brokers cannot use the super-admin user list).
create or replace function public.pms_login_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'role', p.role::text, 'status', p.registration_status)), '[]'::jsonb)
  from public.profiles p
  where public.pms_my_book() is not null
    and p.id in (
      select o.auth_user_id from public.pms_owners o where o.book_id = public.pms_my_book() and o.auth_user_id is not null
      union
      select t.auth_user_id from public.pms_tenants t where t.book_id = public.pms_my_book() and t.auth_user_id is not null);
$$;

-- "Is there an owner (or tenant) login with this email?" Answers only managers,
-- only for owner and tenant logins, and logs every question.
create or replace function public.pms_find_login(p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare r record;
begin
  if public.pms_my_book() is null then
    raise exception 'Only brokers and super-admins can link logins' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'tenant') then
    raise exception 'Only owner and tenant logins can be linked' using errcode = '22023';
  end if;
  select p.id, p.role::text as role, p.registration_status as status into r
  from public.profiles p join auth.users u on u.id = p.id
  where lower(u.email) = lower(trim(p_email))
  limit 1;
  insert into public.audit_events (owner_id, event_type, entity_type, entity_id, detail)
  values (auth.uid(), 'pms_find_login', 'profile', coalesce(r.id::text, ''), jsonb_build_object('role', p_role, 'found', r.id is not null));
  if r.id is null then return null; end if;
  if r.role <> p_role then return jsonb_build_object('other_role', true); end if;
  return jsonb_build_object('id', r.id, 'status', r.status);
end $$;

revoke all on function public.pms_login_status() from public, anon;
revoke all on function public.pms_find_login(text, text) from public, anon;
grant execute on function public.pms_login_status(), public.pms_find_login(text, text) to authenticated;

-- 7. For super-admins: the books, and moving a whole book ------------------------
create or replace function public.pms_books()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(row_to_json(x) order by x.company desc, x.name), '[]'::jsonb)
    from (
      select b.book_id,
             b.book_id = public.pms_company_book() as company,
             case when b.book_id = public.pms_company_book() then 'Company'
                  else coalesce(nullif(p.full_name, ''), u.email, b.book_id::text) end as name,
             p.registration_status as status,
             (select count(*) from public.pms_properties x where x.book_id = b.book_id and not x.archived) as properties,
             (select count(*) from public.pms_leases x where x.book_id = b.book_id and not x.archived) as leases
      from (
        select public.pms_company_book() as book_id
        union select book_id from public.pms_owners
        union select book_id from public.pms_tenants
        union select book_id from public.pms_properties
        union select book_id from public.pms_leases
      ) b
      left join public.profiles p on p.id = b.book_id
      left join auth.users u on u.id = b.book_id
    ) x
  );
end $$;

-- Moves every record of one book to another (the company book or an approved
-- broker), for example when a broker leaves. Logged.
create or replace function public.pms_transfer_book(p_from uuid, p_to uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t text; n bigint; counts jsonb := '{}'::jsonb;
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'Choose two different books' using errcode = '22023'; end if;
  if p_to <> public.pms_company_book() and not exists (
    select 1 from public.profiles where id = p_to and role::text = 'broker' and registration_status = 'approved') then
    raise exception 'The new book must be the company or an approved broker' using errcode = '22023';
  end if;
  perform set_config('pms.transfer', 'on', true);
  foreach t in array array['pms_owners','pms_tenants','pms_properties','pms_units','pms_leases','pms_payments','pms_maintenance','pms_expenses','pms_documents'] loop
    execute format('update public.%I set book_id = $1, updated_by = auth.uid() where book_id = $2', t) using p_to, p_from;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, n);
  end loop;
  perform set_config('pms.transfer', '', true);
  insert into public.audit_events (owner_id, event_type, entity_type, entity_id, detail)
  values (auth.uid(), 'pms_transfer_book', 'pms_book', p_from::text, jsonb_build_object('to', p_to, 'moved', counts));
  return counts;
end $$;

revoke all on function public.pms_books() from public, anon;
revoke all on function public.pms_transfer_book(uuid, uuid) from public, anon;
grant execute on function public.pms_books(), public.pms_transfer_book(uuid, uuid) to authenticated;

-- 8. Users & Access: which broker added a login -----------------------------------
-- Same as the live function, plus added_by / added_by_role (written by the
-- admin-create-account function when a broker makes a login).
create or replace function public.admin_list_profiles()
returns setof jsonb language plpgsql security definer set search_path to 'public', 'auth' as $$
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required'; end if;
  return query select jsonb_build_object(
      'id', p.id::text,
      'full_name', p.full_name::text,
      'email', u.email::text,
      'role', p.role::text,
      'registration_status', p.registration_status::text,
      'requested_role', coalesce(u.raw_user_meta_data ->> 'requested_role', '')::text,
      'prc', p.prc::text,
      'resa', p.resa::text,
      'agency', p.agency::text,
      'broker', p.broker::text,
      'added_by', coalesce(u.raw_user_meta_data ->> 'created_by', '')::text,
      'added_by_role', coalesce(u.raw_user_meta_data ->> 'created_by_role', '')::text,
      'created_at', p.created_at::text)
    from public.profiles p join auth.users u on u.id = p.id
    order by case p.registration_status when 'pending' then 0 when 'approved' then 1 else 2 end, p.created_at desc;
end;
$$;

-- Check: every PMS row has a book, and the counts per book.
select
  (select count(*) from public.pms_properties where book_id is null)
  + (select count(*) from public.pms_leases where book_id is null)
  + (select count(*) from public.pms_payments where book_id is null) as rows_without_book,
  (select count(*) from public.pms_properties where book_id = public.pms_company_book()) as company_properties,
  (select count(*) from public.pms_leases where book_id = public.pms_company_book()) as company_leases,
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'pms\_%' and policyname like '% manager all') as manager_rules;
