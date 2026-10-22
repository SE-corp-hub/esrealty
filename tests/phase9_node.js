/* Phase 9: viewing reminders (A4/F9), licence renewal reminders (J4), late fees (I6),
 * vacant unit to listing (I9), storage use check (D2), Value Guide finish panel (G1). */
const fs = require("fs");
const path = require("path");
const L = require("../js/pms_ledger.js");
const Rm = require("../tools/reminders.js");
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });
(async () => {
  // I6 late fees
  const lease = { id: "l1", start: "2026-07-01", end: "2027-06-30", rent: 20000, due_day: "5", late_fee: 500, grace_days: 5, charges: [] };
  const paidJuly = [{ lease_id: "l1", status: "paid", amount: 20000, month: "2026-07" }];
  let f = L.lateFeesDue(lease, paidJuly, "2026-10-22");
  c("late fees: one per unpaid month past the grace days", f.map(x => x.month).join(",") === "2026-08,2026-09,2026-10" && f.every(x => x.amount === 500), JSON.stringify(f));
  c("not before the grace days are over", L.lateFeesDue(lease, paidJuly, "2026-08-10").length === 0 && L.lateFeesDue(lease, paidJuly, "2026-08-11").length === 1);
  c("a paid month owes no late fee", L.lateFeesDue(lease, paidJuly.concat([{ lease_id: "l1", status: "paid", amount: 20000, month: "2026-08" }]), "2026-08-20").length === 0);
  c("a month already charged (or waived) is not charged again", L.lateFeesDue(Object.assign({}, lease, { charges: [{ id: "c1", type: "Late fee", period: "2026-08", amount: 500, archived: true }] }), paidJuly, "2026-08-20").length === 0);
  c("percent of the month's rent", L.lateFeesDue(Object.assign({}, lease, { late_fee: 2, late_fee_type: "percent" }), paidJuly, "2026-08-20")[0].amount === 400);
  c("no late fee set: nothing", L.lateFeesDue(Object.assign({}, lease, { late_fee: 0 }), paidJuly, "2026-10-22").length === 0);
  c("grace days default to 5 and stay within 0 to 60", L.graceDays({}) === 5 && L.graceDays({ grace_days: 0 }) === 0 && L.graceDays({ grace_days: 99 }) === 60);
  c("a one-off lease total has no monthly late fee", L.lateFeesDue(Object.assign({}, lease, { rent_type: "lease" }), [], "2026-10-22").length === 0);
  const app = read("js/app.js");
  c("the lease form has the late fee, its kind and grace days", /pmsNum\("pms-lease-late"/.test(app) && /pmsSel\("pms-lease-latetype"/.test(app) && /pmsNum\("pms-lease-grace"/.test(app));
  c("late fees are added only with a press", /data-pms-latefees=/.test(app) && /function pmsAddLateFees\(leaseId\)/.test(app) && /"Late fee", "Other"\]/.test(app));
  // I9
  c("a vacant unit can be listed for rent as a private draft", /data-pms-list-unit=/.test(app) && /function pmsUnitListingDraft\(u\)/.test(app) && /dealType: "rent", status: "available"/.test(app) && /isPublished: false\n/.test(app));
  c("the listing remembers its unit", /rec\.pmsUnitId = m\.getAttribute\("data-pms-unit"\)/.test(app));
  // G1
  c("Value Guide opened from a request ends with download, Gmail, mark sent", /function vgLeadFinishHtml\(d\)/.test(app) && /data-vg-finish-sent=/.test(app) && /Value Guide report PDF prepared: /.test(app));
  c("marking sent still needs the call first", /vgRequestStatus\(l\) !== "verified" \? '<span class="dim tiny">Call the customer first/.test(app));
  // A4 / J4 in the app
  c("the reminder hint is honest about switching on", /once your Super Admin turns reminders on/.test(app) && !/we list the reminder in the dashboard/.test(app));
  c("bell links can open the Compliance tab", /lk\[0\] === "admin" && lk\[1\] && navAllowed\("admin"\) && adminTabAllowed\(lk\[1\]\)/.test(app));
  c("agents' PRC IDs can be recorded", /\["agent_prc", "Salesperson \/ Agent PRC ID"\]/.test(app));
  // Reminders tool
  let qs = [], lines = [];
  await Rm.main([], async q => { qs.push(q); return /viewing/.test(q) ? [{ lead_id: "a", alerted: false }] : [{ stage: "30", alerted: false }, { stage: "expired", alerted: false }]; }, l => lines.push(l));
  c("reminders: count only by default", qs.join(" | ") === "select * from public.viewing_reminder_sweep(true) | select * from public.compliance_expiry_sweep(true)" && /nothing was sent/.test(lines.join(" ")));
  c("the log shows counts, not names", /Viewing reminders due: 1\./.test(lines.join(" ")) && /Licence reminders due: 2 \(30 days: 1, expired: 1\)\./.test(lines.join(" ")));
  qs = []; lines = [];
  const sent = await Rm.main(["--send"], async q => { qs.push(q); return [{ alerted: true }]; }, l => lines.push(l));
  c("--send sends", /sweep\(false\)/.test(qs[0]) && /sweep\(false\)/.test(qs[1]) && sent.sent === 2);
  lines = [];
  const pend = await Rm.main([], async () => { throw new Error("function public.viewing_reminder_sweep(boolean) does not exist"); }, l => lines.push(l));
  c("before 0011: says so, no alarm", pend.pending && /apply migration 0011/.test(lines.join(" ")));
  let threw = false;
  try { await Rm.main([], async () => { throw new Error("Database said (500): boom"); }, () => {}); } catch (e) { threw = true; }
  c("a real failure fails the run", threw);
  const wf = read(".github/workflows/reminders.yml");
  c("workflow: every 15 minutes, sends only when REMINDER_ALERTS is on", /cron: "7,22,37,52 \* \* \* \*"/.test(wf) && /SENDING: \$\{\{ vars\.REMINDER_ALERTS \}\}/.test(wf) && /if \[ "\$SENDING" = "on" \]; then node tools\/reminders\.js --send; else node tools\/reminders\.js; fi/.test(wf));
  c("workflow opens an issue when it fails", /title="Scheduled job failed: Reminders"/.test(wf));
  const mig = read("supabase/migrations/0011_reminders.sql");
  c("migration: Philippine time, sent once, server only", /at time zone 'Asia\/Manila'/.test(mig) && /primary key \(lead_id, event_id, remind_at\)/.test(mig) && /grant execute on function public\.viewing_reminder_sweep\(boolean\) to service_role;/.test(mig) && /grant execute on function public\.compliance_expiry_sweep\(boolean\) to service_role;/.test(mig));
  c("migration changes no lead or licence", !/update public\.(crm_leads|compliance_records)/.test(mig) && !/delete from/.test(mig));
  const chk = read("supabase/check-backend.js");
  c("health check knows the two new functions", /fn: "viewing_reminder_sweep".*pending: "0011"/.test(chk) && /fn: "compliance_expiry_sweep".*pending: "0011"/.test(chk));
  // D2 usage: its own nightly job (tests/usage_check_node.js covers the details).
  c("storage use has its own nightly job, not the health check", fs.existsSync(path.join(__dirname, "..", ".github/workflows/usage-check.yml")) && !/check-usage/.test(chk));
  // Registered
  const tests = read(".github/workflows/tests.yml");
  c("phase 9 browser test is in CI", /-Test phase9_app_e2e/.test(tests));
  const rb = read("docs/runbook/README.md");
  c("runbook lists the reminders job", /\(`reminders`\) \| every 15 minutes/.test(rb) && /REMINDER_ALERTS/.test(rb));

  const failed = checks.filter(x => !x.ok);
  checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : " :: " + x.detail)));
  console.log(failed.length ? failed.length + " FAILED" : "ALL PASS");
  process.exit(failed.length ? 1 : 0);
})();
