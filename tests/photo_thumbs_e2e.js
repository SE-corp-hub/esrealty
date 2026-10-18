"use strict";
/* Small copies of listing photos (2026-10-18). A listing card shows the small
   copy (<id>-thumb.jpg) of a photo stored as <id>-full.<ext>; when there is no
   small copy it falls back to the full photo; the form's previews do the same,
   and removing a preview removes the photo itself. Uses the tiny images in
   tests/fixtures/photos. */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 60) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return !!fn(); }
const q = s => document.querySelector(s);
const qa = s => Array.from(document.querySelectorAll(s));
const loaded = img => img && img.complete && img.naturalWidth > 0;

(async () => {
  try {
    location.hash = "#/home";
    await until(() => q("#auth-test"));
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "super-admin";
    q("#auth-test").click();
    await until(() => q("#content") && q("#content").children.length > 0);
    await wait(400);
    const dir = new URL("tests/fixtures/photos/", location.href).href;
    const withCopy = dir + "a-full.png", noCopy = dir + "solo-full.png";
    q('[data-view="listings"]').click(); await wait(600);
    const setv = (sel, v) => { const e = q(sel); if (e) { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); } };
    q("[data-ls-new]").click(); await wait(400);
    setv("#ls-title", "Thumb base"); setv("#ls-m-city", "Quezon City"); setv("#ls-price", "5000000"); setv("#ls-lot", "120"); setv("#ls-floor", "90"); setv("#ls-ed-status", "available");
    const save = Array.from(q("#ls-modal").querySelectorAll("button")).find(x => /Save/i.test(x.textContent)); save.click(); await wait(700);
    const S = window.__ESREALTY_TEST_HELPERS.getState();
    const base = (S.listings || [])[0];
    check("the demo has a listing to copy", !!base);
    const mk = (id, title, photo) => Object.assign(JSON.parse(JSON.stringify(base)), { id, title, photos: [photo], isPublished: true, featured: true, createdAt: new Date().toISOString() });
    S.listings.unshift(mk("ls-thumb-a", "Thumb test A", withCopy), mk("ls-thumb-b", "Thumb test B", noCopy));
    q('[data-view="listings"]').click(); await wait(800);
    const card = id => q('.ls-card[data-ls-open="' + id + '"] img.ls-photo-img');
    await until(() => loaded(card("ls-thumb-a")) && loaded(card("ls-thumb-b")), 50);
    const a = card("ls-thumb-a"), b = card("ls-thumb-b");
    check("card: shows the small copy", !!a && /a-thumb\.jpg$/.test(a.currentSrc || a.src) && loaded(a) && a.naturalWidth === 32, a ? (a.currentSrc || a.src) + " " + a.naturalWidth : "no card");
    check("card: no small copy, the full photo shows instead", !!b && /solo-full\.png$/.test(b.currentSrc || b.src) && loaded(b) && b.naturalWidth === 64, b ? (b.currentSrc || b.src) + " " + b.naturalWidth : "no card");

    // The listing's own page keeps the full photo.
    q('.ls-card[data-ls-open="ls-thumb-a"]').click(); await wait(700);
    const big = q(".ls-photo-big img.ls-photo-img, #ls-carousel img.ls-car-img");
    await until(() => loaded(big), 30);
    check("listing page: the full photo", !!big && /a-full\.png$/.test(big.currentSrc || big.src), big ? big.src : "none");
    const back = q("[data-ls-back]") || q('[data-view="listings"]'); if (back) back.click(); await wait(600);

    // Form previews
    q('[data-view="listings"]').click(); await wait(500);
    q('.ls-card[data-ls-open="ls-thumb-a"]').click(); await wait(500);
    const ed = q('[data-ls-edit="ls-thumb-a"]'); if (ed) ed.click(); await wait(600);
    const prev = q("#ls-photo-previews .ls-photo-thumb img");
    await until(() => loaded(prev), 30);
    check("form: the preview shows the small copy", !!prev && /a-thumb\.jpg$/.test(prev.currentSrc || prev.src), prev ? prev.src : "no preview");
    const rm = q("#ls-photo-previews [data-ls-photo-remove]"); if (rm) rm.click(); await wait(200);
    const left = (q("#ls-photos") || {}).value || "";
    check("form: removing the preview removes the photo itself", !!rm && left.indexOf(withCopy) < 0 && !q("#ls-photo-previews .ls-photo-thumb"), JSON.stringify(left));
  } catch (e) {
    check("runner", false, e && e.stack ? e.stack : String(e));
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
