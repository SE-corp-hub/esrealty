-- Broker access, indexes, change log, ledger lock, site settings, stale-listing alerts (2026-10-21).
-- Safe to run twice.
--
-- Apply with GitHub > Actions > Apply database migration (test, then apply),
-- AFTER 0004. Changes no data. Backend roadmap items C4, D12, B6, B7, K1, A6, N6.
--
-- 1. Broker team access follows the broker's current role (C4). A broker who is
--    demoted, declined or still pending kept their old team's leads, because the
--    "is this my agent" checks only compared ids. They now also require the
--    caller to be an approved broker. Creating a login can only name an approved
--    broker as the supervisor.
-- 2. Indexes on the columns used to find related rows (D12). Deleting an account
--    or a project scanned whole tables to find what to remove with it.
-- 3. A change log (B6). Lead created / assigned / status / deleted, cash entries
--    posted / voided / deleted, and role changes (with the old role). Only changes
--    made by a signed-in person are logged. Super-admins can read the whole log.
--    Listing changes are logged by the website API (supabase/functions/listing-api),
--    because listings are saved there with the server key, not by the person.
-- 4. Posted ledger entries cannot be rewritten or deleted through the app (B7).
--    Amount, date, account, direction, purpose and status are fixed once posted;
--    a mistake is corrected with a reversal, which the app already does. Voided
--    and draft entries can still be changed or deleted. The Supabase SQL editor
--    and server code (service role) are not blocked.
-- 5. site_settings (K1): one table for website settings, so they no longer live
--    in one super-admin's private data. Nothing reads it yet; see the app change.
-- 6. listing_stale_sweep() (A6): tells an agent "Still available?" when a
--    published listing has not been touched for 75 days. Run by a daily job that
--    is off until switched on. It does not unpublish anything.
-- 7. Two unused functions are removed (N6): agent_cancel(), my_full_name().
-- 8. One lead per Value Guide submit (D8): unique index on the idempotency key.

-- 1a. "Is the creator on my team" and "is the assignee my agent": only for an approved broker.
create or replace function public.crm_lead_broker_of(p_created_by uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = p_created_by and p.broker = auth.uid()
  ) and exists (
    select 1 from public.profiles me
    where me.id = auth.uid() and me.role = 'broker' and me.registration_status = 'approved'
  );
$function$;

create or replace function public.crm_lead_assigned_to_my_team(p_assigned_to_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = p_assigned_to_id
      and p.role = 'agent'
      and p.registration_status = 'approved'
      and p.broker = auth.uid()
  ) and exists (
    select 1 from public.profiles me
    where me.id = auth.uid() and me.role = 'broker' and me.registration_status = 'approved'
  );
$function$;

-- 1b. The team list needs an approved broker (or super-admin).
create or replace function public.broker_team()
returns setof jsonb language plpgsql security definer set search_path to 'public', 'auth' as $function$
declare
  me_role text;
  me_status text;
begin
  select role::text, registration_status into me_role, me_status from public.profiles where id = auth.uid();
  if me_status is distinct from 'approved' or (me_role is distinct from 'broker' and me_role is distinct from 'super-admin') then
    raise exception 'Broker access required';
  end if;

  return query
    select jsonb_build_object(
      'id', p.id::text,
      'full_name', p.full_name::text,
      'email', u.email::text
    )
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'agent'
      and p.registration_status = 'approved'
      and p.broker = auth.uid()
    order by p.full_name;
end;
$function$;

-- 1c. Creating a login: the supervising broker must be an approved broker.
CREATE OR REPLACE FUNCTION public.admin_create_account(p_email text, p_password text, p_full_name text, p_role app_role, p_prc text DEFAULT NULL::text, p_resa text DEFAULT NULL::text, p_agency text DEFAULT NULL::text, p_broker uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  new_id uuid := gen_random_uuid();
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required'; end if;
  if p_role = 'broker' and (p_prc is null or length(btrim(p_prc)) = 0) then raise exception 'Broker PRC license is required'; end if;
  if p_role = 'agent' and p_broker is null then raise exception 'Agents must be linked to a supervising broker'; end if;
  -- C4: the supervising broker must be an approved broker (not any account id).
  if p_broker is not null and not exists (select 1 from public.profiles where id = p_broker and role = 'broker' and registration_status = 'approved') then raise exception 'Supervising broker not found or not approved'; end if;
  if exists (select 1 from auth.users where email = p_email) then raise exception 'Email already registered'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'requested_role', p_role, 'must_change_password', true),
    now(), now(), '', '');
  -- Supabase Auth also requires an email identity. A user row without this can
  -- appear approved in profiles while signInWithPassword still cannot load it.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) then
    execute $identity$
      insert into auth.identities
        (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values
        ($1::text, $1, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true, 'phone_verified', false),
         'email', now(), now(), now())
    $identity$ using new_id, lower(btrim(p_email));
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'id' and data_type = 'uuid'
  ) then
    execute $identity$
      insert into auth.identities
        (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values
        (gen_random_uuid(), $1, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
         'email', now(), now(), now())
    $identity$ using new_id, lower(btrim(p_email));
  else
    execute $identity$
      insert into auth.identities
        (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values
        ($1::text, $1, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
         'email', now(), now(), now())
    $identity$ using new_id, lower(btrim(p_email));
  end if;
  -- The auth.users insert fires the signup trigger (creating a pending profile),
  -- so attach the chosen role and keep it pending for Super Admin approval.
  insert into public.profiles (id, full_name, role, registration_status, prc, resa, agency, broker)
  values (new_id, p_full_name, p_role, 'pending', p_prc, p_resa, p_agency, p_broker)
  on conflict (id) do update
  set full_name = excluded.full_name,
      role = excluded.role,
      registration_status = excluded.registration_status,
      prc = excluded.prc,
      resa = excluded.resa,
      agency = excluded.agency,
      broker = excluded.broker;
  insert into public.audit_events (owner_id, event_type, entity_type, entity_id, detail)
  values (auth.uid(), 'manual_create', 'profile', new_id::text, jsonb_build_object('role', p_role));
  return new_id;
end;
$function$;

-- 2. Indexes (D12). Plain b-tree on the foreign-key columns that had none.
create index if not exists profiles_broker_idx on public.profiles (broker) where broker is not null;
create index if not exists audit_events_owner_idx on public.audit_events (owner_id, created_at desc);
create index if not exists cash_entries_approved_by_idx on public.cash_entries (approved_by);
create index if not exists cash_entries_created_by_idx on public.cash_entries (created_by);
create index if not exists cash_entries_linked_construction_idx on public.cash_entries (linked_construction_id);
create index if not exists cash_entries_linked_phase_idx on public.cash_entries (linked_phase_id);
create index if not exists cash_entries_linked_presell_project_idx on public.cash_entries (linked_presell_project_id);
create index if not exists cash_entries_reversal_of_idx on public.cash_entries (reversal_of);
create index if not exists compliance_records_owner_idx on public.compliance_records (owner);
create index if not exists construction_change_orders_created_by_idx on public.construction_change_orders (created_by);
create index if not exists construction_invoices_created_by_idx on public.construction_invoices (created_by);
create index if not exists construction_invoices_ledger_entry_idx on public.construction_invoices (ledger_entry_id);
create index if not exists construction_invoices_phase_idx on public.construction_invoices (phase_id);
create index if not exists construction_invoices_vendor_idx on public.construction_invoices (vendor_id);
create index if not exists construction_projects_created_by_idx on public.construction_projects (created_by);
create index if not exists construction_projects_presell_project_idx on public.construction_projects (presell_project_id);
create index if not exists construction_vendors_created_by_idx on public.construction_vendors (created_by);
create index if not exists password_resets_user_idx on public.password_resets (user_id);
create index if not exists portfolio_accounts_created_by_idx on public.portfolio_accounts (created_by);
create index if not exists portfolio_proofs_uploaded_by_idx on public.portfolio_proofs (uploaded_by);
create index if not exists presell_projects_created_by_idx on public.presell_projects (created_by);
create index if not exists sales_playbooks_created_by_idx on public.sales_playbooks (created_by);
create index if not exists saved_listings_listing_idx on public.saved_listings (listing_id);
create index if not exists storefront_inquiries_user_idx on public.storefront_inquiries (user_id);

-- 3. Change log (B6).
-- Writes one audit_events row for the signed-in person who made the change. A change made by
-- server code or the SQL editor (nobody signed in) is not logged here. Logging can never stop
-- the change itself: a failure becomes a warning in the database log.
create or replace function public.audit_log(p_event text, p_entity text, p_entity_id text, p_detail jsonb)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null then return; end if;
  begin
    insert into public.audit_events (owner_id, event_type, entity_type, entity_id, detail)
    values (auth.uid(), p_event, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb));
  exception when others then
    raise warning 'audit_log: %', sqlerrm;
  end;
end;
$function$;
revoke all on function public.audit_log(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.audit_log(text, text, text, jsonb) to service_role;

drop policy if exists "audit super-admin read" on public.audit_events;
create policy "audit super-admin read" on public.audit_events as permissive for select to public
  using (is_super_admin());

-- Leads: created, assigned, status moved, deleted.
create or replace function public.audit_crm_leads()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log('lead_created', 'crm_lead', new.id,
      jsonb_build_object('assigned_to_id', new.assigned_to_id, 'source', new.payload ->> 'source'));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.assigned_to_id is distinct from old.assigned_to_id then
      perform public.audit_log('lead_assigned', 'crm_lead', new.id,
        jsonb_build_object('from', old.assigned_to_id, 'to', new.assigned_to_id));
    end if;
    if new.payload ->> 'status' is distinct from old.payload ->> 'status' then
      perform public.audit_log('lead_status', 'crm_lead', new.id,
        jsonb_build_object('from', old.payload ->> 'status', 'to', new.payload ->> 'status'));
    end if;
    return new;
  end if;
  perform public.audit_log('lead_deleted', 'crm_lead', old.id,
    jsonb_build_object('created_by', old.created_by, 'assigned_to_id', old.assigned_to_id, 'status', old.payload ->> 'status'));
  return old;
end;
$function$;
revoke all on function public.audit_crm_leads() from public, anon, authenticated;
drop trigger if exists crm_leads_audit on public.crm_leads;
create trigger crm_leads_audit after insert or update or delete on public.crm_leads
  for each row execute function public.audit_crm_leads();

-- Cash entries: posted, voided or otherwise moved, deleted.
create or replace function public.audit_cash_entries()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op = 'INSERT' then
    if new.status = 'posted' then
      perform public.audit_log('cash_posted', 'cash_entry', new.id::text,
        jsonb_build_object('direction', new.direction, 'amount', new.amount, 'account_id', new.account_id, 'reversal_of', new.reversal_of));
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      perform public.audit_log(
        case new.status when 'posted' then 'cash_posted' when 'voided' then 'cash_voided' else 'cash_status' end,
        'cash_entry', new.id::text,
        jsonb_build_object('from', old.status, 'to', new.status, 'direction', new.direction, 'amount', new.amount, 'account_id', new.account_id));
    end if;
    return new;
  end if;
  perform public.audit_log('cash_deleted', 'cash_entry', old.id::text,
    jsonb_build_object('status', old.status, 'direction', old.direction, 'amount', old.amount, 'account_id', old.account_id));
  return old;
end;
$function$;
revoke all on function public.audit_cash_entries() from public, anon, authenticated;
drop trigger if exists cash_entries_audit on public.cash_entries;
create trigger cash_entries_audit after insert or update or delete on public.cash_entries
  for each row execute function public.audit_cash_entries();

-- Accounts: role changes, with the old role. (The access screen already logs the approve or
-- reject decision.) A profile changed in the same transaction that created it (a login made by
-- a super-admin) is not a "change".
create or replace function public.audit_profiles()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if old.created_at = now() then return new; end if;
  if new.role is distinct from old.role then
    perform public.audit_log('role_changed', 'profile', new.id::text, jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return new;
end;
$function$;
revoke all on function public.audit_profiles() from public, anon, authenticated;
drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit after update of role on public.profiles
  for each row execute function public.audit_profiles();

-- 4. Ledger lock (B7). Applies to people using the app or API (authenticated / anon); the SQL
-- editor and server code are not blocked, so an owner can still fix a real error by hand.
create or replace function public.cash_entries_lock_posted()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' then
    if old.status in ('posted', 'reversed') and (
         new.status is distinct from old.status
      or new.owner_id is distinct from old.owner_id
      or new.account_id is distinct from old.account_id
      or new.entry_date is distinct from old.entry_date
      or new.direction is distinct from old.direction
      or new.amount is distinct from old.amount
      or new.category is distinct from old.category
      or new.purpose is distinct from old.purpose
      or new.subcategory is distinct from old.subcategory
      or new.reversal_of is distinct from old.reversal_of
    ) then
      raise exception 'A posted ledger entry cannot be changed. Reverse it with a new entry instead.';
    end if;
    return new;
  end if;
  -- A delete started by the person (depth 1). Removing an account or login deletes its
  -- entries from inside the database (depth 2) and is not blocked here.
  if old.status in ('posted', 'reversed') and pg_trigger_depth() = 1 then
    raise exception 'A posted ledger entry cannot be deleted. Reverse it with a new entry instead.';
  end if;
  return old;
end;
$function$;
revoke all on function public.cash_entries_lock_posted() from public, anon, authenticated;
drop trigger if exists cash_entries_lock_posted on public.cash_entries;
create trigger cash_entries_lock_posted before update or delete on public.cash_entries
  for each row execute function public.cash_entries_lock_posted();

-- 5. Website settings in one table (K1).
create table if not exists public.site_settings (
  key text primary key check (key ~ '^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$'),
  value jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  is_public boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists site_settings_updated_by_idx on public.site_settings (updated_by);
alter table public.site_settings enable row level security;
revoke all on public.site_settings from public, anon, authenticated;
grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;
grant all on public.site_settings to service_role;

create or replace function public.site_settings_stamp()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$function$;
revoke all on function public.site_settings_stamp() from public, anon, authenticated;
drop trigger if exists site_settings_stamp on public.site_settings;
create trigger site_settings_stamp before insert or update on public.site_settings
  for each row execute function public.site_settings_stamp();

drop policy if exists "site settings read" on public.site_settings;
create policy "site settings read" on public.site_settings as permissive for select to public
  using (is_public or is_super_admin());
drop policy if exists "site settings super-admin write" on public.site_settings;
create policy "site settings super-admin write" on public.site_settings as permissive for all to public
  using (is_super_admin()) with check (is_super_admin());

-- 6. Stale-listing alerts (A6). Run daily by .github/workflows/listing-stale.yml (off until
-- the repository variable LISTING_STALE_ALERTS is "on"). Never unpublishes.
create or replace function public.listing_last_touched(p_payload jsonb, p_created timestamptz)
returns timestamptz language plpgsql stable set search_path to 'public' as $function$
declare v text := p_payload ->> 'updatedAt';
begin
  if v ~ '^\d{4}-\d{2}-\d{2}' then
    return v::timestamptz;
  end if;
  return p_created;
exception when others then
  return p_created;
end;
$function$;
revoke all on function public.listing_last_touched(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.listing_last_touched(jsonb, timestamptz) to service_role;

create or replace function public.listing_stale_sweep(p_alert_days integer default 75, p_dry_run boolean default true)
returns table(listing_id text, owner_id uuid, idle_days integer, alerted boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare
  r record;
  v_title text;
  v_days integer;
begin
  if p_alert_days is null or p_alert_days < 1 then raise exception 'p_alert_days must be at least 1'; end if;
  for r in
    select l.id as lid, l.owner_id as lowner, l.title as ltitle,
           public.listing_last_touched(l.payload, l.created_at) as touched
    from public.shared_listings l
    where l.is_published and l.status in ('available', 'rfo')
  loop
    v_days := floor(extract(epoch from (now() - r.touched)) / 86400)::integer;
    continue when v_days < p_alert_days;
    v_title := left('Still available? ' || coalesce(nullif(btrim(r.ltitle), ''), r.lid), 200);
    -- one reminder per listing every 14 days
    continue when exists (
      select 1 from public.notifications n
      where n.user_id = r.lowner and n.type = 'info' and n.title = v_title and n.created_at > now() - interval '14 days'
    );
    listing_id := r.lid; owner_id := r.lowner; idle_days := v_days; alerted := false;
    if not p_dry_run then
      perform public.notify_user(r.lowner, 'info', v_title,
        'Not updated for ' || v_days || ' days. Open it and save, or mark it sold or rented, so the website stays accurate.', 'listings');
      alerted := true;
    end if;
    return next;
  end loop;
end;
$function$;
revoke all on function public.listing_stale_sweep(integer, boolean) from public, anon, authenticated;
grant execute on function public.listing_stale_sweep(integer, boolean) to service_role;

-- 7. Unused functions (N6). Nothing in the app, the functions or the policies calls these.
drop function if exists public.agent_cancel(uuid);
drop function if exists public.my_full_name();

-- 8. One lead per Value Guide submit (D8). The website function checks the idempotency key
-- before saving; this makes the database refuse a second lead with the same key when two taps
-- arrive together. If duplicates already exist the index is skipped with a warning.
do $$
begin
  create unique index if not exists crm_leads_idempotency_key_idx on public.crm_leads ((payload ->> 'idempotencyKey'))
    where coalesce(payload ->> 'idempotencyKey', '') <> '';
exception when unique_violation then
  raise warning 'crm_leads_idempotency_key_idx not created: duplicate idempotency keys exist';
end $$;

-- Check: audit_triggers 3, ledger_lock 1, site_settings 1, new_indexes 25, dropped_functions 0.
select
  (select count(*) from pg_trigger where not tgisinternal and tgname in ('crm_leads_audit', 'cash_entries_audit', 'profiles_audit'))::int as audit_triggers,
  (select count(*) from pg_trigger where not tgisinternal and tgname = 'cash_entries_lock_posted')::int as ledger_lock,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'site_settings')::int as site_settings,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname in (
     'profiles_broker_idx', 'audit_events_owner_idx', 'cash_entries_approved_by_idx', 'cash_entries_created_by_idx',
     'cash_entries_linked_construction_idx', 'cash_entries_linked_phase_idx', 'cash_entries_linked_presell_project_idx',
     'cash_entries_reversal_of_idx', 'compliance_records_owner_idx', 'construction_change_orders_created_by_idx',
     'construction_invoices_created_by_idx', 'construction_invoices_ledger_entry_idx', 'construction_invoices_phase_idx',
     'construction_invoices_vendor_idx', 'construction_projects_created_by_idx', 'construction_projects_presell_project_idx',
     'construction_vendors_created_by_idx', 'password_resets_user_idx', 'portfolio_accounts_created_by_idx',
     'portfolio_proofs_uploaded_by_idx', 'presell_projects_created_by_idx', 'sales_playbooks_created_by_idx',
     'saved_listings_listing_idx', 'storefront_inquiries_user_idx', 'site_settings_updated_by_idx'))::int as new_indexes,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('agent_cancel', 'my_full_name'))::int as dropped_functions;
