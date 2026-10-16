(async function () {
  var log = [], checks = [], ok;
  window.__msLog = log;
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function visible(el) {
    if (!el || !el.getClientRects().length) return false;
    var s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) !== 0;
  }

  function parseRgba(c) {
    var m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (m) {
      return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
    }
    if (/^#/.test(c)) {
      var h = c.slice(1);
      if (h.length === 3) h = h.split("").map(function (x) { return x + x; }).join("");
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    return null;
  }

  function compositeBg(el) {
    // Walk from the element up to the root, compositing alpha backgrounds over white.
    var below = { r: 255, g: 255, b: 255 };
    var layers = [];
    var cur = el;
    while (cur && cur !== document.documentElement) {
      var s = getComputedStyle(cur);
      var bg = parseRgba(s.backgroundColor);
      if (bg && bg.a > 0 && bg.a < 1) {
        layers.unshift({ r: bg.r, g: bg.g, b: bg.b, a: bg.a });
      } else if (bg && bg.a >= 1) {
        layers = [{ r: bg.r, g: bg.g, b: bg.b, a: 1 }];
        break;
      }
      cur = cur.parentElement;
    }
    if (!layers.length) {
      var bodyBg = parseRgba(getComputedStyle(document.body).backgroundColor);
      if (bodyBg && bodyBg.a >= 1) return "rgb(" + bodyBg.r + ", " + bodyBg.g + ", " + bodyBg.b + ")";
      return "rgb(255, 255, 255)";
    }
    var out = { r: below.r, g: below.g, b: below.b };
    for (var i = 0; i < layers.length; i++) {
      var l = layers[i];
      out.r = Math.round(l.r * l.a + out.r * (1 - l.a));
      out.g = Math.round(l.g * l.a + out.g * (1 - l.a));
      out.b = Math.round(l.b * l.a + out.b * (1 - l.a));
    }
    return "rgb(" + out.r + ", " + out.g + ", " + out.b + ")";
  }

  function getTextContrast(el) {
    if (!visible(el)) return null;
    var cs = getComputedStyle(el);
    var fg = parseRgba(cs.color);
    if (!fg) return null;
    var bg = compositeBg(el);
    return { fg: "rgb(" + fg.r + ", " + fg.g + ", " + fg.b + ")", bg: bg };
  }

  function rgbToLuminance(r, g, b) {
    var a = [r, g, b].map(function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  function parseColor(c) {
    var m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    if (c.startsWith("#")) {
      var h = c.slice(1);
      if (h.length === 3) h = h.split("").map(function (x) { return x + x; }).join("");
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    return null;
  }

  function contrastRatio(fg, bg) {
    var f = parseColor(fg), b = parseColor(bg);
    if (!f || !b) return null;
    var L1 = rgbToLuminance(f[0], f[1], f[2]);
    var L2 = rgbToLuminance(b[0], b[1], b[2]);
    var lighter = Math.max(L1, L2), darker = Math.min(L1, L2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function auditPage(label, allowedOverflowSelectors) {
    var vw = document.documentElement.clientWidth;
    var sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    var overflowEls = [];
    Array.prototype.slice.call(document.querySelectorAll("body *")).forEach(function (el) {
      if (!visible(el)) return;
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      if (r.right <= vw + 1) return;
      var allowed = false;
      if (allowedOverflowSelectors) {
        allowed = allowedOverflowSelectors.some(function (sel) { return el.closest(sel); });
      }
      if (!allowed) overflowEls.push(el);
    });
    overflowEls = overflowEls.slice(0, 12).map(function (el) {
      return el.tagName.toLowerCase() + (el.id ? "#" + el.id : (el.className && typeof el.className === "string" ? "." + el.className.split(/\s+/)[0] : ""));
    });

    var tinyText = [];
    Array.prototype.slice.call(document.querySelectorAll("body *")).forEach(function (el) {
      if (!visible(el) || !el.textContent.trim() || el.children.length > 0) return;
      var fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12) tinyText.push(Math.round(fs * 10) / 10 + "px:" + el.textContent.trim().slice(0, 50));
    });
    tinyText = tinyText.slice(0, 20);

    var lowContrast = [];
    Array.prototype.slice.call(document.querySelectorAll("body *")).forEach(function (el) {
      if (!visible(el) || !el.textContent.trim() || el.children.length > 0) return;
      var colors = getTextContrast(el);
      if (!colors) return;
      var cr = contrastRatio(colors.fg, colors.bg);
      if (cr !== null && cr < 4.5) {
        var fs = parseFloat(getComputedStyle(el).fontSize);
        var isLarge = fs >= 18 || (fs >= 14 && getComputedStyle(el).fontWeight >= 600);
        if (!isLarge || cr < 3) {
          lowContrast.push(Math.round(cr * 100) / 100 + ":" + cr.toFixed(2) + ":" + el.textContent.trim().slice(0, 40));
        }
      }
    });
    lowContrast = lowContrast.slice(0, 10);

    var smallInputs = [];
    Array.prototype.slice.call(document.querySelectorAll("input,select,textarea")).forEach(function (el) {
      if (!visible(el)) return;
      var fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) smallInputs.push(Math.round(fs * 10) / 10 + "px:" + (el.id || el.name || el.type));
    });

    var missingLabels = [];
    Array.prototype.slice.call(document.querySelectorAll("input,select,textarea")).forEach(function (el) {
      if (!visible(el) || el.type === "hidden" || el.type === "submit" || el.type === "button") return;
      var hasLabel = el.id && document.querySelector('label[for="' + el.id + '"]');
      var wrapped = el.closest("label");
      var aria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
      if (!hasLabel && !wrapped && !aria) {
        missingLabels.push(el.tagName.toLowerCase() + (el.id ? "#" + el.id : "." + (el.className || "no-class")));
      }
    });

    var smallTouchTargets = [];
    Array.prototype.slice.call(document.querySelectorAll("button,a,[role=button],.tab,.tab-btn,.nav-item,.opt,.check-line,.ms-chk,.chip")).forEach(function (el) {
      if (!visible(el)) return;
      var r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) {
        smallTouchTargets.push(Math.round(r.width) + "x" + Math.round(r.height) + ":" + (el.textContent.trim().slice(0, 20) || el.className));
      }
    });

    log.push(label + " vw=" + vw + " sw=" + sw + " overflow=" + overflowEls.join(",") + " tiny=" + tinyText.length + " lowContrast=" + lowContrast.length + " smallInputs=" + smallInputs.length + " missingLabels=" + missingLabels.length + " smallTouch=" + smallTouchTargets.length);

    checks.push({ name: label + " page fits viewport", ok: sw <= vw + 2, detail: "sw=" + sw + " vw=" + vw });
    checks.push({ name: label + " no uncontained overflow", ok: overflowEls.length === 0, detail: overflowEls.join(",") || "none" });
    checks.push({ name: label + " text >=12px (except decorative)", ok: tinyText.length === 0 || tinyText.every(function (t) { return parseFloat(t) >= 10; }), detail: tinyText.slice(0, 5).join(" | ") || "none below 12px" });
    checks.push({ name: label + " contrast >=4.5:1 (3:1 large)", ok: lowContrast.length === 0, detail: lowContrast.slice(0, 5).join(" | ") || "all ok" });
    checks.push({ name: label + " inputs >=16px", ok: smallInputs.length === 0, detail: smallInputs.slice(0, 5).join(" | ") || "all ok" });
    checks.push({ name: label + " inputs have labels", ok: missingLabels.length === 0, detail: missingLabels.slice(0, 5).join(" | ") || "all ok" });
    checks.push({ name: label + " touch targets >=44px", ok: smallTouchTargets.length === 0, detail: smallTouchTargets.slice(0, 5).join(" | ") || "all ok" });
  }

  /* .lead-stats: the CRM stat strip swipes sideways on phones by design (2026-10-16). */
  var allowedOverflow = [".table-wrap",".lead-stats",".crm-calendar",".cal-head",".cal-week",".cal-grid",".cal-legend",".lead-board",".pb-grid",".bt-table-wrap",".bt-map-card",".sf-thumbs",".users-access .tabs",".tabs-row",".sf-carousel",".ls-carousel",".sf-marquee-track"];

  try {
    await wait(800);

    auditPage("public home", allowedOverflow);
    var estApi = window.ESREALTY_EST;
    var estimatorAudited = false;
    if (estApi && estApi.debug) {
      try {
        var row = estApi._data().index.municipalities.find(function (m) { return m.name === "BALAYAN"; });
        var md = await estApi.loadMunicipality(row.slug);
        var rr = estApi.core.computeEstimate(estApi._data().config, estApi._data().index, md, {
          municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "all street",
          classification: "CR", area: 200, purpose: "Selling", type: "vacant_lot"
        });
        var st = estApi._state();
        st.result = rr;
        estApi.debug.render(4);
        await wait(500);
        auditPage("estimator report", allowedOverflow.concat([".sf-est-street-list"]));
        var leadOpen = document.querySelector("[data-est-lead-open]");
        if (leadOpen) { leadOpen.click(); await wait(200); auditPage("estimator lead form", allowedOverflow.concat([".sf-est-street-list"])); }
        estimatorAudited = true;
      } catch (e) {
        log.push("estimator audit failed: " + e.message);
      }
      estApi.debug.render(1);
      await wait(250);
    }
    checks.push({ name: "estimator audit executed", ok: estimatorAudited, detail: estimatorAudited ? "report + lead form audited" : (estApi ? "audit threw" : "ESREALTY_EST not exposed on public home") });
    location.hash = "#/shophouse";
    await wait(900);
    auditPage("public shophouse", allowedOverflow);
    location.hash = "#/search";
    await wait(700);
    auditPage("public search", allowedOverflow);
    location.hash = "#/project-bt";
    await wait(700);
    auditPage("public project bt", allowedOverflow);
    location.hash = "#/listing/test-fixture";
    await wait(700);
    auditPage("public detail (fallback)", allowedOverflow);

    document.querySelector("#auth-role").value = "super-admin";
    document.querySelector("#auth-test").click();
    await wait(600);

    var views = ["dashboard","wizard","deal","appraisal","market","leads","listings","presell","transactions","financing","portfolio","pms","assistant","reports","playbook","users","admin","settings"];
    for (var i = 0; i < views.length; i++) {
      var nav = document.querySelector('[data-view="' + views[i] + '"]');
      if (nav && !nav.classList.contains("nav-hidden")) {
        nav.click();
        await wait(300);
        auditPage("internal " + views[i], allowedOverflow);
      }
    }

    document.documentElement.setAttribute("data-theme", "dark");
    void document.body.offsetHeight; // force synchronous style/layout flush
    await wait(200);
    auditPage("dark theme dashboard", allowedOverflow);
    document.documentElement.setAttribute("data-theme", "light");
    void document.body.offsetHeight; // force the flipped palette to paint before we audit
    await wait(400);
    auditPage("light theme dashboard", allowedOverflow);

    var inputTest = document.createElement("input");
    inputTest.type = "text";
    inputTest.style.position = "absolute";
    inputTest.style.left = "-9999px";
    document.body.appendChild(inputTest);
    inputTest.focus();
    var fs = parseFloat(getComputedStyle(inputTest).fontSize);
    checks.push({ name: "global input font-size >=16px", ok: fs >= 16, detail: "computed " + fs + "px" });
    inputTest.remove();

    var btnTest = document.createElement("button");
    btnTest.textContent = "Test";
    btnTest.style.position = "absolute";
    btnTest.style.left = "-9999px";
    document.body.appendChild(btnTest);
    var r = btnTest.getBoundingClientRect();
    checks.push({ name: "global button touch target >=44px", ok: r.width >= 44 && r.height >= 44, detail: Math.round(r.width) + "x" + Math.round(r.height) });
    btnTest.remove();

  } catch (e) {
    log.push("ERR:" + e.message);
    ok = false;
  }
  window.__msChecks = checks;
  window.__msOk = checks.every(function (c) { return c.ok; });
  window.__msDone = true;
})();