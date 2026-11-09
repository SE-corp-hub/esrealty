/* Public-site helpers added on 2026-11-09 (js/storefront.js uses them). Pure functions only, so
 * tests/sf_extras_node.js can require() this file directly:
 *
 *   payment     monthly payment for a loan, lender presets (Pag-IBIG, bank, in-house), income needed
 *   chat        Viber and Messenger links from the office phone and Facebook page
 *   parseQuery  plain-language search ("3 bedroom house in Lipa under 5M") -> search filters
 *   travel      straight-line distance and an estimated drive time to a place the buyer picks
 *   trends      town price summary from data/comparables/history.json (bank and Pag-IBIG prices)
 *   inPolygon   is a map point inside the area the buyer drew
 *   t / lang    English or Filipino for the public pages
 */
(function (root) {
  "use strict";

  /* ---------------- Monthly payment ---------------- */
  // Example rates only: every lender sets its own, and the listing page says so. Pag-IBIG's
  // housing loan goes up to P6,000,000 and 30 years; lenders usually allow about 35% of gross
  // monthly income for the payment.
  var LENDERS = [
    { id: "pagibig", label: "Pag-IBIG", rate: 6.25, years: 30, downPct: 10, maxLoan: 6000000, maxYears: 30 },
    { id: "bank", label: "Bank", rate: 7.5, years: 20, downPct: 20, maxLoan: 0, maxYears: 25 },
    { id: "inhouse", label: "In-house", rate: 14, years: 5, downPct: 20, maxLoan: 0, maxYears: 10 }
  ];
  var INCOME_SHARE = 0.35;

  function monthlyPayment(principal, ratePct, years) {
    var p = Number(principal), r = Number(ratePct) / 100 / 12, n = Math.round(Number(years) * 12);
    if (!(p > 0) || !(n > 0) || !isFinite(p) || !isFinite(r) || r < 0) return 0;
    if (r === 0) return p / n;
    return p * r / (1 - Math.pow(1 + r, -n));
  }

  /* price, down payment (%), rate (%), years, lender id -> the figures the payment box shows. */
  function payment(price, downPct, ratePct, years, lenderId) {
    var lender = LENDERS.filter(function (l) { return l.id === lenderId; })[0] || null;
    var cost = Math.max(0, Number(price) || 0);
    var down = Math.min(100, Math.max(0, Number(downPct) || 0));
    var loan = Math.round(cost * (1 - down / 100));
    var capped = false;
    if (lender && lender.maxLoan && loan > lender.maxLoan) { loan = lender.maxLoan; capped = true; }
    var downAmount = cost - loan;
    var monthly = monthlyPayment(loan, ratePct, years);
    return {
      price: cost, loan: loan, downPayment: downAmount, monthly: Math.round(monthly),
      totalPaid: Math.round(monthly * Math.round(Number(years) * 12)),
      incomeNeeded: Math.round(Math.round(monthly) / INCOME_SHARE),
      capped: capped
    };
  }

  /* ---------------- Viber and Messenger ---------------- */
  function phDigits(phone) {
    var d = String(phone || "").replace(/[^\d+]/g, "");
    if (/^0\d{10}$/.test(d)) return "+63" + d.slice(1);
    if (/^63\d{10}$/.test(d)) return "+" + d;
    if (/^\+63\d{10}$/.test(d)) return d;
    return "";
  }
  function viberLink(phone) {
    var n = phDigits(phone);
    return n ? "viber://chat?number=" + encodeURIComponent(n) : "";
  }
  /* A page username ("seaestates.ph") or a facebook.com / m.me address -> https://m.me/<username>. */
  function messengerLink(value) {
    var v = String(value || "").trim();
    if (!v) return "";
    var m = v.match(/^https:\/\/(?:www\.|m\.)?(?:facebook\.com|m\.me|fb\.com)\/([A-Za-z0-9.\-]{3,80})\/?(?:\?.*)?$/);
    var name = m ? m[1] : (/^@?[A-Za-z0-9.\-]{3,80}$/.test(v) ? v.replace(/^@/, "") : "");
    if (!name || /^(profile\.php|pages|groups|people)$/i.test(name)) return "";
    return "https://m.me/" + encodeURIComponent(name);
  }

  /* ---------------- Plain-language search ---------------- */
  // Batangas towns and cities (the Value Guide's province), plus a few common nearby ones.
  var TOWNS = ["Agoncillo", "Alitagtag", "Balayan", "Balete", "Batangas City", "Bauan", "Calaca", "Calatagan",
    "Cuenca", "Ibaan", "Laurel", "Lemery", "Lian", "Lipa", "Lobo", "Mabini", "Malvar", "Mataasnakahoy",
    "Nasugbu", "Padre Garcia", "Rosario", "San Jose", "San Juan", "San Luis", "San Nicolas", "San Pascual",
    "Santa Teresita", "Santo Tomas", "Sto. Tomas", "Taal", "Talisay", "Tanauan", "Taysan", "Tingloy", "Tuy",
    "Calamba", "Santa Rosa", "Tagaytay", "Silang", "Dasmariñas", "Imus", "Bacoor", "Biñan", "Cabuyao"];

  var TYPES = [
    [/\b(house\s*(?:and|&|n)\s*lot|house|bahay(?:\s+at\s+lupa)?|h&l)\b/i, "house-and-lot"],
    [/\b(condo(?:minium)?s?|unit)\b/i, "condominium"],
    [/\b(townhouses?|town\s*house|rowhouse)\b/i, "townhouse"],
    [/\b(shophouses?|shop\s*house)\b/i, "shophouse"],
    [/\b(commercial|office|store\s*space|puwesto|pwesto)\b/i, "commercial"],
    [/\b(warehouse|industrial|bodega)\b/i, "industrial"],
    [/\b(farm(?:\s*lot)?|agri(?:cultural)?|bukid|sakahan)\b/i, "agricultural"],
    [/\b(vacant\s+lot|lot\s+only|lots?|land|lupa)\b/i, "lot-only"]
  ];
  var STOP = ["a", "an", "the", "in", "at", "near", "with", "for", "and", "or", "of", "to", "i", "want", "need",
    "looking", "look", "find", "me", "show", "some", "any", "property", "properties", "sale", "rent", "sa", "na",
    "ng", "may", "ang", "mga", "po", "yung", "isang", "malapit", "gusto", "ko", "city", "batangas", "province"];

  function amount(num, unit) {
    var n = Number(String(num).replace(/,/g, ""));
    if (!isFinite(n) || n <= 0) return 0;
    var u = String(unit || "").toLowerCase();
    if (/^(m|mil|million|milyon)/.test(u)) n *= 1000000;
    else if (/^(k|thousand|libo)/.test(u)) n *= 1000;
    else if (n < 1000) n *= 1000000; // "under 5" in a property search means P5 million
    return Math.round(n);
  }

  /* text -> { filters: {city, property_type, offer_type, max_price, min_price, beds, checked, q}, understood: [labels] }.
   * Only fills what it recognises; the rest of the words stay as keywords. */
  function parseQuery(text, towns) {
    var s = " " + String(text || "").slice(0, 200).replace(/\s+/g, " ") + " ";
    var filters = {}, understood = [];
    function take(re, fn) { var m = s.match(re); if (m) { fn(m); s = s.replace(m[0], " "); return true; } return false; }

    take(/\b(for\s+rent|to\s+rent|rental|rent|paupahan|uupahan|for\s+lease|lease)\b/i, function () { filters.offer_type = "rent"; understood.push("For rent"); });
    if (!filters.offer_type) take(/\b(for\s+sale|to\s+buy|buy|bibilhin|bilhin|benta|binebenta)\b/i, function () { filters.offer_type = "sale"; understood.push("For sale"); });
    take(/\b(checked|verified)\b/i, function () { filters.checked = "true"; understood.push("Checked by SEA ESTATES"); });

    var unit = "(m|mil|million|milyon|k|thousand|libo)?";
    var num = "(\\d+(?:[.,]\\d+)?)";
    if (!take(new RegExp("(?:P|₱|php)?\\s*" + num + "\\s*" + unit + "\\s*(?:-|to|hanggang)\\s*(?:P|₱|php)?\\s*" + num + "\\s*" + unit + "\\b(?!\\s*(?:br|bed|kwarto|sqm))", "i"), function (m) {
      var lo = amount(m[1], m[2] || m[4]), hi = amount(m[3], m[4] || m[2]);
      if (lo && hi && hi >= lo) { filters.min_price = String(lo); filters.max_price = String(hi); understood.push("₱" + short(lo) + " to ₱" + short(hi)); }
    })) {
      take(new RegExp("\\b(?:under|below|less\\s+than|up\\s+to|max(?:imum)?|budget(?:\\s+of)?|hanggang|wala\\s+pang|within)\\s*(?:P|₱|php)?\\s*" + num + "\\s*" + unit + "\\b", "i"), function (m) {
        var v = amount(m[1], m[2]); if (v) { filters.max_price = String(v); understood.push("Up to ₱" + short(v)); }
      });
      take(new RegExp("\\b(?:over|above|more\\s+than|at\\s+least|from|min(?:imum)?)\\s*(?:P|₱|php)?\\s*" + num + "\\s*" + unit + "\\b", "i"), function (m) {
        var v = amount(m[1], m[2]); if (v) { filters.min_price = String(v); understood.push("From ₱" + short(v)); }
      });
    }
    // A bare amount with a unit ("15k", "5M") is a budget.
    if (!filters.max_price && !filters.min_price) take(/(?:^|\s)(?:P|₱|php)?\s*(\d+(?:[.,]\d+)?)\s*(m|mil|million|milyon|k)\b/i, function (m) {
      var v = amount(m[1], m[2]); if (v) { filters.max_price = String(v); understood.push("Up to ₱" + short(v)); }
    });
    take(/\b(\d{1,2})\s*-?\s*(?:br|bdr|bed(?:room)?s?|kwarto|silid)\b/i, function (m) { filters.beds = String(Number(m[1])); understood.push(m[1] + "+ bedrooms"); });
    for (var i = 0; i < TYPES.length; i++) {
      if (take(TYPES[i][0], function () { filters.property_type = TYPES[i][1]; })) { understood.push(TYPE_LABELS[TYPES[i][1]]); break; }
    }
    var list = (towns && towns.length ? towns : TOWNS).slice().sort(function (a, b) { return b.length - a.length; });
    for (var j = 0; j < list.length; j++) {
      var name = list[j], esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/^(Santo|Sto\\\.) /i, "(?:Santo|Sto\\.) ");
      if (take(new RegExp("\\b" + esc + "(?:\\s+city)?\\b", "i"), function () {})) {
        var city = /^(Santo|Sto\.) Tomas$/i.test(name) ? "Tomas" : name.replace(/ City$/i, "");
        filters.city = city; understood.push(name); break;
      }
    }
    var words = s.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(function (w) {
      return w.length >= 3 && STOP.indexOf(w) < 0 && !/^\d+$/.test(w);
    }).slice(0, 4);
    if (words.length) filters.q = words.join(" ");
    return { filters: filters, understood: understood };
  }
  var TYPE_LABELS = { "house-and-lot": "House & Lot", condominium: "Condominium", townhouse: "Townhouse", shophouse: "Shophouse", commercial: "Commercial", industrial: "Industrial", agricultural: "Agricultural", "lot-only": "Land" };
  function short(n) {
    if (n >= 1000000) return (Math.round(n / 100000) / 10) + "M";
    if (n >= 1000) return Math.round(n / 1000) + "K";
    return String(n);
  }
  /* Does the keyword box read like a sentence we can turn into filters? */
  function looksLikeSentence(text) {
    var r = parseQuery(text);
    return r.understood.length > 0;
  }

  /* ---------------- Travel time ---------------- */
  // Approximate centre points. The listing page labels every figure "about", straight-line based.
  var PLACES = [
    { id: "lipa", label: "Lipa City proper", lat: 13.9411, lng: 121.1631 },
    { id: "batangas", label: "Batangas City proper", lat: 13.7565, lng: 121.0583 },
    { id: "port", label: "Batangas Port", lat: 13.7536, lng: 121.0447 },
    { id: "tanauan", label: "Tanauan City proper", lat: 14.0863, lng: 121.1497 },
    { id: "stotomas", label: "Sto. Tomas City proper", lat: 14.1079, lng: 121.1414 },
    { id: "makati", label: "Makati (Ayala Avenue)", lat: 14.5547, lng: 121.0244 },
    { id: "naia", label: "NAIA airport", lat: 14.5086, lng: 121.0194 }
  ];
  function distanceKm(aLat, aLng, bLat, bLng) {
    var R = 6371, toRad = Math.PI / 180;
    var dLat = (bLat - aLat) * toRad, dLng = (bLng - aLng) * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /* Road distance is about 1.3x the straight line in Batangas; average 40 km/h door to door (town
   * roads plus expressway). Rounded to 5 minutes, at least 5. */
  function travel(aLat, aLng, bLat, bLng) {
    var a = [aLat, aLng, bLat, bLng].map(Number);
    if (a.some(function (x) { return !isFinite(x); })) return null;
    var km = distanceKm(a[0], a[1], a[2], a[3]);
    var road = km * 1.3;
    var minutes = Math.max(5, Math.round(road / 40 * 60 / 5) * 5);
    return { km: Math.round(km * 10) / 10, roadKm: Math.round(road), minutes: minutes };
  }
  function minutesLabel(m, fil) {
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60), r = m % 60;
    return h + (fil ? " oras" : " hr") + (r ? " " + r + " min" : "");
  }

  /* ---------------- Price trends ---------------- */
  /* history.json -> one row per town: latest month's median price per sqm of lot for built
   * properties (house & lot, townhouse) and vacant lots, with the count and the change since the
   * previous month when both months have at least minN prices. */
  function trends(history, minN) {
    var months = (history && Array.isArray(history.months)) ? history.months.slice() : [];
    months.sort(function (a, b) { return String(a.month).localeCompare(String(b.month)); });
    var min = minN || 5;
    if (!months.length) return { month: "", previous: "", rows: [], months: [] };
    var last = months[months.length - 1], prev = months.length > 1 ? months[months.length - 2] : null;
    function find(m, town, kind) { return ((m && m.byTown) || []).filter(function (r) { return r.town === town && r.kind === kind; })[0] || null; }
    var towns = {};
    (last.byTown || []).forEach(function (r) { towns[r.town] = true; });
    var rows = Object.keys(towns).map(function (town) {
      var row = { town: town };
      ["built", "vacant"].forEach(function (kind) {
        var now = find(last, town, kind), before = find(prev, town, kind);
        row[kind] = now ? {
          median: Number(now.medianPricePerSqm) || 0, n: Number(now.n) || 0,
          change: before && now.n >= min && before.n >= min && before.medianPricePerSqm > 0 ? Math.round((now.medianPricePerSqm / before.medianPricePerSqm - 1) * 1000) / 1000 : null
        } : null;
      });
      row.n = (row.built ? row.built.n : 0) + (row.vacant ? row.vacant.n : 0);
      return row;
    }).sort(function (a, b) { return b.n - a.n || a.town.localeCompare(b.town); });
    var series = months.map(function (m) {
      return { month: m.month, byTown: (m.byTown || []).map(function (r) { return { town: r.town, kind: r.kind, median: r.medianPricePerSqm, n: r.n }; }) };
    });
    return { month: last.month, previous: prev ? prev.month : "", rows: rows, months: series };
  }
  function titleTown(name) {
    return String(name || "").toLowerCase().replace(/(^|[\s.(-])([a-zñ])/g, function (m, a, b) { return a + b.toUpperCase(); }).replace(/\bSto\b/, "Sto");
  }

  /* ---------------- Drawn search area ---------------- */
  function inPolygon(lat, lng, poly) {
    if (!Array.isArray(poly) || poly.length < 3) return false;
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /* ---------------- English / Filipino ---------------- */
  var FIL = {
    "Home": "Home",
    "Properties": "Mga Property",
    "Free Value Guide": "Libreng Value Guide",
    "Price trends": "Presyo sa bawat bayan",
    "PROPERTY SEARCH": "PAGHAHANAP NG PROPERTY",
    "Find a property that fits.": "Hanapin ang property na bagay sa iyo.",
    "Browse the properties SEA ESTATES has listed for sale or rent. The free Value Guide covers Batangas province.": "Tingnan ang mga property na ibinebenta o pinauupahan ng SEA ESTATES. Saklaw ng libreng Value Guide ang buong Batangas.",
    "Keyword": "Hanapin",
    "Location": "Lokasyon",
    "State / province": "Probinsya",
    "Property type": "Uri ng property",
    "Listing type": "Benta o upa",
    "Budget up to": "Budget hanggang",
    "Bedrooms": "Kwarto",
    "Any": "Kahit ilan",
    "Any property": "Kahit anong property",
    "For sale or rent": "Benta o upa",
    "For sale": "Ibinebenta",
    "For rent": "Paupahan",
    "Any price": "Kahit magkano",
    "City or municipality": "Lungsod o bayan",
    "e.g. Batangas": "hal. Batangas",
    "Try: 3 bedroom house in Lipa under 5M": "Subukan: bahay sa Lipa 3 kwarto hanggang 5M",
    "Search properties": "Maghanap",
    "More filters": "Iba pang filter",
    "Filtered by": "Naka-filter sa",
    "Clear all": "Alisin lahat",
    "Newest": "Pinakabago",
    "Price: Low to high": "Presyo: mababa pataas",
    "Price: High to low": "Presyo: mataas pababa",
    "Grid": "Grid",
    "List": "Listahan",
    "Map": "Mapa",
    "property": "property",
    "properties": "property",
    "Previous": "Nakaraan",
    "Next": "Susunod",
    "Featured": "Tampok",
    "Reduced": "Bumaba ang presyo",
    "Checked by SEA ESTATES": "Sinuri ng SEA ESTATES",
    "Checked listings only": "Sinuring listing lang",
    "beds": "kwarto",
    "baths": "banyo",
    "sqm": "sqm",
    "+ Compare": "+ Ikumpara",
    "← Back to properties": "← Bumalik sa mga property",
    "About this property": "Tungkol sa property",
    "Listed at": "Presyo",
    "♡ Save this property": "♡ I-save ang property",
    "Request more information": "Humingi ng dagdag na detalye",
    "Full name": "Buong pangalan",
    "Email": "Email",
    "Phone": "Telepono",
    "Message": "Mensahe",
    "Send inquiry": "Ipadala",
    "Chat with us": "Mag-chat sa amin",
    "Chat on Viber": "Mag-chat sa Viber",
    "Chat on Messenger": "Mag-chat sa Messenger",
    "Monthly payment": "Buwanang hulog",
    "Estimate your monthly payment": "Tantyahin ang buwanang hulog",
    "Lender": "Magpapautang",
    "Down payment": "Down payment",
    "Interest rate (% a year)": "Interes (% bawat taon)",
    "Years to pay": "Ilang taon babayaran",
    "Loan amount": "Halaga ng utang",
    "About per month": "Mga bawat buwan",
    "Monthly income usually needed": "Kailangang buwanang kita (karaniwan)",
    "Get pre-qualified": "Alamin kung ma-a-approve ka",
    "Pag-IBIG lends up to ₱6,000,000, so the rest is added to the down payment.": "Hanggang ₱6,000,000 lang ang pautang ng Pag-IBIG, kaya idinagdag ang sobra sa down payment.",
    "Example rates only. Each lender sets its own rate and approves the loan. Lenders usually allow about 35% of gross monthly income for the payment.": "Halimbawang interes lang ito. Ang bawat magpapautang ang nagtatakda ng interes at nag-a-approve ng loan. Karaniwang hanggang 35% ng buwanang kita ang pinapayagan para sa hulog.",
    "Video and tour": "Video at tour",
    "Watch the video": "Panoorin ang video",
    "Open the 360° tour": "Buksan ang 360° tour",
    "Price history": "Kasaysayan ng presyo",
    "Travel time": "Gaano kalayo",
    "Add a place": "Magdagdag ng lugar",
    "Find": "Hanapin",
    "e.g. your office, school or SM": "hal. opisina, paaralan o SM",
    "About, by car, from the straight-line distance. Traffic and the road you take can change it.": "Tantya lang, sakay ng kotse, mula sa tuwid na layo. Maaaring magbago dahil sa traffic at ruta.",
    "Save this search": "I-save ang paghahanap na ito",
    "Get an alert when a new property matches.": "Makatanggap ng abiso kapag may bagong property na tugma.",
    "We read this as": "Ang pagkaintindi namin",
    "Draw an area": "Gumuhit ng lugar",
    "Tap the map to mark the corners of the area, then press Done.": "I-tap ang mapa para markahan ang mga kanto ng lugar, saka pindutin ang Tapos.",
    "Done": "Tapos",
    "Clear area": "Alisin ang lugar",
    "Sign in to save": "Mag-sign in para i-save",
    "Batangas price trends": "Presyo ng property sa Batangas",
    "Español": "Español"
  };
  var LANG_KEY = "esrealty_sf_lang";
  var current = "en";
  try { if (root.localStorage && root.localStorage.getItem(LANG_KEY) === "fil") current = "fil"; } catch (e) { /* storage is optional */ }
  function lang() { return current; }
  function setLang(l) {
    current = l === "fil" ? "fil" : "en";
    try { root.localStorage && root.localStorage.setItem(LANG_KEY, current); } catch (e) {}
    try { if (root.document) root.document.documentElement.setAttribute("lang", current === "fil" ? "fil" : "en"); } catch (e) {}
    return current;
  }
  function t(text) {
    if (current !== "fil") return text;
    return Object.prototype.hasOwnProperty.call(FIL, text) ? FIL[text] : text;
  }

  var api = {
    LENDERS: LENDERS, INCOME_SHARE: INCOME_SHARE, monthlyPayment: monthlyPayment, payment: payment,
    viberLink: viberLink, messengerLink: messengerLink, phDigits: phDigits,
    TOWNS: TOWNS, parseQuery: parseQuery, looksLikeSentence: looksLikeSentence, amount: amount,
    PLACES: PLACES, distanceKm: distanceKm, travel: travel, minutesLabel: minutesLabel,
    trends: trends, titleTown: titleTown, inPolygon: inPolygon,
    FIL: FIL, t: t, lang: lang, setLang: setLang
  };
  root.ESREALTY_SF_EXTRAS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
