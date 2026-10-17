(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.ESPMSLEDGER = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Rent ledger for Property Management. One place decides what a tenant owes:
   *  - a month is billed when its due date falls on or after the lease start
   *    and on or before the lease end (or termination date);
   *  - money received (status "paid") goes first to the month it names, and
   *    anything left over, or unlabelled, pays the oldest unpaid month next;
   *  - dates are calendar dates ("YYYY-MM-DD"), compared as text, so the
   *    phone's time zone can never move a due date.
   * Pure and dependency-free; tested in tests/pms_ledger_node.js. */

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }
  function num(v) { var n = Number(String(v == null ? "" : v).replace(/,/g, "")); return isFinite(n) ? n : 0; }
  function dateOnly(v) {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number") { var d = new Date(v); return isNaN(d.getTime()) ? "" : today(d); }
    var s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
  }
  function today(d) {
    d = d || new Date();
    return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  function daysBetween(a, b) {
    var pa = a.split("-"), pb = b.split("-");
    return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
  }

  function monthKey(v) {
    if (v instanceof Date) return v.getFullYear() + "-" + pad(v.getMonth() + 1);
    var s = String(v == null ? "" : v).trim();
    var m = /^(\d{4})-(\d{2})/.exec(s);
    if (m) return m[1] + "-" + m[2];
    m = /^([A-Za-z]+)\.?\s+(\d{4})$/.exec(s);
    if (m) {
      var name = m[1].toLowerCase();
      for (var i = 0; i < 12; i++) {
        if (MONTHS[i].toLowerCase() === name || MONTHS[i].slice(0, 3).toLowerCase() === name.slice(0, 3) && name.length >= 3) return m[2] + "-" + pad(i + 1);
      }
    }
    return "";
  }
  function monthLabel(key) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(key || ""));
    return m ? MONTHS[+m[2] - 1] + " " + m[1] : String(key || "");
  }

  function dueDay(lease) {
    var v = lease ? lease.due_day : "";
    if (v === "wlast") return 25;
    if (v === "w2") return 10;
    var n = Math.floor(num(v));
    return n > 0 ? Math.min(28, Math.max(1, n)) : 10;
  }

  // The last day the lease bills: its end date, or the termination date.
  function endLimit(lease) {
    var end = dateOnly(lease.end);
    if (lease.status === "terminated") {
      var t = dateOnly(lease.terminated_on) || dateOnly(lease.updatedAt);
      if (t && (!end || t < end)) return t;
    }
    return end;
  }

  function leaseMonths(lease, asOf) {
    var start = dateOnly(lease.start) || (asOf ? asOf.slice(0, 8) + "01" : "");
    if (!start) return [];
    var rent = num(lease.rent);
    if (lease.rent_type === "lease") return [{ key: monthKey(start), due: start, amount: rent }];
    var end = endLimit(lease);
    // Open-ended lease: bill up to the month after today.
    var stop = end || (asOf ? (function () { var p = asOf.split("-"), y = +p[0], m = +p[1] + 1; if (m > 12) { m = 1; y++; } return ymd(y, m, 28); })() : start);
    var dd = dueDay(lease), out = [];
    var y = +start.slice(0, 4), m = +start.slice(5, 7);
    for (var guard = 0; guard < 600; guard++) {
      var due = ymd(y, m, dd);
      if (due > stop) break;
      if (due >= start) out.push({ key: y + "-" + pad(m), due: due, amount: rent });
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  function received(lease, payments) {
    return (payments || []).filter(function (p) {
      return p && !p.archived && p.lease_id === lease.id && p.status === "paid" && num(p.amount) > 0;
    });
  }

  function ledger(lease, payments, asOf) {
    asOf = asOf || today();
    var months = leaseMonths(lease, asOf).map(function (m) { return { key: m.key, label: monthLabel(m.key), due: m.due, amount: m.amount, paid: 0 }; });
    var byKey = {};
    months.forEach(function (m) { byKey[m.key] = m; });
    var pool = 0, paidTotal = 0;
    received(lease, payments).forEach(function (p) {
      var amt = num(p.amount);
      paidTotal += amt;
      var target = lease.rent_type === "lease" ? months[0] : byKey[monthKey(p.month)];
      if (target) {
        var use = Math.min(amt, Math.max(0, target.amount - target.paid));
        target.paid += use;
        amt -= use;
      }
      pool += amt;
    });
    months.forEach(function (m) {
      if (pool <= 0) return;
      var use = Math.min(pool, Math.max(0, m.amount - m.paid));
      m.paid += use;
      pool -= use;
    });
    var thisMonth = asOf.slice(0, 7);
    var overdue = 0, dueToDate = 0, restOfTerm = 0;
    months.forEach(function (m) {
      m.balance = Math.max(0, m.amount - m.paid);
      if (m.balance <= 0) m.status = "paid";
      else if (m.paid > 0) m.status = "partial";
      else if (m.due < asOf) m.status = "overdue";
      else if (m.due === asOf || m.key === thisMonth) m.status = "due";
      else m.status = "upcoming";
      if (m.due < asOf) overdue += m.balance;
      if (m.due <= asOf) dueToDate += m.balance; else restOfTerm += m.balance;
    });
    var owing = months.filter(function (m) { return m.balance > 0 && m.due <= asOf; })[0];
    var next = months.filter(function (m) { return m.balance > 0 && m.due > asOf; })[0];
    var current;
    if (owing) current = { state: owing.due < asOf ? "overdue" : "due", month: owing.key, nextDue: owing.due };
    else if (next && !months.some(function (m) { return m.due <= asOf; }) && (dateOnly(lease.start) || "") > asOf) current = { state: "upcoming", month: next.key, nextDue: next.due };
    else if (next) current = { state: next.key === thisMonth ? "due" : "paid", month: next.key, nextDue: next.due };
    else current = { state: months.length ? "paid" : "none", month: "", nextDue: "" };
    return { months: months, paidTotal: paidTotal, credit: pool, overdue: overdue, dueToDate: dueToDate, restOfTerm: restOfTerm, current: current };
  }

  function leaseStatus(lease, asOf) {
    asOf = asOf || today();
    if (!lease) return "active";
    if (lease.status === "terminated") return "terminated";
    var start = dateOnly(lease.start), end = dateOnly(lease.end);
    if (start && start > asOf) return "upcoming";
    if (end && end < asOf) return "expired";
    if (end && daysBetween(asOf, end) <= 30) return "expiring";
    return "active";
  }

  // Whether the lease puts someone in the unit on that date.
  function coversDate(lease, date) {
    if (!lease || lease.archived) return false;
    date = date || today();
    var start = dateOnly(lease.start), end = endLimit(lease);
    if (lease.status === "terminated" && !end) return false;
    return (!start || start <= date) && (!end || date <= end);
  }

  function leaseMonthKeys(lease) {
    return leaseMonths(lease, today()).map(function (m) { return m.key; });
  }

  return {
    MONTHS: MONTHS, today: today, monthKey: monthKey, monthLabel: monthLabel, dueDay: dueDay,
    ledger: ledger, leaseStatus: leaseStatus, coversDate: coversDate, leaseMonthKeys: leaseMonthKeys,
    endLimit: endLimit
  };
});
