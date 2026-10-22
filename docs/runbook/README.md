# Runbook: what runs when, and what to do when it breaks

Written 2026-10-21. Plain words on purpose. Times are Philippine time.

## Where things live

| Part | Where | Deploys when |
|---|---|---|
| Website and back office | Cloudflare (esrealty.tradersgag6.workers.dev) | every push to `main` |
| Database, logins, photos, server functions | Supabase | database: you run **Actions > Apply database migration**; functions: **Actions > Deploy edge functions** |
| Market Scan (live listing search) | Vercel (esrealty-market-scan.vercel.app) | its own Vercel deploy |
| Scheduled jobs and tests | GitHub Actions | they run by themselves |

Pushing to `main` changes the live website. Work happens on a branch and a pull request; merge only after the checks are green.

## Scheduled jobs

| Job (workflow) | When | What it does | Switch |
|---|---|---|---|
| Phone alerts (`push-alerts`) | every 10 minutes | sends new bell notifications to phones that turned alerts on | variable `PUSH_ALERTS` = on, secret `VAPID_PRIVATE_KEY` |
| Rent reminders (`rent-reminders`) | 08:07 daily | reminds tenants and managers about rent due or overdue | variable `RENT_REMINDERS` = on (until then it only counts) |
| Still-available reminders (`listing-stale`) | 08:37 daily | asks an agent "Still available?" for a published listing not saved in 75 days; again every 14 days | variable `LISTING_STALE_ALERTS` = on (until then it only counts). Needs migration 0005 |
| Keep-alive (`keepalive`) | 11:00 daily | pings Supabase and the Market Scan so the free project is not paused | none |
| Lead response alerts (`lead-response`) | every hour at :17 | "Not contacted yet" to the assigned person after 24 hours (Super Admins when unassigned), the broker after 48; once per lead; leads older than 14 days ignored | `LEAD_RESPONSE_ALERTS` = on (off: counts only); `LEAD_RESPONSE_HOURS` changes 24 |
| Reminders (`reminders`) | every 15 minutes | Viewing and other calendar reminders (1 hour, 3 hours or 1 day before, as picked on the entry) to the lead's assignee; licence and permit renewals in Compliance at 60, 30, 7 days and on the day, to the record's owner and an agent's broker | `REMINDER_ALERTS` = on (off: counts only); needs migration 0011 |
| Database backup (`backup`) | 02:23 daily | copies every table, accounts and the file list; encrypts it; keeps it 30 days as a run artifact; proves it restores | `BACKUP_PASSPHRASE` secret (12+ characters; keep a copy outside GitHub) |
| Old data clean-up (`retention`) | monthly, 2nd, 03:41 | counts (and, when on, deletes) read notifications after 180 days, resolved password resets after 30, spam inquiries after 90, Autopilot steps after 180 | `RETENTION_CLEANUP` = on, only after the periods are confirmed |
| Backend health check (`backend-check`) | 13:00 daily, and after each push to `main` | probes every function, table and endpoint a visitor could reach; fails if something is open that should be closed, or if a function's newer code has waited more than 3 days for **Deploy edge functions**; lists secret names the functions read but that are not set; fails when the database or stored files pass 80% of the plan's limit | `SUPABASE_ACCESS_TOKEN` (for the deploy, secret-name and usage parts); `USAGE_DB_LIMIT_MB` / `USAGE_STORAGE_LIMIT_MB` for a plan other than free (500 / 1024) |
| Market price index (`market-index`) | 02:30 daily | writes `data/market-index.json` to `main` | variable `MS_API_URL` (optional) |
| Market scan nightly check (`market-scan-nightly`) | 03:23 daily | runs two real scans and opens one issue if a source stops returning listings | none |
| Tests (`tests`) | every push and pull request, and 11:17 daily | all test suites | none |
| Comparables refresh (`comparables-monthly`) | 1st of the month, 10:17 | bank and Pag-IBIG prices into `data/comparables`; opens a calibration pull request | none |
| Value Guide data review (`estimator-data-review`) | Monday 18:30 | opens an issue when the reference data review is due | none |
| Vercel cron | switched off (21 Oct 2026) | the daily Autopilot call to `/api/agent-dispatch` was removed from `market-scan/vercel/vercel.json`: Autopilot made no outside changes (owner decision). The in-app "Run Agent" still works. To bring it back, add the `crons` entry again. The endpoint still refuses calls without `CRON_SECRET` | `CRON_SECRET` in Vercel (kept) |

Secrets live in **Settings > Secrets and variables > Actions**. The job log never prints names, amounts or keys; it prints counts only, because the repository is public.

## When a job fails

Phone alerts, rent reminders, still-available reminders, lead response alerts, viewing and licence reminders, the database backup, keep-alive, the backend health check and the market price index open **one issue** titled `Scheduled job failed: <name>` when a run fails (phone alerts opens it once; the others add a comment on each later failure). Open the run link in the issue, read the red step, fix it, close the issue. If you close it and the job fails again, a new issue opens.

The market scan check, the comparables refresh and the data review keep their own "needs attention" or "review due" issues and update them themselves. The tests show on the pull request. The Vercel cron has no alert yet.

Common causes:
- **Token or secret expired** (`SUPABASE_ACCESS_TOKEN`): make a new one in Supabase > Account > Access tokens, update the secret.
- **"The repository has newer code than the deployed version"**: run Actions > Deploy edge functions.
- **A migration not applied yet**: the health check lists such items as "waiting for a migration" and does not fail on them. Apply the migration.
- **A site changed its pages** (market scan, BDO PDF): the issue says which source; the comparables issue explains the manual BDO upload.

## Changing the database

1. Migrations are files in `supabase/migrations/`, numbered in order. Each is safe to run twice.
2. **Actions > Apply database migration**, pick the file, run it with **test** first (a copy, nothing live changes), then **apply**.
3. Apply in number order. Today: 0004 then 0005 are written and waiting.
4. Nothing else should change the live database by hand. The SQL editor skips the checks the app relies on.

## Backing up and restoring

There is no automatic backup today. This is an open decision (Supabase plan, roadmap D1/D2). Until then:
- Before a migration, export the tables you care about from the Supabase dashboard.
- The back office has a JSON backup button, but it leaves out several tables (brokerage transactions, property management, ads, playbooks, pre-selling).
- `pms_workspaces_backup_20261017` is a copy of the property management data from before the move to tables. Keep an offline copy before dropping it.

## Updates

Dependabot opens a grouped pull request once a month for the GitHub Actions and the two Market Scan packages. Merge when the checks are green. `web-push` is pinned to one version in `push-alerts.yml`.

## Restore from a backup

The nightly **Database backup** run keeps an encrypted copy for 30 days (Actions > Database backup - nightly > a run > Artifacts > `sea-backup`). Photos and documents are not in it; only their names and sizes.

1. Download the artifact and unzip it: you get `sea-backup-YYYY-MM-DD.bin`.
2. On a computer with Node 20+: `BACKUP_PASSPHRASE='your passphrase' node tools/backup.js check sea-backup-YYYY-MM-DD.bin` lists the tables and row counts.
3. `BACKUP_PASSPHRASE='your passphrase' node tools/backup.js restore sea-backup-YYYY-MM-DD.bin --sql restore.sql` writes the SQL.
4. Load it into an empty database built from `supabase/migrations` (a new Supabase project, or the same one after clearing the damaged tables): run each migration in order, then `restore.sql`. The nightly run does exactly this as its restore drill, so a green run means the steps work.
5. Restoring over live data replaces it: ask before doing this on the real project.

