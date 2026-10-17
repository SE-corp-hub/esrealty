# Database migrations

`0000_baseline.sql` rebuilds the whole SEA ESTATES database schema from scratch:
tables, functions, row rules, rights, storage rules and buckets. No data.

## Changing the database
1. Write the change as the next numbered file, for example `0001_short_name.sql`.
   Make it safe to run twice (`if not exists`, `drop policy if exists`, ...).
2. Add or extend a test in `tests/db/test_*.sql` that checks the change as the
   users it affects.
3. Run the database tests locally or let GitHub run them:
   `bash tests/db/run.sh` (needs a Postgres you can create roles on; set `PGHOST`,
   `PGPORT`, `PGUSER`, `PGPASSWORD`).
4. After the code is live, run the file in the Supabase SQL editor.

## Refreshing the baseline
After changes have been applied live, run `supabase/phase4_schema_export.sql` in
the Supabase SQL editor, download the result as CSV, and regenerate:

```
node tests/db/build_baseline.js export.csv > supabase/migrations/0000_baseline.sql
```

Then delete the numbered files the new baseline already contains, and check that
`bash tests/db/run.sh` still passes.

## What the tests run on
`tests/db/00_supabase_stub.sql` stands in for the Supabase parts the schema uses
(the `anon` / `authenticated` / `service_role` roles, `auth.uid()` from the
request's claims, `auth.users`, `storage.buckets` / `storage.objects`).
`tests/db/10_fixture.sql` adds ten test logins (one per role and status) and a
small Property Management book.

The older loose scripts in `supabase/` are kept for reference. New changes go
here.
