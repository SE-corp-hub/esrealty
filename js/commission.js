/* Commission engine (backend roadmap J1, J2). Pure and dependency-free; the browser gets
 * window.ESREALTY_COMMISSION, Node gets module.exports (tests/phase11_node.js).
 *
 * How a deal's commission is worked out:
 *  1. Gross = sale price x gross %. The % is the deal's own (set on the deal) or the default.
 *  2. A co-broke partner's share, if the deal has one, comes off the top of the gross.
 *  3. The rest is split between the broker (the house), the handling agent and a referrer.
 *     The three shares must add up to 100. With no referrer on the deal, the referral share
 *     goes to the broker.
 *  4. Withholding tax is taken from what is paid to people (agent, referrer, co-broke partner)
 *     at the rate set in the commission settings; the broker's share is the firm's own income.
 *     The rate is not assumed: it is 0 until set (ask your accountant which rate applies).
 * Amounts are rounded to the centavo, and any rounding difference stays with the broker, so the
 * parts always add up to the gross. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ESREALTY_COMMISSION = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULTS = { grossPct: 3, brokerShare: 40, agentShare: 50, referralShare: 10, withholdingPct: 0 };

  function num(v) { var n = Number(String(v == null ? "" : v).replace(/,/g, "")); return isFinite(n) ? n : 0; }
  function cents(v) { return Math.round(num(v) * 100) / 100; }
  function pctOk(v) { var n = num(v); return n >= 0 && n <= 100; }

  function settingsOf(s) {
    s = s || {};
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = s[k] === undefined || s[k] === "" || s[k] === null ? DEFAULTS[k] : num(s[k]); });
    return out;
  }

  // Problems with a set of shares; empty when it can be used.
  function checkShares(s) {
    var p = [];
    if (!pctOk(s.grossPct) || num(s.grossPct) > 20) p.push("Gross commission must be between 0 and 20%");
    ["brokerShare", "agentShare", "referralShare"].forEach(function (k) { if (!pctOk(s[k])) p.push("Each share must be between 0 and 100%"); });
    var total = cents(num(s.brokerShare) + num(s.agentShare) + num(s.referralShare));
    if (total !== 100) p.push("Broker, agent and referral shares add up to " + total + "%, not 100%");
    if (!pctOk(s.withholdingPct) || num(s.withholdingPct) > 30) p.push("Withholding tax must be between 0 and 30%");
    return p.filter(function (x, i, a) { return a.indexOf(x) === i; });
  }

  /* The split for one transaction. t: { price, agentName, referralName, commission: { grossPct,
   * brokerShare, agentShare, referralShare, cobrokeName, cobrokePct } } (all optional). */
  function splitFor(t, settings) {
    t = t || {};
    var base = settingsOf(settings);
    var own = t.commission || {};
    var s = {
      grossPct: own.grossPct !== undefined && own.grossPct !== "" ? num(own.grossPct) : base.grossPct,
      brokerShare: own.brokerShare !== undefined && own.brokerShare !== "" ? num(own.brokerShare) : base.brokerShare,
      agentShare: own.agentShare !== undefined && own.agentShare !== "" ? num(own.agentShare) : base.agentShare,
      referralShare: own.referralShare !== undefined && own.referralShare !== "" ? num(own.referralShare) : base.referralShare,
      withholdingPct: base.withholdingPct
    };
    var problems = checkShares(s);
    var cobrokePct = num(own.cobrokePct);
    if (cobrokePct < 0 || cobrokePct > 100) { problems.push("Co-broke share must be between 0 and 100%"); cobrokePct = 0; }
    var price = num(t.price);
    var gross = cents(price * s.grossPct / 100);
    var cobroke = own.cobrokeName || cobrokePct ? cents(gross * cobrokePct / 100) : 0;
    var pool = cents(gross - cobroke);
    var hasReferral = !!String(t.referralName || "").trim();
    var agent = cents(pool * s.agentShare / 100);
    var referral = hasReferral ? cents(pool * s.referralShare / 100) : 0;
    var broker = cents(pool - agent - referral); // the house keeps the rest, including rounding
    var wht = function (amt) { return cents(amt * s.withholdingPct / 100); };
    var parts = [
      { role: "broker", name: "Brokerage (house)", pct: hasReferral ? s.brokerShare : cents(s.brokerShare + s.referralShare), amount: broker, withheld: 0, net: broker }
    ];
    parts.push({ role: "agent", name: t.agentName || "Agent", pct: s.agentShare, amount: agent, withheld: wht(agent), net: cents(agent - wht(agent)) });
    if (hasReferral) parts.push({ role: "referral", name: t.referralName, pct: s.referralShare, amount: referral, withheld: wht(referral), net: cents(referral - wht(referral)) });
    if (cobroke) parts.unshift({ role: "cobroke", name: own.cobrokeName || "Co-broke partner", pct: cobrokePct, ofGross: true, amount: cobroke, withheld: wht(cobroke), net: cents(cobroke - wht(cobroke)) });
    return {
      price: price, grossPct: s.grossPct, gross: gross, cobroke: cobroke, pool: pool,
      broker: broker, agent: agent, referral: referral,
      withholdingPct: s.withholdingPct, parts: parts, custom: !!(t.commission && Object.keys(t.commission).length),
      problems: problems, ok: problems.length === 0
    };
  }

  /* Payout states: pending -> approved -> paid. Approval is recorded with who and when; paying
   * needs an approval first. Returns the updated payout, or throws with a plain message. */
  var NEXT = { pending: ["approved"], approved: ["paid", "pending"], paid: ["approved"] };
  function moveTo(payout, status, who, now) {
    payout = Object.assign({ status: "pending" }, payout || {});
    var from = payout.status || "pending";
    if ((NEXT[from] || []).indexOf(status) < 0) throw new Error(from === "pending" && status === "paid" ? "Approve the payout before marking it paid" : "Cannot go from " + from + " to " + status);
    var at = now || new Date().toISOString();
    var out = Object.assign({}, payout, { status: status });
    out.history = (payout.history || []).concat([{ at: at, by: who || "", from: from, to: status }]);
    if (status === "approved") { out.approvedBy = who || ""; out.approvedAt = at; }
    if (status === "paid") { out.paidAt = at; out.paidBy = who || ""; }
    if (status === "pending") { delete out.approvedBy; delete out.approvedAt; }
    if (from === "paid") { delete out.paidAt; delete out.paidBy; }
    return out;
  }

  /* A person's commission statement for one month: the deals closed that month where they have
   * a part, with gross, their share, withholding and net. month "YYYY-MM"; closed date is the
   * deal's doasDate, completedDate or updatedAt. */
  function closedOn(t) { return String(t.doasDate || t.completedDate || t.closedAt || t.updatedAt || "").slice(0, 10); }
  function statement(transactions, settings, person, month) {
    var rows = [];
    (transactions || []).forEach(function (t) {
      if (!t || (t.stage !== "doas" && t.stage !== "done") || closedOn(t).slice(0, 7) !== month) return;
      var sp = splitFor(t, settings);
      sp.parts.forEach(function (p) {
        if (p.role !== "broker" && String(p.name).trim().toLowerCase() === String(person || "").trim().toLowerCase()) {
          rows.push({ transactionId: t.id, title: t.title || t.ref || "", closed: closedOn(t), role: p.role, price: sp.price, gross: sp.gross, amount: p.amount, withheld: p.withheld, net: p.net });
        }
      });
    });
    var sum = function (k) { return cents(rows.reduce(function (a, r) { return a + r[k]; }, 0)); };
    return { person: person, month: month, rows: rows, amount: sum("amount"), withheld: sum("withheld"), net: sum("net") };
  }

  // Everyone with a part in deals closed in a month (for the statement picker).
  function peopleIn(transactions, settings, month) {
    var seen = {};
    (transactions || []).forEach(function (t) {
      if (!t || (t.stage !== "doas" && t.stage !== "done") || closedOn(t).slice(0, 7) !== month) return;
      splitFor(t, settings).parts.forEach(function (p) {
        var nm = String(p.name || "").trim();
        if (p.role !== "broker" && nm && !seen[nm.toLowerCase()]) seen[nm.toLowerCase()] = nm;
      });
    });
    return Object.keys(seen).map(function (k) { return seen[k]; }).sort(function (a, b) { return a.localeCompare(b); });
  }

  return { DEFAULTS: DEFAULTS, settingsOf: settingsOf, checkShares: checkShares, splitFor: splitFor, moveTo: moveTo, statement: statement, peopleIn: peopleIn, closedOn: closedOn };
});
