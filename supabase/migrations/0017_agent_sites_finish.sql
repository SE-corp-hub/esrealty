-- Agent websites, finishing work (2026-10-23). Safe to run twice. Apply with GitHub > Actions >
-- Apply database migration (test, then apply), AFTER 0016. Changes no existing data.
--
--   Track record     rental deals are counted on their own ("rentals"), and once an agent has 36
--                    months of records the record covers the last 3 years ("in 3 years").
--   Agents' deals    an agent can read the deals that credit them (read-only), within the team.
--   Directory        cards carry the Viber number the agent published, for a Viber button.
--   Preview image    a page keeps the 1200 x 630 image made when it is published (og_image).
--   Sign-up          Users & Access shows the licence number and supervising broker a broker or
--                    agent typed when signing up.
--   Pre-selling      a pre-selling listing leaves the public catalog when its DHSUD licence to sell
--                    has expired (the listing function asks for the date before publishing).

-- 1. Track record ---------------------------------------------------------------------------------
create or replace function public.agent_record(p_agent uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  out jsonb;
  first_close date;
  win date;
begin
  select min(public.deal_closed_on(t.payload, t.updated_at)) into first_close
    from public.broker_transactions t
   where t.payload ->> 'stage' in ('doas', 'done')
     and (t.payload ->> 'buyerAgentId' = p_agent::text or t.payload ->> 'sellerAgentId' = p_agent::text)
     and public.deal_credit_ok(t.broker_id, p_agent);
  -- With 36 months of records or more, the record covers the last 3 years ("in 3 years").
  if first_close < (current_date - interval '36 months')::date then win := (current_date - interval '36 months')::date; end if;
  with d as (
    select t.id, t.payload p, t.updated_at, t.broker_id,
           t.payload ->> 'buyerAgentId' = p_agent::text as as_buyer,
           t.payload ->> 'sellerAgentId' = p_agent::text as as_seller,
           public.deal_closed_on(t.payload, t.updated_at) as closed_on,
           coalesce(t.payload ->> 'dealKind', '') = 'rental' as rental
      from public.broker_transactions t
     where t.payload ->> 'stage' in ('doas', 'done')
       and (t.payload ->> 'buyerAgentId' = p_agent::text or t.payload ->> 'sellerAgentId' = p_agent::text)
       and public.deal_credit_ok(t.broker_id, p_agent)
       and (win is null or public.deal_closed_on(t.payload, t.updated_at) >= win)
  )
  select jsonb_build_object(
    'deals', count(*),
    'buyer', count(*) filter (where as_buyer and not rental),
    'seller', count(*) filter (where as_seller and not rental),
    'rentals', count(*) filter (where rental),
    'since', to_char(min(closed_on), 'YYYY-MM'),
    'window', case when win is not null then '3y' end,
    'rows', coalesce((select jsonb_agg(r order by r ->> 'month' desc) from (
        select jsonb_strip_nulls(jsonb_build_object(
                 'month', to_char(d2.closed_on, 'YYYY-MM'),
                 'side', case when d2.rental then 'rental' when d2.as_buyer and d2.as_seller then 'both' when d2.as_buyer then 'buyer' else 'seller' end,
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

-- 2. Agents read the deals that credit them -----------------------------------------------------
grant execute on function public.deal_credit_ok(uuid, uuid) to authenticated;
drop policy if exists "broker_transactions select credited agent" on public.broker_transactions;
create policy "broker_transactions select credited agent" on public.broker_transactions as permissive for select to authenticated
  using ((payload ->> 'buyerAgentId' = auth.uid()::text or payload ->> 'sellerAgentId' = auth.uid()::text)
         and public.deal_credit_ok(broker_id, auth.uid()));

-- 3. Directory: the published Viber number ------------------------------------------------------
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
      'viber', nullif(data -> 'contacts' ->> 'viber', ''),
      'licence_checked_on', (checked_at at time zone 'Asia/Manila')::date,
      'verified_on', public.agent_verified_on(agent_id),
      'reply', public.agent_reply_bucket(agent_id),
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

-- 4. Page data keeps the preview image ----------------------------------------------------------
create or replace function public.agent_site_clean(j jsonb) returns jsonb language plpgsql immutable as $function$
declare
  c jsonb := coalesce(j -> 'contacts', '{}'::jsonb);
  pick text[];
begin
  if jsonb_typeof(c) <> 'object' then c := '{}'::jsonb; end if;
  return jsonb_build_object(
    'pitch', left(btrim(coalesce(j ->> 'pitch', '')), 160),
    'bio', left(btrim(coalesce(j ->> 'bio', '')), 1500),
    'bio_lang', case when j ->> 'bio_lang' = 'fil' then 'fil' else 'en' end,
    'photo', case when coalesce(j ->> 'photo', '') ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/listing-photos/[A-Za-z0-9/_.-]+$'
                  and length(j ->> 'photo') <= 500 then j ->> 'photo' else '' end,
    'towns', to_jsonb(coalesce((select array_agg(distinct t) from jsonb_array_elements_text(
               case when jsonb_typeof(j -> 'towns') = 'array' then j -> 'towns' else '[]' end) t
               where t = any(public.agent_site_towns())), '{}')),
    'needs', to_jsonb(coalesce((select array_agg(distinct t) from jsonb_array_elements_text(
               case when jsonb_typeof(j -> 'needs') = 'array' then j -> 'needs' else '[]' end) t
               where t = any(public.agent_site_needs())), '{}')),
    'languages', to_jsonb(coalesce((select array_agg(distinct t) from jsonb_array_elements_text(
               case when jsonb_typeof(j -> 'languages') = 'array' then j -> 'languages' else '[]' end) t
               where t = any(public.agent_site_languages())), '{}')),
    'contacts', jsonb_strip_nulls(jsonb_build_object(
      'call', nullif(public.agent_site_phone(c ->> 'call'), ''),
      'viber', nullif(public.agent_site_phone(c ->> 'viber'), ''),
      'whatsapp', nullif(public.agent_site_phone(c ->> 'whatsapp'), ''),
      'messenger', case when coalesce(c ->> 'messenger', '') ~ '^[A-Za-z0-9.]{1,50}$' then c ->> 'messenger' end)),
    'sections', to_jsonb(coalesce((select array_agg(distinct t) from jsonb_array_elements_text(
               case when jsonb_typeof(j -> 'sections') = 'array' then j -> 'sections' else '[]' end) t
               where t = any(array['listings', 'about', 'video'])), '{}')),
    'accent', case when j ->> 'accent' in ('rust', 'sea', 'forest', 'ink') then j ->> 'accent' else 'rust' end,
    'og_image', case when coalesce(j ->> 'og_image', '') ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/listing-photos/[A-Za-z0-9/_.-]+\.png$'
                     and length(j ->> 'og_image') <= 500 then j ->> 'og_image' else '' end,
    'featured', to_jsonb(coalesce((select (array_agg(t))[1:6] from jsonb_array_elements_text(
               case when jsonb_typeof(j -> 'featured') = 'array' then j -> 'featured' else '[]' end) t
               where t ~ '^[A-Za-z0-9_-]{1,80}$'), '{}'))
  );
end $function$;

-- 5. Sign-up details in Users & Access ------------------------------------------------------------
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
      'requested_prc', left(coalesce(u.raw_user_meta_data ->> 'requested_prc', ''), 40)::text,
      'requested_broker', left(coalesce(u.raw_user_meta_data ->> 'requested_broker', ''), 120)::text,
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

-- 6. Expired pre-selling listings leave the public catalog ----------------------------------------
create or replace view public.public_listing_catalog with (security_barrier=true, security_invoker=true) as  SELECT listing.id,
    listing.ref,
    listing.title,
    listing.description,
    listing.property_type,
    listing.offer_type,
    listing.status,
    listing.price,
    listing.rent,
    listing.address,
    listing.barangay,
    listing.city,
    listing.province,
    listing.region,
    listing.postal_code,
    listing.latitude,
    listing.longitude,
    listing.bedrooms,
    listing.bathrooms,
    listing.floor_area_sqm,
    round(listing.floor_area_sqm * 10.7639, 2) AS floor_area_sqft,
    listing.lot_size_sqm,
    round(listing.lot_size_sqm * 10.7639, 2) AS lot_size_sqft,
    listing.year_built,
    listing.featured,
    listing.owner_id AS agent_id,
    profile.full_name AS agent_name,
    listing.views,
    listing.inquiries,
    listing.published_at,
    listing.updated_at,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', image.id, 'url', image.url, 'altText', image.alt_text, 'displayOrder', image.display_order) ORDER BY image.display_order, image.created_at) AS jsonb_agg
           FROM listing_images image
          WHERE image.listing_id = listing.id), '[]'::jsonb) AS images,
        CASE
            WHEN listing.offer_type = 'rent'::text THEN listing.rent
            ELSE listing.price
        END AS display_price
   FROM shared_listings listing
     LEFT JOIN profiles profile ON profile.id = listing.owner_id
  WHERE listing.is_published
    AND NOT (listing.status = 'pre-selling'
             AND COALESCE(listing.payload ->> 'licenseToSellUntil', '') ~ '^\d{4}-\d{2}-\d{2}$'
             AND (listing.payload ->> 'licenseToSellUntil')::date < (now() AT TIME ZONE 'Asia/Manila')::date);

revoke all on function public.agent_record(uuid) from public, anon, authenticated;
revoke all on function public.public_agents(text, text, text) from public, anon, authenticated;
grant execute on function public.public_agents(text, text, text) to service_role;
