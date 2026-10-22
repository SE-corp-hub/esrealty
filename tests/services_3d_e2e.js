"use strict";
/* Services 3D Light page (services-3d.html) in a real browser.
 * The page is standalone, so the test opens it in a full-screen frame on top of whichever page the
 * runner loaded (same origin, so it can look inside). Works with WebGL (the scene runs) and without
 * it (the page falls back to a gradient and every word stays readable). */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }

(async () => {
  let frame;
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    frame = document.createElement("iframe");
    frame.id = "s3d-test-frame";
    frame.title = "services 3d test";
    frame.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;z-index:2147483000;background:#fff";
    frame.src = "services-3d.html";
    const loaded = new Promise(res => { frame.onload = res; });
    document.body.appendChild(frame);
    await loaded;
    await wait(5500); // fonts time out offline after 2.5 s, then the scene builds
    const w = frame.contentWindow, d = frame.contentDocument, root = d.documentElement;
    const q = s => d.querySelector(s), qa = s => Array.from(d.querySelectorAll(s));

    chk("page loads", !!q("h1") && /property\./.test(q("h1").textContent), (q("h1") || {}).textContent);
    chk("three.js is the local r147 copy", !!w.THREE && String(w.THREE.REVISION) === "147", String(w.THREE && w.THREE.REVISION));
    chk("no request goes to a CDN script", !qa("script[src]").some(s => /^https?:/.test(s.getAttribute("src"))), qa("script[src]").map(s => s.getAttribute("src")).join());
    const gl = !!w.__svc3d, noGl = root.classList.contains("no-gl");
    chk("either the 3D scene runs or the fallback is on", gl !== noGl || (gl && !noGl), "scene=" + gl + " fallback=" + noGl);
    chk("no form and nothing to submit", qa("form").length === 0 && qa("input,select,textarea").length === 0, "forms=" + qa("form").length);

    // every word is readable as text in both modes
    const chaps = qa(".chap");
    chk("nine service sections", chaps.length === 9, String(chaps.length));
    chk("each section has a visible heading, note and button", chaps.every(s => { const h = s.querySelector("h2"), b = s.querySelector("a.btn"); return h && h.offsetHeight > 0 && s.querySelector(".note").offsetHeight > 0 && b && b.offsetHeight >= 44; }), "min button height " + Math.min.apply(null, chaps.map(s => s.querySelector("a.btn").offsetHeight)));
    chk("no horizontal scroll", root.scrollWidth <= w.innerWidth + 1, root.scrollWidth + " vs " + w.innerWidth);

    // buttons lead into the real site
    const hrefs = chaps.map(s => s.querySelector("a.btn").getAttribute("href"));
    chk("buttons lead into the site, not to a dead end", hrefs.every(h => /^\.\/#\/(search|property-value)/.test(h)), hrefs.join(" "));
    const resolved = new URL(hrefs[1], frame.src);
    chk("a button resolves to the main page route", resolved.pathname.replace(/[^/]*$/, "") === location.pathname.replace(/[^/]*$/, "") && /^#\/property-value\?service=sell/.test(resolved.hash), resolved.href);
    const closing = q("#end a.btn");
    chk("closing card opens the real request form", !!closing && /\.\/#\/property-value\?go=form$/.test(closing.getAttribute("href")) && closing.offsetHeight >= 44, closing && closing.getAttribute("href"));
    const tel = q("#ct-phone"), mail = q("#ct-mail");
    chk("phone and email are links", !!tel && /^tel:\+?\d+$/.test(tel.getAttribute("href")) && !!mail && /^mailto:.+@.+/.test(mail.getAttribute("href")), (tel || {}).textContent + " " + (mail || {}).textContent);

    // controls
    const pause = q("#pauseBtn");
    chk("pause control starts on and says what it does", pause && pause.getAttribute("aria-pressed") === "false" && /Pause/.test(pause.textContent), pause && pause.textContent);
    pause.click(); await wait(150);
    chk("pause toggles state and label", pause.getAttribute("aria-pressed") === "true" && /Play/.test(pause.textContent), pause.textContent);
    pause.click(); await wait(150);
    chk("play toggles back", pause.getAttribute("aria-pressed") === "false", pause.getAttribute("aria-pressed"));
    const dots = qa("#dots button");
    chk("nine named dots", dots.length === 9 && dots.every(b => (b.getAttribute("aria-label") || "").length > 3), String(dots.length));
    chk("controls are at least 44 px", [q("#prevBtn"), q("#nextBtn"), pause].every(b => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }), "prev " + Math.round(q("#prevBtn").getBoundingClientRect().height));

    if (gl) {
      // scene on: next walks to the first service and the card on screen matches it
      q("#nextBtn").click(); await wait(3200);
      chk("next moves the tour to service 1 of 9", /^1 of 9$/.test(q("#hudLabel").textContent), q("#hudLabel").textContent);
      chk("the card for that service is the one in focus", chaps[0].classList.contains("on") && !chaps[1].classList.contains("on"), chaps.map(s => s.classList.contains("on") ? 1 : 0).join(""));
      q("#nextBtn").click(); await wait(3200);
      chk("next again reaches service 2 of 9", /^2 of 9$/.test(q("#hudLabel").textContent), q("#hudLabel").textContent);
      q("#prevBtn").click(); await wait(3200);
      chk("previous goes back", /^1 of 9$/.test(q("#hudLabel").textContent), q("#hudLabel").textContent);
      root.style.scrollBehavior = "auto";
      w.scrollTo(0, d.documentElement.scrollHeight); await wait(2500);
      chk("the end of the page shows the closing card with the scene to its side", /Request/.test(q("#hudLabel").textContent) && q("#end h2").getBoundingClientRect().top < w.innerHeight, q("#hudLabel").textContent);
      const canvas = q("#gl");
      chk("the scene canvas is drawn", canvas && canvas.width > 0 && getComputedStyle(canvas).opacity === "1", canvas && canvas.width + "px opacity " + getComputedStyle(canvas).opacity);
    } else {
      chk("fallback hides the scene controls", getComputedStyle(q("#hud")).display === "none" && getComputedStyle(q("#gl")).display === "none", "hud " + getComputedStyle(q("#hud")).display);
      chk("fallback shows the gradient", q(".fallback").offsetHeight > 0, "");
    }
  } catch (e) {
    window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) });
  }
  try { if (frame && frame.parentNode) frame.parentNode.removeChild(frame); } catch (e) { /* noop */ }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
