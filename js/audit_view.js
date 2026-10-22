/* Change log wording (roadmap K3).
 * Turns a row of public.audit_events into one plain sentence for the super-admin screen
 * (Users & Access > Change log) and into CSV. UMD: the browser gets window.ESREALTY_AUDIT,
 * Node gets module.exports, so the shipped wording is the wording the test locks.
 *
 * Rows come from migration 0005 (leads, cash entries, role changes), the listing function
 * (listing_*) and the account functions of the baseline (registration_*, assign_broker, ...).
 * owner_id is the person who acted. Nothing here builds HTML: callers escape the text. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ESREALTY_AUDIT = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var GROUPS = [
    { key: "all", label: "Everything" },
    { key: "leads", label: "Leads" },
    { key: "money", label: "Money" },
    { key: "listings", label: "Listings" },
    { key: "people", label: "People & access" }
  ];

  var EVENT_GROUP = {
    lead_created: "leads", lead_assigned: "leads", lead_status: "leads", lead_deleted: "leads",
    cash_posted: "money", cash_voided: "money", cash_status: "money", cash_deleted: "money",
    listing_created: "listings", listing_price: "listings", listing_published: "listings", listing_status: "listings", listing_deleted: "listings",
    role_changed: "people", registration_approved: "people", registration_rejected: "people", assign_broker: "people",
    manual_create: "people", reset_password: "people", cancel_password_reset: "people", pms_find_login: "people", pms_transfer_book: "people",
    deal_created: "money", deal_stage: "money", deal_deleted: "money", pms_payment_added: "money", pms_payment_changed: "money",
    cobroke_proposed: "listings", cobroke_status: "listings",
    announcement_sent: "people"
  };

  function typesInGroup(key) {
    if (!key || key === "all") return [];
    return Object.keys(EVENT_GROUP).filter(function (t) { return EVENT_GROUP[t] === key; });
  }

  function groupOf(eventType) { return EVENT_GROUP[eventType] || "other"; }

  function peso(n) {
    var v = Number(n);
    if (!isFinite(v)) return "";
    return "₱" + v.toLocaleString("en-PH", { maximumFractionDigits: 2 });
  }

  function cap(s) { s = String(s == null ? "" : s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function word(s) { return String(s == null ? "" : s).replace(/_/g, " ").trim(); }
  function short(id) { id = String(id == null ? "" : id); return id.length > 8 ? id.slice(0, 8) : id; }
  var STAGES = { reservation: "Reservation", cts: "Contract to Sell", doas: "Deed of Absolute Sale", done: "Completed" };
  function stage(v) { return STAGES[v] || word(v) || "no stage"; }
  function dir(d) { return d === "in" ? "money in" : d === "out" ? "money out" : "money"; }

  // ctx.name(id) -> a person's name or "" (unknown); ctx.money(n) -> "₱1,000".
  function describe(row, ctx) {
    ctx = ctx || {};
    var name = function (id) { var n = id ? (ctx.name ? ctx.name(id) : "") : ""; return n || (id ? "account " + short(id) : "someone"); };
    var money = ctx.money || peso;
    var d = (row && row.detail && typeof row.detail === "object") ? row.detail : {};
    var type = String((row && row.event_type) || "");
    var target = row ? row.entity_id : "";
    var text;
    switch (type) {
      case "lead_created":
        text = "Created a lead" + (d.source ? " from " + word(d.source) : "") + (d.assigned_to_id ? ", assigned to " + name(d.assigned_to_id) : ", not assigned"); break;
      case "lead_assigned":
        text = "Moved a lead from " + (d.from ? name(d.from) : "nobody") + " to " + (d.to ? name(d.to) : "nobody"); break;
      case "lead_status":
        text = "Changed a lead from " + (word(d.from) || "no status") + " to " + (word(d.to) || "no status"); break;
      case "lead_deleted":
        text = "Deleted a lead" + (d.status ? " (it was " + word(d.status) + ")" : ""); break;
      case "cash_posted":
        text = "Posted " + money(d.amount) + " " + dir(d.direction) + (d.reversal_of ? " as a reversal of an earlier entry" : ""); break;
      case "cash_voided":
        text = "Voided a " + money(d.amount) + " " + dir(d.direction) + " entry"; break;
      case "cash_status":
        text = "Changed a " + money(d.amount) + " " + dir(d.direction) + " entry from " + (word(d.from) || "?") + " to " + (word(d.to) || "?"); break;
      case "cash_deleted":
        text = "Deleted a " + money(d.amount) + " " + dir(d.direction) + " entry" + (d.status ? " (" + word(d.status) + ")" : ""); break;
      case "listing_created":
        text = "Created a listing at " + money(d.price) + (d.published ? ", published" : ", not published") + (d.status ? ", " + word(d.status) : ""); break;
      case "listing_price":
        text = "Changed a listing price from " + money(d.from) + " to " + money(d.to); break;
      case "listing_published":
        text = d.to ? "Published a listing" : "Took a listing off the public site"; break;
      case "listing_status":
        text = "Changed a listing from " + (word(d.from) || "?") + " to " + (word(d.to) || "?"); break;
      case "listing_deleted":
        text = "Deleted a listing" + (d.price != null ? " priced " + money(d.price) : "") + (d.status ? " (" + word(d.status) + ")" : ""); break;
      case "role_changed":
        text = "Changed " + name(target) + "'s role from " + (word(d.from) || "?") + " to " + (word(d.to) || "?"); break;
      case "registration_approved":
        text = "Approved " + name(target) + (d.role ? " as " + word(d.role) : ""); break;
      case "registration_rejected":
        text = "Rejected the registration of " + name(target); break;
      case "assign_broker":
        text = "Set the supervising broker of " + name(target) + (d.broker ? " to " + name(d.broker) : " to none"); break;
      case "manual_create":
        text = "Created an account for " + name(target) + (d.role ? " (" + word(d.role) + ")" : ""); break;
      case "reset_password":
        text = "Reset the password of " + name(target); break;
      case "cancel_password_reset":
        text = "Cancelled the password reset request of " + name(target); break;
      case "pms_find_login":
        text = "Looked up a " + (word(d.role) || "property management") + " login" + (d.found === false ? " (none found)" : ""); break;
      case "pms_transfer_book":
        text = "Moved a property management book from " + name(target) + (d.to ? " to " + name(d.to) : ""); break;
      case "deal_created":
        text = "Opened a deal" + (d.price ? " at " + money(d.price) : "") + (d.stage ? " (" + stage(d.stage) + ")" : ""); break;
      case "deal_stage":
        text = "Moved a deal from " + stage(d.from) + " to " + stage(d.to) + (d.price ? " (" + money(d.price) + ")" : ""); break;
      case "deal_deleted":
        text = "Deleted a deal" + (d.stage ? " at " + stage(d.stage) : ""); break;
      case "pms_payment_added":
        text = "Recorded a " + money(d.amount) + " rent payment" + (d.month ? " for " + d.month : "") + (d.status ? " (" + word(d.status) + ")" : ""); break;
      case "pms_payment_changed":
        text = "Changed a rent payment" + (d.month ? " for " + d.month : "") + " from " + money(d.from_amount) + " " + (word(d.from_status) || "?") + " to " + money(d.to_amount) + " " + (word(d.to_status) || "?"); break;
      case "cobroke_proposed":
        text = "Proposed a co-broke" + (d.split_selling_pct != null ? " with " + d.split_selling_pct + "% to the selling broker" : ""); break;
      case "cobroke_status":
        text = "Changed a co-broke from " + (word(d.from) || "?") + " to " + (word(d.to) || "?"); break;
      case "announcement_sent":
        text = "Sent an announcement to " + (Array.isArray(d.roles) && d.roles.length ? d.roles.map(word).join(", ") : "staff") + (d.recipients != null ? " (" + d.recipients + " people)" : ""); break;
      default:
        text = cap(word(type)) || "Unknown change";
    }
    var record = "";
    if (/^(lead|cash|listing|deal|pms_payment|cobroke)_/.test(type)) record = short(target);
    return {
      id: row ? row.id : null,
      when: row ? row.created_at : "",
      who: name(row ? row.owner_id : ""),
      group: groupOf(type),
      type: type,
      text: text,
      record: record
    };
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    // A cell starting with = + - @ would be run as a formula by a spreadsheet; keep it text.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function toCsv(rows, ctx) {
    var lines = [["When (UTC)", "Who", "Area", "What happened", "Record"].map(csvCell).join(",")];
    (rows || []).forEach(function (r) {
      var x = describe(r, ctx);
      lines.push([x.when, x.who, x.group, x.text, x.record].map(csvCell).join(","));
    });
    return lines.join("\r\n") + "\r\n";
  }

  // The read the screen makes: newest first, one page at a time, optionally one area, and "older than"
  // a row id for the next page (an id cursor, so entries arriving meanwhile cannot shift the pages).
  var COLUMNS = "id, owner_id, event_type, entity_type, entity_id, detail, created_at";
  function query(sb, group, beforeId, pageSize) {
    var q = sb.from("audit_events").select(COLUMNS).order("id", { ascending: false }).limit(pageSize || 50);
    var types = typesInGroup(group);
    if (types.length) q = q.in("event_type", types);
    if (beforeId != null) q = q.lt("id", beforeId);
    return q;
  }

  return { COLUMNS: COLUMNS, query: query, GROUPS: GROUPS, EVENT_GROUP: EVENT_GROUP, typesInGroup: typesInGroup, groupOf: groupOf, describe: describe, toCsv: toCsv, peso: peso };
});
