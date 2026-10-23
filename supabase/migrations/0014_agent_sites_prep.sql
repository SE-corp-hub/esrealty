-- Agent websites, Phase 0: reply time is recorded, and licensed names are locked (2026-10-23).
-- Safe to run twice. Apply with GitHub > Actions > Apply database migration (test, then apply),
-- AFTER 0013. Changes no existing data.
--
-- 1. Reply time. crm_leads gets first_contacted_at and first_contacted_by. They are stamped once,
--    by the database, the first time a lead's status moves past "New" (a lead with no status counts
--    as New, as in the lead response alerts of 0008). After that they never change, and a time sent
--    by the app is ignored, so nobody can improve their own reply time. A lead created past New
--    (typed in after a phone call) is never measured. Agent pages will show a typical reply time
--    from these stamps, counting only leads the assigned person moved.
--
-- 2. Name lock. Once a broker or agent is approved, only a Super Admin can change their full name,
--    as with the PRC and RESA numbers (profiles_protect_licence). Agent pages show the name from the
--    licence record, so an agent cannot publish under someone else's name.

alter table public.crm_leads add column if not exists first_contacted_at timestamptz;
alter table public.crm_leads add column if not exists first_contacted_by uuid;

create or replace function public.crm_leads_stamp_first_contact()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    new.first_contacted_at := null;
    new.first_contacted_by := null;
    return new;
  end if;
  if old.first_contacted_at is not null then
    new.first_contacted_at := old.first_contacted_at;
    new.first_contacted_by := old.first_contacted_by;
  elsif coalesce(nullif(old.payload ->> 'status', ''), 'new') = 'new'
        and coalesce(nullif(new.payload ->> 'status', ''), 'new') <> 'new' then
    new.first_contacted_at := now();
    new.first_contacted_by := auth.uid();
  else
    new.first_contacted_at := null;
    new.first_contacted_by := null;
  end if;
  return new;
end $function$;

drop trigger if exists crm_leads_first_contact on public.crm_leads;
create trigger crm_leads_first_contact
  before insert or update on public.crm_leads
  for each row execute function public.crm_leads_stamp_first_contact();

create or replace function public.profiles_protect_name()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.full_name is distinct from old.full_name
     and old.registration_status = 'approved'
     and old.role in ('broker', 'agent')
     and auth.uid() is not null            -- the service role and SQL editor have no user
     and not public.is_super_admin() then
    raise exception 'Your name matches your verified licence. Ask a super-admin to change it.'
      using errcode = '42501';
  end if;
  return new;
end $function$;

drop trigger if exists profiles_protect_name on public.profiles;
create trigger profiles_protect_name
  before update of full_name on public.profiles
  for each row execute function public.profiles_protect_name();
