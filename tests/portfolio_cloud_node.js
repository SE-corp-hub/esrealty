// Portfolio cloud mapping round-trip tests (pure, Node-only).
// Run with: node tests/portfolio_cloud_node.js
"use strict";
const PC = require("../js/portfolio_cloud.js");
const assert = require("assert");

let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log("[PASS] " + name); };
const eq = (name, a, b) => { assert.deepStrictEqual(a, b, name); passed++; console.log("[PASS] " + name); };

// ---- uuid helpers ----------------------------------------------------
(function () {
  ok("newUuid is uuid format", PC.isUuid(PC.newUuid()));
  ok("newUuid unique", PC.newUuid() !== PC.newUuid());
  ok("isUuid true for v4", PC.isUuid("550e8400-e29b-41d4-a716-446655440000"));
  ok("isUuid false for local id", !PC.isUuid("acc-12345"));
  ok("isUuid false for empty", !PC.isUuid(""));
  ok("isUuid false for undefined", !PC.isUuid(undefined));
  ok("isLocalId local", PC.isLocalId("pf-acc-1"));
  ok("isLocalId uuid false", !PC.isLocalId("550e8400-e29b-41d4-a716-446655440000"));

  const rec = { id: "acc-123", label: "x" };
  PC.ensureUuid(rec);
  ok("ensureUuid assigns uuid to local id", PC.isUuid(rec.id));
  const rec2 = { id: "550e8400-e29b-41d4-a716-446655440000", label: "x" };
  PC.ensureUuid(rec2);
  ok("ensureUuid keeps uuid", rec2.id === "550e8400-e29b-41d4-a716-446655440000");
})();

// ---- account round trip ----------------------------------------------
(function () {
  const acc = { id: "550e8400-e29b-41d4-a716-446655440000", label: "BPI Ops", bank_name: "BPI", account_type: "cash", opening_balance: 2500000, as_of: "2026-08-31", currency: "PHP", created_at: "2026-08-31T00:00:00.000Z" };
  const db = PC.accountToDb(acc);
  eq("accountToDb fields", db, {
    id: acc.id, label: "BPI Ops", bank_name: "BPI", account_type: "cash",
    opening_balance: 2500000, as_of: "2026-08-31", currency: "PHP"
  });
  const back = PC.accountFromDb(Object.assign({}, db, { created_at: acc.created_at }));
  eq("account round trip", back, Object.assign({ owner_id: "" }, acc));
  const OWNER = "11111111-1111-1111-1111-111111111111";
  eq("account owner kept from cloud row", PC.accountToDb(PC.accountFromDb(Object.assign({}, db, { owner_id: OWNER }))).owner_id, OWNER);
  ok("account empty as_of left to the column default", !("as_of" in PC.accountToDb({ id: acc.id, label: "x", as_of: "" })));
  eq("account undefined opening → 0", PC.accountToDb({ label: "x" }).opening_balance, 0);
  eq("account empty bank → ''", PC.accountFromDb({ id: "x", label: "y" }).bank_name, "");
})();

// ---- cash entry round trip -------------------------------------------
(function () {
  const e = {
    id: "550e8400-e29b-41d4-a716-446655441111", accountId: "550e8400-e29b-41d4-a716-446655441122",
    entry_date: "2026-08-31", direction: "out", amount: 120000.5, purpose: "construction",
    subcategory: "", description: "Down payment BPI — vendor X", counterparty: "Vendor X",
    reference_no: "INV-001", linked_construction_id: "550e8400-e29b-41d4-a716-446655441133",
    linked_transaction_id: "550e8400-e29b-41d4-a716-446655441144", status: "posted",
    idempotencyKey: "pf-invoice-123", proofs: [{ id: "p1" }], created_at: "2026-08-31T00:00:00.000Z"
  };
  const db = PC.entryToDb(e);
  eq("entryToDb direction", db.direction, "out");
  eq("entryToDb account_id mapped", db.account_id, e.accountId);
  eq("entryToDb linked_construction mapped", db.linked_construction_id, e.linked_construction_id);
  eq("entryToDb idempotency_key", db.idempotency_key, "pf-invoice-123");
  eq("entryToDb proof_required true", db.proof_required, true);
  eq("entryToDb amount numeric", db.amount, 120000.5);
  eq("entryToDb reversal_of null", db.reversal_of, null);

  const back = PC.entryFromDb(Object.assign({}, db, {
    linked_presell_project_id: "", linked_presell_payment_id: "", linked_phase_id: "", counterparty: "Vendor X", category: "", created_at: e.created_at
  }));
  ok("entryFromDb maps accountId", back.accountId === e.accountId);
  ok("entryFromDb keeps amount", back.amount === 120000.5);
  ok("entryFromDb keeps purpose", back.purpose === "construction");
  ok("entryFromDb idempotencyKey", back.idempotencyKey === "pf-invoice-123");
  ok("entryFromDb proofs empty array", Array.isArray(back.proofs) && back.proofs.length === 0);

  eq("entry in direction", PC.entryToDb({ id: "x", direction: "in", amount: "10" }).direction, "in");
  eq("entry bad direction → in", PC.entryToDb({ id: "x", direction: "sideways", amount: 10 }).direction, "in");
  eq("entry amount string → number", PC.entryToDb({ id: "x", amount: "99.9" }).amount, 99.9);

  const rev = PC.entryFromDb({ id: "r", account_id: "a", reversal_of: "550e8400-e29b-41d4-a716-446655441111", amount: 1, direction: "out" });
  ok("entryFromDb reversalOf kept", rev.reversalOf === "550e8400-e29b-41d4-a716-446655441111");
  ok("entryFromDb amount coerced", rev.amount === 1);
})();

// ---- construction round trips ----------------------------------------
(function () {
  const p = {
    id: "550e8400-e29b-41d4-a716-446655442200", name: "Fairview 3", asset_id: "unit-v3",
    presell_project_id: "", presell_link: { scope: "project", value: "unit-v3" }, site: "QC",
    contractor: "BuildCo", status: "under construction", contract_value: 50000000, contingency: 2500000,
    retention_rate: 5, allocation: "equal", created_at: "2026-08-31T00:00:00.000Z"
  };
  const db = PC.projectToDb(p);
  ok("projectToDb jsonb presell_link is an object", JSON.stringify(db.presell_link) === JSON.stringify(p.presell_link));
  eq("projectToDb status in database words", db.status, "in_progress");
  eq("projectToDb no link → {}", JSON.stringify(PC.projectToDb({ id: p.id, name: "n", presell_link: null }).presell_link), "{}");
  eq("projectToDb empty presell_project_id → null", db.presell_project_id, null);
  const back = PC.projectFromDb(Object.assign({}, db, { created_at: p.created_at }));
  ok("project round trip name", back.name === p.name);
  eq("project round trip status", back.status, "under construction");
  ok("projectFromDb {} link → null", PC.projectFromDb({ id: "x", presell_link: {} }).presell_link === null);
  ok("project round trip presell_link", JSON.stringify(back.presell_link) === JSON.stringify(p.presell_link));
  ok("projectFromDb tolerates null presell_link", PC.projectFromDb({ id: "x", name: "n" }).presell_link === null);
  ok("projectFromDb parses object presell_link", PC.projectFromDb({ id: "x", presell_link: { scope: "a", value: "b" } }).presell_link.value === "b");

  const ph = { id: "550e8400-e29b-41d4-a716-446655442211", project_id: p.id, name: "Foundation", planned_budget: 10000000, approved_budget: 9000000, committed: 5500000, paid: 5000000, percent_complete: 55, responsible: "Eng. Cruz", allocation: "equal", created_at: "2026-08-31T00:00:00.000Z" };
  const phBack = PC.phaseFromDb(PC.phaseToDb(ph));
  ok("phase round trip name", phBack.name === "Foundation");
  ok("phase round trip planned_budget", phBack.planned_budget === 10000000);

  const v = { id: "550e8400-e29b-41d4-a716-446655442222", project_id: p.id, name: "Steelworks", contact: "0917-000-0000", tax_id: "123-456", created_at: "2026-08-31T00:00:00.000Z" };
  eq("vendor round trip", PC.vendorFromDb(PC.vendorToDb(v)), v);

  const inv = { id: "550e8400-e29b-41d4-a716-446655442233", project_id: p.id, phase_id: ph.id, vendor_id: v.id, invoice_no: "SW-2026-01", date: "2026-08-31", amount: 500000, status: "paid", ledger_entry_id: "550e8400-e29b-41d4-a716-446655442244", paid_at: "2026-09-01T00:00:00.000Z", created_at: "2026-08-31T00:00:00.000Z" };
  const invBack = PC.invoiceFromDb(PC.invoiceToDb(inv));
  ok("invoice round trip paid", invBack.status === "paid" && invBack.ledger_entry_id === inv.ledger_entry_id);
  ok("invoiceToDb null vendor_id", PC.invoiceToDb({ id: "x", invoice_no: "j", project_id: "y", vendor_id: "" }).vendor_id === null);
  eq("invoice date column is invoice_date", PC.invoiceToDb(inv).invoice_date, "2026-08-31");
  eq("invoice round trip date", invBack.date, "2026-08-31");

  const c = { id: "550e8400-e29b-41d4-a716-446655442255", project_id: p.id, amount: 250000, reason: "Steel price increase", approver: "Admin", date: "2026-09-01", created_at: "2026-09-01T00:00:00.000Z" };
  const cBack = PC.changeFromDb(PC.changeToDb(c));
  ok("change round trip amount", cBack.amount === 250000);
  ok("change round trip reason", cBack.reason === "Steel price increase");
  eq("change date column is co_date", PC.changeToDb(c).co_date, "2026-09-01");
  eq("change default status approved", PC.changeToDb(c).status, "approved");
  eq("change round trip date", cBack.date, "2026-09-01");
})();

// ---- proof round trip -------------------------------------------------
(function () {
  const pr = { id: "550e8400-e29b-41d4-a716-446655443300", entryId: "e-1", filename: "receipt.pdf", mimetype: "application/pdf", size: 204800, checksum: "sha256:abc123", category: "receipt", mode: "local", storagePath: "local/e-1", uploadedBy: "admin@esrealty.ph", uploadedAt: "2026-08-31T00:00:00.000Z" };
  const db = PC.proofToDb(pr);
  eq("proofToDb byte_size mapped", db.byte_size, 204800);
  eq("proofToDb entry_id mapped", db.entry_id, "e-1");
  eq("proofToDb id kept (upsert, not a new row)", db.id, pr.id);
  eq("proofToDb storage_mode", db.storage_mode, "local");
  ok("proofToDb email uploadedBy left for the app to fill", !("uploaded_by" in db));
  const back = PC.proofFromDb(Object.assign({}, db, { uploaded_at: pr.uploadedAt }));
  ok("proof round trip filename", back.filename === "receipt.pdf");
  ok("proof round trip size", back.size === 204800);
  ok("proof round trip entryId", back.entryId === "e-1");
  ok("proof round trip storagePath", back.storagePath === "local/e-1");
  ok("proofToDb prioritizes byte_size", PC.proofToDb({ byte_size: 1, size: 2 }).byte_size === 1);
})();

// ---- payloads fit the live tables ---------------------------------------
// Column types from the live schema (2026-10-16). "!" = NOT NULL. PostgREST
// sends an explicit null as NULL, and Postgres rejects "" for uuid/date/ts.
(function () {
  const LIVE = {"cash_entries":{"id":"uuid!","owner_id":"uuid!","account_id":"uuid!","entry_date":"date!","direction":"text!","amount":"num!","category":"text!","purpose":"text!","subcategory":"text!","description":"text!","counterparty":"text!","reference_no":"text!","linked_asset_id":"text!","linked_construction_id":"uuid","linked_phase_id":"uuid","linked_presell_project_id":"uuid","linked_presell_payment_id":"text!","linked_transaction_id":"text!","proof_required":"bool!","status":"text!","reversal_of":"uuid","idempotency_key":"text!","created_by":"uuid","approved_by":"uuid","posted_at":"ts","created_at":"ts!","updated_at":"ts!"},"construction_change_orders":{"id":"uuid!","project_id":"uuid!","amount":"num!","reason":"text!","approver":"text!","co_date":"date!","status":"text!","created_by":"uuid","created_at":"ts!","updated_at":"ts!"},"construction_invoices":{"id":"uuid!","project_id":"uuid!","phase_id":"uuid","vendor_id":"uuid","invoice_no":"text!","invoice_date":"date!","amount":"num!","status":"text!","ledger_entry_id":"uuid","paid_at":"ts","created_by":"uuid","created_at":"ts!","updated_at":"ts!"},"construction_phases":{"id":"uuid!","project_id":"uuid!","name":"text!","planned_budget":"num!","approved_budget":"num!","committed":"num!","paid":"num!","percent_complete":"num!","start_date":"date","end_date":"date","responsible":"text!","notes":"text!","created_at":"ts!","updated_at":"ts!","allocation":"text!"},"construction_projects":{"id":"uuid!","owner_id":"uuid!","asset_id":"text!","presell_project_id":"uuid","name":"text!","site":"text!","contractor":"text!","architect":"text!","permit_status":"text!","status":"text!","start_date":"date","target_completion":"date","actual_completion":"date","contract_value":"num!","contingency":"num!","retention":"num!","created_by":"uuid","created_at":"ts!","updated_at":"ts!","retention_rate":"num!","allocation":"text!","presell_link":"json!"},"construction_vendors":{"id":"uuid!","project_id":"uuid!","name":"text!","contact":"text!","tax_id":"text!","created_by":"uuid","created_at":"ts!","updated_at":"ts!"},"portfolio_accounts":{"id":"uuid!","owner_id":"uuid!","label":"text!","bank_name":"text!","account_type":"text!","opening_balance":"num!","as_of":"date!","currency":"text!","created_by":"uuid","created_at":"ts!","updated_at":"ts!"},"portfolio_proofs":{"id":"uuid!","entry_id":"uuid!","filename":"text!","mimetype":"text!","byte_size":"num!","checksum":"text!","category":"text!","uploaded_by":"uuid","uploaded_at":"ts!","storage_path":"text!","storage_mode":"text!","proof_order":"num!","created_at":"ts!","updated_at":"ts!"}};
  const ENUMS = {
    "portfolio_accounts.account_type": ["bank", "cash", "ewallet", "escrow"],
    "cash_entries.direction": ["in", "out"],
    "cash_entries.status": ["draft", "pending", "posted", "voided", "reversed"],
    "construction_projects.status": ["planned", "in_progress", "on_hold", "completed", "archived"],
    "construction_projects.allocation": ["equal", "floor_area", "actual", "manual"],
    "construction_phases.allocation": ["equal", "floor_area", "actual", "manual"],
    "construction_invoices.status": ["pending", "approved", "paid"],
    "construction_change_orders.status": ["draft", "approved", "rejected"],
    "portfolio_proofs.category": ["receipt", "deposit_slip", "transfer_confirmation", "contract", "invoice", "other"],
    "portfolio_proofs.storage_mode": ["local", "supabase"],
  };
  function fits(table, payload) {
    const cols = LIVE[table];
    Object.keys(payload).forEach(function (k) {
      const t = cols[k];
      assert.ok(t, table + "." + k + " is not a live column");
      const v = payload[k];
      const notNull = t.slice(-1) === "!";
      const base = t.replace("!", "");
      if (v === null) { assert.ok(!notNull, table + "." + k + " is NOT NULL but got null"); return; }
      if (base === "uuid") assert.ok(PC.isUuid(v), table + "." + k + " needs a uuid, got " + JSON.stringify(v));
      if (base === "date") assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(v), table + "." + k + " needs a date, got " + JSON.stringify(v));
      if (base === "ts") assert.ok(!isNaN(new Date(v).getTime()) && v !== "", table + "." + k + " needs a timestamp");
      const allowed = ENUMS[table + "." + k];
      if (allowed) assert.ok(allowed.indexOf(v) >= 0, table + "." + k + " value " + JSON.stringify(v) + " fails the check constraint");
    });
    passed++; console.log("[PASS] " + table + " payload fits the live table");
  }
  const id = function () { return PC.newUuid(); };
  // Records shaped the way the app creates them, including empty fields.
  fits("portfolio_accounts", PC.accountToDb({ id: id(), label: "Cash", bank_name: "", account_type: "cash", opening_balance: 0, as_of: "", currency: "PHP", created_at: "" }));
  fits("cash_entries", PC.entryToDb({ id: id(), accountId: id(), entry_date: "", direction: "out", amount: 5, purpose: "", subcategory: "", description: "x", linked_construction_id: "", linked_phase_id: "", linked_presell_project_id: "cproj-1", status: "posted", proofs: [], created_at: "" }));
  // A ledger reversal ("R" + id); the app gives it a uuid before saving.
  const rev = { id: "R" + id(), reversalOf: id(), direction: "in", amount: 5, accountId: id(), status: "posted", createdAt: "2026-10-17T00:00:00Z" };
  PC.ensureUuid(rev);
  fits("cash_entries", PC.entryToDb(rev));
  fits("construction_projects", PC.projectToDb({ id: id(), name: "P", asset_id: "", presell_project_id: "", presell_link: null, status: "on hold", allocation: "equal", created_at: "" }));
  fits("construction_phases", PC.phaseToDb({ id: id(), project_id: id(), name: "Ph", created_at: "" }));
  fits("construction_vendors", PC.vendorToDb({ id: id(), project_id: id(), name: "V" }));
  fits("construction_invoices", PC.invoiceToDb({ id: id(), project_id: id(), phase_id: "", vendor_id: "", invoice_no: "I", date: "", amount: 1, status: "pending", ledger_entry_id: "pf-123", paid_at: "" }));
  fits("construction_change_orders", PC.changeToDb({ id: id(), project_id: id(), amount: 1, reason: "r", approver: "Unassigned", date: "" }));
  fits("portfolio_proofs", PC.proofToDb({ id: id(), entryId: id(), filename: "a.heic", mimetype: "image/heic", size: 10.6, category: "photo", mode: "local", storagePath: "local/x", uploadedBy: "admin", uploadedAt: "" }));

  // Two keyless entries must not share the unique (owner_id, idempotency_key).
  const k1 = PC.entryToDb({ id: id(), amount: 1 }).idempotency_key;
  const k2 = PC.entryToDb({ id: id(), amount: 1 }).idempotency_key;
  ok("keyless entries get distinct idempotency keys", k1 && k2 && k1 !== k2);
})();

console.log("\nportfolio_cloud_node: " + passed + " checks passed");
process.exit(0);