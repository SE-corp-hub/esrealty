/* Phase 11: commission engine (J1), payout approvals and statements (J2): js/commission.js. */
const fs = require("fs");
const path = require("path");
const K = require("../js/commission.js");
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });

const d = K.splitFor({ price: 5000000, agentName: "Ana" }, {});
c("default: 3% gross, no referrer so the broker keeps the referral share", d.gross === 150000 && d.agent === 75000 && d.broker === 75000 && d.referral === 0 && d.parts[0].pct === 50, JSON.stringify(d.parts));
const r = K.splitFor({ price: 5000000, agentName: "Ana", referralName: "Ben" }, {});
c("with a referrer: 40 / 50 / 10", r.broker === 60000 && r.agent === 75000 && r.referral === 15000);
const cb = K.splitFor({ price: 5000000, agentName: "Ana", referralName: "Ben", commission: { cobrokeName: "XYZ", cobrokePct: 50 } }, { withholdingPct: 10 });
c("co-broke comes off the top, then the split", cb.cobroke === 75000 && cb.pool === 75000 && cb.broker === 30000 && cb.agent === 37500 && cb.referral === 7500);
c("withholding is taken from people, not the house", cb.parts.find(p => p.role === "agent").withheld === 3750 && cb.parts.find(p => p.role === "agent").net === 33750 && cb.parts.find(p => p.role === "broker").withheld === 0 && cb.parts.find(p => p.role === "cobroke").net === 67500);
c("the parts always add up to the gross", [d, r, cb, K.splitFor({ price: 3333333, referralName: "x" }, { grossPct: 3 })].every(s => Math.abs(s.parts.reduce((a, p) => a + p.amount, 0) - s.gross) < 0.001));
c("a deal's own rate wins over the default", K.splitFor({ price: 1000000, commission: { grossPct: 5 } }, {}).gross === 50000);
c("shares must add to 100", K.checkShares({ grossPct: 3, brokerShare: 40, agentShare: 60, referralShare: 10, withholdingPct: 0 })[0] === "Broker, agent and referral shares add up to 110%, not 100%");
c("a bad split is flagged, not silently used", !K.splitFor({ price: 1, commission: { agentShare: 90 } }, {}).ok);
c("withholding is not assumed: none until set", K.settingsOf({}).withholdingPct === 0 && d.parts.every(p => p.withheld === 0));
// payouts
let p = K.moveTo({ transactionId: "t", status: "pending" }, "approved", "Boss", "2026-10-01T00:00:00Z");
c("approve records who and when", p.status === "approved" && p.approvedBy === "Boss" && p.approvedAt === "2026-10-01T00:00:00Z");
p = K.moveTo(p, "paid", "Boss", "2026-10-02T00:00:00Z");
c("then paid, with a history of both steps", p.status === "paid" && p.paidAt && p.history.length === 2);
let err = ""; try { K.moveTo({ status: "pending" }, "paid"); } catch (e) { err = e.message; }
c("paying before approval is refused", err === "Approve the payout before marking it paid");
const back = K.moveTo(K.moveTo({ status: "pending" }, "approved", "A"), "pending", "A");
c("back to pending clears the approval", back.status === "pending" && !back.approvedBy);
// statements
const deals = [
  { id: "1", stage: "doas", doasDate: "2026-10-05", price: 5000000, agentName: "Ana", referralName: "Ben", title: "House" },
  { id: "2", stage: "done", completedDate: "2026-10-20", price: 2000000, agentName: "ana ", title: "Lot" },
  { id: "3", stage: "doas", doasDate: "2026-09-30", price: 9000000, agentName: "Ana", title: "Old" },
  { id: "4", stage: "cts", price: 9000000, agentName: "Ana", title: "Open" }
];
const st = K.statement(deals, { withholdingPct: 10 }, "Ana", "2026-10");
c("statement: only that month's closed deals, matched by name", st.rows.map(x => x.transactionId).join() === "1,2", JSON.stringify(st.rows));
c("statement totals: share, withholding, net", st.amount === 105000 && st.withheld === 10500 && st.net === 94500, JSON.stringify(st));
c("people paid in a month, each once whatever the spelling", K.peopleIn(deals, {}, "2026-10").join() === "Ana,Ben", K.peopleIn(deals, {}, "2026-10").join());
// app wiring
const app = read("js/app.js");
c("settings refuse shares that do not add to 100", /const problems = COMX\(\) \? COMX\(\)\.checkShares\(next\) : \[\];\s+if \(problems\.length\) \{ toast\(problems\[0\], "err"\); return; \}/.test(app));
c("payout buttons follow pending, approved, paid", /st === "pending" \? b\("approved", "Approve", "btn-primary"\) : st === "approved" \? b\("paid", "Mark paid", "btn-primary"\)/.test(app));
c("a deal's split is saved on the deal (synced with the deal)", /t\.commission = o;/.test(app) && /await persistTransactionToCloud\(t\)/.test(app));
c("the module is loaded and cached", /<script src="js\/commission\.js" defer><\/script>/.test(read("index.html")) && /"\.\/js\/commission\.js"/.test(read("sw.js")));
c("phase 11 browser test is in CI", /-Test phase11_app_e2e/.test(read(".github/workflows/tests.yml")));

const failed = checks.filter(x => !x.ok);
checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : " :: " + x.detail)));
console.log(failed.length ? failed.length + " FAILED" : "ALL PASS");
process.exit(failed.length ? 1 : 0);
