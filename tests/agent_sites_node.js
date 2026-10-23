/* Agent websites, Phase 1: the listing function's agent endpoints (run in Node against a fake
 * database), the fixed town list kept equal to the Value Guide's, and the wiring around them.
 *
 *   node tests/agent_sites_node.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const c = (name, ok, detail) => {
  if (ok) { pass++; console.log("[PASS] " + name); }
  else { fail++; console.log("[FAIL] " + name + (detail ? " — " + detail : "")); }
};

// Towns: the database list is the Value Guide's list.
const mig = read("supabase/migrations/0015_agent_sites.sql");
const sqlTowns = ((mig.match(/agent_site_towns\(\) returns text\[\][\s\S]*?array\[([\s\S]*?)\]/) || [])[1] || "").match(/'([a-z-]+)'/g).map((t) => t.slice(1, -1));
const vgTowns = JSON.parse(read("data/batangas-zonal.json")).municipalities.map((m) => m.slug);
c("agent page towns are exactly the Value Guide's towns", JSON.stringify(sqlTowns) === JSON.stringify(vgTowns), sqlTowns.length + " vs " + vgTowns.length);
c("0015 says to apply it after 0014", /AFTER 0014/.test(mig));
const pageTowns = [...read("js/agent_page.js").matchAll(/\["([a-z-]+)", "[^"]+"\]/g)].map((m) => m[1]).filter((t) => vgTowns.includes(t) || /city|-/.test(t));
c("the agent page's town names cover exactly the Value Guide's towns", JSON.stringify(pageTowns.filter((t) => vgTowns.includes(t))) === JSON.stringify(vgTowns));
const app = read("js/app.js");
c("brokers and agents (not buyers) can open My website", /"website\.manage", "settings\.view"\],\n\s*agent: \[[^\]]*"website\.manage"/.test(app) && !/buyer: \[[^\]]*website\.manage/.test(app) && /website: "website\.manage"/.test(app));
c("signed-in people opening an agent or listing link see the public page", /function publicLinkOpen\(\)/.test(app) && /if \(!currentUser \|\| showPublicLink\(\)\) \{/.test(app));
c("index.html loads the agent page drawing before the storefront", read("index.html").indexOf("js/agent_page.js") > 0 && read("index.html").indexOf("js/agent_page.js") < read("index.html").indexOf("js/storefront.js"));
c("the service worker keeps the agent page drawing for offline use", /"\.\/js\/agent_page\.js"/.test(read("sw.js")));
c("public_agent and the counter are for the server only",
  /grant execute on function public\.public_agent\(text\) to service_role;/.test(mig)
  && /revoke all on function public\.public_agent\(text\) from public, anon, authenticated;/.test(mig)
  && !/grant execute on function public\.public_agent\(text\) to (anon|authenticated)/.test(mig));
c("migrations README lists 0015", /0015_agent_sites\.sql/.test(read("supabase/migrations/README.md")));

// The endpoints, run in Node.
const api = read("supabase/functions/listing-api/index.ts");
c("the agent routes are wired", /parts\[0\] === "agents" && req\.method === "GET"/.test(api)
  && /parts\[0\] === "agents" && parts\[2\] === "inquiries" && req\.method === "POST"/.test(api)
  && /parts\[0\] === "agents" && parts\[2\] === "taps" && req\.method === "POST"/.test(api));
c("instant phone alerts load web-push only when needed, so a failure cannot stop the function",
  /const loadWebPush = async \(\) => \(await import\("npm:web-push@3\.6\.7"\)\)\.default;/.test(api) && !/^import .*web-push/m.test(api)
  && /await pushNow\(admin, agentId\);/.test(api) && /await pushNow\(admin, listing\.agent_id as string \| null\);/.test(api));
c("browsers may send an Idempotency-Key", /"Access-Control-Allow-Headers": "[^"]*idempotency-key"/.test(api));
const block = api.slice(api.indexOf("// Agent pages (agent websites plan, Phase 1)"), api.indexOf("Deno.serve(async (req) => {"))
  .replace(/: Record<string, string>/g, "").replace(/: SupabaseClient/g, "").replace(/: Request/g, "").replace(/: string/g, "")
  .replace(/ as JsonRecord\[\]/g, "").replace(/ as JsonRecord/g, "").replace(/\(l\)/g, "(l)");

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const PAGE = { agent_id: "agent-1", slug: "maria-santos", name: "Maria Santos", listings: [{ id: "L1", title: "Corner lot" }] };
function harness() {
  const calls = [], leads = [], pushed = [];
  let firstToday = true;
  const admin = {
    rpc: async (name, args) => {
      calls.push(name + ":" + JSON.stringify(args));
      if (name === "public_agent") return { data: args.p_slug === "maria-santos" ? PAGE : null, error: null };
      if (name === "consume_listing_inquiry_rate_limit") return { data: firstToday, error: null };
      return { data: null, error: null };
    },
    from: (table) => {
      const filters = [];
      const q = {
        select: () => q, order: () => q, limit: () => q,
        eq: (col, val) => { const m = col.match(/^payload->>(.+)$/); filters.push((r) => (m ? r.payload[m[1]] : r[col]) === val); return q; },
        maybeSingle: async () => ({ data: table === "profiles" ? { id: "admin-1" } : leads.find((r) => filters.every((f) => f(r))) || null, error: null }),
        insert: async (row) => { leads.push(row); return { error: null }; },
      };
      return q;
    },
  };
  const json = (body, status = 200) => ({ status, body });
  const stringValue = (value, max, field, required = false) => {
    const r = String(value ?? "").trim();
    if (required && !r) throw new HttpError(400, field + " is required");
    if (r.length > max) throw new HttpError(400, field + " is too long");
    return r;
  };
  const phoneValue = (v, required) => { const t = stringValue(v, 50, "phone", required); if (t && t.replace(/\D/g, "").length < 7) throw new HttpError(400, "phone is invalid"); return t; };
  const enumValue = (value, allowed, fallback, field) => { const r = String(value ?? fallback).trim().toLowerCase(); if (!allowed.has(r)) throw new HttpError(400, field + " is invalid"); return r; };
  const deps = {
    HttpError, json, stringValue, phoneValue, enumValue, MAX_FORM_BODY: 32000, PRIVACY_NOTICE_VERSION: "2026-10-01",
    parseBody: async (req) => JSON.parse(req.body || "{}"),
    sha256: async (v) => crypto.createHash("sha256").update(v).digest("hex"),
    callerAddress: () => "1.2.3.4",
    crypto: { randomUUID: () => crypto.randomUUID() },
    pushNow: async (admin, userId) => { pushed.push(userId); return 1; },
  };
  const fns = new Function(...Object.keys(deps), block + "\nreturn { getAgent, recordAgentTap, submitAgentInquiry };")(...Object.values(deps));
  const req = (url, body, headers) => ({ url: "https://x/api" + url, body: body && JSON.stringify(body), headers: { get: (k) => (headers || {})[k.toLowerCase()] || null } });
  const run = async (fn, ...args) => { try { return await fn(...args); } catch (e) { return { status: e.status || 500, body: { error: e.message } }; } };
  return { fns, req, run, calls, leads, pushed, admin, setFirst: (v) => { firstToday = v; } };
}

(async () => {
  try {
    let h = harness();
    let r = await h.run(h.fns.getAgent, h.req("/agents/maria-santos"), "maria-santos", h.admin, "pepper");
    c("a published agent's page is returned without their account id", r.status === 200 && r.body.data.name === "Maria Santos" && !("agent_id" in r.body.data), JSON.stringify(r));
    c("a visit is counted once a day", h.calls.some((x) => x.startsWith("agent_page_count") && x.includes('"view"')));
    h.calls.length = 0;
    r = await h.run(h.fns.getAgent, h.req("/agents/maria-santos?count=0"), "maria-santos", h.admin, "pepper");
    c("the Worker's read (?count=0) is not a visit", r.status === 200 && !h.calls.some((x) => x.startsWith("agent_page_count")));
    r = await h.run(h.fns.getAgent, h.req("/agents/nobody"), "nobody", h.admin, "pepper");
    c("an unknown or unpublished agent answers 404", r.status === 404);
    h.calls.length = 0;
    r = await h.run(h.fns.getAgent, h.req("/agents/x"), "Bad Slug!", h.admin, "pepper");
    c("a malformed address answers 404 without asking the database", r.status === 404 && h.calls.length === 0);

    r = await h.run(h.fns.recordAgentTap, h.req("/agents/maria-santos/taps", { kind: "whatsapp" }), "maria-santos", h.admin, "pepper");
    c("a WhatsApp tap is counted", r.status === 202 && h.calls.some((x) => x.startsWith("agent_page_count") && x.includes('"whatsapp"')));
    r = await h.run(h.fns.recordAgentTap, h.req("/agents/maria-santos/taps", { kind: "sms" }), "maria-santos", h.admin, "pepper");
    c("unknown buttons are refused", r.status === 400);

    const msg = { full_name: "Ana Cruz", phone: "0917 222 3333", message: "Still available?", want: "viewing", listing_id: "L1", consent: true, section: "listing" };
    r = await h.run(h.fns.submitAgentInquiry, h.req("/agents/maria-santos/inquiries", { ...msg, consent: false }), "maria-santos", h.admin, "pepper");
    c("no consent, no message", r.status === 400);
    r = await h.run(h.fns.submitAgentInquiry, h.req("/agents/maria-santos/inquiries", { ...msg, website: "spam.example" }), "maria-santos", h.admin, "pepper");
    c("the hidden field catches bots without saving anything", r.status === 201 && h.leads.length === 0);
    r = await h.run(h.fns.submitAgentInquiry, h.req("/agents/maria-santos/inquiries", msg, { "idempotency-key": "k1" }), "maria-santos", h.admin, "pepper");
    const lead = h.leads[0] || {};
    c("a message becomes a lead assigned to that agent", r.status === 201 && lead.assigned_to_id === "agent-1" && lead.created_by === "admin-1", JSON.stringify(lead));
    c("the lead records the page, the listing and the consent",
      lead.payload && lead.payload.channel === "agent-page" && lead.payload.listingId === "L1" && lead.payload.propertyInterest === "Wants a viewing: Corner lot" && lead.payload.consentRecord.notice === "2026-10-01");
    c("the agent's phone is alerted right away", h.pushed.length === 1 && h.pushed[0] === "agent-1");
    r = await h.run(h.fns.submitAgentInquiry, h.req("/agents/maria-santos/inquiries", msg, { "idempotency-key": "k1" }), "maria-santos", h.admin, "pepper");
    c("a resend with the same key makes no second lead", r.status === 201 && h.leads.length === 1);
    h.setFirst(false);
    r = await h.run(h.fns.submitAgentInquiry, h.req("/agents/maria-santos/inquiries", msg, { "idempotency-key": "k2" }), "maria-santos", h.admin, "pepper");
    c("too many messages from one visitor answers 429", r.status === 429);
  } catch (e) {
    c("the agent endpoints run in Node", false, e && e.stack);
  }
  console.log(fail ? fail + "/" + (pass + fail) + " FAILED" : "ALL GREEN (" + pass + " checks)");
  process.exit(fail ? 1 : 0);
})();
