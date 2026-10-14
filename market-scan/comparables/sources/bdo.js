"use strict";
/* BDO "Acquired Assets for sale" province PDF -> rows.
 *
 * The PDF (e.g. Luzon_Batangas.pdf) is printed by Chromium/Skia: every text run
 * is a hex glyph string with a ToUnicode map, positioned by Tm/Td inside a page
 * that is flipped with a cm matrix. There is no table structure in the file, so
 * this reads positioned text and rebuilds the table from x/y:
 *
 *   x   0- 80 Category (Retail)       x 278-595 Property Address
 *   x  80-172 Property Type           x 595-700 Advertised Price (Php)
 *   x 172-278 Project Name            x 700-765 Lot Area   x 765+ Floor Area
 *
 * A wrapped cell is centred vertically on its row, so every text line is given
 * to the nearest "anchor" line (the one carrying the price). The footer (BDO's
 * Property Management Unit contact block) is never part of a row and is dropped.
 *
 * No dependency on poppler: a small reader for exactly this kind of PDF is
 * enough, and parse errors surface as thrown errors so the monthly run opens an
 * issue instead of committing an empty or garbled snapshot. */

const COLS = [["category", 80], ["propertyType", 172], ["project", 278], ["address", 595], ["price", 700], ["lotArea", 765], ["floorArea", Infinity]];
const ROW_REACH = 25; /* a wrapped line sits at most ~21 units from its anchor */

function latin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return s;
}

/* bytes: Uint8Array of the PDF. inflate: async (Uint8Array) -> Uint8Array.
   Returns [{page, x, y, str}] with y growing up the page. */
async function extractPdfItems(bytes, inflate) {
  const s = latin1(bytes);
  if (!/^%PDF-/.test(s)) throw new Error("bdo: not a PDF");
  const objs = {};
  const re = /(\d+) 0 obj\b([\s\S]*?)endobj/g;
  let m;
  while ((m = re.exec(s))) objs[m[1]] = { raw: m[2], start: m.index + m[0].indexOf(m[2]) };

  async function streamText(id) {
    const o = objs[id];
    if (!o) return "";
    const i = o.raw.indexOf("stream");
    if (i < 0) return "";
    let st = i + 6;
    if (o.raw[st] === "\r") st++;
    if (o.raw[st] === "\n") st++;
    const dict = o.raw.slice(0, i);
    let len = dict.match(/\/Length (\d+)(?! \d+ R)/);
    if (len) len = +len[1];
    else {
      const ref = dict.match(/\/Length (\d+) 0 R/);
      len = ref ? +(objs[ref[1]].raw.trim()) : o.raw.indexOf("endstream") - st;
    }
    const data = bytes.subarray(o.start + st, o.start + st + len);
    return latin1(/FlateDecode/.test(dict) ? await inflate(data) : data);
  }

  const cmaps = {};
  async function cmapFor(fontId) {
    if (cmaps[fontId]) return cmaps[fontId];
    const map = {};
    const fr = objs[fontId] && objs[fontId].raw.match(/\/ToUnicode (\d+) 0 R/);
    if (fr) {
      const t = await streamText(fr[1]);
      const u16 = h => String.fromCharCode.apply(null, h.match(/.{4}/g).map(x => parseInt(x, 16)));
      t.replace(/beginbfchar([\s\S]*?)endbfchar/g, (_, b) => b.replace(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, (_, a, u) => { map[parseInt(a, 16)] = u16(u); }));
      t.replace(/beginbfrange([\s\S]*?)endbfrange/g, (_, b) => b.replace(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, (_, a, z, u) => {
        const A = parseInt(a, 16), Z = parseInt(z, 16), U = parseInt(u, 16);
        for (let k = A; k <= Z; k++) map[k] = String.fromCharCode(U + k - A);
      }));
    }
    return (cmaps[fontId] = map);
  }

  /* Page order from the page tree, falling back to object order. */
  let pageIds = [];
  const root = Object.keys(objs).find(id => /\/Type\s*\/Pages\b/.test(objs[id].raw) && !/\/Parent/.test(objs[id].raw));
  (function walk(id) {
    const raw = objs[id] && objs[id].raw;
    if (!raw) return;
    if (/\/Type\s*\/Page\b/.test(raw)) { pageIds.push(id); return; }
    const kids = raw.match(/\/Kids\s*\[([^\]]*)\]/);
    if (kids) (kids[1].match(/\d+ 0 R/g) || []).forEach(k => walk(k.split(" ")[0]));
  })(root);
  if (!pageIds.length) pageIds = Object.keys(objs).filter(id => /\/Type\s*\/Page\b/.test(objs[id].raw));

  const items = [];
  for (let p = 0; p < pageIds.length; p++) {
    const raw = objs[pageIds[p]].raw;
    const resRef = raw.match(/\/Resources (\d+) 0 R/);
    const resRaw = resRef ? objs[resRef[1]].raw : raw;
    let fontDict = resRaw.match(/\/Font\s*<<([\s\S]*?)>>/);
    if (!fontDict) { const fr = resRaw.match(/\/Font (\d+) 0 R/); if (fr) fontDict = [0, objs[fr[1]].raw]; }
    const fonts = {};
    if (fontDict) {
      const pairs = fontDict[1].match(/\/[\w.+-]+ \d+ 0 R/g) || [];
      for (const pr of pairs) { const [, n, i] = pr.match(/\/([\w.+-]+) (\d+) 0 R/); fonts[n] = await cmapFor(i); }
    }
    let content = "";
    const cArr = raw.match(/\/Contents\s*\[([^\]]*)\]/);
    const cIds = cArr ? (cArr[1].match(/\d+ 0 R/g) || []).map(r => r.split(" ")[0]) : [(raw.match(/\/Contents (\d+) 0 R/) || [])[1]];
    for (const id of cIds) content += (await streamText(id)) + "\n";

    const N = "[-\\d.]+";
    const tokRe = new RegExp("\\[[^\\]]*\\]\\s*TJ|<[0-9A-Fa-f]*>\\s*Tj|\\/[\\w.+-]+ " + N + " Tf|(?:" + N + " ){6}(?:Tm|cm)|" + N + " " + N + " T[dD]|\\bBT\\b|\\bET\\b|(?:^|\\s)[qQ](?=\\s)", "g");
    let font = {}, tm = [1, 0, 0, 1, 0, 0], ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const toks = content.match(tokRe) || [];
    for (let t of toks) {
      t = t.trim();
      if (t.endsWith("Tf")) font = fonts[t.match(/\/([\w.+-]+)/)[1]] || {};
      else if (t.endsWith(" cm")) {
        const v = t.split(/\s+/).slice(0, 6).map(Number);
        ctm = [v[0] * ctm[0] + v[1] * ctm[2], v[0] * ctm[1] + v[1] * ctm[3], v[2] * ctm[0] + v[3] * ctm[2], v[2] * ctm[1] + v[3] * ctm[3], v[4] * ctm[0] + v[5] * ctm[2] + ctm[4], v[4] * ctm[1] + v[5] * ctm[3] + ctm[5]];
      } else if (t === "q") stack.push(ctm.slice());
      else if (t === "Q") ctm = stack.pop() || ctm;
      else if (t === "BT") tm = [1, 0, 0, 1, 0, 0];
      else if (t.endsWith("Tm")) tm = t.split(/\s+/).slice(0, 6).map(Number);
      else if (/T[dD]$/.test(t)) { const v = t.split(/\s+/).map(Number); tm[4] += v[0] * tm[0]; tm[5] += v[1] * tm[3]; }
      else if (/T[jJ]$/.test(t)) {
        let str = "";
        (t.match(/<([0-9A-Fa-f]*)>/g) || []).forEach(h => { h = h.slice(1, -1); for (let k = 0; k < h.length; k += 4) str += font[parseInt(h.substr(k, 4), 16)] || ""; });
        const X = tm[4] * ctm[0] + tm[5] * ctm[2] + ctm[4], Y = tm[4] * ctm[1] + tm[5] * ctm[3] + ctm[5];
        if (str) items.push({ page: p + 1, x: Math.round(X), y: Math.round(Y), str });
      }
    }
  }
  return items;
}

const num = s => { const v = Number(String(s).replace(/[^\d.]/g, "")); return isFinite(v) ? v : NaN; };
const clean = s => s.replace(/\s+/g, " ").replace(/\s+([,.)])/g, "$1").replace(/\(\s+/g, "(").trim();

/* items -> { asOf: "YYYY-MM-DD"|null, rows: [...] }. Throws when the layout no
   longer looks like the BDO table, so a redesign is reported, not swallowed. */
function parseBdoItems(items) {
  const all = items.map(i => i.str).join("");
  const asOfM = all.replace(/\s+/g, "").match(/asof(\d{1,2})([A-Za-z]{3})[a-z]*(\d{4})/i);
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const asOf = asOfM && MON[asOfM[2].toLowerCase()]
    ? asOfM[3] + "-" + String(MON[asOfM[2].toLowerCase()]).padStart(2, "0") + "-" + asOfM[1].padStart(2, "0") : null;
  if (!/Advertised\s*Price/i.test(all)) throw new Error("bdo: header 'Advertised Price' not found - layout changed?");

  const rows = [];
  const pages = [...new Set(items.map(i => i.page))];
  for (const page of pages) {
    const lines = {};
    items.filter(i => i.page === page).forEach(i => { (lines[i.y] = lines[i.y] || []).push(i); });
    const ys = Object.keys(lines).map(Number).sort((a, b) => b - a);
    const cellsOf = y => {
      const c = {};
      lines[y].sort((a, b) => a.x - b.x).forEach(i => {
        const col = COLS.find(([, max]) => i.x < max)[0];
        c[col] = (c[col] || "") + i.str;
      });
      return c;
    };
    const anchors = ys.filter(y => { const c = cellsOf(y); return /^\s*[\d,]+\.\d\d\s*$/.test(c.price || "") && /\d/.test(c.lotArea || ""); });
    const groups = new Map(anchors.map(a => [a, []]));
    ys.forEach(y => {
      let best = null, d = Infinity;
      anchors.forEach(a => { const dd = Math.abs(a - y); if (dd < d) { d = dd; best = a; } });
      if (best != null && d <= ROW_REACH) groups.get(best).push(y);
    });
    for (const [, gys] of groups) {
      const rec = {};
      gys.sort((a, b) => b - a).forEach(y => {
        const c = cellsOf(y);
        Object.keys(c).forEach(k => { rec[k] = rec[k] ? rec[k] + " " + c[k] : c[k]; });
      });
      Object.keys(rec).forEach(k => { rec[k] = clean(rec[k]); });
      const row = {
        category: rec.category || "", propertyType: rec.propertyType || "", project: rec.project || "",
        address: rec.address || "", price: num(rec.price), lotArea: num(rec.lotArea), floorArea: num(rec.floorArea || "0")
      };
      if (!(row.price > 0) || !row.address) throw new Error("bdo: unreadable row on page " + page + ": " + JSON.stringify(rec));
      rows.push(row);
    }
  }
  if (!rows.length) throw new Error("bdo: no rows found - layout changed?");
  return { asOf, rows };
}

async function parseBdoPdf(bytes, inflate) {
  return parseBdoItems(await extractPdfItems(bytes, inflate));
}

if (typeof module === "object" && module.exports) module.exports = { extractPdfItems, parseBdoItems, parseBdoPdf };
