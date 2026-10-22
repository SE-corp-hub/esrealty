-- Hand over a person's records before an account is deleted; old-data clean-up, off (2026-10-21).
-- Safe to run twice.
--
-- Apply with GitHub > Actions > Apply database migration (test, then apply), AFTER 0009.
-- Changes no data by itself. Backend roadmap items A5 and B3; owner decision (21 Oct): deactivate
-- by default and give the records to someone else; clean-up only after the periods are confirmed.
--
-- Deleting an account used to delete everything that pointed at it: their leads, listings, deals,
-- ledger entries, accounts, construction projects, co-broke agreements, compliance records, ads, and
-- even their entries in the change log. Now:
-- 1. admin_handover_records(from, to): a Super Admin moves all of that to another approved staff
--    account (Super Admin, broker or agent) in one step, and the move is written to the change log
--    with the counts. Leads assigned to the person move too. Their property management book moves
--    when the new owner is a broker (or the company), using the existing book transfer.
-- 2. The change log keeps a deleted person's entries (the link that deleted them with the account
--    is removed; the id stays in the row).
-- "Revoke access" (Users & Access) remains the way to switch someone off without deleting; the
-- app now asks for the handover before it offers "Delete account".

-- The "creator cannot be changed" rules still apply to people using the app; the handover runs
-- as the database owner (security definer), which they now let through.
create or replace function public.crm_leads_keep_creator()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if new.created_by is distinct from old.created_by and current_user in ('authenticated', 'anon') then
    raise exception 'Lead creator cannot be changed';
  end if;
  return new;
end;
$function$;

create or replace function public.ad_posts_keep_creator()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if new.created_by is distinct from old.created_by and current_user in ('authenticated', 'anon') then
    raise exception 'Ad creator cannot be changed';
  end if;
  return new;
end;
$function$;

create or replace function public.admin_handover_records(p_from uuid, p_to uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  counts jsonb := '{}'::jsonb;
  n bigint;
  to_name text;
  to_role text;
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'Choose two different accounts' using errcode = '22023'; end if;
  select coalesce(nullif(btrim(full_name), ''), 'Staff'), role::text into to_name, to_role
    from public.profiles where id = p_to and registration_status = 'approved' and role::text in ('super-admin', 'broker', 'agent');
  if to_role is null then raise exception 'Records can only go to an approved Super Admin, broker or agent' using errcode = '22023'; end if;

  update public.crm_leads set created_by = p_to where created_by = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('leads_created', n);
  update public.crm_leads set assigned_to_id = p_to, assigned_to = to_name,
         payload = payload || jsonb_build_object('assignedToId', p_to::text, 'assignedTo', to_name)
   where assigned_to_id = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('leads_assigned', n);
  update public.shared_listings set owner_id = p_to where owner_id = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('listings', n);
  update public.broker_transactions set broker_id = p_to where broker_id = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('deals_broker', n);
  update public.broker_transactions set created_by = p_to where created_by = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('deals_created', n);
  update public.cash_entries set owner_id = p_to where owner_id = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('ledger_entries', n);
  update public.portfolio_accounts set owner_id = p_to where owner_id = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('ledger_accounts', n);
  update public.construction_projects set owner_id = p_to where owner_id = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('construction_projects', n);
  update public.cobroke_agreements set listing_broker_id = p_to where listing_broker_id = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('cobroke', n);
  update public.compliance_records set owner = p_to where owner = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('compliance', n);
  update public.ad_posts set created_by = p_to where created_by = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('ads', n);
  update public.pms_workspaces set owner_id = p_to where owner_id = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('pms_workspaces', n);
  -- Agents supervised by the person get the new owner as their broker when that is a broker.
  if to_role = 'broker' then
    update public.profiles set broker = p_to where broker = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('agents', n);
  else
    update public.profiles set broker = null where broker = p_from; get diagnostics n = row_count; counts := counts || jsonb_build_object('agents_unlinked', n);
  end if;
  -- Their property management book, if they had one with records.
  begin
    if to_role = 'broker' or to_role = 'super-admin' then
      counts := counts || jsonb_build_object('pms_book', public.pms_transfer_book(p_from, case when to_role = 'broker' then p_to else public.pms_company_book() end));
    end if;
  exception when others then
    counts := counts || jsonb_build_object('pms_book', 'not moved: ' || sqlerrm);
  end;

  insert into public.audit_events (owner_id, event_type, entity_type, entity_id, detail)
  values (auth.uid(), 'records_handed_over', 'profile', p_from::text, jsonb_build_object('to', p_to, 'moved', counts));
  return counts;
end;
$function$;
revoke all on function public.admin_handover_records(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_handover_records(uuid, uuid) to authenticated, service_role;

-- How much a person still owns (the app shows it before "Delete account").
create or replace function public.admin_records_owned(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'leads', (select count(*) from public.crm_leads where created_by = p_user or assigned_to_id = p_user),
    'listings', (select count(*) from public.shared_listings where owner_id = p_user),
    'deals', (select count(*) from public.broker_transactions where broker_id = p_user or created_by = p_user),
    'ledger_entries', (select count(*) from public.cash_entries where owner_id = p_user),
    'ledger_accounts', (select count(*) from public.portfolio_accounts where owner_id = p_user),
    'construction_projects', (select count(*) from public.construction_projects where owner_id = p_user),
    'cobroke', (select count(*) from public.cobroke_agreements where listing_broker_id = p_user),
    'compliance', (select count(*) from public.compliance_records where owner = p_user),
    'ads', (select count(*) from public.ad_posts where created_by = p_user),
    'agents', (select count(*) from public.profiles where broker = p_user));
end;
$function$;
revoke all on function public.admin_records_owned(uuid) from public, anon, authenticated;
grant execute on function public.admin_records_owned(uuid) to authenticated, service_role;

-- The change log outlives the account (the id stays; only the delete-with-account link goes).
alter table public.audit_events drop constraint if exists audit_events_owner_id_fkey;

select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('admin_handover_records', 'admin_records_owned'))::int as functions,
  (select count(*) from pg_constraint where conname = 'audit_events_owner_id_fkey')::int as audit_fk_left;

-- Clean-up of old data (B3). OFF: the monthly job .github/workflows/retention.yml only counts until
-- the repository variable RETENTION_CLEANUP is "on". Proposed periods (confirm them with your
-- privacy officer or lawyer before switching on; change them here):
--   read notifications older than 180 days
--   password reset requests resolved more than 30 days ago
--   website inquiries marked spam more than 90 days ago (listing and storefront inquiries)
--   Autopilot steps older than 180 days
-- Leads, deals, money records, consent records and the change log are never cleaned up here.
create or replace function public.retention_sweep(p_dry_run boolean default true)
returns table(what text, rows_found bigint, deleted boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare n bigint;
begin
  select count(*) into n from public.notifications where read_at is not null and created_at < now() - interval '180 days';
  what := 'read notifications older than 180 days'; rows_found := n; deleted := false;
  if not p_dry_run and n > 0 then delete from public.notifications where read_at is not null and created_at < now() - interval '180 days'; deleted := true; end if;
  return next;
  select count(*) into n from public.password_resets where status <> 'pending' and coalesce(resolved_at, created_at) < now() - interval '30 days';
  what := 'resolved password reset requests older than 30 days'; rows_found := n; deleted := false;
  if not p_dry_run and n > 0 then delete from public.password_resets where status <> 'pending' and coalesce(resolved_at, created_at) < now() - interval '30 days'; deleted := true; end if;
  return next;
  select (select count(*) from public.listing_inquiries where status = 'spam' and created_at < now() - interval '90 days')
       + (select count(*) from public.storefront_inquiries where status = 'spam' and created_at < now() - interval '90 days') into n;
  what := 'inquiries marked spam more than 90 days ago'; rows_found := n; deleted := false;
  if not p_dry_run and n > 0 then
    delete from public.listing_inquiries where status = 'spam' and created_at < now() - interval '90 days';
    delete from public.storefront_inquiries where status = 'spam' and created_at < now() - interval '90 days';
    deleted := true;
  end if;
  return next;
  select count(*) into n from public.agent_steps where created_at < now() - interval '180 days';
  what := 'Autopilot steps older than 180 days'; rows_found := n; deleted := false;
  if not p_dry_run and n > 0 then delete from public.agent_steps where created_at < now() - interval '180 days'; deleted := true; end if;
  return next;
end;
$function$;
revoke all on function public.retention_sweep(boolean) from public, anon, authenticated;
grant execute on function public.retention_sweep(boolean) to service_role;
