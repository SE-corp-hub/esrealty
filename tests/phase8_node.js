/* Phase 8 (owner decisions, 21 Oct): Value Guide data note (G2), Gmail by hand (E1), consent
 * record (B1), clean-up job off (B3), Autopilot cron off (F10). Static checks on shipped files. */
const fs = require("fs");
const path = require("path");
const R = require("../tools/retention_cleanup.js");
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });
(async () => {
  // G2
  const m = JSON.parse(read("data/data-manifest.json"));
  c("Value Guide data: checked 21 Oct, next review 21 Nov", m.provenance.lastAttemptedCheck === "2026-10-21" && m.nextReview === "2026-11-21" && m.provenance.nextCurrencyReview === "2026-11-21");
  c("both BIR schedules say what was checked and that it is not yet confirmed", m.provenance.records.filter(r => /^bir-/.test(r.id)).every(r => /Checked 2026-10-21/.test(r.currencyNote) && /not yet confirmed with BIR/.test(r.currencyNote) && r.status === "applicability-unverified"));
  c("the estimate says the schedule is not yet confirmed", /it is not yet confirmed with BIR/.test(read("js/estimator.js")));
  // E1
  const app = read("js/app.js");
  c("Gmail compose address is Gmail's own", /"https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&to=" \+ encodeURIComponent\(to \|\| ""\) \+ "&su=" \+ encodeURIComponent\(subject \|\| ""\) \+ "&body="/.test(app));
  c("a blocked popup falls back to the mail app", /if \(!w\) \{ const a = document\.createElement\("a"\); a\.href = mailtoUrl/.test(app));
  c("Gmail buttons on lead, Value Guide, password reset and owner statement", /gmailLink\(l\.email, leadReplyEmail\(l\)\.subject/.test(app) && /gmailLink\(l\.email, "Your SEA ESTATES property value report"/.test(app) && /"Your new SEA ESTATES password"/.test(app) && /"Owner statement: " \+ st\.label/.test(app));
  c("the digest no longer calls the email function", !/functions\/v1\/notify-dispatch/.test(app.slice(app.indexOf("async function emailLeadDigest"), app.indexOf("async function emailLeadDigest") + 2000)));
  // B1
  ["supabase/functions/listing-api/index.ts", "supabase/functions/location-report/index.ts"].forEach(f => {
    const src = read(f);
    c(f.split("/")[2] + ": consent is stored with the notice version and channel", /const PRIVACY_NOTICE_VERSION = "2026-10-01";/.test(src) && /consentRecord: \{ at: [^,]+, notice: PRIVACY_NOTICE_VERSION, channel: /.test(src));
  });
  c("the notice version matches the privacy notice date", /Last updated: 1 October 2026/.test(read("js/storefront.js")));
  // B3
  let sql = "", lines = [];
  await R.main([], async q => { sql = q; return [{ what: "read notifications older than 180 days", rows_found: 4, deleted: false }]; }, l => lines.push(l));
  c("clean-up counts only by default", sql === "select * from public.retention_sweep(true)" && /nothing was deleted/.test(lines.join(" ")));
  await R.main(["--delete"], async q => { sql = q; return []; }, () => {});
  c("--delete deletes", sql === "select * from public.retention_sweep(false)");
  lines = [];
  const r = await R.main([], async () => { throw new Error("function public.retention_sweep(boolean) does not exist"); }, l => lines.push(l));
  c("before 0010: says so, no alarm", r.pending && /apply migration 0010/.test(lines.join(" ")));
  const wf = read(".github/workflows/retention.yml");
  c("workflow: monthly, deletes only when RETENTION_CLEANUP is on", /cron: "41 19 1 \* \*"/.test(wf) && /CLEANUP: \$\{\{ vars\.RETENTION_CLEANUP \}\}/.test(wf) && /if \[ "\$CLEANUP" = "on" \]; then node tools\/retention_cleanup\.js --delete; else node tools\/retention_cleanup\.js; fi/.test(wf));
  const mig = read("supabase/migrations/0010_handover_retention.sql");
  c("clean-up never touches leads, money or the change log", !/delete from public\.(crm_leads|cash_entries|audit_events|broker_transactions)/.test(mig));
  // F10
  const v = JSON.parse(read("market-scan/vercel/vercel.json"));
  c("the daily Autopilot call is switched off", !v.crons || !v.crons.some(x => /agent-dispatch/.test(x.path)));
  c("the runbook says so", /Vercel cron \| switched off/.test(read("docs/runbook/README.md")));
  const ok = checks.every(x => x.ok) && checks.length >= 17;
  console.log("\n[phase8_node] " + checks.length + " checks");
  checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : "  " + x.detail)));
  console.log(ok ? "ALL PASS" : "FAILURES PRESENT");
  process.exit(ok ? 0 : 1);
})();
