/* Phase 5 (2026-10-21): lease renewal reminders (I3), real .xlsx exports (J7), announcements (K8). */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const R = require("../tools/rent_reminders.js");
const X = require("../js/xlsx_lite.js");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });

// ---- I3 renewals
const today = "2026-10-21";
const plus = n => new Date(Date.parse(today + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const data = {
  tenants: [{ id: "t1", name: "Tina", authUserId: "u-t1" }, { id: "t2", name: "Ted" }, { id: "t3", name: "Tom", authUserId: "u-t3" }],
  properties: [{ id: "p1", title: "House A" }], units: [{ id: "u1", unit_number: "1A" }, { id: "u2", unit_number: "2B" }],
  leases: [
    { id: "l1", tenant_id: "t1", property_id: "p1", unit_id: "u1", start: "2025-12-20", end: plus(60), book_id: "b1" },
    { id: "l2", tenant_id: "t2", property_id: "p1", unit_id: "u2", start: "2025-11-20", end: plus(30), book_id: "b1" },
    { id: "l3", tenant_id: "t3", property_id: "p1", unit_id: "u1", start: "2025-10-28", end: plus(7), book_id: "b2" },
    { id: "l4", tenant_id: "t1", property_id: "p1", unit_id: "u1", start: "2025-01-01", end: plus(45), book_id: "b1" },
    { id: "l5", tenant_id: "t3", property_id: "p1", unit_id: "u2", start: "2025-01-01", end: plus(60), status: "terminated", book_id: "b2" },
    { id: "l6", tenant_id: "t2", property_id: "p1", unit_id: "u1", start: "2025-01-01", end: plus(30), book_id: "b1" },
    { id: "l7", tenant_id: "t2", property_id: "p1", unit_id: "u1", start: plus(31), end: plus(400), book_id: "b1" }
  ]
};
const r = R.renewalPlan(data, today);
c("reminders at 60, 30 and 7 days", JSON.stringify(R.RENEWAL_DAYS) === "[60,30,7]");
c("tenants with a login hear at 60 and 30 days, not at 7", r.toTenants.length === 1 && r.toTenants[0].user_id === "u-t1" && /ends Dec 20 \(60 days\)/.test(r.toTenants[0].title), JSON.stringify(r.toTenants));
c("a tenant without a login gets nothing (the manager hears)", !r.toTenants.some(n => n.user_id === undefined));
const b1 = r.summaries.find(s => s.book === "b1"), b2 = r.summaries.find(s => s.book === "b2");
c("one manager summary per book, soonest first", !!b1 && !!b2 && /Leases ending \(Oct 21\): 2 leases/.test(b1.title) && /^Ted at House A 2B: ends Nov 20 \(30 days\); Tina/.test(b1.body), b1 && b1.body);
c("7 days before: the manager still hears", /Tom at House A 1A: ends Oct 28 \(7 days\)/.test(b2.body), b2 && b2.body);
c("other days, terminated leases and leases already renewed are skipped", !/45 days/.test(b1.body) && !/2B: ends Dec 20/.test(b2.body) && (b1.body.match(/Ted/g) || []).length === 1, b1.body + " || " + b2.body);
const wf = read(".github/workflows/rent-reminders.yml");
c("renewals ride on the rent reminder switch (RENT_REMINDERS)", /node tools\/rent_reminders\.js --send/.test(wf) && /renewalPlan\(data, today\)/.test(read("tools/rent_reminders.js")));

// ---- J7 xlsx: unzip the result and check it
const bytes = X.build([{ name: "Loan: Terms/1", headers: ["Term", "Value"], rows: [["Rate", 7.5], ["Note", 'a <b> & "c" =SUM(A1)'], ["Bad\u0001char", ""]] }, { name: "Loan  Terms 1", headers: ["M"], rows: [[1]] }]);
const buf = Buffer.from(bytes);
const files = {};
let p = 0;
while (buf.readUInt32LE(p) === 0x04034b50) {
  const method = buf.readUInt16LE(p + 8), crc = buf.readUInt32LE(p + 14), size = buf.readUInt32LE(p + 18), nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28);
  const name = buf.slice(p + 30, p + 30 + nlen).toString("utf8"), data2 = buf.slice(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
  files[name] = { method, crcOk: X.crc32(data2) === crc, text: data2.toString("utf8") };
  p += 30 + nlen + xlen + size;
}
c("a zip with the parts Excel needs", ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"].every(n => files[n]), Object.keys(files).join());
c("every part's checksum is right", Object.values(files).every(f => f.crcOk && f.method === 0));
c("the central directory closes the file", buf.readUInt32LE(buf.length - 22) === 0x06054b50 && buf.readUInt16LE(buf.length - 12) === 7);
const s1 = files["xl/worksheets/sheet1.xml"].text;
c("numbers stay numbers", /<c r="B2"><v>7\.5<\/v><\/c>/.test(s1), s1.slice(0, 300));
c("text is escaped and never a formula", /a &lt;b&gt; &amp; &quot;c&quot; =SUM\(A1\)/.test(s1) && !/<f>/.test(s1));
c("control characters are dropped (they make Excel refuse the file)", /Badchar/.test(s1));
c("header row is bold", /<c r="A1" t="inlineStr" s="1">/.test(s1));
c("sheet names are cleaned and made unique", /name="Loan  Terms 1"/.test(files["xl/workbook.xml"].text) && /name="Loan  Terms 1 \(2\)"/.test(files["xl/workbook.xml"].text));
c("column letters past Z", X.col(0) === "A" && X.col(25) === "Z" && X.col(26) === "AA" && X.col(701) === "ZZ" && X.col(702) === "AAA");
c("crc32 matches zlib", X.crc32(Buffer.from("hello")) === zlib.crc32?.(Buffer.from("hello")) || X.crc32(Buffer.from("hello")) === 0x3610a686);
const app = read("js/app.js");
c("exports now save .xlsx", /a\.download = String\(filename\)\.replace\(\/\\\.xls\$\/i, ""\) \+ "\.xlsx";/.test(app));
c("the script is loaded and cached", /js\/xlsx_lite\.js/.test(read("index.html")) && /"\.\/js\/xlsx_lite\.js"/.test(read("sw.js")));

// ---- K8
const m7 = read("supabase/migrations/0007_announcements.sql");
c("announcements: Super Admin only, limited, logged", /is_super_admin\(\)/.test(m7) && /interval '1 minute'/.test(m7) && /'announcement_sent'/.test(m7) && /revoke all on function public\.admin_announce/.test(m7));
c("the app calls it with title, message and roles", /SB\.rpc\("admin_announce", \{ p_title: title, p_body: body, p_roles: roles \}\)/.test(app));
c("the health check knows it as waiting for 0007", /fn: "admin_announce"[^}]*pending: "0007"/.test(read("supabase/check-backend.js")));

(async () => {
  const lines = [];
  const rows = t => (data[{ pms_leases: "leases", pms_payments: "payments", pms_tenants: "tenants", pms_properties: "properties", pms_units: "units" }[(/from public\.(\w+)/.exec(t) || [])[1]]] || []).map(x => ({ id: x.id, archived: false, data: x, book_id: x.book_id, auth_user_id: x.authUserId }));
  process.env.REMINDERS_TODAY = today;
  await R.main([], async sql => rows(sql), l => lines.push(l));
  const log = lines.join("\n");
  c("the dry-run log counts renewals without names", /Lease renewals: 1 tenant notes, 2 manager summaries/.test(log) && !/Tina|Ted|Tom|House A/.test(log), log);
  finish();
})();
function finish() {
const ok = checks.every(x => x.ok) && checks.length >= 22;
console.log("\n[phase5_node] " + checks.length + " checks");
checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : "  " + x.detail)));
console.log(ok ? "ALL PASS" : "FAILURES PRESENT");
process.exit(ok ? 0 : 1);
}
