/* CRM Autopilot "What next" reasoning — node counterpart to the Agent tab box
 * (docs/specs/agent-autopilot.md lines 103-106). Exercises the exact shipped module
 * js/agent_next.js that renders the box, so the due-reason / touch / playbook
 * draft contract cannot drift from what the rep sees. */
const N = require("../js/agent_next.js");

function legacyPlaybook() {
  return {
    id: "pb-1", title: "OFW Pre-Selling Condo Guide", category: "OFW Buyer",
    salesStage: "Initial Consultation", propertyType: "Condominium", status: "active",
    sections: {
      opening: "Kumusta {name}! Which country are you in and when is your next vacation?",
      objections: [{ trigger: "Mahal naman.", response: "Prices rise 10% a year." }, "Plain objection line"]
    }
  };
}

function canonicalPlaybook() {
  return {
    id: "pb-2", title: "Townhouse Guide", category: "End-User",
    salesStage: "Site Viewing", propertyType: "House & Lot", status: "active",
    sections: { followUpSequence: "Day 1: Send {{property}} brochure.\nDay 3: Call." }
  };
}

function run() {
  const checks = [];
  const c = (name, ok, detail, extra) => checks.push({ name, ok, detail: detail + (extra ? " | " + extra : "") });

  c("stale-new due reason", N.dueReason("stale-new") === "No qualification call yet", N.dueReason("stale-new"));
  c("negotiation due reason", N.dueReason("negotiation") === "Offer momentum needs a touch", N.dueReason("negotiation"));
  c("unknown kind falls back to dormant reason", N.dueReason("nope") === N.DUE_REASON.dormant, N.dueReason("nope"));

  c("call touch for stale-new", N.touchFor("stale-new").type === "call", JSON.stringify(N.touchFor("stale-new")));
  c("whatsapp touch for contacted", N.touchFor("contacted").type === "whatsapp", JSON.stringify(N.touchFor("contacted")));
  c("site-visit touch", N.touchFor("site-visit").type === "site-visit", JSON.stringify(N.touchFor("site-visit")));
  c("closed has no touch", N.touchFor("closed") === null, String(N.touchFor("closed")));

  const legacy = legacyPlaybook();
  c("read canonical section", N.sectionText(canonicalPlaybook(), "followUpSequence").indexOf("brochure") >= 0, "canonical");
  c("read legacy section via canonical key", N.sectionText(legacy, "openingScript").indexOf("Kumusta") >= 0, "legacy opening");
  const obj = N.sectionText(legacy, "objectionResponses");
  c("legacy objections array stringified", obj.indexOf("Mahal naman.") >= 0 && obj.indexOf("Plain objection line") >= 0, obj.slice(0, 48));

  const leadCondo = { name: "Nina Reyes", propertyType: "Condominium" };
  const picks = [legacyPlaybook(), canonicalPlaybook()];
  const picked = N.pickPlaybook(picks, leadCondo, null, "contacted");
  c("pick matches property type + kind stage", picked && picked.id === "pb-1", picked ? picked.title : "none");

  const leadTown = { name: "Ben Cruz" };
  const listingTown = { type: "House & Lot", title: "Cavite Townhouse Unit 12" };
  const picked2 = N.pickPlaybook(picks, leadTown, listingTown, "site-visit");
  c("pick follows listing type for site-visit", picked2 && picked2.id === "pb-2", picked2 ? picked2.title : "none");

  c("no playbooks -> null", N.pickPlaybook([], leadCondo, null, "contacted") === null, "empty");
  c("draft message greets the lead by first name", N.draftMessage(legacy, leadCondo, "stale-new", null).text.indexOf("Hi Nina,") === 0, N.draftMessage(legacy, leadCondo, "stale-new", null).text.slice(0, 24));
  const draftPlace = N.draftMessage(canonicalPlaybook(), leadTown, "site-visit", listingTown);
  c("draft fills {{property}} from the listing", draftPlace.text.indexOf("Cavite Townhouse Unit 12") >= 0 && draftPlace.section === "followUpSequence", draftPlace.section);

  const full = N.whatNext({ name: "Nina Reyes", propertyType: "Condominium", agent: { nextRecheck: "2026-10-01T00:00:00.000Z" } }, "stale-new", picks, null);
  c("whatNext carries reason + touch + draft + recheck", full.reason === "No qualification call yet" && full.touch === "call" && full.draft.indexOf("Kumusta") >= 0 && full.recheck === "2026-10-01T00:00:00.000Z", JSON.stringify({ touch: full.touch, pb: full.playbookTitle }));
  c("whatNext without playbooks still recommends a touch", (function () { const r = N.whatNext({ name: "Solo" }, "dormant", [], null); return r.draft === "" && r.touch === "whatsapp"; })(), "graceful degrade");
  c("whatNext for closed exposes no touch", N.whatNext({ name: "Done" }, "closed", picks, null).touch === "", "closed");

  /* Next follow-up: a date counts, typed text is only a note. */
  const noon = new Date(2026, 9, 21, 12, 0);              // 21 Oct 2026, local noon
  const late = new Date(2026, 9, 21, 23, 59);
  const early = new Date(2026, 9, 21, 0, 5);
  c("follow-up: today is 0 days", N.followUpDays("2026-10-21", noon) === 0, String(N.followUpDays("2026-10-21", noon)));
  c("follow-up: today is 0 days late at night", N.followUpDays("2026-10-21", late) === 0, String(N.followUpDays("2026-10-21", late)));
  c("follow-up: today is 0 days just after midnight", N.followUpDays("2026-10-21", early) === 0, String(N.followUpDays("2026-10-21", early)));
  c("follow-up: yesterday is overdue by 1", N.followUpDays("2026-10-20", noon) === -1, String(N.followUpDays("2026-10-20", noon)));
  c("follow-up: next week is 7 days out", N.followUpDays("2026-10-28", noon) === 7, String(N.followUpDays("2026-10-28", noon)));
  c("follow-up: across a month end", N.followUpDays("2026-11-02", noon) === 12, String(N.followUpDays("2026-11-02", noon)));
  c("follow-up: across a year end", N.followUpDays("2027-01-01", noon) === 72, String(N.followUpDays("2027-01-01", noon)));
  c("follow-up: a date with a time still reads as that day", N.followUpDays("2026-10-22T09:30", noon) === 1 && N.followUpDays("2026-10-22 09:30", noon) === 1, "T and space");
  c("follow-up: typed text is not a date", ["Fri 10am", "Mon 2pm", "next week", "Oct 25", ""].every(t => N.followUpDays(t, noon) === null), "free text");
  c("follow-up: empty values are not dates", N.followUpDays(null, noon) === null && N.followUpDays(undefined, noon) === null, "null/undefined");
  c("follow-up: impossible dates are not dates", N.followUpDays("2026-02-30", noon) === null && N.followUpDays("2026-13-01", noon) === null && N.followUpDays("2026-00-10", noon) === null, "Feb 30, month 13, month 0");
  c("follow-up: a leap day is a date", N.followUpDays("2028-02-29", noon) !== null && N.followUpDays("2027-02-29", noon) === null, "2028 yes, 2027 no");
  c("follow-up: defaults to today's clock", (function () { const d = new Date(); const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); return N.followUpDays(iso) === 0; })(), "no `now` given");

  /* Saving the form: a picked date wins, typed text survives until a date replaces it. */
  const sv = N.saveFollowUp;
  c("save: a picked date is stored", sv("2026-10-25", "").value === "2026-10-25" && sv("2026-10-25", "").note === "", JSON.stringify(sv("2026-10-25", "")));
  c("save: a picked date replaces an older date quietly", sv("2026-10-25", "2026-10-22").note === "", JSON.stringify(sv("2026-10-25", "2026-10-22")));
  c("save: a picked date moves old typed text to a note", sv("2026-10-25", "Fri 10am").value === "2026-10-25" && sv("2026-10-25", "Fri 10am").note === "Fri 10am", JSON.stringify(sv("2026-10-25", "Fri 10am")));
  c("save: no date picked keeps old typed text", sv("", "Fri 10am").value === "Fri 10am" && sv("", "Fri 10am").note === "", JSON.stringify(sv("", "Fri 10am")));
  c("save: clearing an old date clears it", sv("", "2026-10-22").value === "" && sv("", "2026-10-22").note === "", JSON.stringify(sv("", "2026-10-22")));
  c("save: nothing picked and nothing before stays empty", sv("", "").value === "" && sv(null, undefined).value === "", "empty");

  const ok = checks.every(x => x.ok) && checks.length >= 35;
  console.log("\n[agent_next_node] " + checks.length + " checks");
  checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : "  " + x.detail)));
  console.log(ok ? "ALL PASS" : "FAILURES PRESENT");
  process.exit(ok ? 0 : 1);
}

run();
