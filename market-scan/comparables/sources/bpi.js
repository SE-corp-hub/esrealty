"use strict";
/* BPI Buena Mano "Properties for Sale - Luzon" page -> Batangas rows.
 *
 * The page is one HTML table per province under an "<Province> Properties"
 * heading, columns: BM Code | Address | Lot / Floor Area (sqm) | Selling Price |
 * Property Category and Type ("House & Lot - Yellow Tag") | Sales Officer.
 *
 * The Sales Officer column holds a named person and contact details. It is never
 * read: cells are taken by header position and that column is skipped, so no
 * personal data reaches the snapshot even transiently. */

const decode = s => s
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&ntilde;/g, "ñ").replace(/&Ntilde;/g, "Ñ")
  .replace(/\s+/g, " ").trim();

const WANT = {
  code: /BM\s*Code/i,
  address: /^Address/i,
  area: /Lot\s*\/\s*Floor/i,
  price: /Selling\s*Price/i,
  type: /Category|Type/i
};

function parseBpiHtml(html, province) {
  province = province || "Batangas";
  /* Find the province's heading, then the first table after it. */
  const headRe = new RegExp("<h\\d[^>]*>\\s*(?:<[^>]+>\\s*)*" + province + "\\s+Properties", "i");
  const hm = headRe.exec(html);
  if (!hm) throw new Error("bpi: heading '" + province + " Properties' not found - layout changed?");
  const after = html.slice(hm.index);
  const tm = /<table[\s\S]*?<\/table>/i.exec(after);
  if (!tm) throw new Error("bpi: no table under '" + province + " Properties'");
  const trs = tm[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const head = (trs[0] || "").match(/<th[^>]*>[\s\S]*?<\/th>/gi) || [];
  const idx = {};
  head.map(decode).forEach((h, i) => {
    Object.keys(WANT).forEach(k => { if (idx[k] == null && WANT[k].test(h)) idx[k] = i; });
  });
  ["code", "address", "area", "price", "type"].forEach(k => {
    if (idx[k] == null) throw new Error("bpi: column '" + k + "' missing - layout changed?");
  });

  const rows = [];
  trs.slice(1).forEach(tr => {
    const tds = tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
    if (tds.length < head.length) return;
    const cell = k => decode(tds[idx[k]]);
    const area = cell("area").split("/").map(s => Number(s.replace(/[^\d.]/g, "")));
    const typeTag = cell("type").split(/\s+-\s+/);
    const row = {
      code: cell("code"),
      address: cell("address"),
      lotArea: area[0],
      floorArea: area[1] || 0,
      price: Number(cell("price").replace(/[^\d.]/g, "")),
      propertyType: typeTag[0] || "",
      tag: (typeTag[1] || "").replace(/\s*tag$/i, "").toLowerCase()
    };
    if (!(row.price > 0) || !(row.lotArea > 0) || !row.address) throw new Error("bpi: unreadable row " + JSON.stringify(row));
    /* The province table can carry a stray row from elsewhere; keep only
       addresses that end in the province. */
    if (new RegExp(province + "\\s*$", "i").test(row.address)) rows.push(row);
  });
  if (!rows.length) throw new Error("bpi: no " + province + " rows - layout changed?");
  return { rows };
}

if (typeof module === "object" && module.exports) module.exports = { parseBpiHtml };
