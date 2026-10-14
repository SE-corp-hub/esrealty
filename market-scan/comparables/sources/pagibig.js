"use strict";
/* Pag-IBIG Fund acquired assets (Online Public Auction) -> Batangas rows.
 *
 * pagibigfundservices.com/OnlinePublicAuction serves its listing as JSON:
 *   GET ListofProperties/LoadLocations?grpid=3&regionid=040000000&provinceid=041000000
 *       -> the Batangas towns that currently have properties
 *   GET ListofProperties/Load_SearchListProperties_COPA?flag=1&region=..&province=..&city_muni=<TOWN NAME>
 *       -> { data: [ { prop_location, prop_type, lot_area, floor_area, min_sellprice,
 *                      disposal_type, occupancy, remarks, appr_date, ropa_id, ... } ] }
 * One request per town, 1.5 s apart.
 *
 * Price: min_sellprice is the MINIMUM BID. 2nd-auction properties can sell up
 * to 30% below it and negotiated-sale ones up to 45% below, depending on how
 * the winner pays, so the sale stage is kept on every record.
 *
 * Dropped at fetch time and never stored: the housing-business-center contact
 * person, phone and e-mail (contact_hbc, email_hbc, handling_hbc) and the title
 * number. Pag-IBIG's "winning bids" page lists masked bidder names only - no
 * prices, Metro Manila batches only - so it is not a source of completed prices. */

const BASE = "https://www.pagibigfundservices.com/OnlinePublicAuction/ListofProperties/";
const REGION = "040000000", PROVINCE = "041000000"; /* Region IV-A, Batangas */
const KEEP = ["ropa_id", "batch_no", "prop_location", "prop_type", "lot_area", "floor_area", "min_sellprice",
  "appr_date", "remarks", "city_muni", "disposal_flag", "disposal_type", "subdivision", "occupancy", "opening_datetime"];

/* get(url) -> Promise<string>. Returns the JSON text fetch-raw saves. */
async function fetchPagibig(get, sleep) {
  const towns = JSON.parse(await get(BASE + "LoadLocations?" + new URLSearchParams({ grpid: 3, regionid: REGION, provinceid: PROVINCE, cityid: "", brgyid: "" })));
  if (!Array.isArray(towns) || !towns.length) throw new Error("pagibig: no Batangas towns returned");
  const records = [];
  for (const t of towns) {
    await sleep(1500);
    const body = JSON.parse(await get(BASE + "Load_SearchListProperties_COPA?" + new URLSearchParams({ flag: 1, region: REGION, province: PROVINCE, city_muni: t.result_column1 })));
    (body.data || []).forEach(r => records.push(Object.fromEntries(KEEP.map(k => [k, r[k]]))));
  }
  return JSON.stringify({ towns: towns.map(t => t.result_column1), records }, null, 1);
}

const STAGE = { 1: "1st auction", 2: "2nd auction, up to 30% below", 3: "negotiated sale, up to 45% below" };

function propertyTypeOf(t) {
  const s = String(t || "").toLowerCase();
  if (/lot only/.test(s)) return "Vacant Lot";
  if (/condo/.test(s)) return "Condominium";
  if (/row house|town ?house|duplex|quadruplex/.test(s)) return "Townhouse";
  return "House & Lot"; /* single detached / single attached / double attached */
}

function parsePagibigJson(text) {
  const j = JSON.parse(text);
  if (!j || !Array.isArray(j.records)) throw new Error("pagibig: unexpected file - no records[]");
  const rows = j.records.map(r => ({
    code: String(r.ropa_id || ""),
    address: String(r.prop_location || "").replace(/,?\s*\d{4}\s*$/, "").trim(),
    project: String(r.subdivision || "").trim(),
    propertyType: propertyTypeOf(r.prop_type),
    detailType: r.prop_type || "",
    price: Number(r.min_sellprice),
    lotArea: Number(r.lot_area),
    floorArea: Number(r.floor_area) || 0,
    tag: STAGE[Number(r.disposal_flag)] || r.disposal_type || null,
    note: [r.occupancy, String(r.remarks || "").split(/\s+-\s+/).slice(1).join(" - ")].filter(Boolean).join(" - ").toLowerCase() || null
  })).filter(r => r.price > 0 && r.lotArea > 0 && r.address);
  if (j.records.length && !rows.length) throw new Error("pagibig: records present but none readable - layout changed?");
  return { rows };
}

if (typeof module === "object" && module.exports) module.exports = { fetchPagibig, parsePagibigJson, propertyTypeOf };
