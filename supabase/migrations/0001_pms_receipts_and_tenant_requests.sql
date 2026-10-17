-- PMS: numbered acknowledgement receipts, and tenants sending payment proof and
-- repair requests (2026-10-17).
--
-- Run AFTER supabase/pms_v3_books.sql, in the Supabase SQL editor. Safe to run
-- more than once.
--
-- 1. Acknowledgement receipts. Every payment marked "paid" gets the next number
--    of its book and year: AR-2026-0001. The database hands the numbers out, so
--    two phones can never give the same one, and a number never changes once
--    given. Payments already marked paid are numbered now, oldest first.
--    (An acknowledgement receipt, not a BIR official receipt.)
-- 2. Tenants can send proof of a payment. It waits as "sent by tenant" until the
--    book's manager confirms it (it then gets a number) or doesn't accept it.
-- 3. Tenants can ask for a repair. It lands in the book's work orders; the
--    tenant sees its title and status, not the staff notes or costs.
-- 4. A tenant may upload the photo for a payment they sent, and nothing else.
-- Both tenant actions check the lease is theirs, are limited per day, and send
-- the manager a notification (super-admins for company records, the broker for
-- their own).

-- 1. Receipt numbers --------------------------------------------------------------
create table if not exists public.pms_receipt_counters (
  book_id uuid not null,
  year int not null,
  last_no int not null default 0,
  primary key (book_id, year));
alter table public.pms_receipt_counters enable row level security;
revoke all on public.pms_receipt_counters from anon, authenticated;

create or replace function public.pms_payment_receipt_no()
returns trigger language plpgsql security definer set search_path = public as $$
declare y int; n int;
begin
  -- A number, once given, stays with the payment.
  if tg_op = 'UPDATE' and coalesce(old.data ->> 'receipt_no', '') <> '' then
    new.data := new.data || jsonb_strip_nulls(jsonb_build_object('receipt_no', old.data -> 'receipt_no', 'receipt_issued', old.data -> 'receipt_issued'));
    return new;
  end if;
  -- Only the database hands numbers out.
  new.data := new.data - 'receipt_no' - 'receipt_issued';
  if coalesce(new.data ->> 'status', '') <> 'paid' or new.archived then return new; end if;
  -- The year the money was received (the payment date), else this year in Manila.
  y := case when (new.data ->> 'date') ~ '^(19|20)[0-9]{2}-' then left(new.data ->> 'date', 4)::int
            else extract(year from now() at time zone 'Asia/Manila')::int end;
  insert into public.pms_receipt_counters as c (book_id, year, last_no) values (new.book_id, y, 1)
  on conflict (book_id, year) do update set last_no = c.last_no + 1
  returning last_no into n;
  new.data := new.data || jsonb_build_object(
    'receipt_no', 'AR-' || y || '-' || lpad(n::text, 4, '0'),
    'receipt_issued', to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD'));
  return new;
end $$;
revoke all on function public.pms_payment_receipt_no() from public, anon, authenticated;

drop trigger if exists pms_payments_receipt_no on public.pms_payments;
create trigger pms_payments_receipt_no before insert or update on public.pms_payments
  for each row execute function public.pms_payment_receipt_no();

-- Number the payments already marked paid, oldest first in each book.
do $$
declare r record;
begin
  for r in
    select id from public.pms_payments
    where data ->> 'status' = 'paid' and not archived and coalesce(data ->> 'receipt_no', '') = ''
    order by book_id, coalesce(data ->> 'date', ''), created_at, id
  loop
    update public.pms_payments set data = data where id = r.id;
  end loop;
end $$;

-- 2/3. Tenant requests ------------------------------------------------------------
-- Tells a book's manager(s). Never stops the request if notifications fail.
create or replace function public.pms_notify_book(p_book uuid, p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select id from public.profiles
    where registration_status = 'approved'
      and ((p_book = public.pms_company_book() and role::text = 'super-admin')
           or (id = p_book and role::text = 'broker'))
  loop
    begin
      perform public.notify_user(r.id, 'info', p_title, p_body, 'pms');
    exception when others then null;
    end;
  end loop;
end $$;
revoke all on function public.pms_notify_book(uuid, text, text) from public, anon, authenticated;

-- The caller's own, open lease (or an error).
create or replace function public.pms_tenant_lease(p_lease text)
returns public.pms_leases language plpgsql stable security definer set search_path = public as $$
declare l public.pms_leases;
begin
  select * into l from public.pms_leases
  where id = p_lease and not archived and id in (select public.pms_my_lease_ids());
  if l.id is null then raise exception 'This lease is not linked to your account' using errcode = '42501'; end if;
  return l;
end $$;
revoke all on function public.pms_tenant_lease(text) from public, anon, authenticated;

create or replace function public.pms_tenant_send_payment(
  p_lease text, p_amount numeric, p_date date, p_month text, p_method text, p_reference text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.pms_leases := public.pms_tenant_lease(p_lease);
  today date := (now() at time zone 'Asia/Manila')::date;
  v_id text := 'p-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  v_month text := case when p_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then p_month end;
  v_name text;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    raise exception 'Enter the amount you paid' using errcode = '22023';
  end if;
  if p_date is null or p_date > today + 1 or p_date < today - 400 then
    raise exception 'Enter the date you paid' using errcode = '22023';
  end if;
  if (select count(*) from public.pms_payments
      where data ->> 'sent_by' = auth.uid()::text and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You have sent many payments today. Please call the office.' using errcode = '54000';
  end if;
  insert into public.pms_payments (id, data, lease_id, property_id, tenant_id, book_id, updated_by)
  values (v_id, jsonb_build_object(
      'id', v_id, 'lease_id', l.id, 'property_id', l.property_id, 'unit_id', l.unit_id, 'tenant_id', l.tenant_id,
      'amount', round(p_amount, 2), 'date', to_char(p_date, 'YYYY-MM-DD'), 'month', v_month,
      'method', left(coalesce(p_method, ''), 30), 'reference', left(coalesce(p_reference, ''), 80),
      'notes', left(coalesce(p_note, ''), 500), 'status', 'submitted',
      'sent_by', auth.uid(), 'sent_at', now(),
      'createdAt', (extract(epoch from now()) * 1000)::bigint, 'archived', false),
    l.id, l.property_id, l.tenant_id, l.book_id, auth.uid());
  select data ->> 'name' into v_name from public.pms_tenants where id = l.tenant_id;
  perform public.pms_notify_book(l.book_id, 'Payment sent by a tenant',
    coalesce(nullif(v_name, ''), 'A tenant') || ' sent proof of a ' || to_char(round(p_amount, 2), 'FM999,999,990.00') || ' peso payment. Confirm it in Property Management > Payments.');
  return jsonb_build_object('id', v_id, 'book_id', l.book_id);
end $$;

-- The photo for a payment the tenant sent (uploaded first to <book>/<payment>/).
create or replace function public.pms_tenant_attach_proof(p_payment text, p_path text, p_name text)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare p public.pms_payments;
begin
  select * into p from public.pms_payments
  where id = p_payment and not archived and data ->> 'sent_by' = auth.uid()::text and data ->> 'status' = 'submitted'
    and lease_id in (select public.pms_my_lease_ids());
  if p.id is null then raise exception 'You can only add a photo to a payment you sent' using errcode = '42501'; end if;
  if p_path is null or p_path not like p.book_id::text || '/' || p.id || '/%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'pms-receipts' and o.name = p_path) then
    raise exception 'Upload the photo first' using errcode = '22023';
  end if;
  update public.pms_payments
     set data = data || jsonb_build_object('proofPath', p_path, 'proofName', left(coalesce(p_name, ''), 120)), updated_by = auth.uid()
   where id = p.id;
  return jsonb_build_object('id', p.id, 'proofPath', p_path);
end $$;

create or replace function public.pms_tenant_request_repair(p_lease text, p_title text, p_details text, p_category text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.pms_leases := public.pms_tenant_lease(p_lease);
  v_id text := 'm-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  v_title text := btrim(coalesce(p_title, ''));
  v_cat text := case when p_category in ('Plumbing', 'Electrical', 'HVAC', 'Structural', 'Pest Control', 'General Repair', 'Other') then p_category else 'Other' end;
  v_name text;
begin
  if length(v_title) < 3 or length(v_title) > 120 then
    raise exception 'Say in a few words what needs fixing' using errcode = '22023';
  end if;
  if length(coalesce(p_details, '')) > 2000 then
    raise exception 'Please keep the details shorter' using errcode = '22023';
  end if;
  if (select count(*) from public.pms_maintenance
      where data ->> 'sent_by' = auth.uid()::text and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You have sent many requests today. Please call the office.' using errcode = '54000';
  end if;
  insert into public.pms_maintenance (id, data, property_id, unit_id, book_id, updated_by)
  values (v_id, jsonb_build_object(
      'id', v_id, 'title', v_title, 'request', btrim(coalesce(p_details, '')), 'category', v_cat,
      'priority', 'medium', 'status', 'open', 'date', to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD'),
      'property_id', l.property_id, 'unit_id', l.unit_id, 'lease_id', l.id, 'tenant_id', l.tenant_id,
      'source', 'tenant', 'sent_by', auth.uid(), 'sent_at', now(),
      'createdAt', (extract(epoch from now()) * 1000)::bigint, 'archived', false),
    l.property_id, l.unit_id, l.book_id, auth.uid());
  select data ->> 'name' into v_name from public.pms_tenants where id = l.tenant_id;
  perform public.pms_notify_book(l.book_id, 'Repair request from a tenant',
    coalesce(nullif(v_name, ''), 'A tenant') || ': ' || v_title || '. See Property Management > Maintenance.');
  return jsonb_build_object('id', v_id);
end $$;

-- What a tenant sees of their own requests: no staff notes, costs or vendors.
create or replace function public.pms_my_repair_requests()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'title', m.data ->> 'title', 'request', m.data ->> 'request', 'category', m.data ->> 'category',
      'status', m.data ->> 'status', 'date', m.data ->> 'date', 'lease_id', m.data ->> 'lease_id',
      'updated_at', m.updated_at) order by m.created_at desc), '[]'::jsonb)
  from public.pms_maintenance m
  where not m.archived and m.data ->> 'source' = 'tenant'
    and m.data ->> 'tenant_id' in (select public.pms_my_tenant_ids());
$$;

revoke all on function public.pms_tenant_send_payment(text, numeric, date, text, text, text, text) from public, anon;
revoke all on function public.pms_tenant_attach_proof(text, text, text) from public, anon;
revoke all on function public.pms_tenant_request_repair(text, text, text, text) from public, anon;
revoke all on function public.pms_my_repair_requests() from public, anon;
grant execute on function public.pms_tenant_send_payment(text, numeric, date, text, text, text, text),
  public.pms_tenant_attach_proof(text, text, text), public.pms_tenant_request_repair(text, text, text, text),
  public.pms_my_repair_requests() to authenticated;

-- 4. Tenant photo upload -------------------------------------------------------------
-- Only into <book>/<payment>/ of a payment the tenant sent and that is still
-- waiting; no changing or deleting files.
drop policy if exists "pms receipts tenant upload" on storage.objects;
create policy "pms receipts tenant upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pms-receipts'
    and exists (
      select 1 from public.pms_payments p
      where p.id = (storage.foldername(name))[2]
        and p.book_id::text = (storage.foldername(name))[1]
        and not p.archived
        and p.data ->> 'status' = 'submitted'
        and p.data ->> 'sent_by' = auth.uid()::text
        and p.lease_id in (select public.pms_my_lease_ids())
    ));

-- Check: paid payments without a number (0), the tenant functions (4) and the
-- upload rule (1).
select
  (select count(*) from public.pms_payments where data ->> 'status' = 'paid' and not archived and coalesce(data ->> 'receipt_no', '') = '') as paid_without_number,
  (select count(*) from public.pms_payments where coalesce(data ->> 'receipt_no', '') <> '') as receipts_numbered,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('pms_tenant_send_payment', 'pms_tenant_attach_proof', 'pms_tenant_request_repair', 'pms_my_repair_requests')) as tenant_functions,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pms receipts tenant upload') as upload_rule;
