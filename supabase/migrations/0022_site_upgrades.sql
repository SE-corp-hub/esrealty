-- Website upgrades (2026-11-09). Safe to run twice.
-- Apply with GitHub > Actions > Apply database migration (test, then apply), AFTER 0021,
-- and before the listing function that uses it is deployed.
--
--   1. Price changes. When a published listing's asking price or rent changes, the old and new
--      figures are kept, so the listing page can show its price history and a "Reduced" tag.
--   2. "Checked by SEA ESTATES". The office (a Super Admin or broker) can mark a listing as checked
--      (title seen, seller confirmed). The listing function saves it in the listing's payload as
--      officeChecked; nobody else can set it.
--   3. The public catalog gets two columns at the end: office_checked and previous_price (the
--      higher price before the latest cut in the last 90 days, or null).
--   4. Saved searches. A signed-in buyer saves a search; a daily job (saved_search_sweep) puts a
--      notification in their bell, and on their phone if they turned alerts on, when a new listing
--      matches. Saved and removed through the listing function only.

-- 1. Price changes ---------------------------------------------------------------------------------
create table if not exists public.listing_price_changes (
  id bigserial primary key,
  listing_id text not null references public.shared_listings (id) on delete cascade,
  offer_type text not null default 'sale',
  old_price numeric(15,2) not null,
  new_price numeric(15,2) not null,
  changed_at timestamptz not null default now()
);
create index if not exists listing_price_changes_listing_idx on public.listing_price_changes (listing_id, changed_at desc);
alter table public.listing_price_changes enable row level security;
revoke all on public.listing_price_changes from public, anon, authenticated;
revoke all on sequence public.listing_price_changes_id_seq from public, anon, authenticated;
grant all on public.listing_price_changes to service_role;
grant usage, select on sequence public.listing_price_changes_id_seq to service_role;

create or replace function public.listing_price_change_log() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_old numeric := case when old.offer_type = 'rent' then old.rent else old.price end;
  v_new numeric := case when new.offer_type = 'rent' then new.rent else new.price end;
begin
  -- Only a real change to a published listing's own figure, sale to sale or rent to rent.
  if new.is_published and old.is_published and new.offer_type = old.offer_type
     and coalesce(v_old, 0) > 0 and coalesce(v_new, 0) > 0 and v_old is distinct from v_new then
    insert into public.listing_price_changes (listing_id, offer_type, old_price, new_price)
    values (new.id, new.offer_type, v_old, v_new);
  end if;
  return new;
end $function$;
revoke all on function public.listing_price_change_log() from public, anon, authenticated;

drop trigger if exists listing_price_change_log on public.shared_listings;
create trigger listing_price_change_log after update of price, rent on public.shared_listings
  for each row execute function public.listing_price_change_log();

-- The price before the latest cut in the last 90 days, when it was higher than today's price.
-- Security definer, so the catalog (read with the caller's rights) can show it without opening the table.
create or replace function public.listing_previous_price(p_listing text) returns numeric
language sql stable security definer set search_path to 'public' as $function$
  select c.old_price
  from public.listing_price_changes c
  where c.listing_id = p_listing and c.changed_at > now() - interval '90 days'
  order by c.changed_at desc, c.id desc
  limit 1;
$function$;
revoke all on function public.listing_previous_price(text) from public;
grant execute on function public.listing_previous_price(text) to anon, authenticated, service_role;

-- 2 + 3. The public catalog, with office_checked and previous_price at the end ----------------------
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
        END AS display_price,
    COALESCE(listing.payload -> 'officeChecked' = 'true'::jsonb, false) AS office_checked,
        CASE
            WHEN public.listing_previous_price(listing.id) > (CASE WHEN listing.offer_type = 'rent'::text THEN listing.rent ELSE listing.price END)
            THEN public.listing_previous_price(listing.id)
        END AS previous_price
   FROM shared_listings listing
     LEFT JOIN profiles profile ON profile.id = listing.owner_id
  WHERE listing.is_published
    AND NOT (listing.status = 'pre-selling'
             AND COALESCE(listing.payload ->> 'licenseToSellUntil', '') ~ '^\d{4}-\d{2}-\d{2}$'
             -- Compared as text, so a malformed date can never break the catalog for everyone.
             AND (listing.payload ->> 'licenseToSellUntil') < to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD'));

-- 4. Saved searches --------------------------------------------------------------------------------
create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null default '' check (char_length(label) <= 200),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) < 4000),
  created_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  last_alert_at timestamptz
);
create index if not exists saved_searches_user_idx on public.saved_searches (user_id);
alter table public.saved_searches enable row level security;
revoke all on public.saved_searches from public, anon, authenticated;
grant all on public.saved_searches to service_role;
-- People may read and remove their own (the listing function does both with the server key; this
-- keeps a direct read from the app safe too).
grant select, delete on public.saved_searches to authenticated;
drop policy if exists saved_searches_own_read on public.saved_searches;
create policy saved_searches_own_read on public.saved_searches for select to authenticated using (user_id = auth.uid());
drop policy if exists saved_searches_own_delete on public.saved_searches;
create policy saved_searches_own_delete on public.saved_searches for delete to authenticated using (user_id = auth.uid());

-- Does a catalog listing match a saved search's filters? Same filters as the website's search.
create or replace function public.saved_search_matches(f jsonb, c public.public_listing_catalog) returns boolean
language plpgsql immutable set search_path to 'public' as $function$
declare
  w text;
begin
  if coalesce(f ->> 'city', '') <> '' and c.city not ilike '%' || (f ->> 'city') || '%' then return false; end if;
  if coalesce(f ->> 'state', '') <> '' and c.province not ilike '%' || (f ->> 'state') || '%' then return false; end if;
  if coalesce(f ->> 'property_type', '') <> '' and c.property_type is distinct from (f ->> 'property_type') then return false; end if;
  if coalesce(f ->> 'offer_type', '') <> '' and c.offer_type is distinct from (f ->> 'offer_type') then return false; end if;
  if coalesce(f ->> 'max_price', '') ~ '^\d+(\.\d+)?$' and c.display_price > (f ->> 'max_price')::numeric then return false; end if;
  if coalesce(f ->> 'min_price', '') ~ '^\d+(\.\d+)?$' and c.display_price < (f ->> 'min_price')::numeric then return false; end if;
  if coalesce(f ->> 'beds', '') ~ '^\d+$' and c.bedrooms < (f ->> 'beds')::int then return false; end if;
  if coalesce(f ->> 'checked', '') = 'true' and not c.office_checked then return false; end if;
  -- Every keyword word in the title, description, address, barangay or city.
  foreach w in array regexp_split_to_array(btrim(lower(coalesce(f ->> 'q', ''))), '\s+') loop
    continue when w = '';
    if position(w in lower(concat_ws(' ', c.title, c.description, c.address, c.barangay, c.city, c.ref))) = 0 then return false; end if;
  end loop;
  return true;
end $function$;
revoke all on function public.saved_search_matches(jsonb, public.public_listing_catalog) from public, anon, authenticated;

-- The daily job: each saved search gets at most one notification a day, for listings published
-- since it was last checked. A dry run only counts and changes nothing.
create or replace function public.saved_search_sweep(p_dry_run boolean default true)
returns table(search_id uuid, owner_id uuid, matches integer, alerted boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare
  s record;
  v_n integer;
  v_first record;
  v_label text;
begin
  for s in select * from public.saved_searches order by created_at loop
    select count(*) into v_n from public.public_listing_catalog c
      where c.published_at > s.last_checked_at and c.status in ('available', 'rfo', 'pre-selling')
        and public.saved_search_matches(s.filters, c);
    search_id := s.id; owner_id := s.user_id; matches := v_n; alerted := false;
    if not p_dry_run then
      if v_n > 0 and (s.last_alert_at is null or s.last_alert_at < now() - interval '20 hours') then
        select c.title, c.city, c.display_price, c.offer_type into v_first from public.public_listing_catalog c
          where c.published_at > s.last_checked_at and c.status in ('available', 'rfo', 'pre-selling')
            and public.saved_search_matches(s.filters, c)
          order by c.published_at desc limit 1;
        v_label := coalesce(nullif(btrim(s.label), ''), 'your saved search');
        perform public.notify_user(s.user_id, 'info',
          left(case when v_n = 1 then 'New listing for ' else v_n || ' new listings for ' end || v_label, 200),
          left('Newest: ' || coalesce(nullif(btrim(v_first.title), ''), 'Property')
            || coalesce(' in ' || nullif(btrim(v_first.city), ''), '')
            || ', P' || to_char(coalesce(v_first.display_price, 0), 'FM999,999,999,999')
            || case when v_first.offer_type = 'rent' then '/mo' else '' end
            || '. Open Properties on the SEA ESTATES website to see it.', 500), 'listings');
        update public.saved_searches set last_checked_at = now(), last_alert_at = now() where id = s.id;
        alerted := true;
      elsif v_n = 0 then
        update public.saved_searches set last_checked_at = now() where id = s.id;
      end if;
    end if;
    return next;
  end loop;
end $function$;
revoke all on function public.saved_search_sweep(boolean) from public, anon, authenticated;
grant execute on function public.saved_search_sweep(boolean) to service_role;

select
  to_regclass('public.saved_searches') is not null as saved_searches_ready,
  to_regclass('public.listing_price_changes') is not null as price_changes_ready;
