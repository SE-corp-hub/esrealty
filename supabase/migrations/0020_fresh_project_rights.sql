-- Rights a brand-new Supabase project gets differently from the old one.
-- The old property management record (pms_workspaces, kept for rollback) and its backup were
-- closed to visitors by hand on the old project; the baseline doesn't say so, so a new project
-- let visitors query them (row rules still hid every row). Safe to run twice.
revoke all on public.pms_workspaces from anon;
revoke all on public.pms_workspaces_backup_20261017 from anon, authenticated;

select
  not has_table_privilege('anon', 'public.pms_workspaces', 'select') as visitors_closed_out,
  not has_table_privilege('authenticated', 'public.pms_workspaces_backup_20261017', 'select') as backup_closed;
