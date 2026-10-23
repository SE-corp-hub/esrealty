/* Phase 15: trust details on a public listing (H9): exclusive authority, documents seen, agent PRC. */
const fs = require("fs");
const path = require("path");
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });
const api = read("supabase/functions/listing-api/index.ts");
const sf = read("js/storefront.js");
const app = read("js/app.js");
// The function's reader, run in Node against a fake database.
const src = api.slice(api.indexOf("const publicDetails"), api.indexOf("// Change log for edits"));
const js = require("./ts_module").stripTs(src);
const fake = (payload, prc, fail) => ({
  from: table => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
    if (fail) throw new Error("down");
    return table === "shared_listings" ? { data: { payload } } : { data: { prc } };
  } }) }) })
});
const publicDetails = new Function(js + "\nreturn publicDetails;")();
(async () => {
  const all = await publicDetails(fake({ licenseToSell: " LTS-1234 ", exclusive: true, docsChecked: true, ownerPhone: "0917" }, "0012345"), "x", "agent-1");
  c("ticked details and the agent's PRC number are given to the page", JSON.stringify(all) === JSON.stringify({ license_to_sell: "LTS-1234", exclusive: true, docs_checked: true, agent_prc: "0012345" }), JSON.stringify(all));
  const none = await publicDetails(fake({ exclusive: "yes", docsChecked: 1 }, ""), "x", "agent-1");
  c("only a real true counts; an empty PRC is left out", JSON.stringify(none) === "{}", JSON.stringify(none));
  const noAgent = await publicDetails(fake({ exclusive: true }, "999"), "x", null);
  c("no agent, no PRC line", JSON.stringify(noAgent) === JSON.stringify({ exclusive: true }), JSON.stringify(noAgent));
  const down = await publicDetails(fake({}, "", true), "x", "a");
  c("a database error leaves the details out instead of failing the page", JSON.stringify(down) === "{}");
  c("nothing else from the saved record reaches the public page", !/ownerPhone|owner_phone|p\.notes|p\.seller/.test(src));
  c("the listing page returns the details", /return json\(\{ data: \{ \.\.\.\(data as JsonRecord\), details \} \}\);/.test(api));
  c("saving keeps exclusive and documents-checked, and an edit without them keeps the old answer",
    /exclusive: details\.exclusive === undefined \? oldPayload\.exclusive === true : details\.exclusive === true/.test(api) &&
    /docsChecked: details\.docs_checked === undefined \? oldPayload\.docsChecked === true : details\.docs_checked === true/.test(api));
  c("the editor has both boxes and sends them", /id="ls-exclusive"/.test(app) && /id="ls-docs-checked"/.test(app) && /exclusive: rec\.exclusive === true,/.test(app) && /docs_checked: rec\.docsChecked === true,/.test(app));
  c("the storefront shows the badges above the DHSUD line", sf.indexOf("trustBadges(listing) +") > 0 && sf.indexOf("trustBadges(listing) +") < sf.indexOf("DHSUD License to Sell number for this property"));
  c("phase 15 browser test is in CI", /-Test phase15_app_e2e/.test(read(".github/workflows/tests.yml")));
  const failed = checks.filter(x => !x.ok);
  checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : " :: " + x.detail)));
  console.log(failed.length ? failed.length + " FAILED" : "ALL PASS");
  process.exit(failed.length ? 1 : 0);
})();
