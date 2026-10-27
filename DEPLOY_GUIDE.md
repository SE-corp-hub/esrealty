# Deployment Guide — CRM Autopilot + Market Scan Stores

Three deployment targets. Steps 1–3 enable the CRM Autopilot (queued agent tasks
run by a timed edge function); Step 4 covers the store-locator dev-only route that
was just added.

## 1. Supabase — schema

The tables and functions this needs (`crm_leads`, `compliance_records`, `agent_tasks` /
`agent_steps` with their worker RPCs, `ad_posts`) are part of the live database and of
`supabase/migrations/0000_baseline.sql`, which rebuilds the whole schema for a new
project (see `supabase/migrations/README.md`). Nothing to run on the live project.

The original scripts (`supabase/archive/crm_leads.sql`, `compliance_registry.sql`,
`agent_tasks.sql`, `ad_posts.sql`) are kept in `supabase/archive/` for reference.

## 2. Supabase — deploy the `agent-dispatch` edge function

The function needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`AGENT_DISPATCH_SECRET`. `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are **default
secrets** (always available); only the dispatcher secret is custom:

```
cd supabase
supabase functions deploy agent-dispatch
supabase secrets set AGENT_DISPATCH_SECRET="<long-random-token>"
```

Manual alternative (match the deployed ref `hdkmvwxgjgzbuycjrbyq`):
- Dashboard → **Project Settings → Secrets → Custom secrets** → add
  `AGENT_DISPATCH_SECRET` (default secrets already cover URL + service role).

> **JWT verification must be OFF** for this function (Edge Functions →
> agent-dispatch → Settings → "Verify JWT" toggle → **off** → Save). The
> function checks `x-agent-dispatch-secret` itself; the platform JWT gate
> otherwise rejects the cron's no-`Authorization` calls with
> `UNAUTHORIZED_NO_AUTH_HEADER` before the code runs.

Verify it answers (claim tick + auth both ways work):
```
curl -X POST "https://<ref>.supabase.co/functions/v1/agent-dispatch" \
  -H "Content-Type: application/json" -H "x-agent-dispatch-secret: <token>" \
  -d '{}'
```
A `401 Unauthorized` on a wrong secret is actually a good sign — it proves the
function is alive and reachable.

## 3. Vercel — cron tick + env

This project deploys via the **CLI from the repo root**, not Git integration —
pushing to GitHub does *not* trigger Vercel deploys. The `.vercel` link lives at
the repo root; the project's Root Directory is `market-scan/vercel`.

```
npm i -g vercel; vercel login          # once
# from the REPO ROOT (never from market-scan/vercel — the CLI doubles the path):
vercel deploy --prod --yes
```

Env vars (add via CLI — stored as hidden Secrets):
```
echo "https://<ref>.supabase.co/functions/v1/agent-dispatch" | vercel env add AGENT_EDGE_URL production
echo "<same token as AGENT_DISPATCH_SECRET>"                  | vercel env add AGENT_EDGE_TOKEN production
vercel deploy --prod --yes     # re-deploy so envs are baked in
```

`vercel.json` defines the schedule — **daily** because the Vercel Hobby plan
only allows one cron run per day (an hourly `0 * * * *` fails the deploy with an
explicit plan error). Upgrade to Pro for hourly:
```json
"crons": [{ "path": "/api/agent-dispatch", "schedule": "0 6 * * *" }]
```
The cron calls `api/agent-dispatch`, which claims due tasks and runs the recheck
ladder. **Known behavior:** if `AGENT_EDGE_URL`/`AGENT_EDGE_TOKEN` are unset, the
shim no-ops silently (`{"ok":true,"skipped":"agent edge not configured"}`).

> **Gotcha (fixed 2026-09-19):** `api/agent-dispatch.js` originally returned a
> Web `Response` from a `module.exports = async (req, res)` handler. Vercel's
> Node runtime ignores that return value, so the request sat until the 300s
> timeout. It now writes through `res` using the same `(req, res)` style as
> `api/ping.js`.

Verify end-to-end:
```
https://esrealty-market-scan.vercel.app/api/agent-dispatch
```
Expect `{"ok":true,"claimed":0,"done":0}` (or `skipped: "no edge env"` if not
wired).

## 3b. Ad performance sync (optional) — `api/ad-perf`

The CRM "Ad ROI" card reads `perfViews`/`perfInquiries` off each `ad_posts`
record. Agents can always type those totals with **Log perf**; to pull them from
a marketplace feed instead, point the sync seam at an upstream URL:

```
echo "https://<vendor-or-broker-feed>/ad-performance" | vercel env add AD_PERF_SOURCE_URL production
echo "<optional bearer token>"                         | vercel env add AD_PERF_SOURCE_TOKEN production
```

The upstream must return either a bare array or `{ "ads": [...] }` of
`{ id, views|perfViews, inquiries|perfInquiries, url? }`; `id` matches the
`ad_posts.id`. **If `AD_PERF_SOURCE_URL` is unset the endpoint no-ops**
(`{"ok":true,"skipped":"ad perf source not configured"}`) and the browser shows
an "isn't configured yet" toast — nothing is fabricated. Channel partners
(Lamudi / Property24 / Facebook / TikTok) gate these metrics behind credentials,
so there is nothing to sync until a feed is provisioned.

Verify: `https://esrealty-market-scan.vercel.app/api/ad-perf`

## 4. Store locator — dev-only route (already applied)

`market-scan/vercel/server.js` now serves `/api/market-scan/stores` locally with
the worker's 24 h in-memory cache semantics (`cached`/`refreshed`/`stale`/
`cachedAt`). This is **dev/harness only** — it makes `stores_freshness_e2e` and
store-locator flows testable against `:8932`.

The **hosted** Vercel adapter (`vercel/api/market-scan/stores.js`) intentionally
does **not** emit those keys — `tests/backend_parity_node.js` enforces that
contract — so the production "Served from cache" chip will not appear. If you want
the chip live in production, the parity test + adapter must be changed together
(not a one-liner; do it deliberately).

## Expected production behavior after steps 1–4

- Leads in the app: each Run/Recheck pushes `agent_tasks` rows; the hourly cron
  leases and executes them; steps + evidence sync back into OSM-rendered Agent tab.
- Offline degrade: no Supabase/Vercel connectivity → the app's local engine still
  ticks, and steps render as "missing cloud" until connectivity returns.
- The `Cached · observed` chip on store results appears on local dev only.
- Advertising: the Ads tab, source funnel, and lead dedupe run fully offline;
  when Supabase is up, ad save/publish/delete sync rows to `ad_posts` (via the
  live-bound client) and `supabase/check-backend.js` should report the table OK.
  `js/attribution.js` (source funnel + PH contact dedupe + first-response math)
  and `js/compliance_due.js` (expiry-window math) are plain static assets — no
  deploy step beyond a normal push.