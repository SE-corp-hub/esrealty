-- Agent websites, Phases 2 and 3: directory, town routing, Verified badge, check-an-agent, track
-- record and client reviews (2026-10-23). Safe to run twice. Apply with GitHub > Actions > Apply
-- database migration (test, then apply), AFTER 0015. Changes no existing data.
--
-- Phase 2
--   public_agents(town, need, language)  the directory: published agents that pass every check,
--                                        measured reply time first. For the listing function only.
--   agent_public_slug(agent)             the page address of a listing's agent, when public, for
--                                        the "Listed by" line.
--   agent_page_lookup(slug)              the agent behind a page address, for leads sent from it.
--   Town routing                         lead routing (0009) gains town rules: a Value Guide lead
--                                        for a town goes to that town's agents in turn, before the
--                                        brokers' rotation. Order when rules disagree: the agent page
--                                        the visitor chose, then the earlier lead's owner (0012),
--                                        then the town rule, then the rotation.
-- Phase 3
--   Verified badge    a Super Admin records that a government ID was seen and the phone confirmed;
--                     Verified shows while both are on record and the licence check holds.
--   agent_check(q)    check-an-agent: matches licence numbers and published contact numbers of
--                     public pages only. For the listing function only.
--   Track record      deals (broker_transactions) name a buyer's agent and a seller's agent; closed
--                     deals are counted by side. A deal is listed only if the client agreed, and its
--                     price only if they agreed to that too (both off by default).
--   Reviews           the office makes a one-time link from a closed deal (valid 30 days). The client
--                     writes the review and agrees to show their first name and initial, the town and
--                     the month. A Super Admin approves it under a published rule. The agent may reply
--                     once and cannot delete it. No stars.

-- 1. Reply time as a number (minutes), so the directory can sort by it ---------------------------

create or replace function public.agent_reply_minutes(p_agent uuid) returns numeric
language sql stable security definer set search_path to 'public' as $$
  with l as (
    select case
      when first_contacted_at is not null and first_contacted_by = p_agent
        then extract(epoch from (first_contacted_at - created_at)) / 60
      when coalesce(nullif(payload ->> 'status', ''), 'new') = 'new' and created_at < now() - interval '24 hours'
        then 1441 end as mins
    from public.crm_leads
    -- Leads the agent typed in for themselves do not count: only leads that came to them.
    where assigned_to_id = p_agent and created_by is distinct from p_agent and created_at > now() - interval '90 days'
  )
  select case when count(mins) >= 5 then percentile_cont(0.5) within group (order by mins)::numeric end from l where mins is not null $$;

create or replace function public.agent_reply_bucket(p_agent uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select case when m is null then null
              when m <= 30 then 'within 30 minutes'
              when m <= 60 then 'within an hour'
              when m <= 240 then 'within 4 hours'
              when m <= 1440 then 'within a day'
              else 'in more than a day' end
  from (select public.agent_reply_minutes(p_agent) as m) x $$;

-- 2. Verified: ID seen and phone confirmed --------------------------------------------------------

alter table public.agent_verifications add column if not exists id_seen boolean not null default false;
alter table public.agent_verifications add column if not exists id_seen_at timestamptz;
alter table public.agent_verifications add column if not exists id_seen_by uuid;
alter table public.agent_verifications add column if not exists phone_confirmed boolean not null default false;
alter table public.agent_verifications add column if not exists phone_confirmed_at timestamptz;
alter table public.agent_verifications add column if not exists phone_confirmed_by uuid;

-- The licence check date changes only when the licence details change; ticking the ID or phone
-- check stamps its own date. Only "checked, by whom, when" is kept, never the ID itself.
create or replace function public.agent_verifications_stamp()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  new.licence_no := btrim(new.licence_no);
  new.prc_name := btrim(new.prc_name);
  -- The date moves when the licence details change, or when the office re-checks and saves with
  -- checked_at sent empty ("I checked the PRC record again today").
  if tg_op = 'INSERT' or new.checked_at is null or (new.licence_type, new.licence_no, new.prc_name, new.valid_until, new.broker_accepted)
       is distinct from (old.licence_type, old.licence_no, old.prc_name, old.valid_until, old.broker_accepted) then
    new.checked_by := auth.uid();
    new.checked_at := now();
  else
    new.checked_by := old.checked_by;
    new.checked_at := old.checked_at;
  end if;
  -- A different licence number or PRC name is a different identity: the ID and phone checks start again.
  if tg_op = 'UPDATE' and (new.licence_no, new.prc_name) is distinct from (old.licence_no, old.prc_name) then
    new.id_seen := false; new.phone_confirmed := false;
  end if;
  if new.id_seen and (tg_op = 'INSERT' or not old.id_seen) then new.id_seen_at := now(); new.id_seen_by := auth.uid();
  elsif not new.id_seen then new.id_seen_at := null; new.id_seen_by := null;
  else new.id_seen_at := old.id_seen_at; new.id_seen_by := old.id_seen_by; end if;
  if new.phone_confirmed and (tg_op = 'INSERT' or not old.phone_confirmed) then new.phone_confirmed_at := now(); new.phone_confirmed_by := auth.uid();
  elsif not new.phone_confirmed then new.phone_confirmed_at := null; new.phone_confirmed_by := null;
  else new.phone_confirmed_at := old.phone_confirmed_at; new.phone_confirmed_by := old.phone_confirmed_by; end if;
  return new;
end $function$;

create or replace function public.agent_verified_on(p_agent uuid) returns date
language sql stable security definer set search_path to 'public' as $$
  select (greatest(v.id_seen_at, v.phone_confirmed_at) at time zone 'Asia/Manila')::date
    from public.agent_verifications v
   where v.agent_id = p_agent and v.id_seen and v.phone_confirmed and v.valid_until >= current_date $$;

-- 3. Track record: two agents per deal, the client's say on what is shown -------------------------

-- A deal's closing date: the Deed of Absolute Sale date when given, else when it was last saved.
create or replace function public.deal_closed_on(p jsonb, p_updated timestamptz) returns date language sql immutable as $$
  select coalesce(case when p ->> 'doasDate' ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'doasDate')::date end, (p_updated at time zone 'Asia/Manila')::date) $$;

-- Who may be credited on a deal: anyone on a Super Admin's deal; on a broker's deal, the broker and
-- the agents they supervise. Brokers write their own deals from the app, so a broker cannot credit
-- (or borrow listings from) another team.
create or replace function public.deal_credit_ok(p_owner uuid, p_person uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select p_person is not null and (
         p_person = p_owner
      or exists (select 1 from public.profiles o where o.id = p_owner and o.role::text = 'super-admin')
      or exists (select 1 from public.profiles a where a.id = p_person and a.broker = p_owner)) $$;

create or replace function public.agent_record(p_agent uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  out jsonb;
begin
  with d as (
    select t.id, t.payload p, t.updated_at, t.broker_id,
           t.payload ->> 'buyerAgentId' = p_agent::text as as_buyer,
           t.payload ->> 'sellerAgentId' = p_agent::text as as_seller,
           public.deal_closed_on(t.payload, t.updated_at) as closed_on
      from public.broker_transactions t
     where t.payload ->> 'stage' in ('doas', 'done')
       and (t.payload ->> 'buyerAgentId' = p_agent::text or t.payload ->> 'sellerAgentId' = p_agent::text)
       and public.deal_credit_ok(t.broker_id, p_agent)
  )
  select jsonb_build_object(
    'deals', count(*),
    'buyer', count(*) filter (where as_buyer),
    'seller', count(*) filter (where as_seller),
    'since', to_char(min(closed_on), 'YYYY-MM'),
    'rows', coalesce((select jsonb_agg(r order by r ->> 'month' desc) from (
        select jsonb_strip_nulls(jsonb_build_object(
                 'month', to_char(d2.closed_on, 'YYYY-MM'),
                 'side', case when d2.as_buyer and d2.as_seller then 'both' when d2.as_buyer then 'buyer' else 'seller' end,
                 'type', l.property_type, 'town', nullif(l.city, ''),
                 'lot_sqm', l.lot_size_sqm, 'floor_sqm', l.floor_area_sqm,
                 'price', case when d2.p ->> 'showPrice' = 'true' and coalesce(d2.p ->> 'price', '') ~ '^[0-9]+(\.[0-9]+)?$' and (d2.p ->> 'price')::numeric > 0 then (d2.p ->> 'price')::numeric end)) as r
          from d d2
          left join public.shared_listings l on l.id = d2.p ->> 'listingId' and public.deal_credit_ok(d2.broker_id, l.owner_id)
         where d2.p ->> 'showDeal' = 'true'
         order by d2.closed_on desc
         limit 10) rr), '[]'::jsonb))
    into out from d;
  return out;
end $function$;

-- 4. Reviews --------------------------------------------------------------------------------------

create table if not exists public.agent_reviews (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id) on delete cascade,
  deal_id text not null,
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '30 days',
  status text not null default 'invited' check (status in ('invited', 'submitted', 'approved', 'rejected')),
  client_label text,
  town text,
  month text,
  body text,
  consent_at timestamptz,
  submitted_at timestamptz,
  moderated_by uuid,
  moderated_at timestamptz,
  reply text,
  reply_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (agent_id, deal_id)
);
alter table public.agent_reviews enable row level security;
revoke all on public.agent_reviews from anon, authenticated;
-- Every column but the link's hash.
revoke select on public.agent_reviews from authenticated;
grant select (id, agent_id, deal_id, expires_at, status, client_label, town, month, body, consent_at, submitted_at,
              moderated_by, moderated_at, reply, reply_at, created_by, created_at) on public.agent_reviews to authenticated;
drop policy if exists "reviews read own or admin" on public.agent_reviews;
create policy "reviews read own or admin" on public.agent_reviews for select to authenticated
  using (public.is_super_admin() or (agent_id = auth.uid() and status = 'approved'));

-- The office makes a link for one agent on one closed deal. Returns the secret part of the link once;
-- only its hash is kept. Making it again gives a fresh link (the old one stops working).
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
  if (p_agent::text is distinct from t.payload ->> 'buyerAgentId' and p_agent::text is distinct from t.payload ->> 'sellerAgentId')
     or not public.deal_credit_ok(t.broker_id, p_agent) then
    raise exception 'That agent is not the buyer''s or seller''s agent on this deal.';
  end if;
  select * into existing from public.agent_reviews where agent_id = p_agent and deal_id = p_deal;
  if existing.id is not null and existing.status <> 'invited' then raise exception 'This client has already sent their review.'; end if;
  insert into public.agent_reviews (agent_id, deal_id, token_hash, expires_at, created_by)
  values (p_agent, p_deal, encode(sha256(convert_to(token, 'UTF8')), 'hex'), now() + interval '30 days', auth.uid())
  on conflict (agent_id, deal_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at, created_by = excluded.created_by;
  return token;
end $function$;

-- What the review form shows for a link (listing function only): whose review it is, and whether
-- it can still be used. Nothing about the client.
create or replace function public.review_lookup(p_hash text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'agent', coalesce(v.prc_name, p.full_name),
    'open', r.status = 'invited' and r.expires_at > now(),
    'status', case when r.status <> 'invited' then 'used' when r.expires_at <= now() then 'expired' else 'open' end)
    from public.agent_reviews r
    join public.profiles p on p.id = r.agent_id
    left join public.agent_verifications v on v.agent_id = r.agent_id
   where r.token_hash = p_hash $$;

-- The client's review (listing function only). The town and month come from the deal, not the client.
create or replace function public.review_submit(p_hash text, p_first text, p_initial text, p_body text) returns boolean
language plpgsql security definer set search_path to 'public' as $function$
declare
  r record; t record; v_town text;
  first_name text := left(btrim(coalesce(p_first, '')), 40);
  initial text := upper(left(regexp_replace(coalesce(p_initial, ''), '[^A-Za-z]', '', 'g'), 1));
  words text := left(btrim(coalesce(p_body, '')), 1200);
begin
  select * into r from public.agent_reviews where token_hash = p_hash for update;
  if r.id is null or r.status <> 'invited' or r.expires_at <= now() then return false; end if;
  if length(first_name) < 1 or length(words) < 20 then raise exception 'Write your first name and at least a sentence about the agent.'; end if;
  select * into t from public.broker_transactions where id = r.deal_id;
  select nullif(city, '') into v_town from public.shared_listings where id = t.payload ->> 'listingId' and public.deal_credit_ok(t.broker_id, owner_id);
  update public.agent_reviews
     set status = 'submitted', client_label = first_name || case when initial <> '' then ' ' || initial || '.' else '' end,
         town = v_town, month = to_char(public.deal_closed_on(t.payload, t.updated_at), 'YYYY-MM'),
         body = words, consent_at = now(), submitted_at = now()
   where id = r.id;
  return true;
end $function$;

-- A Super Admin publishes or declines a review (the rule is shown in Users & Access).
create or replace function public.review_moderate(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Choose approved or rejected'; end if;
  update public.agent_reviews set status = p_status, moderated_by = auth.uid(), moderated_at = now()
   where id = p_id and status in ('submitted', 'approved', 'rejected');
end $function$;

-- The agent may answer a published review once.
create or replace function public.review_reply(p_id uuid, p_text text) returns void
language plpgsql security definer set search_path to 'public' as $function$
declare
  words text := left(btrim(coalesce(p_text, '')), 600);
begin
  if length(words) < 2 then raise exception 'Write a reply first.'; end if;
  update public.agent_reviews set reply = words, reply_at = now()
   where id = p_id and agent_id = auth.uid() and status = 'approved' and reply is null;
  if not found then raise exception 'You can reply once to each published review.'; end if;
end $function$;

-- Published reviews whose deal is still closed and still credits the agent ("Linked to a closed deal").
create or replace function public.agent_reviews_live(p_agent uuid) returns setof public.agent_reviews
language sql stable security definer set search_path to 'public' as $$
  select r.* from public.agent_reviews r
    join public.broker_transactions t on t.id = r.deal_id
   where r.agent_id = p_agent and r.status = 'approved'
     and t.payload ->> 'stage' in ('doas', 'done')
     and (t.payload ->> 'buyerAgentId' = p_agent::text or t.payload ->> 'sellerAgentId' = p_agent::text)
     and public.deal_credit_ok(t.broker_id, p_agent) $$;

create or replace function public.agent_reviews_public(p_agent uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('label', client_label, 'town', town, 'month', month, 'body', body, 'reply', reply))
                            order by submitted_at desc), '[]'::jsonb)
    from (select * from public.agent_reviews_live(p_agent) order by submitted_at desc limit 12) r $$;

-- 5. The page, with Phase 2 and 3 parts ------------------------------------------------------------

create or replace function public.agent_public_slug(p_agent uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select s.slug from public.agent_sites s
   where s.agent_id = p_agent and s.published_at is not null and s.data is not null
     and cardinality(public.agent_page_blockers(p_agent)) = 0 $$;

create or replace function public.agent_page_lookup(p_slug text) returns uuid
language sql stable security definer set search_path to 'public' as $$
  select s.agent_id from public.agent_sites s
   where s.slug = lower(btrim(p_slug)) and s.published_at is not null and s.data is not null
     and cardinality(public.agent_page_blockers(s.agent_id)) = 0 $$;

-- 0015's page, plus Verified, the track record and approved reviews. Same name and arguments, so the
-- editor's preview and public_agent pick these up.
create or replace function public.agent_page_build(p_agent uuid, p_draft boolean) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  s record; p record; v record; bp record; bv record;
  d jsonb; feat text[];
begin
  select * into s from public.agent_sites where agent_id = p_agent;
  if s.agent_id is null then return null; end if;
  d := public.agent_site_clean(case when p_draft then s.draft else coalesce(s.data, '{}'::jsonb) end);
  select id, role::text as role, full_name, broker into p from public.profiles where id = p_agent;
  select * into v from public.agent_verifications where agent_id = p_agent;
  -- Always assigned (no row gives nulls): a broker's page failed with "record bv is not assigned yet"
  -- when it was the first page built on a connection (0015).
  select full_name into bp from public.profiles where id = p.broker;
  select * into bv from public.agent_verifications where agent_id = p.broker;
  feat := array(select jsonb_array_elements_text(d -> 'featured'));
  return d || jsonb_build_object(
    'slug', s.slug,
    'published_at', s.published_at,
    'name', coalesce(v.prc_name, nullif(btrim(p.full_name), ''), 'Agent'),
    'role', case when p.role = 'broker' then 'broker' else 'salesperson' end,
    'role_label', case when p.role = 'broker' then 'Real estate broker' else 'PRC-accredited real estate salesperson' end,
    'licence', case when v.agent_id is null then null else jsonb_build_object(
      'no', v.licence_no, 'valid_until', v.valid_until, 'checked_on', (v.checked_at at time zone 'Asia/Manila')::date) end,
    'verified_on', public.agent_verified_on(p_agent),
    'broker', case when p.role = 'agent' then jsonb_build_object(
      'name', coalesce(bv.prc_name, nullif(btrim(bp.full_name), ''), ''), 'licence_no', coalesce(bv.licence_no, '')) end,
    'reply', public.agent_reply_bucket(p_agent),
    'record', public.agent_record(p_agent),
    'reviews', public.agent_reviews_public(p_agent),
    'listing_count', (select count(*) from public.public_listing_catalog c where c.agent_id = p_agent and c.status = 'available'),
    'listings', coalesce((select jsonb_agg(to_jsonb(x) - 'pos' order by x.pos, x.published_at desc) from (
        select c.id, c.title, c.property_type, c.offer_type, c.price, c.rent, c.display_price, c.barangay, c.city,
               c.province, c.lot_size_sqm, c.floor_area_sqm, c.bedrooms, c.bathrooms, c.published_at,
               c.images -> 0 ->> 'url' as image,
               coalesce(array_position(feat, c.id), 99) as pos
          from public.public_listing_catalog c
         where c.agent_id = p_agent and c.status = 'available'
         order by coalesce(array_position(feat, c.id), 99), c.published_at desc
         limit 24) x), '[]'::jsonb)
  );
end $function$;

-- The editor also sees the agent's published reviews, to reply once.
create or replace function public.agent_site_reviews() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', client_label, 'town', town, 'month', month, 'body', body, 'reply', reply)
                            order by submitted_at desc), '[]'::jsonb)
    from public.agent_reviews_live(auth.uid()) $$;

-- 6. Directory ------------------------------------------------------------------------------------

create or replace function public.public_agents(p_town text default null, p_need text default null, p_language text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  out jsonb;
begin
  with a as (
    select s.agent_id, s.slug, s.data, s.published_at, s.updated_at, v.prc_name, v.checked_at, p.role::text as role,
           public.agent_reply_minutes(s.agent_id) as reply_min, public.agent_record(s.agent_id) as rec,
           (select count(*) from public.public_listing_catalog c where c.agent_id = s.agent_id and c.status = 'available') as listing_n,
           (select count(*) from public.agent_reviews_live(s.agent_id)) as review_n
      from public.agent_sites s
      join public.profiles p on p.id = s.agent_id
      left join public.agent_verifications v on v.agent_id = s.agent_id
     where s.published_at is not null and s.data is not null
       and cardinality(public.agent_page_blockers(s.agent_id)) = 0
       and (nullif(p_town, '') is null or s.data -> 'towns' ? p_town)
       and (nullif(p_need, '') is null or s.data -> 'needs' ? p_need)
       and (nullif(p_language, '') is null or s.data -> 'languages' ? p_language)
  )
  select jsonb_build_object('total', count(*), 'agents', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'slug', slug, 'name', prc_name,
      'role_label', case when role = 'broker' then 'Real estate broker' else 'PRC-accredited real estate salesperson' end,
      'photo', nullif(data ->> 'photo', ''), 'pitch', nullif(data ->> 'pitch', ''),
      'towns', data -> 'towns', 'needs', data -> 'needs', 'languages', data -> 'languages',
      'licence_checked_on', (checked_at at time zone 'Asia/Manila')::date,
      'verified_on', public.agent_verified_on(agent_id),
      'reply', public.agent_reply_bucket(agent_id),
      -- Counts with no record are left out (never shown as a zero).
      'listing_count', nullif(listing_n, 0),
      'deals', nullif((rec ->> 'deals')::int, 0),
      'deals_since', case when (rec ->> 'deals')::int > 0 then rec ->> 'since' end,
      'review_count', nullif(review_n, 0)))
    order by reply_min asc nulls last, updated_at desc), '[]'::jsonb))
    into out from a;
  return out;
end $function$;

-- How many pages the directory would list, for the menu link (no per-agent work).
create or replace function public.public_agent_count() returns integer
language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from public.agent_sites s
   where s.published_at is not null and s.data is not null and cardinality(public.agent_page_blockers(s.agent_id)) = 0 $$;

-- 7. Check an agent -------------------------------------------------------------------------------

-- Matches a licence number, or a contact number shown on a public page (the last 10 digits, so
-- 0917… and +63 917… are the same). Never searches unpublished agents or account phone numbers.
create or replace function public.agent_check(p_q text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with q as (select regexp_replace(coalesce(p_q, ''), '\D', '', 'g') as d),
  a as (
    select s.agent_id, s.slug, s.data, v.prc_name, v.licence_no, p.role::text as role
      from public.agent_sites s
      join public.profiles p on p.id = s.agent_id
      join public.agent_verifications v on v.agent_id = s.agent_id
     where s.published_at is not null and s.data is not null and cardinality(public.agent_page_blockers(s.agent_id)) = 0
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

-- 8. Town routing ---------------------------------------------------------------------------------

-- "LIPA CITY" or "Sta. Teresita" -> lipa-city, sta-teresita (the Value Guide's slugs).
create or replace function public.agent_town_slug(p text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')) $$;

create or replace function public.crm_leads_route()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  cfg jsonb;
  ids uuid[];
  n integer;
  pick integer;
  chosen uuid;
  chosen_name text;
  town text;
  why text;
begin
  if new.assigned_to_id is not null or auth.uid() is not null then return new; end if;
  begin
    select value into cfg from public.site_settings where key = 'leadRouting' for update;
    if cfg is null or coalesce((cfg ->> 'enabled')::boolean, false) is not true then return new; end if;
    -- Town rule first: approved brokers and agents listed for the lead's town, in turn.
    -- Value Guide requests only (they carry the town the visitor chose). A broker consultation or an
    -- appraisal request goes to the town's brokers, never to a salesperson.
    town := case when new.payload ? 'fullReport'
                 then public.agent_town_slug(coalesce(new.payload -> 'fullReport' -> 'inputs' ->> 'municipality', new.payload -> 'fullReport' -> 'location' ->> 'town'))
                 else '' end;
    if town <> '' and jsonb_typeof(cfg -> 'towns' -> town) = 'array' then
      select coalesce(array_agg(p.id order by x.ord), '{}') into ids
        from jsonb_array_elements_text(cfg -> 'towns' -> town) with ordinality as x(id, ord)
        join public.profiles p on p.id::text = x.id
       where p.registration_status = 'approved'
         and (p.role::text = 'broker' or (p.role::text = 'agent'
              and coalesce(new.payload ->> 'channel', '') not in ('broker-consultation', 'professional-appraisal-request')));
    else
      ids := '{}';
    end if;
    n := cardinality(ids);
    if n > 0 then
      pick := mod(greatest(coalesce((cfg -> 'townNext' ->> town)::integer, 0), 0), n);
      chosen := ids[pick + 1];
      cfg := jsonb_set(cfg, array['townNext'], coalesce(cfg -> 'townNext', '{}'::jsonb) || jsonb_build_object(town, pick + 1));
      why := 'town rule';
    else
      select coalesce(array_agg(p.id order by x.ord), '{}') into ids
        from jsonb_array_elements_text(coalesce(cfg -> 'brokers', '[]'::jsonb)) with ordinality as x(id, ord)
        join public.profiles p on p.id::text = x.id
       where p.role = 'broker' and p.registration_status = 'approved';
      n := cardinality(ids);
      if n = 0 then return new; end if;
      pick := mod(greatest(coalesce((cfg ->> 'next')::integer, 0), 0), n);
      chosen := ids[pick + 1];
      cfg := jsonb_set(cfg, '{next}', to_jsonb(pick + 1));
      why := 'in turn';
    end if;
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

-- 9. Rights ---------------------------------------------------------------------------------------

revoke all on function public.agent_reply_minutes(uuid) from public, anon, authenticated;
revoke all on function public.agent_verified_on(uuid) from public, anon, authenticated;
revoke all on function public.agent_record(uuid) from public, anon, authenticated;
revoke all on function public.agent_reviews_public(uuid) from public, anon, authenticated;
revoke all on function public.agent_public_slug(uuid) from public, anon, authenticated;
revoke all on function public.agent_page_lookup(text) from public, anon, authenticated;
revoke all on function public.public_agents(text, text, text) from public, anon, authenticated;
revoke all on function public.public_agent_count() from public, anon, authenticated;
revoke all on function public.deal_credit_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function public.agent_reviews_live(uuid) from public, anon, authenticated;
revoke all on function public.agent_check(text) from public, anon, authenticated;
revoke all on function public.review_lookup(text) from public, anon, authenticated;
revoke all on function public.review_submit(text, text, text, text) from public, anon, authenticated;
grant execute on function public.agent_public_slug(uuid) to service_role;
grant execute on function public.agent_page_lookup(text) to service_role;
grant execute on function public.public_agents(text, text, text) to service_role;
grant execute on function public.public_agent_count() to service_role;
grant execute on function public.agent_check(text) to service_role;
grant execute on function public.review_lookup(text) to service_role;
grant execute on function public.review_submit(text, text, text, text) to service_role;
revoke all on function public.review_invite(text, uuid) from public, anon;
revoke all on function public.review_moderate(uuid, text) from public, anon;
revoke all on function public.review_reply(uuid, text) from public, anon;
revoke all on function public.agent_site_reviews() from public, anon;
grant execute on function public.review_invite(text, uuid) to authenticated;
grant execute on function public.review_moderate(uuid, text) to authenticated;
grant execute on function public.review_reply(uuid, text) to authenticated;
grant execute on function public.agent_site_reviews() to authenticated;
