/* Phase 13: bank statement matching (I2), meter readings (I7), work orders (I5). */
const fs = require("fs");
const path = require("path");
const R = require("../js/pms_reconcile.js");
const P = require("../js/lead_import.js");
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });
c("dates as banks write them", R.date("2026-10-05") === "2026-10-05" && R.date("10/05/2026") === "2026-10-05" && R.date("05 Oct 2026") === "2026-10-05" && R.date("Oct 5, 2026") === "2026-10-05" && R.date("soon") === "");
c("amounts with commas, pesos and brackets", R.num("PHP 28,000.50") === 28000.5 && R.num("(500.00)") === -500 && R.num("") === 0);
const L = R.lines(P.parseCsv('Posting Date,Particulars,Withdrawals,Deposits\n10/05/2026,INSTAPAY FROM ANA REF X1,,"28,000.00"\n10/06/2026,ATM,"5,000.00",\n10/07/2026,FEE,,0\n'));
c("bank headers are recognised; only money in is kept", L.lines.length === 1 && L.lines[0].amount === 28000 && L.lines[0].date === "2026-10-05", JSON.stringify(L));
c("a file without Date and Amount says so", /Could not find the Date and Amount/.test(R.lines(P.parseCsv("a,b\n1,2\n")).problem));
const open = [
  { key: "a", leaseId: "l1", tenantName: "Ana Reyes", unit: "3B", amount: 28000, due: "2026-10-10" },
  { key: "b", leaseId: "l1", tenantName: "Ana Reyes", unit: "3B", amount: 28000, due: "2026-09-10" },
  { key: "c", leaseId: "l2", tenantName: "Ben Cruz", unit: "4A", amount: 28000, due: "2026-10-10" },
  { key: "d", leaseId: "l3", tenantName: "Cy Lim", unit: "5C", amount: 1500, due: "2026-10-01" }
];
const m = R.match([
  { date: "2026-10-05", amount: 28000, text: "INSTAPAY FROM ANA REYES" },
  { date: "2026-10-06", amount: 28000, text: "PAYMENT UNIT 4A" },
  { date: "2026-10-06", amount: 1500, text: "GCASH" },
  { date: "2026-10-07", amount: 28000, text: "TRANSFER" },
  { date: "2026-10-08", amount: 999, text: "?" }
], open, []);
c("a named tenant is sure, oldest month first", m[0].state === "sure" && m[0].candidates[0].key === "b", JSON.stringify(m[0]));
c("a unit in the description is sure too", m[1].state === "sure" && m[1].candidates[0].key === "c");
c("one open item with that amount is likely", m[2].state === "likely" && m[2].candidates[0].key === "d");
c("the same item is not suggested twice", m[3].candidates.every(x => x.key !== "b" && x.key !== "c"));
c("no amount match: no suggestion", m[4].state === "none" && !m[4].candidates.length);
c("a line already recorded is skipped", R.match([{ date: "2026-10-05", amount: 28000, text: "REF X1" }], open, [{ date: "2026-10-05", amount: 28000, reference: "x1" }])[0].state === "recorded");
const app = read("js/app.js");
c("Record opens the normal payment form, filled in (nothing is saved by the matcher)", /pmsPayPrefill = \{ lease_id: c\.leaseId, month: c\.month, amount: c\.gross, charge_id: c\.chargeId \|\| "", date: m\.line\.date, method: method, reference: ref,/.test(app) && /openPaymentEditor\(null\);/.test(app));
c("a company tenant's cash (rent less tax) is what gets matched", /amount: wht > 0 \? Math\.round\(\(m\.balance - PL\(\)\.withholding\(m\.balance, wht\)\) \* 100\) \/ 100 : m\.balance/.test(app));
c("meter: amount = (this - previous) x rate, readings kept", /const units = Math\.round\(\(to - from\) \* 100\) \/ 100;/.test(app) && /meter \? \{ meterFrom: meter\.from, meterTo: meter\.to, rate: meter\.rate \} : \{\}/.test(app));
c("work orders: quote, repeat, finish date", /quote: C\.num\(\(\$\("#pms-maint-quote"\)/.test(app) && /repeatMonths: C\.num/.test(app) && /data\.completedAt = pmsToday\(\)/.test(app));
c("a repeat is added once, when the job is first finished", /if \(nowDone && !wasDone && data\.repeatMonths > 0 && !\(prev && prev\.nextCreated\)\)/.test(app));
c("the matcher module is loaded and cached", /<script src="js\/pms_reconcile\.js" defer><\/script>/.test(read("index.html")) && /"\.\/js\/pms_reconcile\.js"/.test(read("sw.js")));
c("phase 13 browser test is in CI", /-Test phase13_app_e2e/.test(read(".github/workflows/tests.yml")));
const failed = checks.filter(x => !x.ok);
checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : " :: " + x.detail)));
console.log(failed.length ? failed.length + " FAILED" : "ALL PASS");
process.exit(failed.length ? 1 : 0);
