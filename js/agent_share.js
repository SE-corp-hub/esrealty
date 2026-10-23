/* SEA ESTATES: the pictures an agent shares from My website (agent websites).
 *
 *   SEA_AGENT_SHARE.qrPng(address, name)  the page address as a QR code for printed signs and
 *                                         flyers, with the agent's name under it (PNG blob)
 *   SEA_AGENT_SHARE.cardPng(preview)      the 1200 x 630 preview image Facebook and Viber show
 *                                         for the page link (PNG blob)
 *
 * Loaded by js/app.js on first use (ESREALTY_UTIL.loadScriptOnce); the QR library itself
 * (vendor/qrcode, MIT) is fetched the same way, only when a QR code is asked for.
 */
(function () {
  "use strict";
  var util = window.ESREALTY_UTIL;

  function toPng(canvas) {
    return new Promise(function (resolve, reject) {
      try { canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error("no image")); }, "image/png"); } catch (e) { reject(e); }
    });
  }

  function qrCanvas(qrcode, text, name) {
    var qr = qrcode(0, "M"); qr.addData(text); qr.make();
    var n = qr.getModuleCount(), quiet = 4, cell = Math.floor(960 / (n + quiet * 2));
    var size = cell * (n + quiet * 2);
    var canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size + 150;
    var g = canvas.getContext("2d");
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = "#1C1917";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    g.textAlign = "center";
    g.font = "700 46px Inter, Arial, sans-serif"; g.fillText(String(name || "").slice(0, 40), size / 2, size + 40);
    g.font = "400 30px Inter, Arial, sans-serif"; g.fillStyle = "#443C36"; g.fillText("Scan to see my page · SEA ESTATES", size / 2, size + 95);
    return canvas;
  }

  function qrPng(address, name) {
    return util.loadScriptOnce("vendor/qrcode/qrcode.min.js?v=1", "qrcode").then(function (qrcode) {
      return toPng(qrCanvas(qrcode, address, name));
    });
  }

  /* The preview image: name, role, towns and the licence line on warm paper, with the photo when
   * the browser may draw it. */
  function cardCanvas(pv, photo) {
    var P = window.SEA_AGENT_PAGE;
    var canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 630;
    var g = canvas.getContext("2d");
    var display = '"Schibsted Grotesk", Inter, Arial, sans-serif';
    g.fillStyle = "#F7F3EE"; g.fillRect(0, 0, 1200, 630);
    g.fillStyle = "#0E5F63"; g.fillRect(0, 530, 1200, 100);
    var textRight = photo ? 760 : 1120;
    var fit = function (txt, font, max) {
      g.font = font;
      var t = String(txt || "");
      while (t.length > 3 && g.measureText(t).width > max) t = t.slice(0, -2);
      return t === String(txt || "") ? t : t.trim() + "…";
    };
    g.fillStyle = "#1C1917"; g.textBaseline = "alphabetic";
    var size = 84; g.font = "800 " + size + "px " + display;
    while (size > 48 && g.measureText(pv.name || "").width > textRight - 80) { size -= 4; g.font = "800 " + size + "px " + display; }
    g.fillText(fit(pv.name, "800 " + size + "px " + display, textRight - 80), 80, 200);
    g.fillStyle = "#443C36";
    g.fillText(fit(pv.role_label, "500 34px Inter, Arial, sans-serif", textRight - 80), 80, 262);
    var towns = P ? P.labels(P.TOWNS, pv.towns || []).slice(0, 3) : [];
    if (towns.length) g.fillText(fit(towns.join(", ") + ", Batangas", "400 32px Inter, Arial, sans-serif", textRight - 80), 80, 314);
    g.fillStyle = "#9A4518"; g.fillText("with SEA ESTATES", 80, 380);
    g.fillStyle = "#FFFFFF";
    var lic = pv.licence;
    g.fillText(fit(lic ? "Licence checked by SEA ESTATES on " + (P ? P.day(lic.checked_on) : lic.checked_on) + " · Licence no. " + lic.no : "SEA ESTATES", "600 30px Inter, Arial, sans-serif", 1060), 80, 592);
    if (photo) {
      var w = 340, h = 420, x = 800, y = 70;
      var scale = Math.max(w / photo.naturalWidth, h / photo.naturalHeight);
      var sw = w / scale, sh = h / scale;
      g.save(); g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, 28); else g.rect(x, y, w, h); g.clip();
      g.drawImage(photo, (photo.naturalWidth - sw) / 2, (photo.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
      g.restore();
    }
    return canvas;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image(); img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("photo did not load")); };
      img.src = url;
    });
  }

  function cardPng(pv) {
    var fonts = Promise.resolve();
    try { if (document.fonts && document.fonts.load) fonts = document.fonts.load('800 84px "Schibsted Grotesk"').catch(function () {}); } catch (e) { /* Inter then */ }
    return fonts.then(function () {
      return pv.photo ? loadImage(pv.photo).catch(function () { return null; }) : null;
    }).then(function (photo) {
      var draw = function (p) { return new Promise(function (resolve) { resolve(cardCanvas(pv, p)); }).then(toPng); };
      // A photo the browser may not read back makes toBlob fail: draw again without it.
      return draw(photo).catch(function () { return draw(null); });
    });
  }

  window.SEA_AGENT_SHARE = { qrPng: qrPng, cardPng: cardPng };
})();
