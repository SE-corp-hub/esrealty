-- Staff announcements (2026-10-21). Safe to run twice.
--
-- Apply with GitHub > Actions > Apply database migration (test, then apply), AFTER 0006.
-- Changes no data. Backend roadmap item K8.
--
-- admin_announce(title, body, roles): a Super Admin sends one notice to every approved account
-- with one of the chosen roles. It arrives in the bell (and on phones that turned alerts on).
-- The sender gets a copy, and the send is written to the change log with the roles and the count
-- (not the text). Limits: title 120 characters, message 1,000, at most one announcement a minute.

create or replace function public.admin_announce(p_title text, p_body text, p_roles text[])
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  t text := btrim(coalesce(p_title, ''));
  b text := btrim(coalesce(p_body, ''));
  roles text[] := coalesce(p_roles, '{}');
  n integer;
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  if t = '' or char_length(t) > 120 then raise exception 'Title must be 1 to 120 characters' using errcode = '22023'; end if;
  if char_length(b) > 1000 then raise exception 'Message must be at most 1,000 characters' using errcode = '22023'; end if;
  if cardinality(roles) = 0 or exists (select 1 from unnest(roles) r where r not in ('super-admin', 'broker', 'agent', 'buyer', 'seller', 'owner', 'tenant')) then
    raise exception 'Choose who receives it' using errcode = '22023';
  end if;
  if exists (select 1 from public.audit_events where owner_id = auth.uid() and event_type = 'announcement_sent' and created_at > now() - interval '1 minute') then
    raise exception 'One announcement a minute. Try again shortly.' using errcode = '22023';
  end if;

  insert into public.notifications (user_id, type, title, body, link_view)
  select p.id, 'info', 'Announcement: ' || t, b, 'dashboard'
    from public.profiles p
   where (p.registration_status = 'approved' and p.role::text = any (roles)) or p.id = auth.uid();
  get diagnostics n = row_count;

  insert into public.audit_events (owner_id, event_type, entity_type, entity_id, detail)
  values (auth.uid(), 'announcement_sent', 'announcement', '', jsonb_build_object('roles', to_jsonb(roles), 'recipients', n));
  return n;
end;
$function$;
revoke all on function public.admin_announce(text, text, text[]) from public, anon, authenticated;
grant execute on function public.admin_announce(text, text, text[]) to authenticated, service_role;

select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'admin_announce')::int as announce_function;
