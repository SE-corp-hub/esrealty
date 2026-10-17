-- Phase 3: fix broken database features (2026-10-17)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- 1. profiles.email: co-broke invites fail today ("column p.email does not
--    exist"), the fb-leads default-assignee lookup finds nobody, and
--    notify-dispatch can't find anyone's email. Add the column, fill it from
--    auth.users, and keep it in sync on sign-up and email change. Users can't
--    edit it themselves: authenticated only has column grants for
--    full_name, agency, prc, resa and phone.
-- 2. storefront_inquiries: accept the Value Guide inquiry types so the audit
--    copy saves, and stop direct anonymous inserts (only the edge functions
--    write here, using the service role).
-- 3. agent_claim_due: re-claim tasks stuck in 'working' after their lease ran
--    out (a worker that crashed mid-task left them stuck forever).
-- 4. generate_presell_schedule: the "already exists" checks compared
--    'equity 1' with the stored 'Equity 1 of 24', so regenerating after a
--    payment duplicated rows or failed on the unique key.
-- 5. Transaction files: teammates could see a transaction's document list
--    but not open the files (storage only allowed the uploader's own folder).
--    The app now stores them under <uid>/tx/<transaction id>/; anyone who can
--    read that transaction (broker_transactions RLS) can read its files.

begin;

-- 1. profiles.email ---------------------------------------------------------
alter table public.profiles add column if not exists email text;

update public.profiles p
set email = lower(u.email)
from auth.users u
where u.id = p.id
  and p.email is distinct from lower(u.email);

create index if not exists profiles_email_lower_idx on public.profiles (lower(email));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), lower(new.email));
  return new;
end;
$function$;

create or replace function public.ensure_my_profile()
returns public.profiles
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  result public.profiles;
begin
  insert into public.profiles (id, full_name, email)
  values (auth.uid(),
          coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
          lower(nullif(auth.jwt() ->> 'email', '')))
  on conflict (id) do nothing;
  select * into result from public.profiles where id = auth.uid();
  return result;
end;
$function$;

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.profiles
  set email = lower(new.email)
  where id = new.id
    and email is distinct from lower(new.email);
  return new;
end;
$function$;

revoke execute on function public.sync_profile_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- 2. storefront_inquiries ---------------------------------------------------
alter table public.storefront_inquiries drop constraint if exists storefront_inquiries_inquiry_type_check;
alter table public.storefront_inquiries
  add constraint storefront_inquiries_inquiry_type_check
  check (inquiry_type in ('consult', 'guide', 'project-bt', 'location-analysis',
                          'professional-appraisal-request', 'broker-consultation'));

drop policy if exists "storefront inquiries public insert" on public.storefront_inquiries;

-- 3. agent_claim_due --------------------------------------------------------
create or replace function public.agent_claim_due(p_max integer default 10)
returns setof public.agent_tasks
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return query
    update public.agent_tasks t
    set state = 'working',
        lease_id = gen_random_uuid(),
        lease_until = now() + interval '5 minutes'
    where t.id in (
      select id from public.agent_tasks
      where (state = 'due'
             and due_at <= now()
             and (lease_until is null or lease_until < now()))
         or (state = 'working' and lease_until < now())
      order by due_at
      limit greatest(1, p_max)
      for update skip locked
    )
    returning t.*;
end;
$function$;

-- create or replace keeps grants, but restate the Phase 1 lock to be safe.
revoke execute on function public.agent_claim_due(integer) from public, anon, authenticated;
grant execute on function public.agent_claim_due(integer) to service_role;

-- 4. generate_presell_schedule ----------------------------------------------
create or replace function public.generate_presell_schedule(p_unit uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  u record;
  tcp numeric;
  eq_total numeric;
  eq_monthly numeric;
  eq_months int;
  principal numeric;
  r numeric := 0;
  m int;
  amort numeric;
  d date;
  i int;
  created int := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access required';
  end if;

  select * into u from public.presell_units where id = p_unit;
  if not found then raise exception 'Unit not found'; end if;

  tcp := coalesce(nullif(u.total_contract_price, 0), u.price, 0);
  if tcp <= 0 then raise exception 'Set the total contract price first'; end if;

  -- keep history; drop only untouched pending rows
  delete from public.presell_payments where unit_id = p_unit and status = 'pending';

  -- reservation fee
  if not exists (
    select 1 from public.presell_payments
    where unit_id = p_unit and lower(coalesce(label, '')) like 'reservation%'
  ) then
    insert into public.presell_payments (unit_id, due_date, label, amount, status)
    values (p_unit, coalesce(u.reserved_at::date, current_date), 'Reservation Fee',
            coalesce(u.reservation_fee, 0), 'paid');
    created := created + 1;
  end if;

  -- equity months (interest-free spread). Labels are 'Equity i of N'; the
  -- check matches that form and the older bare 'Equity i'.
  eq_months := greatest(coalesce(u.downpayment_months, 24), 1);
  eq_total  := tcp * (100 - coalesce(u.loan_percent, 90)) / 100;
  eq_monthly := round(eq_total / eq_months, 2);
  d := (coalesce(u.reserved_at::date, current_date) + interval '1 month')::date;
  for i in 1..eq_months loop
    if not exists (
      select 1 from public.presell_payments
      where unit_id = p_unit
        and (lower(coalesce(label, '')) = 'equity ' || i
             or lower(coalesce(label, '')) like 'equity ' || i || ' of %')
    ) then
      insert into public.presell_payments (unit_id, due_date, label, amount, status)
      values (p_unit, d, 'Equity ' || i || ' of ' || eq_months, eq_monthly, 'pending');
      created := created + 1;
    end if;
    d := (d + interval '1 month')::date;
  end loop;

  -- bank take-out amortization
  m := least(greatest(coalesce(u.loan_term_years, 0), 0) * 12, 360);
  if coalesce(u.loan_percent, 0) > 0 and u.loan_start_date is not null and m > 0 then
    principal := tcp * coalesce(u.loan_percent, 90) / 100;
    r := coalesce(u.loan_rate_annual, 7.5) / 100 / 12;
    amort := round(principal * r / (1 - power(1 + r, -m)), 2);
    d := u.loan_start_date;
    for i in 1..m loop
      if not exists (
        select 1 from public.presell_payments
        where unit_id = p_unit
          and (lower(coalesce(label, '')) = 'amortization ' || i
               or lower(coalesce(label, '')) like 'amortization ' || i || ' of %')
      ) then
        insert into public.presell_payments (unit_id, due_date, label, amount, status)
        values (p_unit, d, 'Amortization ' || i || ' of ' || m, amort, 'pending');
        created := created + 1;
      end if;
      d := (d + interval '1 month')::date;
    end loop;
  end if;

  return created;
end;
$function$;

-- 5. shared transaction files -----------------------------------------------
-- The subquery runs under broker_transactions RLS, so it only finds the
-- transaction when the viewer is allowed to read it.
drop policy if exists "documents read shared transaction" on storage.objects;
create policy "documents read shared transaction" on storage.objects
  for select
  using (
    bucket_id = 'private-documents'
    and (storage.foldername(name))[2] = 'tx'
    and exists (
      select 1 from public.broker_transactions t
      where t.id = (storage.foldername(name))[3]
    )
  );

commit;

notify pgrst, 'reload schema';

-- Check (should list the new column, constraint and trigger):
select
  (select count(*) from public.profiles where email is not null) as profiles_with_email,
  (select count(*) from public.profiles) as profiles_total,
  (select pg_get_constraintdef(oid) from pg_constraint
     where conname = 'storefront_inquiries_inquiry_type_check') as inquiry_types,
  (select count(*) from pg_trigger where tgname = 'on_auth_user_email_changed') as email_sync_trigger;
