/* Phase 10: duplicate leads and merge (F2), lead score (F4), team targets (F14). */
const fs = require("fs");
const path = require("path");
const A = require("../js/attribution.js");
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });

// F2 groups
const leads = [
  { id: "a", name: "Ana", phone: "0917 123 4567", createdAt: "2026-09-01", status: "new", activity: [{ date: "2026-09-01", text: "Lead created" }], notes: "first" },
  { id: "b", name: "Ana R", phone: "+63 917 123 4567", email: "ana@x.ph", createdAt: "2026-10-01", status: "site-visit", budget: 5000000, calendarEvents: [{ id: "e1", date: "2026-10-30" }] },
  { id: "c", email: "ANA@x.ph ", createdAt: "2026-10-05", status: "lost", notes: "second" },
  { id: "d", phone: "0918 000 0000", createdAt: "2026-10-06" },
  { id: "e", name: "No contact" }
];
const g = A.duplicateGroups(leads);
c("leads sharing a phone OR an email form one group (chained)", g.length === 1 && g[0].map(x => x.id).join() === "a,b,c", JSON.stringify(g.map(x => x.map(l => l.id))));
c("a lead with no phone or email is never grouped", !g[0].some(x => x.id === "e"));
c("the one to keep is the furthest along, then the oldest", A.pickPrimary(g[0]).id === "b" && A.pickPrimary([leads[0], leads[3]]).id === "a");
const m = A.mergeLeads(leads[1], [leads[0], leads[2]], "Demo", "2026-10-22T00:00:00Z");
c("merge keeps the kept lead's id and fields", m.id === "b" && m.name === "Ana R" && m.budget === 5000000 && m.email === "ana@x.ph");
c("merge keeps the earliest creation date and the furthest stage", m.createdAt === "2026-09-01" && m.status === "site-visit");
c("merge joins notes and history and says what was merged", /first/.test(m.notes) && /second/.test(m.notes) && m.activity.some(a => a.text === "Lead created") && /^Merged with Ana, a lead by Demo\.$/.test(m.activity[m.activity.length - 1].text));
c("merge records the merged leads", m.mergedFrom.map(x => x.id).join() === "a,c");
c("merge does not change the originals", leads[1].mergedFrom === undefined && !leads[1].notes);
c("all lost stays lost", A.mergeLeads({ id: "x", status: "lost" }, [{ id: "y", status: "lost" }]).status === "lost");
c("a calendar entry is not copied twice", A.mergeLeads({ id: "x", calendarEvents: [{ id: "e1" }] }, [{ id: "y", calendarEvents: [{ id: "e1" }, { id: "e2" }] }]).calendarEvents.length === 2);
// F4 score
const s1 = A.leadScore(leads[1], Date.parse("2026-10-03"));
c("score: explained points, banded", s1.score === 80 && s1.band === "hot" && s1.reasons.indexOf("+15 viewing booked") !== -1, JSON.stringify(s1));
const s2 = A.leadScore({ status: "new", createdAt: "2026-08-01" }, Date.parse("2026-10-22"));
c("score: an old lead with nothing is cold", s2.score === 0 && s2.band === "cold" && /quiet for \d+ days/.test(s2.reasons.join()), JSON.stringify(s2));
c("closed and lost leads are not scored", A.leadScore({ status: "closed" }).score === null && A.leadScore({ status: "lost" }).band === "lost");
// F14 progress
const p = A.teamProgress([
  { assignedToId: "u1", assignedTo: "Ana", createdAt: "2026-10-02", status: "closed", activity: [{ date: "2026-10-03", text: "Status changed: New → Contacted" }, { date: "2026-10-10", text: "Status changed: Contacted → Site Visit" }, { date: "2026-10-15", text: "Status changed: Site Visit → Offer Submitted" }, { date: "2026-10-20", text: "Status changed: Negotiating → Closed / Won" }] },
  { assignedToId: "u1", assignedTo: "Ana", createdAt: "2026-09-02", activity: [{ date: "2026-09-05", text: "Status changed: New → Contacted" }] },
  { assignedTo: "Ben", createdAt: "2026-10-01", status: "contacted", calendarEvents: [{ type: "showing", status: "completed", date: "2026-10-12" }] },
  { createdAt: "2026-10-01", status: "contacted" }
], "2026-10");
const ana = p.find(r => r.key === "u1"), ben = p.find(r => r.key === "name:Ben");
c("targets: a month's moves are counted per person", ana.contacted === 1 && ana.viewings === 1 && ana.offers === 1 && ana.won === 1, JSON.stringify(ana));
c("targets: other months do not count", p.length === 2);
c("targets: a viewing marked done counts, and a lead created past New counts as contacted", ben.viewings === 1 && ben.contacted === 1, JSON.stringify(ben));
c("targets: best results first", p[0].key === "u1");
// Shipped files
const mig = read("supabase/migrations/0012_duplicate_leads.sql");
c("migration: only leads from outside are checked; it never merges or deletes", /if auth\.uid\(\) is not null then return new; end if;/.test(mig) && !/delete from|update public\.crm_leads/.test(mig));
c("migration: a returning customer goes to their earlier agent only when that person is approved staff", /p\.registration_status = 'approved'\s+and p\.role in \('super-admin', 'broker', 'agent'\)/.test(mig));
c("migration: runs before routing and never stops a lead from saving", /create trigger crm_leads_dedupe before insert/.test(mig) && /exception when others then\s+raise warning 'crm_leads_dedupe/.test(mig));
c("migration: staff can read the targets, only a Super Admin writes them", /key = 'teamTargets' and exists \(select 1 from public\.profiles p where p\.id = auth\.uid\(\)/.test(mig) && /for select to authenticated/.test(mig));
const app = read("js/app.js");
c("the CRM merges only with a confirmation and only leads you can edit", /title: "Merge leads"/.test(app) && /g\.every\(x => leadCanEdit\(x\)\)/.test(app));
c("deleting merged leads goes through the normal delete (change log keeps it)", /for \(const id of gone\) await deleteLeadFromCloud\(id\);/.test(app));
c("targets are saved only by a Super Admin, as a private setting", /upsert\(\{ key: "teamTargets", value, is_public: false \}/.test(app) && /function openTargetsEditor\(\) \{\s+if \(!roleIs\("super-admin"\)\) return;/.test(app));
c("phase 10 browser test is in CI", /-Test phase10_app_e2e/.test(read(".github/workflows/tests.yml")));

const failed = checks.filter(x => !x.ok);
checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : " :: " + x.detail)));
console.log(failed.length ? failed.length + " FAILED" : "ALL PASS");
process.exit(failed.length ? 1 : 0);
