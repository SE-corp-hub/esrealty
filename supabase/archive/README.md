# Archived SQL scripts

These are the one-off scripts the database was built and repaired with before
2026-10-18. They are kept for reference: what each change did, and the notes in
them.

**Don't run them on the live database.** Several are older versions of later
fixes (for example `schema.sql` and the `patch_*` / `fix_*` / `repair_*` files)
and would put back rules that were tightened since.

Everything in them that is still in use is in
`supabase/migrations/0000_baseline.sql`, which was generated from the live
database on 2026-10-18. New changes go in `supabase/migrations/` as the next
numbered file (see the README there).

A few tests still read files here to check that a security fix is in place
(`tests/phase1_security_node.js`, `tests/pms_*_node.js`), and some app error
messages name the script that once created a missing table.

One exception: `notify_dispatch.sql` (email/SMS dispatch columns for the
`notify-dispatch` function) was never applied live. When that function is
switched on, its two columns go into the next numbered migration.
