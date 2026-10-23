/* Agent websites, Phase 0: reply-time stamp and name lock (migration 0014), the settings
 * screen honouring the lock, and backend check failures shown as annotations.
 *
 *   node tests/agent_sites_phase0_node.js
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const c = (name, ok, detail) => {
  if (ok) { pass++; console.log("[PASS] " + name); }
  else { fail++; console.log("[FAIL] " + name + (detail ? " — " + detail : "")); }
};

const mig = read("supabase/migrations/0014_agent_sites_prep.sql");
c("0014 says to apply it after 0013", /AFTER 0013/.test(mig));
c("0014 adds the first-contact columns idempotently",
  /add column if not exists first_contacted_at timestamptz/.test(mig) && /add column if not exists first_contacted_by uuid/.test(mig));
c("0014 stamps first contact on insert and update",
  /create trigger crm_leads_first_contact\s+before insert or update on public\.crm_leads/.test(mig));
c("0014 drops its triggers before creating them (safe to run twice)",
  /drop trigger if exists crm_leads_first_contact/.test(mig) && /drop trigger if exists profiles_protect_name/.test(mig));
c("0014 locks the name of approved brokers and agents only",
  /old\.role in \('broker', 'agent'\)/.test(mig) && /old\.registration_status = 'approved'/.test(mig) && /not public\.is_super_admin\(\)/.test(mig));
c("migrations README lists 0014", /0014_agent_sites_prep\.sql/.test(read("supabase/migrations/README.md")));

const app = read("js/app.js");
c("settings: the name field is read-only when locked", /id="st-name"[^\n]*settingsNameLocked\(\) \? ' readonly/.test(app));
c("settings: a locked name is not sent on save", /if \(settingsNameLocked\(\)\) \{ delete payload\.full_name;/.test(app));
c("settings: only approved brokers and agents are locked",
  /function settingsNameLocked\(\) \{\s*return settingsLicenceLocked\(\) && \(userRole\(\) === "broker" \|\| userRole\(\) === "agent"\);/.test(app));

const check = read("supabase/check-backend.js");
c("backend check prints each failure as a GitHub annotation", /::error title=Backend check::/.test(check) && /process\.env\.GITHUB_ACTIONS/.test(check));

// The storefront router: /listing/<id> opens the same page as #/listing/<id>; a #/ route wins.
const sf = read("js/storefront.js");
const routeSrc = sf.slice(sf.indexOf("  function route() {"), sf.indexOf("  /* A new page starts at the top."));
const routeAt = (pathname, hash) => new Function("location", "URLSearchParams", routeSrc + "\nreturn route();")({ pathname, hash }, URLSearchParams).path;
c("router: /listing/<id> opens that listing", routeAt("/listing/abc-123", "") === "listing/abc-123", routeAt("/listing/abc-123", ""));
c("router: a trailing slash works too", routeAt("/listing/abc-123/", "") === "listing/abc-123");
c("router: a #/ route wins over the path", routeAt("/listing/abc-123", "#/search") === "search");
c("router: other paths still open the home page", routeAt("/", "") === "home" && routeAt("/listing/", "") === "home");

// The listing API: the Worker's read (?count=0) does not count a view; a visitor's read does.
const api = read("supabase/functions/listing-api/index.ts");
const { stripTs } = require("./ts_module");
const getSrc = stripTs(api.slice(api.indexOf("const getListing"), api.indexOf("// Trust details for a listing page")));
const limiterSrc = stripTs(api.slice(api.indexOf("const withinLimit"), api.indexOf("// Rental application details")));
const runGet = async (query) => {
  const rpcs = [];
  const admin = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "L1", agent_id: null }, error: null }) }) }) }),
    rpc: async (name) => { rpcs.push(name); return { data: true, error: null }; },
  };
  const sha256 = async () => "h";
  const { withinLimit } = new Function("sha256", "HttpError", limiterSrc + "\nreturn { withinLimit };")(sha256, Error);
  const deps = { json: (body) => body, publicDetails: async () => ({}), withinLimit, callerAddress: () => "1.2.3.4", HttpError: Error, PUBLIC_LISTING_COLUMNS: "*" };
  const getListing = new Function(...Object.keys(deps), getSrc + "\nreturn getListing;")(...Object.values(deps));
  const body = await getListing({ url: "https://x/functions/v1/listing-api/api/listings/L1" + query }, "L1", admin, "pepper");
  return { body, rpcs };
};

(async () => {
  try {
    const worker = await runGet("?count=0");
    c("listing API: the Worker's read (?count=0) counts no view", worker.rpcs.length === 0 && worker.body.data.id === "L1", JSON.stringify(worker.rpcs));
    const visitor = await runGet("");
    c("listing API: a visitor's read still counts a view", visitor.rpcs.includes("increment_public_listing_view"), JSON.stringify(visitor.rpcs));
  } catch (e) {
    c("listing API reader runs in Node", false, e && e.message);
  }
  console.log(fail ? fail + "/" + (pass + fail) + " FAILED" : "ALL GREEN (" + pass + " checks)");
  process.exit(fail ? 1 : 0);
})();
