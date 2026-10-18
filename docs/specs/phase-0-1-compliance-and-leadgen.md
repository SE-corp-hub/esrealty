> **Provenance.** This spec was captured as a single line with every
> newline stripped, which destroyed its markdown structure, and its bytes were
> double-encoded (UTF-8 read as CP437 and written back), so every em dash,
> arrow and box character was mojibake. Both faults are repaired here: the
> encoding is correct UTF-8, and the headings, rules, lists and code fences are
> restored. Wording and values are unchanged.
>
> Executed and superseded. Retained as the record of the Phase 0-1 build; the
> shipped artifacts are `supabase/archive/compliance_registry.sql`,
> `supabase/archive/ad_posts.sql`, `js/compliance_due.js`, `js/attribution.js`,
> `tests/compliance_registry_e2e.js`, `tests/ads_repo_e2e.js` and
> `tests/source_attribution_node.js`.

# Phase 0–1 Build Spec — Compliance Foundation + Lead-Gen Automation

**Target stack:** the existing ES Realty CRM (static JS `js/app.js`), Supabase (RLS), mirroring `supabase/archive/crm_leads.sql`, the CRM Autopilot engine (`agent_tasks` + `agent_dispatch`), and the market-scan backend. This is the build spec `ph-realtor` executes; follow the same discipline as `docs/specs/agent-autopilot.md` (no fabrication, evidence ledger, Approve/Reject suggestions, gates at the end).

---

## Phase 0 — Compliance Foundation

Objective: every license, permit, bond, and accreditation has a single tracked record with expiry-driven reminders, and every published listing carries the legally required disclosure boilerplate.

### 0.1 Compliance registry (new CRM tab "Compliance")

**Supabase** — new table `compliance_registry` (create via new SQL file `supabase/archive/compliance_registry.sql`):

```sql
id            uuid pk
type          text  -- broker_license | entity_reg | mayors_permit | bir_reg | dhsud_lts | buyer_bond | bank_acc
name          text  -- e.g. "PRC Real Estate Broker License"
number        text
holder        text  -- person / firm name
issued_at     date
expires_at    date
status        text  -- active | expiring | expired
notes         text
owner         text  -- my_full_name
updated_at    timestamptz default now()
```

- RLS: same helper pattern as `crm_leads` — owner sees own; broker-of and super-admin see all. Keep it invoker-rights.

**Frontend (`js/app.js`)**

- New `compliance_*` helpers + a Compliance tab in the CRM (list, add/edit modal mirroring the leads modal wiring: `bindCompliance`, `renderCompliance`).

- Auto-status: `expires_at < now + 60d → expiring`, `< now → expired`.

- **Reuse the Autopilot**: `agentClassify`/`agentLadder` learn a new kind `compliance` — on each lead/registry entry within 60 days of `expires_at`, produce a `suggestion` step: "Renew <name> (#<number>) by <date>". Approve → evidence row (`observed`), then `agent_tasks` schedules the renewer task on the expiry date through the existing `agent_dispatch` worker (`kind` column extension). This needs a small parallel in `agent_tasks.sql` (`kind` column already free) and the `agent-dispatch` edge function ladder map.

### 0.2 Entity onboarding checklist

Config list (JSON in the app): SEC/DTI registration · Mayor's permit · BIR registration (VAT/non-VAT) · corporate bank account · PRC broker license + CPE hours · DHSUD project accreditation + buyer protection bond.

Seed one `compliance_registry` row per checklist item with `name`/`type`/`expires_at` null where unknown; the Compliance tab shows completion % and the expiry dashboard.

### 0.3 Listing disclosure boilerplate (enforced, not optional)

- Listing records gain fields: `brokerName`, `brokerLicense`, `dhsudAccreditation` (nullable; for **pre-selling** projects mark `dhsudRequired=true`).

- Every "publish/copy ad" action renders the footer: `Listed by <Firm> · <BrokerName>, Licensed Real Estate Broker (PRC #<license>)` `+ DHSUD License-to-Sell #<accreditation>` when a project is pre-selling, `+ "Pre-selling shown for information only; not an offer to sell. Verify zoning and financing with your broker."`

- The compliance logger appends an `observed` evidence row on the listing when the disclosure is generated (who, when, which listing).

### Phase 0 acceptance

- Compliance tab: add/edit/status ticks, expiry dashboard counts.

- Autopilot produces `compliance` suggestion ≥60 d before expiry; Approve records evidence and schedules renewer task.

- Pre-selling listings always carry the DHSUD footer on copy/publish.

- New test `compliance_registry_e2e.js` (+ node test for the 60-day window math).

---

## Phase 1 — Lead Generation Automation

Objective: a measurable, de-duplicated leads pipeline where every inquiry is stampedwith source/campaign/time at capture and every ad is traced to the inquiries itproduced.

### 1.1 Capture hardening (small, high-value)

- Standard **source vocabulary** enforced in `leadSaveForm`: the existing `source` field gets a datalist of canonical values (`lamudi`, `property24`, `myproperty`, `dotproperty`, `fb_marketplace`, `fb_group`, `tiktok`, `google`, `whatsapp`, `viber`, `walkin`, `referral`, `site`).

- **UTM/ref capture** on the public property page: read `?utm_source/utm_medium/  utm_campaign` once and pre-fill the quoted/tracked lead.

- **Click-to-chat delta**: every listing renders `[data-listing-contact]` buttons —  `WhatsApp (<a href="https://wa.me/<PH-number>?text=<prefill>">)` and `Call` (`tel:+63…`). When a walk-in talks about listing X, the agent's message cites `listingId` so the source stays traceable.

- New seed tag: inquiry timestamps already exist; add `firstResponseMinutes` (when the rep first edits the lead) to feed the follow-up speed KPI.

### 1.2 Ad / content repository (new tab "Ads")

- **Supabase** `ad_posts` table (same RLS pattern):```
id, listingId, channel (lamudi|property24|myproperty|dotproperty|fb|tiktok),
captionKey, url, status (draft|posted|paused), postedAt, updatedAt, owner,
perfViews, perfInquiries   -- filled in when a channel API/sync is available
```

- **Repurpose workflow**: content capture box (video/image/drop) → auto-generates  3 captions (descriptive / hook-based / Taglish short) all carrying the Phase 0  disclosure footer → user picks and publishes to one or more channels → each becomes an `ad_posts` row linked to a listing.

- **Attribution**: incoming leads with `source=fb_marketplace` + quoted listing are auto-linked to the newest posted row for that listing/channel so the Ads tab can show "30 inquiries · 4 visits · 1 reservation" per ad (visits/reservations come from the CRM stage history on the linked lead).

### 1.3 Lead-gen KPIs (extend the existing leads/analytics surface)

- `sourceFunnel()` helper: inquiries → qualified → visits → reservations → closed, grouped by `source`, with conversion % and cost-per-inquiry (cost column optional on `ad_posts`).

- Render as a new Analytics card row: "Leads by source" + "Ad ROI" (per ad post, from `perfViews/perfInquiries` + funnel counts).

### Phase 1 acceptance

- Every created lead has a canonical `source` + `ts`; duplicates merge on phone+email.

- Ads tab: create post from a listing, footer auto-appended, publish → row tracked; incoming inquiry with that listing+channel appears in the ad's funnel.

- Click-to-chat buttons render on every listing; `data-listing-contact` counted in the agent's evidence when cited.

- New tests: `ads_repo_e2e.js` (create→publish→attribution) + `source_attribution_  node.js` (canonical vocab + dedupe + funnel math).

---

## Walkthrough checklist (1-hour quick start to do TODAY)

1. Add `supabase/archive/compliance_registry.sql`; run it; add `compliance_*` view + modal.

2. Wire the Autopilot `compliance` kind into `agentClassify` + the edge ladder.

3. Add listing disclosure fields + footer generator.

4. Harden `source` vocabulary + UTM capture + click-to-chat buttons.

5. Add `ad_posts` table + Ads tab + repurpose box.

6. Add `sourceFunnel` analytics card.

7. Write the two Phase-0/1 tests; run gates: `node --check js/app.js` → `node build_app.js` → `tests/run_all.ps1` (+ `-Mobile`), zero new failures; commit as one "Phase 0–1" feature commit.

## Boundary guardrails (never automate)

Broker execution/signing, notarization, BIR filings, and Registry-of-Deeds transfers stay human — the system only prepares, tracks, and reminds.
