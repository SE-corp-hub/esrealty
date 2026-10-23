-- Agent websites, Phase 1: licence checks, agent pages and their counts (2026-10-23).
-- Safe to run twice. Apply with GitHub > Actions > Apply database migration (test, then apply),
-- AFTER 0014 (reply times use crm_leads.first_contacted_at). Changes no existing data.
--
-- agent_verifications  one licence check per broker or agent, recorded by a Super Admin: licence
--                      type and number, the name as on the PRC record, valid until, and (for a
--                      salesperson) that the supervising broker accepted them. Only Super Admins
--                      write it; the agent can read their own.
-- agent_sites          what each agent chooses to publish: a draft they edit and the published
--                      copy visitors see. Agents change it only through the functions below.
-- agent_page_counts    views and taps on the contact buttons, per agent per day (counts only).
--
-- A page is public only while all of this holds (agent_page_blockers):
--   the account is an approved broker or agent; a licence check is recorded, matches the role and
--   has not expired; for a salesperson, the supervising broker accepted them and the broker's own
--   licence check is current. When any of these stops being true the page disappears by itself.
--
-- Visitors never read these tables. The listing function calls public_agent(slug) with the
-- service role and passes on only what it returns: the name as on the PRC record, the licence
-- details, the agent's chosen text, photo and contact buttons, their available listings and,
-- after 5 measured leads, a typical reply time. Personal phone numbers and emails on the account
-- are never returned; only the contact numbers the agent chose to show.

-- 1. Tables -------------------------------------------------------------------------------------

create table if not exists public.agent_verifications (
  agent_id uuid primary key references public.profiles(id) on delete cascade,
  licence_type text not null check (licence_type in ('broker', 'salesperson')),
  licence_no text not null check (length(btrim(licence_no)) between 3 and 40),
  prc_name text not null check (length(btrim(prc_name)) between 3 and 120),
  valid_until date not null,
  broker_accepted boolean not null default false,
  checked_by uuid,
  checked_at timestamptz not null default now()
);
alter table public.agent_verifications enable row level security;
revoke all on public.agent_verifications from anon, authenticated;
grant select, insert, update, delete on public.agent_verifications to authenticated;
drop policy if exists "licence checks read own or admin" on public.agent_verifications;
create policy "licence checks read own or admin" on public.agent_verifications for select to authenticated
  using (agent_id = auth.uid() or public.is_super_admin());
drop policy if exists "licence checks admin write" on public.agent_verifications;
create policy "licence checks admin write" on public.agent_verifications for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.agent_verifications_stamp()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  new.licence_no := btrim(new.licence_no);
  new.prc_name := btrim(new.prc_name);
  new.checked_by := auth.uid();
  new.checked_at := now();
  return new;
end $function$;
drop trigger if exists agent_verifications_stamp on public.agent_verifications;
create trigger agent_verifications_stamp before insert or update on public.agent_verifications
  for each row execute function public.agent_verifications_stamp();

create table if not exists public.agent_sites (
  agent_id uuid primary key references public.profiles(id) on delete cascade,
  slug text unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 70),
  draft jsonb not null default '{}'::jsonb,
  data jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.agent_sites enable row level security;
revoke all on public.agent_sites from anon, authenticated;
grant select, update on public.agent_sites to authenticated;
drop policy if exists "agent sites read own or admin" on public.agent_sites;
create policy "agent sites read own or admin" on public.agent_sites for select to authenticated
  using (agent_id = auth.uid() or public.is_super_admin());
-- Agents change their page only through agent_site_save / _publish; a Super Admin may unpublish.
drop policy if exists "agent sites admin update" on public.agent_sites;
create policy "agent sites admin update" on public.agent_sites for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create table if not exists public.agent_page_counts (
  agent_id uuid not null references public.profiles(id) on delete cascade,
  day date not null default current_date,
  kind text not null check (kind in ('view', 'call', 'viber', 'whatsapp', 'messenger', 'save', 'message')),
  count integer not null default 0,
  primary key (agent_id, day, kind)
);
alter table public.agent_page_counts enable row level security;
revoke all on public.agent_page_counts from anon, authenticated;
grant select on public.agent_page_counts to authenticated;
drop policy if exists "agent page counts read own or admin" on public.agent_page_counts;
create policy "agent page counts read own or admin" on public.agent_page_counts for select to authenticated
  using (agent_id = auth.uid() or public.is_super_admin());

-- 2. Fixed lists and cleaning -------------------------------------------------------------------

-- The towns are the Value Guide's (data/batangas-zonal.json slugs; tests/agent_sites_node.js keeps
-- them equal), so a town on an agent page matches the town on a Value Guide request exactly.
create or replace function public.agent_site_towns() returns text[] language sql immutable as $$
  select array['agoncillo','alitagtag','balayan','balete','batangas-city','bauan','calaca','calatagan',
    'cuenca','ibaan','laurel','lemery','lian','lipa-city','lobo','mabini','malvar','mataas-na-kahoy',
    'nasugbu','padre-garcia','rosario','san-jose','san-juan','san-luis','san-nicolas','san-pascual',
    'sta-teresita','sto-tomas-city','taal','talisay','tanauan-city','taysan','tingloy','tuy'] $$;
create or replace function public.agent_site_needs() returns text[] language sql immutable as $$
  select array['buy','sell','rent','lots','commercial','preselling','overseas'] $$;
create or replace function public.agent_site_languages() returns text[] language sql immutable as $$
  select array['english','filipino','cebuano','ilocano','chinese','korean','japanese'] $$;

-- A phone number for a contact button, as +63... (or + and the digits for other countries).
create or replace function public.agent_site_phone(p text) returns text language sql immutable as $$
  select case
    when d ~ '^09[0-9]{9}$' then '+63' || substr(d, 2)
    when d ~ '^639[0-9]{9}$' then '+' || d
    when d ~ '^[1-9][0-9]{7,14}$' and p ~ '^\s*\+' then '+' || d
    else '' end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x $$;

-- Only known keys, known values and sensible lengths are kept from what the editor sends.
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
    'featured', to_jsonb(coalesce((select (array_agg(t))[1:6] from jsonb_array_elements_text(
               case when jsonb_typeof(j -> 'featured') = 'array' then j -> 'featured' else '[]' end) t
               where t ~ '^[A-Za-z0-9_-]{1,80}$'), '{}'))
  );
end $function$;

-- 3. Who may have a public page -----------------------------------------------------------------

-- Plain reasons why a page cannot be public right now (empty = it can).
create or replace function public.agent_page_blockers(p_agent uuid) returns text[]
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  p record; v record; b record; bv record;
  out text[] := '{}';
begin
  select id, role::text as role, registration_status, broker into p from public.profiles where id = p_agent;
  if p.id is null or p.registration_status <> 'approved' or p.role not in ('broker', 'agent') then
    return array['Only approved brokers and agents can have a page.'];
  end if;
  select * into v from public.agent_verifications where agent_id = p_agent;
  if v.agent_id is null then
    out := array_append(out, 'Our office has not recorded your licence check yet.');
  else
    if v.valid_until < current_date then out := array_append(out, 'Your licence has expired. Ask our office to record the renewal.'); end if;
    if (p.role = 'broker') <> (v.licence_type = 'broker') then out := array_append(out, 'The licence on record does not match your role. Ask our office to check it.'); end if;
  end if;
  if p.role = 'agent' then
    select id, registration_status, role::text as role into b from public.profiles where id = p.broker;
    select * into bv from public.agent_verifications where agent_id = p.broker;
    if b.id is null or b.registration_status <> 'approved' or b.role <> 'broker'
       or bv.agent_id is null or bv.licence_type <> 'broker' or bv.valid_until < current_date then
      out := array_append(out, 'Your supervising broker''s licence check is missing or expired.');
    elsif v.agent_id is not null and not v.broker_accepted then
      out := array_append(out, 'Our office has not recorded that your supervising broker accepted you.');
    end if;
  end if;
  return out;
end $function$;

-- Typical first reply over the last 90 days, counting only leads the assigned person moved out of
-- New; a lead still New after 24 hours counts as over a day. Shown only after 5 measured leads.
create or replace function public.agent_reply_bucket(p_agent uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  with l as (
    select case
      when first_contacted_at is not null and first_contacted_by = p_agent
        then extract(epoch from (first_contacted_at - created_at)) / 60
      when coalesce(nullif(payload ->> 'status', ''), 'new') = 'new' and created_at < now() - interval '24 hours'
        then 1441 end as mins
    from public.crm_leads
    where assigned_to_id = p_agent and created_at > now() - interval '90 days'
  ), m as (
    select count(mins) as n, percentile_cont(0.5) within group (order by mins) as median from l where mins is not null
  )
  select case when n < 5 then null
              when median <= 30 then 'within 30 minutes'
              when median <= 60 then 'within an hour'
              when median <= 240 then 'within 4 hours'
              when median <= 1440 then 'within a day'
              else null end
  from m $$;

-- Everything an agent page shows, built from the published copy or (for the editor's preview) the
-- draft. Returns null when the agent has no row.
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
  if p.role = 'agent' then
    select full_name into bp from public.profiles where id = p.broker;
    select * into bv from public.agent_verifications where agent_id = p.broker;
  end if;
  feat := array(select jsonb_array_elements_text(d -> 'featured'));
  return d || jsonb_build_object(
    'slug', s.slug,
    'published_at', s.published_at,
    'name', coalesce(v.prc_name, nullif(btrim(p.full_name), ''), 'Agent'),
    'role', case when p.role = 'broker' then 'broker' else 'salesperson' end,
    'role_label', case when p.role = 'broker' then 'Real estate broker' else 'PRC-accredited real estate salesperson' end,
    'licence', case when v.agent_id is null then null else jsonb_build_object(
      'no', v.licence_no, 'valid_until', v.valid_until, 'checked_on', (v.checked_at at time zone 'Asia/Manila')::date) end,
    'broker', case when p.role = 'agent' then jsonb_build_object(
      'name', coalesce(bv.prc_name, nullif(btrim(bp.full_name), ''), ''), 'licence_no', coalesce(bv.licence_no, '')) end,
    'reply', public.agent_reply_bucket(p_agent),
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

-- 4. For visitors (through the listing function only) --------------------------------------------

create or replace function public.public_agent(p_slug text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  a uuid;
begin
  select agent_id into a from public.agent_sites where slug = lower(btrim(p_slug)) and published_at is not null and data is not null;
  if a is null or cardinality(public.agent_page_blockers(a)) > 0 then return null; end if;
  -- agent_id lets the listing function count visits and assign messages; it does not reach visitors.
  return (public.agent_page_build(a, false) - 'published_at' - 'featured') || jsonb_build_object('agent_id', a);
end $function$;

create or replace function public.agent_page_count(p_agent uuid, p_kind text) returns void
language sql security definer set search_path to 'public' as $$
  insert into public.agent_page_counts (agent_id, day, kind, count)
  values (p_agent, (now() at time zone 'Asia/Manila')::date, p_kind, 1)
  on conflict (agent_id, day, kind) do update set count = public.agent_page_counts.count + 1 $$;

-- 5. For the agent (My website) ------------------------------------------------------------------

-- The editor's starting point: the draft, a preview built from it, why it cannot be public yet,
-- and this month's counts. Makes the row the first time.
create or replace function public.agent_site_open() returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  me uuid := auth.uid();
  s record;
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role::text in ('broker', 'agent')) then
    raise exception 'Only brokers and agents have a page' using errcode = '42501';
  end if;
  insert into public.agent_sites (agent_id) values (me) on conflict (agent_id) do nothing;
  select * into s from public.agent_sites where agent_id = me;
  return jsonb_build_object(
    'slug', s.slug,
    'published_at', s.published_at,
    'draft', public.agent_site_clean(s.draft),
    'unpublished_changes', s.data is distinct from public.agent_site_clean(s.draft) and s.published_at is not null,
    'preview', public.agent_page_build(me, true),
    'blockers', to_jsonb(public.agent_page_blockers(me)),
    'month', coalesce((select jsonb_object_agg(kind, n) from (
        select kind, sum(count) as n from public.agent_page_counts
         where agent_id = me and day >= date_trunc('month', now() at time zone 'Asia/Manila')::date group by kind) k), '{}'::jsonb),
    'month_leads', (select count(*) from public.crm_leads where assigned_to_id = me and payload ->> 'channel' = 'agent-page'
                      and created_at >= date_trunc('month', now() at time zone 'Asia/Manila'))
  );
end $function$;

create or replace function public.agent_site_save(p_draft jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role::text in ('broker', 'agent')) then
    raise exception 'Only brokers and agents have a page' using errcode = '42501';
  end if;
  insert into public.agent_sites (agent_id, draft, updated_at) values (me, public.agent_site_clean(p_draft), now())
  on conflict (agent_id) do update set draft = excluded.draft, updated_at = now();
  return public.agent_site_open();
end $function$;

-- A readable address made once from the name on the licence check (maria-santos, maria-santos-2).
create or replace function public.agent_site_slug(p_name text, p_agent uuid) returns text
language plpgsql stable set search_path to 'public' as $function$
declare
  base text := trim(both '-' from left(regexp_replace(lower(translate(coalesce(p_name, ''), 'ÑñÁáÉéÍíÓóÚúÜü', 'NnAaEeIiOoUuUu')), '[^a-z0-9]+', '-', 'g'), 60));
  pick text;
  n integer := 1;
begin
  if base = '' then base := 'agent'; end if;
  pick := base;
  while exists (select 1 from public.agent_sites where slug = pick and agent_id <> p_agent) loop
    n := n + 1;
    pick := base || '-' || n;
  end loop;
  return pick;
end $function$;

create or replace function public.agent_site_publish() returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  me uuid := auth.uid();
  blockers text[];
  s record;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  blockers := public.agent_page_blockers(me);
  select * into s from public.agent_sites where agent_id = me;
  if s.agent_id is null then raise exception 'Open My website first'; end if;
  if (public.agent_site_clean(s.draft) -> 'contacts') = '{}'::jsonb then
    blockers := array_append(blockers, 'Add at least one way to contact you.');
  end if;
  if cardinality(blockers) > 0 then raise exception '%', array_to_string(blockers, ' '); end if;
  update public.agent_sites
     set data = public.agent_site_clean(draft),
         slug = coalesce(slug, public.agent_site_slug((select prc_name from public.agent_verifications where agent_id = me), me)),
         published_at = coalesce(published_at, now()),
         updated_at = now()
   where agent_id = me;
  return public.agent_site_open();
end $function$;

create or replace function public.agent_site_unpublish() returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
begin
  update public.agent_sites set published_at = null, updated_at = now() where agent_id = auth.uid();
  return public.agent_site_open();
end $function$;

-- 6. Rights -------------------------------------------------------------------------------------

revoke all on function public.agent_page_blockers(uuid) from public, anon, authenticated;
revoke all on function public.agent_reply_bucket(uuid) from public, anon, authenticated;
revoke all on function public.agent_page_build(uuid, boolean) from public, anon, authenticated;
revoke all on function public.public_agent(text) from public, anon, authenticated;
revoke all on function public.agent_page_count(uuid, text) from public, anon, authenticated;
grant execute on function public.public_agent(text) to service_role;
grant execute on function public.agent_page_count(uuid, text) to service_role;
revoke all on function public.agent_site_open() from public, anon;
revoke all on function public.agent_site_save(jsonb) from public, anon;
revoke all on function public.agent_site_publish() from public, anon;
revoke all on function public.agent_site_unpublish() from public, anon;
grant execute on function public.agent_site_open() to authenticated;
grant execute on function public.agent_site_save(jsonb) to authenticated;
grant execute on function public.agent_site_publish() to authenticated;
grant execute on function public.agent_site_unpublish() to authenticated;
