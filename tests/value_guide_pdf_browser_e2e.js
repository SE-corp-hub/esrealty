"use strict";
/* Value Guide PDF, generated through the REAL browser path: lazy pdf-lib load,
 * ESREALTY_TAX fetch, real Blob, real click on the Download PDF button.
 *
 * The Node suite proves the renderer produces the right pages. Only this can
 * prove the tax data actually reaches the PDF in the browser - a missing script
 * tag or a bad path would silently drop the tax pages and leave Node green.
 *
 * It also re-asserts the side-effect boundary: this tool must never reach the
 * public location-report endpoint, which INSERTs a CRM lead and emails a PDF.
 */
window.__msChecks = [];
window.__msLog = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
setTimeout(function () { window.__msDone = true; }, 240000);

var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
async function waitFor(fn, tries, gap) {
  for (var i = 0; i < tries; i++) { if (fn()) return true; await wait(gap || 150); }
  return fn();
}
function q(s) { return document.querySelector(s); }
function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
function setv(sel, v) {
  var e = q(sel); if (!e) return false;
  e.value = v;
  e.dispatchEvent(new Event("change", { bubbles: true }));
  e.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/* latin1 is needed for reading hex text runs back out of the PDF. */
function latin1(bytes) {
  var s = "";
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

async function pagesOf(bytes) {
  var latin = "";
  for (var i = 0; i < bytes.length; i++) latin += String.fromCharCode(bytes[i]);
  var pages = [];
  var at = 0;
  while (true) {
    var st = latin.indexOf("stream", at);
    if (st < 0) break;
    var p = st + 6;
    if (latin.charCodeAt(p) === 13) p++;
    if (latin.charCodeAt(p) === 10) p++;
    var e = latin.indexOf("endstream", p);
    if (e < 0) break;
    var raw = new Uint8Array(bytes.buffer, bytes.byteOffset + p, e - p);
    /* Read exactly /Length bytes from the stream's dictionary. Trimming trailing
       line breaks instead (DecompressionStream rejects the EOL before "endstream"
       as junk) broke on any page whose compressed data happens to END in byte 10
       or 13: the checksum lost a byte, that page could not be read, and the test
       failed on some days only, because the PDF carries the date it was made. */
    var dict = latin.slice(Math.max(0, st - 400), st);
    var lens = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/g);
    var len = lens ? Number(lens[lens.length - 1].replace(/\D/g, "")) : NaN;
    var slice = raw;
    if (isFinite(len) && len > 0 && len <= raw.length) slice = raw.subarray(0, len);
    else while (slice.length && (slice[slice.length - 1] === 10 || slice[slice.length - 1] === 13)) {
      slice = slice.subarray(0, slice.length - 1);
    }
    var body = "";
    try {
      /* Read the decompressed stream directly. `new Response(stream)` fails
         with "Failed to fetch" here because CDP evaluates this file in an
         isolated world, and a Response cannot consume a stream created in a
         different realm. Using the reader keeps everything in one realm. */
      var ds = new DecompressionStream("deflate");
      var writer = ds.writable.getWriter();
      writer.write(slice); writer.close();
      var reader = ds.readable.getReader();
      var chunks = [];
      for (;;) {
        var part = await reader.read();
        if (part.done) break;
        chunks.push(part.value);
      }
      var totalLen = chunks.reduce(function (a, c) { return a + c.length; }, 0);
      var merged = new Uint8Array(totalLen);
      var off = 0;
      chunks.forEach(function (c) { merged.set(c, off); off += c.length; });
      body = latin1(merged);
    } catch (err) { window.__msInflateErr = (err && err.message) || String(err); body = latin.slice(p, e); }
    var runs = [];
    var re = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
    var m;
    while ((m = re.exec(body)) !== null) {
      var h = m[1].replace(/\s+/g, "");
      var t = "";
      for (var k = 0; k + 1 < h.length; k += 2) t += String.fromCharCode(parseInt(h.substr(k, 2), 16));
      runs.push(t);
    }
    if (runs.length) pages.push(runs.join(" ").replace(/\s+/g, " "));
    at = e + 9;
  }
  return pages;
}

(async function () {
  try {
    var FETCHED = [];
    var ORIG_FETCH = window.fetch;
    window.fetch = function (u, o) {
      try { FETCHED.push(String(u)); } catch (e) {}
      return ORIG_FETCH.apply(this, arguments);
    };

    chk("tax engine script is loaded", !!window.ESREALTY_TAX, typeof window.ESREALTY_TAX);
    chk("pdf renderer is loaded", !!window.ESREALTY_VG_PDF, typeof window.ESREALTY_VG_PDF);

    /* Sign in as super-admin: the wizard is gated on appraisal.view, so
       without this the nav item is hidden and there is nothing to test. */
    await waitFor(function () { return q("#auth-test"); }, 40, 150);
    try { localStorage.removeItem("esrealty_v1"); } catch (e) {}
    try { localStorage.removeItem("esrealty_user"); } catch (e) {}
    var roleSel = q("#auth-role");
    if (roleSel) roleSel.value = "super-admin";
    q("#auth-test").click();
    await wait(900);

    chk("the value guide nav item is reachable as super-admin", !!q('#nav [data-view="value-guide"]'), "");
    if (!q('#nav [data-view="value-guide"]')) { finish(); return; }
    q('#nav [data-dropdown="analysis"]').click();
    await wait(200);
    q('#nav [data-view="value-guide"]').click();
    await waitFor(function () { return q('[data-vg-set="municipality"]'); }, 80, 150);
    chk("the wizard opened", !!q('[data-vg-set="municipality"]'), "");

    var opts = qa('[data-vg-set="municipality"] option').map(function (o) { return o.value; }).filter(Boolean);
    chk("municipality options loaded", opts.length > 0, opts.length + " options");
    setv('[data-vg-set="municipality"]', "BATANGAS CITY");
    await waitFor(function () {
      return qa('[data-vg-set="barangay"] option').length > 1;
    }, 80, 150);
    var brgy = qa('[data-vg-set="barangay"] option').map(function (o) { return o.value; }).filter(Boolean)[0];
    setv('[data-vg-set="barangay"]', brgy);
    await waitFor(function () {
      return qa('[data-vg-set="streetKey"] option').length > 1;
    }, 80, 150);
    var street = qa('[data-vg-set="streetKey"] option').map(function (o) { return o.value; }).filter(Boolean)[0];
    setv('[data-vg-set="streetKey"]', street);
    var cls = qa('[data-vg-set="classification"] option').map(function (o) { return o.value; }).filter(Boolean)[0];
    setv('[data-vg-set="classification"]', cls);
    await wait(400);

    var area = q('[data-vg-set="area"]');
    area.focus(); area.value = "200";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    q('[data-vg-set="barangay"]').focus();
    await waitFor(function () { var b2 = q('[data-vg-next="2"]'); return b2 && !b2.disabled; }, 40, 150);
    chk("stage 1 gates open", q('[data-vg-next="2"]') && !q('[data-vg-next="2"]').disabled, "");

    q('[data-vg-next="2"]').click();
    /* Three steps: step 2 (Details) carries the calculate button directly. */
    await waitFor(function () { return q("[data-vg-calc]"); }, 40, 150);
    q("[data-vg-calc]").click();
    await waitFor(function () { return q("[data-vg-pdf]") || /No estimate available/.test(q("#content").textContent); }, 120, 200);
    chk("a result was produced", !!q("[data-vg-pdf]"), "");
    if (!q("[data-vg-pdf]")) { finish(); return; }

    /* Capture the on-screen total exactly as the reader sees it, so the PDF can be
       checked against it. The HTML prints the market-guide estimate in the primary
       figure; the PDF must print the same number, because a report whose PDF does
       not match its own screen is worse than a wrong estimate. */
    var onScreenTotal = (function () {
      var node = q(".vg-figure-primary b");
      return node ? node.textContent.trim() : "";
    })();
    chk("the on-screen total was captured", /\u20b1/.test(onScreenTotal) && /\d/.test(onScreenTotal),
      onScreenTotal);

    var captured = { bytes: null, name: null };
    var ORIG_CREATE = URL.createObjectURL;
    var ORIG_CLICK = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { captured.name = this.download; return; }
      return ORIG_CLICK.apply(this, arguments);
    };
    URL.createObjectURL = function (blob) {
      if (blob && blob.type === "application/pdf") {
        blob.arrayBuffer().then(function (ab) { captured.bytes = new Uint8Array(ab); });
        return "blob:captured";
      }
      return ORIG_CREATE ? ORIG_CREATE(blob) : "blob:x";
    };
    q("[data-vg-pdf]").click();
    await waitFor(function () { return captured.bytes; }, 200, 150);
    URL.createObjectURL = ORIG_CREATE;
    HTMLAnchorElement.prototype.click = ORIG_CLICK;

    chk("a PDF blob was produced in the browser", !!captured.bytes && captured.bytes.length > 10000,
      captured.bytes ? captured.bytes.length + " bytes" : "no blob");
    if (!captured.bytes) { finish(); return; }
    var magic = latin1(captured.bytes.subarray(0, 5));
    chk("the bytes are a real PDF", magic === "%PDF-", magic);
    chk("the filename uses the current brand", /SEA-ESTATES-Value-Guide-.*\.pdf/.test(captured.name || ""), captured.name || "");

    var pages = await pagesOf(captured.bytes);
    var all = pages.join("\n").replace(/\s+/g, " ");
    chk("text could be read back out of the browser PDF", all.length > 3000,
      all.length + " chars over " + pages.length + " pages" + (window.__msInflateErr ? " | inflate error: " + window.__msInflateErr : ""));

    /* HTML and PDF must show the same total. The PDF collapses spaces and may
       render the peso differently, so the comparison strips non-digit characters
       from both and compares the digit run. The PDF prints the figure in a tile,
       a table row and a final line, so the match is against any occurrence of the
       same digit run rather than a fixed position. */
    var digits = function (s) { return String(s).replace(/[^0-9]/g, ""); };
    var want = digits(onScreenTotal);
    /* Strip non-digits from the whole PDF text too, so comma placement and the
       peso glyph cannot separate the same figure into two pieces. */
    var allDigits = digits(all);
    chk("identical HTML/PDF totals", want.length >= 4 && allDigits.indexOf(want) >= 0,
      "screen " + onScreenTotal + " (PDF digit search for " + want + ")");

    /* The tax reference must have been fetched for the tax pages to exist. */
    chk("the tax reference data was fetched", FETCHED.some(function (u) { return /ph-estate-tax-reference\.json/.test(u); }),
      FETCHED.filter(function (u) { return /tax/i.test(u); }).join(", ") || "none seen");

    var PARTS = [
      { no: "01", title: "Valuation Summary" },
      { no: "02", title: "Detailed Computation and Legal Basis" },
      { no: "03", title: "Tax Implications" },
      { no: "04", title: "Market Analysis and Comparables" },
      { no: "05", title: "Documents and Filing Guide" },
      { no: "06", title: "Negotiation Strategy and Disclaimer" }
    ];
    for (var i = 0; i < PARTS.length; i++) {
      var nm = PARTS[i].title;
      chk("part present: " + nm, new RegExp(nm.replace(/ /g, "\\s")).test(all), "");
    }
    /* The contents block must be on the cover, naming all six parts. */
    chk("cover states what the report contains", /What your report contains/.test(all), "");
    for (var c = 0; c < PARTS.length; c++) {
      chk("contents lists " + PARTS[c].no + " " + PARTS[c].title, all.indexOf(PARTS[c].no + " " + PARTS[c].title) >= 0, "");
    }

    /* The pricing ladder and the market analysis, the two new blocks. */
    chk("pricing strategy ladder present", /Pricing strategy/.test(all), "");
    chk("ladder: lower end of guide range", /LOWER END OF GUIDE RANGE/.test(all), "");
    chk("ladder: central planning estimate", /CENTRAL PLANNING ESTIMATE/.test(all), "");
    chk("ladder: taxes and fees", /TAXES AND FEES/.test(all), "");
    chk("ladder: cash you would receive", /CASH YOU WOULD RECEIVE/.test(all), "");
    chk("ladder: cost allocation separates seller and buyer", /Seller-paid CGT, broker/.test(all) && /buyer-paid/.test(all), "");
    chk("market analysis section present", /Market Analysis and Comparables/.test(all), "");
    chk("match level reported", /Match level/.test(all), "");
    chk("local distribution or an explicit gap", /25th percentile|No municipality distribution is published/.test(all), "");
    chk("legal and regulatory basis present", /Legal and regulatory basis/.test(all), "");
    chk("legal basis cites RA 12001 and the NIRC", /RA 12001/.test(all) && /Sec\. 24\(D\)/.test(all), "");

    /* The two pages this change added. */
    chk("capital gains tax is printed", /Capital gains tax/.test(all), "");
    chk("documentary stamp tax is printed", /Documentary stamp tax/.test(all), "");
    chk("transfer tax is printed with the Local Government Code basis", /Local transfer tax/.test(all) && /Local Government Code/.test(all), "");
    chk("the 24(D) statutory basis for CGT is visible", /24\(D\)/.test(all), "");
    chk("net proceeds are printed", /net proceeds/i.test(all), "");
    chk("estate tax section is printed with conditional deductions", /inherit/i.test(all) && /family-home limit is conditional/.test(all), "");
    chk("filing deadlines printed: 10 after month / 30 / 60 days", /10 days/.test(all) && /close of the month/.test(all) && /30 days/.test(all) && /60 days/.test(all), "");
    chk("filing steps printed", /Certificate Authorizing Registration/.test(all), "");
    chk("seller and buyer checklists printed", /Certificate of Title/.test(all) && /TIN/.test(all), "");
    chk("tax reference version recorded", /2026\.10\.1/.test(all), "");
    chk("states the tax figures are not payable", /not a computation of tax payable/i.test(all), "");
    chk("no PVS 105 compliance is ever claimed", !/FMV per PVS|PVS 105 compliant|PVS 105-compliant|compliant methodology|per PVS 105 standards/i.test(all), "");
    chk("the PVS 105 denial is explicit", /makes no claim of PVS 105 compliance|not a certified appraisal/i.test(all), "");
    chk("RA 12001 still cited", /RA 12001/.test(all), "");

    /* Page numbering must be self-consistent. */
    var pn = all.match(/Page \d+ of \d+/g) || [];
    var totals = {};
    pn.forEach(function (s) { totals[s.split(" of ")[1]] = 1; });
    var uniq = Object.keys(totals);
    chk("every page footer declares the same total", uniq.length === 1, uniq.join(", ") + " (pages=" + pages.length + ")");
    chk("the declared total matches the real page count", uniq.length === 1 && Number(uniq[0]) === pages.length,
      "declared " + uniq[0] + " actual " + pages.length);

    /* Side-effect boundary: unchanged by this work, and worth re-asserting. */
    var bad = FETCHED.filter(function (u) { return /location-report|crm|contacts/i.test(u); });
    chk("no CRM or report endpoint called", bad.length === 0, bad.join(", ") || "none");
    var stored = null;
    try { stored = localStorage.getItem("esrealty_v1"); } catch (e) {}
    chk("no draft persisted", !stored || stored.indexOf('"vg"') < 0, stored && stored.indexOf('"vg"') >= 0 ? "vg in storage" : "vg absent");

    finish();
  } catch (e) {
    chk("runner", false, (e && e.message) || String(e));
    finish();
  }
})();

function finish() {
  window.__msOk = window.__msChecks.every(function (c) { return c.ok; });
  window.__msDone = true;
}
