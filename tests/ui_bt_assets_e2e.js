"use strict";
/* Storefront image hygiene.
 *
 * Retired with the Project B.T closure (2026-10): the bt1/bt2 photography
 * checks and the local-asset assertions, because the parked page and its
 * images are gone (both recoverable from git history for a relaunch).
 *
 * What remains worth guarding on every shipped storefront change:
 *  - no hotlinked remote photography (the OpenStreetMap tile URL is a
 *    legitimate remote image and is excluded),
 *  - no Unsplash dependency,
 *  - every <img> in the source carries real alt text, or is decorative
 *    inside a control that already has an accessible name.
 */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }

(async () => {
  try {
    const src = await fetch("js/storefront.js").then(r => r.text()).catch(() => "");
    chk("src-source-available", src.length > 0, "could not read js/storefront.js");

    /* ---- no hotlinked remote photography ---- */
    const remoteImgs = Array.from(new Set(
      (src.match(/https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)/gi) || [])
        .filter(u => !/tile\.openstreetmap\.org/.test(u))
    ));
    chk("src-no-remote-images", remoteImgs.length === 0, JSON.stringify(remoteImgs));
    chk("src-no-unsplash", !/unsplash/i.test(src), "storefront.js still references unsplash");

    /* ---- alt text on every storefront <img> ----
       alt="" is allowed in exactly one case: a decorative image inside a control
       that already carries an accessible name (a thumbnail inside a button with
       aria-label). Screen readers announce the control, not the image. */
    const imgTags = src.match(/<img\b[^>]*>/g) || [];
    chk("src-img-tags-found", imgTags.length >= 2, "count=" + imgTags.length);
    imgTags.forEach((tag, i) => {
      const hasAlt = /\balt="[^"]{4,}"/.test(tag);
      if (hasAlt) { chk("src-img-alt-present-" + i, true, ""); return; }
      const at = src.indexOf(tag);
      const before = src.slice(Math.max(0, at - 260), at);
      const labelled = /<button[^>]*aria-label="[^"]{3,}"[^>]*>\s*$/.test(before) || /<a[^>]*aria-label="[^"]{3,}"[^>]*>\s*$/.test(before);
      chk("src-img-alt-or-decorative-" + i, /alt=""/.test(tag) && labelled, "empty alt with no accessible name on the enclosing control: " + tag.slice(0, 90));
    });

    /* ---- the closed page never renders the removed B.T photography ---- */
    location.hash = "#/project-bt";
    await new Promise(r => setTimeout(r, 1800));
    chk("bt-photography-not-visible-while-closed", document.querySelectorAll("img[src*='bt1'], img[src*='bt2']").length === 0,
      "leaked=" + document.querySelectorAll("img[src*='bt1'], img[src*='bt2']").length);
  } catch (e) {
    window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) });
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
