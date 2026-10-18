-- Database support for the listings REST Edge Function.
-- Run after listing_platform_schema.sql. Safe to re-run.

begin;

create table if not exists public.listing_inquiry_rate_limits (
  request_key_hash text not null,
  window_started_at timestamptz not null,
  attempts integer not null default 1 check (attempts > 0),
  updated_at timestamptz not null default now(),
  primary key (request_key_hash, window_started_at)
);

alter table public.listing_inquiry_rate_limits enable row level security;
revoke all on table public.listing_inquiry_rate_limits from public, anon, authenticated;

create or replace function public.consume_listing_inquiry_rate_limit(
  p_request_key_hash text,
  p_limit integer default 5,
  p_window_seconds integer default 3600
)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  bucket timestamptz;
  current_attempts integer;
begin
  if coalesce(btrim(p_request_key_hash), '') = '' then
    raise exception 'Rate-limit key is required';
  end if;
  if p_limit < 1 or p_limit > 100 or p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'Invalid rate-limit configuration';
  end if;

  bucket := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.listing_inquiry_rate_limits (
    request_key_hash,
    window_started_at,
    attempts,
    updated_at
  ) values (
    p_request_key_hash,
    bucket,
    1,
    now()
  )
  on conflict (request_key_hash, window_started_at) do update
  set attempts = public.listing_inquiry_rate_limits.attempts + 1,
      updated_at = now()
  returning attempts into current_attempts;

  -- Keep the private limiter table bounded without a separate scheduled job.
  delete from public.listing_inquiry_rate_limits
  where window_started_at < now() - interval '2 days';

  return current_attempts <= p_limit;
end;
$$;

create or replace function public.toggle_saved_listing_for_user(
  p_user_id uuid,
  p_listing_id text
)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  removed text;
begin
  if p_user_id is null or coalesce(btrim(p_listing_id), '') = '' then
    raise exception 'User and listing are required';
  end if;
  if not exists (
    select 1 from public.shared_listings
    where id = p_listing_id and is_published
  ) then
    raise exception 'Listing not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_listing_id, 0));
  delete from public.saved_listings
  where user_id = p_user_id and listing_id = p_listing_id
  returning listing_id into removed;
  if removed is not null then return false; end if;

  insert into public.saved_listings (user_id, listing_id)
  values (p_user_id, p_listing_id);
  return true;
end;
$$;

create or replace function public.increment_public_listing_view(p_listing_id text)
returns void
language sql
security definer set search_path = public
as $$
  update public.shared_listings
  set views = views + 1
  where id = p_listing_id and is_published;
$$;

revoke all on function public.consume_listing_inquiry_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_listing_inquiry_rate_limit(text, integer, integer) to service_role;
revoke all on function public.toggle_saved_listing_for_user(uuid, text) from public, anon, authenticated;
grant execute on function public.toggle_saved_listing_for_user(uuid, text) to service_role;
revoke all on function public.increment_public_listing_view(text) from public, anon, authenticated;
grant execute on function public.increment_public_listing_view(text) to service_role;

notify pgrst, 'reload schema';

commit;
