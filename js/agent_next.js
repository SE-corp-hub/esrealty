/* CRM Autopilot "What next" reasoning (deterministic, not an LLM).
 * Given a lead's tick kind (from agentClassify) it returns the due reason, the
 * recommended touch (call / WhatsApp / site visit), a draft message pulled from
 * the matching sales_playbooks row when one exists, and the next scheduled
 * recheck — so the rep sees the agent's reasoning instead of a black box.
 * UMD: browser gets window.ESREALTY_NEXT, Node gets module.exports. Kept split
 * out of app.js so the node test locks the same shipped logic. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ESREALTY_NEXT = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DUE_REASON = {
    "stale-new": "No qualification call yet",
    contacted: "A promised follow-up is due",
    "site-visit": "Keep the booked viewing warm",
    negotiation: "Offer momentum needs a touch",
    closed: "Lead finished — agent paused",
    dormant: "Holding — nothing fabricated"
  };

  var TOUCH = {
    "stale-new": { type: "call", label: "Call to qualify" },
    contacted: { type: "whatsapp", label: "WhatsApp / Viber check-in" },
    "site-visit": { type: "site-visit", label: "Confirm the site visit" },
    negotiation: { type: "call", label: "Call to re-engage on the offer" },
    dormant: { type: "whatsapp", label: "Light WhatsApp nudge" },
    closed: null
  };

  /* Preferred playbook stage per tick kind. Includes both canonical stages and
   * the legacy labels some seeded rows still carry (Qualification/Follow-up). */
  var STAGE_FOR_KIND = {
    "stale-new": ["Initial Consultation", "Lead Generation", "Qualification"],
    contacted: ["Initial Consultation", "Property Matching", "Follow-up", "Lead Generation"],
    "site-visit": ["Site Viewing"],
    negotiation: ["Price Negotiation", "Reservation"],
    dormant: ["Lead Generation", "Initial Consultation"]
  };

  /* Which playbook section is the best draft for each tick kind, with fallbacks. */
  var DRAFT_SECTION = {
    "stale-new": ["openingScript", "followUpSequence"],
    contacted: ["followUpSequence", "openingScript"],
    "site-visit": ["followUpSequence", "openingScript"],
    negotiation: ["closingScript", "objectionResponses", "followUpSequence"],
    dormant: ["followUpSequence", "openingScript"],
    closed: []
  };

  var SECTION_LABEL = {
    objective: "Objective",
    openingScript: "Opening script",
    discoveryQuestions: "Discovery questions",
    qualificationChecklist: "Qualification checklist",
    valueProposition: "Value proposition",
    presentationSteps: "Presentation steps",
    objectionResponses: "Objection-handling responses",
    closingScript: "Closing script",
    followUpSequence: "Follow-up sequence",
    coachingNotes: "Internal coaching notes"
  };

  /* Legacy section keys produced by earlier seed data, mapped to the canonical
   * field names the playbook editor renders. */
  var LEGACY_KEY = {
    opening: "openingScript",
    qualification: "qualificationChecklist",
    propertyDetails: "valueProposition",
    objections: "objectionResponses",
    followUp: "followUpSequence",
    closing: "closingScript",
    coaching: "coachingNotes"
  };

  function stringify(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map(function (item) {
        if (item && typeof item === "object") {
          return (item.trigger ? item.trigger + " — " : "") + (item.response || "");
        }
        return String(item);
      }).join("\n");
    }
    return String(value);
  }

  function dueReason(kind) { return DUE_REASON[kind] || DUE_REASON.dormant; }
  function touchFor(kind) { return Object.prototype.hasOwnProperty.call(TOUCH, kind) ? TOUCH[kind] : TOUCH.dormant; }

  function canonicalKey(key) {
    for (var legacy in LEGACY_KEY) if (LEGACY_KEY[legacy] === key) return legacy;
    return null;
  }

  /* Reads a section by its canonical key, transparently falling back to the
   * legacy key used by older seed rows. */
  function sectionText(playbook, key) {
    if (!playbook || !playbook.sections) return "";
    var sections = playbook.sections;
    if (sections[key]) return stringify(sections[key]);
    var legacy = canonicalKey(key);
    if (legacy && sections[legacy]) return stringify(sections[legacy]);
    return "";
  }

  function normType(value) {
    return String(value || "").toLowerCase().replace(/[^a-z]/g, "");
  }

  function typeMatches(playbookType, leadType) {
    var a = normType(playbookType), b = normType(leadType);
    if (!b) return false;
    if (!a) return false;
    if (a.indexOf("all") >= 0) return true;
    return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
  }

  function leadPropertyType(lead, listing) {
    if (listing && (listing.type || listing.propertyType)) return listing.type || listing.propertyType;
    return (lead && (lead.propertyType || lead.propertyInterest)) || "";
  }

  /* Picks the active playbook that best fits the lead: property type first,
   * then the stage implied by the tick kind, then stage alone, then first. */
  function pickPlaybook(playbooks, lead, listing, kind) {
    var pool = (playbooks || []).slice();
    if (!pool.length) return null;
    var active = pool.filter(function (p) { return p && p.status === "active"; });
    if (active.length) pool = active;
    var leadType = leadPropertyType(lead, listing);
    var stages = STAGE_FOR_KIND[kind] || [];
    var typed = pool.filter(function (p) { return typeMatches(p.propertyType, leadType); });
    var typedStage = typed.filter(function (p) { return stages.indexOf(p.salesStage) >= 0; });
    if (typedStage.length) return typedStage[0];
    if (typed.length) return typed[0];
    var staged = pool.filter(function (p) { return stages.indexOf(p.salesStage) >= 0; });
    if (staged.length) return staged[0];
    return null;
  }

  function firstName(name) {
    var n = String(name || "").trim().split(/\s+/)[0];
    return n || "there";
  }

  function fill(text, lead, listing) {
    var property = (listing && listing.title) || (lead && lead.propertyInterest) || "the unit we discussed";
    return text
      .replace(/\{\{?\s*name\s*\}?\}/gi, firstName(lead && lead.name))
      .replace(/\{\{?\s*property\s*\}?\}/gi, property);
  }

  /* Drafts a message from the matched playbook section, falling back through a
   * short ordered list so a two-line seed row still yields something useful. */
  function draftMessage(playbook, lead, kind, listing) {
    if (!playbook) return { text: "", section: "", label: "" };
    var order = DRAFT_SECTION[kind] || DRAFT_SECTION.dormant;
    for (var i = 0; i < order.length; i++) {
      var text = sectionText(playbook, order[i]);
      if (text) {
        return { text: "Hi " + firstName(lead && lead.name) + ",\n" + fill(text, lead, listing), section: order[i], label: SECTION_LABEL[order[i]] || order[i] };
      }
    }
    return { text: "", section: "", label: "" };
  }

  /* A lead's "next follow-up" is a date (YYYY-MM-DD, from the date picker).
   * Leads saved earlier may hold typed text such as "Fri 10am": that cannot be
   * placed on a calendar, so it counts as a note, never as overdue. */
  function followUpDays(value, now) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(String(value == null ? "" : value).trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var due = new Date(y, mo - 1, d);
    if (due.getFullYear() !== y || due.getMonth() !== mo - 1 || due.getDate() !== d) return null;
    var n = now ? new Date(now) : new Date();
    var today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    return Math.round((due - today) / 86400000);
  }

  /* What to store when a lead is saved. A picked date wins; the old typed text it
   * replaces comes back as `note` so the caller can log it. With no date picked,
   * old typed text is kept as it was and an old date is cleared. */
  function saveFollowUp(picked, old) {
    picked = String(picked == null ? "" : picked).trim();
    old = String(old == null ? "" : old).trim();
    var oldIsNote = old !== "" && followUpDays(old) === null;
    if (picked) return { value: picked, note: oldIsNote ? old : "" };
    return { value: oldIsNote ? old : "", note: "" };
  }

  function whatNext(lead, kind, playbooks, listing) {
    lead = lead || {};
    var touch = touchFor(kind);
    var playbook = playbooks && playbooks.length ? pickPlaybook(playbooks, lead, listing, kind) : null;
    var draft = draftMessage(playbook, lead, kind, listing);
    return {
      kind: kind || "dormant",
      reason: dueReason(kind),
      touch: touch ? touch.type : "",
      touchLabel: touch ? touch.label : "",
      draft: draft.text,
      draftSection: draft.section,
      draftSectionLabel: draft.label,
      playbookTitle: playbook ? (playbook.title || "") : "",
      recheck: (lead.agent && lead.agent.nextRecheck) || lead.agentNextRecheck || ""
    };
  }

  return {
    DUE_REASON: DUE_REASON,
    TOUCH: TOUCH,
    dueReason: dueReason,
    touchFor: touchFor,
    sectionText: sectionText,
    pickPlaybook: pickPlaybook,
    draftMessage: draftMessage,
    followUpDays: followUpDays,
    saveFollowUp: saveFollowUp,
    whatNext: whatNext
  };
});
