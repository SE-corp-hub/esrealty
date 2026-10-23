/* Agent websites: the pictures My website makes, drawn on a canvas in the browser.
 *
 *   SEA_AGENT_SHARE.qrPng(address, name)  the page address as a QR code for printed signs and flyers,
 *                                         with the agent's name under it (PNG blob)
 *   SEA_AGENT_SHARE.cardPng(page)         the 1200 x 630 preview image made at publish (PNG blob)
 *
 * Neither reads the app's state: the back office (js/app.js) passes the page and uploads the result.
 */
(function () {
  "use strict";

  const toBlob = c => new Promise((res, rej) => { try { c.toBlob(b => (b ? res(b) : rej(new Error("no image"))), "image/png"); } catch (e) { rej(e); } });

  /* The QR code: the vendored library loads the first time it is needed. */
  function qrCanvas(qrcode, text, name) {
    const qr = qrcode(0, "M"); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), quiet = 4, cell = Math.floor(960 / (n + quiet * 2));
    const size = cell * (n + quiet * 2);
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size + 150;
    const g = canvas.getContext("2d");
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = "#1C1917";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    g.textAlign = "center";
    g.font = "700 46px Inter, Arial, sans-serif"; g.fillText(String(name || "").slice(0, 40), size / 2, size + 40);
    g.font = "400 30px Inter, Arial, sans-serif"; g.fillStyle = "#443C36"; g.fillText("Scan to see my page \u00b7 SEA ESTATES", size / 2, size + 95);
    return canvas;
  }
  async function qrPng(address, name) {
    const qrcode = await window.ESREALTY_UTIL.loadScriptOnce("vendor/qrcode/qrcode.min.js?v=1", "qrcode");
    return toBlob(qrCanvas(qrcode, address, name));
  }

  /* The page's preview image (1200 x 630): name, role, towns and the licence line on warm paper,
   * with the photo when the browser may draw it. */
  function cardCanvas(pv, photo) {
    const P = window.SEA_AGENT_PAGE;
    const canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 630;
    const g = canvas.getContext("2d");
    const display = '"Schibsted Grotesk", Inter, Arial, sans-serif';
    g.fillStyle = "#F7F3EE"; g.fillRect(0, 0, 1200, 630);
    g.fillStyle = "#0E5F63"; g.fillRect(0, 530, 1200, 100);
    const textRight = photo ? 760 : 1120;
    const fit = (txt, font, max) => { g.font = font; let t = String(txt || ""); while (t.length > 3 && g.measureText(t).width > max) t = t.slice(0, -2); return t === String(txt || "") ? t : t.trim() + "\u2026"; };
    g.fillStyle = "#1C1917"; g.textBaseline = "alphabetic";
    let size = 84; g.font = "800 " + size + "px " + display;
    while (size > 48 && g.measureText(pv.name || "").width > textRight - 80) { size -= 4; g.font = "800 " + size + "px " + display; }
    g.fillText(fit(pv.name, "800 " + size + "px " + display, textRight - 80), 80, 200);
    g.fillStyle = "#443C36";
    g.fillText(fit(pv.role_label, "500 34px Inter, Arial, sans-serif", textRight - 80), 80, 262);
    const towns = P ? P.labels(P.TOWNS, pv.towns || []).slice(0, 3) : [];
    if (towns.length) g.fillText(fit(towns.join(", ") + ", Batangas", "400 32px Inter, Arial, sans-serif", textRight - 80), 80, 314);
    g.fillStyle = "#9A4518"; g.fillText("with SEA ESTATES", 80, 380);
    g.fillStyle = "#FFFFFF";
    const lic = pv.licence;
    g.fillText(fit(lic ? "Licence checked by SEA ESTATES on " + (P ? P.day(lic.checked_on) : lic.checked_on) + " \u00b7 Licence no. " + lic.no : "SEA ESTATES", "600 30px Inter, Arial, sans-serif", 1060), 80, 592);
    if (photo) {
      const w = 340, h = 420, x = 800, y = 70;
      const scale = Math.max(w / photo.naturalWidth, h / photo.naturalHeight);
      const sw = w / scale, sh = h / scale;
      g.save(); g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, 28); else g.rect(x, y, w, h); g.clip();
      g.drawImage(photo, (photo.naturalWidth - sw) / 2, (photo.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
      g.restore();
    }
    return canvas;
  }
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => resolve(img); img.onerror = () => reject(new Error("photo did not load"));
      img.src = url;
    });
  }
  async function cardPng(pv) {
    try { if (document.fonts && document.fonts.load) await document.fonts.load('800 84px "Schibsted Grotesk"'); } catch (e) { /* Inter then */ }
    let photo = null;
    if (pv.photo) { try { photo = await loadImage(pv.photo); } catch (e) { photo = null; } }
    try { return await toBlob(cardCanvas(pv, photo)); }
    catch (e) { return toBlob(cardCanvas(pv, null)); } // a photo the browser may not read back
  }

  window.SEA_AGENT_SHARE = { qrPng: qrPng, cardPng: cardPng };
})();
