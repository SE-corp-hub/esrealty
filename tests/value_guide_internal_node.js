"use strict";
/* Static + behavioural guards for the internal Value Guide.
 *
 * Run: node tests/value_guide_internal_node.js
 *
 * These exist because the risky parts of this feature are not the layout, they
 * are the boundaries: which roles can open it, whether it writes anything,
 * whether it persists a draft, and whether it agrees with the public
 * estimator. Each of those has been a real defect in this codebase.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const L = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const APP = L("js/app.js");
const EST = L("js/estimator.js");
const HTML = L("index.html");
const PDF = L("js/value_guide_pdf.js");
const CSS = L("css/styles.css");
const DOCS = L("docs/batangas-value-guide-sources.md");
const MANIFEST = JSON.parse(L("data/data-manifest.json"));
const BIRMANIFEST = JSON.parse(L("data/bir-batangas/manifest.json"));

let checked = 0, failures = 0;
function ok(cond, label, detail) {
  checked++;
  if (cond) { console.log("  [PASS] " + label + (detail ? "  " + detail : "")); return; }
  failures++;
  console.log("  [FAIL] " + label + (detail ? "  " + detail : ""));
}
function section(name) { console.log("\n== " + name + " =="); }

/* ---------- navigation + access ---------- */
section("navigation and access");
/* The item carries a nested icon span between the attribute and the label. */
ok(/data-view="value-guide"[\s\S]{0,120}?Value Guide</.test(HTML), "Analysis dropdown has a Value Guide item");
ok(/nav-dropdown-menu[^>]*data-dropdown-menu="analysis"/.test(HTML) &&
   HTML.indexOf('data-view="value-guide"') > HTML.indexOf('data-dropdown-menu="analysis"'),
  "Value Guide sits inside the Analysis dropdown");
ok(/"value-guide"\s*:\s*"appraisal\.view"/.test(APP),
  "value-guide reuses the appraisal.view capability");
/* The view key is quoted in the source, so the pattern must allow for that. */
ok(/["']value-guide["']\s*:\s*renderValueGuide/.test(APP), "render map routes value-guide");
ok(/"value-guide"\s*:\s*"Value Guide"/.test(APP), "title map has Value Guide");
ok(/state\.view === "value-guide"\) bindValueGuide\(\)/.test(APP), "bindPerView binds the view");

/* The capability must not be quietly widened. super-admin has "*", broker has
 * appraisal.view; agent/buyer/seller/owner/tenant must NOT gain it. */
const roles = /ROLE_CAPABILITIES = \{([\s\S]*?)\n  \};/m.exec(APP);
ok(!!roles, "ROLE_CAPABILITIES parsed");
if (roles) {
  const body = roles[1];
  const capOf = name => {
    const m = new RegExp(name + ":\\s*\\[([^\\]]*)\\]").exec(body);
    return m ? m[1] : "";
  };
  /* The super-admin key is quoted and the rest are bare identifiers, so the
     key pattern must accept both. */
  const capOfFixed = name => {
    const m = new RegExp("(?:[\"']" + name + "[\"']|\\b" + name + "\\b)\\s*:\\s*\\[([^\\]]*)\\]").exec(body);
    return m ? m[1] : "";
  };
  ok(/"\*"/.test(capOfFixed("super-admin")), "super-admin sees Value Guide (wildcard)");
  ok(/appraisal\.view/.test(capOfFixed("broker")), "broker sees Value Guide");
  ok(/appraisal\.view/.test(capOf("broker")), "broker sees Value Guide");
  ok(!/appraisal\.view/.test(capOf("agent")), "agent cannot see Value Guide");
  ok(!/appraisal\.view/.test(capOf("buyer")), "buyer cannot see Value Guide");
  ok(!/appraisal\.view/.test(capOf("seller")), "seller cannot see Value Guide");
  ok(!/appraisal\.view/.test(capOf("owner")), "owner cannot see Value Guide");
  ok(!/appraisal\.view/.test(capOf("tenant")), "tenant cannot see Value Guide");
}

/* ---------- no writes, no persistence ---------- */
section("no CRM, email or persistence side effects");
/* The public pipeline posts to location-report, which INSERTs a crm_leads row
 * and emails a PDF. An operator generating a guide must not do that. */
const vgBlock = /function renderValueGuide\(\)[\s\S]*?function renderMarketScan\(\)/.exec(APP);
ok(!!vgBlock, "the Value Guide implementation block was located");
if (vgBlock) {
  const code = vgBlock[0];
  ok(!/location-report/.test(code), "never calls the location-report endpoint");
  ok(!/crm_leads/.test(code), "never references crm_leads");
  ok(!/ESREALTY_API_BASE/.test(code), "never uses the API base URL");
  ok(!/\bfetch\s*\(/.test(code), "performs no fetch of any kind");
  ok(!/localStorage/.test(code), "does not touch localStorage directly");
  ok(!/\.contact\(/.test(code), "never calls the listings contact endpoint");
}
ok(/function stripValueGuideDraft\(st\)/.test(APP), "draft is stripped before persistence");
ok(/stripHeavyBlobs\(stripValueGuideDraft\(state\)\)/.test(APP),
  "save() strips the Value Guide draft");
ok(/delete merged\.vg/.test(APP), "a stale persisted draft is discarded on load");

/* ---------- estimator reuse: one source of truth ---------- */
section("reuses the public estimator");
ok(/function estimate\(opts\)/.test(EST), "estimator exposes an estimate() entry point");
ok(/core\.computeEstimate\(d\.config, d\.index, md, opts\)/.test(EST),
  "estimate() delegates to core.computeEstimate");
ok(/result\.integrity = core\.integrityCheck\(result\)/.test(EST),
  "estimate() attaches the integrity verdict");
/* The wizard hands its inputs to the reference-model module, which calls
 * estimate() itself. pickInputs is the only route: it used to be vgOpts(), which
 * sent occupancy/titleStatus/inheritanceStatus while FLOW.FACTORS read
 * lotShape/terrain/roadAccess, so nothing a user answered ever reached the model. */
ok(/ESREALTY_VG_FLOW\.pickInputs\(/.test(APP), "the wizard routes its draft through pickInputs()");
ok(!/\bvgOpts\s*\(/.test(APP), "the old vgOpts() translation is gone");
ok(!/function pickInputs/.test(vgBlock ? vgBlock[0] : ""),
  "pickInputs lives in the flow module, not re-implemented in the wizard");
ok(!/function computeEstimate/.test(vgBlock ? vgBlock[0] : ""),
  "the wizard does not re-implement the formula");
ok(/cfgVersion[\s\S]*?function dataVersionOf/.test(EST),
  "version helpers are at module scope");
ok(/function cfgVersion\(c\)[\s\S]{0,400}?function computeEstimate/.test(EST),
  "cfgVersion is declared before computeEstimate uses it");

/* ---------- data shape the wizard depends on ---------- */
section("dataset accessors match the real data shape");
ok(/function streets\(municipalitySlug, barangay\)/.test(EST),
  "streets() takes a municipality AND a barangay");
ok(/found\.streets/.test(EST), "streets() reads barangays[b].streets (the real shape)");
ok(/found\.other/.test(EST), "streets() reports the all-other-streets rate");
ok(/function barangays\(municipalitySlug\)/.test(EST), "barangays() is async");
/* The unavailable object is built across several lines, so match the reason
 * string and the guard separately. */
ok(/reason:\s*"municipality-not-found"/.test(EST), "an unknown municipality is reported, not guessed");
ok(/if\s*\(!row\)\s*\{/.test(EST), "a missing municipality row short-circuits instead of estimating");

/* ---------- source provenance ---------- */
section("source provenance is per-RDO and correctly cited");
const byRdo = {};
BIRMANIFEST.datasets.forEach(d => { byRdo[d.rdo] = d; });
ok(byRdo["58"] && byRdo["59"], "importer manifest carries both RDOs");
const d58 = byRdo["58"], d59 = byRdo["59"];
ok(d58.departmentOrder === "035-2022" && d58.effectivityDate === "2022-07-23",
  "RDO 58 = DO 035-2022 effective 2022-07-23");
ok(d59.departmentOrder === "034-2022" && d59.effectivityDate === "2022-07-10",
  "RDO 59 = DO 034-2022 effective 2022-07-10");
const rec = id => MANIFEST.provenance.records.find(r => r.id === id);
ok(!!rec("bir-d035-2022") && rec("bir-d035-2022").coverage.indexOf("058") >= 0 &&
   rec("bir-d035-2022").coverage.indexOf("059") < 0,
  "DO 035-2022 is scoped to RDO 058 only");
ok(!!rec("bir-d034-2022") && rec("bir-d034-2022").coverage.indexOf("059") >= 0 &&
   rec("bir-d034-2022").effectiveDate === "2022-07-10",
  "DO 034-2022 covers RDO 059 effective 2022-07-10");
ok(MANIFEST.provenance.records.length === 3, "three source records (two DOs + RCN)");
ok(!/RA 12000/.test(JSON.stringify(MANIFEST)), "no stale RA 12000 citation in the manifest");
ok(!/RAVPRADA/.test(JSON.stringify(MANIFEST)), "no stale RAVPRADA acronym in the manifest");
ok(/RA 12001/.test(MANIFEST.provenance.records[0].currencyNote),
  "RA 12001 cited with its short title");
ok(/DO 034-2022/.test(DOCS), "the docs cite DO 034-2022");
ok(/RA 12001/.test(DOCS), "the docs cite RA 12001");
/* The docs deliberately name the old citation inside the correction note, so
   only the substantive references are checked. The blank-line lookahead must
   tolerate CRLF: with core.autocrlf=true a fresh Windows clone checks the file
   out with \r\n, a bare \n\n never matches there, the correction note survives
   the strip, and this assertion fails on a clean clone while passing in a
   working tree that happens to hold LF. */
const docsBody = DOCS.replace(/Correcting an earlier error:[\s\S]*?(?=\r?\n\r?\n)/, "");
ok(!/RA 12000/.test(docsBody), "the docs no longer cite RA 12000 outside the correction note");
ok(/RA 12001.*Real Property Valuation and Assessment Reform Act/s.test(DOCS),
  "the docs spell out RA 12001's short title");

/* ---------- PDF renderer ---------- */
section("PDF renderer");
const UTIL = L("js/util.js");  // the lazy loader lives here (ESREALTY_UTIL.loadScriptOnce)
ok(/vendor\/pdf-lib\/pdf-lib\.min\.js/.test(UTIL), "pdf-lib is vendored, not from a CDN");
ok(!/cdn\./.test(PDF), "the renderer does not reach a CDN");
ok(/function toBlob\(lib, r, meta\)/.test(PDF), "toBlob takes the lib as an argument");
ok(/window\.ESREALTY_PDF_LIB = \{/.test(UTIL) && /src="js\/util\.js"/.test(HTML), "a pdf-lib namespace is defined (js/util.js, loaded by index.html)");
ok(/ensure\s*:\s*function\s*\(\s*\)/.test(UTIL), "a lazy loader is defined");
/* The loader must not be a blocking <script src> tag: 513 KB on every page
   load would be paid by every user of the public storefront to serve an
   internal tool. */
const pdfTag = /<script[^>]*src="vendor\/pdf-lib[^"]*"[^>]*>/.test(HTML);
ok(!pdfTag, "pdf-lib is NOT in a blocking script tag (lazy-loaded)");
ok(/document\.createElement\("script"\)/.test(UTIL), "the loader injects the script on demand");
/* Strip comments before scanning for the peso sign: it is mentioned in a
 * comment explaining why it is NOT used, and a naive search finds that. */
const pdfCode = PDF.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
ok(!/₱/.test(pdfCode), "the peso sign is not passed to the standard PDF fonts");
ok(/PHP "/.test(pdfCode) || /"PHP "/.test(pdfCode), "peso amounts are written as PHP for the standard fonts");
ok(/not a certified appraisal|not a certified appraisal/i.test(PDF),
  "the PDF states it is not a certified appraisal");
ok(/planning guide|planning estimate/i.test(PDF), "the PDF labels the figure a planning guide");
ok(/context only/i.test(PDF), "the PDF marks comparables as context only");
ok(/What this report does not cover/.test(PDF), "the PDF has a limitations section");
ok(/dataVersion/.test(PDF) && /calculationVersion/.test(PDF),
  "the PDF prints data and calculation versions");
ok(/disclaimer/.test(PDF), "the PDF prints the disclaimer");
ok(/t\s*\+\s*"\[A-Za-z0-9\.\/_-]+\.pdf"/.test(PDF) || /\.pdf/.test(PDF), "a .pdf filename is produced");

/* ---------- wizard chrome ---------- */
section("wizard UI");
ok(/\.vg-steps/.test(CSS) && /\.vg-figure-primary/.test(CSS), "wizard styles are defined");
ok(/not interchangeable/.test(vgBlock ? vgBlock[0] : ""),
  "the summary tells the reader the two figures are not interchangeable");
ok(/data-vg-calc/.test(APP) && /data-vg-pdf/.test(APP), "calculate and download actions exist");
ok(/Nothing is saved to the CRM and no email is sent/.test(vgBlock ? vgBlock[0] : ""),
  "the UI states nothing is saved or sent");
ok(/integrity\.ok \? "" : " disabled"/.test(vgBlock ? vgBlock[0] : ""),
  "the PDF button is disabled when the integrity check fails");

/* ---------- transaction fee parity ---------- */
section("transaction fee parity");
/* txCostEstimator drives the internal CRM transaction closing-cost figures and
 * had no test at all, which is how its registration fee drifted to
 * min(1%, 50k) + 2,000 - about 10x the project's own registrationPct on a
 * typical base, and roughly PHP 47,000 of overstatement on a PHP 5,000,000
 * transaction. Pin the rate to the single source of truth so it cannot drift
 * again. js/value_guide_finance.js is the canonical owner; data/zonal-config.json
 * carries the rate both the estimator and the PDF renderer read. */
const ZONAL = JSON.parse(L("data/zonal-config.json"));
const txCostSrc = /function txCostEstimator\(t\)\s*\{[\s\S]*?\n  \}/.exec(APP);
ok(!!txCostSrc, "txCostEstimator is present in js/app.js");
if (txCostSrc) {
  const body = txCostSrc[0];
  ok(!/Math\.min\(price \* 0\.01,\s*50000\)/.test(body) && !/\+\s*2000\s*;/.test(body),
    "the ad-hoc registration cap and fixed fee are gone",
    "was min(1%, 50000) + 2000");
  ok(/C\.num\(t\.registrationPct,\s*0\.1\)/.test(body),
    "registration defaults to the canonical 0.1% and is overridable per transaction");
  // 0.1 percent expressed against the config's decimal rate.
  ok(Math.abs(ZONAL.tax.registrationPct * 100 - 0.1) < 1e-9,
    "the 0.1% default equals zonal-config registrationPct",
    "config=" + (ZONAL.tax.registrationPct * 100) + "%");
  // And it must equal what the shared owner computes for the same base.
  const FIN = require("../js/value_guide_finance.js");
  const base = 5000000;
  const shared = FIN.transaction(ZONAL, base, { salePrice: base, brokerPct: 0 }).registration;
  const local = base * (0.1 / 100);
  ok(shared === local, "txCostEstimator now agrees with value_guide_finance",
    "shared=" + shared + " local=" + local);
}

/* core.js reports CGT + DST + transfer and omits registration from both the
 * item list and its total. That is consistent (6% + 1.5% + 0.5% = 8%), not a
 * defect, but it must not drift into claiming 8% while also adding
 * registration. */
const coreTaxSrc = /zonalFMV:\s*zonalFMV[\s\S]{0,400}?total:\s*base != null \? base \* ([\d.]+) : null/.exec(L("js/core.js"));
ok(!!coreTaxSrc, "the core tax summary total is still explicit");
if (coreTaxSrc) {
  const declared = Number(coreTaxSrc[1]);
  const sum = ZONAL.tax.cgtPct + ZONAL.tax.dstPct + ZONAL.tax.transferPct;
  ok(Math.abs(declared - sum) < 1e-9,
    "the core tax total equals the sum of the components it reports",
    "declared=" + declared + " sum=" + sum.toFixed(3));
}

/* ---------- geography parity ---------- */
section("geography parity");
/* Two tables describe the same 83 provinces: PH_GEO in js/app.js (the CI-gated
 * source for tools/gen_ph_geo.js -> market-scan/vercel/lib/ph_geo.js) and
 * PH_CITY_MAP in js/data.js (which backs D.citiesFor, i.e. every province
 * dropdown in the CRM). PH_CITY_MAP was missing 163 municipalities that PH_GEO
 * already had, including three Batangas cities this project sells in: Lobo,
 * Mataasnakahoy and Taysan. Assert the wizard dropdowns can never fall behind
 * PH_GEO again. Parse strictly inside each literal so neighbouring objects in
 * the same file are not mistaken for geography. */
function literalOf(src, name) {
  const s = src.indexOf("const " + name);
  let d = 0, started = false, end = -1;
  for (let k = src.indexOf("{", s); k < src.length; k++) {
    if (src[k] === "{") { d++; started = true; }
    else if (src[k] === "}") { d--; if (started && d === 0) { end = k; break; } }
  }
  return { text: src.slice(s, end + 1), offset: s };
}
function bracketEnd(t, open) {
  let d = 0;
  for (let k = open; k < t.length; k++) {
    if (t[k] === "[") d++;
    else if (t[k] === "]") { d--; if (d === 0) return k; }
  }
  return -1;
}
function provincesIn(src, name) {
  const { text } = literalOf(src, name);
  const out = {};
  const re = /"([^"]+)":\s*\[/g;
  re.lastIndex = text.indexOf("{") + 1;
  let m, guard = 0;
  while ((m = re.exec(text)) && guard++ < 500) {
    const open = m.index + m[0].length - 1;
    const close = bracketEnd(text, open);
    if (close < 0) continue;
    out[m[1]] = (text.slice(open + 1, close).match(/"([^"]+)"/g) || []).map(x => x.slice(1, -1));
    re.lastIndex = close + 1;
  }
  return out;
}
const GEO = provincesIn(APP, "PH_GEO");
const CITYMAP = provincesIn(L("js/data.js"), "PH_CITY_MAP");
const provNames = Object.keys(GEO);
ok(provNames.length > 80, "PH_GEO still parses as a full province table", provNames.length + " provinces");
ok(Object.keys(CITYMAP).length === provNames.length,
  "PH_CITY_MAP and PH_GEO cover the same provinces",
  "citymap=" + Object.keys(CITYMAP).length + " geo=" + provNames.length);
const gaps = [];
for (const p of provNames) {
  const have = CITYMAP[p] || [];
  for (const c of GEO[p]) if (!have.includes(c)) gaps.push(p + "/" + c);
}
ok(gaps.length === 0,
  "every PH_GEO municipality is selectable in the CRM province dropdowns",
  gaps.length ? gaps.slice(0, 6).join(", ") : "no gaps");
for (const c of ["Lobo", "Mataasnakahoy", "Taysan"]) {
  ok((CITYMAP["Batangas"] || []).includes(c), "Batangas dropdown includes " + c);
}

console.log(failures ? "\n" + failures + "/" + checked + " FAILED" : "\nALL GREEN (" + checked + " checks)");
process.exit(failures ? 1 : 0);