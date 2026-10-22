# Runbook: what runs when, and what to do when it breaks

Written 2026-10-21. Plain words on purpose. Times are Philippine time.

## Where things live

| Part | Where | Deploys when |
|---|---|---|
| Website and back office | Cloudflare (esrealty.tradersgag6.workers.dev) | every push to `main` |
| Database, logins, photos, server functions | Supabase | database: you run **Actions > Apply database migration**; functions: **Actions > Deploy edge functions** |
| Market Scan (live listing search) and one daily call | Vercel (esrealty-market-scan.vercel.app) | its own Vercel deploy |
| Scheduled jobs and tests | GitHub Actions | they run by themselves |

Pushing to `main` changes the live website. Work happens on a branch and a pull request; merge only after the checks are green.

## Scheduled jobs

| Job (workflow) | When | What it does | Switch |
|---|---|---|---|
| Phone alerts (`push-alerts`) | every 10 minutes | sends new bell notifications to phones that turned alerts on | variable `PUSH_ALERTS` = on, secret `VAPID_PRIVATE_KEY` |
| Rent reminders (`rent-reminders`) | 08:07 daily | reminds tenants and managers about rent due or overdue | variable `RENT_REMINDERS` = on (until then it only counts) |
| Still-available reminders (`listing-stale`) | 08:37 daily | asks an agent "Still available?" for a published listing not saved in 75 days; again every 14 days | variable `LISTING_STALE_ALERTS` = on (until then it only counts). Needs migration 0005 |
| Keep-alive (`keepalive`) | 11:00 daily | pings Supabase and the Market Scan so the free project is not paused | none |
| Backend health check (`backend-check`) | 13:00 daily, and after each push to `main` | probes every function, table and endpoint a visitor could reach; fails if something is open that should be closed, or if a function's newer code has waited more than 3 days for **Deploy edge functions**; lists secret names the functions read but that are not set | `SUPABASE_ACCESS_TOKEN` (for the deploy and secret-name part only) |
| Storage use check (`usage-check`) | 05:23 daily | reads the database size and stored-file size (read-only); fails and opens an issue at 80% of the plan's limit; the numbers show on the run's Summary page. Bandwidth is not measured: see Usage in the Supabase dashboard | `SUPABASE_ACCESS_TOKEN`; `USAGE_DB_LIMIT_MB` / `USAGE_STORAGE_LIMIT_MB` for a plan other than free (500 / 1024) |
| Market price index (`market-index`) | 02:30 daily | writes `data/market-index.json` to `main` | variable `MS_API_URL` (optional) |
| Market scan nightly check (`market-scan-nightly`) | 03:23 daily | runs two real scans and opens one issue if a source stops returning listings | none |
| Tests (`tests`) | every push and pull request, and 11:17 daily | all test suites | none |
| Comparables refresh (`comparables-monthly`) | 1st of the month, 10:17 | bank and Pag-IBIG prices into `data/comparables`; opens a calibration pull request | none |
| Value Guide data review (`estimator-data-review`) | Monday 18:30 | opens an issue when the reference data review is due | none |
| Vercel cron | 14:00 daily | calls `/api/agent-dispatch` (the Autopilot worker). Refuses everything unless `CRON_SECRET` is set in Vercel | `CRON_SECRET` in Vercel |

Secrets live in **Settings > Secrets and variables > Actions**. The job log never prints names, amounts or keys; it prints counts only, because the repository is public.

## When a job fails

Phone alerts, rent reminders, still-available reminders, keep-alive, the backend health check and the market price index open **one issue** titled `Scheduled job failed: <name>` when a run fails (phone alerts opens it once; the others add a comment on each later failure). Open the run link in the issue, read the red step, fix it, close the issue. If you close it and the job fails again, a new issue opens.

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
