-- Shared ad posts so every ad an agent drafts or publishes is visible to that
-- agent's supervising broker (and to the Super Admin). Run this ENTIRE file in
-- the Supabase SQL Editor, then press Run. Safe to re-run any number of times.
--
-- Before this table existed, each user's ads lived only inside their own
-- app_state row, so a broker could never see the ads published by their agents.
-- This adds one shared ad_posts table. RLS lets:
--   * the creator (agent/broker) read, update, delete their own ads,
--   * the creator's supervising broker read/update/delete their team's ads,
--   * the Super Admin see everything.
--
-- Per-ad attribution (ad_posts.id) rides on each lead's payload; the Source
-- Funnel in the app rolls attribution up by lead source and by ad.

create table if not exists public.ad_posts (
  id text primary key,
  listing_id text not null default '',
  caption text not null default '',
  channel text not null default '',
  status text not null default 'draft',
  url text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_posts_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists ad_posts_listing_id_idx on public.ad_posts (listing_id);
create index if not exists ad_posts_created_by_idx on public.ad_posts (created_by);
create index if not exists ad_posts_status_idx on public.ad_posts (status);
create index if not exists ad_posts_updated_at_idx on public.ad_posts (updated_at desc);

-- Preserve existing ads from each user's app_state payload. Existing shared
-- rows win on re-runs, so newer cloud data is never overwritten.
insert into public.ad_posts (id, listing_id, caption, channel, status, url, payload, created_by)
select
  coalesce(ad.item ->> 'id', 'migrated-' || a.owner_id::text || '-' || row_number() over ()),
  coalesce(ad.item ->> 'listingId', ''),
  coalesce(ad.item ->> 'caption', ''),
  coalesce(ad.item ->> 'channel', ''),
  coalesce(ad.item ->> 'status', 'draft'),
  coalesce(ad.item ->> 'url', ''),
  ad.item || jsonb_build_object(
    'createdBy', a.owner_id::text,
    'owner', a.owner_id::text
  ),
  a.owner_id
from public.app_state a
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(a.payload -> 'ads') = 'array' then a.payload -> 'ads' else '[]'::jsonb end
) as ad(item)
where coalesce(ad.item ->> 'id', '') <> ''
on conflict (id) do nothing;

alter table public.ad_posts enable row level security;

-- Ownership is provenance, not an editable field. Without this guard an agent
-- can rewrite created_by to their broker and claim the broker's ads.
create or replace function public.ad_posts_keep_creator()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Ad creator cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists ad_posts_keep_creator on public.ad_posts;
create trigger ad_posts_keep_creator
  before update on public.ad_posts
  for each row execute function public.ad_posts_keep_creator();

-- Drop policies BEFORE functions: the policies depend on the helper functions,
-- so dropping the functions first raises 2BP01 "cannot drop ... other objects
-- depend on it".
drop policy if exists "ad_posts select own or team" on public.ad_posts;
drop policy if exists "ad_posts insert own" on public.ad_posts;
drop policy if exists "ad_posts update own or team" on public.ad_posts;
drop policy if exists "ad_posts delete own or team" on public.ad_posts;

drop function if exists public.ad_posts_broker_of(public.ad_posts);
drop function if exists public.ad_posts_broker_of(uuid);
drop function if exists public.ad_posts_user_is_approved();

-- True when the ad was created by one of my supervised agents.
create or replace function public.ad_posts_broker_of(p_created_by uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_created_by and p.broker = auth.uid()
  );
$$;

create or replace function public.ad_posts_user_is_approved()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and registration_status = 'approved'
  );
$$;

create policy "ad_posts select own or team"
  on public.ad_posts for select
  using (
    public.is_super_admin()
    or (public.ad_posts_user_is_approved() and (
      created_by = auth.uid()
      or public.ad_posts_broker_of(created_by)
    ))
  );

create policy "ad_posts insert own"
  on public.ad_posts for insert
  with check (public.is_super_admin() or (
    public.ad_posts_user_is_approved() and created_by = auth.uid()
  ));

create policy "ad_posts update own or team"
  on public.ad_posts for update
  using (
    public.is_super_admin()
    or (public.ad_posts_user_is_approved() and (
      created_by = auth.uid()
      or public.ad_posts_broker_of(created_by)
    ))
  )
  with check (
    public.is_super_admin()
    or (public.ad_posts_user_is_approved() and (
      created_by = auth.uid()
      or public.ad_posts_broker_of(created_by)
    ))
  );

create policy "ad_posts delete own or team"
  on public.ad_posts for delete
  using (
    public.is_super_admin()
    or (public.ad_posts_user_is_approved() and (
      created_by = auth.uid()
      or public.ad_posts_broker_of(created_by)
    ))
  );

revoke all on function public.ad_posts_broker_of(uuid) from public;
grant execute on function public.ad_posts_broker_of(uuid) to authenticated;
revoke all on function public.ad_posts_user_is_approved() from public;
grant execute on function public.ad_posts_user_is_approved() to authenticated;
revoke all on function public.ad_posts_keep_creator() from public;
grant select, insert, update, delete on public.ad_posts to authenticated;

-- Reload PostgREST's schema cache so the app can call the table immediately.
notify pgrst, 'reload schema';

-- Verify the table and privileges (should print t for all four).
select
  tablename,
  has_table_privilege('authenticated', 'public.ad_posts', 'select') as can_select,
  has_table_privilege('authenticated', 'public.ad_posts', 'insert') as can_insert,
  has_table_privilege('authenticated', 'public.ad_posts', 'update') as can_update,
  has_table_privilege('authenticated', 'public.ad_posts', 'delete') as can_delete
from pg_tables where schemaname = 'public' and tablename = 'ad_posts';