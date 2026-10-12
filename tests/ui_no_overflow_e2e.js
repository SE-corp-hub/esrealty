"use strict";
/* Guards against horizontal overflow on the public storefront, at whatever
 * viewport the driver opened the browser at. tests/run_overflow_sweep.ps1 runs
 * this across the widths that matter.
 *
 * Overflow here is worse than it looks. `.sf-site` sets `overflow-x: clip`, so the
 * page never gains a horizontal scrollbar and the user is never given a way to
 * reach the content - it is simply cut off at the right edge. Two real examples
 * this test was written for:
 *
 *   1. The contact form carried `.sf-reveal-right`, whose resting state is
 *      translateX(38px). Below the fold the IntersectionObserver has not fired,
 *      so that offset is the element's real position: at 320px the form sat at
 *      x=75 in a 320px viewport, taking the name/email/phone/message fields,
 *      the consent checkbox and the submit button off-screen.
 *
 *   2. The results bar is a flex row whose inner group (sort select plus the
 *      Grid/List/Map buttons) had no flex-wrap. At 320px that group was 342px
 *      wide, so the "Map" button ended at x=359 - clipped and partly
 *      unclickable.
 *
 * A single-width run cannot see this class of bug: both defects only appear at
 * 320px, which is why the sweep exists rather than a fixed viewport here.
 */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }

const ROUTES = ["#/home", "#/search", "#/property-value", "#/project-bt"];

(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const vw = document.documentElement.clientWidth;
    const tag = "w" + vw;

    for (const route of ROUTES) {
      location.hash = route;
      await wait(2400);
      const name = route.replace(/[#/]/g, "");

      /* The Search filter bar has three intentional layout modes after its
       * component migration: five fields across on desktop, two columns on
       * tablet, and one readable column on small phones. A one-column form at
       * 800px used to take almost 600px of vertical space; the two-column tablet
       * layout halves that without squeezing phone-sized controls. */
      if (route === "#/search") {
        const form = document.querySelector(".sf-search-form");
        if (!form) {
          chk("search-filter-form-present-" + tag, false, "no .sf-search-form");
        } else {
          const tracks = getComputedStyle(form).gridTemplateColumns.trim().split(/\s+/).length;
          /* Wide screens: five fields + the action share one row (the action is
             inline at the end, so the sticky bar stays short). Tablet: two
             columns with a full-width action row. Phone: one column. */
          const expected = vw <= 600 ? 1 : (vw <= 900 ? 2 : 6);
          chk("search-filter-columns-" + tag, tracks === expected,
            "tracks=" + tracks + " expected=" + expected + " template=" + getComputedStyle(form).gridTemplateColumns);
          const button = form.querySelector("button[type=submit]");
          const cs = getComputedStyle(form);
          const contentWidth = form.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          const buttonBox = button ? button.getBoundingClientRect() : { width: 0, height: 0 };
          const stacked = vw <= 900;
          chk("search-filter-action-" + tag,
            !!button && buttonBox.height >= 44 &&
              (stacked ? buttonBox.width >= contentWidth - 4 : (buttonBox.width >= 120 && buttonBox.width <= contentWidth + 1)),
            "button=" + Math.round(buttonBox.width) + "x" + Math.round(buttonBox.height) + " content=" + Math.round(contentWidth));
        }
      }

      /* Nothing inside the storefront may extend past the viewport. */
      const offenders = await page_overflowing();
      chk("no-overflow-" + name + "-" + tag, offenders.length === 0, offenders.slice(0, 4).join(" ; "));

      /* Belt and braces: the document itself must not scroll sideways either. */
      const scrollable = await page_hScroll();
      chk("no-h-scroll-" + name + "-" + tag, !scrollable, scrollable);

      /* Text clipped INSIDE its own box. This is a different failure from
       * viewport overflow and the check above cannot see it: the element's box
       * sits comfortably within the viewport while its label is cut off. The
       * sticky primary CTA did exactly this on every common phone width -
       * 104px box for 139px of text - because `.sf-sticky a` is
       * `flex: 1 1 0` with `white-space: nowrap`, so the row squeezed the
       * button below the width its own label needed. */
      const clipped = await page_clippedText();
      chk("no-clipped-labels-" + name + "-" + tag, clipped.length === 0, clipped.slice(0, 4).join(" ; "));
    }
  } catch (e) {
    window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message) || e });
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();

function page_overflowing() {
  const w = document.documentElement.clientWidth;
  const out = [];
  const root = document.querySelector(".sf-site");
  if (!root) return ["no .sf-site"];
  root.querySelectorAll("*").forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    if (r.right > w + 2 || r.left < -2) {
      out.push(el.tagName.toLowerCase() + "." + String(el.className || "").split(" ")[0]
        + " [" + Math.round(r.left) + ".." + Math.round(r.right) + "]");
    }
  });
  return [...new Set(out)];
}

function page_hScroll() {
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 2) return "document scrollWidth=" + de.scrollWidth + " > " + de.clientWidth;
  if (document.body && document.body.scrollWidth > de.clientWidth + 2) return "body scrollWidth=" + document.body.scrollWidth;
  return "";
}

/* An interactive element whose content is wider than its own box. Reported for
 * anything that renders a label, not just nowrap text: overflow-x can be hidden
 * by a radius or by a parent's clip, and either way the label is unreadable. */
function page_clippedText() {
  const out = [];
  const root = document.querySelector(".sf-site");
  if (!root) return ["no .sf-site"];
  root.querySelectorAll("a, button, .sf-est-chip, label, span, h1, h2, h3, p, li, b, strong, em").forEach(el => {
    const txt = (el.textContent || "").trim();
    if (!txt) return;
    /* Only leaf-ish elements, so a wide parent holding many lines is not
     * reported once per descendant. */
    if (el.querySelector("a, button, h1, h2, h3, p, li")) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    /* scrollWidth only exceeds clientWidth when content is actually cut off
     * (either axis). 2px of tolerance for sub-pixel rounding. */
    const over = el.scrollWidth - el.clientWidth;
    if (el.clientWidth > 0 && over > 2) {
      out.push(el.tagName.toLowerCase() + "." + String(el.className || "").split(" ")[0]
        + " '" + txt.slice(0, 22) + "' box=" + Math.round(r.width) + " needs=" + el.scrollWidth);
    }
  });
  return [...new Set(out)];
}
