-- Modern listings data model. Review before running in the Supabase SQL Editor.
-- Run after schema.sql and shared_listings.sql. This migration is additive and
-- preserves the existing shared_listings IDs and JSON payload contract.

begin;

alter table public.shared_listings
  add column if not exists description text not null default '',
  add column if not exists property_type text not null default 'house-and-lot',
  add column if not exists offer_type text not null default 'sale',
  add column if not exists price numeric(15,2) not null default 0,
  add column if not exists rent numeric(15,2) not null default 0,
  add column if not exists address text not null default '',
  add column if not exists barangay text not null default '',
  add column if not exists city text not null default '',
  add column if not exists province text not null default '',
  add column if not exists region text not null default '',
  add column if not exists postal_code text not null default '',
  add column if not exists latitude numeric(9,6),
  add column if not exists longitude numeric(9,6),
  add column if not exists bedrooms smallint not null default 0,
  add column if not exists bathrooms numeric(4,1) not null default 0,
  add column if not exists floor_area_sqm numeric(12,2),
  add column if not exists lot_size_sqm numeric(12,2),
  add column if not exists year_built smallint,
  add column if not exists featured boolean not null default false,
  add column if not exists is_published boolean not null default false,
  add column if not exists published_at timestamptz;

create or replace function public.listing_payload_number(
  p_value text,
  p_min numeric,
  p_max numeric
)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  parsed numeric;
begin
  if coalesce(p_value, '') !~ '^-?\d+(\.\d+)?$' then return null; end if;
  parsed := p_value::numeric;
  if parsed < p_min or parsed > p_max then return null; end if;
  return parsed;
exception when numeric_value_out_of_range then
  return null;
end;
$$;

-- Avoid changing business timestamps when this backfill is re-run.
drop trigger if exists shared_listings_set_updated_at on public.shared_listings;

-- Backfill searchable columns from the existing payload without removing it.
update public.shared_listings
set
  description = coalesce(payload ->> 'description', description),
  property_type = coalesce(nullif(payload ->> 'propertyType', ''), property_type),
  offer_type = case
    when payload ->> 'dealType' in ('sale', 'rent') then payload ->> 'dealType'
    when offer_type in ('sale', 'rent') then offer_type else 'sale' end,
  price = coalesce(public.listing_payload_number(payload ->> 'price', 0, 9999999999999.99), price),
  rent = coalesce(public.listing_payload_number(payload ->> 'rent', 0, 9999999999999.99), rent),
  address = coalesce(payload ->> 'address', address),
  barangay = coalesce(payload ->> 'barangay', barangay),
  city = coalesce(payload ->> 'city', city),
  province = coalesce(payload ->> 'province', province),
  region = coalesce(payload ->> 'region', region),
  postal_code = coalesce(payload ->> 'postalCode', payload ->> 'zip', postal_code),
  latitude = coalesce(public.listing_payload_number(payload ->> 'lat', -90, 90), latitude),
  longitude = coalesce(public.listing_payload_number(payload ->> 'lng', -180, 180), longitude),
  bedrooms = coalesce(public.listing_payload_number(payload ->> 'bedrooms', 0, 32767)::smallint, bedrooms),
  bathrooms = coalesce(public.listing_payload_number(payload ->> 'bathrooms', 0, 99.9), bathrooms),
  floor_area_sqm = coalesce(public.listing_payload_number(payload ->> 'floorArea', 0, 9999999999.99), floor_area_sqm),
  lot_size_sqm = coalesce(public.listing_payload_number(payload ->> 'lotArea', 0, 9999999999.99), lot_size_sqm),
  year_built = coalesce(public.listing_payload_number(payload ->> 'yearBuilt', 1600, 2200)::smallint, year_built),
  featured = case lower(coalesce(payload ->> 'featured', ''))
    when 'true' then true when 'false' then false else featured end
where payload <> '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shared_listings_offer_type_check' and conrelid = 'public.shared_listings'::regclass) then
    alter table public.shared_listings add constraint shared_listings_offer_type_check
      check (offer_type in ('sale', 'rent')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shared_listings_price_check' and conrelid = 'public.shared_listings'::regclass) then
    alter table public.shared_listings add constraint shared_listings_price_check
      check (price >= 0 and rent >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shared_listings_coordinates_check' and conrelid = 'public.shared_listings'::regclass) then
    alter table public.shared_listings add constraint shared_listings_coordinates_check
      check ((latitude is null or latitude between -90 and 90)
        and (longitude is null or longitude between -180 and 180)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shared_listings_rooms_areas_check' and conrelid = 'public.shared_listings'::regclass) then
    alter table public.shared_listings add constraint shared_listings_rooms_areas_check
      check (bedrooms >= 0 and bathrooms >= 0
        and (floor_area_sqm is null or floor_area_sqm >= 0)
        and (lot_size_sqm is null or lot_size_sqm >= 0)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shared_listings_year_built_check' and conrelid = 'public.shared_listings'::regclass) then
    alter table public.shared_listings add constraint shared_listings_year_built_check
      check (year_built is null or year_built between 1600 and 2200) not valid;
  end if;
end;
$$;

create index if not exists shared_listings_public_date_idx
  on public.shared_listings (is_published, published_at desc);
create index if not exists shared_listings_public_price_idx
  on public.shared_listings (price) where is_published;
create index if not exists shared_listings_public_location_idx
  on public.shared_listings (lower(city), lower(province)) where is_published;
create index if not exists shared_listings_public_type_idx
  on public.shared_listings (property_type, offer_type, status) where is_published;
create index if not exists shared_listings_public_rooms_idx
  on public.shared_listings (bedrooms, bathrooms) where is_published;
create index if not exists shared_listings_featured_idx
  on public.shared_listings (featured, published_at desc) where is_published;

-- Published inventory is read through public_listing_catalog. Raw rows retain
-- internal payload fields and are therefore visible only to owner/admin.
drop policy if exists "shared_listings authenticated read" on public.shared_listings;
drop policy if exists "shared_listings owner internal read" on public.shared_listings;
create policy "shared_listings owner internal read"
  on public.shared_listings for select
  using (
    public.is_super_admin()
    or (owner_id = auth.uid() and public.listing_current_user_can_publish())
  );

-- A former/rejected publisher must not be able to publish, edit, or delete a
-- listing merely because owner_id still points to that account.
drop policy if exists "shared_listings owner update" on public.shared_listings;
create policy "shared_listings owner update"
  on public.shared_listings for update
  using (
    public.is_super_admin()
    or (owner_id = auth.uid() and public.listing_current_user_can_publish())
  )
  with check (
    public.is_super_admin()
    or (owner_id = auth.uid() and public.listing_current_user_can_publish())
  );

drop policy if exists "shared_listings owner delete" on public.shared_listings;
create policy "shared_listings owner delete"
  on public.shared_listings for delete
  using (
    public.is_super_admin()
    or (owner_id = auth.uid() and public.listing_current_user_can_publish())
  );

-- Keep normalized columns current while the existing client still writes the
-- canonical listing object into payload.
create or replace function public.sync_shared_listing_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload_changed boolean;
begin
  if tg_op = 'INSERT' then
    payload_changed := true;
  else
    payload_changed := new.payload is distinct from old.payload;
  end if;

  if payload_changed then
    new.description := coalesce(new.payload ->> 'description', new.description, '');
    new.property_type := coalesce(nullif(new.payload ->> 'propertyType', ''), new.property_type, 'house-and-lot');
    new.offer_type := coalesce(nullif(new.payload ->> 'dealType', ''), new.offer_type, 'sale');
    new.address := coalesce(new.payload ->> 'address', new.address, '');
    new.barangay := coalesce(new.payload ->> 'barangay', new.barangay, '');
    new.city := coalesce(new.payload ->> 'city', new.city, '');
    new.province := coalesce(new.payload ->> 'province', new.province, '');
    new.region := coalesce(new.payload ->> 'region', new.region, '');
    new.postal_code := coalesce(new.payload ->> 'postalCode', new.payload ->> 'zip', new.postal_code, '');
    new.price := coalesce(public.listing_payload_number(new.payload ->> 'price', 0, 9999999999999.99), new.price, 0);
    new.rent := coalesce(public.listing_payload_number(new.payload ->> 'rent', 0, 9999999999999.99), new.rent, 0);
    if new.payload ? 'lat' then new.latitude := public.listing_payload_number(new.payload ->> 'lat', -90, 90); end if;
    if new.payload ? 'lng' then new.longitude := public.listing_payload_number(new.payload ->> 'lng', -180, 180); end if;
    new.bedrooms := coalesce(public.listing_payload_number(new.payload ->> 'bedrooms', 0, 32767)::smallint, new.bedrooms, 0);
    new.bathrooms := coalesce(public.listing_payload_number(new.payload ->> 'bathrooms', 0, 99.9), new.bathrooms, 0);
    if new.payload ? 'floorArea' then new.floor_area_sqm := public.listing_payload_number(new.payload ->> 'floorArea', 0, 9999999999.99); end if;
    if new.payload ? 'lotArea' then new.lot_size_sqm := public.listing_payload_number(new.payload ->> 'lotArea', 0, 9999999999.99); end if;
    if new.payload ? 'yearBuilt' then new.year_built := public.listing_payload_number(new.payload ->> 'yearBuilt', 1600, 2200)::smallint; end if;
    if new.payload ? 'featured' then
      new.featured := case lower(coalesce(new.payload ->> 'featured', ''))
        when 'true' then true when 'false' then false else new.featured end;
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.is_published then new.published_at := now(); end if;
  elsif new.is_published and not coalesce(old.is_published, false) then
    new.published_at := now();
  elsif not new.is_published then
    new.published_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists shared_listings_sync_columns on public.shared_listings;
create trigger shared_listings_sync_columns
  before insert or update on public.shared_listings
  for each row execute function public.sync_shared_listing_columns();

drop trigger if exists shared_listings_set_updated_at on public.shared_listings;
create trigger shared_listings_set_updated_at
  before update on public.shared_listings
  for each row execute function public.set_updated_at();

create table if not exists public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.shared_listings(id) on delete cascade,
  url text not null,
  alt_text text not null default '',
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  constraint listing_images_url_not_blank check (btrim(url) <> ''),
  constraint listing_images_listing_url_unique unique (listing_id, url)
);

create index if not exists listing_images_listing_order_idx
  on public.listing_images (listing_id, display_order, created_at);

insert into public.listing_images (listing_id, url, display_order)
select listing.id, photo.url, (min(photo.position) - 1)::integer
from public.shared_listings listing
cross join lateral jsonb_array_elements_text(
  case when jsonb_typeof(listing.payload -> 'photos') = 'array'
    then listing.payload -> 'photos' else '[]'::jsonb end
) with ordinality as photo(url, position)
where btrim(photo.url) <> ''
group by listing.id, photo.url
on conflict (listing_id, url) do nothing;

create or replace function public.sync_shared_listing_images()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.payload ? 'photos' and jsonb_typeof(new.payload -> 'photos') = 'array' then
    delete from public.listing_images where listing_id = new.id;
    insert into public.listing_images (listing_id, url, display_order)
    select new.id, photo.url, (min(photo.position) - 1)::integer
    from jsonb_array_elements_text(new.payload -> 'photos') with ordinality as photo(url, position)
    where btrim(photo.url) <> ''
    group by photo.url;
  end if;
  return new;
end;
$$;

drop trigger if exists shared_listings_sync_images on public.shared_listings;
create trigger shared_listings_sync_images
  after insert or update of payload on public.shared_listings
  for each row execute function public.sync_shared_listing_images();

alter table public.listing_images enable row level security;
drop policy if exists "listing images public read" on public.listing_images;
drop policy if exists "listing images relevant read" on public.listing_images;
drop policy if exists "listing images owner insert" on public.listing_images;
drop policy if exists "listing images owner update" on public.listing_images;
drop policy if exists "listing images owner delete" on public.listing_images;
create policy "listing images relevant read" on public.listing_images for select
  using (public.is_super_admin() or exists (
    select 1 from public.shared_listings listing
    where listing.id = listing_id
      and (listing.is_published or (
        listing.owner_id = auth.uid() and public.listing_current_user_can_publish()
      ))
  ));
create policy "listing images owner insert" on public.listing_images for insert
  with check (public.is_super_admin() or exists (
    select 1 from public.shared_listings listing
    where listing.id = listing_id and listing.owner_id = auth.uid()
  ));
create policy "listing images owner update" on public.listing_images for update
  using (public.is_super_admin() or exists (
    select 1 from public.shared_listings listing
    where listing.id = listing_id and listing.owner_id = auth.uid()
  ))
  with check (public.is_super_admin() or exists (
    select 1 from public.shared_listings listing
    where listing.id = listing_id and listing.owner_id = auth.uid()
  ));
create policy "listing images owner delete" on public.listing_images for delete
  using (public.is_super_admin() or exists (
    select 1 from public.shared_listings listing
    where listing.id = listing_id and listing.owner_id = auth.uid()
  ));

create table if not exists public.saved_listings (
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id text not null references public.shared_listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create index if not exists saved_listings_user_date_idx
  on public.saved_listings (user_id, created_at desc);

alter table public.saved_listings enable row level security;
drop policy if exists "saved listings read own" on public.saved_listings;
drop policy if exists "saved listings insert own" on public.saved_listings;
drop policy if exists "saved listings delete own" on public.saved_listings;
create policy "saved listings read own" on public.saved_listings for select
  using (user_id = auth.uid());
create policy "saved listings insert own" on public.saved_listings for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.shared_listings listing
    where listing.id = listing_id and listing.is_published
  ));
create policy "saved listings delete own" on public.saved_listings for delete
  using (user_id = auth.uid());

create table if not exists public.listing_inquiries (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.shared_listings(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text not null default '',
  phone text not null,
  contact_type text not null default 'buyer',
  message text not null default '',
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'closed', 'spam')),
  consent_at timestamptz not null,
  source text not null default 'website',
  crm_lead_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_inquiries_name_not_blank check (btrim(full_name) <> ''),
  constraint listing_inquiries_phone_not_blank check (btrim(phone) <> ''),
  constraint listing_inquiries_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists listing_inquiries_listing_date_idx
  on public.listing_inquiries (listing_id, created_at desc);
create index if not exists listing_inquiries_user_date_idx
  on public.listing_inquiries (user_id, created_at desc) where user_id is not null;
create index if not exists listing_inquiries_status_date_idx
  on public.listing_inquiries (status, created_at desc);

create or replace function public.increment_listing_inquiry_count()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.shared_listings
  set inquiries = inquiries + 1
  where id = new.listing_id;
  return new;
end;
$$;

drop trigger if exists listing_inquiries_increment_count on public.listing_inquiries;
create trigger listing_inquiries_increment_count
  after insert on public.listing_inquiries
  for each row execute function public.increment_listing_inquiry_count();

drop trigger if exists listing_inquiries_set_updated_at on public.listing_inquiries;
create trigger listing_inquiries_set_updated_at
  before update on public.listing_inquiries
  for each row execute function public.set_updated_at();

alter table public.listing_inquiries enable row level security;
drop policy if exists "listing inquiries read relevant" on public.listing_inquiries;
drop policy if exists "listing inquiries authenticated insert" on public.listing_inquiries;
drop policy if exists "listing inquiries owner update" on public.listing_inquiries;
drop policy if exists "listing inquiries owner delete" on public.listing_inquiries;
create policy "listing inquiries read relevant" on public.listing_inquiries for select
  using (public.is_super_admin() or user_id = auth.uid() or exists (
    select 1 from public.shared_listings listing
    where listing.id = listing_id and listing.owner_id = auth.uid()
      and public.listing_current_user_can_publish()
  ));
create policy "listing inquiries authenticated insert" on public.listing_inquiries for insert
  with check (user_id = auth.uid() and consent_at is not null and exists (
    select 1 from public.shared_listings listing
    where listing.id = listing_id and listing.is_published
  ));
create policy "listing inquiries owner update" on public.listing_inquiries for update
  using (public.is_super_admin() or exists (
    select 1 from public.shared_listings listing
    where listing.id = listing_id and listing.owner_id = auth.uid()
      and public.listing_current_user_can_publish()
  ))
  with check (public.is_super_admin() or exists (
    select 1 from public.shared_listings listing
    where listing.id = listing_id and listing.owner_id = auth.uid()
      and public.listing_current_user_can_publish()
  ));
create policy "listing inquiries owner delete" on public.listing_inquiries for delete
  using (public.is_super_admin() or exists (
    select 1 from public.shared_listings listing
    where listing.id = listing_id and listing.owner_id = auth.uid()
      and public.listing_current_user_can_publish()
  ));

-- Intentional privileged public projection for PostgREST. The view owner can
-- read through underlying RLS, so the explicit is_published filter and narrow
-- column list are the security boundary. The legacy payload is deliberately
-- excluded because it contains internal legal and brokerage fields.
create or replace view public.public_listing_catalog
with (security_barrier = true)
as
select
  listing.id,
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
  round(listing.floor_area_sqm * 10.7639, 2) as floor_area_sqft,
  listing.lot_size_sqm,
  round(listing.lot_size_sqm * 10.7639, 2) as lot_size_sqft,
  listing.year_built,
  listing.featured,
  listing.owner_id as agent_id,
  profile.full_name as agent_name,
  listing.views,
  listing.inquiries,
  listing.published_at,
  listing.updated_at,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', image.id,
      'url', image.url,
      'altText', image.alt_text,
      'displayOrder', image.display_order
    ) order by image.display_order, image.created_at)
    from public.listing_images image
    where image.listing_id = listing.id
  ), '[]'::jsonb) as images,
  case when listing.offer_type = 'rent' then listing.rent else listing.price end as display_price
from public.shared_listings listing
left join public.profiles profile on profile.id = listing.owner_id
where listing.is_published;

revoke all on table public.public_listing_catalog from public;
grant select on table public.public_listing_catalog to anon, authenticated;

revoke all on table public.listing_images from public;
grant select on table public.listing_images to authenticated;

revoke all on table public.saved_listings from public;
grant select, insert, delete on table public.saved_listings to authenticated;

revoke all on table public.listing_inquiries from public;
grant select on table public.listing_inquiries to authenticated;

-- Listing and inquiry writes must pass through listing-api so validation,
-- ownership checks, and public-inquiry rate limiting cannot be bypassed.
revoke insert, update, delete on table public.shared_listings from authenticated;
revoke execute on function public.increment_shared_listing_stat(text, text) from authenticated;

revoke all on function public.sync_shared_listing_columns() from public;
revoke all on function public.sync_shared_listing_images() from public;
revoke all on function public.listing_payload_number(text, numeric, numeric) from public;
revoke all on function public.increment_listing_inquiry_count() from public;

-- Anonymous inquiry creation is intentionally not granted directly. Step 3's
-- public API/Edge Function will validate, rate-limit, and insert with the
-- service role. This avoids exposing a spam-capable anonymous table endpoint.

notify pgrst, 'reload schema';

commit;
