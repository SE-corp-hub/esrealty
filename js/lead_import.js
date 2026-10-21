/* Lead CSV import (roadmap F6). Reads a spreadsheet saved as CSV into lead records.
 * UMD: the browser gets window.ESREALTY_LEAD_IMPORT, Node gets module.exports, so the test runs
 * the shipped parser. Nothing here saves anything: the app checks duplicates and saves. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ESREALTY_LEAD_IMPORT = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MAX_ROWS = 500;

  // RFC 4180: quoted fields, "" inside quotes, commas and line breaks inside quotes, CRLF or LF.
  function parseCsv(text) {
    var s = String(text == null ? "" : text).replace(/^﻿/, "");
    var rows = [], row = [], field = "", i = 0, q = false;
    while (i < s.length) {
      var ch = s[i];
      if (q) {
        if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === "") { q = true; i++; continue; }
      if (ch === ",") { row.push(field); field = ""; i++; continue; }
      if (ch === "\r" || ch === "\n") {
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
        if (ch === "\r" && s[i + 1] === "\n") i++;
        i++; continue;
      }
      field += ch; i++;
    }
    if (field !== "" || row.length) { row.push(field); if (row.length > 1 || row[0] !== "") rows.push(row); }
    return rows;
  }

  // Header names people actually use, mapped to lead fields.
  var HEADERS = {
    name: ["name", "full name", "fullname", "client", "client name", "lead", "lead name"],
    phone: ["phone", "mobile", "mobile number", "cellphone", "contact number", "contact", "number", "cp"],
    email: ["email", "e-mail", "email address"],
    source: ["source", "lead source", "channel"],
    propertyInterest: ["interest", "interested in", "property interest", "property", "looking for"],
    budget: ["budget", "price range", "budget (php)"],
    notes: ["notes", "note", "remarks", "comments"],
    type: ["type", "lead type"]
  };
  var SOURCES = ["listing", "facebook", "referral", "walk-in", "website", "other"];
  var TYPES = ["buyer", "seller", "renter", "investor"];

  function norm(h) { return String(h || "").trim().toLowerCase().replace(/\s+/g, " "); }

  function headerMap(header) {
    var map = {};
    (header || []).forEach(function (h, i) {
      var n = norm(h);
      Object.keys(HEADERS).forEach(function (field) { if (map[field] == null && HEADERS[field].indexOf(n) >= 0) map[field] = i; });
    });
    return map;
  }

  function money(v) {
    var t = String(v == null ? "" : v).replace(/[₱,\s]/g, "").replace(/php/i, "");
    var m = /^(\d+(?:\.\d+)?)([km])?$/i.exec(t);
    if (!m) return 0;
    var n = Number(m[1]) * (m[2] ? (m[2].toLowerCase() === "m" ? 1e6 : 1e3) : 1);
    return isFinite(n) ? Math.round(n) : 0;
  }

  /* rows: parsed CSV including the header row. Returns { leads, skipped: [{ line, reason }], map, tooMany }.
     A row needs a name and a phone or an email. Line numbers count the header as line 1. */
  function toLeads(rows, opts) {
    var sources = (opts && opts.sources) || SOURCES;
    var out = { leads: [], skipped: [], map: {}, tooMany: false };
    if (!rows || !rows.length) return out;
    var map = headerMap(rows[0]);
    out.map = map;
    if (map.name == null) { out.skipped.push({ line: 1, reason: "no Name column" }); return out; }
    var body = rows.slice(1);
    if (body.length > MAX_ROWS) { out.tooMany = true; body = body.slice(0, MAX_ROWS); }
    var get = function (r, f) { return map[f] == null ? "" : String(r[map[f]] == null ? "" : r[map[f]]).trim(); };
    body.forEach(function (r, k) {
      var line = k + 2;
      var name = get(r, "name").slice(0, 160);
      var phone = get(r, "phone").slice(0, 50), email = get(r, "email").slice(0, 254).toLowerCase();
      if (!name) { out.skipped.push({ line: line, reason: "no name" }); return; }
      if (!phone && !email) { out.skipped.push({ line: line, reason: "no phone or email" }); return; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { out.skipped.push({ line: line, reason: "email looks wrong" }); return; }
      var source = norm(get(r, "source")).replace(/\s+/g, "-");
      var type = norm(get(r, "type"));
      out.leads.push({
        name: name, phone: phone, email: email,
        source: sources.indexOf(source) >= 0 ? source : (source === "fb" ? "facebook" : "other"),
        type: TYPES.indexOf(type) >= 0 ? type : "buyer",
        propertyInterest: get(r, "propertyInterest").slice(0, 200),
        budget: money(get(r, "budget")),
        notes: get(r, "notes").slice(0, 2000),
        line: line
      });
    });
    return out;
  }

  return { MAX_ROWS: MAX_ROWS, parseCsv: parseCsv, headerMap: headerMap, toLeads: toLeads, money: money, SOURCES: SOURCES };
});
