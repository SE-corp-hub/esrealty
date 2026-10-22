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
4. After the code is live, apply it: GitHub > Actions > **Apply database migration**
   > Run workflow, type the file name, choose **test** first (runs it and rolls it
   back, nothing changes), then **apply**. (Pasting it into the Supabase SQL editor
   works too.)

## Refreshing the baseline
After changes have been applied live, run `supabase/phase4_schema_export.sql` in
the Supabase SQL editor, download the result as CSV, and regenerate:

```
node tests/db/build_baseline.js export.csv > supabase/migrations/0000_baseline.sql
```

Then check that `bash tests/db/run.sh` still passes. Numbered files the new
baseline already contains can stay: they are safe to run twice, and the tests
run them on top of the baseline.

In the Supabase SQL editor, the export can trigger a "Potential issue detected:
creates a table without Row Level Security" box. The query creates nothing (it
only writes `create table ...` as text): choose **Run without RLS**. "Run and
enable RLS" adds a statement that fails with `relation "public" does not exist`.

Supabase runs Postgres 17 and CI runs 16: the builder puts Postgres 17's
`MAINTAIN` right in a separate step that 16 skips.

Current baseline: live schema exported 2026-10-18, after `0001` and `0002` were
applied (both are included in it). `0003_phone_alerts.sql` (phone alerts and lead
alerts) and `0004_alerts_and_access_fixes.sql` (alerts for website inquiries and leads,
plus four access-rule fixes) came after it and are applied with the workflow above.
`0005_broker_access_audit_ledger_settings.sql` (broker team access follows the broker's
current role, indexes on the foreign keys, a change log, a lock on posted ledger entries,
the `site_settings` table and stale-listing alerts) follows `0004`.
`0006_storage_rules_more_audit_cobroke.sql` (storage size and type limits, no public
listing of the photo bucket, Super Admin read of private documents, deals / rent payments /
co-broke in the change log, one open co-broke per listing and partner) follows `0005`.
`0007_announcements.sql` (staff announcements) and `0008_lead_response_alerts.sql` (hourly
"not contacted yet" alerts for new leads) follow in that order.

## What the tests run on
`tests/db/00_supabase_stub.sql` stands in for the Supabase parts the schema uses
(the `anon` / `authenticated` / `service_role` roles, `auth.uid()` from the
request's claims, `auth.users`, `storage.buckets` / `storage.objects`).
`tests/db/10_fixture.sql` adds ten test logins (one per role and status) and a
small Property Management book.

The older loose scripts in `supabase/` are kept for reference. New changes go
here.
