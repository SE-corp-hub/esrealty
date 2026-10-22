"use strict";
/* ============================================================
   SEA ESTATES — Value Guide PDF renderer
   ------------------------------------------------------------
   Builds the Batangas Value Guide as a downloadable PDF in the
   browser, using a vendored copy of pdf-lib (vendor/pdf-lib/).

   WHY THIS IS NOT THE PUBLIC REQUEST PATH
   A website visitor's guide request goes to the Supabase
   location-report edge function, which saves it as a CRM lead (it
   sends no email; the team calls the customer, builds the report
   here and sends it themselves). That is right for a website
   enquiry and wrong for an internal tool: an operator generating
   a guide for a client would silently create a lead every time.
   This renderer has no network calls at all - the only inputs are
   the estimate and the tax figures the estimator already produced,
   so it cannot reach the CRM, the mailer, or the database.

   REPORT STRUCTURE
   Ten parts, and the cover states them so a reader knows what
   they are holding before they reach a number:
     1 Valuation Summary          the answer, the range, confidence
     2 Detailed Computation       every factor, plus the legal basis
     3 Tax Implications           what a sale costs, and when it is due
     4 Market Analysis            match level, comparables, distribution
     5 Documents and Filing Guide checklists, deadlines, penalties
     6 Negotiation and Disclaimer pricing ladder, sources, limits
     7 Model and Provenance       which model, and what it does not claim
     8 Methodology                the published factors, net included
     9 Construction Basis         replacement cost and its provenance
    10 Comparables, Context Only  our own listings, never an input

   THE FIGURES ARE LABELLED THE WAY THEY ARE
   Two numbers must never be conflated. The BIR zonal value is an
   official tax reference. The market guide estimate is a planning
   figure built from disclosed, unvalidated factors. The report
   states that distinction in the summary, in every figure caption,
   and again in the disclaimer, because this PDF leaves the
   website and can outlive the conversation that explained it.

   Data contract:
     r     the result object from core.computeEstimate()
     meta  { reference, provenance, preparedFor, preparedBy,
             generatedOn, kind, tax, muniRow }
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ESREALTY_VG_PDF = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var finance = typeof module === "object" && module.exports ? require("./value_guide_finance.js") : globalThis.ESREALTY_FINANCE;
  /* The applied multiple, and every word published about it, is owned by
     js/value_guide_reference.js. Bound here exactly as js/estimator.js binds
     it, so the HTML result screen, the report build-up and this PDF all read
     one disclosure and cannot word it three different ways. */
  var referenceTools = typeof module === "object" && module.exports ? require("./value_guide_reference.js") : window.ESREALTY_REFERENCE;

  /* The standard PDF fonts are WinAnsi-encoded and cannot represent U+20B1.
     Every peso figure is written as "PHP " for the same reason the emailed
     report does it; the HTML guide keeps the real ₱. */
  var A4 = [595.28, 841.89];
  var M = 46;
  var FOOT = 40;

  function fmtMoney(n) {
    var v = Number(n || 0);
    if (!isFinite(v)) return "PHP 0";
    return "PHP " + new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(Math.round(v));
  }
  function fmtNum(n, dp) {
    var v = Number(n || 0);
    return isFinite(v) ? v.toFixed(dp == null ? 2 : dp) : "0";
  }
  function fmtArea(n) {
    var v = Number(n || 0);
    return (isFinite(v) ? v : 0) + " sqm";
  }
  function esc(s) { return String(s == null ? "" : s); }

  /* WinAnsi cannot encode the peso sign (U+20B1), the minus sign (U+2212) or
     the arrow (U+2192). Encoding one throws mid-render and produces NO file at
     all, so the document silently fails to generate. Rather than rely on every
     call site remembering, text is sanitised at the draw boundary. */
  var SUBS = {
    "\u20B1": "PHP ", "\u2212": "-", "\u2013": "-", "\u2014": "-",
    "\u2192": ">", "\u2190": "<", "\u2022": "*", "\u00B7": "-",
    "\u2026": "...", "\u2018": "'", "\u2019": "'", "\u201C": '"', "\u201D": '"',
    "\u00A0": " ", "\u200B": ""
  };
  function safe(s) {
    return String(s == null ? "" : s)
      .replace(/[\u20B1\u2212\u2013\u2014\u2192\u2190\u2022\u00B7\u2026\u2018\u2019\u201C\u201D\u00A0\u200B]/g, function (ch) {
        return Object.prototype.hasOwnProperty.call(SUBS, ch) ? SUBS[ch] : "";
      })
      .replace(/[\u0100-\uFFFF]/g, "");
  }

  /* Conservative vertical extents of a Helvetica line, as fractions of its
     font size: ink runs from the ascender above the baseline to the descender
     below it. */
  var ASC = 0.78, DESC = 0.24;

  /* pdf-lib has no text wrapping, so measure and break on the font itself
     rather than guessing character counts. */
  function wrap(font, text, size, maxWidth) {
    var words = safe(text).split(/\s+/).filter(Boolean);
    var lines = [], cur = "";
    for (var i = 0; i < words.length; i++) {
      var probe = cur ? cur + " " + words[i] : words[i];
      if (font.widthOfTextAtSize(probe, size) <= maxWidth) { cur = probe; continue; }
      if (cur) lines.push(cur);
      /* A single word longer than the line (a long URL, a filename) is hard
         broken rather than allowed to run off the page. */
      var word = words[i];
      while (font.widthOfTextAtSize(word, size) > maxWidth && word.length > 1) {
        var take = word.length;
        while (take > 1 && font.widthOfTextAtSize(word.slice(0, take), size) > maxWidth) take--;
        lines.push(word.slice(0, take));
        word = word.slice(take);
      }
      cur = word;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /* ============================================================
     The ten parts, and how each is described on the cover
     ============================================================ */
  var PARTS = [
    { key: "summary", no: "01", title: "Valuation Summary", blurb: "The estimate, the range, and how much weight it carries." },
    { key: "computation", no: "02", title: "Detailed Computation and Legal Basis", blurb: "Every factor multiplied out, with the authorities behind them." },
    { key: "tax", no: "03", title: "Tax Implications", blurb: "Estimated selling costs, net proceeds, and the filing deadlines." },
    { key: "market", no: "04", title: "Market Analysis and Comparables", blurb: "Match level, comparable listings, and where this sits locally." },
    { key: "documents", no: "05", title: "Documents and Filing Guide", blurb: "What is needed, who to ask, and what late costs." },
    { key: "negotiation", no: "06", title: "Negotiation Strategy and Disclaimer", blurb: "Pricing reference points, sources, limits, and disclaimers." },
    /* Appended when the Value Guide moved to the three-step reference model.
       The first six parts are the reference report's own structure and keep
       their published numbers and order; these four carry what the new model
       has to disclose. Titles avoid regex metacharacters because
       tests/value_guide_pdf_node.js builds an unescaped selector from them. */
    { key: "model", no: "07", title: "Model and Provenance", blurb: "Which model produced the figure, and what it does not claim." },
    { key: "methodology", no: "08", title: "Methodology: Published Factors", blurb: "Each published question, its applied percentage, and the net." },
    { key: "construction", no: "09", title: "Construction Basis", blurb: "Replacement cost, useful life, depreciation, provenance." },
    { key: "comparables", no: "10", title: "Comparables, Context Only", blurb: "Our own listings, shown for context, never as an input." }
  ];

  function build(lib, doc, r, meta, pageCount) {
    var rgb = lib.rgb;
    return Promise.all([
      doc.embedFont("Helvetica"),
      doc.embedFont("Helvetica-Bold")
    ]).then(function (fonts) {
      var font = fonts[0];
      var bold = fonts[1];
      pageCount = pageCount || { total: 0, starts: {} };

      var page = null, W = A4[0], H = A4[1], y = 0;
      var pageNo = 0;
      var sectionKey = "";
      var sectionTitle = "";

      var navy = rgb(0.07, 0.06, 0.05);
      var tan = rgb(0.71, 0.32, 0.12);
      var gray = rgb(0.40, 0.37, 0.34);
      var faint = rgb(0.56, 0.53, 0.50);
      var rule = rgb(0.88, 0.86, 0.83);
      var ruleSoft = rgb(0.94, 0.93, 0.91);
      var panel = rgb(0.975, 0.970, 0.960);
      var accent = rgb(0.99, 0.985, 0.975);
      var cool = rgb(0.55, 0.55, 0.55);

      /* ---- page furniture ---- */
      function newPage(title, continued) {
        page = doc.addPage(A4);
        W = page.getWidth(); H = page.getHeight();
        var raw = page.drawText.bind(page);
        page.drawText = function (txt, o) { return raw(safe(txt), o); };
        pageNo++;
        y = H - M;
        if (title) {
          /* A section that runs onto a second sheet says so, so the reader can
             tell "continued" from a mistake in pagination. */
          if (!continued) pageCount.starts[sectionKey] = pageNo;
          pageHeader(continued ? title + ", continued" : title);
        }
        pageFooter();
      }

      function pageHeader(title) {
        page.drawText("SEA ESTATES", { x: M, y: y, size: 8, font: bold, color: tan });
        var right = r.municipality + "  ·  RDO " + r.rdo;
        page.drawText(right, { x: W - M - font.widthOfTextAtSize(right, 7.6), y: y, size: 7.6, font: font, color: faint });
        y -= 7;
        page.drawRectangle({ x: M, y: y, width: W - M * 2, height: 0.75, color: rule });
        y -= 18;
        page.drawText(title, { x: M, y: y, size: 12.5, font: bold, color: navy });
        page.drawRectangle({ x: M, y: y - 5, width: 44, height: 2, color: tan });
        y -= 22;
      }

      function pageFooter() {
        var y0 = FOOT - 14;
        page.drawRectangle({ x: M, y: y0 + 11, width: W - M * 2, height: 0.5, color: ruleSoft });
        page.drawText("Planning estimate, not a certified appraisal  ·  prepared " + (meta && meta.generatedOn ? meta.generatedOn : ""),
          { x: M, y: y0, size: 7.2, font: font, color: faint });
        var pn = "Page " + pageNo + (pageCount.total ? " of " + pageCount.total : "");
        page.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, 7.2), y: y0, size: 7.2, font: font, color: faint });
      }

      /* ensure() starts a new sheet keeping the current part; newSection() starts a
         new sheet under a new heading. The running title is tracked separately
         from the part key so a continuation header reads "Documents and Filing
         Guide, continued" rather than leaking the internal key. */
      function ensure(space) { if (y < FOOT + 16 + space) newPage(sectionTitle, true); }
      function newSection(key) {
        sectionKey = key;
        var p = null;
        for (var i = 0; i < PARTS.length; i++) if (PARTS[i].key === key) p = PARTS[i];
        sectionTitle = p ? p.title : "";
        newPage(sectionTitle, false);
      }
      function gap(n) { y -= (n || 10); }

      /* ---- blocks ---- */
      function eyebrow(text) {
        ensure(22);
        page.drawText(String(text).toUpperCase(), { x: M, y: y, size: 7.4, font: bold, color: tan });
        y -= 6;
        page.drawRectangle({ x: M, y: y, width: 26, height: 1.5, color: tan });
        y -= 13;
      }

      /* A sub-heading. The full line height is consumed, not a guessed offset:
         a fixed "y -= 14" left the heading's descender inside the next table
         header band, which reads as overlapping words. */
      function heading(text, opts) {
        opts = opts || {};
        var size = opts.small ? 10 : 11.5;
        var lineH = size * ASC + size * DESC;
        ensure(lineH + (opts.small ? 18 : 24));
        page.drawText(text, { x: M, y: y - size * ASC, size: size, font: bold, color: navy });
        y -= lineH;
        if (!opts.small) {
          y -= 4;
          page.drawRectangle({ x: M, y: y, width: 34, height: 1.5, color: rule });
        }
        y -= opts.small ? 10 : 12;
      }

      /* Body text. The cursor is lowered by the ascender BEFORE drawing, so ink
         always starts below whatever was drawn previously. Drawing at the
         cursor instead let each paragraph rise into the block above it. */
      function para(text, size, color) {
        size = size || 8.4; color = color || gray;
        var lines = wrap(font, String(text || ""), size, W - M * 2);
        for (var i = 0; i < lines.length; i++) {
          ensure(size * (ASC + DESC) + 4);
          y -= size * ASC;
          page.drawText(lines[i], { x: M, y: y, size: size, font: font, color: color });
          y -= size * DESC + 3.4;
        }
      }

      /* A tinted callout with an accent bar. */
      function box(lines, barColor) {
        var size = 8.2;
        var maxW = W - M * 2 - 28;
        var prepared = [];
        for (var i = 0; i < lines.length; i++) {
          var w = wrap(font, lines[i], size, maxW);
          for (var k = 0; k < w.length; k++) prepared.push(w[k]);
        }
        var padTop = 11, padBot = 11;
        var contentH = prepared.length * (size * ASC + size * DESC + 3.2);
        var total = padTop + contentH + padBot;
        ensure(total + 6);
        var contentTop = y - padTop;
        page.drawRectangle({ x: M, y: contentTop - contentH, width: W - M * 2, height: total, color: panel });
        page.drawRectangle({ x: M, y: contentTop - contentH, width: 2.5, height: total, color: barColor || tan });
        var yy = contentTop;
        for (var j = 0; j < prepared.length; j++) {
          yy -= size * ASC;
          page.drawText(prepared[j], { x: M + 14, y: yy, size: size, font: font, color: gray });
          yy -= size * DESC + 3.2;
        }
        y = contentTop - contentH - padBot;
        gap(13);
      }

      /* label | value, value wrapped into a right column. Follows the same
         cursor contract as para(): the cursor is the top edge of the next ink. */
      function line(label, value, opts) {
        opts = opts || {};
        var labelW = opts.labelW || 160;
        value = value == null || value === "" ? "-" : String(value);
        var size = 8.4;
        var lines = wrap(font, value, size, W - M * 2 - labelW);
        var rowH = Math.max(1, lines.length) * (size * ASC + size * DESC + 4);
        ensure(rowH + 4);
        var top = y - size * ASC;
        page.drawText(label, { x: M, y: top, size: size, font: bold, color: gray });
        var yy = top;
        for (var i = 0; i < lines.length; i++) {
          page.drawText(lines[i], { x: M + labelW, y: yy, size: size, font: font, color: opts.valueColor || navy });
          yy -= size * ASC + size * DESC + 4;
        }
        y = top - size * DESC - 5;
      }

      /* A real table. `align` right-aligns money columns, which is what makes
         figures scannable down a column instead of ragged-left. */
      function table(headers, rows, widths, opts) {
        opts = opts || {};
        headers = headers || [];
        var align = opts.align || [];
        var size = opts.size || 8.1;
        var padY = opts.padY == null ? 5 : opts.padY;
        var total = widths.reduce(function (a, b) { return a + b; }, 0);
        var scale = (W - M * 2) / total;
        var cols = widths.map(function (w) { return Math.floor(w * scale); });

        function colX(i) {
          var x = M;
          for (var c = 0; c < i; c++) x += cols[c];
          return x;
        }
        function place(text, i, yy, opts2) {
          var right = align[i] === "r";
          var inner = cols[i] - 10;
          var xx = right ? colX(i) + cols[i] - 5 - font.widthOfTextAtSize(text, size) : colX(i) + 5;
          page.drawText(text, { x: xx, y: yy, size: size, font: opts2.font || font, color: opts2.color || gray });
          return inner;
        }
        function drawHeader() {
          if (!headers.length) return;
          var hSize = size - 0.5;
          var pad = 5;
          var lineH = hSize * ASC + hSize * DESC;
          ensure(lineH + pad * 2 + 10);
          /* The baseline is placed BELOW the cursor. An earlier version put it
             7pt above, so the header band rose into whatever had just been
             drawn - which is how "Legal and regulatory basis" ended up printed
             on top of the table's own column titles. */
          var baseline = y - pad - hSize * ASC;
          page.drawRectangle({ x: M, y: baseline - hSize * DESC - pad, width: W - M * 2, height: lineH + pad * 2, color: panel });
          for (var c = 0; c < headers.length; c++) {
            var right = align[c] === "r";
            var hx = right ? colX(c) + cols[c] - 5 - font.widthOfTextAtSize(headers[c], hSize) : colX(c) + 5;
            page.drawText(headers[c], { x: hx, y: baseline, size: hSize, font: bold, color: gray });
          }
          y = baseline - hSize * DESC - pad;
          page.drawRectangle({ x: M, y: y + 3, width: W - M * 2, height: 0.75, color: rule });
          y -= 5;
        }
        drawHeader();

        for (var ri = 0; ri < rows.length; ri++) {
          var wrapped = [], maxLines = 1;
          for (var c2 = 0; c2 < rows[ri].length; c2++) {
            var cellW = cols[c2] - 12;
            var wl = wrap(font, String(rows[ri][c2] == null ? "" : rows[ri][c2]), size, Math.max(20, cellW));
            wrapped.push(wl);
            if (wl.length > maxLines) maxLines = wl.length;
          }
          var lead = size * ASC + size * DESC + 1.2;
          var rowH = maxLines * lead + padY * 2;
          if (y - rowH < FOOT + 16) { newPage(sectionTitle, true); drawHeader(); }
          if (ri % 2 === 1) {
            page.drawRectangle({ x: M, y: y - rowH + padY, width: W - M * 2, height: rowH - padY, color: panel });
          }
          /* Same cursor contract as every other block: the row's ink starts below y.
             Each column gets its OWN cursor. Sharing one cursor across columns
             meant a cell that wrapped to two lines pushed every later cell in
             the row down, so the amount and "paid to" landed inside whatever
             followed the table. */
          var contentTop = y - padY;
          for (var c3 = 0; c3 < wrapped.length; c3++) {
            var yy2 = contentTop;
            for (var li = 0; li < wrapped[c3].length; li++) {
              yy2 -= size * ASC;
              var first = li === 0;
              var strong = opts.boldFirstCol && c3 === 0 && first;
              place(wrapped[c3][li], c3, yy2, {
                font: strong ? bold : font,
                color: strong ? navy : (first ? gray : navy)
              });
              yy2 -= size * DESC + 1.2;
            }
          }
          y -= rowH;
        }
        /* Enough clearance for the next paragraph's ascender plus its own gap,
           measured rather than assumed - an 11pt gap put following body text
           inside the last row's descender. */
        gap(size * ASC + 12);
      }

      /* Lay a stack of lines out top-down from `top`, returning the y below the
         last line. Baselines are DERIVED from font size rather than hardcoded,
         which is the whole point: hardcoded baselines collide as soon as a size
         changes. A 15pt value has an 11.7pt ascender, so a caption placed 2pt
         below its baseline lands inside its glyphs - which is exactly how the
         pricing ladder rendered "words on top of each other". */
      function stackHeight(lines) {
        var h = 0;
        for (var i = 0; i < lines.length; i++) {
          var L = lines[i];
          if (!L || L.text == null || L.text === "") continue;
          h += L.size * ASC + L.size * DESC + (L.gap == null ? 5 : L.gap);
        }
        return h - (lines.length ? (lines[lines.length - 1].gap == null ? 5 : lines[lines.length - 1].gap) : 0);
      }
      function stack(x, top, lines) {
        var cur = top;
        for (var i = 0; i < lines.length; i++) {
          var L = lines[i];
          if (!L || L.text == null || L.text === "") continue;
          var s = L.size;
          cur -= s * ASC;
          var xx = L.right != null ? L.right - font.widthOfTextAtSize(L.text, s) : x;
          page.drawText(L.text, { x: xx, y: cur, size: s, font: L.font || font, color: L.color || gray });
          cur -= s * DESC + (L.gap == null ? 5 : L.gap);
        }
        return cur;
      }

      /* Shrink a single-line value until it fits `maxW`, or give up at `min`.
         Needed because tiles and figure panels sit side by side: a long range
         like "PHP 3,060,000 - PHP 4,590,000" drawn at one size runs out of its
         own column and lands on top of the neighbour. */
      function fitSize(f, text, maxW, desired, min) {
        var s = desired;
        while (s > (min || 6) && f.widthOfTextAtSize(text, s) > maxW) s -= 0.25;
        return s;
      }

      /* Stat tiles across the top of a page. */
      function tiles(items) {
        var gapW = 9;
        var tw = (W - M * 2 - gapW * (items.length - 1)) / items.length;
        var padX = 11, padTop = 12, padBot = 12;
        var h = 0;
        for (var t = 0; t < items.length; t++) {
          var it = items[t];
          var vSize = fitSize(bold, it.value, tw - padX * 2, it.small ? 12 : 13.5, 7);
          var lines = [
            { text: String(it.label).toUpperCase(), size: 6.8, font: bold, color: gray, gap: 4 },
            { text: it.value, size: vSize, font: bold, color: navy, gap: it.sub ? 3 : 0 }
          ];
          if (it.sub) {
            var sl = wrap(font, it.sub, 6.9, tw - padX * 2);
            lines.push({ text: sl[0] || "", size: 6.9, color: faint });
          }
          h = Math.max(h, stackHeight(lines));
        }
        var boxH = h + padTop + padBot;
        ensure(boxH + 6);
        var contentTop = y - padTop;
        for (var i = 0; i < items.length; i++) {
          var f = items[i];
          var x0 = M + i * (tw + gapW);
          page.drawRectangle({ x: x0, y: contentTop - h, width: tw, height: boxH, color: accent });
          page.drawRectangle({ x: x0, y: contentTop - h, width: 2, height: boxH, color: f.accent || tan });
          var vSize2 = fitSize(bold, f.value, tw - padX * 2, f.small ? 12 : 13.5, 7);
          var lines2 = [
            { text: String(f.label).toUpperCase(), size: 6.8, font: bold, color: gray, gap: 4 },
            { text: f.value, size: vSize2, font: bold, color: navy, gap: f.sub ? 3 : 0 }
          ];
          if (f.sub) {
            var s2 = wrap(font, f.sub, 6.9, tw - padX * 2);
            lines2.push({ text: s2[0] || "", size: 6.9, color: faint });
          }
          stack(x0 + padX, contentTop, lines2);
        }
        y = contentTop - h - padBot;
        gap(15);
      }

      /* Two figures side by side, deliberately unequal in weight. */
      function sideBySide(a, b) {
        var bw = (W - M * 2 - 11) / 2;
        var padX = 12, padTop = 12, padBot = 12;
        var h = 0;
        [a, b].forEach(function (f) {
          var vSize = fitSize(bold, f.value, bw - padX * 2, f.big ? 17 : 14.5, 8);
          var lines = [
            { text: f.label.toUpperCase(), size: 7.2, font: bold, color: gray, gap: 5 },
            { text: f.value, size: vSize, font: bold, color: navy, gap: 4 }
          ];
          var sl = wrap(font, f.sub || "", 7.2, bw - padX * 2);
          lines.push({ text: sl[0] || "", size: 7.2, color: gray });
          h = Math.max(h, stackHeight(lines));
        });
        var boxH = h + padTop + padBot;
        ensure(boxH + 6);
        var contentTop = y - padTop;
        [a, b].forEach(function (f, i) {
          var x0 = M + i * (bw + 11);
          page.drawRectangle({ x: x0, y: contentTop - h, width: bw, height: boxH, color: accent });
          page.drawRectangle({ x: x0, y: contentTop - h, width: 2.5, height: boxH, color: f.accent || tan });
          var vSize = fitSize(bold, f.value, bw - padX * 2, f.big ? 17 : 14.5, 8);
          var lines = [
            { text: f.label.toUpperCase(), size: 7.2, font: bold, color: gray, gap: 5 },
            { text: f.value, size: vSize, font: bold, color: navy, gap: 4 }
          ];
          var sl = wrap(font, f.sub || "", 7.2, bw - padX * 2);
          lines.push({ text: sl[0] || "", size: 7.2, color: gray });
          stack(x0 + padX, contentTop, lines);
        });
        y = contentTop - h - padBot;
        gap(15);
      }

      /* Comparison bars, drawn to scale against the largest value. */
      function bars(items) {
        var max = 0;
        for (var i = 0; i < items.length; i++) max = Math.max(max, Number(items[i].value || 0));
        if (max <= 0) max = 1;
        var labelW = 120, valW = 86;
        var trackW = W - M * 2 - labelW - valW - 12;
        for (var j = 0; j < items.length; j++) {
          ensure(19);
          var it = items[j];
          var w = Math.max(2, Math.round(Number(it.value || 0) / max * trackW));
          page.drawText(String(it.label).slice(0, 22), { x: M, y: y, size: 8, font: font, color: gray });
          page.drawRectangle({ x: M + labelW, y: y - 3, width: trackW, height: 8, color: ruleSoft });
          page.drawRectangle({ x: M + labelW, y: y - 3, width: w, height: 8, color: it.accent || tan });
          page.drawText(it.display || fmtMoney(it.value), { x: W - M - font.widthOfTextAtSize(it.display || fmtMoney(it.value), 8), y: y, size: 8, font: bold, color: navy });
          y -= 16;
        }
        gap(11);
      }

      /* A vertical ladder: label, value, caption, joined by a connecting rule.
         Used for the pricing reference points. Heights are computed from the
         stacked lines, so a longer caption grows the step instead of being
         drawn over the value above it. */
      function ladder(steps) {
        for (var i = 0; i < steps.length; i++) {
          var s = steps[i];
          var vSize = s.big ? 15 : 13;
          var capLines = wrap(font, s.caption, 7.6, W - M * 2 - 170);
          var lines = [
            { text: s.label.toUpperCase(), size: 7.2, font: bold, color: gray, gap: 5 },
            { text: s.value, size: vSize, font: bold, color: navy, gap: 5 }
          ];
          for (var c = 0; c < capLines.length; c++) {
            lines.push({ text: capLines[c], size: 7.6, color: faint, gap: c === capLines.length - 1 ? 0 : 2 });
          }
          var padTop = 12, padBot = 12;
          var h = stackHeight(lines);
          var total = padTop + h + padBot;
          ensure(total + 6);
          var contentTop = y - padTop;
          if (i < steps.length - 1) {
            /* The connector stops short of the next step so it never runs
               through the following label. */
            page.drawRectangle({ x: M + 7, y: contentTop - h + 4, width: 1, height: total + 6, color: rule });
          }
          page.drawRectangle({ x: M, y: contentTop - h + 2, width: 3, height: h + 4, color: s.accent || tan });
          stack(M + 16, contentTop, lines);
          y = contentTop - h - padBot;
        }
        gap(12);
      }

      var tax = (meta && meta.tax) || null;
      var muniRow = (meta && meta.muniRow) || null;
      /* Resolved once per layout pass, never per printed field. render() lays
         the document out twice (page count, then the real pass), so this is
         called twice per PDF and the two calls must agree - which they do,
         because both take the same result object. */
      var multipleDisclosure = referenceTools.appliedMultipleDisclosure(r);
      /* Present only on a result produced by the three-step reference model;
         the public site calculator's result carries the factor stack instead
         and every section below degrades rather than inventing one. */
      var rm = r.referenceModel || null;
      var reportId = (meta && meta.generatedOn ? meta.generatedOn.replace(/-/g, "") : "") + "-" + esc(r.municipality || "").slice(0, 3).toUpperCase() + "-" + (r.rdo || "");
      var midpoint = (Number(r.low || 0) + Number(r.high || 0)) / 2;

      /* ============================================================
         01  VALUATION SUMMARY
         ============================================================ */
      newSection("summary");

      /* Cover band. */
      page.drawRectangle({ x: M, y: y - 74, width: W - M * 2, height: 74, color: rgb(0.11, 0.09, 0.08) });
      page.drawText("PROPERTY VALUATION REPORT", { x: M + 16, y: y - 20, size: 7.4, font: bold, color: rgb(0.85, 0.62, 0.42) });
      page.drawText(r.municipality + (r.barangay ? ", " + r.barangay : ""), { x: M + 16, y: y - 40, size: 15, font: bold, color: rgb(1, 1, 1) });
      page.drawText((r.streetName || "Street not listed") + "  ·  " + fmtArea(r.area)
        + "  ·  " + (r.type === "house_lot" ? "House & Lot" : "Vacant Lot"), {
        x: M + 16, y: y - 55, size: 8.4, font: font, color: rgb(0.82, 0.80, 0.78)
      });
      var rid = "Ref " + reportId;
      page.drawText(rid, { x: W - M - 16 - font.widthOfTextAtSize(rid, 7.4), y: y - 20, size: 7.4, font: font, color: rgb(0.75, 0.73, 0.71) });
      page.drawText(meta && meta.generatedOn ? meta.generatedOn : "", {
        x: W - M - 16 - font.widthOfTextAtSize(meta && meta.generatedOn ? meta.generatedOn : "", 7.4), y: y - 55, size: 7.4, font: font, color: rgb(0.75, 0.73, 0.71)
      });
      y -= 92;

      tiles([
        { label: r.landMethod === "time-indexed" ? "Indexed-reference scenario" : "Market guide estimate", value: fmtMoney(r.marketGuideEstimate), sub: "Planning figure", accent: tan },
        { label: "Guide range", value: fmtMoney(r.low) + " - " + fmtMoney(r.high), sub: "85%-130% planning scenarios", accent: tan, small: true },
        { label: r.birReferenceConfirmed === false ? "Derived locality reference" : "Official BIR zonal reference", value: fmtMoney(r.birZonalValue), sub: fmtMoney(r.birZonalRatePerSqm) + "/sqm, " + (r.birReferenceConfirmed === false ? "derived fallback" : "tax reference"), accent: cool }
      ]);

      /* The three figures above are printed side by side with nothing
         connecting the BIR reference to the estimate, so the factor that
         connects them is named directly under them - the same place the web
         result screen puts it. Both strings come from the disclosure builder;
         this module contributes no wording of its own. A null disclosure (the
         indexed scenario applies no factor stack at all) prints no line. */
      if (multipleDisclosure) line(multipleDisclosure.multipleLabel, multipleDisclosure.text, { labelW: 200 });

      var cov = r.source || {};
      box([
        "Source match: " + (cov.label || "") + ", matched from " + (cov.count || 0) + " reference value(s). Match depth is not a statistical valuation accuracy score.",
        r.fallbackNote ? "Note: " + r.fallbackNote : "Source match level: " + (cov.level || "not supplied") + ".",
        "This is a planning guide, not a certified appraisal, tax determination or lending valuation. " + (r.birReferenceConfirmed === false ? "The locality median is derived, not a confirmed parcel tax floor; it is not interchangeable with the property estimate." : "The BIR reference is not interchangeable with the property estimate.")
      ], tan);

      heading("Valuation summary", { small: true });
      var decisionCosts = finance.transaction({}, r.total, Object.assign({}, r.costOptions || {}, { salePrice: r.salePrice, transactionPrice: r.total, marketGuideEstimate: r.total, birZonalValue: r.taxReferenceValue != null ? r.taxReferenceValue : r.birZonalValue }));
      table(null, [
        ["Purpose", r.purpose || "Not supplied"],
        [r.purpose === "Buying" ? "Buyer acquisition budget" : "Seller net-proceeds illustration", (r.purpose === "Buying" ? decisionCosts.buyerTotal : decisionCosts.projectedNetProceeds) == null ? "Quotation required" : fmtMoney(r.purpose === "Buying" ? decisionCosts.buyerTotal : decisionCosts.projectedNetProceeds)],
        ["BIR zonal value per sqm", fmtMoney(r.birZonalRatePerSqm)],
        ["Lot area", fmtArea(r.area) + (r.corner && r.corner.applied ? "  (corner lot)" : "")],
        ["BIR zonal value", fmtMoney(r.birZonalValue)],
        ["Market guide estimate", fmtMoney(r.marketGuideEstimate)],
        ["Guide range", fmtMoney(r.low) + "  to  " + fmtMoney(r.high)],
        ["Range midpoint", fmtMoney(midpoint)],
        ["Market guide rate per sqm", fmtMoney(r.marketGuideRatePerSqm)],
        ["Reference schedule", r.reference ? r.reference.schedule : "-"]
      ], [200, 300], { boldFirstCol: true, padY: 4, align: [null, "r"] });
      if (r.referenceVerification) {
        var verification = r.referenceVerification;
        heading("Government reference verification", { small: true });
        table(null, [["Status", verification.label], ["Published schedule effective", verification.scheduleEffectiveDate || r.effectivityDate], ["Dataset generated", verification.datasetGeneratedAt || "Not recorded"], ["Import/download date", verification.importDate || "Not established separately"], ["Attempt / successful check", (verification.lastAttemptedCheck || "Not recorded") + " / " + (verification.successfullyVerifiedOn || "Not verified")]], [200, 300], { padY: 4 });
        para(verification.verificationNote || "Latest applicability unverified.", 8, gray);
      }

      heading("What your report contains", { small: true });
      table(["Part", "Contents", "Page"],
        PARTS.map(function (p) {
          return [p.no + "  " + p.title, p.blurb, pageCount.starts[p.key] ? String(pageCount.starts[p.key]) : "-"];
        }), [150, 250, 34], { padY: 4, align: [null, null, "r"] });

      para("Comparable asking listings are context only, not calculation inputs.", 8, gray);

      /* ============================================================
         02  DETAILED COMPUTATION AND LEGAL BASIS
         ============================================================ */
      newSection("computation");
      para("Every step can be checked by hand. Factors compose multiplicatively: each line multiplies the one above it. Where the BIR masked a row as \"same as above\", it was resolved only where a municipality-wide rate existed and was never guessed.", 8.4, gray);
      gap(5);

      heading("Step 1 - reference rate lookup", { small: true });
      table(null, [
        ["Region", "Region IV-A (CALABARZON)"],
        ["Province", "Batangas"],
        ["City / Municipality", r.municipality],
        ["Barangay", r.barangay || "-"],
        ["Street", r.streetName || "Street not listed (all-other-streets rate)"],
        ["Classification", r.classification + (r.classificationLabel ? " - " + r.classificationLabel : "")],
        ["Zonal value found", fmtMoney(r.birZonalRatePerSqm) + " / sqm"],
        ["Instrument", "DO " + r.departmentOrder + " (" + r.revision + "), RDO " + r.rdo + ", effective " + r.effectivityDate]
      ], [150, 350], { boldFirstCol: true, padY: 4 });

      heading("Step 2 - land value", { small: true });
      if (r.timeIndex) {
        var ti = r.timeIndex;
        table(null, [["Original reference rate", fmtNum(ti.originalRate) + " PHP/sqm (unchanged)"], ["Selected scenario", "Indexed land reference; market/corner multipliers not stacked"], ["Annual change", fmtNum(ti.annualPct) + "% / " + ti.source], ["Base / target dates", ti.baseDate + " / " + ti.targetDate], ["Elapsed years", fmtNum(ti.elapsedYears, 6)], ["Indexed rate (display rounded)", fmtNum(ti.rawRate) + " PHP/sqm"], ["Indexed land amount", fmtMoney(ti.landAmount)], ["Factor guide comparison", fmtMoney(r.factorBaseline.total) + " (not selected)"]], [200, 300], { padY: 4 });
        para(ti.formula + ". " + ti.note + " Full precision used before final rounding.", 8, gray);
      } else {
      /* The rows above multiply out to the effective land rate but never say
         what the product was, so a reader holding the BIR schedule in one hand
         cannot check the estimate in the other. The last row names that
         product, and the two paragraphs after the table say what it is and
         where it does not reach. All four strings are the disclosure builder's.

         The row is appended conditionally and the conditional entry is FILTERED
         out, rather than left in the array. Both halves are load-bearing, and
         they fail differently: table() reads rows[ri].length, so an unfiltered
         null throws and no document is produced at all, while a one-element
         [null] row is accepted, draws no ink and silently costs a blank band
         of vertical space. Filtered out, the array holds the eight real rows. */
      var landRows = [
        ["BIR zonal base", fmtMoney(r.reference ? r.reference.value : r.birZonalRatePerSqm) + "/sqm"],
        ["Corner adjustment", r.corner && r.corner.applied
           ? "x " + (1 + Number(r.corner.pct || 0)).toFixed(4) + "   (+" + fmtNum(Number(r.corner.pct) * 100) + "%)"
          : "not applied"],
        /* The three SEA ESTATES factor rows only exist on a result that
           carried the factor stack. The Value Guide's reference-model result
           nulls them by design (js/value_guide_flow.js); in their place it
           prints its own market indicator and the additive land net, which is
           the whole of how that model turns a zonal base into a land value. */
        r.factors
          ? ["Property-use factor", "x " + fmtNum(r.factors.proxyFactor) + "   (" + r.use + ")"]
          : ["Reference market indicator", "x " + fmtNum(rm ? rm.marketInd : 1)],
        r.factors ? ["Market band midpoint", "x " + fmtNum(r.factors.bandMid)] : null,
        r.factors ? ["Regional adjustment", "x " + fmtNum(r.factors.regionalAdj)] : null,
        !r.factors && rm ? ["Applied land net", fmtNum(rm.net * 100, 2) + "%  (additive)"] : null,
        ["Effective land rate", fmtMoney(r.landPerSqm) + "/sqm"],
        ["Lot area", fmtArea(r.area)],
        ["Land value", fmtMoney(r.landValue)],
        multipleDisclosure ? [multipleDisclosure.multipleLabel, "x " + multipleDisclosure.multiple] : null
      ];
      table(null, landRows.filter(function (row) { return row; }), [200, 300], { boldFirstCol: true, padY: 4 });
      if (multipleDisclosure) {
        para(multipleDisclosure.assumption, 8, gray);
        para(multipleDisclosure.limitation, 8, gray);
      }
      }

      if (r.type === "house_lot") {
        heading("Step 3 - house value (replacement cost)", { small: true });
        table(null, [
          ["Construction", r.constructionLabel || r.construction || "-"],
          ["Construction rate", fmtMoney(r.buildCostPerSqm) + "/sqm"],
          ["Floor area", fmtArea(r.floorArea)],
          ["Age band midpoint", r.ageMidpoint + " years"],
          ["Depreciation applied", r.depreciatedPct + "%"],
          ["Improvements itemised", r.featuresTotal > 0
            ? fmtMoney(r.featuresTotal) + " across " + ((r.featuresUsed || []).length) + " item(s)"
            : "none selected"],
          ["Improvement value", fmtMoney(r.improvement)]
        ], [200, 300], { boldFirstCol: true, padY: 4 });
      } else {
        heading("Step 3 - house value", { small: true });
        para("Not applicable. This is a vacant lot, valued on land only with no house component.", 8.4, gray);
      }

      var adj = Number(r.ownershipAdjustmentPct || 0);
      heading("Step 4 - ownership and title adjustment", { small: true });
      if (adj > 0) {
        para("An indicative marketability adjustment, not a change to the official BIR zonal value. Verify occupancy, title and inheritance documents with the Registry of Deeds, a lawyer and the buyer.", 8, gray);
        table(null, [
          ["Adjustment applied", "-" + adj + "%"],
          ["Unadjusted total", fmtMoney(r.unadjustedTotal)],
          ["Final market guide estimate", fmtMoney(r.marketGuideEstimate)]
        ], [200, 300], { boldFirstCol: true, padY: 4 });
      } else {
        para("No occupancy or title adjustment applied to this estimate. Any inputs recorded are listed in part 06.", 8.4, gray);
        line("Final market guide estimate", fmtMoney(r.marketGuideEstimate), { labelW: 200 });
      }

      heading("Legal and regulatory basis", { small: true });
      var basis = [
        ["Zonal values", "Department Order " + r.departmentOrder + " (" + r.revision + "), RDO " + r.rdo + ", effective " + r.effectivityDate],
        ["Authority of the BIR", "RA 12001, Real Property Valuation and Assessment Reform Act"],
        ["Fair market value for tax", "Sec. 6(E) NIRC: relevant BIR zonal and assessor schedule values; no half-zonal proxy"],
        ["Capital gains tax", "Sec. 24(D) NIRC - 6% of higher gross selling price or statutory FMV for qualifying capital assets"],
        ["Documentary stamp tax", "Sec. 196 NIRC; filing under Sec. 200(B), amended by RA 11976 Sec. 30"],
        ["Local transfer tax", "Secs. 135 and 151 LGC - provincial/city rates depend on the LGU ordinance"],
        ["Estate tax", "Secs. 84 and 86 NIRC, amended by RA 10963 Secs. 22-23 - 6% of net taxable estate"],
        ["Professional standard", "PVS 105 governs a LICENSED APPRAISAL. This report is not one and makes no claim of PVS 105 compliance."]
      ];
      table(["Reference", "Basis"], basis, [150, 350], { boldFirstCol: true, padY: 4 });

      /* ============================================================
         03  TAX IMPLICATIONS
         ============================================================ */
      newSection("tax");
      if (tax && tax.selling && tax.selling.quotationRequired) {
        box(["Developer / unclassified transaction. " + tax.selling.direction], tan);
        line("Quoted charges outside price", tax.selling.quotedDeveloperFees == null ? "Not supplied" : fmtMoney(tax.selling.quotedDeveloperFees));
        line("Buyer acquisition budget", tax.selling.buyerTotal == null ? "Not determined" : fmtMoney(tax.selling.buyerTotal));
      } else if (!tax || !tax.selling) {
        box(["The tax reference data could not be loaded, so no tax figures are shown. This is deliberate: a figure computed from a missing statutory rate would be a guess."], rgb(0.72, 0.20, 0.22));
      } else {
        var s = tax.selling;
        box([
          "These are illustrative amounts for planning, not amounts payable. The BIR, the LGU and the Registry of Deeds each determine what is actually due.",
          "The tax base is the HIGHER applicable selling price or statutory fair market value: " + fmtMoney(s.taxBase) + ". " + s.taxBaseBasis,
          s.direction
        ], rgb(0.72, 0.45, 0.06));

        heading("Transaction-cost illustration", { small: true });
        table(["Fee or tax", "Rate", "What it is charged on", "Amount", "Paid to"],
          s.items.map(function (i) {
            return [i.label, i.rateLabel, i.base + (i.baseAmount == null ? "" : " = " + fmtMoney(i.baseAmount)), i.key === "notarial" && !i.amount ? "Not supplied" : fmtMoney(i.amount), i.billedBy || "-"];
          }), [118, 44, 152, 74, 84],
          { boldFirstCol: true, padY: 4, align: [null, null, null, "r", null] });
        para("Statutory bases: " + s.items.map(function (i) { return i.legalBasis; })
          .filter(function (v, i2, a) { return v && a.indexOf(v) === i2; }).join("; ") + ".", 7.4, faint);

        heading("From asking price to cash in hand", { small: true });
        table(["Line", "Amount"],
          [
            ["Entered/assumed transaction price", fmtMoney(s.transactionPrice)],
            ["All transaction costs (CGT, DST, transfer, registration)", "- " + fmtMoney(s.statutoryTotal)],
            ["After all transaction costs, before broker/notary", fmtMoney(s.netProceeds.beforeCommission)],
            ["Seller proceeds after CGT and quoted notary, before broker", fmtMoney(s.netProceeds.sellerBeforeCommission)],
            ["Less broker's commission (" + s.broker.rateLabel + ")", "- " + fmtMoney(s.broker.min) + "  to  - " + fmtMoney(s.broker.max)],
            ["Estimated cash received after seller costs", fmtMoney(s.netProceeds.atHighCommission) + "  to  " + fmtMoney(s.netProceeds.atLowCommission)]
          ], [290, 210], { boldFirstCol: true, padY: 4, align: [null, "r"] });
        para(s.broker.note, 7.6, faint);

        heading("Inheritance: property-only scenarios", { small: true });
        var ih = tax.inheritance;
        table(["Line", "On BIR zonal basis", "On market basis"],
          [
            ["Gross estate value", fmtMoney(ih.grossOnZonalBasis), fmtMoney(ih.grossOnMarketBasis)],
            ["Standard deduction (Sec. 86(A)(1) NIRC)", "- " + fmtMoney(ih.standardDeduction), "- " + fmtMoney(ih.standardDeduction)],
            ["Net estate", fmtMoney(ih.onZonalBasis.afterDeduction), fmtMoney(ih.onMarketBasis.afterDeduction)],
            ["Net taxable estate in this scenario", fmtMoney(ih.onZonalBasis.taxable), fmtMoney(ih.onMarketBasis.taxable)],
            ["Estate tax at " + ih.taxPct + "%", fmtMoney(ih.onZonalBasis.tax), fmtMoney(ih.onMarketBasis.tax)]
          ], [200, 150, 150], { boldFirstCol: true, padY: 4, align: [null, "r", "r"] });
        para(ih.note, 8, gray);
        para("Basis: " + ih.basis, 7.4, faint);
      }

      /* ============================================================
         04  MARKET ANALYSIS AND COMPARABLES
         ============================================================ */
      newSection("market");
      if (r.askingIndication) {
        heading("Local asking-price indication", { small: true });
        line("Median indication", fmtMoney(r.askingIndication.value));
        line("Observed asking spread", fmtMoney(r.askingIndication.low) + " - " + fmtMoney(r.askingIndication.high));
        para(r.askingIndication.method + ". " + r.askingIndication.basis + ".", 8, gray);
      }
      para("How the estimate was reached from the available evidence, and how the property sits against other land in the same municipality.", 8.4, gray);

      var cs = r.comparableSummary || {};
      var comps = Array.isArray(cs) ? cs : (cs.records || []);
      var bc = (muniRow && muniRow.byClass ? muniRow.byClass[r.classification] : null) || null;

      heading("Data coverage and match level", { small: true });
      table(null, [
        ["Match level", cov.label || "Best available match"],
        ["Reference values used", (cov.count || 0) + " value(s) for this classification"],
        ["Source match", (cov.label || "-") + "; not statistical confidence"],
        ["Fallback applied", r.fallbackNote || "none"],
        ["Comparable asking listings", comps.length ? comps.length + " found" : "none available"],
        ["Municipality street rows", muniRow && muniRow.stats ? String(muniRow.stats.streetValueRows) : "-"]
      ], [170, 330], { boldFirstCol: true, padY: 4 });

      heading("Where this property sits locally", { small: true });
      if (bc && bc.count) {
        para("BIR zonal rates for classification " + r.classification + " across " + r.municipality + ", from " + bc.count + " value(s). These are zonal rates, not market prices.", 8, gray);
        table(["Measure", "Zonal rate per sqm", "What it means for this property"],
          [
            ["Lowest recorded", fmtMoney(bc.min), "Cheapest land of this classification in the municipality"],
            ["25th percentile", fmtMoney(bc.p25), "Below this, the property sits in the cheapest quarter"],
            ["Median", fmtMoney(bc.p50), "Half of comparable land is above, half below"],
            ["75th percentile", fmtMoney(bc.p75), "Above this, the property sits in the dearest quarter"],
            ["Highest recorded", fmtMoney(bc.max), "Dearest land of this classification in the municipality"],
            ["This property's BIR rate", fmtMoney(r.birZonalRatePerSqm), bandFor(r.birZonalRatePerSqm, bc)]
          ], [130, 110, 260], { boldFirstCol: true, padY: 4, align: [null, "r", null] });
      } else {
        para("No municipality distribution is published for classification " + r.classification + ", so no local percentile position can be shown.", 8.4, gray);
      }

      heading("Comparable asking listings", { small: true });
      if (comps.length) {
        table(["Listing", "Location", "Asking price", "Lot area", "Price per sqm"],
          comps.slice(0, 8).map(function (c) {
            var price = Number(c.price || c.askingPrice || c.totalPrice || 0);
            var area = Number(c.area || c.lotArea || 0);
            return [
              c.title || c.label || "-",
              c.location || c.barangay || c.municipality || "-",
              price ? fmtMoney(price) : "-",
              area ? fmtArea(area) : "-",
              (price && area) ? fmtMoney(price / area) : "-"
            ];
          }), [150, 130, 100, 70, 80], { padY: 4, align: [null, null, "r", "r", "r"] });
        para("Comparable asking listings are context only. Their prices are NOT inputs to the market guide estimate, and an asking price is not a transaction price.", 8, gray);
      } else {
        para("No comparable asking listings were available for this location, so the estimate uses the disclosed BIR-based factors only. This is the most common outcome in the covered area and is a limitation of the evidence, not of the property.", 8.4, gray);
      }

      if (r.marketGuideEstimate) {
        heading("Estimate against context", { small: true });
        var ctx = [{ label: "This property (guide)", value: r.marketGuideEstimate, display: fmtMoney(r.marketGuideEstimate), accent: tan }];
        comps.slice(0, 4).forEach(function (c, i) {
          var price = Number(c.price || c.askingPrice || c.totalPrice || 0);
          if (!price) return;
          ctx.push({ label: String(c.title || c.label || ("Listing " + (i + 1))).slice(0, 20), value: price, display: fmtMoney(price), accent: cool });
        });
        if (bc && bc.p50) ctx.push({ label: "BIR median zonal", value: Number(bc.p50) * Number(r.area || 0), display: fmtMoney(Number(bc.p50) * Number(r.area || 0)), accent: rgb(0.72, 0.70, 0.66) });
        ctx.push({ label: "BIR zonal (this prop)", value: r.birZonalValue, display: fmtMoney(r.birZonalValue), accent: cool });
        bars(ctx);
      }

      /* ============================================================
         05  DOCUMENTS AND FILING GUIDE
         ============================================================ */
      newSection("documents");

      /* The Registry of Deeds rejects a transfer with a missing document
         regardless of what any checklist says, so it is stated before the list
         rather than after it. */
      para("A starting checklist, not an exhaustive one. Requirements vary by the LGU, the Registry of Deeds and the transaction, and the Registry of Deeds will reject a transfer with a missing document regardless of what any checklist says.", 8.4, gray);

      heading("Filing deadlines and penalties", { small: true });
       para("Each obligation has its own trigger: CGT generally runs from notarisation, DST from the close of the document month, transfer tax from the deed date, and the estate return from death (one calendar year). Confirm applicable rules before setting a filing date.", 8, gray);
      if (tax && tax.deadlines) {
        table(["Obligation", "Due within", "From", "Paid to", "If late"],
          tax.deadlines.map(function (d) {
            return [d.label, d.days + " day" + (d.days === 1 ? "" : "s"), d.from, d.billedBy || "-", d.penalty || "Per statute or local ordinance"];
          }), [108, 50, 128, 76, 138], { boldFirstCol: true, padY: 4, align: [null, "r", null, null, null] });
      }

      heading("Filing steps", { small: true });
      if (tax && tax.steps) {
        table(["#", "Step", "Where", "Deadline"],
          tax.steps.map(function (st) { return [String(st.n), st.label, st.where, st.deadline]; }),
          [20, 188, 106, 186], { padY: 4, align: ["r", null, null, null] });
      }

      heading("Documents the seller usually provides", { small: true });
      if (tax && tax.sellerDocuments) {
        table(["#", "Document"], tax.sellerDocuments.map(function (d, i) { return [String(i + 1), d]; }),
          [20, 480], { padY: 4, align: ["r", null] });
      }

      heading("Documents the buyer usually prepares", { small: true });
      if (tax && tax.buyerDocuments) {
        table(["#", "Document"], tax.buyerDocuments.map(function (d, i) { return [String(i + 1), d]; }),
          [20, 480], { padY: 4, align: ["r", null] });
      }

      box(["Confirm every requirement with the BIR RDO, the City or Municipal Treasurer and the Registry of Deeds before relying on this list. Requirements vary by locality and change without notice. This is a starting checklist, not an exhaustive one."], tan);

      /* ============================================================
         06  NEGOTIATION STRATEGY AND DISCLAIMER
         ============================================================ */
      newSection("negotiation");

      heading("Pricing strategy", { small: true });
      para("Reference points for a conversation, not a recommendation to price or accept at any of them. They are what the disclosed factors produce; they are not what a buyer will pay.", 8, gray);
      var hasSellingCosts = !!(tax && tax.selling && !tax.selling.quotationRequired);
      var sellerCosts = hasSellingCosts ? tax.selling.items[0].amount + (tax.selling.items[4] ? tax.selling.items[4].amount : 0) : 0;
      var commLo = hasSellingCosts ? tax.selling.broker.min : 0;
      var commHi = hasSellingCosts ? tax.selling.broker.max : 0;
      var netLo = hasSellingCosts ? tax.selling.netProceeds.atLowCommission : 0;
      var netHi = hasSellingCosts ? tax.selling.netProceeds.atHighCommission : 0;
      ladder([
        {
          label: "Lower end of guide range", value: fmtMoney(r.low), accent: cool,
          caption: "A reference point for reviewing offers."
        },
        {
          label: "Central planning estimate", value: fmtMoney(r.marketGuideEstimate), accent: tan, big: true,
          caption: "The disclosed factor-based estimate (100%)."
        },
        {
          label: "Taxes and fees", value: hasSellingCosts ? "- " + fmtMoney(sellerCosts + commHi) : "Quotation required", accent: cool,
          caption: "Seller-paid CGT, broker and quoted notarial costs. DST, transfer and registration assumed buyer-paid. A higher selling price can raise CGT and DST."
        },
        {
          label: "Cash you would receive", value: hasSellingCosts ? fmtMoney(netHi) + " - " + fmtMoney(netLo) : "Not determined", accent: tan, big: true,
          caption: "Estimated net proceeds at the guide estimate after those seller costs, across the usual commission band."
        }
      ]);
      box([
        "The BIR zonal value is a tax floor in practice, not a negotiable one. It is what the BIR assesses against, so a price below it does not reduce the tax base for CGT or DST.",
        "The 85%-130% guide range expresses planning scenarios, not statistical confidence. Source match quality is reported separately.",
        "No site inspection or verified title assessment is performed. Unverified inputs apply model adjustments where stated; actual condition, access, flood risk and buyer demand require professional review."
      ], tan);

      heading("Source of record", { small: true });
      var p = meta && meta.provenance;
      if (p && p.sources && p.sources.length) {
        para("Imported references are listed. APPLIES identifies the selected subject RDO, not proof of latest legal applicability; verification status is stated separately.", 8, gray);
        var seenNote = {};
        table(["Instrument", "Applies to", "Effective", "Status", "Authority"],
          p.sources.map(function (src) {
            var governs = new RegExp("RDO\\s*0?" + esc(String(r.rdo || "")).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(src.coverage || "");
            var note = src.currencyNote && !seenNote[src.currencyNote] ? (seenNote[src.currencyNote] = true, "\n" + src.currencyNote) : "";
            return [
              (governs ? "APPLIES (imported)  " : "other imported reference  ") + src.instrument + (src.revision ? " (" + src.revision + ")" : ""),
              (src.coverage || "") + note,
              src.effectiveDate || "-", src.status || "-", src.authority || "-"
            ];
          }), [128, 150, 60, 56, 100], { padY: 4 });
      }
      table(null, [
        ["Reference schedule used", r.reference ? r.reference.schedule : "-"],
        ["Data version", r.dataVersion],
        ["Calculation version", r.calculationVersion],
        ["Tax reference version", tax && tax.reference ? tax.reference.version : "-"],
        ["Tax reference checked", tax && tax.reference ? tax.reference.checkedOn : "-"]
      ], [150, 350], { boldFirstCol: true, padY: 4 });
      if (r.timeIndex) para("Order: imported reference > explicit time factor > lot area > separately computed building component. No stacked market/corner multipliers.", 7.6, faint);
      else if (p && p.order && p.order.length) para("Order of adjustments: " + p.order.join(" > "), 7.6, faint);

      heading("What this report does not cover", { small: true });
      var limits = (p && p.limitations) || [];
      if (!limits.length) {
        limits = [
          "No physical inspection of the property is performed or implied.",
          "The factor set is a SEA ESTATES internal reference and has not been reviewed by an independent qualified appraiser.",
          "Tax figures are illustrative and use published statutory rates; the BIR and the LGU determine what is payable."
        ];
      }
      for (var j = 0; j < limits.length; j++) para("- " + esc(limits[j]), 8, gray);

      heading("Disclaimer", { small: true });
      para(esc(r.disclaimer || ""), 8, gray);
      para("The tax figures in this report are illustrative estimates computed from published statutory rates for planning purposes. They are not a computation of tax payable. The BIR, the City or Municipal Treasurer and the Registry of Deeds determine the actual amounts, and the BIR tax base is the higher of the selling price and the fair market value as the BIR determines it. Consult a tax practitioner or lawyer before relying on any figure here.", 8, gray);
      para("This report is not a certified appraisal and does not claim compliance with PVS 105. For a formal valuation assignment, request a licensed real estate appraiser's site and document review.", 8, gray);

      /* ============================================================
         07  MODEL AND PROVENANCE
         ============================================================ */
      newSection("model");
      heading("Which model produced this figure", { small: true });
      if (rm) {
        para("Derived from published BIR zonal values, adjusted for documented property factors. A BIR zonal base, a market-indicator factor of " + fmtNum(rm.marketInd, 3)
          + ", then one additive net of the answers in the next part. Every answer is added once and the total is applied once; nothing is compounded. Not a real estate appraisal under RA 9646.", 8, gray);
        table(null, [
          ["Model", "value-guide factor model"],
          ["Market indicator", "x " + fmtNum(rm.marketInd, 3)],
          ["Land net (additive)", fmtNum(rm.net * 100, 2) + "%"],
          ["Net limit reached", rm.netClamped ? "yes - the sum of adverse answers was capped at " + fmtNum(rm.netLimit * 100, 2) + "%" : "no"],
          ["Escalation", "none - the replacement rate is flat"],
          ["Zonal schedule effective", r.effectivityDate || "not recorded"],
          ["Comparables", "context only, never an input"]
        ], [200, 300], { boldFirstCol: true, padY: 4 });
        box([
          "The public site calculator uses a different model (SEA ESTATES factor stack) and returns roughly 2.1x the figure here for the same property. Both are planning figures, not an appraisal.",
          "Street rates in the zonal schedule for post-2022 subdivisions can sit far below what those homes transact for. The guide inherits that; the model name and the schedule date are disclosed here rather than a claimed accuracy."
        ], tan);
      } else {
        para("Reference model: not recorded on this result. It came from the public site calculator's factor stack rather than the three-step reference model, so parts 08 and 09 do not describe it.", 8, gray);
      }

      /* ============================================================
         08  METHODOLOGY: PUBLISHED FACTORS
         ============================================================ */
      newSection("methodology");
      heading("The published factors", { small: true });
      if (rm) {
        para("Each question maps to a published percentage. The answers are summed once into one net for the land, and that net is applied once.", 8, gray);
        /* An unassessed factor carries bp null. Printing that as 0.00% would read
           as "checked, nothing found", which is the opposite of what Not sure
           means. The range column still shows what the factor could have done. */
        table(["Question", "Section", "Published range", "Applied"],
          rm.sections.map(function (s) {
            var cell = s.assessed
              ? (s.bp > 0 ? "+" : "") + fmtNum(s.bp / 100, 2) + "%"
              : "Not assessed";
            return [s.label, s.section, fmtNum(s.min / 100, 2) + "% to " + fmtNum(s.max / 100, 2) + "%", cell];
          }), [150, 130, 140, 70], { padY: 4, align: [null, null, null, "r"] });
        var skipped = (r.assumptions || []).map(function (a) { return a.label; });
        box([
          "Applied net: " + fmtNum(rm.net * 100, 2) + "% on land. Additive, not compounded."
            + (rm.netClamped
              ? " The sum of adverse answers reached the " + fmtNum(rm.netLimit * 100, 2) + "% limit, so some stated conditions did not affect the figure."
              : ""),
          skipped.length
            ? "Not assessed: " + skipped.join(", ") + ". These were left unassessed rather than guessed, and a question nobody answered cannot raise or lower the figure."
            : "Every question was answered.",
          "The published ranges are the ceilings, so no single answer can move a component outside them."
        ], tan);
      } else {
        para("Not applicable: this result was not produced by the factor model.", 8, gray);
      }

      /* ============================================================
         09  CONSTRUCTION BASIS
         ============================================================ */
      newSection("construction");
      heading("Construction basis", { small: true });
      var rcn = rm ? rm.rcnRate : r.buildCostPerSqm;
      var life = rm ? rm.usefulLife : 40;
      var depCap = rm ? rm.depCap : 0.8;
      table(null, [
        ["Construction type", r.constructionLabel || r.construction || "-"],
        ["Replacement cost", fmtMoney(rcn) + "/sqm"],
        ["Floor area", r.type === "house_lot" ? fmtArea(r.floorArea) : "vacant land - no improvement"],
        ["Useful life", life + " years"],
        ["Age midpoint", fmtNum(r.ageMidpoint, 1) + " years"],
        ["Depreciation applied", fmtNum(r.depreciatedPct, 2) + "%  (capped at " + fmtNum(depCap * 100, 0) + "%)"],
        ["Escalation", "none - no valuation year, no annual uplift"]
      ], [200, 300], { boldFirstCol: true, padY: 4 });
      /* The provenance sentence used to claim the rate "sits above the
         permit-declared average" unconditionally. It does not hold for
         wood_prefab (8,000 against a PSA national average of ~14,000), and
         wood_prefab is one of the three options the form offers. State the
         relationship rather than asserting it. */
      var psaNational = 14082, psaRegion4a = 13405;
      box([
        fmtMoney(rcn) + "/sqm is a replacement-cost rate, not a market price. For comparison, the Philippine Statistics Authority published a national residential average of PHP " + fmtMoney(psaNational) + "/sqm (May 2026) and PSA Region IV-A was PHP " + fmtMoney(psaRegion4a) + "/sqm (Jan 2025); real Batangas turnkey quotations for an economic finish run PHP 23,100-31,185/sqm (Q1 2026). This figure is "
          + (rcn > psaRegion4a ? "above" : rcn < psaRegion4a ? "below" : "at") + " the regional published average and below every contractor quote.",
        "It is neither a contractor's price nor a completed-sale cost, and it is never escalated: no published source supported the annual uplift that was tested against these figures."
      ], tan);

      /* ============================================================
         10  COMPARABLES, CONTEXT ONLY
         ============================================================ */
      newSection("comparables");
      heading("Own listings, for context", { small: true });
      if (r.comparableListingCount) {
        para(r.comparableListingCount + " listing(s) from our own catalog for the same municipality and property type. Asking advertisements, not completed sales.", 8, gray);
        var cs = r.comparableSummary;
        if (cs) {
          table(null, [
            ["Listings returned", String(r.comparableListingCount)],
            ["Median price per sqm", cs.medianPricePerSqm ? fmtMoney(cs.medianPricePerSqm) + "/sqm" : "not established"],
            ["Qualified indication", cs.askingIndication ? fmtMoney(cs.askingIndication.value) + " from " + cs.askingIndication.count + " eligible" : "insufficient evidence"],
            ["Screening policy", cs.policy || "-"]
          ], [200, 300], { boldFirstCol: true, padY: 4 });
          var recs = (cs.records || []).slice(0, 8);
          if (recs.length) {
            table(["Listing", "Price", "Per sqm"], recs.map(function (rec) {
              return [rec.title || rec.id || "Listing", fmtMoney(rec.price), fmtMoney(rec.pricePerSqm)];
            }), [300, 100, 80], { padY: 4, align: [null, "r", "r"] });
          }
        }
      } else {
        para("No matching listings for this municipality.", 8, gray);
      }
      box([
        "Comparables are context only. No listing price on this page enters the calculation that produced the estimate, the range or the per-sqm figure.",
        "An asking price is what a seller wants, not what a buyer paid."
      ], tan);

      return doc;
    });
  }

  function bandFor(rate, bc) {
    if (!bc) return "-";
    if (rate <= bc.p25) return "In the cheapest quarter of this classification locally";
    if (rate <= bc.p50) return "Below the local median for this classification";
    if (rate <= bc.p75) return "Above the local median for this classification";
    return "In the dearest quarter of this classification locally";
  }

  /* Laid out twice. The first pass discovers how many pages the content needs
     and where each part starts, so the cover contents table can print real
     page numbers and the footer a true total. */
  function render(lib, r, meta) {
    var holder = { total: 0, starts: {} };
    return lib.PDFDocument.create().then(function (doc) {
      return build(lib, doc, r, meta, holder).then(function () {
        holder.total = doc.getPageCount();
        return lib.PDFDocument.create();
      });
    }).then(function (doc2) {
      return build(lib, doc2, r, meta, holder).then(function () { return doc2.save(); });
    });
  }

  function toBlob(lib, r, meta) {
    if (!lib || !lib.PDFDocument) throw new Error("pdf-lib namespace not provided");
    return render(lib, r, meta || {}).then(function (bytes) {
      return new Blob([bytes], { type: "application/pdf" });
    });
  }

  function fileName(r, meta) {
    var town = String(r.municipality || "property").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    var date = (meta && meta.generatedOn ? meta.generatedOn : "").replace(/[^0-9]/g, "");
    return "SEA-ESTATES-Value-Guide-" + (town || "property") + (date ? "-" + date : "") + ".pdf";
  }

  return { toBlob: toBlob, fileName: fileName, wrap: wrap, fmtMoney: fmtMoney, build: build, PARTS: PARTS };
});
