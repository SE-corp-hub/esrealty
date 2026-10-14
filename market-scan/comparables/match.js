"use strict";
/* Address -> BIR location (data/bir-batangas): municipality, barangay, street.
 *
 * Bank addresses are free text ("Lot 13, Block 7, Linares St., Camella Sto.
 * Tomas, Brgy. San Miguel, Santo Tomas, Batangas"). The match goes from the end
 * of the address inward, the way the address is written:
 *   1. municipality: the alias that appears LAST (so "Avida Settings Batangas,
 *      ..., San Pascual" is San Pascual, and "Batangas City, Batangas" is
 *      Batangas City, not the province);
 *   2. barangay: a name of that municipality's barangays, searched first in the
 *      text after "Brgy."/"Barangay", then anywhere; roman and arabic numerals
 *      are treated alike (Poblacion III = Poblacion 3), and a barangay listed as
 *      "BANABA EAST (SILANGAN)" also answers to "Banaba East";
 *   3. street: a BIR street/subdivision of that barangay whose distinctive words
 *      all appear in the address.
 * matchLevel records how far it got, so later steps can weigh the record. */

const fs = require("fs"), path = require("path");

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
const GENERIC = new Set(["SUBD", "SUBDIVISION", "VILLAGE", "VILL", "ST", "STREET", "STS", "ROAD", "RD", "AVE", "AVENUE",
  "HOMES", "PHASE", "PH", "ESTATE", "ESTATES", "HEIGHTS", "HTS", "RESIDENCES", "ALONG", "THE", "DE", "DEL", "LA", "LAS", "LOS",
  "SAN", "STA", "STO", "SANTA", "SANTO", "BRGY", "BARANGAY", "INTERIOR", "ALL", "STREETS", "OTHER", "OTHERS", "AND", "COR", "CORNER",
  "NATIONAL", "HIGHWAY", "PROVINCIAL", "BLK", "BLOCK", "LOT", "LOTS", "CITY", "TOWN", "PROPER", "AREA", "HOUSING"]);

function norm(s) {
  return " " + String(s || "").toUpperCase()
    .replace(/Ñ/g, "N")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(SANTO)\b/g, "STO").replace(/\b(SANTA)\b/g, "STA")
    .replace(/\b(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)\b/g, r => String(ROMAN[r]))
    .replace(/\bSILANGAN\b/g, "EAST").replace(/\bKANLURAN\b/g, "WEST").replace(/\bHILAGA\b/g, "NORTH").replace(/\bTIMOG\b/g, "SOUTH")
    .replace(/\bNORTE\b/g, "NORTH").replace(/\bSUR\b/g, "SOUTH").replace(/\bESTE\b/g, "EAST").replace(/\bOESTE\b/g, "WEST")
    .replace(/K/g, "C") /* Labak/Labac, Kaylaway/Caylaway: one spelling key for both sides */
    .replace(/\s+/g, " ").trim() + " ";
}

/* Municipality aliases beyond the plain BIR name. */
const MUNI_ALIASES = {
  "BATANGAS CITY": ["BATANGAS CITY"],
  "LIPA CITY": ["LIPA CITY", "LIPA"],
  "STO. TOMAS CITY": ["STO TOMAS CITY", "STO TOMAS"],
  "TANAUAN CITY": ["TANAUAN CITY", "TANAUAN"],
  "STA. TERESITA": ["STA TERESITA"],
  "LAUREL": ["LAUREL CITY", "LAUREL"],
  "CALACA": ["CALACA CITY", "CALACA"]
};

function loadBir(root) {
  const dir = path.join(root, "data/bir-batangas");
  const loc = JSON.parse(fs.readFileSync(path.join(dir, "locations.json"), "utf8"));
  const munis = loc.municipalities.map(m => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, "municipalities", m.slug + ".json"), "utf8"));
    const aliases = (MUNI_ALIASES[m.name] || [m.name]).map(a => norm(a));
    const barangays = Object.keys(data.barangays).map(name => {
      const variants = new Set([norm(name)]);
      const bare = name.replace(/\([^)]*\)/g, " ");
      variants.add(norm(bare));
      /* An alternate name in brackets ("PALACPAC (PAKPAK)") also counts; a bare
         direction or "POBLACION" in brackets does not name anything by itself. */
      (name.match(/\(([^)]*)\)/g) || []).forEach(p => {
        const v = norm(p.slice(1, -1));
        if (v.trim().length > 3 && !/^ (?:EAST|WEST|NORTH|SOUTH|POBLACION|CON T) $/.test(v) && !/\d/.test(v)) variants.add(v);
      });
      /* "POBLACION I, II, III" is three places: Poblacion 1, 2 and 3 */
      const list = norm(bare).match(/^ (POBLACION|BARANGAY|ZONE) ((?:\d+ )+)$/);
      if (list) list[2].trim().split(" ").forEach(n => variants.add(" " + list[1] + " " + n + " "));
      /* "POBLACION 2", "BARANGAY 2" and "BARANGAY E" / "POBLACION E" name the same place */
      const num = norm(bare).match(/^ (?:BARANGAY|POBLACION|ZONE) (\d+|[A-Z]) $/);
      if (num) { variants.add(" POBLACION " + num[1] + " "); variants.add(" BARANGAY " + num[1] + " "); }
      return { name, variants: [...variants].filter(v => v.trim()), data: data.barangays[name] };
    });
    return { name: m.name, slug: m.slug, aliases, barangays };
  });
  return { munis };
}

function findMunicipality(bir, address) {
  /* Drop the trailing province so "Batangas City, Batangas" ends in the city. */
  /* Every bank address names the province; one that doesn't is elsewhere
     ("Brgy. Taysan, Legazpi City, Albay" is not Taysan, Batangas). */
  if (norm(address).indexOf(" BATANGAS ") < 0) return null;
  const a = norm(address).replace(/ BATANGAS(?: PROVINCE)? $/, " ");
  let best = null;
  bir.munis.forEach(m => m.aliases.forEach(al => {
    const i = a.lastIndexOf(al);
    if (i < 0) return;
    const score = i + al.length; /* the alias ending latest wins; longer wins ties */
    if (!best || score > best.score || (score === best.score && al.length > best.len)) best = { m, score, len: al.length };
  }));
  return best && best.m;
}

function findBarangay(muni, address) {
  const a = norm(address);
  const marker = a.search(/ (?:BRGY|BARANGAY|BGY) /);
  const zones = marker >= 0 ? [a.slice(marker + 1), a] : [a];
  for (const zone of zones) {
    let best = null;
    muni.barangays.forEach(b => b.variants.forEach(v => {
      const i = zone.indexOf(v);
      if (i < 0) return;
      /* earliest after the marker wins ("San Gabriel / San Gregorio"); longest breaks ties */
      if (!best || i < best.i || (i === best.i && v.length > best.len)) best = { b, i, len: v.length };
    }));
    if (best) return best.b;
  }
  return null;
}

function distinctive(name) {
  return norm(name).trim().split(" ").filter(w => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w));
}

function findStreet(brgy, address) {
  const a = norm(address);
  let best = null;
  Object.keys(brgy.data.streets || {}).forEach(key => {
    const st = brgy.data.streets[key];
    const words = distinctive(st.name || key);
    if (!words.length) return;
    if (words.every(w => a.indexOf(" " + w + " ") >= 0) && (!best || words.length > best.n)) best = { key, st, n: words.length };
  });
  return best;
}

function classFor(kind) {
  return kind === "industrial_lot" ? "I" : kind === "commercial" ? "CR" : "RR";
}

/* -> { municipality, barangay, streetKey, matchLevel, birRate, birClass } */
function matchAddress(bir, address, kind) {
  const out = { municipality: null, barangay: null, streetKey: null, matchLevel: "none", birRate: null, birClass: classFor(kind) };
  const m = findMunicipality(bir, address);
  if (!m) return out;
  out.municipality = m.name;
  out.matchLevel = "municipality";
  const b = findBarangay(m, address);
  if (!b) return out;
  out.barangay = b.name;
  out.matchLevel = "barangay";
  const cls = out.birClass;
  const s = findStreet(b, address);
  if (s && s.st.classes && s.st.classes[cls] && s.st.classes[cls].value > 0) {
    out.streetKey = s.key;
    out.matchLevel = "street";
    out.birRate = Number(s.st.classes[cls].value);
    return out;
  }
  const other = b.data.other && b.data.other[cls];
  const all = b.data.streets && b.data.streets["all streets"] && b.data.streets["all streets"].classes[cls];
  out.birRate = other ? Number(other) : all ? Number(all.value) : null;
  return out;
}

module.exports = { loadBir, matchAddress, norm };
