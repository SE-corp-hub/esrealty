/* tools/lead_response_alerts.js and its workflow (roadmap F3). */
const fs = require("fs");
const path = require("path");
const T = require("../tools/lead_response_alerts.js");
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });
(async () => {
  c("default 24 hours", T.hoursFrom([], {}) === 24);
  c("--hours wins over the variable", T.hoursFrom(["--hours", "12"], { LEAD_RESPONSE_HOURS: "48" }) === 12);
  c("the repository variable sets it", T.hoursFrom([], { LEAD_RESPONSE_HOURS: "48" }) === 48);
  let threw = false; try { T.hoursFrom(["--hours", "0"], {}); } catch (e) { threw = true; } c("0 hours is refused", threw);
  threw = false; try { T.hoursFrom([], { LEAD_RESPONSE_HOURS: "1;drop" }); } catch (e) { threw = true; } c("a non-number cannot reach the SQL", threw);
  const rows = [{ lead_id: "a", step: "assignee", alerted: false, notified: "u1" }, { lead_id: "a", step: "escalation", alerted: false, notified: "u2" }, { lead_id: "b", step: "assignee", alerted: false, notified: "u3" }];
  let sql = "", lines = [];
  let r = await T.main([], async s => { sql = s; return rows; }, l => lines.push(l), {});
  c("dry run asks the database to only count", sql === "select * from public.lead_response_sweep(24, true)", sql);
  c("dry run log: counts only", /Leads still New after 24 hours: 2 \(2 first alerts, 1 escalations due\)/.test(lines.join("\n")) && /nothing was sent/.test(lines.join("\n")) && !/u1|u2|u3/.test(lines.join("\n")), lines.join(" | "));
  lines = [];
  r = await T.main(["--send"], async s => { sql = s; return rows.map(x => Object.assign({}, x, { alerted: true })); }, l => lines.push(l), { LEAD_RESPONSE_HOURS: "6" });
  c("send mode with 6 hours", sql === "select * from public.lead_response_sweep(6, false)" && r.sent === 3 && /Sent 3 alerts/.test(lines.join("\n")), sql);
  lines = [];
  r = await T.main([], async () => { throw new Error("function public.lead_response_sweep(integer, boolean) does not exist"); }, l => lines.push(l), {});
  c("before migration 0008: says so, no alarm", r.pending && /apply migration 0008/.test(lines.join("\n")));
  threw = false; try { await T.main([], async () => { throw new Error("connection refused"); }, () => {}, {}); } catch (e) { threw = true; }
  c("other errors fail the run (which opens an issue)", threw);
  const wf = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/lead-response.yml"), "utf8");
  c("workflow: hourly, sending only when LEAD_RESPONSE_ALERTS is on, opens an issue on failure", /cron: "17 \* \* \* \*"/.test(wf) && /SENDING: \$\{\{ vars\.LEAD_RESPONSE_ALERTS \}\}/.test(wf) && /if \[ "\$SENDING" = "on" \]; then node tools\/lead_response_alerts\.js --send; else node tools\/lead_response_alerts\.js; fi/.test(wf) && /Scheduled job failed: Lead response alerts/.test(wf));
  const ok = checks.every(x => x.ok) && checks.length >= 11;
  console.log("\n[lead_response_alerts_node] " + checks.length + " checks");
  checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : "  " + x.detail)));
  console.log(ok ? "ALL PASS" : "FAILURES PRESENT");
  process.exit(ok ? 0 : 1);
})();
