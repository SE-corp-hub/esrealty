-- Alert fixes and four access-rule fixes (2026-10-21). Safe to run twice.
--
-- Apply with GitHub > Actions > Apply database migration (test, then apply).
-- Changes no data. Backend roadmap items A1, A2, C1, C2, C3, C5.
--
-- 1. Alerts for website inquiries and website leads (A1, A2).
--    A visitor who is not signed in has no user id, so "owner <> user_id" was
--    never true and the listing's agent was never told about the inquiry. The
--    lead saved with it is made by the agent's own id, and an alert skipped the
--    person who "made" the lead, so the agent was not told about that either.
--    The same rule hid website leads from the oldest super-admin, the account
--    the website saves them under. The person to skip is now the signed-in
--    person who did the saving (auth.uid()). A website visit, a Facebook lead
--    or a report request has nobody signed in, so nobody is skipped.
--    A lead made from a listing inquiry no longer alerts the listing's owner a
--    second time: they already get "New inquiry".
-- 2. Leads can only be created by an approved broker or agent, or a super-admin
--    (C2). Until now any approved account could, including buyers and tenants.
-- 3. Compliance records are readable only by approved accounts (C3). Update,
--    delete and insert already required approval; reading did not, so a
--    pending or declined broker could read the whole book.
-- 4. Pre-selling payment schedules are readable by super-admins, approved
--    brokers and agents, and by the buyer who reserved that unit (C1). Until
--    now every approved account could read every buyer's schedule. The unit
--    list itself is unchanged (see "Left as it is" at the end).
-- 5. increment_shared_listing_stat() is no longer open to visitors (C5). It
--    refused them anyway; now they cannot call it at all.

-- 1a. Inquiry alert: a visitor's inquiry (user_id is null) now alerts the owner.
create or replace function public.notify_on_new_inquiry()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare listing_owner uuid;
declare listing_title text;
begin
  select owner_id, title into listing_owner, listing_title
  from public.shared_listings where id = new.listing_id;
  if listing_owner is not null and listing_owner is distinct from new.user_id then
    perform public.notify_user(
      listing_owner, 'inquiry',
      'New inquiry: ' || coalesce(listing_title, 'your listing'),
      coalesce(new.full_name, 'Someone') || ' (' || coalesce(new.contact_type, 'buyer') || ') is interested.',
      'listings'
    );
  end if;
  return new;
end;
$function$;

-- 1b. Lead alert: skip the signed-in person who saved it, not "created_by".
create or replace function public.notify_on_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  actor uuid := auth.uid();
  listing_owner uuid;
  who text := coalesce(nullif(btrim(new.name), ''), 'a new lead');
  src text := coalesce('From ' || nullif(btrim(new.payload ->> 'source'), '') || '. ', '');
begin
  begin
    if tg_op = 'INSERT' then
      if new.assigned_to_id is not null then
        -- A lead made from a listing inquiry: the listing's owner was told by
        -- the inquiry alert already.
        if new.payload ->> 'source' = 'listing' then
          select owner_id into listing_owner from public.shared_listings
          where id = nullif(new.payload ->> 'listingId', '');
        end if;
        if new.assigned_to_id is distinct from actor and new.assigned_to_id is distinct from listing_owner then
          perform public.notify_user(new.assigned_to_id, 'lead', 'New lead for you: ' || who, src || 'Open Leads to call them.', 'leads');
        end if;
      else
        for r in select id from public.profiles
                 where registration_status = 'approved' and role::text = 'super-admin' and id is distinct from actor loop
          perform public.notify_user(r.id, 'lead', 'New lead: ' || who, src || 'Not assigned to anyone yet.', 'leads');
        end loop;
      end if;
    elsif new.assigned_to_id is not null and new.assigned_to_id is distinct from old.assigned_to_id
          and new.assigned_to_id is distinct from actor then
      perform public.notify_user(new.assigned_to_id, 'lead', 'Lead assigned to you: ' || who, src || 'Open Leads to call them.', 'leads');
    end if;
  exception when others then
    -- an alert must never stop a lead from saving; say so in the database log
    raise warning 'notify_on_lead: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.notify_on_lead() from public, anon, authenticated;

-- 2. Who may create a lead.
create or replace function public.crm_current_user_can_manage_leads()
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and registration_status = 'approved' and role::text in ('broker', 'agent')
  );
$function$;
revoke all on function public.crm_current_user_can_manage_leads() from public, anon, authenticated;
grant execute on function public.crm_current_user_can_manage_leads() to anon, authenticated, service_role;

drop policy if exists "crm_leads insert own" on public.crm_leads;
create policy "crm_leads insert own" on public.crm_leads as permissive for insert to public
  with check (is_super_admin() or (crm_current_user_can_manage_leads() and created_by = auth.uid()));

-- 3. Compliance records: reading needs an approved account, like every other action.
drop policy if exists compliance_read_own_chain on public.compliance_records;
create policy compliance_read_own_chain on public.compliance_records as permissive for select to public
  using (
    auth.uid() = owner
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.registration_status = 'approved'
        and (p.role = any (array['super-admin'::app_role, 'broker'::app_role])
             or address_book_profile_accessible(coalesce(compliance_records.owner::text, ''), p.id))
    )
  );

-- 4. Pre-selling payment schedules: staff, or the buyer who reserved that unit.
create or replace function public.presell_current_user_is_staff()
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and registration_status = 'approved'
      and role::text in ('super-admin', 'broker', 'agent')
  );
$function$;
revoke all on function public.presell_current_user_is_staff() from public, anon, authenticated;
grant execute on function public.presell_current_user_is_staff() to anon, authenticated, service_role;

create or replace function public.presell_unit_is_mine(p_unit_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from public.presell_units u
    where u.id = p_unit_id and u.reserved_by = auth.uid()
  ) and public.listing_current_user_is_approved();
$function$;
revoke all on function public.presell_unit_is_mine(uuid) from public, anon, authenticated;
grant execute on function public.presell_unit_is_mine(uuid) to anon, authenticated, service_role;

drop policy if exists "presell payments read auth" on public.presell_payments;
drop policy if exists "presell payments read staff or own unit" on public.presell_payments;
create policy "presell payments read staff or own unit" on public.presell_payments as permissive for select to public
  using (presell_current_user_is_staff() or presell_unit_is_mine(unit_id));

-- 5. Statistics counter: signed-in app only (the website API uses the service role).
revoke all on function public.increment_shared_listing_stat(text, text) from public, anon, authenticated;
grant execute on function public.increment_shared_listing_stat(text, text) to service_role;

-- Left as it is: presell_units still shows reserved_for / reserved_by to every
-- approved account. Hiding one column needs a separate view and an app change.

-- Check: lead_insert_policy 1, payments_policy 1, compliance_policy 1, old_payments_policy 0, helper_functions 3.
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'crm_leads' and policyname = 'crm_leads insert own')::int as lead_insert_policy,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'presell_payments' and policyname = 'presell payments read staff or own unit')::int as payments_policy,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'compliance_records' and policyname = 'compliance_read_own_chain')::int as compliance_policy,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'presell_payments' and policyname = 'presell payments read auth')::int as old_payments_policy,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('crm_current_user_can_manage_leads', 'presell_current_user_is_staff', 'presell_unit_is_mine'))::int as helper_functions;
