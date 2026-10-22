(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.ESREALTY_ATTR = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Pure attribution + dedupe helpers shared by the CRM (app.js) and the
  // Node-only test suite. Browser/Node compatible and dependency-free.

  var RESP_RE = /create|inquiry|utm|converted|generated/i;

  function digitsOnly(v) {
    return String(v == null ? "" : v).replace(/\D/g, "");
  }

  // Normalize a PH mobile number to plain digits (strips +63/0 prefixes).
  function normPhone(phone) {
    var d = digitsOnly(phone);
    if (!d) return "";
    if (d.indexOf("63") === 0 && d.length > 10) d = d.slice(2);
    while (d.length > 4 && d.charAt(0) === "0") d = d.slice(1);
    return d;
  }

  function normEmail(email) {
    return String(email == null ? "" : email).trim().toLowerCase();
  }

  // Canonical contact keys used for dedupe ("em:" + normalized email and/or
  // "ph:" + normalized phone). A record only dedupes when it carries a key.
  function dedupeKeys(rec) {
    var keys = [];
    var em = normEmail(rec && rec.email);
    if (em) keys.push("em:" + em);
    var ph = normPhone(rec && rec.phone);
    if (ph) keys.push("ph:" + ph);
    return keys;
  }

  function keySig(rec) {
    return dedupeKeys(rec).join("\u0001");
  }

  // True when two records share an email OR a phone number.
  function sharesContact(a, b) {
    var ka = dedupeKeys(a), kb = dedupeKeys(b || {});
    for (var i = 0; i < ka.length; i++) {
      if (kb.indexOf(ka[i]) >= 0) return true;
    }
    return false;
  }

  // First existing lead whose email or phone collides with rec (excluding
  // excludeId, for edits). Returns null when rec carries no contact info.
  function findDuplicateLead(leads, rec, excludeId) {
    leads = leads || [];
    if (!dedupeKeys(rec).length) return null;
    for (var i = 0; i < leads.length; i++) {
      var l = leads[i];
      if (excludeId && l.id === excludeId) continue;
      if (sharesContact(rec, l)) return l;
    }
    return null;
  }

  // Minutes between a lead's createdAt and the first human activity entry
  // (anything that isn't an auto "Lead created"/"inquiry"/"utm" note), or null
  // when there is no response yet.
  function firstResponseMinutes(lead) {
    if (!lead || !lead.createdAt) return null;
    var start = Date.parse(lead.createdAt);
    if (!isFinite(start)) return null;
    var first = null;
    var acts = lead.activity || [];
    for (var i = 0; i < acts.length; i++) {
      var a = acts[i];
      if (!a || !a.date) continue;
      if (RESP_RE.test(String(a.text || ""))) continue;
      var t = Date.parse(a.date);
      if (isFinite(t) && (first === null || t < first)) first = t;
    }
    if (first === null) return null;
    var mins = Math.round((first - start) / 60000);
    return mins >= 0 ? mins : null;
  }

  function isQualified(status) { return status !== "new" && status !== "lost"; }
  function isReservation(status) { return status === "offer" || status === "negotiation"; }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  // Per-ad return on investment. Views/inquiries are the channel-reported ad
  // figures (populated by a sync or a manual log); leads/qualified/visits/
  // reservations/closed roll up from CRM leads stamped with that adId. Visits
  // are completed viewings (status "done") matched through opts.visits.
  function adRoi(ads, leads, opts) {
    opts = opts || {};
    var visits = opts.visits || [];
    leads = leads || [];
    return (ads || []).map(function (ad) {
      ad = ad || {};
      var linked = leads.filter(function (l) { return ad.id && l && l.adId === ad.id; });
      var leadIds = {};
      linked.forEach(function (l) { leadIds[l.id] = true; });
      var qualified = linked.filter(function (l) { return isQualified(l.status); }).length;
      var reservations = linked.filter(function (l) { return isReservation(l.status); }).length;
      var closed = linked.filter(function (l) { return l.status === "closed"; }).length;
      var visitsDone = visits.filter(function (v) { return v && leadIds[v.leadId] && v.status === "done"; }).length;
      var views = num(ad.perfViews);
      var inquiries = num(ad.perfInquiries);
      var cost = num(ad.cost != null ? ad.cost : ad.perfCost);
      return {
        id: ad.id || "",
        title: ad.listingTitle || ad.title || "",
        channel: ad.channel || "",
        status: ad.status || "",
        views: views,
        inquiries: inquiries,
        leads: linked.length,
        qualified: qualified,
        visits: visitsDone,
        reservations: reservations,
        closed: closed,
        viewToInquiry: views ? Math.round(100 * inquiries / views) : null,
        inquiryToReservation: inquiries ? Math.round(100 * reservations / inquiries) : null,
        leadToReservation: linked.length ? Math.round(100 * reservations / linked.length) : null,
        cost: cost,
        costPerInquiry: cost && inquiries ? Math.round(cost / inquiries) : null
      };
    });
  }

  // Roll leads up by source. With perAd, leads carrying adId are grouped under
  // their own ad row (key ad:<id>); each ad row remembers its parent source's
  // rollup via sourceTotal/sourceQualified so the funnel shows both. Every row
  // carries total/qualified/reservations/closed/pct and avgFirstResponse.
  function sourceFunnel(leads, opts) {
    opts = opts || {};
    var rows = {};
    (leads || []).forEach(function (l) {
      var source = l.source || "other";
      var adId = opts.perAd ? (l.adId || "") : "";
      var key = adId ? "ad:" + adId : "src:" + source;
      var r = rows[key] = rows[key] || { key: key, source: source, adId: adId, total: 0, qualified: 0, reservations: 0, closed: 0, frSum: 0, frN: 0 };
      r.total++;
      if (isQualified(l.status)) r.qualified++;
      if (isReservation(l.status)) r.reservations++;
      if (l.status === "closed") r.closed++;
      var fr = firstResponseMinutes(l);
      if (fr !== null) { r.frSum += fr; r.frN++; }
    });
    var arr = Object.keys(rows).map(function (k) { return rows[k]; });
    if (opts.perAd) {
      arr.forEach(function (r) {
        if (r.adId) {
          var parent = rows["src:" + r.source];
          r.sourceTotal = parent ? parent.total : r.total;
          r.sourceQualified = parent ? parent.qualified : r.qualified;
        }
      });
    }
    arr.sort(function (a, b) { return b.total - a.total || a.source.localeCompare(b.source); });
    arr.forEach(function (r) {
      r.pct = r.total ? Math.round(100 * r.qualified / r.total) : 0;
      r.avgFirstResponse = r.frN ? Math.round(r.frSum / r.frN) : null;
    });
    return arr;
  }

  // Best live ad for a lead: exact adId match wins, else a live ad on the
  // lead's listing. Returns null when nothing applies.
  function attributedAd(lead, ads) {
    ads = ads || [];
    lead = lead || {};
    if (lead.adId) {
      var exact = null;
      for (var i = 0; i < ads.length; i++) {
        if (ads[i].id === lead.adId && ads[i].status !== "draft") { exact = ads[i]; break; }
      }
      if (exact) return exact;
    }
    if (lead.listingId) {
      for (var j = 0; j < ads.length; j++) {
        if (ads[j].listingId === lead.listingId && ads[j].status !== "draft") return ads[j];
      }
    }
    return null;
  }

  /* ---- Duplicate leads (roadmap F2) ----
   * Leads that share an email or a phone number belong to one group (A shares a phone with B,
   * B an email with C: all three). Only groups of two or more are returned, each oldest first. */
  function duplicateGroups(leads) {
    leads = (leads || []).filter(function (l) { return l && l.id; });
    var parent = {}, byKey = {};
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function join(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
    leads.forEach(function (l) { parent[l.id] = l.id; });
    leads.forEach(function (l) {
      dedupeKeys(l).forEach(function (k) { if (byKey[k]) join(byKey[k], l.id); else byKey[k] = l.id; });
    });
    var groups = {};
    leads.forEach(function (l) { var r = find(l.id); (groups[r] = groups[r] || []).push(l); });
    var t = function (l) { var v = Date.parse(l.createdAt || ""); return isFinite(v) ? v : 0; };
    return Object.keys(groups).map(function (k) { return groups[k]; })
      .filter(function (g) { return g.length > 1; })
      .map(function (g) { return g.sort(function (a, b) { return t(a) - t(b); }); })
      .sort(function (a, b) { return t(b[b.length - 1]) - t(a[a.length - 1]); });
  }

  var STAGE_ORDER = ["new", "contacted", "site-visit", "offer", "negotiation", "closed"];
  function stageRank(status) { var i = STAGE_ORDER.indexOf(status || "new"); return i < 0 ? -1 : i; }
  // Which lead of a group to keep: the one furthest along the pipeline, then the oldest.
  function pickPrimary(group) {
    return (group || []).slice().sort(function (a, b) {
      return stageRank(b.status) - stageRank(a.status) || (Date.parse(a.createdAt || "") || 0) - (Date.parse(b.createdAt || "") || 0);
    })[0] || null;
  }

  var KEEP = { id: 1, ref: 1, createdBy: 1, createdAt: 1, assignedTo: 1, assignedToId: 1, updatedAt: 1, status: 1, activity: 1, calendarEvents: 1, notes: 1, possibleDuplicateOf: 1, possibleDuplicateName: 1, mergedFrom: 1 };
  function blank(v) { return v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length); }
  /* Merge `others` into a copy of `primary`. Nothing the primary already has is overwritten:
   * empty fields are filled from the others, activity and calendar entries are combined (without
   * repeats), notes are joined, the earliest creation date and the furthest stage are kept
   * ("lost" only when every lead is lost). A note in the activity says what was merged. */
  function mergeLeads(primary, others, who, now) {
    var out = JSON.parse(JSON.stringify(primary || {}));
    others = (others || []).filter(function (o) { return o && o.id && o.id !== out.id; });
    var at = now || new Date().toISOString();
    var seenAct = {}, seenEv = {};
    out.activity = (out.activity || []).slice();
    out.calendarEvents = (out.calendarEvents || []).slice();
    out.activity.forEach(function (a) { seenAct[(a.date || "") + "|" + (a.text || "")] = 1; });
    out.calendarEvents.forEach(function (e) { if (e && e.id) seenEv[e.id] = 1; });
    var notes = out.notes ? [String(out.notes)] : [];
    var earliest = Date.parse(out.createdAt || "") || Infinity;
    others.forEach(function (o) {
      Object.keys(o).forEach(function (k) { if (!KEEP[k] && blank(out[k]) && !blank(o[k])) out[k] = JSON.parse(JSON.stringify(o[k])); });
      (o.activity || []).forEach(function (a) { var key = (a.date || "") + "|" + (a.text || ""); if (!seenAct[key]) { seenAct[key] = 1; out.activity.push(a); } });
      (o.calendarEvents || []).forEach(function (e) { if (e && e.id && !seenEv[e.id]) { seenEv[e.id] = 1; out.calendarEvents.push(e); } });
      if (o.notes && notes.indexOf(String(o.notes)) < 0) notes.push(String(o.notes));
      var c = Date.parse(o.createdAt || "");
      if (isFinite(c) && c < earliest) { earliest = c; out.createdAt = o.createdAt; }
    });
    var all = [primary].concat(others);
    var allLost = all.every(function (l) { return l && l.status === "lost"; });
    var best = all.reduce(function (b, l) { return l && l.status !== "lost" && stageRank(l.status) > stageRank(b) ? l.status : b; }, out.status === "lost" ? "new" : (out.status || "new"));
    out.status = allLost ? "lost" : best;
    if (notes.length) out.notes = notes.join("\n\n");
    out.activity.sort(function (a, b) { return String(a.date || "").localeCompare(String(b.date || "")); });
    out.mergedFrom = (out.mergedFrom || []).concat(others.map(function (o) { return { id: o.id, ref: o.ref || "", name: o.name || "", at: at }; }));
    delete out.possibleDuplicateOf; delete out.possibleDuplicateName;
    out.activity.push({ date: at, text: "Merged with " + others.map(function (o) { return (o.name || "a lead") + (o.ref ? " (" + o.ref + ")" : ""); }).join(", ") + (who ? " by " + who : "") + "." });
    out.updatedAt = at;
    return out;
  }

  /* ---- Lead score (roadmap F4) ----
   * A simple, explained score from what the lead record shows. Every point has a reason the
   * agent can read, so nobody has to trust a black box. Closed and lost leads are not scored. */
  var SOURCE_POINTS = { referral: 15, "walk-in": 15, listing: 10, website: 10, facebook: 5, "fb-marketplace": 5 };
  function leadScore(lead, now) {
    lead = lead || {};
    if (lead.status === "closed") return { score: null, band: "won", reasons: ["Closed / won"] };
    if (lead.status === "lost") return { score: null, band: "lost", reasons: ["Lost"] };
    var t = typeof now === "number" ? now : Date.now();
    var today = new Date(t).toISOString().slice(0, 10);
    var pts = 0, reasons = [];
    function add(n, why) { if (n) { pts += n; reasons.push((n > 0 ? "+" : "") + n + " " + why); } }
    if (normPhone(lead.phone)) add(10, "phone number");
    if (normEmail(lead.email)) add(5, "email");
    if (num(lead.budget) > 0 || num(lead.rentBudget) > 0 || num(lead.askingPrice) > 0 || (lead.budget && String(lead.budget).trim())) add(15, "budget given");
    add(SOURCE_POINTS[lead.source] || 0, "source: " + (lead.source || ""));
    add({ contacted: 10, "site-visit": 25, offer: 35, negotiation: 40 }[lead.status] || 0, "stage: " + (lead.status || "new"));
    var upcoming = (lead.calendarEvents || []).some(function (e) { return e && (e.type || "showing") === "showing" && (e.status || "scheduled") === "scheduled" && String(e.date || "") >= today; });
    if (upcoming) add(15, "viewing booked");
    var last = (lead.activity || []).reduce(function (m, a) { var v = Date.parse(a && a.date || ""); return isFinite(v) && v > m ? v : m; }, Date.parse(lead.createdAt || "") || 0);
    if (last) {
      var days = (t - last) / 86400000;
      if (days <= 7) add(10, "active this week");
      else if (days > 30) add(-15, "quiet for " + Math.floor(days) + " days");
    }
    var score = Math.max(0, Math.min(100, pts));
    return { score: score, band: score >= 60 ? "hot" : score >= 35 ? "warm" : "cold", reasons: reasons };
  }

  /* ---- Team targets (roadmap F14) ----
   * What each person did in one month, read from the leads themselves:
   *   contacted - leads moved on from New (status change in the activity), or created already past New
   *   viewings  - viewings marked done on the calendar, or moves to Site Visit
   *   offers    - moves to Offer Submitted
   *   won       - moves to Closed / Won
   * Each lead counts once per measure per month. People are keyed by the assigned person's id
   * (else their name). month: "YYYY-MM". */
  var MEASURES = ["contacted", "viewings", "offers", "won"];
  function teamProgress(leads, month) {
    var out = {};
    function row(l) {
      var key = l.assignedToId || (l.assignedTo ? "name:" + l.assignedTo : "");
      if (!key) return null;
      return out[key] = out[key] || { key: key, name: l.assignedTo || "", contacted: 0, viewings: 0, offers: 0, won: 0, assigned: 0 };
    }
    (leads || []).forEach(function (l) {
      if (!l) return;
      var r = row(l);
      if (!r) return;
      var got = {};
      if (String(l.createdAt || "").slice(0, 7) === month) r.assigned++;
      (l.activity || []).forEach(function (a) {
        if (!a || String(a.date || "").slice(0, 7) !== month) return;
        var m = /^Status changed: (.+?) \u2192 (.+?)(?: \(|$)/.exec(String(a.text || ""));
        if (!m) return;
        if (/^New$/.test(m[1])) got.contacted = 1;
        if (/^Site Visit/.test(m[2])) got.viewings = 1;
        if (/^Offer/.test(m[2])) got.offers = 1;
        if (/^Closed/.test(m[2])) got.won = 1;
      });
      if (String(l.createdAt || "").slice(0, 7) === month && l.status && l.status !== "new" && l.status !== "lost") got.contacted = 1;
      (l.calendarEvents || []).forEach(function (e) {
        if (e && (e.type || "showing") === "showing" && e.status === "completed" && String(e.date || "").slice(0, 7) === month) got.viewings = 1;
      });
      MEASURES.forEach(function (k) { if (got[k]) r[k]++; });
    });
    return Object.keys(out).map(function (k) { return out[k]; }).sort(function (a, b) { return b.won - a.won || b.offers - a.offers || b.viewings - a.viewings || b.contacted - a.contacted || a.name.localeCompare(b.name); });
  }

  return {
    duplicateGroups: duplicateGroups, pickPrimary: pickPrimary, mergeLeads: mergeLeads, leadScore: leadScore, stageRank: stageRank,
    teamProgress: teamProgress, TARGET_MEASURES: MEASURES,
    normPhone: normPhone,
    normEmail: normEmail,
    dedupeKeys: dedupeKeys,
    keySig: keySig,
    sharesContact: sharesContact,
    findDuplicateLead: findDuplicateLead,
    firstResponseMinutes: firstResponseMinutes,
    isQualified: isQualified,
    isReservation: isReservation,
    adRoi: adRoi,
    sourceFunnel: sourceFunnel,
    attributedAd: attributedAd
  };
});