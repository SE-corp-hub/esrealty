-- Apply after the existing schema scripts. Safe to re-run.
-- Table-dependent parts are guarded so this also runs cleanly before
-- shared_listings.sql / crm_leads.sql create their tables.

-- CRM lead ownership must remain immutable after insert.
create or replace function public.crm_leads_keep_creator()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Lead creator cannot be changed';
  end if;
  return new;
end;
$$;

-- Confirmed but pending/rejected accounts must not bypass the application and
-- query the shared catalog or increment analytics directly.
create or replace function public.listing_current_user_is_approved()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid() and me.registration_status = 'approved'
  );
$$;

create or replace function public.increment_shared_listing_stat(p_listing_id text, p_stat text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.listing_current_user_is_approved() then raise exception 'Approved account required'; end if;
  if p_stat = 'views' then
    update public.shared_listings set views = views + 1 where id = p_listing_id;
  elsif p_stat = 'inquiries' then
    update public.shared_listings set inquiries = inquiries + 1 where id = p_listing_id;
  else
    raise exception 'Unsupported listing statistic';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.crm_leads') is not null then
    drop trigger if exists crm_leads_keep_creator on public.crm_leads;
    create trigger crm_leads_keep_creator
      before update on public.crm_leads
      for each row execute function public.crm_leads_keep_creator();
  end if;

  if to_regclass('public.shared_listings') is not null then
    drop policy if exists "shared_listings authenticated read" on public.shared_listings;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'shared_listings'
        and column_name = 'is_published'
    ) then
      drop policy if exists "shared_listings owner internal read" on public.shared_listings;
      create policy "shared_listings owner internal read"
        on public.shared_listings for select
        using (public.is_super_admin() or (
          owner_id = auth.uid() and public.listing_current_user_can_publish()
        ));
      revoke insert, update, delete on public.shared_listings from authenticated;
      revoke execute on function public.increment_shared_listing_stat(text, text) from authenticated;
    else
      create policy "shared_listings authenticated read"
        on public.shared_listings for select
        using (public.listing_current_user_is_approved());
    end if;
  end if;
end;
$$;

revoke all on function public.crm_leads_keep_creator() from public;
revoke all on function public.listing_current_user_is_approved() from public;
grant execute on function public.listing_current_user_is_approved() to authenticated;
revoke all on function public.increment_shared_listing_stat(text, text) from public;
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shared_listings'
      and column_name = 'is_published'
  ) then
    grant execute on function public.increment_shared_listing_stat(text, text) to authenticated;
  end if;
end;
$$;

notify pgrst, 'reload schema';
