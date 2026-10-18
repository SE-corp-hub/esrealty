-- Run once in Supabase Dashboard -> SQL Editor if an existing account cannot sign in.
create or replace function public.ensure_my_profile()
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  result public.profiles;
begin
  insert into public.profiles (id, full_name)
  values (auth.uid(), coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', ''))
  on conflict (id) do nothing;
  select * into result from public.profiles where id = auth.uid();
  return result;
end;
$$;

revoke all on function public.ensure_my_profile() from public;
grant execute on function public.ensure_my_profile() to authenticated;
