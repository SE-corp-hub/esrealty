-- Notifications: in-app alert feed (account approvals, new inquiries, etc.)
-- Run AFTER schema.sql and listing_platform_schema.sql.
-- Idempotent: safe to re-run.

begin;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'info'
    check (type in ('info', 'approval', 'inquiry', 'lead', 'system')),
  title text not null,
  body text not null default '',
  link_view text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_recent_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own" on public.notifications
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Rows are created only by SECURITY DEFINER triggers below; clients never insert directly.
revoke insert on table public.notifications from authenticated;
revoke delete on table public.notifications from authenticated;
revoke update on table public.notifications from anon;

-- Helper: definer insert so triggers can notify any user regardless of RLS.
create or replace function public.notify_user(
  target_user uuid,
  n_type text,
  n_title text,
  n_body text,
  n_link text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_user is null then return; end if;
  insert into public.notifications (user_id, type, title, body, link_view)
  values (target_user, n_type, left(n_title, 200), left(n_body, 1000), left(coalesce(n_link, ''), 60));
end;
$$;

revoke all on function public.notify_user(uuid, text, text, text, text) from public, anon, authenticated;

-- 1) Account approved / rejected -> notify the affected user
create or replace function public.notify_on_registration_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare previous text := coalesce(old.registration_status, '');
begin
  if new.registration_status = old.registration_status then return new; end if;
  if new.registration_status = 'approved' then
    perform public.notify_user(
      new.id, 'approval',
      'Your account has been approved',
      'Welcome aboard! You can now sign in and use your assigned role.',
      'dashboard'
    );
  elsif new.registration_status = 'rejected' then
    perform public.notify_user(
      new.id, 'approval',
      'Your registration was declined',
      'Contact your ES Realty administrator for details.',
      ''
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_notify_registration on public.profiles;
create trigger profiles_notify_registration
  after update of registration_status on public.profiles
  for each row execute function public.notify_on_registration_decision();

-- 2) New inquiry on a listing -> notify the listing owner
create or replace function public.notify_on_new_inquiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare listing_owner uuid;
declare listing_title text;
begin
  select owner_id, title into listing_owner, listing_title
  from public.shared_listings where id = new.listing_id;
  if listing_owner is not null and listing_owner <> new.user_id then
    perform public.notify_user(
      listing_owner, 'inquiry',
      'New inquiry: ' || coalesce(listing_title, 'your listing'),
      coalesce(new.full_name, 'Someone') || ' (' || coalesce(new.contact_type, 'buyer') || ') is interested.',
      'listings'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists inquiries_notify_owner on public.listing_inquiries;
create trigger inquiries_notify_owner
  after insert on public.listing_inquiries
  for each row execute function public.notify_on_new_inquiry();

-- 3) Realtime push (ignore error if publication/table already added)
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when others then
    if sqlerrm like '%already%' then null; else raise; end if;
end $$;

commit;
