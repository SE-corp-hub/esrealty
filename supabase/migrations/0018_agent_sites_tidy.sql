-- Agent websites, tidy-up (2026-10-23). Safe to run twice. Apply with GitHub > Actions > Apply
-- database migration (test, then apply), AFTER 0017. No data changes and no new behaviour: rules
-- that were written out several times now live in one place each.
--
--   public_agent_sites()     the pages the public may see (published, nothing blocking). The page
--                            lookups, the directory, its count and check-an-agent all read it.
--   agent_deals(agent)       the deals that credit an agent within the deal's own team, with the
--                            closing date, side and rental flag. The track record, reviews, review
--                            links and the agent's own deal list all read it.
--   reply_label(minutes)     the reply-time words from minutes already worked out, so the directory
--                            no longer measures each agent twice.
--   licence_check_save(...)  the only way to save a licence check: who checked and when, and the
--                            ID and phone checks, decided in one place and one transaction (it
--                            replaces the stamping trigger and the browser's three-step save).
--   agent_reviews_admin()    the reviews for the Super Admin's Reviews tab; the table itself is no
--                            longer readable from the app.
--   routing_people(...)      lead routing's town rule and broker rotation share one "next in turn".

-- 1. The pages the public may see -------------------------------------------------------------------
-- Plain SQL without SECURITY DEFINER or SET, so the planner inlines it into each caller (which are
-- all SECURITY DEFINER functions for the server only); nothing in the app may call it.
create or replace function public.public_agent_sites() returns setof public.agent_sites
language sql stable as $$
  select s.* from public.agent_sites s
   where s.published_at is not null and s.data is not null
     and cardinality(public.agent_page_blockers(s.agent_id)) = 0 $$;

create or replace function public.agent_public_slug(p_agent uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select slug from public.public_agent_sites() where agent_id = p_agent $$;

create or replace function public.agent_page_lookup(p_slug text) returns uuid
language sql stable security definer set search_path to 'public' as $$
  select agent_id from public.public_agent_sites() where slug = lower(btrim(p_slug)) $$;

create or replace function public.public_agent(p_slug text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  a uuid := public.agent_page_lookup(p_slug);
begin
  if a is null then return null; end if;
  -- agent_id lets the listing function count visits and assign messages; it does not reach visitors.
  return (public.agent_page_build(a, false) - 'published_at' - 'featured') || jsonb_build_object('agent_id', a);
end $function$;

create or replace function public.public_agent_count() returns integer
language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from public.public_agent_sites() $$;

-- 2. Reply time in words, from minutes already worked out ------------------------------------------
create or replace function public.reply_label(m numeric) returns text language sql immutable as $$
  select case when m is null then null
              when m <= 30 then 'within 30 minutes'
              when m <= 60 then 'within an hour'
              when m <= 240 then 'within 4 hours'
              when m <= 1440 then 'within a day'
              else 'in more than a day' end $$;

create or replace function public.agent_reply_bucket(p_agent uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select public.reply_label(public.agent_reply_minutes(p_agent)) $$;

-- 3. The deals that credit an agent ------------------------------------------------------------------
-- Inlined like public_agent_sites(); deal_credit_ok() keeps credit inside the deal's own team.
create or replace function public.agent_deals(p_agent uuid)
returns table (id text, payload jsonb, broker_id uuid, created_by uuid, updated_at timestamptz,
               closed boolean, closed_on date, as_buyer boolean, as_seller boolean, rental boolean)
language sql stable as $$
  select t.id, t.payload, t.broker_id, t.created_by, t.updated_at,
         coalesce(t.payload ->> 'stage', '') in ('doas', 'done'),
         public.deal_closed_on(t.payload, t.updated_at),
         coalesce(t.payload ->> 'buyerAgentId' = p_agent::text, false),
         coalesce(t.payload ->> 'sellerAgentId' = p_agent::text, false),
         coalesce(t.payload ->> 'dealKind', '') = 'rental'
    from public.broker_transactions t
   where (t.payload ->> 'buyerAgentId' = p_agent::text or t.payload ->> 'sellerAgentId' = p_agent::text)
     and public.deal_credit_ok(t.broker_id, p_agent) $$;

-- Closed deals by side and rentals; with 36 months of records or more, the last 3 years only.
-- A deal is listed only if the client agreed, and its price only if they agreed to that too.
create or replace function public.agent_record(p_agent uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with done as (select * from public.agent_deals(p_agent) where closed),
  win as (select case when min(closed_on) < (current_date - interval '36 months')::date
                      then (current_date - interval '36 months')::date end as since from done),
  d as (select done.* from done, win where win.since is null or done.closed_on >= win.since)
  select jsonb_build_object(
    'deals', (select count(*) from d),
    'buyer', (select count(*) from d where as_buyer and not rental),
    'seller', (select count(*) from d where as_seller and not rental),
    'rentals', (select count(*) from d where rental),
    'since', (select to_char(min(closed_on), 'YYYY-MM') from d),
    'window', (select case when since is not null then '3y' end from win),
    'rows', coalesce((select jsonb_agg(r order by r ->> 'month' desc) from (
        select jsonb_strip_nulls(jsonb_build_object(
                 'month', to_char(d2.closed_on, 'YYYY-MM'),
                 'side', case when d2.rental then 'rental' when d2.as_buyer and d2.as_seller then 'both' when d2.as_buyer then 'buyer' else 'seller' end,
                 'type', l.property_type, 'town', nullif(l.city, ''),
                 'lot_sqm', l.lot_size_sqm, 'floor_sqm', l.floor_area_sqm,
                 'price', case when d2.payload ->> 'showPrice' = 'true' and coalesce(d2.payload ->> 'price', '') ~ '^[0-9]+(\.[0-9]+)?$'
                                and (d2.payload ->> 'price')::numeric > 0 then (d2.payload ->> 'price')::numeric end)) as r
          from d d2
          left join public.shared_listings l on l.id = d2.payload ->> 'listingId' and public.deal_credit_ok(d2.broker_id, l.owner_id)
         where d2.payload ->> 'showDeal' = 'true'
         order by d2.closed_on desc
         limit 10) rr), '[]'::jsonb)) $$;

create or replace function public.agent_reviews_live(p_agent uuid) returns setof public.agent_reviews
language sql stable security definer set search_path to 'public' as $$
  select r.* from public.agent_reviews r
   where r.agent_id = p_agent and r.status = 'approved'
     and exists (select 1 from public.agent_deals(p_agent) d where d.id = r.deal_id and d.closed) $$;

create or replace function public.agent_credited_deals() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'payload', d.payload - 'documents', 'broker_id', d.broker_id,
                                               'created_by', d.created_by, 'updated_at', d.updated_at) order by d.updated_at desc), '[]'::jsonb)
    from public.agent_deals(auth.uid()) d
   where exists (select 1 from public.profiles me where me.id = auth.uid() and me.registration_status = 'approved' and me.role::text in ('agent', 'broker')) $$;

create or replace function public.review_invite(p_deal text, p_agent uuid) returns text
language plpgsql security definer set search_path to 'public' as $function$
declare
  t record;
  token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  existing record;
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  select * into t from public.broker_transactions where id = p_deal;
  if t.id is null then raise exception 'No such deal'; end if;
  if coalesce(t.payload ->> 'stage', '') not in ('doas', 'done') then raise exception 'Reviews are for closed deals only (Deed of Absolute Sale or Completed).'; end if;
  if not exists (select 1 from public.agent_deals(p_agent) d where d.id = p_deal) then
    raise exception 'That agent is not the buyer''s or seller''s agent on this deal.';
  end if;
  select * into existing from public.agent_reviews where agent_id = p_agent and deal_id = p_deal;
  if existing.id is not null and existing.status <> 'invited' then raise exception 'This client has already sent their review.'; end if;
  insert into public.agent_reviews (agent_id, deal_id, token_hash, expires_at, created_by)
  values (p_agent, p_deal, encode(sha256(convert_to(token, 'UTF8')), 'hex'), now() + interval '30 days', auth.uid())
  on conflict (agent_id, deal_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at, created_by = excluded.created_by;
  return token;
end $function$;

-- 4. Directory and check-an-agent read the public pages --------------------------------------------
create or replace function public.public_agents(p_town text default null, p_need text default null, p_language text default null)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with a as (
    select s.agent_id, s.slug, s.data, s.updated_at, v.prc_name, v.checked_at, p.role::text as role,
           public.agent_reply_minutes(s.agent_id) as reply_min, public.agent_record(s.agent_id) as rec,
           (select count(*) from public.public_listing_catalog c where c.agent_id = s.agent_id and c.status = 'available') as listing_n,
           (select count(*) from public.agent_reviews_live(s.agent_id)) as review_n
      from public.public_agent_sites() s
      join public.profiles p on p.id = s.agent_id
      left join public.agent_verifications v on v.agent_id = s.agent_id
     where (nullif(p_town, '') is null or s.data -> 'towns' ? p_town)
       and (nullif(p_need, '') is null or s.data -> 'needs' ? p_need)
       and (nullif(p_language, '') is null or s.data -> 'languages' ? p_language)
  )
  select jsonb_build_object('total', count(*), 'agents', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'slug', slug, 'name', prc_name,
      'role_label', case when role = 'broker' then 'Real estate broker' else 'PRC-accredited real estate salesperson' end,
      'photo', nullif(data ->> 'photo', ''), 'pitch', nullif(data ->> 'pitch', ''),
      'towns', data -> 'towns', 'needs', data -> 'needs', 'languages', data -> 'languages',
      'viber', nullif(data -> 'contacts' ->> 'viber', ''),
      'licence_checked_on', (checked_at at time zone 'Asia/Manila')::date,
      'verified_on', public.agent_verified_on(agent_id),
      'reply', public.reply_label(reply_min),
      -- Counts with no record are left out (never shown as a zero).
      'listing_count', nullif(listing_n, 0),
      'deals', nullif((rec ->> 'deals')::int, 0),
      'deals_since', case when (rec ->> 'deals')::int > 0 then rec ->> 'since' end,
      'deals_window', case when (rec ->> 'deals')::int > 0 then rec ->> 'window' end,
      'review_count', nullif(review_n, 0)))
    order by reply_min asc nulls last, updated_at desc), '[]'::jsonb))
    from a $$;

-- Matches a licence number, or a contact number shown on a public page (the last 10 digits, so
-- 0917… and +63 917… are the same). Never searches unpublished agents or account phone numbers.
create or replace function public.agent_check(p_q text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with q as (select regexp_replace(coalesce(p_q, ''), '\D', '', 'g') as d),
  a as (
    select s.agent_id, s.slug, s.data, v.prc_name, v.licence_no, p.role::text as role
      from public.public_agent_sites() s
      join public.profiles p on p.id = s.agent_id
      join public.agent_verifications v on v.agent_id = s.agent_id
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('slug', a.slug, 'name', a.prc_name,
           'role_label', case when a.role = 'broker' then 'Real estate broker' else 'PRC-accredited real estate salesperson' end,
           'licence_no', a.licence_no, 'verified_on', public.agent_verified_on(a.agent_id)))), '[]'::jsonb)
    from a, q
   where length(q.d) >= 5
     and (regexp_replace(a.licence_no, '\D', '', 'g') = q.d
       or (length(q.d) >= 10 and right(q.d, 10) in (
             select right(regexp_replace(x, '\D', '', 'g'), 10)
               from jsonb_each_text(coalesce(a.data -> 'contacts', '{}'::jsonb)) as c(k, x)
              where k in ('call', 'viber', 'whatsapp')))) $$;

-- 5. Saving a licence check: one function, one transaction ------------------------------------------
-- The date moves when the licence details change or the office re-checks the PRC record. A tick on
-- "ID seen" or "phone confirmed" keeps its date while the identity (number and PRC name) stays the
-- same; saved with a new identity it counts as a fresh check, dated now (as the app's two-step save
-- did). Unticking clears the date.
create or replace function public.licence_check_save(
  p_agent uuid, p_licence_no text, p_prc_name text, p_valid_until date, p_broker_accepted boolean,
  p_id_seen boolean, p_phone_confirmed boolean, p_recheck boolean default false)
returns public.agent_verifications
language plpgsql security definer set search_path to 'public' as $function$
declare
  me uuid := auth.uid();
  who record;
  old public.agent_verifications;
  v public.agent_verifications;
  same_identity boolean;
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  select id, role::text as role into who from public.profiles where id = p_agent;
  if who.id is null or who.role not in ('broker', 'agent') then raise exception 'Licence checks are for brokers and agents.'; end if;
  if length(btrim(coalesce(p_licence_no, ''))) < 3 then raise exception 'Enter the licence or accreditation number.'; end if;
  if length(btrim(coalesce(p_prc_name, ''))) < 3 then raise exception 'Enter the name as it appears on the PRC record.'; end if;
  if p_valid_until is null then raise exception 'Enter the date the licence is valid until.'; end if;
  select * into old from public.agent_verifications where agent_id = p_agent for update;

  v.agent_id := p_agent;
  v.licence_type := case when who.role = 'broker' then 'broker' else 'salesperson' end;
  v.licence_no := btrim(p_licence_no);
  v.prc_name := btrim(p_prc_name);
  v.valid_until := p_valid_until;
  v.broker_accepted := coalesce(p_broker_accepted, false);
  same_identity := old.agent_id is not null and (v.licence_no, v.prc_name) = (old.licence_no, old.prc_name);
  if p_recheck or old.agent_id is null
     or (v.licence_type, v.licence_no, v.prc_name, v.valid_until, v.broker_accepted)
        is distinct from (old.licence_type, old.licence_no, old.prc_name, old.valid_until, old.broker_accepted) then
    v.checked_at := now(); v.checked_by := me;
  else
    v.checked_at := old.checked_at; v.checked_by := old.checked_by;
  end if;
  v.id_seen := coalesce(p_id_seen, false);
  if not v.id_seen then v.id_seen_at := null; v.id_seen_by := null;
  elsif same_identity and old.id_seen then v.id_seen_at := old.id_seen_at; v.id_seen_by := old.id_seen_by;
  else v.id_seen_at := now(); v.id_seen_by := me; end if;
  v.phone_confirmed := coalesce(p_phone_confirmed, false);
  if not v.phone_confirmed then v.phone_confirmed_at := null; v.phone_confirmed_by := null;
  elsif same_identity and old.phone_confirmed then v.phone_confirmed_at := old.phone_confirmed_at; v.phone_confirmed_by := old.phone_confirmed_by;
  else v.phone_confirmed_at := now(); v.phone_confirmed_by := me; end if;

  insert into public.agent_verifications select (v).*
  on conflict (agent_id) do update set
    licence_type = excluded.licence_type, licence_no = excluded.licence_no, prc_name = excluded.prc_name,
    valid_until = excluded.valid_until, broker_accepted = excluded.broker_accepted,
    checked_at = excluded.checked_at, checked_by = excluded.checked_by,
    id_seen = excluded.id_seen, id_seen_at = excluded.id_seen_at, id_seen_by = excluded.id_seen_by,
    phone_confirmed = excluded.phone_confirmed, phone_confirmed_at = excluded.phone_confirmed_at, phone_confirmed_by = excluded.phone_confirmed_by
  returning * into v;
  return v;
end $function$;

-- The function is the only writer from the app; the trigger that guessed intent from each write goes.
drop trigger if exists agent_verifications_stamp on public.agent_verifications;
drop function if exists public.agent_verifications_stamp();
revoke insert, update, delete on public.agent_verifications from authenticated;
drop policy if exists "licence checks admin write" on public.agent_verifications;

-- 6. Reviews for the Super Admin ---------------------------------------------------------------------
create or replace function public.agent_reviews_admin() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'agent_id', r.agent_id, 'deal_id', r.deal_id, 'status', r.status,
            'client_label', r.client_label, 'town', r.town, 'month', r.month, 'body', r.body, 'reply', r.reply,
            'submitted_at', r.submitted_at, 'expires_at', r.expires_at, 'created_at', r.created_at) order by r.created_at desc)
     from (select * from public.agent_reviews order by created_at desc limit 200) r), '[]'::jsonb);
end $function$;
-- Every read now goes through a function (Super Admin, the agent's own, the public page).
revoke select on public.agent_reviews from authenticated;
drop policy if exists "reviews read own or admin" on public.agent_reviews;

-- 7. Lead routing: one "next in turn" for the town rule and the brokers' rotation --------------------
-- Approved people from a routing list, in the list's order; brokers only when asked.
create or replace function public.routing_people(p_list jsonb, p_brokers_only boolean) returns uuid[]
language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(p.id order by x.ord), '{}')
    from jsonb_array_elements_text(case when jsonb_typeof(p_list) = 'array' then p_list else '[]'::jsonb end) with ordinality as x(id, ord)
    join public.profiles p on p.id::text = x.id
   where p.registration_status = 'approved'
     and (p.role::text = 'broker' or (not p_brokers_only and p.role::text = 'agent')) $$;

create or replace function public.crm_leads_route()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  cfg jsonb;
  town text;
  ids uuid[] := '{}';
  turn text[];
  why text;
  pick integer;
  chosen uuid;
  chosen_name text;
begin
  if new.assigned_to_id is not null or auth.uid() is not null then return new; end if;
  begin
    select value into cfg from public.site_settings where key = 'leadRouting' for update;
    if cfg is null or coalesce((cfg ->> 'enabled')::boolean, false) is not true then return new; end if;
    -- Town rule first, for Value Guide requests (they carry the town the visitor chose). A broker
    -- consultation or an appraisal request goes to the town's brokers, never to a salesperson.
    town := case when new.payload ? 'fullReport'
                 then public.agent_town_slug(coalesce(new.payload -> 'fullReport' -> 'inputs' ->> 'municipality', new.payload -> 'fullReport' -> 'location' ->> 'town'))
                 else '' end;
    if town <> '' then
      ids := public.routing_people(cfg -> 'towns' -> town, coalesce(new.payload ->> 'channel', '') in ('broker-consultation', 'professional-appraisal-request'));
      turn := array['townNext', town]; why := 'town rule';
      if cardinality(ids) > 0 and jsonb_typeof(cfg -> 'townNext') is distinct from 'object' then cfg := cfg || '{"townNext": {}}'; end if;
    end if;
    -- Otherwise the brokers take turns.
    if cardinality(ids) = 0 then
      ids := public.routing_people(cfg -> 'brokers', true);
      turn := array['next']; why := 'in turn';
    end if;
    if cardinality(ids) = 0 then return new; end if;
    pick := mod(greatest(coalesce((cfg #>> turn)::integer, 0), 0), cardinality(ids));
    chosen := ids[pick + 1];
    cfg := jsonb_set(cfg, turn, to_jsonb(pick + 1));
    select coalesce(nullif(btrim(full_name), ''), 'Agent') into chosen_name from public.profiles where id = chosen;
    new.assigned_to_id := chosen;
    new.assigned_to := chosen_name;
    new.payload := coalesce(new.payload, '{}'::jsonb)
      || jsonb_build_object('assignedToId', chosen::text, 'assignedTo', chosen_name)
      || jsonb_build_object('activity', coalesce(new.payload -> 'activity', '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object('date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                                   'text', 'Assigned to ' || chosen_name || ' automatically (lead routing, ' || why || ')')));
    update public.site_settings set value = cfg where key = 'leadRouting';
  exception when others then
    raise warning 'crm_leads_route: %', sqlerrm;  -- routing must never stop a lead from saving
  end;
  return new;
end;
$function$;

-- 8. Rights -------------------------------------------------------------------------------------------
revoke all on function public.public_agent_sites() from public, anon, authenticated;
revoke all on function public.agent_deals(uuid) from public, anon, authenticated;
revoke all on function public.routing_people(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.agent_public_slug(uuid) from public, anon, authenticated;
revoke all on function public.agent_page_lookup(text) from public, anon, authenticated;
revoke all on function public.public_agent(text) from public, anon, authenticated;
revoke all on function public.public_agent_count() from public, anon, authenticated;
revoke all on function public.public_agents(text, text, text) from public, anon, authenticated;
revoke all on function public.agent_check(text) from public, anon, authenticated;
revoke all on function public.agent_record(uuid) from public, anon, authenticated;
revoke all on function public.agent_reviews_live(uuid) from public, anon, authenticated;
grant execute on function public.agent_public_slug(uuid) to service_role;
grant execute on function public.agent_page_lookup(text) to service_role;
grant execute on function public.public_agent(text) to service_role;
grant execute on function public.public_agent_count() to service_role;
grant execute on function public.public_agents(text, text, text) to service_role;
grant execute on function public.agent_check(text) to service_role;
revoke all on function public.licence_check_save(uuid, text, text, date, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.licence_check_save(uuid, text, text, date, boolean, boolean, boolean, boolean) to authenticated;
revoke all on function public.agent_reviews_admin() from public, anon;
grant execute on function public.agent_reviews_admin() to authenticated;
revoke all on function public.agent_credited_deals() from public, anon;
grant execute on function public.agent_credited_deals() to authenticated;
revoke all on function public.review_invite(text, uuid) from public, anon;
grant execute on function public.review_invite(text, uuid) to authenticated;
