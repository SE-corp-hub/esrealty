/* Agent websites, Phases 1 to 3: the listing function's agent endpoints (run in Node against a fake
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
const html = read("index.html");
c("index.html loads the directory module after the agent page and before the storefront",
  html.indexOf("js/agent_page.js") < html.indexOf("js/agent_directory.js") && html.indexOf("js/agent_directory.js") < html.indexOf("js/storefront.js"));
c("the service worker keeps the directory module for offline use", /"\.\/js\/agent_directory\.js"/.test(read("sw.js")));
c("public_agent and the counter are for the server only",
  /grant execute on function public\.public_agent\(text\) to service_role;/.test(mig)
  && /revoke all on function public\.public_agent\(text\) from public, anon, authenticated;/.test(mig)
  && !/grant execute on function public\.public_agent\(text\) to (anon|authenticated)/.test(mig));
c("migrations README lists 0015", /0015_agent_sites\.sql/.test(read("supabase/migrations/README.md")));
c("migrations README lists 0016", /0016_agent_sites_proof\.sql/.test(read("supabase/migrations/README.md")));
const mig16 = read("supabase/migrations/0016_agent_sites_proof.sql");
// The listing function: its router (index.ts) and the agent routes (agents.ts).
const api = read("supabase/functions/listing-api/index.ts") + "\n" + read("supabase/functions/listing-api/agents.ts");
c("0016 says to apply it after 0015", /AFTER 0015/.test(mig16));
c("the directory, lookup and review functions are for the server only",
  ["public_agents(text, text, text)", "agent_check(text)", "review_lookup(text)", "review_submit(text, text, text, text)", "agent_public_slug(uuid)", "agent_page_lookup(text)"].every((f) =>
    new RegExp("revoke all on function public\\." + f.replace(/[()]/g, "\\$&") + " from public, anon, authenticated;").test(mig16)
    && new RegExp("grant execute on function public\\." + f.replace(/[()]/g, "\\$&") + " to service_role;").test(mig16)));
c("the directory, check and review routes are wired", /parts\[0\] === "agents" && req\.method === "GET"\) \{\n\s*return await listAgents/.test(api)
  && /parts\[0\] === "agent-check" && req\.method === "GET"/.test(api) && /parts\.length === 1 && parts\[0\] === "reviews" && req\.method === "POST"/.test(api));
c("the Value Guide names the agent only when the server says it went to them", /var agentName = res && res\.agent \? String\(res\.agent\) : "";/.test(read("js/estimator.js")) && /\.\.\.\(agentId \? \{ agent: agentName \} : \{\}\)/.test(read("supabase/functions/location-report/index.ts")));
c("a listing's details carry its agent's page address", /admin\.rpc\("agent_public_slug", \{ p_agent: agentId \}\)/.test(api) && /out\.agent_slug = slug/.test(api));
const sf = read("js/storefront.js");
c("Listed by links to the agent's page", /'<a href="#\/agents\/' \+ esc\(d\.agent_slug\) \+ '">'/.test(sf));
c("Find an agent joins the menu from the first published agent", /var AGENT_NAV_MIN = 1;/.test(sf) && /if \(publishedAgents < AGENT_NAV_MIN\) return NAV;/.test(sf));
const lr = read("supabase/functions/location-report/index.ts");
c("a Value Guide request from an agent's page goes to that agent, found by the server", /admin\.rpc\("agent_page_lookup", \{ p_slug: agentSlug \}\)/.test(lr) && /assigned_to_id: agentId,/.test(lr));
c("the Value Guide sends the agent's page address", /agent_slug: vgAgent\(\)\.slug,/.test(read("js/estimator.js")));

// The endpoints, run in Node.
c("the agent routes are wired", /parts\[0\] === "agents" && req\.method === "GET"/.test(api)
  && /parts\[0\] === "agents" && parts\[2\] === "inquiries" && req\.method === "POST"/.test(api)
  && /parts\[0\] === "agents" && parts\[2\] === "taps" && req\.method === "POST"/.test(api));
c("instant phone alerts load web-push only when needed, so a failure cannot stop the function",
  /const loadWebPush = async \(\) => \(await import\("npm:web-push@3\.6\.7"\)\)\.default;/.test(api) && !/^import .*web-push/m.test(api)
  && /await pushNow\(admin, agentId\);/.test(api) && /await pushNow\(admin, listing\.agent_id as string \| null\);/.test(api));
c("browsers may send an Idempotency-Key", /"Access-Control-Allow-Headers": "[^"]*idempotency-key"/.test(api));
// The real modules, with their types removed by Node itself.
const { stripTypeScriptTypes } = require("node:module");
const loadTs = (p) => import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(read(p))).toString("base64"));

const OPEN_TOKEN = "a".repeat(64);
const OPEN_HASH = crypto.createHash("sha256").update(OPEN_TOKEN).digest("hex");
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const PAGE = { agent_id: "agent-1", slug: "maria-santos", name: "Maria Santos", listings: [{ id: "L1", title: "Corner lot" }] };
let agentRoutes, makeLimits; // loaded below
function harness() {
  const calls = [], leads = [], pushed = [];
  let firstToday = true, submitted = false;
  const admin = {
    rpc: async (name, args) => {
      calls.push(name + ":" + JSON.stringify(args));
      if (name === "public_agent") return { data: args.p_slug === "maria-santos" ? PAGE : null, error: null };
      if (name === "consume_listing_inquiry_rate_limit") return { data: firstToday, error: null };
      if (name === "public_agent_count") return { data: 9, error: null };
      if (name === "public_agents") return { data: { total: 2, agents: [{ slug: "maria-santos" }, { slug: "beatriz-lim" }] }, error: null };
      if (name === "agent_check") return { data: args.p_q === "0012345" ? [{ slug: "maria-santos" }, { slug: "x" }, { slug: "y" }, { slug: "z" }] : [], error: null };
      if (name === "review_lookup") return { data: args.p_hash === OPEN_HASH ? { agent: "Maria Santos", open: true, status: "open" } : null, error: null };
      if (name === "review_submit") return { data: args.p_hash === OPEN_HASH && !submitted ? (submitted = true) : false, error: null };
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
  const json = (body, status = 200, headers) => ({ status, body, headers });
  const stringValue = (value, max, field, required = false) => {
    const r = String(value ?? "").trim();
    if (required && !r) throw new HttpError(400, field + " is required");
    if (r.length > max) throw new HttpError(400, field + " is too long");
    return r;
  };
  const phoneValue = (v, required) => { const t = stringValue(v, 50, "phone", required); if (t && t.replace(/\D/g, "").length < 7) throw new HttpError(400, "phone is invalid"); return t; };
  const enumValue = (value, allowed, fallback, field) => { const r = String(value ?? fallback).trim().toLowerCase(); if (!allowed.has(r)) throw new HttpError(400, field + " is invalid"); return r; };
  const deps = {
    HttpError, json, stringValue, phoneValue, enumValue, MAX_FORM_BODY: 32000, PRIVACY_NOTICE_VERSION: "2026-10-01", PUBLIC_CACHE: { "Cache-Control": "public, max-age=60" },
    parseBody: async (req) => JSON.parse(req.body || "{}"),
    sha256: async (v) => crypto.createHash("sha256").update(v).digest("hex"),
    callerAddress: () => "1.2.3.4",
    pushNow: async (admin, userId) => { pushed.push(userId); return 1; },
  };
  const fns = agentRoutes({ ...deps, ...makeLimits(deps.sha256, HttpError) });
  const req = (url, body, headers) => ({ url: "https://x/api" + url, body: body && JSON.stringify(body), headers: { get: (k) => (headers || {})[k.toLowerCase()] || null } });
  const run = async (fn, ...args) => { try { return await fn(...args); } catch (e) { return { status: e.status || 500, body: { error: e.message } }; } };
  return { fns, req, run, calls, leads, pushed, admin, setFirst: (v) => { firstToday = v; } };
}

(async () => {
  try {
    ({ agentRoutes } = await loadTs("supabase/functions/listing-api/agents.ts"));
    ({ makeLimits } = await loadTs("supabase/functions/listing-api/limits.ts"));
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

    // Phase 2: the directory.
    h = harness();
    r = await h.run(h.fns.listAgents, new URL("https://x/api/agents?town=lipa-city&need=sell"), h.admin);
    c("the directory lists published agents, cached for a minute", r.status === 200 && r.body.total === 2 && r.body.data.length === 2 && r.headers["Cache-Control"] === "public, max-age=60", JSON.stringify(r));
    c("its filters go to the database as given", h.calls.some((x) => x === 'public_agents:{"p_town":"lipa-city","p_need":"sell","p_language":null}'), h.calls.join(" | "));
    h.calls.length = 0;
    r = await h.run(h.fns.listAgents, new URL("https://x/api/agents?count=1"), h.admin);
    c("the menu's count asks only for the number", r.status === 200 && r.body.total === 9 && !("data" in r.body) && h.calls.length === 1 && h.calls[0].startsWith("public_agent_count"));
    h.calls.length = 0;
    r = await h.run(h.fns.listAgents, new URL("https://x/api/agents?town=Lipa%20City';--"), h.admin);
    c("a filter outside the fixed lists' shape is refused without asking the database", r.status === 400 && h.calls.length === 0);

    // Phase 3: check an agent.
    r = await h.run(h.fns.checkAgent, h.req("/agent-check?q=0012345"), new URL("https://x/api/agent-check?q=0012345"), h.admin, "pepper");
    c("check-an-agent answers at most three matches", r.status === 200 && r.body.data.length === 3, JSON.stringify(r));
    r = await h.run(h.fns.checkAgent, h.req("/agent-check?q=0999"), new URL("https://x/api/agent-check?q=0999"), h.admin, "pepper");
    c("a miss is an empty answer, never a list of people", r.status === 200 && r.body.data.length === 0);
    r = await h.run(h.fns.checkAgent, h.req("/agent-check"), new URL("https://x/api/agent-check"), h.admin, "pepper");
    c("an empty check is refused", r.status === 400);
    h.setFirst(false);
    r = await h.run(h.fns.checkAgent, h.req("/agent-check?q=0012345"), new URL("https://x/api/agent-check?q=0012345"), h.admin, "pepper");
    c("too many checks from one visitor answers 429", r.status === 429);
    h.setFirst(true);

    // Phase 3: reviews. The link's secret is never sent to the database, only its hash.
    h.calls.length = 0;
    r = await h.run(h.fns.getReview, h.req("/reviews/lookup", { token: OPEN_TOKEN }), h.admin);
    c("an open review link shows whose review it is", r.status === 200 && r.body.data.agent === "Maria Santos" && r.body.data.open === true);
    c("the database sees the link's hash, not the link", h.calls.every((x) => x.indexOf(OPEN_TOKEN) < 0) && h.calls.some((x) => x.indexOf(OPEN_HASH) >= 0));
    r = await h.run(h.fns.getReview, h.req("/reviews/lookup", { token: "not-a-token" }), h.admin);
    c("a malformed link answers 404", r.status === 404);
    r = await h.run(h.fns.getReview, h.req("/reviews/lookup", { token: "b".repeat(64) }), h.admin);
    c("an unknown link answers 404", r.status === 404);
    c("the link travels in the request body, never in the address", /parts\[0\] === "reviews" && parts\[1\] === "lookup" && req\.method === "POST"/.test(api) && !/parts\[0\] === "reviews" && req\.method === "GET"/.test(api));
    const words = { token: OPEN_TOKEN, first_name: "Rhea", last_name: "Dizon", review: "Maria did the viewing on video and sent the title first.", consent: true };
    r = await h.run(h.fns.submitReview, h.req("/reviews", { ...words, consent: false }), h.admin, "pepper");
    c("no agreement, no review", r.status === 400);
    r = await h.run(h.fns.submitReview, h.req("/reviews", words), h.admin, "pepper");
    c("a review is sent once", r.status === 201);
    c("the review goes to the database with first name and last name for the initial", h.calls.some((x) => x.startsWith("review_submit") && x.includes('"p_first":"Rhea"') && x.includes('"p_initial":"Dizon"')));
    r = await h.run(h.fns.submitReview, h.req("/reviews", words), h.admin, "pepper");
    c("the same link cannot send a second review", r.status === 410);
  } catch (e) {
    c("the agent endpoints run in Node", false, e && e.stack);
  }
  console.log(fail ? fail + "/" + (pass + fail) + " FAILED" : "ALL GREEN (" + pass + " checks)");
  process.exit(fail ? 1 : 0);
})();
