-- ============================================================
-- Published listings are shared with everyone; drafts stay private.
--
-- public_listing_catalog exposes only rows where is_published is
-- true. A draft (is_published = false) is visible ONLY to its
-- owner (via /users/me/listings, owner-filtered) and to the
-- Super Admin — never to other roles or the storefront.
--
-- Run this ENTIRE file once in the Supabase SQL Editor.
-- ============================================================

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

notify pgrst, 'reload schema';
