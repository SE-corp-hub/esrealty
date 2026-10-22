-- Find a person: export and erase on request; last sign-in in Users & Access (2026-10-22).
-- Safe to run twice. Apply with GitHub > Actions > Apply database migration (test, then apply),
-- AFTER 0012 (it uses crm_norm_phone / crm_norm_email from 0012). Changes no data by itself.
-- Backend roadmap items B2 (privacy requests) and K4 (admin tools). Super Admin only.
--
-- Under the Data Privacy Act a person may ask what you hold about them, and ask for it to be
-- erased. A person's details sit in several places (leads, website inquiries, Property Management
-- tenants and owners, accounts, pre-selling reservations). These functions find them in one go:
--
--   admin_person_find(query)          where this person appears (by phone, email or name)
--   admin_person_export(query)        the full records, to give to the person
--   admin_person_erase(query, dry)    deletes their leads and website inquiries, matched by
--                                     phone or email only (never by name alone)
--
-- What erase keeps, and why: Property Management records (leases, payments, receipts), accounts,
-- deals and pre-selling reservations are business and tax records and are changed in their own
-- screens, not here. The change log records that an erase happened, with counts only (no personal
-- data). Ask your privacy officer or lawyer what must be kept before erasing.

-- Phone, email or name a search can use. A phone needs 7+ digits; a name 3+ letters.
create or replace function public.person_query_parts(p_query text, out q_phone text, out q_email text, out q_name text)
language plpgsql immutable as $function$
declare v text := btrim(coalesce(p_query, ''));
begin
  q_email := case when v ~ '@' then public.crm_norm_email(v) end;
  q_phone := case when q_email is null and length(regexp_replace(v, '\D', '', 'g')) >= 7 then public.crm_norm_phone(v) end;
  q_name := case when q_email is null and q_phone is null and length(v) >= 3 then lower(v) end;
end;
$function$;

create or replace function public.admin_person_find(p_query text)
returns table(source text, record_id text, name text, email text, phone text, created_at timestamptz, note text)
language plpgsql stable security definer set search_path to 'public', 'auth' as $function$
declare qp record;
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  select * into qp from public.person_query_parts(p_query);
  if qp.q_phone is null and qp.q_email is null and qp.q_name is null then
    raise exception 'Enter a phone number (7+ digits), an email, or at least 3 letters of a name' using errcode = '22023';
  end if;
  return query
  with hits as (
    select 'lead'::text s, l.id::text i, coalesce(nullif(l.name, ''), l.payload ->> 'name') n, l.payload ->> 'email' e, l.payload ->> 'phone' p, l.created_at c,
           coalesce(nullif(l.payload ->> 'status', ''), 'new') || coalesce(' · ' || nullif(l.ref, ''), '') t
      from public.crm_leads l
    union all
    select 'listing inquiry', li.id::text, li.full_name, li.email, li.phone, li.created_at, li.listing_id from public.listing_inquiries li
    union all
    select 'website inquiry', si.id::text, si.full_name, si.email, si.phone, si.created_at, si.inquiry_type from public.storefront_inquiries si
    union all
    select 'PMS tenant', t.id, t.data ->> 'name', t.data ->> 'email', t.data ->> 'phone', t.created_at, case when t.archived then 'archived' else '' end from public.pms_tenants t
    union all
    select 'PMS owner', o.id, o.data ->> 'name', o.data ->> 'email', o.data ->> 'phone', o.created_at, case when o.archived then 'archived' else '' end from public.pms_owners o
    union all
    select 'account', pr.id::text, pr.full_name, coalesce(nullif(pr.email, ''), u.email), pr.phone, pr.created_at, pr.role::text || ' · ' || pr.registration_status
      from public.profiles pr left join auth.users u on u.id = pr.id
  )
  select h.s, h.i, h.n, h.e, h.p, h.c, h.t from hits h
   where (qp.q_phone is not null and public.crm_norm_phone(h.p) = qp.q_phone)
      or (qp.q_email is not null and public.crm_norm_email(h.e) = qp.q_email)
      or (qp.q_name is not null and lower(coalesce(h.n, '')) like '%' || replace(replace(qp.q_name, '%', ''), '_', '') || '%')
   order by h.c desc nulls last
   limit 200;
end;
$function$;

-- The full records behind a find, for the person who asked. Name-only searches are refused here:
-- an export goes to one person, so it must match by phone or email.
create or replace function public.admin_person_export(p_query text)
returns jsonb language plpgsql volatile security definer set search_path to 'public', 'auth' as $function$
declare qp record; out jsonb;
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  select * into qp from public.person_query_parts(p_query);
  if qp.q_phone is null and qp.q_email is null then raise exception 'Export needs a phone number or an email' using errcode = '22023'; end if;
  select jsonb_build_object(
    'leads', coalesce((select jsonb_agg(to_jsonb(l) - 'created_by' - 'assigned_to_id') from public.crm_leads l
      where public.crm_norm_phone(l.payload ->> 'phone') = qp.q_phone or public.crm_norm_email(l.payload ->> 'email') = qp.q_email), '[]'::jsonb),
    'listing_inquiries', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.listing_inquiries x
      where public.crm_norm_phone(x.phone) = qp.q_phone or public.crm_norm_email(x.email) = qp.q_email), '[]'::jsonb),
    'website_inquiries', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.storefront_inquiries x
      where public.crm_norm_phone(x.phone) = qp.q_phone or public.crm_norm_email(x.email) = qp.q_email), '[]'::jsonb),
    'pms_tenants', coalesce((select jsonb_agg(x.data) from public.pms_tenants x
      where public.crm_norm_phone(x.data ->> 'phone') = qp.q_phone or public.crm_norm_email(x.data ->> 'email') = qp.q_email), '[]'::jsonb),
    'pms_owners', coalesce((select jsonb_agg(x.data) from public.pms_owners x
      where public.crm_norm_phone(x.data ->> 'phone') = qp.q_phone or public.crm_norm_email(x.data ->> 'email') = qp.q_email), '[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('full_name', pr.full_name, 'email', coalesce(nullif(pr.email, ''), u.email), 'phone', pr.phone, 'role', pr.role, 'status', pr.registration_status, 'created_at', pr.created_at))
      from public.profiles pr left join auth.users u on u.id = pr.id
      where public.crm_norm_phone(pr.phone) = qp.q_phone or public.crm_norm_email(coalesce(nullif(pr.email, ''), u.email)) = qp.q_email), '[]'::jsonb)
  ) into out;
  insert into public.audit_events (owner_id, event_type, entity_type, entity_id, detail)
  values (auth.uid(), 'person_exported', 'person', '', jsonb_build_object('by', case when qp.q_email is not null then 'email' else 'phone' end,
    'records', (select sum(jsonb_array_length(v)) from jsonb_each(out) e(k, v))));
  return jsonb_build_object('exportedAt', now(), 'records', out);
end;
$function$;

-- Erase a person's leads and website inquiries (phone or email match only). With p_dry_run (the
-- default) nothing is deleted: it says what would go.
create or replace function public.admin_person_erase(p_query text, p_dry_run boolean default true)
returns table(what text, rows_found integer, deleted boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare qp record; n integer;
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  select * into qp from public.person_query_parts(p_query);
  if qp.q_phone is null and qp.q_email is null then raise exception 'Erase needs a phone number or an email' using errcode = '22023'; end if;

  select count(*) into n from public.crm_leads l where public.crm_norm_phone(l.payload ->> 'phone') = qp.q_phone or public.crm_norm_email(l.payload ->> 'email') = qp.q_email;
  if not p_dry_run and n > 0 then delete from public.crm_leads l where public.crm_norm_phone(l.payload ->> 'phone') = qp.q_phone or public.crm_norm_email(l.payload ->> 'email') = qp.q_email; end if;
  what := 'leads'; rows_found := n; deleted := not p_dry_run and n > 0; return next;

  select count(*) into n from public.listing_inquiries x where public.crm_norm_phone(x.phone) = qp.q_phone or public.crm_norm_email(x.email) = qp.q_email;
  if not p_dry_run and n > 0 then delete from public.listing_inquiries x where public.crm_norm_phone(x.phone) = qp.q_phone or public.crm_norm_email(x.email) = qp.q_email; end if;
  what := 'listing inquiries'; rows_found := n; deleted := not p_dry_run and n > 0; return next;

  select count(*) into n from public.storefront_inquiries x where public.crm_norm_phone(x.phone) = qp.q_phone or public.crm_norm_email(x.email) = qp.q_email;
  if not p_dry_run and n > 0 then delete from public.storefront_inquiries x where public.crm_norm_phone(x.phone) = qp.q_phone or public.crm_norm_email(x.email) = qp.q_email; end if;
  what := 'website inquiries'; rows_found := n; deleted := not p_dry_run and n > 0; return next;

  if not p_dry_run then
    insert into public.audit_events (owner_id, event_type, entity_type, entity_id, detail)
    values (auth.uid(), 'person_erased', 'person', '', jsonb_build_object('by', case when qp.q_email is not null then 'email' else 'phone' end));
  end if;
end;
$function$;

revoke all on function public.person_query_parts(text) from public, anon, authenticated;
revoke all on function public.admin_person_find(text) from public, anon, authenticated;
revoke all on function public.admin_person_export(text) from public, anon, authenticated;
revoke all on function public.admin_person_erase(text, boolean) from public, anon, authenticated;
grant execute on function public.person_query_parts(text) to authenticated, service_role;
grant execute on function public.admin_person_find(text) to authenticated, service_role;
grant execute on function public.admin_person_export(text) to authenticated, service_role;
grant execute on function public.admin_person_erase(text, boolean) to authenticated, service_role;

-- K4: last sign-in in the Users & Access list (same fields as before, plus last_sign_in_at).
create or replace function public.admin_list_profiles()
returns setof jsonb language plpgsql security definer set search_path to 'public', 'auth' as $function$
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
      'created_at', p.created_at::text,
      'last_sign_in_at', (to_jsonb(u) ->> 'last_sign_in_at'))
    from public.profiles p join auth.users u on u.id = p.id
    order by case p.registration_status when 'pending' then 0 when 'approved' then 1 else 2 end, p.created_at desc;
end;
$function$;

select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('admin_person_find', 'admin_person_export', 'admin_person_erase', 'person_query_parts'))::int as person_functions;
