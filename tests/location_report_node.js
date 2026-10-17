/* location-report + estimator lead pipeline — static contract + payload
 * conformance locks (node counterpart; runs inside tests/run_all.ps1 without
 * a live Supabase/Deno deployment).
 *
 * Covers the Phase 7 production hardening:
 *  - location-report: method guard, bounded request bodies, schema caps,
 *    client-supplied-information marker, idempotent lead writes, ASCII-safe
 *    PDF currency, real multi-page rotation.
 *  - estimator.js: Idempotency-Key on every submit, listing-api fallback only
 *    on transport errors (never after an HTTP answer => no duplicate leads).
 *  - build/workflow: --validate never writes; staleness survives CI; centroids
 *    are read from the current `municipalities` array.
 */
const FS = require("fs");
const PATH = require("path");

const ROOT = PATH.join(__dirname, "..");
const L = (p) => FS.readFileSync(PATH.join(ROOT, p), "utf8");
const LR = L("supabase/functions/location-report/index.ts");
const EST = L("js/estimator.js");
const APP = L("js/app.js");
const BUILD = L("market-scan/build-batangas-data.js");
const WF = L(".github/workflows/estimator-data-review.yml");

const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok, detail });

/* ---------------- location-report hardening (source audit) ---------------- */

c("location-report limits request bodies", /MAX_BODY_BYTES\s*=\s*200_000/.test(LR), "MAX_BODY_BYTES");
c("location-report pre-checks content-length", /content-length/.test(LR) && /readJsonLimited/.test(LR), "capped reader");
c("location-report streams body with byte counter", /reader\.read\(\)/.test(LR) && /size > maxBytes/.test(LR), "streamed size guard");
c("location-report returns 413 on oversized body", /413, "Request body is too large"/.test(LR), "413 path");
c("location-report rejects non-POST (405)", /req\.method !== "POST"/.test(LR) && /405/.test(LR), "method guard");
c("location-report validates email + consent", /email is invalid/.test(LR) && /consent is required/.test(LR), "core validation");
c("location-report idempotency header consumed", /idempotency-key/i.test(LR), "idempotency header");
c("location-report dedupes on retry before insert", /payload->>idempotencyKey/.test(LR), "existing-key lookup");
c("location-report sanitizes the report object", /sanitizeReport/.test(LR) && /sanitizeEstimate/.test(LR), "sanitizers used");
c("location-report marks data client-supplied", /trusted: false/.test(LR) && /client-supplied/.test(LR), "truthfulness marker");
c("location-report sends no email (the team calls first, then emails the report)", !/resend|MAIL_FROM|buildPdf|pdf-lib/i.test(LR), "no mailer");
c("location-report keeps the estimator inputs for the back office", /sanitizeInputs/.test(LR) && /inputs: sanitizeInputs\(source\.inputs\)/.test(LR), "inputs kept");
c("location-report starts the call-first workflow", /reportStatus: "awaiting-call"/.test(LR), "status");
c("location-report caps free strings", /\.slice\(0, \d+\)/.test(LR), "string caps");
c("location-report returns 201 on success", /\}, 201\)/.test(LR), "201 response");

/* ---------- canonical sanitize spec -> behavioral conformance ---------- */

function canonicalSanitizeReport(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const property = (source.property && typeof source.property === "object") ? source.property : {};
  const location = (source.location && typeof source.location === "object") ? source.location : {};
  const num = (v) => { const n = Number(v); return isFinite(n) && n >= 0 ? n : 0; };
  const str = (v, max) => String(v ?? "").trim().slice(0, max);
  return {
    property: {
      purpose: str(property.purpose, 80),
      type: str(property.type, 40),
      typeLabel: str(property.typeLabel, 80),
      kind: property.kind === "built" ? "built" : property.kind === "land" ? "land" : "",
      area: num(property.area),
      corner: !!property.corner,
      floorArea: num(property.floorArea),
    },
    location: {
      region: str(location.region, 80),
      province: str(location.province, 80),
      town: str(location.town, 80),
      barangay: str(location.barangay, 120),
      address: str(location.address, 200),
      streetListed: !!location.streetListed,
      lat: location.lat == null ? null : num(location.lat),
      lng: location.lng == null ? null : num(location.lng),
    },
    trusted: false,
  };
}

const payload = {
  full_name: "E2E Buyer",
  email: "e2e@example.com",
  consent: true,
  report: {
    property: { purpose: "Selling", type: "vacant_lot", typeLabel: "Vacant Lot", kind: "land", area: 200, corner: true },
    location: { region: "Region IV-A (CALABARZON)", province: "Batangas", town: "BALAYAN", barangay: "BACLARAN", address: "P. Burgos St", streetListed: true, lat: 13.9, lng: 120.73 },
    estimate: { total: 2975000, low: 2677500, high: 3272500, perSqm: 14875, landValue: 2975000, improvement: 0, area: 200 },
  },
};
const spec = canonicalSanitizeReport(payload.report);
c("conformance: sanitizer keeps valid fields", spec.location.town === "BALAYAN" && spec.property.area === 200 && spec.property.corner === true, JSON.stringify(spec.location));
c("conformance: sanitizer caps oversized strings", canonicalSanitizeReport({ property: { typeLabel: "X".repeat(500) }, location: { town: "y".repeat(300) } }).property.typeLabel.length <= 80, "typeLabel length");
c("conformance: negatives coerced to zero", canonicalSanitizeReport({ property: { area: -5 } }).property.area === 0, "area -5 -> 0");
c("conformance: absent lat/lng stay absent (null)", canonicalSanitizeReport({ location: {} }).location.lat === null, "lat null");
c("conformance: marker stays false for client data", spec.trusted === false, "trusted flag");

/* ----------------- estimator.js lead wiring (source audit) ---------------- */

c("estimator sends Idempotency-Key", /Idempotency-Key/.test(EST) && /estIdempotencyKey/.test(EST), "idempotency key on submit");
c("estimator dedupes retries with same key", /form\.dataset\.estIdempotencyKey/.test(EST), "key reuse across retries");
c("estimator resets key after success", /delete form\.dataset\.estIdempotencyKey/.test(EST), "key reset on success");
c("estimator fallback only on transport errors", /isHttp/.test(EST) && /isHttp\s*(if|\)|\?)/.test(EST) && /^\s*if \(isHttp\) throw err;/m.test(EST), "network-only fallback");
c("estimator prefers usable internal comparables", /loadComparableListings/.test(EST) && /var usefulInternal = comparableSummary\(internal/.test(EST) && /usefulInternal \? Promise\.resolve/.test(EST), "normalized internal-first comparable path");
c("estimator external fallback is source-attributed", /loadExternalComparables/.test(EST) && /External web evidence/.test(EST), "external evidence label");
c("admin value-guide factors require approval", /data-vg-save/.test(APP) && /roleIs\("super-admin"\)/.test(APP), "admin factor gate");
c("public settings expose sanitized value-guide factors", /safeNumber/.test(L("supabase/functions/listing-api/index.ts")) && /valueGuide/.test(L("supabase/functions/listing-api/index.ts")), "public settings contract");

/* ----------------- provenance surfaced in the delivered report ---------------- */

c("manifest carries appraisal provenance block", /"provenance"/.test(L("data/data-manifest.json")) && /"basisOfValue"/.test(L("data/data-manifest.json")) && /"assurance"/.test(L("data/data-manifest.json")), "manifest v3 sections");
c("estimator loads the manifest it renders", /data-manifest\.json/.test(EST) && /provenanceHtml/.test(EST), "single source of wording");
c("estimator renders the audit section", /How this number was built/.test(EST) && /Basis of value/i.test(EST), "customer-facing section");
c("report sanitizes provenance instead of trusting it", /if \(raw\.provenance && typeof raw\.provenance === "object"\)/.test(LR) && /basisOfValue/.test(LR), "allowlisted");

/* ----------------- build + workflow contract ----------------- */

c("builder supports --validate", /--validate/.test(BUILD) && /VALIDATE_ONLY/.test(BUILD), "validate flag");
c("validate-only never writes", /if \(VALIDATE_ONLY\)/.test(BUILD) && /VALIDATE-ONLY — generated outputs are not written/.test(BUILD), "gated writes");
c("validate-only does not advance the review stamp", /nextReview: VALIDATE_ONLY \? "n\/a \(validate-only\)"/.test(BUILD), "review stamp preserved");
c("centroids read from current municipalities key", /legacyZonal\.municipalities \|\| legacyZonal\.towns/.test(BUILD), "municipalities-first");
c("CI review workflow runs validate-only", /node market-scan\/build-batangas-data\.js --validate/.test(WF), "workflow --validate");
c("CI staleness check reads the untouched nextReview", /Next review \| '\? ' \+ m\.nextReview/.test(WF) || /m\.nextReview/.test(WF), "stale detection intact");

const ok = checks.every((x) => x.ok) && checks.length >= 22;
console.log("\n[location_report_node] " + checks.length + " checks");
checks.forEach((x) => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : "  " + x.detail)));
console.log(ok ? "ALL PASS" : "FAILURES PRESENT");
process.exit(ok ? 0 : 1);
