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

  // Rent received: paid payments of the lease, except those for a charge
  // (water, electricity, dues...), which are kept apart (chargeStatus).
  function received(lease, payments) {
    return (payments || []).filter(function (p) {
      return p && !p.archived && p.lease_id === lease.id && p.status === "paid" && num(p.amount) > 0 && !p.charge_id;
    });
  }

  /* Utilities and other charges, kept on the lease (lease.charges): each has an
   * amount and a due date and is paid by payments that name it (charge_id). */
  function chargeStatus(lease, payments, asOf) {
    asOf = asOf || today();
    var paidBy = {};
    (payments || []).forEach(function (p) {
      if (!p || p.archived || p.status !== "paid" || !p.charge_id || (lease && p.lease_id !== lease.id)) return;
      paidBy[p.charge_id] = (paidBy[p.charge_id] || 0) + num(p.amount);
    });
    return ((lease && lease.charges) || []).filter(function (c) { return c && !c.archived; }).map(function (c) {
      var amount = num(c.amount), paid = Math.min(amount, paidBy[c.id] || 0), balance = Math.max(0, amount - paid);
      var due = dateOnly(c.due);
      var status = balance <= 0 ? "paid" : paid > 0 ? "partial" : due && due < asOf ? "overdue" : "due";
      return { id: c.id, type: c.type || "Other", label: chargeLabel(c), amount: amount, paid: paid, balance: balance, due: due, period: monthKey(c.period), status: status, note: c.note || "" };
    }).sort(function (a, b) { return String(a.due).localeCompare(String(b.due)); });
  }
  function chargeLabel(c) {
    var k = monthKey(c && c.period);
    return ((c && (c.label || c.type)) || "Charge") + (k ? " \u00B7 " + monthLabel(k) : "");
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

  // When rent for a month was due: the lease start for a one-off lease total,
  // otherwise the due day of that month.
  function dueDateFor(lease, key) {
    if (!lease) return "";
    if (lease.rent_type === "lease") return dateOnly(lease.start);
    var k = monthKey(key);
    return k ? k + "-" + pad(dueDay(lease)) : "";
  }
  // How many days after its due date a payment came in (0 when on time).
  function daysLate(lease, payment) {
    if (!payment || payment.status !== "paid") return 0;
    var due = dueDateFor(lease, payment.month), paid = dateOnly(payment.date);
    return due && paid && paid > due ? daysBetween(due, paid) : 0;
  }

  /* Acknowledgement receipt numbers: AR-<year>-<0001>, one series per book and
   * year. In the cloud the database hands them out (supabase/migrations/0001);
   * this is for the demo and the old single-record store. */
  function receiptNo(year, n) { return "AR-" + year + "-" + (n < 1000 ? ("000" + n).slice(-4) : String(n)); }
  function nextReceiptNo(payments, year) {
    var top = 0, re = new RegExp("^AR-" + year + "-(\\d+)$");
    (payments || []).forEach(function (p) {
      var m = p && re.exec(String(p.receipt_no || ""));
      if (m && +m[1] > top) top = +m[1];
    });
    return receiptNo(year, top + 1);
  }

  // "Fifteen Thousand Five Hundred Pesos and 50/100", as written on receipts.
  var ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  var TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function under1000(n) {
    var out = [];
    if (n >= 100) { out.push(ONES[Math.floor(n / 100)] + " Hundred"); n %= 100; }
    if (n >= 20) { out.push(TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "")); }
    else if (n > 0) out.push(ONES[n]);
    return out.join(" ");
  }
  function amountInWords(v) {
    var cents = Math.round(num(v) * 100);
    if (cents < 0) cents = 0;
    var whole = Math.floor(cents / 100), c = cents % 100;
    var scales = [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]], parts = [];
    scales.forEach(function (s) {
      if (whole >= s[0]) { parts.push(under1000(Math.floor(whole / s[0])) + " " + s[1]); whole %= s[0]; }
    });
    if (whole > 0) parts.push(under1000(whole));
    var words = parts.length ? parts.join(" ") : "Zero";
    return words + (Math.floor(cents / 100) === 1 ? " Peso" : " Pesos") + (c ? " and " + (c < 10 ? "0" : "") + c + "/100" : " Only");
  }

  /* Security deposits. A lease records the deposit taken; when the tenant
   * moves out it is settled: part returned, part kept (unpaid rent, damage).
   * Until then it is money held for the tenant. */
  function depositHeld(lease, asOf) {
    if (!lease || lease.archived) return 0;
    asOf = asOf || today();
    var dep = num(lease.deposit), start = dateOnly(lease.start), settled = dateOnly(lease.deposit_settled_on);
    if (dep <= 0 || (start && start > asOf) || (settled && settled <= asOf)) return 0;
    return dep;
  }
  // RA 9653 (Rent Control Act), section 7: for covered residential units the
  // lessor may ask at most one month's advance rent and two months' deposit.
  // A gentle note only; whether a unit is covered depends on its rent.
  function depositNote(lease) {
    var rent = num(lease && lease.rent), dep = num(lease && lease.deposit);
    if (!lease || lease.rent_type === "lease" || rent <= 0 || dep <= 2 * rent) return "";
    return "The deposit is more than two months' rent. Under the Rent Control Act (RA 9653) a covered residential unit may ask for at most two months' deposit and one month's advance.";
  }

  /* Owner statement for one calendar month, on money actually received and
   * spent in that month: rent marked paid (by payment date), expenses dated in
   * the month, repairs finished in the month; plus rent still unpaid and
   * deposits held at month end. data: {leases, payments, expenses, maintenance}. */
  function lastDayOf(key) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7);
    return ymd(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
  }
  function monthStatement(data, propIds, key) {
    key = monthKey(key);
    var end = lastDayOf(key), ids = {};
    (propIds || []).forEach(function (id) { ids[id] = true; });
    var leases = (data.leases || []).filter(function (l) { return l && !l.archived && ids[l.property_id]; });
    var leaseProp = {};
    (data.leases || []).forEach(function (l) { if (l) leaseProp[l.id] = l.property_id; });
    var propOf = function (p) { return leaseProp[p.lease_id] || p.property_id; };
    var inMonth = function (d) { return dateOnly(d).slice(0, 7) === key; };
    var rows = {};
    var row = function (id) { return rows[id] || (rows[id] = { property_id: id, collected: 0, charges: 0, expenses: 0, repairs: 0, unpaid: 0, deposits: 0, payments: [], spending: [] }); };
    (propIds || []).forEach(row);
    (data.payments || []).forEach(function (p) {
      if (!p || p.archived || p.status !== "paid" || !ids[propOf(p)] || !inMonth(p.date)) return;
      var r = row(propOf(p));
      if (p.charge_id) r.charges += num(p.amount); else r.collected += num(p.amount);
      r.payments.push(p);
    });
    (data.expenses || []).forEach(function (e) {
      if (!e || e.archived || !ids[e.property_id] || !inMonth(e.date)) return;
      var r = row(e.property_id); r.expenses += num(e.amount); r.spending.push({ date: dateOnly(e.date), what: e.category || "Expense", note: e.description || "", amount: num(e.amount) });
    });
    (data.maintenance || []).forEach(function (m) {
      if (!m || m.archived || m.status !== "completed" || !ids[m.property_id] || !inMonth(m.date)) return;
      var r = row(m.property_id); r.repairs += num(m.cost); r.spending.push({ date: dateOnly(m.date), what: "Repair", note: m.title || "", amount: num(m.cost) });
    });
    var paidBy = (data.payments || []).filter(function (p) { return p && dateOnly(p.date) && dateOnly(p.date) <= end; });
    leases.forEach(function (l) {
      var r = row(l.property_id);
      r.unpaid += ledger(l, paidBy, end).dueToDate;
      chargeStatus(l, paidBy, end).forEach(function (c) { if (c.due && c.due <= end) r.unpaid += c.balance; });
      r.deposits += depositHeld(l, end);
    });
    // Net counts charges collected too: the matching bill is usually an expense.
    var list = Object.keys(rows).map(function (id) { var r = rows[id]; r.net = r.collected + r.charges - r.expenses - r.repairs; return r; });
    var total = list.reduce(function (t, r) {
      ["collected", "charges", "expenses", "repairs", "net", "unpaid", "deposits"].forEach(function (k) { t[k] += r[k]; });
      return t;
    }, { collected: 0, charges: 0, expenses: 0, repairs: 0, net: 0, unpaid: 0, deposits: 0 });
    return { month: key, label: monthLabel(key), end: end, rows: list, total: total };
  }

  function leaseMonthKeys(lease) {
    return leaseMonths(lease, today()).map(function (m) { return m.key; });
  }

  return {
    MONTHS: MONTHS, today: today, monthKey: monthKey, monthLabel: monthLabel, dueDay: dueDay,
    ledger: ledger, leaseStatus: leaseStatus, coversDate: coversDate, leaseMonthKeys: leaseMonthKeys,
    endLimit: endLimit, daysBetween: daysBetween, dueDateFor: dueDateFor, daysLate: daysLate,
    receiptNo: receiptNo, nextReceiptNo: nextReceiptNo, amountInWords: amountInWords,
    depositHeld: depositHeld, depositNote: depositNote, monthStatement: monthStatement, lastDayOf: lastDayOf,
    chargeStatus: chargeStatus, chargeLabel: chargeLabel
  };
});
