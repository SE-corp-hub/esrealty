/* Bank and GCash statement matching for Property Management (backend roadmap I2). Pure; the
 * browser gets window.ESPMSRECON, Node gets module.exports (tests/phase13_node.js).
 *
 * A statement exported as CSV (date, amount, description or reference) is read into money-in lines.
 * Each line is compared with what tenants owe (unpaid rent months and charges, from the ledger):
 *   - the amount must match what is owed for that month or charge, to the centavo;
 *   - a tenant name, unit or reference in the description makes the match "sure";
 *   - otherwise one open item with exactly that amount is "likely"; several are "check".
 * Nothing is recorded here: the app shows the suggestions and records only what a person accepts.
 * Lines already recorded (same date, amount and reference on an existing payment) are skipped. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ESPMSRECON = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // "1,234.50", "PHP 1,234.50", "(500.00)" or "-500" for money out.
  function num(v) {
    var s = String(v == null ? "" : v).trim();
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s);
    s = s.replace(/[^\d.]/g, "");
    var n = Number(s);
    return s !== "" && isFinite(n) ? (neg ? -n : n) : 0;
  }
  function cents(v) { return Math.round(v * 100) / 100; }
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // Dates as banks write them: 2026-10-05, 10/05/2026 (month first, as PH banks export), 05 Oct 2026, Oct 5, 2026.
  function date(v) {
    var s = String(v == null ? "" : v).trim(), m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]);
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s))) { var y = +m[3]; if (y < 100) y += 2000; return y + "-" + pad(+m[1]) + "-" + pad(+m[2]); }
    if ((m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{4})/.exec(s)) && MONTHS[m[2].toLowerCase()]) return m[3] + "-" + pad(MONTHS[m[2].toLowerCase()]) + "-" + pad(+m[1]);
    if ((m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s)) && MONTHS[m[1].toLowerCase()]) return m[3] + "-" + pad(MONTHS[m[1].toLowerCase()]) + "-" + pad(+m[2]);
    return "";
  }

  var HEAD = {
    date: ["date", "transaction date", "posting date", "value date", "trans date", "date and time", "datetime"],
    amount: ["amount", "credit", "credits", "deposit", "deposits", "money in", "credit amount", "amount (php)"],
    debit: ["debit", "debits", "withdrawal", "withdrawals", "money out"],
    text: ["description", "details", "particulars", "remarks", "reference", "reference no.", "reference number", "ref no", "narrative", "memo", "transaction details"]
  };
  function headerMap(header) {
    var map = {};
    (header || []).forEach(function (h, i) {
      var k = String(h || "").trim().toLowerCase();
      Object.keys(HEAD).forEach(function (f) {
        if (HEAD[f].indexOf(k) !== -1 && (f === "text" ? true : map[f] == null)) {
          if (f === "text") (map.text = map.text || []).push(i); else map[f] = i;
        }
      });
    });
    return map;
  }

  // rows: parsed CSV rows (first row = header). Returns money-in lines.
  function lines(rows) {
    if (!rows || rows.length < 2) return { lines: [], problem: "The file has no rows under the header." };
    var map = headerMap(rows[0]);
    if (map.date == null || map.amount == null) return { lines: [], problem: "Could not find the Date and Amount (or Credit) columns." };
    var out = [];
    rows.slice(1).forEach(function (r, i) {
      var amt = num(r[map.amount]);
      if (map.debit != null && num(r[map.debit]) > 0 && !(amt > 0)) return;
      if (!(amt > 0)) return; // money out, or empty
      var d = date(r[map.date]);
      if (!d) return;
      out.push({ row: i + 2, date: d, amount: cents(amt), text: (map.text || []).map(function (j) { return String(r[j] || "").trim(); }).filter(Boolean).join(" | ") });
    });
    return { lines: out, problem: out.length ? "" : "No money-in lines were found." };
  }

  function words(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(function (w) { return w.length >= 3; }); }
  // open: [{ key, leaseId, tenantName, unit, label, month, chargeId, amount, due }]
  // paid: existing payments [{ date, amount, reference }]
  function match(bankLines, open, paid) {
    var used = {};
    return (bankLines || []).map(function (ln) {
      var low = String(ln.text || "").toLowerCase();
      var already = (paid || []).some(function (p) {
        return String(p.date || "").slice(0, 10) === ln.date && cents(num(p.amount)) === ln.amount &&
          (!p.reference || low.indexOf(String(p.reference).trim().toLowerCase()) !== -1);
      });
      if (already) return { line: ln, state: "recorded", candidates: [] };
      var text = " " + String(ln.text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).join(" ") + " ";
      var cands = (open || []).filter(function (o) { return !used[o.key] && cents(o.amount) === ln.amount; }).map(function (o) {
        var nameHit = words(o.tenantName).filter(function (w) { return text.indexOf(" " + w + " ") !== -1; }).length;
        var unitHit = o.unit && text.indexOf(" " + String(o.unit).toLowerCase() + " ") !== -1 ? 1 : 0;
        var days = Math.abs((Date.parse(ln.date) - Date.parse(o.due || ln.date)) / 86400000) || 0;
        return { item: o, score: nameHit * 10 + unitHit * 5 - Math.min(days, 60) / 10, named: nameHit > 0 || unitHit > 0 };
      }).sort(function (a, b) { return b.score - a.score; });
      // Several open months of the same named tenant: the oldest is paid first (as the ledger does).
      var named = cands.filter(function (c) { return c.named; });
      if (named.length > 1 && named.every(function (c) { return c.item.leaseId && c.item.leaseId === named[0].item.leaseId; })) {
        named.sort(function (a, b) { return String(a.item.due || "").localeCompare(String(b.item.due || "")); });
        cands = named.concat(cands.filter(function (c) { return !c.named; }));
        named = [named[0]];
      }
      var best = cands[0];
      var state = !best ? "none" : best.named && named.length === 1 ? "sure" : cands.length === 1 ? "likely" : "check";
      if (best && state !== "check") used[best.item.key] = 1;
      return { line: ln, state: state, candidates: cands.slice(0, 5).map(function (c) { return c.item; }) };
    });
  }

  return { lines: lines, match: match, headerMap: headerMap, date: date, num: num };
});
