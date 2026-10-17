"use strict";
/* Value Guide requests in the back office (2026-10-17). The website only saves
   the request; the team calls the customer, rebuilds the report in the Value
   Guide tool from the customer's inputs, emails the PDF, then marks it sent.
   Checks the lead card badge, the request card, the three steps, the email
   draft link, and that "Prepare report" opens the Value Guide pre-filled. */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 60) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return !!fn(); }
const q = s => document.querySelector(s);

(async () => {
  try {
    location.hash = "#/home";
    await until(() => q("#auth-test"));
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "super-admin";
    q("#auth-test").click();
    await until(() => q("#content") && q("#content").children.length > 0);
    await wait(400);

    const H = window.__ESREALTY_TEST_HELPERS;
    const st = H.getState();
    const now = new Date().toISOString();
    const lead = {
      id: "lead-vg-fixture", ref: "LOC-FIXTURE", name: "Maria Santos", phone: "09171234567", email: "maria@example.com",
      type: "buyer", source: "website", status: "new", channel: "location-analysis",
      serviceRequested: "Location analysis report", createdAt: now, updatedAt: now, activity: [],
      reportStatus: "awaiting-call",
      fullReport: {
        property: { typeLabel: "Vacant lot", type: "vacant_lot", kind: "land", area: 100 },
        location: { town: "BAUAN", barangay: "POBLACION III", address: "BINAY ST" },
        estimate: { marketGuideEstimate: 2352500, low: 1999625, high: 3058250, birZonalValue: 1150000 },
        inputs: { purpose: "Selling", type: "vacant_lot", municipality: "BAUAN", barangay: "POBLACION III", streetKey: "binay st ressurreccion st", allOther: false, classification: "RR", area: 100, corner: false, features: [] }
      }
    };
    st.leads = (st.leads || []).filter(l => l.id !== lead.id).concat([lead]);
    st.view = "leads"; st.leadDetail = null;
    document.querySelector('#nav [data-view="leads"]').click();
    await wait(700);

    const card = q('[data-lead-open="lead-vg-fixture"]');
    check("lead card flags the call to make", !!card && /Call to confirm/.test(card.textContent), card ? card.textContent.slice(0, 120) : "no card");

    card.click();
    await until(() => q("[data-vg-request]"));
    const box = q("[data-vg-request]");
    check("request card shows on the lead", !!box && /Value Guide request/.test(box.textContent));
    check("request card shows the website figures", !!box && /2,352,500/.test(box.textContent) && /1,150,000/.test(box.textContent) && /Poblacion Iii|Poblacion III/i.test(box.textContent), box ? box.textContent.replace(/\s+/g, " ").slice(0, 200) : "");
    check("first step is the call", !!q(".vg-request-steps li.now") && /Call to confirm/.test(q(".vg-request-steps li.now").textContent));
    check("no email draft before the call", !box.querySelector('a[href^="mailto:"]'));

    q("[data-vg-verify]").click();
    await until(() => q(".vg-request-steps li.now") && /Prepare report/.test(q(".vg-request-steps li.now").textContent));
    const after = H.getState().leads.find(l => l.id === lead.id);
    check("Called & verified moves to Prepare report", after.reportStatus === "verified" && /Prepare report/.test(q(".vg-request-steps li.now").textContent));
    check("verifying logs the call and marks the lead contacted", after.status === "contacted" && after.activity.some(a => /confirmed the details/.test(a.text)));
    const mail = q('[data-vg-request] a[href^="mailto:"]');
    check("email draft goes to the customer", !!mail && mail.getAttribute("href").indexOf("mailto:maria%40example.com") === 0, mail ? mail.getAttribute("href").slice(0, 60) : "none");

    q("[data-vg-prepare]").click();
    await wait(800);
    const s2 = H.getState();
    check("Prepare report opens the Value Guide", s2.view === "value-guide", s2.view);
    const f = s2.vg && s2.vg.form;
    check("Value Guide is pre-filled from the request", !!f && f.municipality === "BAUAN" && f.barangay === "POBLACION III" && Number(f.area) === 100 && f.classification === "RR" && f.streetKey === "binay st ressurreccion st", JSON.stringify(f || {}).slice(0, 160));
    check("report is prepared for the customer", s2.vg && s2.vg.preparedFor === "Maria Santos");

    s2.view = "leads"; s2.leadDetail = lead.id;
    document.querySelector('#nav [data-view="leads"]').click();
    await wait(500);
    s2.leadDetail = lead.id;
    document.querySelector('#nav [data-view="leads"]').click();
    await until(() => q("[data-vg-sent]"));
    q("[data-vg-sent]").click();
    await wait(300);
    const done = H.getState().leads.find(l => l.id === lead.id);
    check("Mark report sent completes the request", done.reportStatus === "sent" && done.activity.some(a => /report emailed/i.test(a.text)));
    const back = q("[data-lead-back]");
    if (back) back.click();
    await wait(500);
    const card2 = q('[data-lead-open="lead-vg-fixture"]');
    check("sent requests drop the badge on the card", !!card2 && !/Call to confirm|Report to send/.test(card2.textContent), card2 ? card2.textContent.slice(0, 120) : "no card");
  } catch (e) {
    check("runner", false, e && e.stack ? e.stack.slice(0, 300) : e);
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
