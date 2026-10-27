/* Agent websites, finishing work: links that work before the Worker, the 404 page's way back in,
 * the vendored QR library, the pre-selling licence to sell rule, sign-up licence details, Filipino
 * labels for My website, and migration 0017's wiring.
 *
 *   node tests/agent_sites_finish_node.js
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

// 404 page: agent and listing addresses open their page through the #/ route, never a loop.
const page404 = read("404.html");
const script = (page404.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || "";
const go404 = (hostname, pathname) => {
  let target = null;
  new Function("location", script)({ hostname, pathname, replace: (u) => { target = u; } });
  return target;
};
c("404: an agent address on the site's own domain opens the agent's page", go404("esrealty.extraricestore.workers.dev", "/agents/maria-santos") === "/#/agents/maria-santos");
c("404: a listing address opens the listing", go404("esrealty.extraricestore.workers.dev", "/listing/lst-77/") === "/#/listing/lst-77");
c("404: on GitHub Pages the project folder is kept", go404("tradersgag6.github.io", "/esrealty/agents/maria-santos") === "/esrealty/#/agents/maria-santos");
c("404: anything else goes to the home page", go404("esrealty.extraricestore.workers.dev", "/agents/") === "/" && go404("tradersgag6.github.io", "/esrealty/nope/deep") === "/esrealty/");
c("404: the old relative refresh that looped is gone", !/content="0;url=\.\/"/.test(page404));

// Links before the Worker: one switch, off until pull request #32 turns it on.
const ap = read("js/agent_page.js");
c("with the Worker, agent page links use the /agents/<slug> form", /var PATH_LINKS = true;/.test(ap) && /\(PATH_LINKS \? "agents\/" : "#\/agents\/"\)/.test(ap));
const app = read("js/app.js");
c("My website's address and the saved contact use that one function", /P\.pageUrl\(siteData\.slug\)/.test(app) && /"URL:" \+ pageUrl\(p\.slug\)/.test(ap) && !/"agents\/" \+ siteData\.slug/.test(app));

// QR code for print, from a vendored library (no network at run time).
const qr = read("vendor/qrcode/qrcode.min.js");
c("the QR library is vendored with its licence", /Kazuhiko Arase, MIT/.test(qr) && /MIT License/.test(read("vendor/qrcode/LICENSE")));
const qrcode = require(path.join(ROOT, "vendor/qrcode/qrcode.min.js"));
const code = qrcode(0, "M"); code.addData("https://esrealty.extraricestore.workers.dev/#/agents/maria-santos-dela-cruz"); code.make();
c("it encodes an agent page address", code.getModuleCount() >= 25 && code.isDark(0, 0) === true);
const share = read("js/agent_share.js");
c("My website loads it only when Download QR is pressed", /loadScriptOnce\("vendor\/qrcode\/qrcode\.min\.js\?v=1", "qrcode"\)/.test(share) && !/vendor\/qrcode/.test(read("index.html")) && /data-site-qr/.test(app));

// Preview image at publish.
c("publishing makes the 1200 x 630 preview image and keeps it in the page data",
  /canvas\.width = 1200; canvas\.height = 630;/.test(share) && /SEA_AGENT_SHARE\.cardPng\(pv\)/.test(app) && /og_image: await siteCardUpload\(sitePreviewData\(\)\)/.test(app)
  && /og_image: \/\^https:\\\/\\\/\/\.test\(j\.og_image \|\| ""\) \? j\.og_image : ""/.test(app));

// Pre-selling: licence to sell number and date before publishing.
const api = read("supabase/functions/listing-api/index.ts");
c("the listing function asks a published pre-selling listing for its licence to sell and its date",
  /if \(status === "pre-selling" && isPublished\) \{/.test(api) && /needs its DHSUD licence to sell number/.test(api) && /licenseToSellUntil < today/.test(api));
c("the listing page shows the valid-until date", /out\.license_to_sell_until = p\.licenseToSellUntil/.test(api) && /license_to_sell_until/.test(read("js/storefront.js")));
c("the listing form asks for the date too", /id="ls-lts-until" type="date"/.test(app) && /license_to_sell_until: rec\.licenseToSellUntil/.test(app));

// Sign-up: licence number and supervising broker for brokers and agents.
const html = read("index.html");
c("sign-up has the licence and broker fields", /id="auth-prc"/.test(html) && /id="auth-broker"/.test(html));
c("they are sent with the sign-up and shown in Users & Access", /requested_prc: \$\("#auth-prc"\)/.test(app) && /data-signup-prc/.test(app) && /u\.requested_prc/.test(app));
c("Join as an agent opens sign-up with the agent role chosen", /data-sf-auth="signup-agent"/.test(read("js/agent_directory.js")) && /mode === "signup-agent"/.test(app));

// Filipino.
c("My website has Filipino labels and a Filipino menu name", /website: \["My website", "Aking website"\]/.test(app) && /title: \["My website", "Aking website"\]/.test(app) && /const WEBSITE_TEXT = \{/.test(app));

// Migration 0017.
const m17 = read("supabase/migrations/0017_agent_sites_finish.sql");
c("0017 says to apply it after 0016", /AFTER 0016/.test(m17));
c("0017 keeps the directory for the server only", /revoke all on function public\.public_agents\(text, text, text\) from public, anon, authenticated;/.test(m17)
  && /grant execute on function public\.public_agents\(text, text, text\) to service_role;/.test(m17));
c("agents get their credited deals from a function, not a row rule, and the team check stays closed",
  /create or replace function public\.agent_credited_deals\(\)/.test(m17) && /t\.payload - 'documents'/.test(m17) && !/create policy "broker_transactions select credited agent"/.test(m17)
  && /revoke all on function public\.deal_credit_ok\(uuid, uuid\) from public, anon, authenticated;/.test(m17) && !/grant execute on function public\.deal_credit_ok/.test(m17));
c("the catalog compares the licence date as text, so a bad date cannot break it", /\(listing\.payload ->> 'licenseToSellUntil'\) < to_char\(/.test(m17) && !/licenseToSellUntil'\)::date/.test(m17));
c("the listing function refuses dates that do not exist", /toISOString\(\)\.slice\(0, 10\) !== licenseToSellUntil/.test(api));
c("agents never try to save deals they cannot change", /!txCanManage\(\)\) return 0;/.test(app) && /SB\.rpc\("agent_credited_deals"\)/.test(app));
c("migrations README lists 0017", /0017_agent_sites_finish\.sql/.test(read("supabase/migrations/README.md")));

console.log(fail ? fail + "/" + (pass + fail) + " FAILED" : "ALL GREEN (" + pass + " checks)");
process.exit(fail ? 1 : 0);
