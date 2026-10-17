// Rent ledger for the Property Management module (js/pms_ledger.js).
// Each case is one of the bugs found on 2026-10-17 (docs: pms-analysis), run
// with "today" fixed at 2026-10-17 so the dates are stable.
"use strict";
const assert = require("assert");
const L = require("../js/pms_ledger.js");
let passed = 0;
const eq = (name, a, b) => { assert.deepStrictEqual(a, b, name); passed++; console.log("[PASS] " + name); };
const ok = (name, c, d) => { assert.ok(c, name + (d ? " — " + JSON.stringify(d) : "")); passed++; console.log("[PASS] " + name); };
const TODAY = "2026-10-17";
const lease = (o) => Object.assign({ id: "l1", rent: 10000, rent_type: "monthly", due_day: "5", start: "2026-06-01", end: "2027-05-31", status: "active" }, o || {});
const pay = (o) => Object.assign({ lease_id: "l1", status: "paid", amount: 10000 }, o);

// month keys
eq("display month text becomes YYYY-MM", L.monthKey("October 2026"), "2026-10");
eq("YYYY-MM is kept", L.monthKey("2026-07"), "2026-07");
eq("a date string gives its month", L.monthKey("2026-11-03"), "2026-11");
eq("unknown text gives no month", L.monthKey("someday"), "");
eq("month label for display", L.monthLabel("2026-10"), "October 2026");

// B1: status looks at every month, not just this one
let r = L.ledger(lease(), [pay({ month: "October 2026" })], TODAY);
eq("B1 months billed Jun–Oct to date", r.months.filter(m => m.due <= TODAY).map(m => m.key), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
eq("B1 four unpaid months are overdue", r.overdue, 40000);
eq("B1 the lease is overdue, not paid", r.current.state, "overdue");

// B2: a late payment for September does not also pay October
r = L.ledger(lease({ start: "2026-09-01" }), [pay({ month: "September 2026", date: "2026-10-03" })], TODAY);
eq("B2 September paid, October still owed", r.months.slice(0, 2).map(m => m.status), ["paid", "overdue"]);
eq("B2 arrears is October's rent", r.overdue, 10000);

// B3: partial payments are partial
r = L.ledger(lease({ start: "2026-09-01" }), [pay({ month: "September 2026", amount: 3000 })], TODAY);
eq("B3 September shows partial", r.months[0].status, "partial");
eq("B3 arrears counts what is still owed", r.overdue, 17000);

// B4: one payment can cover several months (advance), oldest unpaid first
r = L.ledger(lease({ start: "2026-08-01" }), [pay({ month: "August 2026", amount: 30000 })], TODAY);
eq("B4 three months' advance covers Aug–Oct", r.months.slice(0, 3).map(m => m.status), ["paid", "paid", "paid"]);
eq("B4 nothing overdue", r.overdue, 0);
r = L.ledger(lease({ start: "2026-08-01" }), [pay({ amount: 50000 })], TODAY);
eq("B4 an unlabelled payment fills months in order", r.months.slice(0, 5).map(m => m.status), ["paid", "paid", "paid", "paid", "paid"]);
eq("B4 future months covered by advance show paid", r.restOfTerm, 50000);

// B5: no rent before move-in
r = L.ledger(lease({ start: "2026-09-25", due_day: "10" }), [], TODAY);
eq("B5 first due date is on or after move-in", r.months[0].due, "2026-10-10");
eq("B5 arrears only from the first due date", r.overdue, 10000);

// B6: a future lease is not overdue
r = L.ledger(lease({ start: "2026-12-01", end: "2027-11-30" }), [], TODAY);
eq("B6 future lease owes nothing yet", r.overdue, 0);
eq("B6 future lease shows its first due date", r.current.state, "upcoming");
eq("B6 lease status is upcoming", L.leaseStatus(lease({ start: "2026-12-01" }), TODAY), "upcoming");

// B7: terminated leases stop charging at the termination date
r = L.ledger(lease({ status: "terminated", terminated_on: "2026-07-20" }), [pay({ month: "June 2026" }), pay({ month: "July 2026" })], TODAY);
eq("B7 no charges after termination", r.months.map(m => m.key), ["2026-06", "2026-07"]);
eq("B7 nothing owed", r.overdue, 0);

// B9: due dates are calendar dates, not shifted by time zone
r = L.ledger(lease({ due_day: "1" }), [], TODAY);
eq("B9 October rent is due on Oct 1", r.months.find(m => m.key === "2026-10").due, "2026-10-01");

// B12: no due rows after the lease ends
r = L.ledger(lease({ start: "2026-01-01", end: "2026-03-31" }), [], TODAY);
eq("B12 billing stops at the end date", r.months.map(m => m.key), ["2026-01", "2026-02", "2026-03"]);

// B13: statement splits due-to-date from the rest of the term
r = L.ledger(lease(), [1, 2, 3, 4, 5].map(i => pay({ month: "2026-0" + (5 + i) })), TODAY);
eq("B13 fully paid tenant owes nothing to date", r.dueToDate, 0);
eq("B13 rest of term is shown separately", r.restOfTerm, 70000);

// whole-term rent paid at once
r = L.ledger(lease({ rent_type: "lease", rent: 120000 }), [pay({ amount: 60000 })], TODAY);
eq("lump-sum lease is one charge", r.months.length, 1);
eq("lump-sum lease shows partial", r.months[0].status, "partial");

// only money received counts
r = L.ledger(lease({ start: "2026-10-01" }), [pay({ month: "October 2026", status: "pending" })], TODAY);
eq("a pending payment is not money received", r.overdue, 10000);
r = L.ledger(lease({ start: "2026-10-01" }), [pay({ month: "October 2026", archived: true })], TODAY);
eq("an archived payment does not count", r.overdue, 10000);
r = L.ledger(lease({ start: "2026-10-01" }), [pay({ month: "October 2026", lease_id: "other" })], TODAY);
eq("another lease's payment does not count", r.overdue, 10000);

// overpayment beyond the term is credit
r = L.ledger(lease({ start: "2026-10-01", end: "2026-11-30" }), [pay({ amount: 25000 })], TODAY);
eq("overpayment is kept as credit", r.credit, 5000);

// due today is due, not overdue
r = L.ledger(lease({ start: "2026-10-01", due_day: "17" }), [], TODAY);
eq("rent due today is due, not overdue", [r.current.state, r.overdue, r.dueToDate], ["due", 0, 10000]);

// statuses (B15, B16)
eq("B15 expired from dates", L.leaseStatus(lease({ end: "2026-09-30" }), TODAY), "expired");
eq("B16 expiring within 30 days", L.leaseStatus(lease({ end: "2026-11-10" }), TODAY), "expiring");
eq("active otherwise", L.leaseStatus(lease(), TODAY), "active");
eq("terminated stays terminated", L.leaseStatus(lease({ status: "terminated" }), TODAY), "terminated");
ok("B16 an expiring lease still occupies the unit", L.coversDate(lease({ end: "2026-11-10" }), TODAY));
ok("a future lease does not occupy the unit yet", !L.coversDate(lease({ start: "2026-12-01" }), TODAY));
ok("a terminated lease frees the unit", !L.coversDate(lease({ status: "terminated", terminated_on: "2026-08-01" }), TODAY));

// month list for the payment form covers the lease (B10)
const opts = L.leaseMonthKeys(lease({ start: "2025-01-01", end: "2025-12-31" }));
ok("B10 month list starts at the lease start", opts[0] === "2025-01" && opts[opts.length - 1] === "2025-12" && opts.length === 12, opts);

// due day words used by older leases
eq("due day 'wlast' means the 25th", L.dueDay({ due_day: "wlast" }), 25);
eq("due day is capped at 28", L.dueDay({ due_day: "31" }), 28);
eq("blank due day means the 10th", L.dueDay({}), 10);

// today in Manila, as a calendar date
eq("today is a local calendar date", L.today(new Date(2026, 9, 17, 23, 30)), "2026-10-17");

// B14: "late" is worked out from the dates, never typed in
eq("due date of a month uses the lease's due day", L.dueDateFor(lease({ due_day: "5" }), "2026-10"), "2026-10-05");
eq("a lease total is due on the start date", L.dueDateFor(lease({ rent_type: "lease", start: "2026-06-01" }), "2026-06"), "2026-06-01");
eq("a payment 12 days after the due date is 12 days late", L.daysLate(lease({ due_day: "5" }), { status: "paid", month: "2026-10", date: "2026-10-17" }), 12);
eq("a payment on the due date is on time", L.daysLate(lease({ due_day: "5" }), { status: "paid", month: "October 2026", date: "2026-10-05" }), 0);
eq("an advance payment is on time", L.daysLate(lease({ due_day: "5" }), { status: "paid", month: "2026-11", date: "2026-10-17" }), 0);
eq("money not yet cleared is never 'late'", L.daysLate(lease({ due_day: "5" }), { status: "pending", month: "2026-10", date: "2026-10-17" }), 0);
eq("days between two dates", L.daysBetween("2026-09-30", "2026-10-17"), 17);

// acknowledgement receipt numbers
eq("receipt numbers have four digits", L.receiptNo(2026, 7), "AR-2026-0007");
eq("the next number follows the highest one that year", L.nextReceiptNo([{ receipt_no: "AR-2026-0009" }, { receipt_no: "AR-2026-0002" }, { receipt_no: "AR-2025-0040" }, {}], 2026), "AR-2026-0010");
eq("a new year starts at 0001", L.nextReceiptNo([{ receipt_no: "AR-2025-0040" }], 2026), "AR-2026-0001");
eq("numbers past 9999 keep counting", L.receiptNo(2026, 12345), "AR-2026-12345");

// amounts in words, as written on a receipt
eq("whole pesos", L.amountInWords(15500), "Fifteen Thousand Five Hundred Pesos Only");
eq("with centavos", L.amountInWords("10,000.50"), "Ten Thousand Pesos and 50/100");
eq("hyphenated tens", L.amountInWords(1234567.05), "One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven Pesos and 05/100");
eq("one peso", L.amountInWords(1), "One Peso Only");
eq("teens and hundreds", L.amountInWords(813), "Eight Hundred Thirteen Pesos Only");

// security deposits
eq("a deposit is held while the lease runs", L.depositHeld(lease({ deposit: 20000 }), TODAY), 20000);
eq("not before the lease starts", L.depositHeld(lease({ deposit: 20000, start: "2026-11-01" }), TODAY), 0);
eq("not after it is settled at move-out", L.depositHeld(lease({ deposit: 20000, deposit_settled_on: "2026-10-01" }), TODAY), 0);
eq("still held on a date before the settlement", L.depositHeld(lease({ deposit: 20000, deposit_settled_on: "2026-10-01" }), "2026-09-30"), 20000);
ok("RA 9653 note when the deposit is over two months' rent", /RA 9653/.test(L.depositNote(lease({ deposit: 30000 }))));
eq("no note at two months or less", L.depositNote(lease({ deposit: 20000 })), "");
eq("no note for a lease paid as one total", L.depositNote(lease({ deposit: 90000, rent_type: "lease" })), "");

// owner statement for one month
const D = {
  leases: [lease({ id: "l1", property_id: "p1", deposit: 20000 }), lease({ id: "l2", property_id: "p2", rent: 5000, start: "2026-09-01" }), lease({ id: "l3", property_id: "p1", archived: true })],
  payments: [
    pay({ lease_id: "l1", month: "2026-09", date: "2026-09-04" }), pay({ lease_id: "l1", month: "2026-10", date: "2026-10-04" }),
    pay({ lease_id: "l1", month: "2026-08", date: "2026-11-02" }), pay({ lease_id: "l1", status: "submitted", date: "2026-10-09", amount: 999 }),
    pay({ lease_id: "l2", month: "2026-10", date: "2026-10-06", amount: 5000 })
  ],
  expenses: [{ property_id: "p1", amount: 1200, date: "2026-10-10", category: "Utilities" }, { property_id: "p1", amount: 500, date: "2026-09-10" }, { property_id: "p9", amount: 7, date: "2026-10-01" }],
  maintenance: [{ property_id: "p1", status: "completed", cost: 800, date: "2026-10-12", title: "Faucet" }, { property_id: "p1", status: "open", cost: 3000, date: "2026-10-12" }]
};
const st = L.monthStatement(D, ["p1"], "2026-10");
const p1 = st.rows.find(x => x.property_id === "p1");
eq("statement: rent received in the month, by payment date", p1.collected, 10000);
eq("statement: expenses and finished repairs of the month only", [p1.expenses, p1.repairs], [1200, 800]);
eq("statement: net = received - expenses - repairs", p1.net, 8000);
eq("statement: rent unpaid at month end ignores later payments", p1.unpaid, 30000);
eq("statement: deposit held at month end", p1.deposits, 20000);
eq("statement: another owner's property stays out", st.rows.length, 1);
eq("statement: label and last day", [st.label, st.end], ["October 2026", "2026-10-31"]);
eq("last day of February", L.lastDayOf("2028-02"), "2028-02-29");

console.log("\npms_ledger_node: " + passed + " checks passed");
