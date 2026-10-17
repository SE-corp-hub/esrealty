-- Stand-in for the parts of Supabase the SEA ESTATES schema relies on, so the
-- baseline and the access-rule tests run on a plain Postgres (CI and local).
-- Not used on Supabase itself.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit password 'pgrst'; end if;
end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;

-- The signed-in user comes from request.jwt.claims, as PostgREST sets it.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt() ->> 'sub'), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.jwt() ->> 'role') $$;
create or replace function auth.email() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.email', true), ''), auth.jwt() ->> 'email') $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  metadata jsonb
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant execute on all functions in schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects, storage.buckets to anon, authenticated, service_role;
