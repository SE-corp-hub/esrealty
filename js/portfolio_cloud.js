(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.ESPFCLOUD = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Pure mapping layer between the normalized Supabase Portfolio tables
  // (supabase/archive/portfolio_a_investor.sql) and the app's in-memory state
  // shapes used by the Portfolio UI. Dependency-free, browser/Node
  // compatible, fully round-trippable.

  var NUM = function (v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  };
  var STREAM = function (s) {
    if (s === null || s === undefined) return "";
    return String(s);
  };
  var DATE = function (d) {
    if (!d) return "";
    return String(d).slice(0, 10);
  };

  // Postgres rejects "" for uuid, date and timestamp columns, and an explicit
  // null for NOT NULL columns even when they have a default. These helpers
  // turn app values into what the column accepts; put() leaves a key out so
  // the column default applies.
  var UUIDN = function (v) { return isUuid(v) ? v : null; };
  var DATEN = function (d) {
    var s = DATE(d);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  var TSN = function (v) {
    if (!v) return null;
    var t = new Date(v);
    return isNaN(t.getTime()) ? null : t.toISOString();
  };
  var ONE_OF = function (v, allowed, fallback) {
    var s = STREAM(v);
    return allowed.indexOf(s) >= 0 ? s : fallback;
  };
  function put(o, key, value) {
    if (value !== null && value !== undefined) o[key] = value;
    return o;
  }
  // owner_id and uploaded_by are only emitted when the record already carries
  // them (rows loaded from the cloud). For new rows the app's pfCloudWrite
  // fills in the signed-in user.

  // The app's project status words vs the database's.
  var PROJECT_STATUS_TO_DB = { "planned": "planned", "under construction": "in_progress", "in_progress": "in_progress", "on hold": "on_hold", "on_hold": "on_hold", "completed": "completed", "archived": "archived" };
  var PROJECT_STATUS_FROM_DB = { "planned": "planned", "in_progress": "under construction", "on_hold": "on hold", "completed": "completed", "archived": "archived" };
  var PROOF_CATEGORIES = ["receipt", "deposit_slip", "transfer_confirmation", "contract", "invoice", "other"];
  var PROOF_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];

  function isUuid(id) {
    if (typeof id !== "string") return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }

  function newUuid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      try { return crypto.randomUUID(); } catch (e) { /* fall through */ }
    }
    var s4 = function () {
      return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    };
    return s4() + s4() + "-" + s4() + "-4" + s4().substring(0, 3) + "-8" + s4().substring(0, 3) + "-" + s4() + s4() + s4();
  }

  // Ensure a record gets a UUID id (cloud-mode requirement). Records that
  // already carry a uuid (loaded from cloud or local demo uuids) pass through.
  function ensureUuid(rec) {
    if (!rec || typeof rec !== "object") return false;
    if (!rec.id || !isUuid(rec.id)) rec.id = newUuid();
    return true;
  }

  // A local (non-uuid) id signals a record that has never been written to
  // the cloud. If still present after writes, it was created in local/demo
  // mode and must be remapped on first cloud sync.
  function isLocalId(id) {
    if (!id) return true;
    return !isUuid(id);
  }

  // ---- accounts ------------------------------------------------------

  function accountToDb(a) {
    var o = {
      id: STREAM(a.id),
      label: STREAM(a.label),
      bank_name: STREAM(a.bank_name),
      account_type: ONE_OF(a.account_type, ["bank", "cash", "ewallet", "escrow"], "cash"),
      opening_balance: NUM(a.opening_balance),
      currency: STREAM(a.currency) || "PHP"
    };
    put(o, "owner_id", UUIDN(a.owner_id));
    return put(o, "as_of", DATEN(a.as_of));
  }

  function accountFromDb(r) {
    return {
      id: STREAM(r.id),
      label: STREAM(r.label),
      bank_name: STREAM(r.bank_name),
      account_type: STREAM(r.account_type) || "cash",
      opening_balance: NUM(r.opening_balance),
      as_of: DATE(r.as_of),
      currency: STREAM(r.currency) || "PHP",
      owner_id: STREAM(r.owner_id),
      created_at: r.created_at ? new Date(r.created_at).toISOString() : ""
    };
  }

  // ---- cash entries --------------------------------------------------

  function entryToDb(e) {
    var id = STREAM(e.id);
    var o = {
      id: id,
      account_id: STREAM(e.accountId || e.account_id),
      direction: STREAM(e.direction) === "out" ? "out" : "in",
      amount: NUM(e.amount),
      category: STREAM(e.category),
      purpose: STREAM(e.purpose),
      subcategory: STREAM(e.subcategory),
      description: STREAM(e.description),
      counterparty: STREAM(e.counterparty),
      reference_no: STREAM(e.reference_no || e.referenceNo),
      linked_asset_id: STREAM(e.linked_asset_id || e.linkedAssetId),
      linked_construction_id: UUIDN(e.linked_construction_id || e.linkedConstructionId),
      linked_phase_id: UUIDN(e.linked_phase_id || e.linkedPhaseId),
      linked_presell_project_id: UUIDN(e.linked_presell_project_id || e.linkedPresellProjectId),
      linked_presell_payment_id: STREAM(e.linked_presell_payment_id || e.linkedPresellPaymentId),
      linked_transaction_id: STREAM(e.linked_transaction_id || e.linkedTransactionId),
      proof_required: !!(e.proof_required || (e.proofs && e.proofs.length)),
      status: ONE_OF(e.status, ["draft", "pending", "posted", "voided", "reversed"], "draft"),
      reversal_of: UUIDN(e.reversal_of || e.reversalOf),
      // Unique per owner in the database, so an entry without its own key
      // uses its id; "" would collide with every other keyless entry.
      idempotency_key: STREAM(e.idempotency_key || e.idempotencyKey) || ("entry:" + id)
    };
    put(o, "owner_id", UUIDN(e.owner_id));
    put(o, "entry_date", DATEN(e.entry_date || e.entryDate));
    return put(o, "created_at", TSN(e.created_at));
  }

  function entryFromDb(r) {
    return {
      id: STREAM(r.id),
      accountId: STREAM(r.account_id),
      entry_date: DATE(r.entry_date || r.created_at),
      direction: STREAM(r.direction) === "out" ? "out" : "in",
      amount: NUM(r.amount),
      category: STREAM(r.category),
      purpose: STREAM(r.purpose),
      subcategory: STREAM(r.subcategory),
      description: STREAM(r.description),
      counterparty: STREAM(r.counterparty),
      reference_no: STREAM(r.reference_no),
      linked_asset_id: STREAM(r.linked_asset_id),
      linked_construction_id: STREAM(r.linked_construction_id),
      linked_phase_id: STREAM(r.linked_phase_id),
      linked_presell_project_id: STREAM(r.linked_presell_project_id),
      linked_presell_payment_id: STREAM(r.linked_presell_payment_id),
      linked_transaction_id: STREAM(r.linked_transaction_id),
      status: STREAM(r.status) || "draft",
      reversalOf: STREAM(r.reversal_of),
      idempotencyKey: STREAM(r.idempotency_key),
      owner_id: STREAM(r.owner_id),
      proof_count: 0,
      proofs: [],
      created_at: r.created_at ? new Date(r.created_at).toISOString() : ""
    };
  }

  // ---- construction projects -----------------------------------------

  function projectToDb(p) {
    var o = {
      id: STREAM(p.id),
      asset_id: STREAM(p.asset_id),
      presell_project_id: UUIDN(p.presell_project_id),
      name: STREAM(p.name),
      site: STREAM(p.site),
      contractor: STREAM(p.contractor),
      status: PROJECT_STATUS_TO_DB[STREAM(p.status)] || "planned",
      contract_value: NUM(p.contract_value),
      contingency: NUM(p.contingency),
      retention_rate: NUM(p.retention_rate),
      allocation: ONE_OF(p.allocation, ["equal", "floor_area", "actual", "manual"], "equal"),
      // jsonb NOT NULL: an empty object stands for "no link".
      presell_link: p.presell_link && typeof p.presell_link === "object" ? p.presell_link : {}
    };
    put(o, "owner_id", UUIDN(p.owner_id));
    return put(o, "created_at", TSN(p.created_at));
  }

  function projectFromDb(r) {
    var link = null;
    if (typeof r.presell_link === "string" && r.presell_link) {
      try { link = JSON.parse(r.presell_link); } catch (e) { link = null; }
    } else if (r.presell_link && typeof r.presell_link === "object" && Object.keys(r.presell_link).length) {
      link = r.presell_link;
    }
    return {
      id: STREAM(r.id),
      name: STREAM(r.name),
      asset_id: STREAM(r.asset_id),
      presell_project_id: STREAM(r.presell_project_id),
      presell_link: link,
      site: STREAM(r.site),
      contractor: STREAM(r.contractor),
      status: PROJECT_STATUS_FROM_DB[STREAM(r.status)] || STREAM(r.status) || "planned",
      contract_value: NUM(r.contract_value),
      contingency: NUM(r.contingency),
      retention_rate: NUM(r.retention_rate),
      allocation: STREAM(r.allocation) || "equal",
      owner_id: STREAM(r.owner_id),
      created_at: r.created_at ? new Date(r.created_at).toISOString() : ""
    };
  }

  // ---- construction phases -------------------------------------------

  function phaseToDb(p) {
    return put({
      id: STREAM(p.id),
      project_id: STREAM(p.project_id),
      name: STREAM(p.name),
      planned_budget: NUM(p.planned_budget),
      approved_budget: NUM(p.approved_budget),
      committed: NUM(p.committed),
      paid: NUM(p.paid),
      percent_complete: NUM(p.percent_complete),
      responsible: STREAM(p.responsible),
      allocation: ONE_OF(p.allocation, ["equal", "floor_area", "actual", "manual"], "equal")
    }, "created_at", TSN(p.created_at));
  }

  function phaseFromDb(r) {
    return {
      id: STREAM(r.id),
      project_id: STREAM(r.project_id),
      name: STREAM(r.name),
      planned_budget: NUM(r.planned_budget),
      approved_budget: NUM(r.approved_budget),
      committed: NUM(r.committed),
      paid: NUM(r.paid),
      percent_complete: NUM(r.percent_complete),
      responsible: STREAM(r.responsible),
      allocation: STREAM(r.allocation) || "equal",
      created_at: r.created_at ? new Date(r.created_at).toISOString() : ""
    };
  }

  // ---- construction vendors ------------------------------------------

  function vendorToDb(v) {
    return put({
      id: STREAM(v.id),
      project_id: STREAM(v.project_id),
      name: STREAM(v.name),
      contact: STREAM(v.contact),
      tax_id: STREAM(v.tax_id)
    }, "created_at", TSN(v.created_at));
  }

  function vendorFromDb(r) {
    return {
      id: STREAM(r.id),
      project_id: STREAM(r.project_id),
      name: STREAM(r.name),
      contact: STREAM(r.contact),
      tax_id: STREAM(r.tax_id),
      created_at: r.created_at ? new Date(r.created_at).toISOString() : ""
    };
  }

  // ---- construction invoices ------------------------------------------

  function invoiceToDb(i) {
    var o = {
      id: STREAM(i.id),
      project_id: STREAM(i.project_id),
      phase_id: UUIDN(i.phase_id),
      vendor_id: UUIDN(i.vendor_id),
      invoice_no: STREAM(i.invoice_no),
      amount: NUM(i.amount),
      status: ONE_OF(i.status, ["pending", "approved", "paid"], "pending"),
      ledger_entry_id: UUIDN(i.ledger_entry_id),
      paid_at: TSN(i.paid_at)
    };
    put(o, "invoice_date", DATEN(i.date || i.invoice_date));
    return put(o, "created_at", TSN(i.created_at));
  }

  function invoiceFromDb(r) {
    return {
      id: STREAM(r.id),
      project_id: STREAM(r.project_id),
      phase_id: STREAM(r.phase_id),
      vendor_id: STREAM(r.vendor_id),
      invoice_no: STREAM(r.invoice_no),
      date: DATE(r.invoice_date || r.date),
      amount: NUM(r.amount),
      status: STREAM(r.status) || "pending",
      ledger_entry_id: STREAM(r.ledger_entry_id),
      paid_at: r.paid_at ? new Date(r.paid_at).toISOString() : "",
      created_at: r.created_at ? new Date(r.created_at).toISOString() : ""
    };
  }

  // ---- construction change orders -------------------------------------

  function changeToDb(c) {
    var o = {
      id: STREAM(c.id),
      project_id: STREAM(c.project_id),
      amount: NUM(c.amount),
      reason: STREAM(c.reason),
      approver: STREAM(c.approver),
      status: ONE_OF(c.status, ["draft", "approved", "rejected"], "approved")
    };
    put(o, "co_date", DATEN(c.date || c.co_date));
    return put(o, "created_at", TSN(c.created_at));
  }

  function changeFromDb(r) {
    return {
      id: STREAM(r.id),
      project_id: STREAM(r.project_id),
      amount: NUM(r.amount),
      reason: STREAM(r.reason),
      approver: STREAM(r.approver),
      date: DATE(r.co_date || r.date),
      status: STREAM(r.status),
      created_at: r.created_at ? new Date(r.created_at).toISOString() : ""
    };
  }

  // ---- portfolio proofs ----------------------------------------------

  function proofToDb(p) {
    var o = {
      id: STREAM(p.id),
      entry_id: STREAM(p.entryId || p.entry_id),
      filename: STREAM(p.filename),
      mimetype: ONE_OF(p.mimetype, PROOF_MIMES, ""),
      byte_size: Math.max(0, Math.round(NUM(p.byte_size !== undefined ? p.byte_size : p.size))),
      checksum: STREAM(p.checksum),
      category: ONE_OF(p.category, PROOF_CATEGORIES, "other"),
      storage_mode: STREAM(p.mode) === "supabase" ? "supabase" : "local",
      storage_path: STREAM(p.storagePath) || "",
    };
    if (!o.id) delete o.id;
    put(o, "uploaded_by", UUIDN(p.uploadedBy));
    return put(o, "uploaded_at", TSN(p.uploadedAt));
  }

  function proofFromDb(r) {
    return {
      id: STREAM(r.id),
      entryId: STREAM(r.entry_id),
      filename: STREAM(r.filename),
      mimetype: STREAM(r.mimetype),
      size: NUM(r.byte_size),
      checksum: STREAM(r.checksum),
      category: STREAM(r.category),
      mode: STREAM(r.storage_mode || r.mode) || "local",
      storagePath: STREAM(r.storage_path),
      uploadedBy: STREAM(r.uploaded_by),
      uploadedAt: r.uploaded_at ? new Date(r.uploaded_at).toISOString() : ""
    };
  }

  return {
    isUuid: isUuid,
    isLocalId: isLocalId,
    newUuid: newUuid,
    ensureUuid: ensureUuid,
    accountToDb: accountToDb,
    accountFromDb: accountFromDb,
    entryToDb: entryToDb,
    entryFromDb: entryFromDb,
    projectToDb: projectToDb,
    projectFromDb: projectFromDb,
    phaseToDb: phaseToDb,
    phaseFromDb: phaseFromDb,
    vendorToDb: vendorToDb,
    vendorFromDb: vendorFromDb,
    invoiceToDb: invoiceToDb,
    invoiceFromDb: invoiceFromDb,
    changeToDb: changeToDb,
    changeFromDb: changeFromDb,
    proofToDb: proofToDb,
    proofFromDb: proofFromDb
  };
});