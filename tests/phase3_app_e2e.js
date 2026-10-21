"use strict";
/* Phase 3 app rules: lead paging (F7), lead stage rules and lost reasons (F5), listing quality
 * hints (H4). Demo mode; the paging helper is driven with a fake query that serves 2,345 rows. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }

(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s);
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "super-admin";
    q("#auth-test").click(); await wait(600);
    const H = window.__ESREALTY_TEST_HELPERS;

    // ---- F7: every lead, not the first 1,000
    const all = Array.from({ length: 2345 }, (_, i) => ({ id: "r" + i }));
    const asked = [];
    const fake = () => ({ range(from, to) { asked.push([from, to]); return Promise.resolve({ data: all.slice(from, to + 1), error: null }); } });
    let res = await H.selectAllPages(fake);
    chk("paging reads all 2,345 rows", res.data.length === 2345 && !res.error, String(res.data.length));
    chk("in pages of 1,000", asked.length === 3 && asked[0][0] === 0 && asked[0][1] === 999 && asked[2][0] === 2000, JSON.stringify(asked));
    const exact = Array.from({ length: 1000 }, (_, i) => ({ id: i })); const asked2 = [];
    res = await H.selectAllPages(() => ({ range(f, t) { asked2.push(f); return Promise.resolve({ data: exact.slice(f, t + 1), error: null }); } }));
    chk("exactly 1,000 rows: one more empty page, then stop", res.data.length === 1000 && asked2.length === 2, asked2.join());
    res = await H.selectAllPages(() => ({ range(f) { return Promise.resolve(f === 0 ? { data: exact, error: null } : { data: null, error: { message: "timeout" } }); } }));
    chk("an error on a later page is reported, not hidden", !!res.error && res.data.length === 1000, res.error && res.error.message);

    // ---- F5: stage rules
    chk("no phone or email: cannot move to Site Visit", /phone number or an email/.test(H.leadStageProblem({ status: "contacted", phone: "", email: "" }, "site-visit")));
    chk("with a phone: allowed", H.leadStageProblem({ status: "contacted", phone: "0917 555 0101" }, "site-visit") === "");
    chk("Contacted and Lost need no contact", H.leadStageProblem({ status: "new" }, "contacted") === "" && H.leadStageProblem({ status: "new" }, "lost") === "");
    chk("a lead already at a stage can be saved again", H.leadStageProblem({ status: "offer" }, "offer") === "");
    chk("reason labels", H.leadLostLabel("financing") === "Financing fell through" && H.leadLostLabel("") === "");

    q('[data-view="leads"]').click(); await wait(900);
    chk("lost reasons are counted on the leads page", /Why leads were lost: Price or budget 1/.test((q(".lead-lost-why") || {}).textContent || ""), (q(".lead-lost-why") || {}).textContent);

    // Editor: a new lead without contact cannot start at Offer; Lost needs a reason.
    q("[data-lead-new]").click(); await wait(500);
    q("#ld-name").value = "Gate Tester";
    q("#ld-status").value = "offer";
    Array.from(q("#ld-modal").querySelectorAll("button")).find(b => /Save Lead/.test(b.textContent)).click(); await wait(400);
    chk("editor refuses Offer without a phone or email", !!q("#ld-modal") && !(window.__ESREALTY_TEST_HELPERS.getState().leads || []).some(l => l.name === "Gate Tester"), "");
    q("#ld-status").value = "lost"; q("#ld-status").dispatchEvent(new Event("change", { bubbles: true })); await wait(100);
    chk("choosing Lost shows the reason field", q("#ld-lost-wrap") && !q("#ld-lost-wrap").hidden, "");
    Array.from(q("#ld-modal").querySelectorAll("button")).find(b => /Save Lead/.test(b.textContent)).click(); await wait(400);
    chk("Lost without a reason is refused", !!q("#ld-modal"), "");
    q("#ld-lost").value = "no-response";
    Array.from(q("#ld-modal").querySelectorAll("button")).find(b => /Save Lead/.test(b.textContent)).click(); await wait(600);
    const saved = (H.getState().leads || []).find(l => l.name === "Gate Tester");
    chk("Lost with a reason saves and keeps it", !!saved && saved.status === "lost" && saved.lostReason === "no-response", saved && saved.lostReason);

    // ---- H4: quality hints
    const gaps = H.listingQualityGaps({ dealType: "sale", price: 0, photos: [], city: "", description: "short", lotArea: 0, floorArea: 0 });
    chk("an empty listing lists every gap", gaps.length === 5, gaps.join(" | "));
    const good = H.listingQualityGaps({ dealType: "sale", price: 5000000, photos: ["a", "b", "c"], city: "Lipa", description: "x".repeat(90), lotArea: 120 });
    chk("a complete listing has no gaps", good.length === 0, good.join());
    chk("a rental needs a rent or a price", H.listingQualityGaps({ dealType: "rent", rent: 15000, photos: ["a", "b", "c"], city: "Lipa", description: "x".repeat(90), floorArea: 40 }).length === 0);
    chk("one photo asks for three", H.listingQualityGaps({ dealType: "sale", price: 1, photos: ["a"], city: "Lipa", description: "x".repeat(90), lotArea: 1 }).join() === "at least 3 photos");
  } catch (e) {
    window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) });
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
