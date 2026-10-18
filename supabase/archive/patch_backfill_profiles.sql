-- Run once in Supabase Dashboard -> SQL Editor.
-- Backfills public.profiles rows for any auth.users that signed up before the
-- handle_new_user trigger existed (or that somehow missed it). This is what
-- makes those accounts visible in Users & Access (admin_list_profiles is a
-- profiles JOIN auth.users, so a missing profile row hides the account).

insert into public.profiles (id, full_name, registration_status)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', ''), 'pending'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- Sanity check: accounts with no profile row (should return 0 rows after the insert above).
select u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- Sanity check: every auth user vs its profile status.
select u.email, p.role, p.registration_status
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at desc;
