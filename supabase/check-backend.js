"use strict";
// Backend health checker for SEA ESTATES.
//
// Pings every Supabase edge function to confirm it is deployed, verifies that
// protected routes enforce auth, and reads each function's source to report
// which environment variables it references (so you know what must be set in
// Project Settings -> Edge Functions -> Secrets).
//
// Usage:
//   node supabase/check-backend.js [--ref YOUR_PROJECT_REF]
//
// Defaults to the production project ref mrngaqtbaseewzcsogqi. You never need
// secrets to run this — it only hits public/health routes and expects 401/403
// on protected ones.

const fs = require("fs");
const path = require("path");

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const REF = arg("--ref", "mrngaqtbaseewzcsogqi");
const BASE = `https://${REF}.supabase.co/functions/v1`;

const fnDir = path.join(__dirname, "functions");

// Every request gives up after 12 seconds, so one slow service cannot hang the nightly run.
const fetchT = (url, opts) => fetch(url, Object.assign({ signal: AbortSignal.timeout(12000) }, opts || {}));

// Each entry: name + the probe request(s) that exercise the deployed function
// using only public/unauthenticated calls:
//   { path, method, expect }  expect = HTTP status we assert to prove the
//   function is deployed and behaviour is correct.
const FUNCTIONS = [
  {
    name: "listing-api",
    probes: [
      { path: "/listing-api/api/listings?per_page=1", method: "GET", expect: 200, note: "public catalog" },
      { path: "/listing-api/api/users/me/listings", method: "GET", expect: 401, note: "protected route rejects anonymous (auth enforced)" },
      { path: "/listing-api/api/site-settings", method: "GET", expect: 200, note: "site settings" },
    ],
  },
  {
    name: "seo",
    probes: [
      { path: "/seo/robots.txt", method: "GET", expect: 200 },
      { path: "/seo/sitemap.xml", method: "GET", expect: 200 },
    ],
  },
  {
    name: "fb-leads",
    probes: [
      // GET without the right token must 403 (verification fails) — proves deploy.
      { path: "/fb-leads?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123", method: "GET", expect: 403, note: "webhook rejects bad verify token" },
    ],
  },
  {
    name: "admin-delete-account",
    probes: [
      { path: "/admin-delete-account", method: "POST", expect: 401, note: "rejects anonymous session", body: { user_id: "x" } },
    ],
  },
  {
    name: "admin-create-account",
    probes: [
      { path: "/admin-create-account", method: "POST", expect: 401, note: "rejects anonymous session", body: { email: "a@b.co" } },
    ],
  },
  {
    name: "notify-dispatch",
    probes: [
      // POST without secret/service key must 401.
      { path: "/notify-dispatch", method: "POST", expect: 401, note: "rejects missing secret", body: { to: "x", subject: "x" } },
    ],
  },
  {
    name: "location-report",
    // Value Guide report requests: saves the request as a CRM lead (it sends no email; the team
    // sends the report by hand). Until it is deployed the app saves the lead through listing-api
    // instead, so a miss is reported but not blocking.
    skipBlocking: true,
    deployHint: "Run the Deploy edge functions workflow (needs the SUPABASE_ACCESS_TOKEN repo secret), or: supabase functions deploy location-report --no-verify-jwt --project-ref " + REF,
    probes: [
      // An empty body fails validation before anything is saved or sent.
      { path: "/location-report", method: "POST", expect: 400, note: "rejects a request with no email", body: {} },
    ],
  },
  {
    name: "agent-dispatch",
    probes: [
      { path: "/agent-dispatch", method: "POST", expect: 401, note: "rejects a call without the dispatch secret", body: {} },
    ],
  },
  {
    name: "nearby-scan",
    // NOTE: the app computes nearby amenities locally and does not call this
    // function, so a miss here is informational, not a live outage.
    skipBlocking: true,
    deployHint: "OPTIONAL / UNUSED by the app (nearby is computed locally). Can be left as-is or re-deployed with --no-verify-jwt.",
    probes: [
      { path: "/nearby-scan", method: "POST", expect: 400, note: "rejects missing coords", body: {} },
    ],
  },
];

// Tables the app reads/writes through the REST API (publishable key). Missing
// tables surface as PGRST205 on the client and break cloud features; this check
// flags them before the app does.
//   200 = present (RLS hides the rows from an anonymous caller, so the body is
//         usually [] - that is expected, not an error)
//   401/403 = present, but the anonymous role has no privilege on it (also fine)
//   404 = MISSING (run the SQL)
const REST = {
  base: `https://${REF}.supabase.co/rest/v1`,
  headers: {
    apikey: "sb_publishable_OtrE6VXTJb4OrSCe6Z-f6g_qAcKyOvk",
    Authorization: "Bearer sb_publishable_OtrE6VXTJb4OrSCe6Z-f6g_qAcKyOvk",
  },
};
const REST_TABLES = [
  { table: "shared_listings", note: "public listing store" },
  { table: "public_listing_catalog", note: "catalog view the API serves" },
  { table: "listing_inquiries", note: "inquiry submissions" },
  { table: "storefront_inquiries", note: "contact/inquiry fallback" },
  { table: "crm_leads", note: "CRM leads" },
  { table: "ad_posts", note: "shared ad posts + attribution" },
  { table: "profiles", note: "user profiles" },
  { table: "app_state", note: "site settings live here" },
  { table: "presell_projects", note: "presell projects" },
  { table: "presell_payments", note: "presell payments" },
  { table: "portfolio_accounts", note: "portfolio cloud (portfolio_a_investor.sql)" },
  { table: "cash_entries", note: "portfolio cash ledger" },
  { table: "construction_projects", note: "construction projects" },
  { table: "construction_phases", note: "construction phases" },
  { table: "construction_vendors", note: "construction vendors" },
  { table: "construction_invoices", note: "construction invoices" },
  { table: "construction_change_orders", note: "construction change orders" },
  { table: "portfolio_proofs", note: "proof documents" },
  { table: "presell_units", note: "presell units" },
  { table: "broker_transactions", note: "deals / transactions" },
  { table: "cobroke_agreements", note: "co-broke invitations" },
  { table: "notifications", note: "in-app notifications" },
  { table: "sales_playbooks", note: "sales playbooks" },
  { table: "saved_listings", note: "saved listings" },
  { table: "agent_tasks", note: "agent follow-up tasks" },
  { table: "pms_workspaces", note: "old property management record (kept for rollback)", anonDenied: true },
  // Property Management v2 (supabase/archive/pms_v2_tables.sql): visitors have no rights at all.
  { table: "pms_owners", note: "PMS owners", anonDenied: true },
  { table: "pms_tenants", note: "PMS tenants", anonDenied: true },
  { table: "pms_properties", note: "PMS properties", anonDenied: true },
  { table: "pms_units", note: "PMS units", anonDenied: true },
  { table: "pms_leases", note: "PMS leases", anonDenied: true },
  { table: "pms_payments", note: "PMS payments", anonDenied: true },
  { table: "pms_maintenance", note: "PMS work orders", anonDenied: true },
  { table: "pms_expenses", note: "PMS expenses", anonDenied: true },
  { table: "pms_documents", note: "PMS documents", anonDenied: true },
  { table: "pms_receipt_counters", note: "receipt numbers (migrations/0001)", anonDenied: true },
  { table: "audit_events", note: "change log (visitors see no rows)" },
  // Checked, but reported as "not applied yet" instead of failing, until the migration has been run.
  { table: "push_subscriptions", note: "phone alerts (migrations/0003)", anonDenied: true, pending: "0003" },
  { table: "push_config", note: "phone alert key (migrations/0003)", anonDenied: true, pending: "0003" },
  { table: "site_settings", note: "website settings (migrations/0005)", pending: "0005" },
  { table: "agent_reviews", note: "client reviews (migrations/0016)", anonDenied: true, pending: "0016" },
];

// Columns other code depends on. A missing column answers 400 (42703).
const REST_COLUMNS = [
  { table: "profiles", column: "email", note: "co-broke invites, fb-leads, notify-dispatch (supabase/archive/phase3_broken_features.sql)" },
  { table: "notifications", column: "pushed_at", note: "phone alerts sender (migrations/0003)", pending: "0003" },
];

async function probeTable(entry) {
  const url = `${REST.base}/${entry.table}?select=*&limit=1`;
  try {
    const res = await fetchT(url, { headers: REST.headers });
    const got = res.status;
    // anonDenied tables must refuse visitors outright: a 200 means their rights came back.
    const ok = entry.anonDenied ? (got === 401 || got === 403) : (got === 200 || got === 401 || got === 403);
    let extra = "";
    if (entry.pending && got === 404) return { table: entry.table, note: entry.note, got, ok: true, pendingMissing: true, extra: "  [not applied yet: migrations/" + entry.pending + " - informational]" };
    if (got === 404) extra = "  <-- MISSING — run the matching supabase/*.sql";
    if (got === 401 || got === 403) extra = "  [present; no anonymous privilege]";
    if (entry.anonDenied && got === 200) extra = "  <-- VISITORS CAN QUERY THIS TABLE — run supabase/archive/pms_v2_tables.sql / phase1_security_rest.sql again";
    return { table: entry.table, note: entry.note, got, ok, extra };
  } catch (e) {
    return { table: entry.table, note: entry.note, got: "ERR", ok: false, extra: " [not reachable: " + (e && e.message || e) + "]" };
  }
}

// Database functions the app calls. Visitors must be refused (401/403); 404
// means the function is missing (run the SQL named in the note).
const REST_RPCS = [
  { fn: "pms_books", note: "super-admin list of books (pms_v3_books.sql)" },
  { fn: "pms_find_login", note: "brokers link owner/tenant logins (pms_v3_books.sql)", body: { p_email: "x@x.ph", p_role: "owner" } },
  { fn: "pms_tenant_send_payment", note: "tenant payment proof (migrations/0001)", body: { p_lease: "x", p_amount: 1, p_date: "2026-01-01", p_month: null, p_method: "Cash", p_reference: "", p_note: "" } },
  { fn: "pms_tenant_request_repair", note: "tenant repair request (migrations/0001)", body: { p_lease: "x", p_title: "x", p_details: "", p_category: "Other" } },
  { fn: "pms_my_repair_requests", note: "tenant's own requests (migrations/0001)" },
  { fn: "listing_stale_sweep", note: "stale-listing alerts, server only (migrations/0005)", pending: "0005" },
  { fn: "admin_announce", note: "staff announcements, Super Admin only (migrations/0007)", pending: "0007" },
  { fn: "lead_response_sweep", note: "lead response alerts, server only (migrations/0008)", pending: "0008" },
  { fn: "admin_records_owned", note: "account handover check, Super Admin only (migrations/0010)", pending: "0010" },
  { fn: "viewing_reminder_sweep", note: "viewing reminders, server only (migrations/0011)", pending: "0011", body: { p_dry_run: true } },
  { fn: "compliance_expiry_sweep", note: "licence renewal reminders, server only (migrations/0011)", pending: "0011", body: { p_dry_run: true } },
  { fn: "admin_person_find", note: "find a person, Super Admin only (migrations/0013)", pending: "0013", body: { p_query: "0917 000 0000" } },
  { fn: "public_agent", note: "agent pages, listing function only (migrations/0015)", pending: "0015", body: { p_slug: "x" } },
  { fn: "agent_site_open", note: "My website, brokers and agents (migrations/0015)", pending: "0015" },
  { fn: "public_agents", note: "agent directory, listing function only (migrations/0016)", pending: "0016" },
  { fn: "public_agent_count", note: "menu count for the directory, listing function only (migrations/0016)", pending: "0016" },
  { fn: "agent_check", note: "check an agent, listing function only (migrations/0016)", pending: "0016", body: { p_q: "0012345" } },
  { fn: "review_submit", note: "client reviews, listing function only (migrations/0016)", pending: "0016", body: { p_hash: "x", p_first: "x", p_initial: "", p_body: "x" } },
  { fn: "review_invite", note: "review links, Super Admin only (migrations/0016)", pending: "0016", body: { p_deal: "x", p_agent: "00000000-0000-0000-0000-000000000000" } },
  { fn: "licence_check_save", note: "licence checks, Super Admin only (migrations/0018)", pending: "0018",
    body: { p_agent: "00000000-0000-0000-0000-000000000000", p_licence_no: "x", p_prc_name: "x", p_valid_until: "2030-01-01", p_broker_accepted: false, p_id_seen: false, p_phone_confirmed: false, p_recheck: false } },
  { fn: "agent_reviews_admin", note: "review moderation list, Super Admin only (migrations/0018)", pending: "0018" },
];
async function probeRpc(entry) {
  try {
    const res = await fetchT(`${REST.base}/rpc/${entry.fn}`, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, REST.headers), body: JSON.stringify(entry.body || {}) });
    const got = res.status;
    const ok = got === 401 || got === 403;
    if (entry.pending && got === 404) return { table: "rpc " + entry.fn, note: entry.note, got, ok: true, pendingMissing: true, extra: "  [not applied yet: migrations/" + entry.pending + " - informational]" };
    const extra = got === 404 ? "  <-- MISSING — run the SQL in the note" : ok ? "  [present; visitors refused]" : "  <-- VISITORS CAN CALL THIS FUNCTION";
    return { table: "rpc " + entry.fn, note: entry.note, got, ok, extra };
  } catch (e) {
    return { table: "rpc " + entry.fn, note: entry.note, got: "ERR", ok: false, extra: " [not reachable: " + (e && e.message || e) + "]" };
  }
}
// Vercel (market-scan): both endpoints must refuse a caller without the
// scheduler's secret or a staff sign-in. Not reachable = informational only.
const VERCEL = "https://esrealty-market-scan.vercel.app";
const VERCEL_PROBES = [
  { path: "/api/agent-dispatch", note: "only Vercel's schedule may start a dispatch (CRON_SECRET)" },
  { path: "/api/ad-perf", note: "approved staff only" },
];
async function probeVercel(p) {
  try {
    const res = await fetchT(VERCEL + p.path, { method: "GET" });
    const got = res.status;
    return { path: p.path, note: p.note, got, ok: got === 401 || got === 403, reachable: true };
  } catch (e) {
    return { path: p.path, note: p.note, got: "ERR", ok: false, reachable: false, extra: " [not reachable: " + (e && e.message || e) + "]" };
  }
}

async function probeColumn(entry) {
  const url = `${REST.base}/${entry.table}?select=${entry.column}&limit=0`;
  try {
    const res = await fetchT(url, { headers: REST.headers });
    const got = res.status;
    const ok = got === 200 || got === 401 || got === 403;
    if (entry.pending && (got === 400 || got === 404)) return { table: entry.table + "." + entry.column, note: entry.note, got, ok: true, pendingMissing: true, extra: "  [not applied yet: migrations/" + entry.pending + " - informational]" };
    return { table: entry.table + "." + entry.column, note: entry.note, got, ok, extra: got === 400 ? "  <-- COLUMN MISSING" : "" };
  } catch (e) {
    return { table: entry.table + "." + entry.column, note: entry.note, got: "ERR", ok: false, extra: " [not reachable: " + (e && e.message || e) + "]" };
  }
}

// Extract referenced env vars from each function source for the "must be set"
// report. Managed/auto-injected vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
// are excluded from the "manual" list.
const AUTO_VARS = new Set(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
// name -> where it's used and what it is. (A Map built from 3-item arrays kept
// only the function name, which is how the descriptions went missing.)
const KNOWN_VARS = new Map(Object.entries({
  INQUIRY_RATE_LIMIT_SALT: "listing-api, location-report: private salt for inquiry rate limiting",
  VAPID_PRIVATE_KEY: "listing-api: sends a phone alert as soon as a website lead is saved (same value as the repository secret); optional",
  VAPID_SUBJECT: "listing-api: contact address for the push services; optional",
  META_VERIFY_TOKEN: "fb-leads: Meta webhook verify token",
  META_PAGE_TOKEN: "fb-leads: Meta page access token (Graph API)",
  META_APP_SECRET: "fb-leads: Meta app secret (signature verification)",
  FB_LEADS_DEFAULT_BROKER_EMAIL: "fb-leads: default broker to auto-assign Facebook leads",
  RESEND_API_KEY: "notify-dispatch: Resend API key for email (only the \"email me this\" mode sends today)",
  MAIL_FROM: "notify-dispatch: from address on a domain verified in Resend (defaults to onboarding@resend.dev, which can only email the Resend account owner)",
  SEMAPHORE_API_KEY: "notify-dispatch: Semaphore API key for PH SMS",
  SEMAPHORE_SENDER: "notify-dispatch: Semaphore sender name (defaults ESRealty)",
  NOTIFY_DISPATCH_SECRET: "notify-dispatch: shared secret authorizing /notify-dispatch POSTs",
  AGENT_DISPATCH_SECRET: "agent-dispatch: shared secret the scheduler sends",
  SITE_URL: "seo: site URL the crawlable pages send visitors to (defaults to the Cloudflare site)",
}));

function extractEnvRefs(file) {
  const src = fs.readFileSync(file, "utf8");
  const seen = new Set();
  (src.match(/Deno\.env\.get\("([^"]+)"\)/g) || []).forEach(m => {
    const v = /"([^"]+)"/.exec(m)[1];
    seen.add(v);
  });
  return [...seen].filter(v => !AUTO_VARS.has(v) && KNOWN_VARS.has(v));
}

async function probe(base, p, fnName, optional) {
  const url = base + p.path;
  try {
    const res = await fetchT(url, {
      method: p.method,
      headers: { "Content-Type": "application/json" },
      body: p.body !== undefined ? JSON.stringify(p.body) : undefined,
    });
    let status = res.status;
    let extra = "";
    // 401 on a route we expect to be public usually means the function is
    // deployed with JWT verification ON (--verify-jwt) instead of --no-verify-jwt.
    if (p.expect === 200 && status === 401) {
      extra = "  [deployed but JWT-LOCKED — re-deploy with --no-verify-jwt]";
    }
    return { name: fnName, method: p.method, path: p.path, expect: p.expect, got: status, note: p.note || "", extra, ok: status === p.expect, optional: !!optional };
  } catch (e) {
    return { name: fnName, method: p.method, path: p.path, expect: p.expect, got: "ERR", note: p.note || "", extra: " [not reachable: " + (e && e.message || e) + "]", ok: false, optional: !!optional };
  }
}

(async () => {
  let ok = true;
  const out = [];
  const envReport = [];

  // 1) Probe all deployed functions
  for (const fn of FUNCTIONS) {
    let srcFile = path.join(fnDir, fn.name, "index.ts");
    if (!fs.existsSync(srcFile)) srcFile = path.join(fnDir, fn.name, "mod.ts");
    for (const p of fn.probes) {
      const r = await probe(BASE, p, fn.name, fn.skipBlocking);
      out.push(r);
      if (!r.ok) ok = false;
    }
    // env var report
    const refs = extractEnvRefs(srcFile);
    refs.forEach(v => {
      envReport.push({ var: v, desc: KNOWN_VARS.get(v) });
    });
  }

  // collect unique env vars
  const envMap = new Map();
  envReport.forEach(r => envMap.set(r.var, r));

  // 2) Print deployment table
  console.log("=== DEPLOYMENT CHECK (project ref: " + REF + ") ===\n");
  const byFn = {};
  out.forEach(r => (byFn[r.name] = byFn[r.name] || []).push(r));
  Object.keys(byFn).sort().forEach(name => {
    console.log("[" + name + "]");
    byFn[name].forEach(r => {
      const mark = r.ok ? "OK " : "FAIL";
      const color = r.ok ? "" : "  <-- EXPECTED " + r.expect + ", got " + r.got;
      console.log("  " + mark + "  " + r.method + " " + r.path + (r.note ? "  (" + r.note + ")" : "") + color + r.extra);
    });
    console.log("");
  });

  // 3) Print env var report
  console.log("=== ENV VARS REFERENCED BY FUNCTIONS ===\n");
  console.log("Auto-injected by Supabase (never set manually): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY\n");
  [...envMap.values()].forEach(r => {
    const kind = /api|secret|token|salt/i.test(r.var) ? "SECRET (set in Edge Functions -> Secrets)" : "OPTIONAL";
    console.log("  - " + r.var + "\n    " + r.desc + "\n    [" + kind + "]\n");
  });

  // 4) REST table presence check (publishable key — tells the app/client what the DB has)
  console.log("=== REST TABLE PRESENCE ===\n");
  const tableResults = [];
  for (const entry of REST_TABLES) {
    const r = await probeTable(entry);
    tableResults.push(r);
    const mark = r.ok ? "OK " : "FAIL";
    console.log("  " + mark + "  " + r.table + (r.note ? "  (" + r.note + ")" : "") + "  ->  got " + r.got + r.extra);
    if (!r.ok) ok = false;
  }
  for (const entry of REST_COLUMNS) {
    const r = await probeColumn(entry);
    tableResults.push(r);
    console.log("  " + (r.ok ? "OK " : "FAIL") + "  " + r.table + "  (" + r.note + ")  ->  got " + r.got + r.extra);
    if (!r.ok) ok = false;
  }
  for (const entry of REST_RPCS) {
    const r = await probeRpc(entry);
    tableResults.push(r);
    console.log("  " + (r.ok ? "OK " : "FAIL") + "  " + r.table + "  (" + r.note + ")  ->  got " + r.got + r.extra);
    if (!r.ok) ok = false;
  }
  console.log("");

  console.log("=== VERCEL (market-scan) ===\n");
  const vercelResults = [];
  for (const p of VERCEL_PROBES) {
    const r = await probeVercel(p);
    vercelResults.push(r);
    console.log("  " + (r.ok ? "OK " : r.reachable ? "FAIL" : "INFO") + "  GET " + p.path + "  (" + p.note + ")  ->  got " + r.got + (r.extra || (r.reachable && !r.ok ? "  <-- ANSWERS WITHOUT A SECRET OR SIGN-IN" : "")));
  }
  const vercelOpen = vercelResults.filter(r => r.reachable && !r.ok);
  if (vercelOpen.length) console.log("  FIX: set CRON_SECRET in Vercel (market-scan) and redeploy; make sure the latest market-scan code is deployed.");
  console.log("");

  // 4b) Deployed versus repository, and secret names (D5). Needs SUPABASE_ACCESS_TOKEN.
  console.log("=== DEPLOYED VERSUS REPOSITORY, SECRETS ===\n");
  let deployStale = false;
  try {
    const dep = await require("./check-deployed.js").report(REF, FUNCTIONS.map(f => f.name), [...envMap.keys()], process.env.SUPABASE_ACCESS_TOKEN || "");
    dep.lines.forEach(l => console.log(l));
    deployStale = dep.blocking;
  } catch (e) { console.log("  INFO  skipped (" + (e && e.message || e) + ")"); }
  console.log("");

  // 5) Status summary
  const total = out.length, passed = out.filter(r => r.ok).length;
  const failed = out.filter(r => !r.ok);
  const missingTables = tableResults.filter(r => !r.ok);
  console.log("=== SUMMARY ===\n");
  console.log("Probes: " + passed + "/" + total + "   Tables and columns present: " + (tableResults.length - missingTables.length) + "/" + tableResults.length);
  const notApplied = tableResults.filter(r => r.pendingMissing);
  if (notApplied.length) console.log("Waiting for a migration (not a failure): " + notApplied.map(r => r.table).join(", "));

  if (failed.length) {
    const blocking = failed.filter(r => !r.optional);
    const optional = failed.filter(r => r.optional);
    if (blocking.length) {
      console.log("\n=== MUST FIX (" + blocking.length + " probe" + (blocking.length === 1 ? "" : "s") + ") ===\n");
      const byFn = {};
      blocking.forEach(r => (byFn[r.name] = byFn[r.name] || []).push(r));
      Object.keys(byFn).sort().forEach(name => {
        const fn = FUNCTIONS.find(f => f.name === name);
        console.log("  " + name);
        byFn[name].forEach(r => {
          const ctx = r.got === 404 ? "NOT DEPLOYED" : r.got === 401 ? "DEPLOYED BUT JWT-LOCKED" : "unexpected " + r.got;
          console.log("    " + r.method + " " + r.path + "  ->  got " + r.got + " (" + ctx + r.extra + ")");
        });
        const recommend = (fn && fn.deployHint) || ("supabase functions deploy " + name + " --no-verify-jwt --project-ref " + REF);
        console.log("    FIX: " + recommend + "\n");
      });
    } else {
      console.log("\nNo blocking failures. Everything required is deployed and behaving correctly.");
    }
    if (optional.length) {
      console.log("\n=== INFORMATIONAL (non-blocking" + (optional.length === 1 ? ")" : "s)") + " ===\n");
      optional.forEach(r => console.log("  " + r.method + " " + r.path + "  ->  got " + r.got + r.extra + (r.note ? " [" + r.note + "]" : "")));
      console.log("");
    }
  } else {
    console.log("ALL GOOD — every function is deployed and behaving as expected.");
  }

  if (missingTables.length) {
    console.log("\n=== MISSING REST TABLES (" + missingTables.length + ") ===\n");
    missingTables.forEach(r => console.log("  " + r.table + "  ->  got " + r.got + r.extra + (r.note ? "  [" + r.note + "]" : "")));
    console.log("  FIX: run the matching supabase/*.sql in the SQL Editor (e.g. portfolio_a_investor.sql for the portfolio_* / construction_* tables, phase3_broken_features.sql for profiles.email), then all good.");
    console.log("");
  }

  console.log("\nHow to read the check:");
  console.log("  - A route returning its EXPECTED status proves the function is DEPLOYED.");
  console.log("  - Protected routes expecting 401/403 prove auth is ENFORCED (not just deployed).");
  console.log("  - '404' = function not deployed; '401' on a public route = deploy with --no-verify-jwt.");
  console.log("  - Tables answering 200 with no rows are fine: row security hides them from an anonymous check.");
  console.log("  - 'ERR' (no HTTP status) usually means the function is NOT deployed at BASE.");
  if (deployStale) console.log("\nA function in the repository has waited more than 3 days for its deployment: run Actions > Deploy edge functions.");
  if (process.env.GITHUB_ACTIONS) {
    // One annotation per reason, so the failure shows on the run's summary page without opening the log.
    const note = (msg) => console.log("::error title=Backend check::" + String(msg).replace(/\r?\n/g, " "));
    failed.filter(r => !r.optional).forEach(r => note(r.name + ": " + r.method + " " + r.path + " got " + r.got));
    missingTables.forEach(r => note("missing table " + r.table + " (" + (r.note || "") + ") got " + r.got));
    vercelOpen.forEach(p => note("market-scan " + p.path + " answers without a secret or sign-in"));
    if (deployStale) note("a function in the repository has waited more than 3 days for its deployment: run Actions > Deploy edge functions");
  }
  if (failed.some(r => !r.optional) || missingTables.length || vercelOpen.length || deployStale) { process.exit(1); }
})();