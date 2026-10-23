/* Agent websites: one drawing for an agent's public page.
 *
 * The public page (#/agents/<slug>, or /agents/<slug> through the site's Worker) and the live
 * preview in the back office's My website both call SEA_AGENT_PAGE.html() with the same data:
 * public_agent() for visitors, agent_site_open().preview for the editor. Only what the data
 * holds is drawn; an empty part is left out, never shown as a zero.
 *
 *   SEA_AGENT_PAGE.html(page, { preview })   the page as HTML
 *   SEA_AGENT_PAGE.bind(root, page, api)      filters, contact buttons, Save contact, the form
 *   SEA_AGENT_PAGE.TOWNS / NEEDS / LANGUAGES  the fixed lists the editor offers
 */
(function () {
  "use strict";

  // The Value Guide's towns (data/batangas-zonal.json); tests/agent_page_node.js keeps them equal.
  var TOWNS = [["agoncillo", "Agoncillo"], ["alitagtag", "Alitagtag"], ["balayan", "Balayan"], ["balete", "Balete"],
    ["batangas-city", "Batangas City"], ["bauan", "Bauan"], ["calaca", "Calaca"], ["calatagan", "Calatagan"],
    ["cuenca", "Cuenca"], ["ibaan", "Ibaan"], ["laurel", "Laurel"], ["lemery", "Lemery"], ["lian", "Lian"],
    ["lipa-city", "Lipa City"], ["lobo", "Lobo"], ["mabini", "Mabini"], ["malvar", "Malvar"],
    ["mataas-na-kahoy", "Mataas na Kahoy"], ["nasugbu", "Nasugbu"], ["padre-garcia", "Padre Garcia"],
    ["rosario", "Rosario"], ["san-jose", "San Jose"], ["san-juan", "San Juan"], ["san-luis", "San Luis"],
    ["san-nicolas", "San Nicolas"], ["san-pascual", "San Pascual"], ["sta-teresita", "Sta. Teresita"],
    ["sto-tomas-city", "Sto. Tomas City"], ["taal", "Taal"], ["talisay", "Talisay"], ["tanauan-city", "Tanauan City"],
    ["taysan", "Taysan"], ["tingloy", "Tingloy"], ["tuy", "Tuy"]];
  var NEEDS = [["buy", "Buying a home"], ["sell", "Selling property"], ["rent", "Renting"], ["lots", "Lots and farm land"],
    ["commercial", "Commercial property"], ["preselling", "Pre-selling projects"], ["overseas", "Buyers working abroad"]];
  var LANGUAGES = [["english", "English"], ["filipino", "Filipino"], ["cebuano", "Cebuano"], ["ilocano", "Ilocano"],
    ["chinese", "Chinese"], ["korean", "Korean"], ["japanese", "Japanese"]];
  // Each passes 4.5:1 with white text (buttons) and on white (links).
  var ACCENTS = { rust: ["#B4521F", "#97441A"], sea: ["#0E5F63", "#0A4A4D"], forest: ["#2F6B3A", "#24542D"], ink: ["#1C1917", "#000000"] };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function label(list, key) { for (var i = 0; i < list.length; i++) if (list[i][0] === key) return list[i][1]; return ""; }
  function labels(list, keys) { return (keys || []).map(function (k) { return label(list, k); }).filter(Boolean); }
  function joinWords(items) {
    if (items.length < 2) return items.join("");
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }
  function initials(name) {
    return String(name || "").split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase() || "SE";
  }
  function firstName(name) { return String(name || "").split(/\s+/)[0] || "the agent"; }
  // "2026-10-12" → "12 Oct 2026"; "2027-08-31" with month only → "Aug 2027".
  function day(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1] : ""; }
  function month(iso) { var m = /^(\d{4})-(\d{2})/.exec(iso || ""); return m ? MONTHS[Number(m[2]) - 1] + " " + m[1] : ""; }
  // "+639171234567" → "0917 123 4567"; other countries stay as +digits.
  function phoneText(p) {
    var m = /^\+63(9\d{2})(\d{3})(\d{4})$/.exec(p || "");
    return m ? "0" + m[1] + " " + m[2] + " " + m[3] : String(p || "");
  }
  function money(n) { return Number(n) > 0 ? "₱" + Number(n).toLocaleString("en-PH", { maximumFractionDigits: 0 }) : ""; }
  function priceText(l) {
    var rent = l.offer_type === "rent";
    var n = Number(rent ? l.rent : l.price) || Number(l.display_price) || 0;
    return n ? money(n) + (rent ? " a month" : "") : "Price on request";
  }
  function sizeText(l) {
    if (Number(l.lot_size_sqm) > 0) return Number(l.lot_size_sqm).toLocaleString("en-PH") + " sqm lot";
    if (Number(l.floor_area_sqm) > 0) return Number(l.floor_area_sqm).toLocaleString("en-PH") + " sqm floor area";
    return "";
  }
  function kinds(l) {
    var out = [l.offer_type === "rent" ? "rent" : "sale"];
    if (/lot|land|farm/i.test(l.property_type || "")) out.push("lot");
    if (/pre-?sell/i.test(l.property_type || "") || /pre-?sell/i.test(l.offer_type || "")) out.push("pre");
    return out;
  }
  function safeImage(url) { return /^https:\/\//.test(url || "") ? url : ""; }
  var TYPES = { "house-and-lot": "House and lot", condominium: "Condominium", "lot-only": "Lot", townhouse: "Townhouse", shophouse: "Shophouse",
    commercial: "Commercial property", industrial: "Industrial property", agricultural: "Farm lot", foreclosed: "Foreclosed property" };
  function typeText(t) { return TYPES[t] || (t ? String(t).replace(/-/g, " ").replace(/^./, function (c) { return c.toUpperCase(); }) : "Property"); }
  function plural(n, word) { return Number(n) + " " + word + (Number(n) === 1 ? "" : "s"); }

  var ICON = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    chat: '<path d="M4 5h16v11H8l-4 4z"/>',
    save: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/>'
  };
  function icon(name) {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + "</svg>";
  }

  function contactLinks(p, primary) {
    var c = p.contacts || {};
    var out = [];
    if (primary) out.push('<button type="button" class="ag-btn ag-btn-primary" data-ag-jump="ag-contact">Book a viewing</button>');
    if (c.viber) out.push('<a class="ag-btn" data-ag-tap="viber" href="viber://chat?number=' + encodeURIComponent(c.viber) + '">' + icon("chat") + "Viber</a>");
    if (c.whatsapp) out.push('<a class="ag-btn" data-ag-tap="whatsapp" href="https://wa.me/' + esc(String(c.whatsapp).replace(/\D/g, "")) + '" target="_blank" rel="noopener">' + icon("chat") + "WhatsApp</a>");
    if (c.messenger) out.push('<a class="ag-btn" data-ag-tap="messenger" href="https://m.me/' + esc(c.messenger) + '" target="_blank" rel="noopener">' + icon("chat") + "Messenger</a>");
    if (c.call) out.push('<a class="ag-btn" data-ag-tap="call" href="tel:' + esc(c.call) + '">' + icon("phone") + "Call " + esc(phoneText(c.call)) + "</a>");
    return out.join("");
  }

  function licenceCard(p) {
    var lic = p.licence;
    var photo = safeImage(p.photo);
    var head = lic
      ? '<div class="ag-card-strip">' + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON.check + "</svg>" +
        "<span>Licence checked by SEA ESTATES on " + esc(day(lic.checked_on)) + "</span></div>"
      : '<div class="ag-card-strip ag-card-strip-pending"><span>Licence check pending. Our office records it before the page goes live.</span></div>';
    var broker = p.role === "salesperson" && p.broker
      ? '<div class="ag-card-broker"><span>Supervising broker</span><b>' + esc(p.broker.name || "Not recorded yet") + (p.broker.licence_no ? ", licence no. " + esc(p.broker.licence_no) : "") + "</b></div>"
      : "";
    var verified = p.verified_on
      ? '<p class="ag-card-verified">' + icon("shield") + "<span>Verified on " + esc(day(p.verified_on)) + ": government ID seen and phone confirmed by our office.</span></p>"
      : "";
    return '<article class="ag-card" aria-label="Licence card">' + head + verified +
      '<div class="ag-card-body">' +
      (photo ? '<img class="ag-card-photo" src="' + esc(photo) + '" alt="Photo of ' + esc(p.name) + '" width="96" height="120" loading="lazy">'
             : '<div class="ag-card-photo ag-card-initials" aria-hidden="true">' + esc(initials(p.name)) + "</div>") +
      "<dl>" +
      '<div><dt>Name</dt><dd class="ag-card-name">' + esc(p.name) + "</dd></div>" +
      "<div><dt>Role</dt><dd>" + esc(p.role_label) + "</dd></div>" +
      (lic ? '<div class="ag-card-pair"><div><dt>Licence no.</dt><dd class="ag-num">' + esc(lic.no) + "</dd></div><div><dt>Valid until</dt><dd>" + esc(month(lic.valid_until)) + "</dd></div></div>" : "") +
      "</dl></div>" + broker +
      '<div class="ag-card-foot"><button type="button" class="ag-btn ag-btn-small" data-ag-save>' + icon("save") + "Save contact</button></div>" +
      "</article>";
  }

  function listingCard(l, preview) {
    var img = safeImage(l.image);
    var where = [l.barangay, l.city].filter(Boolean).join(", ");
    var size = sizeText(l);
    return '<article class="ag-listing" data-ag-kinds="' + esc(kinds(l).join(" ")) + '">' +
      '<div class="ag-listing-photo">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : "") +
      '<span class="ag-pill">' + (l.offer_type === "rent" ? "For rent" : "For sale") + "</span></div>" +
      '<div class="ag-listing-body"><div class="ag-price">' + esc(priceText(l)) + '</div>' +
      '<h3><a href="#/listing/' + encodeURIComponent(l.id) + '"' + (preview ? ' tabindex="-1"' : "") + ">" + esc(l.title || "Property") + "</a></h3>" +
      (where || size ? '<p class="ag-muted">' + esc([where, size].filter(Boolean).join(" · ")) + "</p>" : "") +
      '<button type="button" class="ag-btn ag-btn-primary ag-listing-ask" data-ag-ask="' + esc(l.id) + '" data-ag-ask-title="' + esc(l.title || "") + '">Ask about this</button>' +
      "</div></article>";
  }

  function listingsSection(p, preview) {
    var list = p.listings || [];
    if ((p.sections || []).indexOf("listings") < 0 || !list.length) return "";
    var present = {};
    list.forEach(function (l) { kinds(l).forEach(function (k) { present[k] = true; }); });
    var filters = [["all", "All"], ["sale", "For sale"], ["rent", "For rent"], ["lot", "Lots"], ["pre", "Pre-selling"]]
      .filter(function (f) { return f[0] === "all" || present[f[0]]; });
    return '<section class="ag-section" id="ag-listings" aria-labelledby="ag-listings-h">' +
      '<div class="ag-section-head"><div><h2 id="ag-listings-h">My listings</h2>' +
      (Number(p.listing_count) > list.length ? '<p class="ag-muted">Showing ' + list.length + " of " + Number(p.listing_count) + ".</p>" : "") + "</div>" +
      (filters.length > 2 ? '<div class="ag-filters" role="group" aria-label="Filter listings">' + filters.map(function (f, i) {
        return '<button type="button" class="ag-filter" data-ag-filter="' + f[0] + '" aria-pressed="' + (i === 0 ? "true" : "false") + '">' + f[1] + "</button>";
      }).join("") + "</div>" : "") + "</div>" +
      '<div class="ag-listing-grid">' + list.map(function (l) { return listingCard(l, preview); }).join("") + "</div>" +
      '<p class="ag-muted" data-ag-none hidden>No listings of this kind right now.</p></section>';
  }

  // Phase 2: sellers start the Value Guide from here, and the request goes to this agent.
  function sellSection(p, preview) {
    var needs = p.needs || [];
    if (needs.length && needs.indexOf("sell") < 0) return "";
    var first = firstName(p.name);
    return '<section class="ag-section ag-sell" aria-labelledby="ag-sell-h"><div class="ag-sell-box"><div>' +
      '<h2 id="ag-sell-h">Thinking of selling?</h2><p>Get a starting price from the Value Guide, and ' + esc(first) + " will follow up.</p></div>" +
      '<a class="ag-btn ag-btn-light" data-ag-sell href="#/home?section=estimator&amp;agent=' + encodeURIComponent(p.slug || "") + '"' + (preview ? ' tabindex="-1"' : "") + ">Start the Value Guide with " + esc(first) + "</a></div></section>";
  }

  // "recorded since Mar 2025", or "in the last 3 years" once there are 36 months of records.
  function recordSpan(rec) { return rec.window === "3y" ? "in the last 3 years" : "recorded since " + month(rec.since); }

  // Phase 3: counts from SEA ESTATES' closed deals, by side; rows only where the client agreed.
  function recordSection(p) {
    var rec = p.record || {};
    if (!(Number(rec.deals) > 0)) return "";
    var first = firstName(p.name);
    var sides = [];
    if (Number(rec.buyer) > 0) sides.push("<div><b>" + Number(rec.buyer) + "</b><span>as buyer\u2019s agent</span></div>");
    if (Number(rec.seller) > 0) sides.push("<div><b>" + Number(rec.seller) + "</b><span>as seller\u2019s agent</span></div>");
    if (Number(rec.rentals) > 0) sides.push("<div><b>" + Number(rec.rentals) + "</b><span>rental" + (Number(rec.rentals) === 1 ? "" : "s") + "</span></div>");
    var rows = rec.rows || [];
    var sideText = { buyer: "Buyer", seller: "Seller", both: "Buyer and seller", rental: "Rental" };
    var table = rows.length ? '<div class="ag-table-wrap" role="region" aria-labelledby="ag-record-cap" tabindex="0"><table class="ag-table"><caption id="ag-record-cap">Deals shown with the client\u2019s agreement</caption>' +
      '<thead><tr><th scope="col">Closed</th><th scope="col">Property</th><th scope="col">Town</th><th scope="col">' + esc(first) + " acted for the</th><th scope=\"col\">Price</th></tr></thead><tbody>" +
      rows.map(function (r) {
        var size = Number(r.lot_sqm) > 0 ? ", " + Number(r.lot_sqm).toLocaleString("en-PH") + " sqm" : (Number(r.floor_sqm) > 0 ? ", " + Number(r.floor_sqm).toLocaleString("en-PH") + " sqm floor area" : "");
        return "<tr><td>" + esc(month(r.month)) + "</td><td>" + esc(typeText(r.type) + size) + "</td><td>" + esc(r.town || "") + "</td><td>" + esc(sideText[r.side] || "") + "</td><td>" +
          (Number(r.price) > 0 ? '<span class="ag-num">' + esc(money(r.price)) + "</span>" : '<span class="ag-muted">Not shown</span>') + "</td></tr>";
      }).join("") + "</tbody></table></div>" : "";
    return '<section class="ag-section ag-record" id="ag-record" aria-labelledby="ag-record-h"><div class="ag-record-text">' +
      '<h2 id="ag-record-h">Track record</h2><p>' + plural(rec.deals, "deal") + " closed through SEA ESTATES " + (rec.window === "3y" ? "in the last 3 years" : "since " + esc(month(rec.since))) + ", counted from our deal records.</p>" +
      (sides.length ? '<div class="ag-stats ag-record-sides">' + sides.join("") + "</div>" : "") + "</div>" +
      '<div class="ag-record-rows">' + table + '<p class="ag-muted">' + (rows.length ? "Other deals are counted but not listed." : "Deals are listed only when the client agrees, so these are counted but not listed.") + "</p></div></section>";
  }

  // Phase 3: approved reviews from clients with a closed deal. No stars.
  function reviewsSection(p) {
    var list = p.reviews || [];
    if (!list.length) return "";
    var first = firstName(p.name);
    function caption(r) { return "<b>" + esc(r.label || "Client") + "</b>" + [r.town, month(r.month)].filter(Boolean).map(function (x) { return ", " + esc(x); }).join("") + ". Linked to a closed deal."; }
    function reply(r) { return r.reply ? '<p class="ag-reply"><b>' + esc(first) + " replied:</b> " + esc(r.reply) + "</p>" : ""; }
    var lead = list[0];
    return '<section class="ag-section ag-reviews" id="ag-reviews" aria-labelledby="ag-reviews-h">' +
      '<div class="ag-reviews-head"><h2 id="ag-reviews-h">What clients say</h2><p class="ag-muted">' + plural(list.length, "review") + ", each from a client with a closed deal.</p></div>" +
      '<figure class="ag-review-lead"><blockquote>\u201c' + esc(lead.body) + '\u201d</blockquote><figcaption>' + caption(lead) + "</figcaption>" + reply(lead) + "</figure>" +
      '<div class="ag-review-list">' +
      list.slice(1).map(function (r) { return '<figure class="ag-review"><blockquote>\u201c' + esc(r.body) + "\u201d</blockquote><figcaption>" + caption(r) + "</figcaption>" + reply(r) + "</figure>"; }).join("") +
      '<p class="ag-muted">Reviews come only from clients with a closed deal, through a link from our office. Agents can reply once but cannot remove them.</p></div></section>';
  }

  function aboutSection(p) {
    var towns = labels(TOWNS, p.towns), needs = labels(NEEDS, p.needs), langs = labels(LANGUAGES, p.languages);
    var bio = String(p.bio || "").trim();
    if ((p.sections || []).indexOf("about") < 0 || (!bio && !towns.length && !needs.length)) return "";
    var facts = [["Towns I cover", towns.join(", ")], ["What I help with", needs.join(", ")], ["Languages", langs.join(", ")]]
      .filter(function (f) { return f[1]; });
    return '<section class="ag-section ag-about" aria-labelledby="ag-about-h"><div class="ag-about-text"><h2 id="ag-about-h">About me</h2>' +
      (bio ? bio.split(/\n{2,}/).map(function (para) { return "<p" + (p.bio_lang === "fil" ? ' lang="fil"' : "") + ">" + esc(para).replace(/\n/g, "<br>") + "</p>"; }).join("") : "") +
      "</div>" + (facts.length ? '<dl class="ag-facts">' + facts.map(function (f) { return "<div><dt>" + f[0] + "</dt><dd>" + esc(f[1]) + "</dd></div>"; }).join("") + "</dl>" : "") +
      "</section>";
  }

  function contactSection(p, preview) {
    var first = firstName(p.name);
    var c = p.contacts || {};
    var numbers = [];
    if (c.call) numbers.push(["Mobile", phoneText(c.call)]);
    if (c.viber && c.viber !== c.call) numbers.push(["Viber", phoneText(c.viber)]);
    else if (c.viber) numbers[0][0] = "Mobile and Viber";
    if (c.whatsapp && c.whatsapp !== c.call && c.whatsapp !== c.viber) numbers.push(["WhatsApp", phoneText(c.whatsapp)]);
    return '<section class="ag-section ag-contact" id="ag-contact" aria-labelledby="ag-contact-h">' +
      '<div class="ag-contact-intro"><h2 id="ag-contact-h">Book a viewing or ask a question</h2>' +
      "<p>Send a message and " + esc(first) + " will reply by Viber, text or a call." +
      ((p.sections || []).indexOf("video") >= 0 ? " Abroad? Ask for a video viewing in your time zone." : "") + "</p>" +
      (numbers.length ? '<dl class="ag-numbers">' + numbers.map(function (n) { return "<div><dt>" + esc(n[0]) + '</dt><dd class="ag-num">' + esc(n[1]) + "</dd></div>"; }).join("") + "</dl>" : "") +
      "</div>" +
      '<form class="ag-form" data-ag-form novalidate' + (preview ? ' aria-label="Preview of the contact form"' : "") + ">" +
      '<label class="ag-field"><span>Your name</span><input class="ag-input" name="full_name" autocomplete="name" maxlength="160" required></label>' +
      '<div class="ag-field"><label for="ag-phone">Mobile number</label><input class="ag-input" id="ag-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="50" required aria-describedby="ag-phone-hint"><span class="ag-hint" id="ag-phone-hint">For example 0917 123 4567 or +63 917 123 4567</span></div>' +
      '<label class="ag-field"><span>I want to</span><select class="ag-input" name="want"><option value="viewing">Book a viewing</option><option value="call">Get a call back</option><option value="question">Ask a question</option></select></label>' +
      '<label class="ag-field"><span>Email (optional)</span><input class="ag-input" name="email" type="email" autocomplete="email" maxlength="254"></label>' +
      '<label class="ag-field ag-wide"><span>Message</span><textarea class="ag-input" name="message" rows="3" maxlength="2000" placeholder="Which property, your budget and the best time to call"></textarea></label>' +
      '<input type="hidden" name="listing_id" value="">' +
      // Hidden from people; a bot that fills it is ignored by the server.
      '<div class="ag-trap" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<label class="ag-consent ag-wide"><input type="checkbox" name="consent"><span>I agree that ' + esc(p.name) + ' and SEA ESTATES may use my details to answer this request, as the <a href="#/privacy">privacy notice</a> explains.</span></label>' +
      '<button type="submit" class="ag-btn ag-btn-primary ag-wide ag-send">Send to ' + esc(first) + "</button>" +
      '<p class="ag-status ag-wide" role="status" aria-live="polite"></p>' +
      "</form></section>";
  }

  function footerLine(p) {
    var lic = p.licence;
    var parts = [esc(p.name) + (lic ? ", licence no. " + esc(lic.no) + ", valid until " + esc(month(lic.valid_until)) : "")];
    if (p.role === "salesperson" && p.broker && p.broker.name) parts.push("supervised by " + esc(p.broker.name) + (p.broker.licence_no ? ", licence no. " + esc(p.broker.licence_no) : ""));
    return '<footer class="ag-footer"><p>' + parts.join(", ") + ". Pre-selling listings show their DHSUD licence to sell.</p>" +
      '<p class="ag-warn">SEA ESTATES never asks you to pay into a personal account. <a href="#/agents?check=1">Check an agent\u2019s licence</a></p>' +
      '<p class="ag-footer-links"><a href="#/privacy">Privacy notice</a><a href="#/home">SEA ESTATES</a><a href="#/search">All properties</a></p></footer>';
  }

  function html(p, opts) {
    opts = opts || {};
    if (!p) return "";
    var accent = ACCENTS[p.accent] || ACCENTS.rust;
    var towns = labels(TOWNS, p.towns);
    var langs = labels(LANGUAGES, p.languages);
    var chips = [];
    if (p.licence) chips.push('<span class="ag-chip ag-chip-trust">' + icon("check") + "Licence checked " + esc(day(p.licence.checked_on)) + "</span>");
    // Phase 3: only while the office's ID and phone checks are on record and the licence holds.
    if (p.verified_on) chips.push('<span class="ag-chip ag-chip-verified">' + icon("shield") + "Verified " + esc(day(p.verified_on)) + "</span>");
    if (langs.length) chips.push('<span class="ag-chip">Speaks ' + esc(joinWords(langs)) + "</span>");
    if ((p.sections || []).indexOf("video") >= 0) chips.push('<span class="ag-chip">Video viewings for buyers abroad</span>');
    var stats = [];
    if (Number(p.listing_count) > 0) stats.push('<div><b>' + Number(p.listing_count) + "</b><span>active listing" + (Number(p.listing_count) === 1 ? "" : "s") + "</span></div>");
    var rec = p.record || {};
    if (Number(rec.deals) > 0) stats.push("<div><b>" + Number(rec.deals) + "</b><span>deal" + (Number(rec.deals) === 1 ? "" : "s") + " " + esc(recordSpan(rec)) + "</span></div>");
    if ((p.reviews || []).length) stats.push("<div><b>" + p.reviews.length + "</b><span>client review" + (p.reviews.length === 1 ? "" : "s") + "</span></div>");
    if (p.reply) stats.push('<div class="ag-stat-words"><b>Replies ' + esc(p.reply) + "</b><span>typical first reply, last 90 days</span></div>");
    var c = p.contacts || {};
    var bar = [];
    if (c.call) bar.push('<a class="ag-btn" data-ag-tap="call" href="tel:' + esc(c.call) + '">Call</a>');
    if (c.viber) bar.push('<a class="ag-btn" data-ag-tap="viber" href="viber://chat?number=' + encodeURIComponent(c.viber) + '">Viber</a>');
    bar.push('<button type="button" class="ag-btn ag-btn-primary" data-ag-jump="ag-contact">Book a viewing</button>');
    return '<div class="sf-site ag" style="--ag-accent:' + accent[0] + ";--ag-accent-hover:" + accent[1] + '">' +
      '<header class="ag-head"><div class="ag-head-in"><div class="ag-brand"><span class="ag-mark" aria-hidden="true">' + esc(initials(p.name)) + "</span>" +
      "<span><b>" + esc(p.name) + '</b><a href="#/home">with SEA ESTATES</a></span></div>' +
      '<button type="button" class="ag-btn ag-btn-primary ag-head-cta" data-ag-jump="ag-contact">Book a viewing</button></div></header>' +
      '<main id="ag-main"><section class="ag-hero"><div class="ag-hero-in"><div class="ag-hero-text">' +
      '<p class="ag-role">' + esc(p.role_label) + (towns.length ? " in " + esc(joinWords(towns.slice(0, 2))) + ", Batangas" : "") + "</p>" +
      "<h1>" + esc(p.name) + "</h1>" +
      (p.pitch ? '<p class="ag-pitch">' + esc(p.pitch) + "</p>" : "") +
      (chips.length ? '<div class="ag-chips">' + chips.join("") + "</div>" : "") +
      '<div class="ag-actions">' + contactLinks(p, true) + "</div>" +
      (stats.length ? '<div class="ag-stats">' + stats.join("") + "</div>" : "") +
      '</div><div class="ag-hero-card">' + licenceCard(p) + "</div></div></section>" +
      listingsSection(p, opts.preview) + sellSection(p, opts.preview) + recordSection(p) + reviewsSection(p) +
      aboutSection(p) + contactSection(p, opts.preview) + "</main>" +
      footerLine(p) +
      '<div class="ag-phonebar">' + bar.join("") + "</div></div>";
  }

  function vcard(p) {
    var c = p.contacts || {};
    var lines = ["BEGIN:VCARD", "VERSION:3.0", "FN:" + p.name, "ORG:SEA ESTATES", "TITLE:" + p.role_label];
    if (c.call) lines.push("TEL;TYPE=CELL:" + c.call);
    if (c.viber && c.viber !== c.call) lines.push("TEL;TYPE=CELL:" + c.viber);
    if (p.slug) lines.push("URL:" + pageUrl(p.slug));
    lines.push("END:VCARD");
    return lines.join("\r\n");
  }

  /* An agent page's shareable address. Until the site's Worker is live (pull request #32), only
   * the #/ form opens the page; the Worker turns PATH_LINKS on so links read /agents/<slug>. */
  var PATH_LINKS = false;
  function pageUrl(slug) {
    var base = location.origin + location.pathname.replace(/[^/]*$/, "");
    return base + (PATH_LINKS ? "agents/" : "#/agents/") + encodeURIComponent(slug || "");
  }

  function key() {
    try { return crypto.randomUUID(); } catch (e) { return "k-" + Date.now() + "-" + Math.random().toString(36).slice(2); }
  }

  // Behaviour for a drawn page. api: { tap(slug, kind), inquire(slug, body, key) }; none in the preview.
  function bind(root, p, api) {
    if (!root || !p) return;
    var preview = !api;
    root.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-ag-jump],[data-ag-filter],[data-ag-ask],[data-ag-save],[data-ag-tap],[data-ag-sell]") : null;
      if (!t || !root.contains(t)) return;
      if (t.hasAttribute("data-ag-sell")) {
        if (preview) { e.preventDefault(); return; }
        // The Value Guide names the agent while the visitor stays in it (storefront reads this).
        try { sessionStorage.setItem("esrealty_vg_agent_v1", JSON.stringify({ slug: p.slug, name: p.name })); } catch (err) {}
        return;
      }
      if (t.hasAttribute("data-ag-jump")) {
        var spot = root.querySelector("#" + t.getAttribute("data-ag-jump"));
        if (spot) { spot.scrollIntoView({ behavior: "smooth", block: "start" }); var f = spot.querySelector("input[name=full_name]"); if (f && !preview) f.focus({ preventScroll: true }); }
      } else if (t.hasAttribute("data-ag-filter")) {
        var pick = t.getAttribute("data-ag-filter"), shown = 0;
        Array.prototype.forEach.call(root.querySelectorAll("[data-ag-filter]"), function (b) { b.setAttribute("aria-pressed", b === t ? "true" : "false"); });
        Array.prototype.forEach.call(root.querySelectorAll(".ag-listing"), function (card) {
          var on = pick === "all" || card.getAttribute("data-ag-kinds").split(" ").indexOf(pick) >= 0;
          card.hidden = !on; if (on) shown++;
        });
        var none = root.querySelector("[data-ag-none]"); if (none) none.hidden = shown > 0;
      } else if (t.hasAttribute("data-ag-ask")) {
        var form = root.querySelector("[data-ag-form]");
        if (form) {
          form.listing_id.value = t.getAttribute("data-ag-ask");
          if (!form.message.value) form.message.value = "I'm interested in " + t.getAttribute("data-ag-ask-title") + ". ";
          form.scrollIntoView({ behavior: "smooth", block: "start" });
          if (!preview) form.full_name.focus({ preventScroll: true });
        }
      } else if (t.hasAttribute("data-ag-save")) {
        if (preview) return;
        var blob = new Blob([vcard(p)], { type: "text/vcard" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = (p.slug || "agent") + ".vcf";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        if (api && p.slug) api.tap(p.slug, "save").catch(function () {});
      } else if (t.hasAttribute("data-ag-tap")) {
        if (preview) { e.preventDefault(); return; }
        if (api && p.slug) api.tap(p.slug, t.getAttribute("data-ag-tap")).catch(function () {});
      }
    });

    var form = root.querySelector("[data-ag-form]");
    if (!form) return;
    var sendKey = key();
    function fieldError(input, msg) {
      var box = input.closest(".ag-field") || input.closest(".ag-consent");
      var old = box.querySelector(".ag-error"); if (old) old.remove();
      input.removeAttribute("aria-invalid");
      if (!msg) return;
      input.setAttribute("aria-invalid", "true");
      var id = "ag-err-" + input.name;
      box.insertAdjacentHTML("beforeend", '<span class="ag-error" id="' + id + '">' + esc(msg) + "</span>");
      var described = (input.getAttribute("aria-describedby") || "").split(" ").filter(function (x) { return x && x.indexOf("ag-err-") !== 0; });
      described.push(id); input.setAttribute("aria-describedby", described.join(" "));
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var status = form.querySelector(".ag-status");
      if (preview) { status.textContent = "This is a preview. Messages are sent from your published page."; return; }
      var name = form.full_name.value.trim(), phone = form.phone.value.trim(), email = form.email.value.trim();
      var errors = 0;
      fieldError(form.full_name, name ? "" : "Enter your name."); if (!name) errors++;
      var digits = phone.replace(/\D/g, "");
      var phoneBad = digits.length < 7 || /^(\d)\1+$/.test(digits);
      fieldError(form.phone, phoneBad ? "Enter a mobile number like 0917 123 4567 or +63 917 123 4567." : ""); if (phoneBad) errors++;
      var mailBad = email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
      fieldError(form.email, mailBad ? "Enter an email like name@example.com, or leave it empty." : ""); if (mailBad) errors++;
      fieldError(form.consent, form.consent.checked ? "" : "Tick the box so we may answer your request."); if (!form.consent.checked) errors++;
      if (errors) { status.textContent = errors === 1 ? "Check the highlighted field." : "Check the " + errors + " highlighted fields."; (form.querySelector("[aria-invalid=true]") || form).focus(); return; }
      var button = form.querySelector(".ag-send");
      var label = button.textContent;
      button.disabled = true; button.textContent = "Sending…"; status.textContent = "";
      api.inquire(p.slug, {
        full_name: name, phone: phone, email: email, want: form.want.value, message: form.message.value.trim(),
        listing_id: form.listing_id.value, website: form.website.value, consent: true,
        section: form.listing_id.value ? "listing" : "contact"
      }, sendKey).then(function () {
        form.outerHTML = '<div class="ag-sent" role="status" tabindex="-1"><h3>Sent to ' + esc(firstName(p.name)) + "</h3><p>" +
          esc(firstName(p.name)) + " will reply by Viber, text or a call" + (p.reply && !/more than a day/.test(p.reply) ? ", usually " + esc(p.reply) : "") + ".</p></div>";
        var sent = root.querySelector(".ag-sent"); if (sent) sent.focus();
      }).catch(function (err) {
        button.disabled = false; button.textContent = label;
        status.textContent = (err && err.status === 429)
          ? "Too many messages from this connection. Please try again in an hour, or use the buttons above."
          : (err && err.status === 400 && err.message ? err.message.charAt(0).toUpperCase() + err.message.slice(1) + "." : "Could not send. Check your connection and tap Send again; your message will not be sent twice.");
      });
    });
  }

  window.SEA_AGENT_PAGE = { html: html, bind: bind, TOWNS: TOWNS, NEEDS: NEEDS, LANGUAGES: LANGUAGES, ACCENTS: ACCENTS, phoneText: phoneText,
    labels: labels, day: day, month: month, initials: initials, firstName: firstName, icon: icon, joinWords: joinWords, pageUrl: pageUrl };
})();
