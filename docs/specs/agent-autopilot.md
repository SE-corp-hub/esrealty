# AGENT PROMPT — CRM Autopilot (Comp AI-style agent for ES Realty)

**Goal:** Give the ES Realty CRM a self-directed follow-up agent in the spirit of
Comp AI CRM (trycompai/crm) — no guesses, a queue the agent schedules for itself,
per-lead visibility into what the agent did and why, and an evidence ledger the
rep settles. Runs on the existing stack (static app + Supabase + the market-scan
Vercel project). No new monorepo, no Postgres lift-out, no second product.

## Why this over installing Comp AI CRM
Comp AI is an MIT Turborepo/Bun monorepo (Next.js + NestJS/tRPC + Prisma +
eve/Vercel AI Gateway/Sandbox) needing its own Postgres and three deployments. It
cannot see our deals, listings, or property data without a bridge, and none of its
agent runtime maps to a static app + Supabase. We keep its three durable ideas and
build the minimum that carries them natively.

## Design rules (borrowed from Comp AI)
1. **Nothing about a lead is guessed.** Every agent-written fact is tagged
   `kind: observation` (something the system saw: status change, scheduled
   viewing, a fill-in) or `kind: suggestion` (best available — a human settles it).
   `confident: true` only on observations.
2. **The agent books its own work.** Instead of a static next-follow-up date the
   rep must keep updating, the agent writes a *task with a reason* into a due
   queue and a `next_recheck` on the lead. It never runs "every N minutes"; it
   runs when something is due.
3. **Work survives reloads and leases against double-running.** Tasks are claimed
   with `FOR UPDATE SKIP LOCKED` semantics (a lease with an expiry). A dead tick
   frees its row when the lease expires; two dispatchers take disjoint work.
4. **Reasons are shown.** Every step records `reason`. A follow-up that cannot
   say why the agent will be back doesn't got scheduled.
5. **Weak evidence is a suggestion, not a record.** Non-confident steps render as
   suggestion bubbles the rep Approves (writes to the evidence ledger as
   observed) or Rejects (discarded, recorded as rejected).

## Architecture
- **Client tick (always works, offline):** a deterministic `agentTick(l)` in
  `js/app.js` computes due work from the lead record (status ladder, aging,
  activity gaps), writes steps and a next recheck onto the in-payload lead state,
  persisted by the existing `save()` + `persistLeadToCloud`.
- **Cloud queue (when deployed):** Supabase tables + RPC. RLS lets
  creator/assigned/broker-of-team/super-admin see their team's queue and steps,
  exactly like `crm_leads`. Service-role caller runs the tick.
- **Headless scheduler:** Supabase edge function `agent-dispatch` (runs a tick
  via the RPCs, service-role) + a Vercel cron in the market-scan project that
  pings it when envs are set. Env-gated so the local app is unaffected.

### Phase 1 — Task queue + worker
- `supabase/archive/agent_tasks.sql`:
  - `public.agent_tasks(id uuid pk, lead_id text not null, kind text, reason text,
    payload jsonb, due_at timestamptz, lease_until timestamptz, lease_id uuid,
    state text check in ('due','working','done','cancelled'),
    created_at, completed_at, task_meta jsonb)`.
  - `public.agent_steps(id bigint identity, lead_id text, task_id uuid,
    kind text check in ('observation','suggestion'), summary text, detail jsonb,
    confident boolean, state text check in ('open','approved','rejected'),
    done_by text, created_at)`.
  - Indexes `(state, due_at)`, `(lead_id)`, `(task_id)`; RLS enabled with select
    policies mirroring `crm_leads` (creator / assigned / broker-of-team /
    super-admin read-and-update on their rows).
  - RPC `agent_claim_due(p_max int default 10)` — `security definer`, `set
    search_path = public`: claims up to p_max rows where `state='due' and
    due_at <= now() and (lease_until is null or lease_until < now())`, sets
    `state='working'`, `lease_id`, `lease_until = now() + interval '5 minutes'`,
    returns claimed rows as json (with `FOR UPDATE SKIP LOCKED`).
  - RPC `agent_complete(p_task uuid, p_steps jsonb, p_next_due timestamptz,
    p_next_reason text)` — inserts steps rows, marks task done, and (when
    p_next_due not null) inserts the follow-on task with `reason=p_next_reason`.
  - RPC `agent_ping()` — convenience: `claim → return`, the caller (edge
    function or client) builds concrete steps, calls `agent_complete`. One
    round-trip per lease, no long transactions.
- `supabase/functions/agent-dispatch/index.ts` (Deno, supabase-js v2,
  `SERVICE_ROLE_KEY` + `SUPABASE_URL` env): runs `agent_claim_due`, builds the
  concrete steps with the same ladder rules as the client, `agent_complete`.
  It is a plain observer: it never fabricates; steps cite task payload + reason.
- `market-scan/vercel/vercel.json`: `"crons": [{ "path": "/api/agent-dispatch",
  "schedule": "0 6 * * *" }]` (daily — Hobby plan ceiling; Pro allows hourly).
- `market-scan/vercel/api/agent-dispatch.js`: if `AGENT_EDGE_URL`+
  `AGENT_EDGE_TOKEN` set, warm + `POST` the edge function; else returns
  `{ok:true, skipped:"no edge env"}` so local/cold deploys are harmless.
  Deploys are CLI-based from the repo root (`vercel deploy --prod --yes`),
  not Git-triggered; the edge function's "Verify JWT" toggle must be OFF
  (the shim authenticates via `x-agent-dispatch-secret`).
- `market-scan/vercel/package.json`: no new dependencies (fetch is global).

### Phase 2 — Evidence ledger on leads
- Lead payload gains `evidence: [{id, field, value, src:'observed'|'claimed',
  confidence:0..1, by, ts}]` and `agent: {nextRecheck, lastRun}`.
- Lead editor: when a rep types a fact the system cannot see (notes, budget,
  income, SPA status…) the stored field is additionally recorded in `evidence`
  as `claimed` so the source of truth is explicit.
- Lead detail gets an **Evidence** panel: ledger entries with Observed (green) /
  Claimed (gold) chips + confidence meter; agent-suggested facts appear here as
  `open` suggestions with Approve / Reject.
- `leaderCard` shows a dim "agent recheck <date>" chip when `l.agent.nextRecheck`
  is set.

### Phase 3 — Agent tab per lead
- Lead detail gains an **Agent** section (below Activity) with:
  - **Run now** button + last-run time; running a tick locally AND via cloud RPC
    when available (degrades to local without error).
  - **Steps timeline** (from `l.agentSteps` + cloud `agent_steps`): icon per kind,
    summary, reason, confident badge, and for `suggestion` steps Approve/Reject.
  - **Evidence ledger** summary and the approve/reject wiring.
  - A deterministic **"What next"** box (not an LLM): returns the due reason,
    the recommended touch (call/WhatsApp/site visit), a draft message from
    `sales_playbooks` if available, and the next scheduled recheck — so the rep
    can see the agent's reasoning instead of a black box.
- Leads list header gains **Run agent** (ticks all leads in scope + refreshes).

### Tick ladder (deterministic, used by client and edge function)
For a lead `l` with status `s`, `createdAt`, `updatedAt`, `nextFollowUp`,
`lastActivityAt` (max of activity ts), `agent.lastRun`, `visits`:
1. **Stale-new:** `s='new'` and no activity for 2+ days → observation step
   ("No touch since created …"), suggestion "Call to qualify", next recheck +2d,
   plus schedule a follow-on task.
2. **Contacted w/ booking:** has `nextFollowUp` parseable and in the past and
   status not closed/lost → observation ("Follow-up date passed"), next recheck
   = today at 09:00 (so the queue holds it; repr surfaces it), reason =
   "promised to call back <date>".
3. **Site visit booked:** for each upcoming visit stop with status scheduled →
   suggestion "Remind <name> of site visit <date>", recheck on visit day −1.
4. **Offer/negotiation:** 4+ days since last touch → suggestion "Re-engage on
   offer <amount>", recheck +2d.
5. **Dormant control:** 7 days without agent lastRun and no other rule → warn a
   reason ("nothing scheduled; pause to avoid spamming") and recheck +7d (keeps
   the loop honest without inventing work).
6. Steps: every entry carries `kind`, `summary`, `reason`, `confident`
   (`observations=true`, `suggestions=false`).

### Acceptance (feasibility_e2e-like probe)
1. `tests/agent_crm_e2e.js`: seed leads → open lead detail → Agent section
   present; Run now produces ≥1 step for a stale-new seeded lead; a suggestion
   step is rendered with Approve/Reject; Approve writes the fact into
   `lead.evidence` as `observed` and flips the step to resolved; Reject flips to
   rejected; next recheck is set after the run; card badge appears; all offline.
2. `node --check js/app.js` → `node build_app.js`.
3. Full desktop + `-Mobile` suites, zero **new** failures (known baseline:
   `stores_freshness` cloud mislabel; OSM-tile network flake; `bt-map-road`
   overflow — unaffected).
4. Optional (deployment-only, can't gate locally): `agent_tasks.sql` re-run in
   Supabase yields 0 errors; edge function + cron respond `{ok:true}`.

### Files
- `supabase/archive/agent_tasks.sql` (new)
- `supabase/functions/agent-dispatch/index.ts` (new)
- `market-scan/vercel/vercel.json` (cron)
- `market-scan/vercel/api/agent-dispatch.js` (new)
- `js/app.js` (agent engine + evidence + tabs + bindings; app.min.js rebuilt)
- `tests/agent_crm_e2e.js` (new)
- `docs/specs/agent-autopilot.md` (this file)

### Adjacent feature masters (Phase 0/1, built and gated)
- `docs/specs/phase-0-1-compliance-and-leadgen.md` — the build spec for compliance foundation + lead-gen
  automation whose acceptance is now green.
- `supabase/archive/ad_posts.sql` — shared Ads repository + RLS (deploy step #4 in
  `DEPLOY_GUIDE.md`).
- `js/attribution.js` / `js/compliance_due.js` — UMD helpers shared by the app
  and node tests (`window.ESREALTY_ATTR` / `window.ESREALTY_DUE`; app.js falls
  back inline when they are absent).
- Tests: `tests/ads_repo_e2e.js` (ads repo + per-ad attribution + pre-selling
  DHSUD footer), `tests/source_attribution_node.js`, `tests/compliance_registry_
  e2e.js`, `tests/compliance_registry_node.js`.