-- Agent websites, tidy-up after the code review (2026-10-23). Safe to run twice. Apply with GitHub >
-- Actions > Apply database migration (test, then apply), AFTER 0017. What visitors and agents see
-- does not change, with two exceptions noted below.
--
--   public_agent_sites()     the one rule for "this page is public" (published, has data, nothing
--                            blocking it). Every public lookup reads from it.
--   Typed deal columns       broker_transactions gains buyer_agent_id, seller_agent_id, show_deal,
--                            show_price, deal_kind and closed_on, kept in step with the payload by
--                            one trigger. Change 1: once a deal has closed only a Super Admin can
--                            change its agents, even after moving it back a stage ("credit is
--                            fixed at closing"), and a closed deal
--                            with no Deed of Sale date keeps the date it closed on instead of
--                            moving to its last save.
--   agent_closed_deals(a)    the one rule for "this closed deal credits this agent". The track
--                            record, the reviews and the review links all read from it.
--   agent_reply_label(m)     the reply-time wording, from minutes worked out once.
--   licence_check_save(...)  saving a licence check in one call and one transaction, in place of
--                            the app's three writes. Change 2: none for the person saving.

-- 1. One rule for a public page ---------------------------------------------------------------------

create or replace function public.public_agent_sites() returns setof public.agent_sites
language sql stable security definer set search_path to 'public' as $$
  select s.* from public.agent_sites s
   where s.published_at is not null and s.data is not null
     and cardinality(public.agent_page_blockers(s.agent_id)) = 0 $$;

create or replace function public.public_agent(p_slug text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  a uuid;
begin
  select agent_id into a from public.public_agent_sites() where slug = lower(btrim(p_slug));
  if a is null then return null; end if;
  -- agent_id lets the listing function count visits and assign messages; it does not reach visitors.
  return (public.agent_page_build(a, false) - 'published_at' - 'featured') || jsonb_build_object('agent_id', a);
end $function$;

create or replace function public.agent_public_slug(p_agent uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select slug from public.public_agent_sites() where agent_id = p_agent $$;

create or replace function public.agent_page_lookup(p_slug text) returns uuid
language sql stable security definer set search_path to 'public' as $$
  select agent_id from public.public_agent_sites() where slug = lower(btrim(p_slug)) $$;

create or replace function public.public_agent_count() returns integer
language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from public.public_agent_sites() $$;

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

-- 2. Reply time: the wording from minutes already worked out ----------------------------------------

create or replace function public.agent_reply_label(p_minutes numeric) returns text language sql immutable as $$
  select case when p_minutes is null then null
              when p_minutes <= 30 then 'within 30 minutes'
              when p_minutes <= 60 then 'within an hour'
              when p_minutes <= 240 then 'within 4 hours'
              when p_minutes <= 1440 then 'within a day'
              else 'in more than a day' end $$;

create or replace function public.agent_reply_bucket(p_agent uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select public.agent_reply_label(public.agent_reply_minutes(p_agent)) $$;

-- 3. Typed deal columns -----------------------------------------------------------------------------

-- A date typed into the deal form, or null when it is not a real date (2026-02-30 included).
create or replace function public.deal_date(p text) returns date language plpgsql immutable as $function$
begin
  if p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $function$;

create or replace function public.deal_closed_on(p jsonb, p_updated timestamptz) returns date language sql immutable as $$
  select coalesce(public.deal_date(p ->> 'doasDate'), (p_updated at time zone 'Asia/Manila')::date) $$;

-- First run only: the existing deals are filled below, once (a second run must not move closing dates).
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'broker_transactions' and column_name = 'closed_on') then
    create temp table broker_transactions_fill_once as select 1 as yes;
  end if;
end $$;
-- No foreign key: deleting an account would rewrite every deal naming it (new saved time, audit
-- rows). deal_agent() keeps only ids of existing accounts, and a deleted agent has no public page.
alter table public.broker_transactions add column if not exists buyer_agent_id uuid;
alter table public.broker_transactions add column if not exists seller_agent_id uuid;
alter table public.broker_transactions add column if not exists show_deal boolean not null default false;
alter table public.broker_transactions add column if not exists show_price boolean not null default false;
alter table public.broker_transactions add column if not exists deal_kind text not null default 'sale';
-- Set while the deal is closed (Deed of Absolute Sale or Completed), null otherwise.
alter table public.broker_transactions add column if not exists closed_on date;
create index if not exists broker_transactions_buyer_agent on public.broker_transactions (buyer_agent_id) where buyer_agent_id is not null;
create index if not exists broker_transactions_seller_agent on public.broker_transactions (seller_agent_id) where seller_agent_id is not null;

-- An agent id from the payload when it names an account, else null.
create or replace function public.deal_agent(p text) returns uuid
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  out uuid;
begin
  if p !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  select id into out from public.profiles where id = p::uuid;
  return out;
end $function$;

-- Runs after broker_transactions_set_updated_at (triggers run in name order), so a deal closed with
-- no Deed of Sale date takes the date of the save that closed it.
create or replace function public.broker_transactions_typed()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  closed boolean := coalesce(new.payload ->> 'stage', '') in ('doas', 'done');
begin
  new.buyer_agent_id := public.deal_agent(new.payload ->> 'buyerAgentId');
  new.seller_agent_id := public.deal_agent(new.payload ->> 'sellerAgentId');
  -- Credit is fixed at closing: once a deal has closed, only a Super Admin changes its agents, even
  -- if the deal is moved back to an earlier stage. Compared as accounts, so "" and a missing key
  -- (deals saved before the agent fields existed) are the same "nobody".
  if tg_op = 'UPDATE' and old.closed_on is not null
     and (new.buyer_agent_id, new.seller_agent_id) is distinct from (old.buyer_agent_id, old.seller_agent_id)
     and auth.uid() is not null and not public.is_super_admin() then
    raise exception 'The agents on a closed deal are fixed. Ask a Super Admin to correct them.' using errcode = '42501';
  end if;
  new.show_deal := coalesce(new.payload ->> 'showDeal', '') = 'true';
  new.show_price := new.show_deal and coalesce(new.payload ->> 'showPrice', '') = 'true';
  new.deal_kind := case when new.payload ->> 'dealKind' = 'rental' then 'rental' else 'sale' end;
  new.closed_on := case when not closed then null
                        else coalesce(public.deal_date(new.payload ->> 'doasDate'),
                                      case when tg_op = 'UPDATE' then old.closed_on end,
                                      (new.updated_at at time zone 'Asia/Manila')::date) end;
  return new;
end $function$;
drop trigger if exists broker_transactions_typed on public.broker_transactions;
create trigger broker_transactions_typed before insert or update on public.broker_transactions
  for each row execute function public.broker_transactions_typed();

-- Fill the columns for existing deals without touching their saved time or the audit log. The old
-- closing date (last save) is kept as the closing date.
do $$ begin
  if to_regclass('pg_temp.broker_transactions_fill_once') is null then return; end if;
  alter table public.broker_transactions disable trigger broker_transactions_set_updated_at;
  alter table public.broker_transactions disable trigger broker_transactions_audit;
  alter table public.broker_transactions disable trigger broker_transactions_typed;
  execute $q$ update public.broker_transactions set
    buyer_agent_id = public.deal_agent(payload ->> 'buyerAgentId'),
    seller_agent_id = public.deal_agent(payload ->> 'sellerAgentId'),
    show_deal = coalesce(payload ->> 'showDeal', '') = 'true',
    show_price = coalesce(payload ->> 'showDeal', '') = 'true' and coalesce(payload ->> 'showPrice', '') = 'true',
    deal_kind = case when payload ->> 'dealKind' = 'rental' then 'rental' else 'sale' end,
    closed_on = case when coalesce(payload ->> 'stage', '') in ('doas', 'done') then public.deal_closed_on(payload, updated_at) end $q$;
  alter table public.broker_transactions enable trigger broker_transactions_set_updated_at;
  alter table public.broker_transactions enable trigger broker_transactions_audit;
  alter table public.broker_transactions enable trigger broker_transactions_typed;
  drop table pg_temp.broker_transactions_fill_once;
end $$;

-- 4. One rule for "this closed deal credits this agent" ---------------------------------------------

create or replace function public.agent_closed_deals(p_agent uuid)
returns table (id text, broker_id uuid, payload jsonb, closed_on date, as_buyer boolean, as_seller boolean,
               rental boolean, show_deal boolean, show_price boolean)
language sql stable security definer set search_path to 'public' as $$
  select t.id, t.broker_id, t.payload, t.closed_on,
         t.buyer_agent_id is not distinct from p_agent, t.seller_agent_id is not distinct from p_agent,
         t.deal_kind = 'rental', t.show_deal, t.show_price
    from public.broker_transactions t
   where t.closed_on is not null
     and p_agent in (t.buyer_agent_id, t.seller_agent_id)
     and public.deal_credit_ok(t.broker_id, p_agent) $$;

-- One pass: with 36 months of records or more, the record covers the last 3 years ("in 3 years").
create or replace function public.agent_record(p_agent uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with b as (
    select d.*, min(d.closed_on) over () < (current_date - interval '36 months')::date as windowed
      from public.agent_closed_deals(p_agent) d
  ), a as (
    select b.*, not b.windowed or b.closed_on >= (current_date - interval '36 months')::date as shown from b
  )
  select jsonb_build_object(
    'deals', count(*) filter (where shown),
    'buyer', count(*) filter (where shown and as_buyer and not rental),
    'seller', count(*) filter (where shown and as_seller and not rental),
    'rentals', count(*) filter (where shown and rental),
    'since', to_char(min(closed_on) filter (where shown), 'YYYY-MM'),
    'window', case when bool_or(windowed) then '3y' end,
    'rows', coalesce((select jsonb_agg(r order by r ->> 'month' desc) from (
        select jsonb_strip_nulls(jsonb_build_object(
                 'month', to_char(d2.closed_on, 'YYYY-MM'),
                 'side', case when d2.rental then 'rental' when d2.as_buyer and d2.as_seller then 'both' when d2.as_buyer then 'buyer' else 'seller' end,
                 'type', l.property_type, 'town', nullif(l.city, ''),
                 'lot_sqm', l.lot_size_sqm, 'floor_sqm', l.floor_area_sqm,
                 'price', case when d2.show_price and coalesce(d2.payload ->> 'price', '') ~ '^[0-9]+(\.[0-9]+)?$' and (d2.payload ->> 'price')::numeric > 0 then (d2.payload ->> 'price')::numeric end)) as r
          from a d2
          left join public.shared_listings l on l.id = d2.payload ->> 'listingId' and public.deal_credit_ok(d2.broker_id, l.owner_id)
         where d2.shown and d2.show_deal
         order by d2.closed_on desc
         limit 10) rr), '[]'::jsonb))
  from a $$;

create or replace function public.agent_reviews_live(p_agent uuid) returns setof public.agent_reviews
language sql stable security definer set search_path to 'public' as $$
  select r.* from public.agent_reviews r
    join public.agent_closed_deals(p_agent) d on d.id = r.deal_id
   where r.agent_id = p_agent and r.status = 'approved' $$;

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
  if t.closed_on is null then raise exception 'Reviews are for closed deals only (Deed of Absolute Sale or Completed).'; end if;
  if not exists (select 1 from public.agent_closed_deals(p_agent) d where d.id = p_deal) then
    raise exception 'That agent is not the buyer''s or seller''s agent on this deal.';
  end if;
  select * into existing from public.agent_reviews where agent_id = p_agent and deal_id = p_deal;
  if existing.id is not null and existing.status <> 'invited' then raise exception 'This client has already sent their review.'; end if;
  insert into public.agent_reviews (agent_id, deal_id, token_hash, expires_at, created_by)
  values (p_agent, p_deal, encode(sha256(convert_to(token, 'UTF8')), 'hex'), now() + interval '30 days', auth.uid())
  on conflict (agent_id, deal_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at, created_by = excluded.created_by;
  return token;
end $function$;

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
         town = v_town, month = to_char(coalesce(t.closed_on, public.deal_closed_on(t.payload, t.updated_at)), 'YYYY-MM'),
         body = words, consent_at = now(), submitted_at = now()
   where id = r.id;
  return true;
end $function$;

create or replace function public.agent_credited_deals() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'payload', t.payload - 'documents', 'broker_id', t.broker_id,
                                               'created_by', t.created_by, 'updated_at', t.updated_at) order by t.updated_at desc), '[]'::jsonb)
    from public.broker_transactions t
   where exists (select 1 from public.profiles me where me.id = auth.uid() and me.registration_status = 'approved' and me.role::text in ('agent', 'broker'))
     and auth.uid() in (t.buyer_agent_id, t.seller_agent_id)
     and public.deal_credit_ok(t.broker_id, auth.uid()) $$;

-- 5. Directory: one public-page rule, reply time worked out once -----------------------------------

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
      'reply', public.agent_reply_label(reply_min),
      -- Counts with no record are left out (never shown as a zero).
      'listing_count', nullif(listing_n, 0),
      'deals', nullif((rec ->> 'deals')::int, 0),
      'deals_since', case when (rec ->> 'deals')::int > 0 then rec ->> 'since' end,
      'deals_window', case when (rec ->> 'deals')::int > 0 then rec ->> 'window' end,
      'review_count', nullif(review_n, 0)))
    order by reply_min asc nulls last, updated_at desc), '[]'::jsonb))
    into out from a;
  return out;
end $function$;

-- 6. Saving a licence check in one call -------------------------------------------------------------

-- p_fields: licence_type, licence_no, prc_name, valid_until, broker_accepted, and optionally id_seen
-- and phone_confirmed. p_recheck: "I checked the PRC record again today" (moves the check date).
-- A new licence number or PRC name clears the ID and phone checks (0016's trigger); ticks sent with
-- that change count as fresh checks of the new identity.
create or replace function public.licence_check_save(p_agent uuid, p_fields jsonb, p_recheck boolean default false)
returns public.agent_verifications
language plpgsql security definer set search_path to 'public' as $function$
declare
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  old_row public.agent_verifications;
  out public.agent_verifications;
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  select * into old_row from public.agent_verifications where agent_id = p_agent for update;
  insert into public.agent_verifications (agent_id, licence_type, licence_no, prc_name, valid_until, broker_accepted, id_seen, phone_confirmed)
  values (p_agent, f ->> 'licence_type', f ->> 'licence_no', f ->> 'prc_name', (f ->> 'valid_until')::date,
          coalesce((f ->> 'broker_accepted')::boolean, false),
          coalesce((f ->> 'id_seen')::boolean, old_row.id_seen, false),
          coalesce((f ->> 'phone_confirmed')::boolean, old_row.phone_confirmed, false))
  on conflict (agent_id) do update set
    licence_type = excluded.licence_type, licence_no = excluded.licence_no, prc_name = excluded.prc_name,
    valid_until = excluded.valid_until, broker_accepted = excluded.broker_accepted,
    id_seen = excluded.id_seen, phone_confirmed = excluded.phone_confirmed
  returning * into out;
  -- The ticks were cleared by the change of identity: record them again, as checks made today.
  if old_row.agent_id is not null and (out.id_seen, out.phone_confirmed) is distinct from
     (coalesce((f ->> 'id_seen')::boolean, old_row.id_seen), coalesce((f ->> 'phone_confirmed')::boolean, old_row.phone_confirmed)) then
    update public.agent_verifications
       set id_seen = coalesce((f ->> 'id_seen')::boolean, false), phone_confirmed = coalesce((f ->> 'phone_confirmed')::boolean, false)
     where agent_id = p_agent returning * into out;
  end if;
  if p_recheck and old_row.agent_id is not null then
    update public.agent_verifications set checked_at = null where agent_id = p_agent returning * into out;
  end if;
  return out;
end $function$;

-- 7. Rights -----------------------------------------------------------------------------------------

revoke all on function public.public_agent_sites() from public, anon, authenticated;
revoke all on function public.agent_closed_deals(uuid) from public, anon, authenticated;
revoke all on function public.deal_agent(text) from public, anon, authenticated;
revoke all on function public.agent_record(uuid) from public, anon, authenticated;
revoke all on function public.agent_reviews_live(uuid) from public, anon, authenticated;
revoke all on function public.public_agent(text) from public, anon, authenticated;
revoke all on function public.agent_public_slug(uuid) from public, anon, authenticated;
revoke all on function public.agent_page_lookup(text) from public, anon, authenticated;
revoke all on function public.public_agent_count() from public, anon, authenticated;
revoke all on function public.agent_check(text) from public, anon, authenticated;
revoke all on function public.agent_reply_bucket(uuid) from public, anon, authenticated;
revoke all on function public.public_agents(text, text, text) from public, anon, authenticated;
revoke all on function public.review_submit(text, text, text, text) from public, anon, authenticated;
grant execute on function public.public_agent(text) to service_role;
grant execute on function public.agent_public_slug(uuid) to service_role;
grant execute on function public.agent_page_lookup(text) to service_role;
grant execute on function public.public_agent_count() to service_role;
grant execute on function public.agent_check(text) to service_role;
grant execute on function public.public_agents(text, text, text) to service_role;
grant execute on function public.review_submit(text, text, text, text) to service_role;
revoke all on function public.review_invite(text, uuid) from public, anon;
grant execute on function public.review_invite(text, uuid) to authenticated;
revoke all on function public.agent_credited_deals() from public, anon;
grant execute on function public.agent_credited_deals() to authenticated;
revoke all on function public.licence_check_save(uuid, jsonb, boolean) from public, anon;
grant execute on function public.licence_check_save(uuid, jsonb, boolean) to authenticated;
