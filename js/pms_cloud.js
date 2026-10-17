(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.ESPMSCLOUD = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Property Management cloud store (supabase/pms_v2_tables.sql): one table
   * per record type. Each row holds the app's full record in `data`, plus the
   * link columns the row rules need (who owns a property, which tenant a lease
   * belongs to, which login a person has). Pure and dependency-free so it can
   * be tested in Node. */

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function uuidOrNull(v) { return typeof v === "string" && UUID.test(v) ? v : null; }
  function idOrNull(v) { return v === undefined || v === null || v === "" ? null : String(v); }

  var KINDS = {
    owners: { table: "pms_owners", links: function (r) { return { auth_user_id: uuidOrNull(r.authUserId) }; } },
    tenants: { table: "pms_tenants", links: function (r) { return { auth_user_id: uuidOrNull(r.authUserId), owner_id: idOrNull(r.owner_id) }; } },
    properties: { table: "pms_properties", links: function (r) { return { owner_id: idOrNull(r.owner_id) }; } },
    units: { table: "pms_units", links: function (r) { return { property_id: idOrNull(r.property_id) }; } },
    leases: { table: "pms_leases", links: function (r) { return { property_id: idOrNull(r.property_id), unit_id: idOrNull(r.unit_id), tenant_id: idOrNull(r.tenant_id), owner_id: idOrNull(r.owner_id) }; } },
    payments: { table: "pms_payments", links: function (r) { return { lease_id: idOrNull(r.lease_id), property_id: idOrNull(r.property_id), tenant_id: idOrNull(r.tenant_id) }; } },
    maintenance: { table: "pms_maintenance", links: function (r) { return { property_id: idOrNull(r.property_id), unit_id: idOrNull(r.unit_id) }; } },
    expenses: { table: "pms_expenses", links: function (r) { return { property_id: idOrNull(r.property_id) }; } },
    documents: { table: "pms_documents", links: function (r) { return { property_id: idOrNull(r.property_id), unit_id: idOrNull(r.unit_id) }; } }
  };
  // The company book: the super-admins' shared records.
  var COMPANY_BOOK = "00000000-0000-0000-0000-000000000000";
  var ORDER = ["owners", "tenants", "properties", "units", "leases", "payments", "maintenance", "expenses", "documents"];

  // book: the manager's book id (supabase/pms_v3_books.sql). Left out until
  // that script has run, so the row fits the tables either way.
  function toRow(kind, rec, book) {
    var k = KINDS[kind];
    if (!k) throw new Error("Unknown PMS kind: " + kind);
    var row = { id: String(rec.id), data: rec, archived: !!rec.archived };
    if (book) row.book_id = String(book);
    var links = k.links(rec);
    for (var key in links) row[key] = links[key];
    return row;
  }

  function fromRow(row) {
    var rec = Object.assign({}, row && row.data && typeof row.data === "object" ? row.data : {});
    rec.id = row.id;
    rec.archived = !!row.archived;
    // The login link column is the truth (the database resolves old records' logins).
    if (row.auth_user_id) rec.authUserId = row.auth_user_id;
    return rec;
  }

  // What was last saved, per record, so a save sends only changed records and
  // can tell the database which version it is replacing.
  function fingerprint(rec) { return JSON.stringify(rec); }

  function changed(list, synced) {
    var out = [];
    (list || []).forEach(function (rec) {
      if (!rec || rec.id === undefined || rec.id === null || rec.id === "") return;
      var prev = synced[rec.id];
      if (!prev || prev.fp !== fingerprint(rec)) out.push(rec);
    });
    return out;
  }

  return {
    KINDS: KINDS, ORDER: ORDER, COMPANY_BOOK: COMPANY_BOOK,
    uuidOrNull: uuidOrNull,
    toRow: toRow, fromRow: fromRow,
    fingerprint: fingerprint, changed: changed
  };
});
