(function () {
  "use strict";

  var API = window.ESREALTY_LISTINGS_API;
  var host = null;
  var openAuth = function () {};
  var active = false;
  var requestId = 0;
  var cacheKey = "";
  var viewState = { loading: false, error: "", result: null, mode: "grid" };
  var compareIds = [], compareRecords = Object.create(null), compareErrors = Object.create(null);
  var compareReturn = "#/search", compareMessage = "", compareFocused = false;
  try {
    var restored = JSON.parse(sessionStorage.getItem("esrealty_compare_v1") || "[]");
    if (Array.isArray(restored)) compareIds = restored.filter(function (id, i) { return typeof id === "string" && /^[\w-]{1,100}$/.test(id) && restored.indexOf(id) === i; }).slice(0, 2);
  } catch (e) { /* Storage is optional; comparison still works in memory. */ }
  try {
    var restoredReturn = sessionStorage.getItem("esrealty_compare_return_v1");
    if (restoredReturn && restoredReturn.length <= 4096 && /^#\/search(?:\?|$)/.test(restoredReturn)) compareReturn = restoredReturn;
  } catch (e) { /* Return to the unfiltered search when storage is unavailable. */ }
  /* Service-neutral on purpose. These used to be shophouse-branded
   * ("TALK TO A SHOPHOUSE SPECIALIST" / "Ready to put the ground floor to
   * work?" / "a shophouse specialist"), and because siteSettings() fails CORS the
   * defaults are what actually renders - so the closed shophouse campaign was
   * still the homepage's call to action. The shophouse and Project B.T pages are
   * parked and must not leak their copy into the live site. */
  var siteContact = { eyebrow: "PROPERTY GUIDANCE", title: "What are you planning next?", description: "Tell us whether you are buying, selling, renting, or reviewing a property. Share the location and your questions so we can help with the next step.", phone: "0905 307 9119", email: "seaestate@gmail.com", address: "", hours: "", contactLoaded: false };

  /* Shared implementation from js/util.js, with a byte-identical local
   * fallback so this module can be require()d directly by the Node tests. */
  var esc = (typeof window !== "undefined" && window.ESREALTY_UTIL && window.ESREALTY_UTIL.esc)
    ? window.ESREALTY_UTIL.esc
    : function (value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
        });
      };

  // Small copies of listing photos for cards (js/util.js); the detail page keeps the full photo.
  var thumbAttrs = (typeof window !== "undefined" && window.ESREALTY_UTIL && window.ESREALTY_UTIL.thumbAttrs)
    ? window.ESREALTY_UTIL.thumbAttrs
    : function (url) { return 'src="' + esc(url) + '"'; };

  function safeImage(value) {
    try {
      var url = new URL(String(value || ""));
      return url.protocol === "https:" ? url.href : "";
    } catch (e) { return ""; }
  }

  function money(value, suffix) {
    var amount = Number(value || 0);
    return "₱" + new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(amount) + (suffix || "");
  }

  function route() {
    var raw = location.hash.replace(/^#\/?/, "");
    var split = raw.split("?");
    var path = split[0] || "home";
    return { path: path, params: new URLSearchParams(split.slice(1).join("?")) };
  }

  /* A new page starts at the top. Without this, choosing a service from the
   * menu while scrolled to the bottom of the home page opened that page at its
   * bottom too. Links that aim at a spot (?section=..., ?go=form) and in-page
   * anchors (#sf-...) keep their own scrolling; search filter changes don't
   * count as a new page. */
  var lastPageKey = "";
  function pageKey(r) {
    if (r.path === "property-value") return r.path + "?" + (r.params.get("service") || "");
    return r.path;
  }
  function scrollTopOnNewPage() {
    if (!/^#\//.test(location.hash) && location.hash !== "") return;
    var r = route(), key = pageKey(r);
    var aimed = r.params.get("section") || r.params.get("go");
    if (key !== lastPageKey && !aimed) { try { window.scrollTo(0, 0); } catch (e) {} }
    lastPageKey = key;
  }

  function go(path) {
    location.hash = path.charAt(0) === "/" ? "#" + path : "#/" + path;
  }

  /* ------------------------------------------------------------------
   * Navigation model - single source of truth.
   *
   * The desktop bar and the mobile panel used to be two hand-maintained
   * copies of the same five links. They drifted, and there was no way to add
   * a destination without editing both. Both surfaces are now generated from
   * these lists, so a new destination is one edit.
   *
   * Services route through the Get My Property Value page, which embeds the
   * actual value guide: the reader enters their details, sees the estimate,
   * and requests the service they came for on one page. Buying and Renting
   * keep their functional destinations (the listings search). Project B.T
   * resolves to its coming-soon page. Nothing here is a dead link, and the
   * homepage services section renders from this same array.
   * ------------------------------------------------------------------ */
  var NAV = [
    { href: "#/home", label: "Home" },
    /* No hard-coded ?state=Batangas here. That link pointed the primary nav at a
     * query that excluded every live listing, so "Properties" always rendered
     * "No properties found". The state filter is still available in the form and
     * as a removable chip; it just must not be applied silently. */
    { href: "#/search", label: "Properties" },
    /* The calculator itself (scrolls to it on Home). The contact page it used to
       open is "Talk to our team", reached from Services. */
    { href: "#/home", label: "Free Value Guide", cta: true, est: true }
  ];

  var SERVICES = [
    { href: "#/search", label: "Buying a property", note: "Find listings, arrange viewings and review offers." },
    { href: "#/property-value?service=sell", label: "Selling a property", note: "Review your value guide and discuss a sale." },
    { href: "#/search?offer_type=rent", label: "Renting / leasing", note: "Tenant matching and lease support." },
    { href: "#/property-value?service=pre-selling", label: "Pre-selling & developer projects", note: "Prepare, price and launch with confidence." },
    { href: "#/property-value?service=appraisal", label: "Property appraisal & valuation", note: "A guided estimate first, then a professional valuation." },
    { href: "#/property-value?service=broker", label: "Talk to a licensed broker", note: "Discuss selling, buying or marketing with a licensed broker." },
    { href: "#/property-value?service=manage", label: "Property management", note: "Support with rent, tenants and property upkeep." },
    { href: "#/property-value?service=title", label: "Title & documentation", note: "Coordinate title checks and document processing." },
    { href: "#/property-value?service=finance", label: "Financing / Pag-IBIG & bank", note: "Explore bank and developer financing options." }
  ];

  /* Home redesign glyphs: one stroke icon per service card and per
     guide-summary card, same 24px grid and 1.7 stroke as the FAQ icons.
     Decorative only - every card still carries its title and note as text. */
  var SERVICE_ICONS = [
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-3.8-3.8"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.6 3.5H20v7.4l-9.1 9.1a1.8 1.8 0 0 1-2.5 0L3.5 15a1.8 1.8 0 0 1 0-2.5z"/><circle cx="16.4" cy="7.6" r="1.5"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="3.5"/><path d="M10 13 20.5 2.5M14.4 9.1l2.7 2.7M17 6.5l2.7 2.7"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h6"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17l5-5 3.5 3.5L20 8"/><path d="M15.5 8H20v4.5"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="8.5" r="3.5"/><path d="M4 20c.8-3.4 3.1-5 6-5s5.2 1.6 6 5"/><path d="M15.5 6.5l1.8 1.8 3.2-3.3"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="M9 12.5l2 2 4-4"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5V8h4"/><path d="M9 12h6M9 15.5h6"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 9.5 12 4l8.5 5.5"/><path d="M5 10v8M9.7 10v8M14.3 10v8M19 10v8"/><path d="M3.5 20.5h17"/></svg>'
  ];
  var GSUM_ICONS = [
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.4-6.5-10.2A6.5 6.5 0 0 1 12 4a6.5 6.5 0 0 1 6.5 6.8C18.5 15.6 12 21 12 21z"/><circle cx="12" cy="10.6" r="2.4"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 12.5h4l2.5-6 4 11 2.5-5h4"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>'
  ];

  /* Shophouse and Project B.T are temporarily closed and are presented as one
   * "Project B.T" destination. Both entries resolve to the coming-soon page so
   * no project detail is exposed. */
  var PROJECT_BT = [
    { href: "#/project-bt", label: "Project B.T" },
    { href: "#/project-bt", label: "Shophouses" }
  ];

  function navLink(item) {
    return '<a href="' + esc(item.href) + '"' + (item.cta ? ' class="sf-nav-cta"' : "") + (item.est ? ' data-est-services' : "") + '>' + esc(item.label) + '</a>';
  }

  function navChevron() {
    return '<svg class="sf-chev" width="10" height="7" viewBox="0 0 10 7" aria-hidden="true" focusable="false"><path d="M1 1.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* The services overview page (services-3d.html): the first row of the Services menu
   * and the link under the homepage services cards. Kept out of SERVICES so the nine
   * service rows, cards and explorer pieces still line up one to one. */
  var SERVICES_TOUR = { href: "services-3d.html", label: "All nine services", note: "See every service and what happens next." };
  function tourLink(cls) {
    return '<a class="' + cls + ' sf-drop-all" href="' + esc(SERVICES_TOUR.href) + '"><span>' + esc(SERVICES_TOUR.label) +
      (cls === "sf-drop-cta" ? '<small>' + esc(SERVICES_TOUR.note) + '</small>' : '') + '</span></a>';
  }

  function dropDown(label, items, extraClass, first) {
    return '<details class="sf-drop ' + (extraClass || "") + '" data-sf-drop><summary class="sf-drop-summary">' +
      esc(label) + navChevron() + '</summary><div class="sf-drop-panel">' + (first || "") +
      items.map(function (item) {
        return '<a href="' + esc(item.href) + '"' + (item.cta ? ' class="sf-drop-cta"' : "") + '><span>' + esc(item.label) +
          (item.note ? '<small>' + esc(item.note) + '</small>' : '') + '</span></a>';
      }).join("") + '</div></details>';
  }

  /* Mobile menu groups are accordions, not flat lists.
   *
   * A flat list put 12 rows on screen with no hierarchy, and the auth buttons at
   * the bottom were unreachable on a 667px-tall phone. <details> is the same
   * primitive the desktop dropdowns already use, so the existing
   * closeDrops / outside-click / Escape handlers apply unchanged and the two
   * surfaces cannot drift apart.
   *
   * Uses .sf-menu-acc-* rather than .sf-drop-* so the desktop panel's absolute
   * positioning does not leak in. */
  function menuGroup(title, items, first) {
    return '<details class="sf-menu-acc" data-sf-drop>' +
      '<summary class="sf-menu-acc-sum">' + esc(title) + navChevron() + '</summary>' +
      '<div class="sf-menu-acc-body">' + (first || "") + items.map(navLink).join("") + '</div>' +
      '</details>';
  }

  function header() {
    return '<header class="sf-header"><a class="sf-brand" href="#/home" aria-label="SEA ESTATES home">' +
      '<span class="sf-brand-mark">S.E</span><span><b>SEA ESTATES</b><small>Property &amp; local guidance.</small></span></a>' +
      '<nav class="sf-nav" aria-label="Primary">' + NAV.map(navLink).join("") +
      dropDown("Services", SERVICES, "", tourLink("sf-drop-cta")) + dropDown("Project B.T", PROJECT_BT) + '</nav>' +
      /* No public Sign in / Create account: visitors need no account. Agents sign
         in from the footer. */
      '<div class="sf-header-actions">' +
      '<button class="sf-menu-btn" data-sf-menu aria-label="Open menu" aria-expanded="false"><span></span><span></span><span></span></button></div>' +
      '<div class="sf-menu" data-sf-menu-panel>' + NAV.map(navLink).join("") +
      menuGroup("Services", SERVICES, tourLink("sf-nav-cta")) + menuGroup("Project B.T", PROJECT_BT) + '</div></header>';
  }

  function footer() {
    return '<footer class="sf-footer"><div class="sf-brand"><span class="sf-brand-mark">S.E</span><span><b>SEA ESTATES</b><small>Property &amp; local guidance.</small></span></div>' +
      '<p>Browse properties, review a value guide, and plan your next step. <span class="sf-copyright">&copy; SEA ESTATES ' + new Date().getFullYear() + '</span><br><small>Serving Batangas province · Independent of the BIR · BIR values are tax references.</small></p>' +
      '<div>' + (siteContact.phone ? '<a href="tel:' + encodeURIComponent(telHref(siteContact.phone)) + '">' + esc(siteContact.phone) + '</a>' : '') +
      (siteContact.email ? '<a href="mailto:' + encodeURIComponent(siteContact.email) + '">' + esc(siteContact.email) + '</a>' : '') +
      '<a href="#/search">Browse properties</a><a href="#/privacy">Privacy notice</a><button data-sf-auth="signin">Agent sign in</button></div></footer>';
  }

  function shell(content) {
    return '<div class="sf-site">' + header() + '<main class="sf-main">' + content + '</main>' + footer() + '</div>';
  }

  function privacyPage() {
    return shell('<section class="sf-section sf-privacy-page"><div class="sf-section-head"><div><p class="sf-eyebrow">YOUR INFORMATION</p><h1>Privacy notice</h1></div><p>How SEA ESTATES handles information submitted through this website.</p></div>' +
      '<div class="sf-privacy-content">' +
      '<p><b>Who is responsible?</b> SEA ESTATES operates this website and handles the inquiries submitted through it. For a privacy-related request, <a href="#/property-value?go=form">contact our team</a> and write “Privacy request” in your message.</p>' +
      '<h2>Information used by the property guide</h2><p>The guide uses property details you enter, such as municipality, barangay, street, BIR classification, lot area, property type, and optional house, ownership, and selling details. The estimate is calculated in your browser. To look for available listing context, the selected municipality and property type may be queried through the Vercel-hosted market-search service; your name and contact details are not needed for that search.</p>' +
      '<h2>When you send an inquiry or request a report</h2><p>We receive the contact details and message you submit, together with the property details and estimate snapshot needed to respond. Requests are recorded in SEA ESTATES CRM and inquiry records hosted by Supabase. Where report delivery is configured, your report and email address are sent through Resend so the report can be delivered.</p>' +
      '<h2>How we use and share information</h2><p>We use submitted information to respond to your request, prepare or deliver a requested report, coordinate a property inquiry with the relevant broker or agent, maintain service records, and protect the service from abuse. Technical request information may also be processed to prevent abuse. We do not sell personal information; Supabase, Vercel, Resend, and any relevant listing agent may process information only to provide the requested service.</p>' +
      '<h2>Retention and your choices</h2><p>We keep inquiry and report records for as long as needed to respond, maintain business records, and meet applicable legal obligations. Under the Data Privacy Act, you may exercise applicable rights such as access, correction, objection, or deletion by contacting us through the form above. You may also raise a concern with the National Privacy Commission. Some records may need to be retained where the law requires it.</p>' +
      '<h2>Security and updates</h2><p>We use access controls and reasonable safeguards for the systems that receive inquiry information. This notice may be updated as the website or its service providers change; the date below identifies the latest revision.</p>' +
      '<p class="sf-privacy-updated">Last updated: 1 October 2026</p></div></section>');
  }

  /* ------------------------------------------------------------------
   * Project B.T - coming soon.
   *
   * Shophouse and Project B.T are temporarily closed, so this page exposes no
   * project detail, pricing, floor plans or location claims. It states what is
   * coming, captures interest, and offers a useful next step. #/shophouse
   * redirects here so old inbound links do not break.
   * ------------------------------------------------------------------ */
  function comingSoonPage() {
    return shell('<section class="sf-cs">' +
      '<div class="sf-cs-hero sf-reveal sf-reveal-up">' +
      '<p class="sf-cs-mark">Project B.T</p>' +
      '<p class="sf-cs-flag"><span class="sf-cs-dot" aria-hidden="true"></span>Coming soon</p>' +
      /* No <br> in headings. It read as "Something is being builtin Batangas."
         to assistive tech and to anything that concatenates text (SEO, share
         text, plain-text export), and combined with the max-width it orphaned
         "built" onto a line of its own. The line break is a layout decision, so
         it belongs in CSS, where the width already controls it. */
      '<h1>Something is being built in Batangas.</h1>' +
      '<p class="sf-cs-lede">SEA ESTATES is preparing a new mixed-use project. Details will be shared at launch. Leave your email if you would like to hear when Project B.T. opens.</p>' +
      '<div class="sf-cs-actions"><a class="sf-primary-btn" href="#/home" data-est-services>Start my Value Guide</a>' +
      '<a class="sf-outline-btn" href="#/search">Browse properties</a></div>' +
      '</div>' +
      '<div class="sf-cs-notify sf-reveal sf-reveal-up"><h2>Be the first to know</h2>' +
      '<p>Leave your email and we will let you know when Project B.T opens. No other mail from us.</p>' +
      '<form data-sf-notify novalidate>' +
      /* Visible label, not .sr-only. The label used to wrap the input and carry
       * .sr-only, which clipped the FIELD as well as the label text: the input
       * rendered 31px wide inside a 1x1 box, so the notify form could not be
       * filled in at all. A visible label is also simply better for the 40-75
       * audience this site targets. */
      '<label class="sf-field"><span>Email address</span>' +
      '<input type="email" name="email" required maxlength="254" autocomplete="email" placeholder="e.g. name@example.com"></label>' +
      '<label class="sf-consent"><input type="checkbox" name="consent" required><span>I agree to be contacted about Project B.T. I can unsubscribe at any time. See our <a href="#/privacy">Privacy Notice</a>.</span></label>' +
      '<button class="sf-primary-btn" type="submit">Notify me</button>' +
      '<p class="sf-form-status" aria-live="polite"></p></form></div></section>');
  }

  /* ------------------------------------------------------------------
   * Get My Property Value - the selling-services landing.
   *
   * One page, one goal: the owner tells us about the property and the service
   * they need (selling, appraisal, broker contact, management, title or
   * financing), and the team replies within one business day. The value
   * calculator lives on the home page; this page deliberately carries no
   * calculator so it stays a services conversation. The hero, document title
   * and primary CTA adapt to ?service=... and the form preselects it.
   * ------------------------------------------------------------------ */
  var PV_DEFAULT = {
    eyebrow: "Selling & property services",
    h1: "Get expert help with your property.",
    cta: "Talk to our team",
    submit: "Send my request",
    lede: "Tell us about your property and what you are planning. A specialist reviews it with you and points you to the right service — professional appraisal, broker support for selling, property management, title or financing. No obligation to list with us."
  };

  var PV_SERVICES = {
    "sell": {
      title: "Selling a property | SEA ESTATES",
      eyebrow: "Selling support",
      h1: "Sell with a plan, not a guess.",
      cta: "Get selling support",
      submit: "Get selling support",
      lede: "Tell us about your property and your timing. We help with pricing, preparation and a selling plan, and we scope the work before you commit. No obligation to list with us."
    },
    "pre-selling": {
      title: "Pre-selling support | SEA ESTATES",
      eyebrow: "Pre-selling support",
      h1: "Sell with a plan, not a guess.",
      cta: "Plan my pre-selling",
      submit: "Plan my pre-selling",
      lede: "We help owners prepare, price and launch a property so it sells well from the first week on the market. Tell us where you are in the process."
    },
    "appraisal": {
      title: "Property appraisal & valuation | SEA ESTATES",
      eyebrow: "Appraisal & valuation",
      h1: "A defensible value, not a guess.",
      cta: "Request an appraisal consultation",
      submit: "Request an appraisal consultation",
      lede: "Request a professional appraisal consultation for financing, estate or documentation needs. Tell us about the property and what the valuation is for."
    },
    "broker": {
      title: "Talk to a licensed broker | SEA ESTATES",
      eyebrow: "Licensed brokerage",
      h1: "Talk to a licensed broker.",
      cta: "Talk to a licensed broker",
      submit: "Request broker contact",
      lede: "Tell us about the property and request broker contact for selling, buying or marketing. A licensed broker replies, with no obligation to list."
    },
    "manage": {
      title: "Property management | SEA ESTATES",
      eyebrow: "Property management",
      h1: "Let someone else handle the day-to-day.",
      cta: "Ask about management",
      submit: "Ask about management",
      lede: "Tell us what needs managing — tenants, rent, upkeep or turnover — and we will walk through the options with you."
    },
    "title": {
      title: "Title & documentation | SEA ESTATES",
      eyebrow: "Title & documentation",
      h1: "Get the paperwork in order.",
      cta: "Ask about documentation",
      submit: "Ask about documentation",
      lede: "Ask our team to coordinate title checks and document processing, and tell us what stage the paperwork is at."
    },
    "finance": {
      title: "Financing support | SEA ESTATES",
      eyebrow: "Financing",
      h1: "Plan the financing before the commitment.",
      cta: "Ask about financing",
      submit: "Ask about financing",
      lede: "Tell us what you are planning and we will walk through bank, Pag-IBIG and developer financing options with you."
    }
  };

  /* Outline icons for the landing's trust row - the same visual language as
     the result screen's next-step icons: one 24px grid, 1.7 stroke,
     currentColor, decorative beside their visible text. */
  function pvTrustIcon(body) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + "</svg>";
  }

  function pvTrustRow(extraClass) {
    return '<ul class="sf-pv-trust' + (extraClass ? " " + extraClass : "") + '">' +
      '<li>' + pvTrustIcon('<circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12l2.9 1.7"/>') + "<span>A specialist replies within one business day</span></li>" +
      '<li>' + pvTrustIcon('<path d="M12 3.5 5.5 6v5.2c0 4.2 2.7 7.2 6.5 9.3 3.8-2.1 6.5-5.1 6.5-9.3V6L12 3.5Z"/><path d="m9 11.6 2.1 2.1 4-4.2"/>') + "<span>Your details are never sold</span></li>" +
      '<li>' + pvTrustIcon('<circle cx="12" cy="12" r="8.25"/><path d="m8.5 12.3 2.4 2.4 4.6-4.9"/>') + "<span>Free to ask — no obligation to sell or list</span></li>" +
      "</ul>";
  }

  /* ------------------------------------------------------------------
   * Service explorer on #/property-value: one house, nine services.
   *
   * The list is rendered from SERVICES (the same array as the Services menu),
   * so the page and the menu cannot disagree about a label, a note or a
   * destination. Only the drawings are new. Each service adds one small piece
   * to a single line-drawn house; the house draws itself once, then each piece
   * plays once (under 1.5 s) and rests on its finished frame.
   *
   * Markup contract (the e2e test reads it): [data-sf-explorer] root with
   * data-active (1-9), data-auto (on|off), data-paused, data-inview, data-seen;
   * [data-sf-x-btn] buttons (aria-current marks the open one, roving tabindex);
   * [data-sf-x-detail] one detail block per service (hidden unless open);
   * [data-sf-x-pause] the Pause / Play control.
   *
   * Auto-advance exists only for a mouse user who allows motion. It is driven
   * by the progress bar's CSS animation (animationend moves on), so hover,
   * focus, a hidden tab, scrolling away and Pause all stop it by pausing the
   * animation. It plays through all nine once, ends on the service it began
   * with, then rests.
   * ------------------------------------------------------------------ */
  var PV_X_SHORT = ["Buying", "Selling", "Renting", "Pre-selling", "Appraisal", "Broker", "Management", "Title", "Financing"];
  /* Call to action per service. Buying and Renting go to the listings search and
     have no landing copy of their own; the others reuse the landing's CTA. */
  var PV_X_CTA = ["Browse properties", "", "Browse rentals", "", "", "", "", "", ""];
  var PV_X_DEFAULT = 2;

  /* The house and lot, 400 x 240. Hex values match the --sf-* tokens (ink,
     soft ink, muted ink, accent): SVG presentation attributes cannot read CSS
     custom properties. Main strokes carry pathLength="1" so one dash rule
     draws them. */
  var PV_X_HOUSE =
    '<path d="M20 190H380" fill="none" stroke="#6B605A" stroke-width="2"/>' +
    '<g fill="none" stroke="#14110F" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path class="sf-pv-x-draw" pathLength="1" d="M130 190V112M250 190V112M130 190H250"/>' +
    '<path class="sf-pv-x-draw" pathLength="1" style="--d:.5s" d="M116 114 190 66 264 114"/>' +
    '<path class="sf-pv-x-draw" pathLength="1" style="--d:.9s" d="M222 90V74H238V104"/></g>' +
    '<g fill="none" stroke="#443C36" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path class="sf-pv-x-draw" pathLength="1" style="--d:1.1s" d="M178 190V152H202V190"/>' +
    '<rect class="sf-pv-x-draw" pathLength="1" style="--d:1.3s" x="142" y="128" width="24" height="22" rx="2"/>' +
    '<rect class="sf-pv-x-draw" pathLength="1" style="--d:1.4s" x="214" y="128" width="24" height="22" rx="2"/>' +
    '<circle class="sf-pv-x-draw" pathLength="1" style="--d:.8s" cx="60" cy="152" r="18"/>' +
    '<path d="M60 190V170"/></g>' +
    '<path d="M20 208H380" fill="none" stroke="#B4521F" stroke-width="1.4" stroke-dasharray="5 6"/>';

  /* One piece per service, in SERVICES order. */
  var PV_X_PIECES = [
    /* 1 Buying: a map pin drops onto the roof and sends out one ripple. */
    '<g class="sf-pv-x-piece" data-piece="1">' +
    '<ellipse class="sf-pv-x-rip" cx="190" cy="60" rx="22" ry="6" fill="none" stroke="#B4521F" stroke-width="1.6"/>' +
    '<g class="sf-pv-x-drop"><path d="M190 18c-9 0-15 7-15 15 0 11 15 25 15 25s15-14 15-25c0-8-6-15-15-15z" fill="#B4521F"/><circle cx="190" cy="33" r="5.5" fill="#fff"/></g></g>',

    /* 2 Selling: a for-sale sign swings in the lawn (the three checks are HTML). */
    '<g class="sf-pv-x-piece" data-piece="2">' +
    '<path d="M320 190V122H374" stroke="#443C36" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<g class="sf-pv-x-swing"><path d="M336 122V138M362 122V138" stroke="#443C36" stroke-width="1.6" fill="none"/>' +
    '<rect x="326" y="138" width="52" height="40" rx="4" fill="#B4521F"/>' +
    '<text x="352" y="154" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">FOR</text>' +
    '<text x="352" y="168" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">SALE</text></g></g>',

    /* 3 Renting: a key turns and a matched-tenant badge ticks. */
    '<g class="sf-pv-x-piece" data-piece="3">' +
    '<circle cx="316" cy="62" r="14" fill="none" stroke="#B4521F" stroke-width="2"/><circle cx="316" cy="58" r="5" fill="none" stroke="#B4521F" stroke-width="2"/>' +
    '<path d="M306 74c1-6 5-8 10-8s9 2 10 8" fill="none" stroke="#B4521F" stroke-width="2" stroke-linecap="round"/>' +
    '<g class="sf-pv-x-tick" style="--d:.6s"><circle cx="332" cy="50" r="8" fill="#1F6B45"/><path d="M328.5 50l2.6 2.6 4.4-4.8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>' +
    '<g class="sf-pv-x-turn"><circle cx="308" cy="126" r="13" fill="none" stroke="#B4521F" stroke-width="3.4"/><path d="M321 126H366M354 126V138M362 126V135" fill="none" stroke="#B4521F" stroke-width="3.4" stroke-linecap="round"/></g></g>',

    /* 4 Pre-selling: a scaffold outlines the house and a crane lifts a block. */
    '<g class="sf-pv-x-piece" data-piece="4">' +
    '<rect class="sf-pv-x-fade" x="104" y="58" width="172" height="132" fill="none" stroke="#B4521F" stroke-width="1.6" stroke-dasharray="5 6"/>' +
    '<path d="M324 190V36M338 190V36M324 190 338 170 324 150 338 130 324 110 338 90 324 70 338 50" fill="none" stroke="#443C36" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M286 36H378" stroke="#443C36" stroke-width="3.4" stroke-linecap="round"/><rect x="362" y="38" width="14" height="14" fill="#6B605A"/>' +
    '<path class="sf-pv-x-cable" d="M298 36V88" stroke="#443C36" stroke-width="1.6" fill="none"/>' +
    '<rect class="sf-pv-x-blk" x="290" y="88" width="16" height="12" rx="1.5" fill="#B4521F"/></g>',

    /* 5 Appraisal: a magnifier sweeps the house and the value needle settles. */
    '<g class="sf-pv-x-piece" data-piece="5">' +
    '<path d="M282 92A40 40 0 0 1 362 92" fill="none" stroke="#DDD4CA" stroke-width="7" stroke-linecap="round"/>' +
    '<path d="M282 92A40 40 0 0 1 332 53" fill="none" stroke="#B4521F" stroke-width="7" stroke-linecap="round"/>' +
    '<path class="sf-pv-x-needle" style="transform-origin:322px 92px" d="M322 92V60" stroke="#14110F" stroke-width="3" stroke-linecap="round" fill="none"/>' +
    '<circle cx="322" cy="92" r="5" fill="#14110F"/>' +
    '<text x="322" y="116" text-anchor="middle" font-size="9.5" font-weight="700" letter-spacing="1.6" fill="#6B605A">VALUE RANGE</text>' +
    '<g class="sf-pv-x-sweep"><circle cx="190" cy="126" r="30" fill="rgba(180,82,31,.07)" stroke="#B4521F" stroke-width="3.6"/><path d="M212 148 232 168" stroke="#B4521F" stroke-width="6" stroke-linecap="round"/></g></g>',

    /* 6 Broker: typing dots in the visitor's bubble, then a Licensed broker reply. */
    '<g class="sf-pv-x-piece" data-piece="6">' +
    '<path d="M44 74 52 86 66 74Z" fill="#fff" stroke="#6B605A" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<rect x="40" y="34" width="84" height="40" rx="12" fill="#fff" stroke="#6B605A" stroke-width="1.4"/>' +
    '<circle class="sf-pv-x-dot" cx="64" cy="54" r="4" fill="#443C36"/><circle class="sf-pv-x-dot" style="--d:.15s" cx="82" cy="54" r="4" fill="#443C36"/><circle class="sf-pv-x-dot" style="--d:.3s" cx="100" cy="54" r="4" fill="#443C36"/>' +
    '<g class="sf-pv-x-tick" style="--d:.7s"><path d="M342 70 334 82 322 70Z" fill="#B4521F"/><rect x="262" y="26" width="96" height="44" rx="12" fill="#B4521F"/>' +
    '<text x="310" y="45" text-anchor="middle" font-size="12" font-weight="800" fill="#fff">Licensed</text>' +
    '<text x="310" y="60" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">broker</text></g>' +
    '<g class="sf-pv-x-tick" style="--d:1s"><circle cx="358" cy="26" r="9" fill="#1F6B45"/><path d="M354 26l3 3 5-5.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g></g>',

    /* 7 Management: rent cells tick off and a Rent received tag lands. */
    '<g class="sf-pv-x-piece" data-piece="7">' +
    '<rect x="282" y="54" width="92" height="84" rx="8" fill="#fff" stroke="#443C36" stroke-width="1.8"/><path d="M282 76H374" stroke="#443C36" stroke-width="1.8"/>' +
    '<g fill="#B4521F"><rect class="sf-pv-x-tick" style="--d:.1s" x="292" y="86" width="14" height="14" rx="3"/><rect class="sf-pv-x-tick" style="--d:.22s" x="312" y="86" width="14" height="14" rx="3"/>' +
    '<rect class="sf-pv-x-tick" style="--d:.34s" x="332" y="86" width="14" height="14" rx="3"/><rect class="sf-pv-x-tick" style="--d:.46s" x="352" y="86" width="14" height="14" rx="3"/>' +
    '<rect class="sf-pv-x-tick" style="--d:.58s" x="292" y="108" width="14" height="14" rx="3"/><rect class="sf-pv-x-tick" style="--d:.7s" x="312" y="108" width="14" height="14" rx="3"/></g>' +
    '<g fill="#E4DDD5"><rect x="332" y="108" width="14" height="14" rx="3"/><rect x="352" y="108" width="14" height="14" rx="3"/></g>' +
    '<g class="sf-pv-x-tick" style="--d:.85s"><rect x="282" y="148" width="92" height="24" rx="12" fill="#1F6B45"/>' +
    '<text x="328" y="164" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">Rent received</text></g></g>',

    /* 8 Title: document lines draw and a stamp presses down with a check. */
    '<g class="sf-pv-x-piece" data-piece="8">' +
    '<rect x="284" y="46" width="76" height="98" rx="4" fill="#fff" stroke="#443C36" stroke-width="1.8"/>' +
    '<path class="sf-pv-x-draw" pathLength="1" style="--d:.1s" d="M296 68H348M296 82H348M296 96H328" stroke="#443C36" stroke-width="1.8" stroke-linecap="round" fill="none"/>' +
    '<g class="sf-pv-x-slam"><circle cx="338" cy="122" r="19" fill="none" stroke="#B4521F" stroke-width="3.4"/><path d="M329 122l6 6 11-12" fill="none" stroke="#B4521F" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></g></g>',

    /* 9 Financing: bars rise like steps and a peso coin settles on top. */
    '<g class="sf-pv-x-piece" data-piece="9">' +
    '<g fill="#B4521F"><rect class="sf-pv-x-rise" x="288" y="168" width="16" height="22" rx="2" opacity=".4"/><rect class="sf-pv-x-rise" style="--d:.12s" x="310" y="152" width="16" height="38" rx="2" opacity=".6"/>' +
    '<rect class="sf-pv-x-rise" style="--d:.24s" x="332" y="136" width="16" height="54" rx="2" opacity=".8"/><rect class="sf-pv-x-rise" style="--d:.36s" x="354" y="120" width="16" height="70" rx="2"/></g>' +
    '<g class="sf-pv-x-tick" style="--d:.8s"><circle cx="362" cy="94" r="15" fill="#B4521F"/><text x="362" y="100" text-anchor="middle" font-size="16" font-weight="800" fill="#fff">₱</text></g></g>'
  ];

  function pvServiceKey(href) {
    var m = /[?&]service=([a-z-]+)/.exec(String(href || ""));
    return m ? m[1] : "";
  }

  function pvExplorer(service) {
    var start = PV_X_DEFAULT;
    SERVICES.forEach(function (s, i) { if (service && pvServiceKey(s.href) === service) start = i + 1; });
    var btns = "", details = "", dots = "";
    SERVICES.forEach(function (s, i) {
      var n = i + 1, on = n === start, key = pvServiceKey(s.href);
      var cta = PV_X_CTA[i] || (PV_SERVICES[key] && PV_SERVICES[key].cta) || s.label;
      btns += '<button type="button" class="sf-pv-x-btn" id="sf-pv-x-btn-' + n + '" data-sf-x-btn="' + n + '" data-label="' + esc(s.label) + '"' +
        (on ? ' aria-current="true"' : "") + ' tabindex="' + (on ? "0" : "-1") + '" style="--n:' + n + '">' +
        '<span class="sf-pv-x-ico" aria-hidden="true">' + (SERVICE_ICONS[i] || "") + '</span>' +
        '<span class="sf-pv-x-full">' + esc(s.label) + '</span><span class="sf-pv-x-short">' + esc(PV_X_SHORT[i]) + '</span>' +
        '<span class="sf-pv-x-go" aria-hidden="true">›</span></button>';
      /* The service that is already open must not become a dead link: its own
         address is this page, so the CTA scrolls to the form instead. */
      details += '<div class="sf-pv-x-detail" data-sf-x-detail="' + n + '" style="--n:' + n + '"' + (on ? "" : " hidden") + '>' +
        '<p class="sf-pv-x-note">' + esc(s.note) + '</p>' +
        '<a class="sf-pv-x-cta" href="' + esc(s.href) + '"' + (key && key === service ? ' data-sf-scroll="sf-pv-form"' : "") + '>' + esc(cta) + ' <span aria-hidden="true">→</span></a>' +
        '<span class="sf-pv-x-track" aria-hidden="true"><i></i></span></div>';
      dots += "<i></i>";
    });
    var check = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3 8.6 6.4 12 13 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var pills = ["Pricing plan", "Preparation checklist", "Offer review"].map(function (t, i) {
      return '<li class="sf-pv-x-pill" style="--d:' + (0.2 + i * 0.15).toFixed(2) + 's"><i>' + check + '</i>' + t + '</li>';
    }).join("");
    return '<section class="sf-pv-x" id="sf-pv-explorer" data-sf-explorer data-active="' + start + '" data-auto="off" data-paused="false" aria-labelledby="sf-pv-x-title">' +
      '<div class="sf-pv-x-wrap">' +
      '<header class="sf-pv-x-head"><p class="sf-eyebrow">How we can help</p>' +
      '<h2 class="sf-pv-h2" id="sf-pv-x-title"><span class="sf-pv-x-line">One property.</span> <span class="sf-pv-x-line">Nine ways we can help.</span></h2>' +
      '<p class="sf-pv-x-sub">Choose a service to see what it covers, then go straight to the next step.</p></header>' +
      '<div class="sf-pv-x-body">' +
      '<div class="sf-pv-x-col"><div class="sf-pv-x-chips" role="group" aria-label="Services">' + btns + '</div>' +
      '<div class="sf-pv-x-details">' + details + '</div></div>' +
      '<div class="sf-pv-x-stage">' +
      '<div class="sf-pv-x-bar">' +
      '<span class="sf-pv-x-tag" aria-hidden="true"><span class="sf-pv-x-ico" data-sf-x-tag-ico>' + (SERVICE_ICONS[start - 1] || "") + '</span><span data-sf-x-tag-label>' + esc(SERVICES[start - 1].label) + '</span></span>' +
      '<span class="sf-pv-x-meta"><span class="sf-pv-x-count" aria-hidden="true" data-sf-x-count>0' + start + ' / 09</span>' +
      '<button type="button" class="sf-pv-x-pause" data-sf-x-pause>' +
      '<svg class="sf-pv-x-i-pause" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M8.5 6v12M15.5 6v12"/></svg>' +
      '<svg class="sf-pv-x-i-play" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10-6.5z"/></svg>' +
      '<span data-sf-x-pause-label>Pause</span></button></span></div>' +
      '<div class="sf-pv-x-prog" aria-hidden="true">' + dots + '</div>' +
      '<div class="sf-pv-x-scene"><svg class="sf-pv-x-svg" viewBox="0 0 400 240" aria-hidden="true" focusable="false">' + PV_X_HOUSE + PV_X_PIECES.join("") + '</svg>' +
      '<ul class="sf-pv-x-pills">' + pills + '</ul></div>' +
      '</div></div></div></section>';
  }

  var _pvExplorerOff = null;
  function bindPvExplorer() {
    if (_pvExplorerOff) { _pvExplorerOff(); _pvExplorerOff = null; }
    var root = document.querySelector("[data-sf-explorer]");
    if (!root) return;
    var chips = root.querySelector(".sf-pv-x-chips");
    var btns = Array.prototype.slice.call(root.querySelectorAll("[data-sf-x-btn]"));
    var details = Array.prototype.slice.call(root.querySelectorAll("[data-sf-x-detail]"));
    var dots = Array.prototype.slice.call(root.querySelectorAll(".sf-pv-x-prog i"));
    var countEl = root.querySelector("[data-sf-x-count]");
    var tagLabel = root.querySelector("[data-sf-x-tag-label]");
    var tagIco = root.querySelector("[data-sf-x-tag-ico]");
    var pause = root.querySelector("[data-sf-x-pause]");
    var pauseLabel = root.querySelector("[data-sf-x-pause-label]");
    var mq = function (query) { return window.matchMedia ? window.matchMedia(query).matches : false; };
    var auto = mq("(hover: hover) and (pointer: fine)") && !mq("(prefers-reduced-motion: reduce)");
    var active = Number(root.getAttribute("data-active")) || PV_X_DEFAULT;
    var advances = 0;
    root.setAttribute("data-auto", auto ? "on" : "off");

    function setActive(n) {
      active = n;
      root.setAttribute("data-active", String(n));
      btns.forEach(function (b, i) {
        var on = i + 1 === n;
        if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
        b.tabIndex = on ? 0 : -1;
      });
      details.forEach(function (d, i) { d.hidden = i + 1 !== n; });
      dots.forEach(function (d, i) { d.className = i + 1 < n ? "is-done" : (i + 1 === n ? "is-cur" : ""); });
      if (countEl) countEl.textContent = "0" + n + " / 09";
      if (tagLabel) tagLabel.textContent = btns[n - 1].getAttribute("data-label") || "";
      var ico = btns[n - 1].querySelector(".sf-pv-x-ico");
      if (tagIco && ico) tagIco.innerHTML = ico.innerHTML;
    }
    function setPaused(p) {
      root.setAttribute("data-paused", p ? "true" : "false");
      if (pauseLabel) pauseLabel.textContent = p ? "Play" : "Pause";
    }
    /* A person choosing a service takes over: the automatic tour stops. */
    function choose(n, moveFocus) {
      setActive(n);
      if (auto) setPaused(true);
      if (moveFocus) btns[n - 1].focus();
    }
    setActive(active);

    function onChipClick(event) {
      var b = event.target.closest ? event.target.closest("[data-sf-x-btn]") : null;
      if (b) choose(Number(b.getAttribute("data-sf-x-btn")), false);
    }
    function onChipKey(event) {
      var b = event.target.closest ? event.target.closest("[data-sf-x-btn]") : null;
      if (!b) return;
      var i = btns.indexOf(b), to = null;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") to = i + 1 >= btns.length ? 0 : i + 1;
      else if (event.key === "ArrowUp" || event.key === "ArrowLeft") to = i - 1 < 0 ? btns.length - 1 : i - 1;
      else if (event.key === "Home") to = 0;
      else if (event.key === "End") to = btns.length - 1;
      if (to === null) return;
      event.preventDefault();
      choose(to + 1, true);
    }
    function onPause() {
      if (root.getAttribute("data-paused") === "true") { advances = 0; setPaused(false); }
      else setPaused(true);
    }
    /* The progress bar finishing is the signal to move on. */
    function onEnd(event) {
      if (event.animationName !== "sf-pv-x-prog") return;
      if (!auto || root.getAttribute("data-paused") === "true" || document.hidden) return;
      advances += 1;
      setActive(active % btns.length + 1);
      if (advances >= btns.length) setPaused(true);
    }
    function onVisibility() { root.setAttribute("data-hidden", document.hidden ? "true" : "false"); }

    chips.addEventListener("click", onChipClick);
    chips.addEventListener("keydown", onChipKey);
    if (pause) pause.addEventListener("click", onPause);
    root.addEventListener("animationend", onEnd);
    document.addEventListener("visibilitychange", onVisibility);

    /* "In view" gates the house drawing and the tour, so neither plays
       unseen. A tall explorer on a short screen counts as seen once most of
       the viewport shows it. */
    var io = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var on = en.intersectionRatio >= 0.5 || en.intersectionRect.height >= window.innerHeight * 0.6;
          root.setAttribute("data-inview", on ? "true" : "false");
          if (on) root.setAttribute("data-seen", "true");
        });
      }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
      io.observe(root);
    } else {
      root.setAttribute("data-inview", "true");
      root.setAttribute("data-seen", "true");
    }

    _pvExplorerOff = function () {
      document.removeEventListener("visibilitychange", onVisibility);
      if (io) io.disconnect();
    };
  }

  /* The three steps are quiet cards. Each card's picture plays once when the
     card first scrolls into view; with reduced motion, or without
     IntersectionObserver, the finished frames just show. */
  var _pvStepsObs = null;
  function bindPvSteps() {
    if (_pvStepsObs) { _pvStepsObs.disconnect(); _pvStepsObs = null; }
    var list = document.querySelector("[data-sf-steps]");
    if (!list) return;
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) return;
    list.classList.add("sf-pv-steps--motion");
    _pvStepsObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add("is-in");
        _pvStepsObs.unobserve(en.target);
      });
    }, { threshold: 0.3 });
    Array.prototype.forEach.call(list.children, function (li) { _pvStepsObs.observe(li); });
  }

  /* Hero touches. The headline underline is only for the default landing,
     whose headline is fixed copy; a service page keeps its own plain headline. */
  function pvHeadline(copy) {
    if (copy === PV_DEFAULT && /your property\.$/.test(copy.h1)) {
      return esc(copy.h1.replace(/your property\.$/, "")) +
        '<span class="sf-pv-underline">your property.' +
        '<svg viewBox="0 0 300 14" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path pathLength="1" d="M2 9 C 60 2, 120 12, 180 6 S 270 4, 298 8"/></svg></span>';
    }
    return esc(copy.h1);
  }
  function pvGlyphs() {
    return '<div class="sf-pv-glyphs" aria-hidden="true">' + [4, 2, 7, 8].map(function (i, k) {
      return '<span class="sf-pv-glyph" style="--k:' + k + '">' + (SERVICE_ICONS[i] || "") + '</span>';
    }).join("") + '</div>';
  }

  /* Same band as the homepage, so the contact details come from the same
     place (contactDetails() reads siteContact, which applyContact() refreshes
     when the back-office settings arrive). Nothing is typed in here. */
  function pvCloseBand() {
    return '<section class="sf-cta sf-cta-short sf-pv-endband" id="sf-contact"><div class="sf-cta-band"><div><h2>Questions? Talk to our team.</h2><p>Buying, selling, renting or reviewing a property? Send the location and your plans, and a specialist replies within one business day.</p><div class="sf-contact-details">' + contactDetails() + '</div></div>' +
      '<a class="sf-hero-btn sf-cta-go" href="#sf-pv-form" data-sf-scroll="sf-pv-form">Message our team</a></div></section>';
  }

  function propertyValuePage(params) {
    var service = String((params && params.get("service")) || "").toLowerCase();
    var copy = PV_SERVICES[service] || PV_DEFAULT;
    var planning = [
      ["", "Just want to know my property value"],
      ["sell", "I want to sell soon"],
      ["pre-selling", "I am preparing to sell in the future"],
      ["buy", "I am looking to buy"],
      ["rent", "Renting out my property"],
      ["broker", "Talk to a licensed broker"],
      ["manage", "Property management"],
      ["title", "Title or documentation help"],
      ["finance", "Financing options"]
    ];
    return shell('<section class="sf-pv sf-pv--hero">' +
      '<div class="sf-pv-hero">' +
      '<div class="sf-pv-hero-copy">' +
      '<p class="sf-eyebrow sf-reveal sf-reveal-up">' + esc(copy.eyebrow) + '</p>' +
      '<h1 class="sf-reveal sf-reveal-up">' + pvHeadline(copy) + '</h1>' +
      '<p class="sf-pv-lede sf-reveal sf-reveal-up">' + esc(copy.lede) + '</p>' +
      '<div class="sf-pv-actions sf-reveal sf-reveal-up"><a class="sf-primary-btn" href="#sf-pv-form" data-sf-scroll="sf-pv-form">' + esc(copy.cta) + '</a>' +
      '<a class="sf-pv-seeall" href="#sf-pv-explorer" data-sf-scroll="sf-pv-explorer">See all nine services <span aria-hidden="true">\u2193</span></a></div>' +
      pvTrustRow("sf-reveal sf-reveal-up") +
      '</div>' +

      /* The request card sits inside the hero, so the form is visible without
         any scroll on wide screens and immediately after the copy on phones. */
      '<div class="sf-pv-hero-form sf-reveal sf-reveal-up" id="sf-pv-form">' + pvGlyphs() + '<div class="sf-pv-form-card">' +
      '<h2 class="sf-pv-h2">Tell us what you need</h2>' +
      '<p class="sf-pv-form-sub">A few details and the service you are after. We reply within one business day.</p>' +
      '<form class="sf-pv-form" data-sf-consult novalidate>' +
      '<div class="sf-pv-field-row"><label>Full name<input name="name" required maxlength="160" autocomplete="name" placeholder="e.g. Juan dela Cruz"></label>' +
      '<label>Mobile number<input name="phone" type="tel" required maxlength="50" autocomplete="tel" inputmode="tel" placeholder="e.g. 0917 123 4567 or +63 917 123 4567"></label></div>' +
      '<label>Email<input type="email" name="email" maxlength="254" autocomplete="email" placeholder="e.g. name@example.com"></label>' +
      /* The option value is the human label, so the lead's message reads the
         same to the team as it does to the reader (a service key like "broker"
         used to be posted verbatim). The first option is the default, so the
         plain landing arrives with a sensible answer already selected instead
         of a "Choose one" gate; a ?service=... link preselects its own row. */
      '<label>What are you planning?<select name="message">' + planning.map(function (pair) {
        return '<option value="' + esc(pair[1]) + '"' + (pair[0] === service ? " selected" : "") + '>' + esc(pair[1]) + '</option>';
      }).join("") + '</select></label>' +
       '<label class="sf-consent"><input type="checkbox" name="consent" required><span>I consent to SEA ESTATES contacting me about my property. Read our <a href="#/privacy">Privacy Notice</a>. I can opt out of follow-up at any time.</span></label>' +
       '<button class="sf-primary-btn" type="submit">' + esc(copy.submit) + '</button>' +
      '<p class="sf-pv-micro">Takes 30 seconds. No spam. No obligation.</p>' +
      '<p class="sf-form-status" aria-live="polite"></p></form></div></div>' +
      '</div></section>' +

      /* The service explorer is a full-width band, so it sits between two
         page sections instead of inside the centred one. */
      pvExplorer(service) +
      '<section class="sf-pv sf-pv--rest">' +

      /* What happens: three quiet cards. Each card pairs a small animated
         picture of the step - the form filling itself in, the call, the
         service pick - with its copy, so the section teaches the process
         instead of just describing it. bindPvSteps plays a card's picture
         once as it scrolls into view; without JS or with reduced motion the
         finished frames show and all copy is complete. */
      '<div class="sf-pv-steps"><h2 class="sf-pv-h2 sf-blur"><span>What</span> <span>happens</span></h2>' +
      '<p class="sf-pv-steps-sub">Three short steps stand between sending the form and deciding what comes next.</p>' +
      '<ol class="sf-pv-steps-list" data-sf-steps>' +
      '<li><div class="sf-pv-vigbox">' +
      '<div class="sf-pv-vig" data-vig="1" aria-hidden="true">' +
      '<span class="sf-pv-vig-kick sf-pv-a" style="--d:.05s">What you do</span>' +
      '<div class="sf-pv-vig-card sf-pv-a" style="--d:.18s">' +
      '<div class="sf-pv-vig-row sf-pv-a" style="--d:.30s"><span class="sf-pv-vig-lbl">Where</span><span class="sf-pv-vig-val">Bauan, Batangas</span><span class="sf-pv-vig-ok"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.6 6.3 12 13 4.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div>' +
      '<div class="sf-pv-vig-row sf-pv-a" style="--d:.42s"><span class="sf-pv-vig-lbl">What</span><span class="sf-pv-vig-val">House &amp; lot</span><span class="sf-pv-vig-ok"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.6 6.3 12 13 4.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div>' +
      '<div class="sf-pv-vig-row sf-pv-a" style="--d:.54s"><span class="sf-pv-vig-lbl">Service</span><span class="sf-pv-vig-val">Selling support</span><span class="sf-pv-vig-ok"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.6 6.3 12 13 4.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div>' +
      '</div>' +
      '<span class="sf-pv-vig-stamp sf-pv-a" style="--d:.72s">About 30 seconds</span>' +
      '</div>' +
      '</div><div class="sf-pv-step-copy"><span class="sf-pv-step-role">Step 1 \u00B7 You</span><b>Tell us about your property</b><p>Share the location, the property, and the service you are after. The short form is enough to start.</p></div></li>' +
      '<li><div class="sf-pv-vigbox sf-pv-vigbox--call">' +
      '<div class="sf-pv-vig" data-vig="2" aria-hidden="true">' +
      '<span class="sf-pv-vig-kick sf-pv-a" style="--d:.05s">What we do</span>' +
      '<div class="sf-pv-vig-call sf-pv-a" style="--d:.18s">' +
      '<div class="sf-pv-vig-person"><span class="sf-pv-vig-avatar">SE</span><span class="sf-pv-vig-who"><b>Property specialist</b><i>Connected</i></span><span class="sf-pv-vig-dot" aria-hidden="true"></span></div>' +
      '<div class="sf-pv-vig-wave" aria-hidden="true">' + (function () { var bars = ""; for (var b = 0; b < 12; b++) bars += '<i style="--i:' + b + '"></i>'; return bars; })() + '</div>' +
      '</div>' +
      '<div class="sf-pv-vig-agenda">' +
      '<span class="sf-pv-vig-item sf-pv-a" style="--d:.42s">Your plans and timing</span>' +
      '<span class="sf-pv-vig-item sf-pv-a" style="--d:.54s">The property itself</span>' +
      '<span class="sf-pv-vig-item sf-pv-a" style="--d:.66s">Any questions you have</span>' +
      '</div>' +
      '</div>' +
      '</div><div class="sf-pv-step-copy"><span class="sf-pv-step-role">Step 2 \u00B7 We call you</span><b>Have a short call with our team</b><p>A specialist reviews your situation, then asks about your plans, timing and the property.</p></div></li>' +
      '<li><div class="sf-pv-vigbox">' +
      '<div class="sf-pv-vig" data-vig="3" aria-hidden="true">' +
      '<span class="sf-pv-vig-kick sf-pv-a" style="--d:.05s">What you decide</span>' +
      '<div class="sf-pv-vig-chips">' +
      ["Appraisal", "Selling support", "Broker contact", "Property management", "Title &amp; documents", "Financing"].map(function (chip, i) {
        return '<span class="sf-pv-vig-chip sf-pv-a" style="--d:' + (0.18 + i * 0.08).toFixed(2) + 's">' + chip + '</span>';
      }).join("") +
      '</div>' +
      '<div class="sf-pv-vig-deal sf-pv-a" style="--d:.72s"><span>Scope and fees explained first</span><b aria-hidden="true">No commitment</b></div>' +
      '</div>' +
      '</div><div class="sf-pv-step-copy"><span class="sf-pv-step-role">Step 3 \u00B7 You decide</span><b>Choose the service you need</b><p>Appraisal, selling support, broker contact, management, title or financing — we explain the scope and the cost before you commit.</p></div></li>' +
      '</ol>' +
      '</div>' +

      /* Objection handling after the ask: every answer restates a promise
         already made elsewhere on the page (free to ask, no obligation, one
         business day, never sold); nothing numeric or testimonial is
         invented. All items start collapsed. Each row carries a small
         teaching glyph and lifts into a card while open. */
      '<div class="sf-pv-faq"><div class="sf-pv-faq-head"><h2 class="sf-pv-h2 sf-blur"><span>Common</span> <span>questions</span></h2>' +
      '<p class="sf-pv-faq-sub">The questions property owners ask us first, answered plainly.</p></div>' +
      '<div class="sf-pv-faq-list">' + [
        ["Is asking free?", "Yes — sending a request and the first conversation are free. If an appraisal or a listing is the right next step, we explain the scope and the fees first, so you decide before anything is charged or signed.", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h12v17l-2.4-1.7-2.4 1.7-2.4-1.7-2.4 1.7-2.4-1.7z"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5"/></svg>'],
        ["Will you pressure me to list?", "No. There is no obligation to sell or list with us, and nothing is sent to a broker or appraiser until you ask.", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M10.2 9.2v5.6M13.8 9.2v5.6"/></svg>'],
        ["What happens to my details?", "We use them only to respond to this request, and they are never sold. See our <a href=\"#/privacy\">Privacy Notice</a>.", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>'],
        ["How soon will I hear back?", "A specialist replies within one business day.", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/></svg>'],
        ["What can you help with?", "Appraisal and valuation, selling support, broker contact, property management, title and documentation, and financing.", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.7"/><rect x="13" y="4" width="7" height="7" rx="1.7"/><rect x="4" y="13" width="7" height="7" rx="1.7"/><rect x="13" y="13" width="7" height="7" rx="1.7"/></svg>']
      ].map(function (pair) {
        return '<details class="sf-pv-faq-item"><summary><span class="sf-pv-faq-ico">' + pair[2] + '</span><h3>' + esc(pair[0]) + '</h3><span class="sf-pv-faq-chev" aria-hidden="true"></span></summary><div class="sf-pv-faq-body"><p>' + pair[1] + '</p></div></details>';
      }).join("") + '</div>' +
      '<p class="sf-pv-faq-more">Still unsure? <a href="#sf-pv-form" data-sf-scroll="sf-pv-form">Ask the team directly</a> — a specialist replies within one business day.</p>' +
      '</div></section>' +

      /* Closing band: the same contact band as the homepage. */
      pvCloseBand());
  }

  /* Contact details arrive asynchronously. They used to trigger a full
   * renderCurrent(), which rebuilt the home page from scratch - wiping the
   * estimator's in-progress state and throwing away the reader's scroll
   * position. Only the two contact-dependent regions are patched now. */
  /* Contact details arrive asynchronously, so patch the two regions that depend
   * on them.
   *
   * It used to rewrite the contact band's eyebrow, heading and description from
   * siteContact as well. That made the page's own editorial copy unreachable,
   * and since the settings fetch fails CORS in most environments, whatever the
   * hard-coded defaults happened to say won - which is how the closed shophouse
   * campaign became the live homepage's headline.
   *
   * Now the page owns its copy and settings only supply contact details. If the
   * band copy is ever to be CMS-driven that should be an explicit field, not a
   * side effect of a fetch that may not succeed. */
  function applyContact() {
    try {
      var details = document.querySelector("#sf-contact .sf-contact-details");
      if (details) details.innerHTML = contactDetails();
    } catch (e) { /* noop */ }
  }

  function loadSiteContact() {
    if (!API || !API.siteSettings) {
      siteContact = Object.assign({}, siteContact, { contactLoaded: true });
      applyContact();
      return;
    }
    API.siteSettings().then(function (result) {
      /* Site settings override the built-in contact only where they are filled in
       * with a real value. The old defaults ("+63 900 000 0000",
       * "hello@esrealty.ph") were still stored on the server and replaced the
       * real number on the live contact band (found 2026-10-16), so they count
       * as empty. */
      var placeholder = /^(\+63 900 000 0000|hello@esrealty\.ph)$/i;
      if (result && result.data) Object.keys(result.data).forEach(function (k) { var v = result.data[k]; if (v != null && String(v).trim() !== "" && !placeholder.test(String(v).trim())) siteContact[k] = v; });
      siteContact.contactLoaded = true;
      applyContact();
    }).catch(function () {
      siteContact = Object.assign({}, siteContact, { contactLoaded: true });
    });
  }

  function firstImage(listing) {
    var images = Array.isArray(listing.images) ? listing.images : [];
    return images.length ? safeImage(images[0].url || images[0]) : "";
  }

  function cardImages(listing) {
    var images = Array.isArray(listing.images) ? listing.images : [];
    return images.map(function (item) { return safeImage(item.url || item); }).filter(Boolean);
  }

  function cardMedia(listing) {
    var images = cardImages(listing);
    if (!images.length) return '<div class="sf-image-empty" aria-label="Property image not supplied">S.E</div>';
    if (images.length === 1) return '<img ' + thumbAttrs(images[0]) + ' alt="' + esc(listing.title) + '" loading="lazy">';
    var slides = images.map(function (image, i) {
      return '<div class="sf-slide" aria-hidden="' + (i ? "true" : "false") + '"><img ' + thumbAttrs(image) + ' alt="' + esc(listing.title) + ' photo ' + (i + 1) + '" loading="lazy"></div>';
    }).join("");
    var dots = images.map(function (_, i) {
      return '<button type="button" data-sf-car-dot="' + i + '"' + (i === 0 ? ' class="active"' : "") + ' aria-label="Go to photo ' + (i + 1) + '"></button>';
    }).join("");
    return '<div class="sf-carousel" data-sf-carousel data-images="' + images.length + '" data-index="0">' +
      '<div class="sf-car-track">' + slides + '</div>' +
      '<span class="sf-car-count">1/' + images.length + '</span>' +
      '<button type="button" class="sf-car-btn prev" data-sf-car-prev aria-label="Previous photo"></button>' +
      '<button type="button" class="sf-car-btn next" data-sf-car-next aria-label="Next photo"></button>' +
      '<div class="sf-car-dots">' + dots + '</div></div>';
  }

  function setCarousel(car, index) {
    var count = Number(car.getAttribute("data-images") || 1);
    var current = ((index % count) + count) % count;
    car.setAttribute("data-index", String(current));
    var track = car.querySelector(".sf-car-track");
    if (track) track.style.transform = "translateX(-" + (current * 100) + "%)";
    var dots = car.querySelectorAll(".sf-car-dots button");
    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle("active", i === current);
    var countEl = car.querySelector(".sf-car-count");
    if (countEl) countEl.textContent = (current + 1) + "/" + count;
    var gallery = car.closest(".sf-gallery");
    if (gallery) {
      var thumbs = gallery.querySelectorAll(".sf-thumbs button");
      for (var j = 0; j < thumbs.length; j++) thumbs[j].classList.toggle("active", j === current);
    }
  }

  function detailGallery(listing, images) {
    if (!images.length) return '<div class="sf-gallery empty"><div>SEA ESTATES</div></div>';
    var slides = images.map(function (image, i) {
      return '<div class="sf-slide" aria-hidden="' + (i ? "true" : "false") + '"><img src="' + esc(image) + '" alt="' + esc(listing.title) + ' photo ' + (i + 1) + '"></div>';
    }).join("");
    var multi = images.length > 1;
    var dots = multi ? images.map(function (_, i) {
      return '<button type="button" data-sf-car-dot="' + i + '"' + (i === 0 ? ' class="active"' : "") + ' aria-label="Go to photo ' + (i + 1) + '"></button>';
    }).join("") : "";
    var thumbs = multi ? '<div class="sf-thumbs">' + images.map(function (image, i) {
      return '<button type="button" data-sf-thumb="' + i + '"' + (i === 0 ? ' class="active"' : "") + ' aria-label="View photo ' + (i + 1) + '"><img ' + thumbAttrs(image) + ' alt="" loading="lazy"></button>';
    }).join("") + '</div>' : "";
    return '<div class="sf-gallery"><div class="sf-gallery-stage">' +
      '<div class="sf-carousel" data-sf-carousel data-images="' + images.length + '" data-index="0">' +
      '<div class="sf-car-track">' + slides + '</div>' +
      (multi ? '<span class="sf-car-count">1/' + images.length + '</span>' : "") +
      (multi ? '<button type="button" class="sf-car-btn prev" data-sf-car-prev aria-label="Previous photo"></button>' : "") +
      (multi ? '<button type="button" class="sf-car-btn next" data-sf-car-next aria-label="Next photo"></button>' : "") +
      (multi ? '<div class="sf-car-dots">' + dots + '</div>' : "") +
      '</div></div>' + thumbs + '</div>';
  }

  function locationText(listing) {
    return [listing.barangay, listing.city, listing.province].filter(Boolean).join(", ") || listing.region || "Philippines";
  }

  function typeLabel(value) {
    var labels = { "house-and-lot": "House & Lot", condominium: "Condominium", "lot-only": "Land", townhouse: "Townhouse", shophouse: "Shophouse", commercial: "Commercial", industrial: "Industrial", agricultural: "Agricultural", foreclosed: "Foreclosed" };
    return labels[value] || String(value || "Property").replace(/-/g, " ");
  }

  /* Grid/list is a search-results preference only. It used to be read from the
   * shared view state by every card, so toggling list view on /search left home
   * and /shophouse rendering the same properties as full-width list rows. */
  function isListView() {
    return viewState.mode === "list" && route().path === "search";
  }

  // Zero/absent API defaults are not useful property facts. Do not invent
  // bedrooms for studios or land; show only positive supplied measurements.
  function propertyFacts(listing, detail) {
    var fields = detail
      ? [["bedrooms", "Bedrooms"], ["bathrooms", "Bathrooms"], ["floor_area_sqm", "Floor sqm"], ["lot_size_sqm", "Lot sqm"]]
      : [["bedrooms", "beds"], ["bathrooms", "baths"], ["floor_area_sqm", "sqm"]];
    var facts = fields.map(function (field) {
      var raw = listing[field[0]];
      if (!detail && field[0] === "floor_area_sqm" && !(Number(raw) > 0)) raw = listing.lot_size_sqm;
      if (raw === null || raw === "" || raw === undefined || !Number.isFinite(Number(raw)) || Number(raw) <= 0) return "";
      return '<span><b>' + esc(Number(raw)) + '</b> ' + esc(field[1]) + '</span>';
    }).filter(Boolean);
    return facts.length ? facts.join("") : '<span class="sf-facts-pending">Property details available on request</span>';
  }

  function card(listing) {
    compareRecords[String(listing.id)] = listing;
    var price = money(listing.display_price, listing.offer_type === "rent" ? "/mo" : "");
    return '<article class="sf-property-card sf-reveal sf-reveal-up ' + (isListView() ? "is-list" : "") + '">' +
      '<button class="sf-card-open" data-sf-listing="' + esc(listing.id) + '" aria-label="Open ' + esc(listing.title) + '"></button>' +
      '<div class="sf-card-media">' + cardMedia(listing) +
      '<div class="sf-card-tags"><span>' + esc(listing.offer_type === "rent" ? "For rent" : "For sale") + '</span>' + (listing.featured ? '<span class="featured">Featured</span>' : '') + '</div>' +
      '<button class="sf-save" data-sf-save="' + esc(listing.id) + '" aria-label="Sign in to save">♡</button></div>' +
      '<div class="sf-card-copy"><p class="sf-card-type">' + esc(typeLabel(listing.property_type)) + '</p><h3>' + esc(price) + '</h3>' +
      '<h4>' + esc(listing.title) + '</h4><p class="sf-card-location">' + esc(locationText(listing)) + '</p>' +
      '<div class="sf-card-meta">' + propertyFacts(listing, false) + '</div>' + (route().path === "search" ? compareButton(listing) : "") + '</div></article>';
  }

  function compareButton(listing) {
    compareRecords[String(listing.id)] = listing;
    var selected = compareIds.indexOf(String(listing.id)) >= 0;
    return '<button type="button" class="sf-compare-toggle" data-sf-compare="' + esc(listing.id) + '" aria-pressed="' + selected + '" aria-label="' + (selected ? 'Remove from comparison: ' : 'Compare: ') + esc(listing.title || "Property") + '">' + (selected ? "✓ Selected for comparison" : "+ Compare") + '</button>';
  }

  function compareTray() {
    return '<div data-sf-compare-tray class="sf-compare-tray"><div><h2>Compare two properties</h2><p>' + compareIds.length + ' of 2 selected. Select Compare on a property to add it.</p></div><div class="sf-compare-selected">' + compareIds.map(function (id) {
      return '<button type="button" data-sf-compare-remove="' + esc(id) + '" aria-label="Remove ' + esc((compareRecords[id] || {}).title || "property") + ' from comparison">' + esc((compareRecords[id] || {}).title || "Selected property") + ' ×</button>';
    }).join("") + '</div><div class="sf-compare-actions"><button type="button" class="sf-primary-btn" data-sf-compare-open' + (compareIds.length === 2 ? "" : " disabled") + '>Compare properties</button>' + (compareIds.length ? '<button type="button" class="sf-outline-btn" data-sf-compare-clear>Clear selection</button>' : "") + '</div></div>';
  }

  function updateCompare(message) {
    compareMessage = message || "";
    try { sessionStorage.setItem("esrealty_compare_v1", JSON.stringify(compareIds)); } catch (e) {}
    document.querySelectorAll("[data-sf-compare]").forEach(function (button) {
      var selected = compareIds.indexOf(button.getAttribute("data-sf-compare")) >= 0;
      button.setAttribute("aria-pressed", String(selected));
      button.textContent = selected ? "✓ Selected for comparison" : "+ Compare";
      var record = compareRecords[button.getAttribute("data-sf-compare")];
      button.setAttribute("aria-label", (selected ? "Remove from comparison: " : "Compare: ") + ((record || {}).title || "Property"));
    });
    // Patch just comparison UI; keep search drafts, inquiry forms and maps intact.
    var tray = document.querySelector("[data-sf-compare-tray]");
    if (tray) tray.outerHTML = compareTray();
    var live = document.querySelector("[data-sf-compare-status]");
    if (live) live.textContent = compareMessage;
  }

  function comparisonPage() {
    var content = '<section class="sf-compare-page"><a class="sf-back" href="' + esc(compareReturn) + '">← Back to properties</a><p class="sf-eyebrow">PROPERTY COMPARISON</p><h1 tabindex="-1" data-sf-compare-heading>Compare your two properties.</h1><p>Listing-supplied details side by side. Confirm prices and missing information with the listing agent.</p>' + compareTray() + '<p role="status" aria-live="polite" data-sf-compare-status>' + esc(compareMessage) + '</p>';
    if (viewState.loading) return shell(content + '<p role="status">Refreshing selected properties…</p></section>');
    if (compareIds.length !== 2) return shell(content + '<p>Select two properties to see their comparison.</p></section>');
    var records = compareIds.map(function (id) { return compareErrors[id] ? null : compareRecords[id]; });
    if (records.some(function (r) { return !r; })) return shell(content + '<p>One or more properties could not be loaded. ' + esc(compareIds.map(function (id) { return compareErrors[id] || ""; }).filter(Boolean).join(" ")) + '</p><button class="sf-outline-btn" data-sf-compare-retry>Retry loading</button></section>');
    function supplied(value) { var n = Number(value); return isFinite(n) && n > 0 ? new Intl.NumberFormat("en-PH").format(n) : "Not supplied"; }
    var rows = [
      ["Listing type", function (r) { return r.offer_type === "rent" ? "For rent" : "For sale"; }],
      ["Asking price / rent", function (r) { var n = Number(r.display_price || (r.offer_type === "rent" ? r.rent : r.price)); return n > 0 && isFinite(n) ? money(n, r.offer_type === "rent" ? " / month" : " sale price") : "Price on request"; }],
      ["Location", function (r) { return [r.barangay, r.city, r.province].filter(Boolean).join(", ") || "Not supplied"; }],
      ["Property type", function (r) { return r.property_type ? typeLabel(r.property_type) : "Not supplied"; }],
      ["Bedrooms", function (r) { return supplied(r.bedrooms); }],
      ["Bathrooms", function (r) { return supplied(r.bathrooms); }],
      ["Floor area (sqm)", function (r) { return supplied(r.floor_area_sqm); }],
      ["Lot area (sqm)", function (r) { return supplied(r.lot_area_sqm); }],
      ["Year built", function (r) { return supplied(r.year_built); }]
    ];
    content += '<div class="sf-compare-properties">' + records.map(function (r, i) { var image = safeImage((r.images && r.images[0] && (r.images[0].url || r.images[0])) || ""); return '<article><span>Property ' + (i + 1) + '</span>' + (image ? '<img ' + thumbAttrs(image) + ' alt="" loading="lazy">' : '<p>Photo not supplied</p>') + '<h2>' + esc(r.title || "Property") + '</h2><a class="sf-outline-btn" href="#/listing/' + encodeURIComponent(r.id) + '">View property details</a></article>'; }).join("") + '</div>';
    content += '<dl class="sf-compare-fields">' + rows.map(function (row) { return '<div><dt>' + esc(row[0]) + '</dt>' + records.map(function (r, i) { return '<dd><span class="sf-compare-mobile-label">Property ' + (i + 1) + ': </span>' + esc(row[1](r)) + '</dd>'; }).join("") + '</div>'; }).join("") + '</dl><p>Sale prices and monthly rent are different measures. Missing or zero-default fields do not establish that a property has no bedrooms, bathrooms or area.</p>';
    return shell(content + '</section>');
  }

  function empty(message) {
    return '<div class="sf-empty"><div class="sf-empty-ico"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/></svg></div><h3>No properties found</h3><p>' + esc(message || "Try changing your filters.") + '</p></div>';
  }

  function skeletons(count) {
    var html = "";
    for (var i = 0; i < count; i++) html += '<div class="sf-property-card sf-skeleton"><div></div><div></div></div>';
    return html;
  }

  /* ------------------------------------------------------------------
   * Search filter model - single source of truth.
   *
   * The Properties page used to ship a dead end: the nav linked to
   * "#/search?state=Batangas", but searchFields() only rendered city,
   * property_type and max_price. The state filter was applied to the query but
   * appeared nowhere on screen, so the visitor saw "No properties found" with
   * an empty Location box and no way to tell why or clear it. offer_type
   * (linked from the Renting service) had the same problem.
   *
   * Every parameter that narrows the result set is now declared here, rendered
   * in the form, shown as a removable chip when active, and dropped by
   * clearFilters(). Adding a filter means adding one line here.
   * ------------------------------------------------------------------ */
  var FILTERS = [
    /* Keyword search (H2): the listing API matches every word in the title, description,
       address, barangay, city or reference. It sits on its own full-width row. */
    { name: "q", label: "Keyword", kind: "text", placeholder: "e.g. pool, corner lot, near school", wide: true },
    { name: "city", label: "Location", kind: "text", placeholder: "City or municipality" },
    { name: "state", label: "State / province", kind: "text", placeholder: "e.g. Batangas" },
    { name: "property_type", label: "Property type", kind: "select", options: [
      ["", "Any property"], ["house-and-lot", "House & Lot"], ["condominium", "Condominium"],
      ["lot-only", "Land"], ["townhouse", "Townhouse"], ["shophouse", "Shophouse"],
      ["commercial", "Commercial"], ["industrial", "Industrial"], ["agricultural", "Agricultural"]
    ] },
    { name: "offer_type", label: "Listing type", kind: "select", options: [
      ["", "For sale or rent"], ["sale", "For sale"], ["rent", "For rent"]
    ] },
    { name: "max_price", label: "Budget up to", kind: "select", options: [
      ["", "Any price"], ["3000000", "₱3M"], ["5000000", "₱5M"],
      ["10000000", "₱10M"], ["20000000", "₱20M"]
    ] }
  ];

  /* Sort and paging are not filters - they change presentation, not the result
     set, so they stay out of the chip list. */
  var NON_FILTER_PARAMS = ["sort", "page", "per_page", "section", "service"];

  function activeFilters(params) {
    return FILTERS
      .map(function (f) { return { def: f, value: params.get(f.name) }; })
      .filter(function (f) { return f.value !== null && f.value !== ""; });
  }

  function filterSummary(f) {
    if (f.def.kind === "select") {
      var hit = f.def.options.filter(function (o) { return o[0] === f.value; })[0];
      return hit ? hit[1] : f.value;
    }
    return f.value;
  }

  /* A search link with the named filters removed, so "clear" never has to guess
     at the current URL. */
  function clearLink(drop, extra) {
    var p = new URLSearchParams();
    forEachParam(function (name, value) {
      if (NON_FILTER_PARAMS.indexOf(name) > -1) return;
      if ((drop || []).indexOf(name) > -1) return;
      p.set(name, value);
    });
    var q = p.toString();
    var hash = (extra || "") + (q ? "?" + q : "");
    return hash ? "#/search" + hash : "#/search";
  }

  function forEachParam(fn) {
    var raw = location.hash.replace(/^#\/?/, "");
    var parts = raw.split("?");
    var params = new URLSearchParams(parts.slice(1).join("?"));
    /* URLSearchParams.forEach invokes fn(value, key) - value FIRST. Reading it
     * as (key, value) produced links like "#/search?Batangas=state". */
    params.forEach(function (value, name) { fn(name, value); });
  }

  function searchFields(params, compact) {
    var body = FILTERS.map(function (f) {
      var value = params.get(f.name) || "";
      if (f.kind === "text") {
        return '<label' + (f.wide ? ' class="sf-search-wide"' : "") + '><span>' + esc(f.label) + '</span><input name="' + esc(f.name) + '" value="' + esc(value) +
          '" placeholder="' + esc(f.placeholder || "") + '"' + (f.wide ? ' type="search" maxlength="120"' : "") + '></label>';
      }
      var opts = f.options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (value === o[0] ? " selected" : "") + '>' + esc(o[1]) + '</option>';
      }).join("");
      return '<label><span>' + esc(f.label) + '</span><select name="' + esc(f.name) + '">' + opts + '</select></label>';
    }).join("");
    var advancedCount = ["state", "property_type", "offer_type"].filter(function (name) { return !!params.get(name); }).length;
    return '<form class="sf-search-form' + (compact ? " compact" : "") + '" data-sf-search>' + body +
      '<button type="submit">Search properties</button>' +
      '<details class="sf-search-more" data-sf-more-filters hidden><summary>More filters' +
      (advancedCount ? ' <span class="sf-search-more-count">(' + advancedCount + ' applied)</span>' : "") +
      '</summary><div class="sf-search-more-fields"></div></details></form>';
  }

  // Move the existing labelled controls, rather than duplicating them or
  // disabling closed fields. FormData therefore retains every filter even when
  // the disclosure is closed. Desktop markup/order stays as before.
  function syncSearchFilters() {
    var narrow = !!(window.matchMedia && window.matchMedia("(max-width: 600px)").matches);
    document.querySelectorAll("[data-sf-search]").forEach(function (form) {
      var more = form.querySelector("[data-sf-more-filters]");
      if (!more || form._sfFilterNarrow === narrow) return;
      var focused = document.activeElement;
      var advanced = ["state", "property_type", "offer_type"].map(function (name) { return form.querySelector('[name="' + name + '"]'); }).filter(Boolean);
      if (narrow) {
        var fields = more.querySelector(".sf-search-more-fields");
        advanced.forEach(function (control) { fields.appendChild(control.closest("label")); });
        more.hidden = false;
        more.open = advanced.some(function (control) { return !!control.value || control === focused; });
      } else {
        var budget = form.querySelector('[name="max_price"]').closest("label");
        advanced.forEach(function (control) { form.insertBefore(control.closest("label"), budget); });
        more.hidden = true;
        if (focused && more.contains(focused) && advanced.length) focused = advanced[0];
      }
      form._sfFilterNarrow = narrow;
      if (focused && form.contains(focused) && focused !== document.activeElement && focused.getClientRects().length) focused.focus({ preventScroll: true });
    });
  }

  /* Removable chips for whatever is currently narrowing the results. Rendered
     from the same FILTERS list, so a filter can never be applied without a way
     to see and undo it. */
  function activeFilterChips(params) {
    var active = activeFilters(params);
    if (!active.length) return "";
    return '<div class="sf-active-filters"><span class="sf-active-filters-label">Filtered by</span>' +
      active.map(function (f) {
        return '<a class="sf-chip" href="' + esc(clearLink([f.def.name])) + '" data-sf-clear-filter="' + esc(f.def.name) + '"' +
          ' aria-label="Remove filter ' + esc(f.def.label) + ': ' + esc(filterSummary(f)) + '">' + esc(f.def.label) + ': ' + esc(filterSummary(f)) +
          '<b aria-hidden="true">&times;</b></a>';
      }).join("") +
      '<a class="sf-chip-clear" href="' + esc(clearLink(active.map(function (f) { return f.def.name; }))) + '">Clear all</a>' +
      '</div>';
  }


  /* 0905 307 9119 -> +639053079119 so the link dials from abroad too */
  function telHref(phone) {
    var d = String(phone || "").replace(/[^\d+]/g, "");
    return /^0\d{10}$/.test(d) ? "+63" + d.slice(1) : d;
  }

  function contactDetails() {
    var out = [];
    if (siteContact.phone) {
      out.push('<a href="tel:' + encodeURIComponent(telHref(siteContact.phone)) + '">' + esc(siteContact.phone) + '</a>');
    }
    if (siteContact.email) {
      out.push('<a href="mailto:' + encodeURIComponent(siteContact.email) + '">' + esc(siteContact.email) + '</a>');
    }
    if (siteContact.address) out.push('<span>' + esc(siteContact.address) + '</span>');
    if (siteContact.hours) out.push('<span>' + esc(siteContact.hours) + '</span>');
    return out.join("");
  }

  /* Rendered from the same SERVICES array as the nav dropdown, so the two can
   * never disagree about what services exist or where they lead. */
  /* Rental application (roadmap I10): on a listing for rent, the inquiry can carry the details an
   * agent asks first. All optional; nothing is uploaded (IDs and payslips are shown at the
   * viewing). The listing function keeps them with the inquiry and the lead. */
  /* Trust details on a listing page (roadmap H9), from the listing function: exclusive authority,
   * documents seen, and the agent's PRC number (shown in advertising under RA 9646). */
  function trustBadges(listing) {
    var d = listing.details || {};
    var badges = [];
    if (d.exclusive) badges.push('<span class="sf-trust-badge">Exclusive with SEA ESTATES</span>');
    if (d.docs_checked) badges.push('<span class="sf-trust-badge">Title and tax declaration seen by the agent</span>');
    var agent = listing.agent_name ? 'Listed by ' + esc(listing.agent_name) + (d.agent_prc ? ', PRC no. ' + esc(d.agent_prc) : '') : (d.agent_prc ? 'PRC no. ' + esc(d.agent_prc) : '');
    if (!badges.length && !agent) return '';
    return '<section class="sf-trust" data-sf-trust>' + (badges.length ? '<div class="sf-trust-badges">' + badges.join('') + '</div>' : '') + (agent ? '<p class="sf-trust-agent">' + agent + '</p>' : '') + '</section>';
  }

  function rentApplicationFields() {
    return '<details class="sf-apply" data-sf-apply><summary>Applying to rent? Add your details (optional)</summary>' +
      '<label>Move-in date<input type="date" name="move_in"></label>' +
      '<label>People who will live here<input type="number" name="occupants" min="1" max="20" inputmode="numeric"></label>' +
      '<label>Work or business<input name="employment" maxlength="120" placeholder="e.g. Nurse at Lipa Medix, or own sari-sari store"></label>' +
      '<label>Monthly household income<select name="income"><option value="">Prefer not to say</option><option>Below 20,000</option><option>20,000 to 39,999</option><option>40,000 to 79,999</option><option>80,000 to 149,999</option><option>150,000 or more</option></select></label>' +
      '<label>Lease length wanted<select name="lease_months"><option value="">Not sure yet</option><option value="6">6 months</option><option value="12">1 year</option><option value="24">2 years or more</option></select></label>' +
      '<label>Pets<select name="pets"><option value="">None</option><option value="cat">Cat</option><option value="dog">Dog</option><option value="other">Other</option></select></label>' +
      '</details>';
  }

  function servicesSection() {
    return '<section class="sf-section sf-services" id="sf-services"><div class="sf-section-head sf-reveal"><div>' +
      '<p class="sf-eyebrow">HOW WE CAN HELP</p><h2 class="sf-blur"><span>Help</span> <span>with</span> <span>your</span> <span>next</span> <span>property</span> <span>move.</span></h2></div>' +
      '<p>Buying, selling, renting or managing a property? Choose the support you need.</p></div>' +
      /* The three most asked-for services show (one row); the rest open on request, so the
         section stays short on a phone. */
      '<div class="sf-services-grid">' + SERVICES.slice(0, 3).map(serviceCard).join("") + '</div>' +
      '<details class="sf-services-more"><summary>See all ' + SERVICES.length + ' services</summary>' +
      '<div class="sf-services-grid">' + SERVICES.slice(3).map(function (item, i) { return serviceCard(item, i + 3); }).join("") + '</div></details>' +
      '<p class="sf-services-tour"><a class="sf-outline-btn" href="' + esc(SERVICES_TOUR.href) + '">Open the full services page</a></p></section>';
  }

  function serviceCard(item, i) {
    return '<a class="sf-service-card" href="' + esc(item.href) + '">' +
      '<span class="sf-service-ico">' + (SERVICE_ICONS[i] || "") + '</span>' +
      '<span class="sf-service-num">' + (i < 9 ? "0" : "") + (i + 1) + '</span>' +
      '<h3>' + esc(item.label) + '</h3><p>' + esc(item.note) + '</p></a>';
  }

  /* Obvious placeholder rows - a bare number like "321321", or "sample3" - are
     seed/test data, not inventory. One definition, used by every public view, so
     the homepage and the browse list cannot disagree about what exists.
     The data should be cleaned up in the admin; until then the public site
     refuses to show a card whose title is just a number. */
  function isPlaceholderListing(listing) {
    var t = String((listing && listing.title) || "").trim();
    if (!t) return true;
    if (/^\d+$/.test(t)) return true;
    if (/^sample\d*$/i.test(t)) return true;
    return false;
  }

  function publicListings(result) {
    return ((result && result.data) || []).filter(function (l) { return !isPlaceholderListing(l); });
  }

  /* The homepage already requested featured listings ("featured=true&per_page=6")
   * on every load, but home() never rendered them - the response was fetched
   * and thrown away, leaving a property site with no properties on its front
   * page. This renders that payload instead of adding another request. */
  function featuredSection() {
    var live = publicListings(viewState.result);
    if (!live.length && !viewState.loading) return "";

    var body = viewState.loading
      ? skeletons(3)
      : '<div class="sf-property-grid sf-featured-grid">' + live.slice(0, 6).map(card).join("") + '</div>';

    return '<section class="sf-section sf-featured" id="sf-featured"><div class="sf-section-head sf-reveal"><div>' +
      '<p class="sf-eyebrow">PROPERTIES</p><h2 class="sf-blur"><span>Explore</span> <span>available</span> <span>properties.</span></h2></div>' +
      '<p>Compare locations and asking prices. Our team can confirm the details before you decide.</p></div>' + body +
      '<div class="sf-featured-more"><a class="sf-outline-btn" href="#/search">See all properties</a></div></section>';
  }

  /* Home hero: one job - get the visitor to try the value guide.
   * Copy (eyebrow, question, one-line promise) and a quick-estimate card that
   * shows a town-wide starting figure the moment a town is chosen; its "Start
   * My Value Guide" button carries the answers into the full calculator below.
   * Live counts from the data files back the promise. Browsing is a quiet
   * text link, so the hero has one primary action. On wide screens the copy
   * and proof sit left of the card; on phones the card follows the headline. */
  function homeHero() {
    var EST = typeof window.ESREALTY_EST === "object" ? window.ESREALTY_EST : null;
    var calculator = typeof window.ESREALTY_GUIDE_UI === "object" && window.ESREALTY_GUIDE_UI.publicMarkup
      ? window.ESREALTY_GUIDE_UI.publicMarkup()
      : (EST && EST.cardSection ? EST.cardSection() : '<section class="sf-section sf-est" id="sf-estimator" data-est-root><div class="sf-est-card" data-est-card><p class="sf-est-empty">Loading the value guide…</p></div></section>');
    var quick = EST && EST.quickMarkup
      ? EST.quickMarkup()
      : '<div class="sf-hero-actions sf-est-hero-actions"><a class="sf-hero-btn" href="#sf-estimator" data-est-services>Start My Value Guide</a></div>';
    var stats = EST && EST.quickStatsHtml ? EST.quickStatsHtml() : '<li><b>Free</b><span>planning guide</span></li><li><b>No account</b><span>needed to start</span></li><li><b>BIR</b><span>reference shown separately</span></li>';
    return '<section class="sf-est-hero" id="sf-intro"><div class="sf-est-hero-grid">' +
      '<div class="sf-est-hero-copy sf-reveal">' +
      '<p class="sf-eyebrow">BATANGAS VALUE GUIDE</p>' +
      '<h1>What could your <em>property be worth?</em></h1>' +
      '<p class="sf-est-hero-lede">Pick your town for an instant starting figure. The free full guide adds your street’s BIR zonal value, a planning range and nearby bank listings.</p>' +
      '</div>' +
      quick +
      '<div class="sf-est-hero-proof">' +
      '<ul class="sf-est-proof" aria-label="What the guide is built on">' + stats + '</ul>' +
      '<p class="sf-est-hero-bir-note">Current guide coverage: Batangas. SEA ESTATES is independent of the BIR.<span class="sf-home-disclaimer">A planning guide, not a certified appraisal.</span></p>' +
      '<p class="sf-est-hero-browse">Looking to buy instead? <a href="#/search">Browse properties →</a></p>' +
      '</div>' +
      '</div>' + calculator + '</section>';
  }

  /* What the visitor gets, shown rather than listed: an example report built
   * by the same estimator (filled in by js/estimator.js once the data loads),
   * beside the three parts of every guide. Replaces the old three-card summary
   * and the separate "How it works" steps, which said the same thing twice. */
  function guideSummarySection() {
    var points = [
      ["BIR tax reference", "The published zonal rate for your street and classification, shown separately from the estimate."],
      ["Planning estimate", "A central figure with a likely range and the land and house split. Bank listings are context, never inputs."],
      ["A practical next step", "Ask our team a question, compare nearby listings or request a formal appraisal."]
    ];
    var sample =
      '<figure class="sf-guide-sample sf-reveal" aria-labelledby="sf-sample-cap">' +
      '<div class="sf-sample-card" aria-hidden="true">' +
      '<div class="sf-sample-top"><span class="sf-sample-tag">Example report</span><span class="sf-sample-for" data-sample="for">150 sqm house &amp; lot · Lipa City</span></div>' +
      '<span class="sf-sample-label">Estimated property value</span>' +
      '<strong class="sf-sample-value" data-sample="value">₱ —</strong>' +
      '<div class="sf-quick-range"><span data-sample="pos" style="left:30%"></span></div>' +
      '<div class="sf-sample-range"><span data-sample="low">—</span><span>Planning range</span><span data-sample="high">—</span></div>' +
      '<div class="sf-sample-split"><div><span>Land</span><b data-sample="land">—</b></div><div><span>House</span><b data-sample="house">—</b></div></div>' +
      '<div class="sf-sample-rows">' +
      '<div><span>BIR zonal reference</span><b data-sample="bir">—</b></div>' +
      '<div><span>Bank &amp; Pag-IBIG listings in town</span><b data-sample="listings">—</b></div>' +
      '</div></div>' +
      '<figcaption id="sf-sample-cap">Example only, for a 150 sqm house and lot in Lipa City using the town-wide BIR reference. Your street and house change the figures.</figcaption>' +
      '</figure>';
    return '<section class="sf-section sf-guide-summary" id="sf-guide-summary"><div class="sf-guide-split">' +
      '<div class="sf-guide-copy sf-reveal">' +
      '<p class="sf-eyebrow">YOUR VALUE GUIDE</p><h2>What your guide includes.</h2>' +
      '<p class="sf-guide-lede">One clear page, every number explained. Three short steps: location, house details, report.</p>' +
      '</div>' +
      sample +
      '<div class="sf-guide-body sf-reveal">' +
      '<ul class="sf-guide-points">' + points.map(function (p, i) {
        return '<li><span class="sf-gsum-ico" aria-hidden="true">' + GSUM_ICONS[i] + '</span><div><h3>' + p[0] + '</h3><p>' + p[1] + '</p></div></li>';
      }).join("") + '</ul>' +
      '<div class="sf-guide-cta"><a class="sf-hero-btn" href="#sf-estimator" data-est-services>Start My Value Guide</a><span>Free · about 2 minutes</span></div>' +
      '</div>' +
      '</div></section>';
  }

  function home() {
    return shell(
      homeHero() +
      guideSummarySection() +
      featuredSection() +
      servicesSection() +

      /* A short closing band instead of a second long form: the full request
         form lives on the Talk to our team page. */
      '<section class="sf-cta sf-cta-short" id="sf-contact"><div class="sf-cta-band"><div><h2>Questions? Talk to our team.</h2><p>Buying, selling, renting or reviewing a property? Send the location and your plans, and a specialist replies within one business day.</p><div class="sf-contact-details">' + contactDetails() + '</div></div>' +
      '<a class="sf-hero-btn sf-cta-go" href="#/property-value?go=form">Message our team</a></div></section>'
    );
  }


  /* Distinguishes the two very different empty cases. Telling someone "no
   * properties found, try changing your filters" when they never set a filter
   * and the inventory is simply empty is both wrong and unactionable. */
  function emptyResults(params) {
    var active = activeFilters(params);
    if (active.length) {
      var chips = active.map(function (f) { return filterSummary(f); }).join(", ");
      return '<div class="sf-empty"><div class="sf-empty-ico"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/></svg></div><h3>No properties match these filters</h3>' +
        '<p>Nothing matches ' + esc(chips) + ' right now. Clear the filters to see everything we publish.</p>' +
        '<a class="sf-outline-btn" href="' + esc(clearLink(active.map(function (f) { return f.def.name; }))) + '">Clear all filters</a></div>';
    }
    return '<div class="sf-empty"><div class="sf-empty-ico"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/></svg></div><h3>No properties published yet</h3>' +
      '<p>There are no live listings on the site at the moment. Tell us what you are looking for and we will come back to you, or check your own property with the free Value Guide.</p>' +
      '<div class="sf-empty-actions"><a class="sf-primary-btn" href="#/property-value?service=broker&go=form">Tell us what you need</a>' +
      '<a class="sf-outline-btn" href="#/home" data-est-services>Start my Value Guide</a></div></div>';
  }

  function searchPage(params) {
    var result = viewState.result || { data: [], total: 0, page: 1, total_pages: 0 };
    /* Same placeholder filter as the homepage, so the two never disagree. */
    var rows = publicListings(result);
    var total = rows.length === (result.data || []).length
      ? Number(result.total || 0)
      : rows.length;
    var cards = viewState.loading ? skeletons(6)
      : rows.length ? rows.map(card).join("")
      : emptyResults(params);
    var page = Number(result.page || 1), pages = Number(result.total_pages || 0);
    var nothingListed = !viewState.loading && !rows.length && !activeFilters(params).length && !compareIds.length;
    var pager = pages > 1 ? '<div class="sf-pager"><button data-sf-page="' + (page - 1) + '"' + (page <= 1 ? " disabled" : "") + '>Previous</button><span>Page ' + page + ' of ' + pages + '</span><button data-sf-page="' + (page + 1) + '"' + (page >= pages ? " disabled" : "") + '>Next</button></div>' : "";
     return shell('<section class="sf-search-page"><div class="sf-search-intro"><p class="sf-eyebrow">PROPERTY SEARCH</p><h1>Find a property that fits.</h1><p>Browse the properties SEA ESTATES has listed for sale or rent. The free Value Guide covers Batangas province.</p></div>' +
      '<div class="sf-filter-stick">' + searchFields(params, true) + '</div>' + activeFilterChips(params) +
      /* With nothing listed, compare, sort and view switches have nothing to act
         on: the empty state alone explains the page. */
      (nothingListed ? '' : compareTray()) + '<p class="sf-compare-status" role="status" aria-live="polite" data-sf-compare-status>' + esc(compareMessage) + '</p>' +
      (nothingListed ? '' : '<div class="sf-results-bar"><p><b>' + esc(total) + '</b> ' + (Number(total) === 1 ? "property" : "properties") + '</p>' +
      '<div><label class="sf-visually-hidden" for="sf-sort">Sort properties</label><select id="sf-sort" data-sf-sort><option value="date_desc"' + (params.get("sort") === "date_desc" || !params.get("sort") ? " selected" : "") + '>Newest</option><option value="price_asc"' + (params.get("sort") === "price_asc" ? " selected" : "") + '>Price: Low to high</option><option value="price_desc"' + (params.get("sort") === "price_desc" ? " selected" : "") + '>Price: High to low</option></select>' +
      '<button data-sf-mode="grid" aria-pressed="' + (viewState.mode === "grid") + '" class="' + (viewState.mode === "grid" ? "active" : "") + '">Grid</button><button data-sf-mode="list" aria-pressed="' + (viewState.mode === "list") + '" class="' + (viewState.mode === "list" ? "active" : "") + '">List</button><button data-sf-mode="map" aria-pressed="' + (viewState.mode === "map") + '" class="' + (viewState.mode === "map" ? "active" : "") + '">Map</button></div></div>') +
      (viewState.mode === "map"
        ? '<div class="sf-map-wrap"><div id="sf-map"></div><p class="sf-map-hint" id="sf-map-hint">Loading map…</p></div>'
        : '<div class="sf-property-grid ' + (viewState.mode === "list" ? "list" : "") + '">' + cards + '</div>') + pager + '</section>');
  }
  var sfMapRef = null;
  window.__sfGo = function (id) { go("listing/" + encodeURIComponent(id)); };
  function sfPriceShort(v) {
    var n = Number(v || 0);
    if (!n) return "";
    if (n >= 1000000) return "₱" + (n / 1000000).toFixed(n % 1000000 ? 2 : 0) + "M";
    if (n >= 1000) return "₱" + Math.round(n / 1000) + "K";
    return "₱" + n;
  }
  function sfInitMap() {
    var n = 0;
    (function findEl() {
      var el = document.getElementById("sf-map");
      if (!el) { if (++n > 50) return; setTimeout(findEl, 100); return; }
      window.ESREALTY_LEAFLET.ensure().then(function () {
        var m = 0;
        (function waitL() {
          if (!window.L) { if (++m > 30) return; setTimeout(waitL, 150); return; }
          sfBuildMap();
        })();
      });
    })();
  }
  function sfBuildMap() {
    {
      var el = document.getElementById("sf-map");
      if (!el || !window.L) return;
      var L = window.L;
      if (sfMapRef) { try { sfMapRef.remove(); } catch (e) {} sfMapRef = null; }
      sfMapRef = L.map(el, { scrollWheelZoom: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors" }).addTo(sfMapRef);
      var items = (viewState.result && viewState.result.data) || [];
      var pts = [];
      items.forEach(function (l) {
        var la = Number(l.latitude), ln = Number(l.longitude);
        if (!isFinite(la) || !isFinite(ln) || (!la && !ln)) return;
        pts.push([la, ln]);
        var pin = document.createElement("span");
        pin.className = "sf-price-pin";
        pin.textContent = sfPriceShort(l.offer_type === "rent" ? l.rent : l.price);
        var icon = L.divIcon({ className: "", html: pin, iconSize: null });
        var mk = L.marker([la, ln], { icon: icon }).addTo(sfMapRef);
        mk.bindPopup(sfPopupHtml(l));
      });
      var hint = document.getElementById("sf-map-hint");
      if (hint) { var missing = items.length - pts.length; hint.textContent = pts.length + " mapped on map" + (missing ? " · " + missing + " listing" + (missing === 1 ? "" : "s") + " without location yet" : ""); }
      if (pts.length) sfMapRef.fitBounds(pts, { padding: [30, 30] }); else sfMapRef.setView([12.8797, 121.774], 5);
    }
  }
  function sfPopupHtml(l) {
    var price = sfPriceShort(l.offer_type === "rent" ? l.rent : l.price);
    return '<div style="min-width:180px"><b>' + esc(l.title || "Property") + '</b><br>' + esc(price)
      + (l.city ? ' · ' + esc(l.city) : '')
       + '<br><a class="btn btn-primary btn-sm" style="margin-top:6px;display:inline-block" href="#/listing/' + encodeURIComponent(l.id) + '">View details</a>' + compareButton(l) + '</div>';
  }
  function detailPage(listing) {
    if (viewState.loading) return shell('<section class="sf-detail"><div class="sf-detail-loading">Loading property…</div></section>');
    if (!listing) return shell('<section class="sf-detail">' + empty(viewState.error || "This listing is unavailable.") + '</section>');
    var images = Array.isArray(listing.images) ? listing.images.map(function (item) { return safeImage(item.url || item); }).filter(Boolean) : [];
    var gallery = detailGallery(listing, images);
    try { var ldEl = document.getElementById("sf-jsonld"); if (ldEl) ldEl.remove();
      var ld = document.createElement("script"); ld.type = "application/ld+json"; ld.id = "sf-jsonld";
      ld.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "RealEstateListing", name: listing.title, description: (listing.description || "").slice(0, 300), image: images.filter(function (x) { return /^https:/.test(x); }).slice(0, 5), address: { "@type": "PostalAddress", addressLocality: listing.city, addressRegion: listing.province, addressCountry: "PH" }, offers: { "@type": "Offer", priceCurrency: "PHP", price: Number(listing.price || 0), availability: "https://schema.org/InStock" } });
      document.head.appendChild(ld);
    } catch (ldErr) {}
    return shell('<section class="sf-detail"><button class="sf-back" data-sf-back>← Back to properties</button>' + compareTray() + '<p role="status" aria-live="polite" data-sf-compare-status></p>' + compareButton(listing) + gallery +
      '<div class="sf-detail-layout"><article class="sf-detail-copy"><p class="sf-eyebrow">' + esc(typeLabel(listing.property_type)) + ' · ' + esc(listing.offer_type === "rent" ? "FOR RENT" : "FOR SALE") + '</p>' +
      '<h1>' + esc(listing.title) + '</h1><p class="sf-detail-location">' + esc(locationText(listing)) + '</p><div class="sf-key-stats">' + propertyFacts(listing, true) + '</div>' +
      '<section><h2>About this property</h2><p class="sf-description">' + esc(listing.description || "Contact the listing agent for complete property information.") + '</p></section>' +
      trustBadges(listing) +
      (listing.details && listing.details.license_to_sell ? '<section class="sf-dhsud"><span class="sf-badge">' + esc(listing.details.license_to_sell) + '</span> DHSUD License to Sell number for this property.</section>' : '') +
      '<section><h2>Location</h2><div class="sf-detail-map" id="sf-detail-map"><span>' + esc(locationText(listing)) + '</span></div></section></article>' +
      '<aside class="sf-contact-card"><p>Listed at</p><h2>' + esc(money(listing.display_price, listing.offer_type === "rent" ? "/mo" : "")) + '</h2>' +
      '<button class="sf-outline-btn" data-sf-save="' + esc(listing.id) + '">♡ Save this property</button><form novalidate data-sf-inquiry="' + esc(listing.id) + '"' + (listing.offer_type === "rent" ? ' data-sf-rent="1"' : "") + '><h3>Request more information</h3><label>Full name<input name="full_name" required maxlength="160"></label><label>Email<input type="email" name="email" maxlength="254"></label><label>Phone<input name="phone" required maxlength="50"></label>' +
        (listing.offer_type === "rent" ? rentApplicationFields() : "") +
        '<label>Message<textarea name="message" rows="4" maxlength="5000" placeholder="I would like to know more about this property."></textarea></label><label class="sf-consent"><input type="checkbox" name="consent" required><span>I consent to the processing of my contact details for this inquiry. See our <a href="#/privacy">Privacy Notice</a>.</span></label><button type="submit">Send inquiry</button><p class="sf-form-status" aria-live="polite"></p></form></aside></div></section>');
  }

  /* document.title was never set anywhere, so every route shipped the same
   * title and search engines could not tell the pages apart. */
  var PAGE_TITLES = {
    "": "SEA ESTATES | Properties & Batangas Value Guide",
    "home": "SEA ESTATES | Properties & Batangas Value Guide",
    "search": "Properties for sale and rent | SEA ESTATES",
    "compare": "Compare two properties | SEA ESTATES",
    "property-value": "Talk to our team | SEA ESTATES",
    "privacy": "Privacy Notice | SEA ESTATES",
    "project-bt": "Project B.T — Coming Soon | SEA ESTATES",
    "listing": "Property details | SEA ESTATES"
  };

  /* Services no longer point at the homepage services section: they are real
     links into the Get My Property Value funnel. The helper stays for the
     #/home?section=... deep links the homepage still uses. */
  function scrollToSection(name) {
    if (!name) return false;
    var target = document.getElementById("sf-" + name) || document.getElementById(name);
    if (!target) return false;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }

  /* A single scrollIntoView is not enough for a deep link into the homepage.
   * The value guide card expands asynchronously and the featured grid fills in
   * after the first paint, both of which push the target further down the page.
   * Scrolling once landed ~1000px short. Re-run until the target is actually in
   * view, or we run out of attempts. */
  function scrollToSectionWhenSettled(name, attemptsLeft) {
    if (!name) return;
    var target = document.getElementById("sf-" + name) || document.getElementById(name);
    if (!target) return;
    target.scrollIntoView({ behavior: "auto", block: "start" });
    var box = target.getBoundingClientRect();
    var inView = box.top >= -8 && box.top < window.innerHeight;
    if (inView || attemptsLeft <= 0) return;
    setTimeout(function () { scrollToSectionWhenSettled(name, attemptsLeft - 1); }, 180);
  }

  function setTitle(path, params) {
    try {
      var key = path.indexOf("listing/") === 0 ? "listing" : path;
      var next = PAGE_TITLES[key] || PAGE_TITLES.home;
      if (key === "property-value") {
        var service = String((params && params.get("service")) || "").toLowerCase();
        if (PV_SERVICES[service] && PV_SERVICES[service].title) next = PV_SERVICES[service].title;
      }
      if (document.title !== next) document.title = next;
    } catch (e) { /* noop */ }
  }

  function patchFeatured() {
    if (!host || !host.querySelector(".sf-est-hero")) return false;
    var old = host.querySelector("#sf-featured");
    var html = featuredSection();
    if (old) {
      if (html) old.outerHTML = html; else old.remove();
    } else if (html) {
      var after = host.querySelector(".sf-guide-summary");
      if (!after) return false;
      after.insertAdjacentHTML("afterend", html);
    }
    bindHomeMotion();
    return true;
  }

  function renderCurrent() {
    if (!active || !host) return;
    /* The header (and its menu) is rebuilt below, closed; never leave the page
       scroll-locked by a menu that no longer exists. */
    document.body.classList.remove("sf-menu-open");
    var current = route();
    /* Shophouse and Project B.T are temporarily closed and are presented as a
     * single destination. Keep #/shophouse resolvable so existing inbound links
     * and bookmarks land on the coming-soon page instead of a 404 or a stale
     * page, but never render the shophouse marketing content again. */
    if (current.path === "shophouse") { go("project-bt"); return; }
    if (current.path === "privacy") host.innerHTML = privacyPage();
    else if (current.path === "project-bt") host.innerHTML = comingSoonPage();
    else if (current.path === "property-value") host.innerHTML = propertyValuePage(current.params);
    else if (current.path.indexOf("listing/") === 0) host.innerHTML = detailPage(viewState.result && viewState.result.data);
    else if (current.path === "search") host.innerHTML = searchPage(current.params);
    else if (current.path === "compare") host.innerHTML = comparisonPage();
    else host.innerHTML = home();
    setTitle(current.path, current.params);
    syncSearchFilters();
    if (current.path === "search") {
      compareReturn = location.hash;
      try { sessionStorage.setItem("esrealty_compare_return_v1", compareReturn); } catch (e) {}
    }
    if (current.path === "compare" && !viewState.loading && !compareFocused) {
      var comparisonHeading = host.querySelector("[data-sf-compare-heading]");
      if (comparisonHeading) comparisonHeading.focus({ preventScroll: true });
      compareFocused = true;
    } else if (current.path !== "compare") compareFocused = false;
    /* Listing schema belongs to the detail page only. It used to be injected on
     * every detail view and only removed by the NEXT detail view, so leaving a
     * property page for home/search/shophouse left the previous listing's
     * RealEstateListing JSON-LD sitting in <head>. */
    if (current.path.indexOf("listing/") !== 0) {
      var ld = document.getElementById("sf-jsonld");
      if (ld) ld.remove();
    }
    mountMap();
    try { if (typeof window.ESREALTY_EST === "object" && window.ESREALTY_EST.mount) window.ESREALTY_EST.mount(); } catch (e) {}
    if (current.path === "search" && viewState.mode === "map") setTimeout(sfInitMap, 60);
    bindHomeMotion();
    bindPvSteps();
    bindPvExplorer();
    /* "Message our team" and the other contact links (?go=form) land on the
     * request form itself, not on the page's introduction above it. */
    if (current.path === "property-value" && current.params.get("go") === "form") {
      setTimeout(function () { scrollToSectionWhenSettled("pv-form", 8); }, 60);
      setTimeout(function () {
        var nameField = document.querySelector("#sf-pv-form input[name='name']");
        // Keyboard-and-mouse screens get the cursor in the first box; phones
        // just see the form, without the keyboard jumping up uninvited.
        if (nameField && window.matchMedia && window.matchMedia("(pointer: fine)").matches) { try { nameField.focus({ preventScroll: true }); } catch (e) {} }
      }, 450);
    }
    if (current.path === "home" || current.path === "") {
      /* #/home?section=services needs a second pass: the target does not exist
       * until home() has been written into the host above. */
      var section = current.params.get("section");
      if (section) {
        var target = section === "services" ? "services" : section;
        setTimeout(function () {
          if (!scrollToSection(target)) scrollToSection("process");
        }, 90);
        setTimeout(function () { scrollToSectionWhenSettled(target, 12); }, 140);
      }
    }
  }

  function loadCurrent(force) {
    if (!API) {
      viewState = { loading: false, error: "The property service is not available.", result: null, mode: viewState.mode };
      renderCurrent();
      return;
    }
    var current = route();
    var key = current.path + "?" + current.params.toString();
    if (!force && key === cacheKey) { renderCurrent(); return; }
    cacheKey = key;
    if (current.path === "compare") {
      var comparisonRequest = ++requestId;
      compareErrors = Object.create(null);
      viewState.loading = compareIds.length === 2; renderCurrent();
      if (!viewState.loading) return;
      Promise.all(compareIds.map(function (selectedId) {
        return API.get(selectedId).then(function (result) {
          if (comparisonRequest !== requestId) return;
          if (!result.data || isPlaceholderListing(result.data)) { delete compareRecords[selectedId]; compareErrors[selectedId] = "A selected listing is unavailable."; }
          else compareRecords[selectedId] = result.data;
        }).catch(function (error) { if (comparisonRequest === requestId) compareErrors[selectedId] = error.message || "Connection failed. Please retry."; });
      })).then(function () { if (comparisonRequest === requestId) { viewState.loading = false; renderCurrent(); } });
      return;
    }
    /* Static marketing routes. They must not issue a listings request, or the
     * loading skeleton would flash on a page that has nothing to load. */
    if (current.path === "project-bt" || current.path === "property-value" || current.path === "privacy") {
      viewState.loading = false; viewState.error = ""; viewState.result = null; renderCurrent(); return;
    }
    var id = ++requestId;
    viewState.loading = true; viewState.error = ""; viewState.result = null;
    renderCurrent();
    var pending;
    if (current.path.indexOf("listing/") === 0) pending = API.get(current.path.slice(8));
    else if (current.path === "search") {
      var filters = {};
      current.params.forEach(function (value, name) { filters[name] = value; });
      filters.per_page = filters.per_page || 12;
      pending = API.list(filters);
    } else pending = API.list({ featured: true, per_page: 6, sort: "date_desc" });
    pending.then(function (result) {
      if (id !== requestId) return;
      viewState.loading = false; viewState.result = result;
      /* Home: swap only the listings block. Re-rendering the whole page made
         the hero animate in a second time, dropped focus from the calculator
         and moved the page under the visitor's finger. */
      if ((current.path === "home" || current.path === "") && patchFeatured()) return;
      renderCurrent();
    }).catch(function (error) {
      if (id !== requestId) return;
      viewState.loading = false; viewState.error = error.message || "Could not load properties."; viewState.result = null; renderCurrent();
    });
  }

  var _detailMap = null;

  function destroyDetailMap() {
    if (!_detailMap) return;
    try { _detailMap.remove(); } catch (e) {}
    _detailMap = null;
  }

  function mountMap() {
    destroyDetailMap();
    var listing = viewState.result && viewState.result.data;
    var element = document.getElementById("sf-detail-map");
    if (!element || !listing || listing.latitude == null || listing.longitude == null) return;
    if (!window.L) { window.ESREALTY_LEAFLET.ensure().then(function () { mountMap(); }); return; }
    element.innerHTML = "";
    var map = L.map(element, { scrollWheelZoom: false }).setView([Number(listing.latitude), Number(listing.longitude)], 15);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors" }).addTo(map);
    L.marker([Number(listing.latitude), Number(listing.longitude)], { icon: L.divIcon({ className: "es-pin-icon", html: '<svg width="38" height="48" viewBox="0 0 38 48" aria-hidden="true" focusable="false"><path d="M19 1.5C10.9 1.5 4.3 8.1 4.3 16.2 4.3 27 19 46.5 19 46.5s14.7-19.5 14.7-30.3C33.7 8.1 27.1 1.5 19 1.5z" fill="var(--accent, #F97316)"/><path d="M19 5C12.7 5 7.6 10.1 7.6 16.4c0 8.8 11.4 25.8 11.4 25.8s11.4-17 11.4-25.8C30.4 10.1 25.3 5 19 5z" fill="rgba(255,255,255,0.28)"/><circle cx="19" cy="16.5" r="7.2" fill="#fff"/><circle cx="19" cy="16.5" r="3.8" fill="var(--accent, #F97316)"/></svg>', iconSize: [38, 48], iconAnchor: [19, 47], popupAnchor: [0, -42] })}).addTo(map);
    _detailMap = map;
  }

  function closeDrops(except) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-sf-drop]"), function (drop) {
      if (drop !== except && drop.open) drop.open = false;
    });
  }

  /* Opening the mobile panel previously did nothing beyond toggling a class: the
   * page behind stayed scrollable, any accordion the user had expanded stayed
   * expanded on reopen, and the sticky CTA bar sat on top of the bottom rows.
   * All three are handled here so the panel behaves like an overlay. */
  function toggleMenu(open) {
    var btn = document.querySelector("[data-sf-menu]");
    var panel = document.querySelector("[data-sf-menu-panel]");
    if (!btn || !panel) return;
    var isOpen = typeof open === "boolean" ? open : btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    btn.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
    panel.classList.toggle("open", isOpen);
    document.body.classList.toggle("sf-menu-open", isOpen);
    if (!isOpen) {
      /* Collapse accordions so the panel always reopens in a known state. */
      Array.prototype.forEach.call(panel.querySelectorAll("details[data-sf-drop]"), function (d) { d.open = false; });
    }
  }

  var _homeMotionObs = null;

  function bindHomeMotion() {
    if (_homeMotionObs) { _homeMotionObs.disconnect(); _homeMotionObs = null; }
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var reveals = document.querySelectorAll(".sf-reveal");
    if (reduced) {
      reveals.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    if (!reveals.length) return;
    _homeMotionObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        _homeMotionObs.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    reveals.forEach(function (el) { _homeMotionObs.observe(el); });
  }


  function bind() {
    if (document.documentElement.getAttribute("data-storefront-bound") === "true") return;
    document.documentElement.setAttribute("data-storefront-bound", "true");
    if (window.matchMedia) {
      var filterMedia = window.matchMedia("(max-width: 600px)");
      var updateFilters = function () { if (active) syncSearchFilters(); };
      if (filterMedia.addEventListener) filterMedia.addEventListener("change", updateFilters);
      else if (filterMedia.addListener) filterMedia.addListener(updateFilters);
    }
    lastPageKey = pageKey(route());
    window.addEventListener("hashchange", function () { if (active) { toggleMenu(false); closeDrops(null); scrollTopOnNewPage(); loadCurrent(); } });
    /* Dropdown hygiene: only one panel open at a time, close on outside click,
     * and close on Escape. <details> gives us keyboard opening for free but no
     * dismissal behaviour, so that part is ours.
     *
     * Clicks on links inside a panel are ignored here on purpose - they must
     * keep navigating normally, and the main handler below closes the panel. */
    document.addEventListener("click", function (event) {
      if (event.target.closest("[data-sf-drop] a, [data-sf-drop] button")) return;
      var drop = event.target.closest("[data-sf-drop]");
      if (drop) {
        closeDrops(drop);
        /* <details> flips on the default action, which runs after dispatch, so
         * drop.open still holds the pre-click value here. If it was open, cancel
         * the default flip and close it. */
        if (drop.open) { event.preventDefault(); drop.open = false; }
        return;
      }
      closeDrops(null);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      closeDrops(null);
      toggleMenu(false);
    });
    document.addEventListener("click", function (event) {
      if (!active) return;
      var menuState = document.querySelector("[data-sf-menu]");
      if (menuState && menuState.getAttribute("aria-expanded") === "true" && !event.target.closest("[data-sf-menu]") && !event.target.closest("[data-sf-menu-panel]")) toggleMenu(false);
      var menuBtn = event.target.closest("[data-sf-menu]");
      if (menuBtn) { toggleMenu(); return; }
      /* Close the panel on navigation, not on every click inside it. This used
       * to fire on any click within the panel, which meant tapping a Services
       * accordion header both expanded it and immediately closed the menu
       * containing it - the two services were unreachable on a phone. Only a
       * real destination (a link) or an action (a button) should dismiss it; a
       * <summary> is a disclosure control and must leave the panel open. */
      if (event.target.closest("[data-sf-menu-panel] a, [data-sf-menu-panel] button")) toggleMenu(false);
      /* Only one dropdown open at a time, and collapse any open dropdown when a
       * destination is chosen so the panel does not linger over the new page. */
      if (event.target.closest("[data-sf-drop] a")) closeDrops(null);
      var auth = event.target.closest("[data-sf-auth]");
      if (auth) { openAuth(auth.getAttribute("data-sf-auth")); return; }
      var scroll = event.target.closest("[data-sf-scroll]");
      if (scroll) {
        event.preventDefault();
        var scrollTarget = document.getElementById(scroll.getAttribute("data-sf-scroll").replace(/^#/, ""));
        if (scrollTarget) scrollTarget.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      var carPrev = event.target.closest("[data-sf-car-prev]");
      if (carPrev) { var carPrevRoot = carPrev.closest("[data-sf-carousel]"); if (carPrevRoot) setCarousel(carPrevRoot, Number(carPrevRoot.getAttribute("data-index") || 0) - 1); return; }
      var carNext = event.target.closest("[data-sf-car-next]");
      if (carNext) { var carNextRoot = carNext.closest("[data-sf-carousel]"); if (carNextRoot) setCarousel(carNextRoot, Number(carNextRoot.getAttribute("data-index") || 0) + 1); return; }
      var carDot = event.target.closest("[data-sf-car-dot]");
      if (carDot) { var carDotRoot = carDot.closest("[data-sf-carousel]"); if (carDotRoot) setCarousel(carDotRoot, Number(carDot.getAttribute("data-sf-car-dot"))); return; }
      var thumb = event.target.closest("[data-sf-thumb]");
      if (thumb) { var thumbGallery = thumb.closest(".sf-gallery"); var thumbRoot = thumbGallery && thumbGallery.querySelector("[data-sf-carousel]"); if (thumbRoot) setCarousel(thumbRoot, Number(thumb.getAttribute("data-sf-thumb"))); return; }
      var listing = event.target.closest("[data-sf-listing]");
      var comparison = event.target.closest("[data-sf-compare], [data-sf-compare-remove]");
      if (comparison) {
        event.preventDefault();
        var selectedId = comparison.getAttribute("data-sf-compare") || comparison.getAttribute("data-sf-compare-remove");
        var position = compareIds.indexOf(selectedId);
        if (position >= 0) { compareIds.splice(position, 1); updateCompare("Property removed. " + compareIds.length + " of 2 selected."); }
        else if (compareIds.length >= 2) updateCompare("You can compare 2 properties. Remove one before adding another.");
        else { compareIds.push(selectedId); updateCompare("Property added. " + compareIds.length + " of 2 selected."); }
        if (route().path === "compare") { ++requestId; viewState.loading = false; compareFocused = false; renderCurrent(); }
        else if (comparison.hasAttribute("data-sf-compare-remove")) { var compareAction = document.querySelector("[data-sf-compare-open]"); if (compareAction && !compareAction.disabled) compareAction.focus(); else { var replacement = document.querySelector("[data-sf-compare]"); if (replacement) replacement.focus(); } }
        return;
      }
      if (event.target.closest("[data-sf-compare-clear]")) {
        compareIds = []; updateCompare("Comparison cleared.");
        if (route().path === "compare") {
          ++requestId; viewState.loading = false; compareFocused = false; renderCurrent();
        } else {
          var firstCompare = document.querySelector("[data-sf-compare]") || document.querySelector('[data-sf-search] button[type="submit"]');
          if (firstCompare) firstCompare.focus({ preventScroll: true });
        }
        return;
      }
      if (event.target.closest("[data-sf-compare-open]") && compareIds.length === 2) { compareFocused = false; go("compare"); return; }
      if (event.target.closest("[data-sf-compare-retry]")) { loadCurrent(true); return; }
      if (listing) { go("listing/" + encodeURIComponent(listing.getAttribute("data-sf-listing"))); return; }
      var save = event.target.closest("[data-sf-save]");
      if (save) { sessionStorage.setItem("esrealty_post_auth_favorite", save.getAttribute("data-sf-save")); openAuth("signin"); return; }
      var back = event.target.closest("[data-sf-back]");
      if (back) { history.length > 1 ? history.back() : go("search"); return; }
      var mode = event.target.closest("[data-sf-mode]");
      if (mode) { viewState.mode = mode.getAttribute("data-sf-mode"); renderCurrent(); return; }
      var page = event.target.closest("[data-sf-page]");
      if (page && !page.disabled) { var r = route(); r.params.set("page", page.getAttribute("data-sf-page")); go("search?" + r.params.toString()); }
    });
    document.addEventListener("change", function (event) {
      if (!active || !event.target.matches("[data-sf-sort]")) return;
      var r = route(); r.params.set("sort", event.target.value); r.params.delete("page"); go("search?" + r.params.toString());
    });
    /* Plain-language errors under each field (2026-10-15) instead of the
       browser's pop-up, which is easy to miss and disappears. The forms carry
       novalidate so this runs; typed answers are kept. */
    var FIELD_MSG = {
      name: "Enter your name.", full_name: "Enter your name.",
      phone: "Enter your mobile number, for example 0917 123 4567.",
      email: "Enter your email, for example name@example.com.",
      consent: "Tick this box so our team can contact you.",
      message: "Tell us briefly what you need."
    };
    function checkFields(form) {
      Array.prototype.forEach.call(form.querySelectorAll(".sf-field-err"), function (el) { el.remove(); });
      var first = null;
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || !el.willValidate || el.type === "submit") return;
        el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby");
        var bad = !el.checkValidity();
        if (!bad && el.name === "phone" && el.value.trim()) bad = String(el.value).replace(/\D/g, "").length < 10;
        if (!bad) return;
        var msg = FIELD_MSG[el.name] || "Fill in this field.";
        if (el.name === "email" && el.value.trim()) msg = "That email does not look complete. Use the form name@example.com.";
        if (el.name === "phone" && el.value.trim()) msg = "That number looks too short. Use the form 0917 123 4567.";
        var err = document.createElement("span");
        err.className = "sf-field-err"; err.id = "sf-err-" + el.name + "-" + Math.random().toString(36).slice(2, 7); err.textContent = msg;
        (el.closest("label") || el.parentNode).appendChild(err);
        el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", err.id);
        if (!first) first = el;
      });
      if (first) first.focus();
      return !first;
    }
    document.addEventListener("input", function (event) {
      var el = event.target;
      if (!el || !el.getAttribute || el.getAttribute("aria-invalid") !== "true") return;
      var ok = el.checkValidity() && !(el.name === "phone" && String(el.value).replace(/\D/g, "").length < 10);
      if (!ok) return;
      el.removeAttribute("aria-invalid");
      var err = el.getAttribute("aria-describedby") && document.getElementById(el.getAttribute("aria-describedby"));
      if (err) err.remove();
      el.removeAttribute("aria-describedby");
    });
    document.addEventListener("change", function (event) {
      var el = event.target;
      if (el && el.type === "checkbox" && el.getAttribute("aria-invalid") === "true" && el.checked) {
        el.removeAttribute("aria-invalid");
        var err = el.getAttribute("aria-describedby") && document.getElementById(el.getAttribute("aria-describedby"));
        if (err) err.remove();
      }
    });

    document.addEventListener("submit", function (event) {
      if (!active) return;
      var search = event.target.closest("[data-sf-search]");
      if (search) {
        event.preventDefault(); var params = new URLSearchParams(new FormData(search));
        Array.from(params.keys()).forEach(function (key) { if (!params.get(key)) params.delete(key); });
        go("search?" + params.toString()); return;
      }
      var inquiry = event.target.closest("[data-sf-inquiry]");
      if (inquiry) {
        event.preventDefault();
        if (!checkFields(inquiry)) return;
        var status = inquiry.querySelector(".sf-form-status"); var button = inquiry.querySelector("button[type=submit]"); var data = new FormData(inquiry);
        button.disabled = true; status.textContent = "Sending…";
        var application = null;
        if (inquiry.getAttribute("data-sf-rent")) {
          application = {};
          ["move_in", "occupants", "employment", "income", "lease_months", "pets"].forEach(function (k) { var v = String(data.get(k) || "").trim(); if (v) application[k] = v; });
          if (!Object.keys(application).length) application = null;
        }
        var payload = { full_name: data.get("full_name"), email: data.get("email"), phone: data.get("phone"), message: data.get("message"), contact_type: inquiry.getAttribute("data-sf-rent") ? "renter" : "buyer", consent: data.get("consent") === "on" };
        if (application) payload.application = application;
        API.inquire(inquiry.getAttribute("data-sf-inquiry"), payload).then(function () {
          inquiry.reset(); status.textContent = application ? "Application sent. The listing agent will contact you to arrange a viewing." : "Inquiry sent. The listing agent will contact you soon."; status.className = "sf-form-status success";
        }).catch(function (error) { status.textContent = error.message || "Could not send inquiry."; status.className = "sf-form-status error"; }).finally(function () { button.disabled = false; });
      }
      /* Project B.T launch notification. Separate inquiry_type from "guide" so
       * the team can tell launch subscribers apart from guide downloads. */
      var notify = event.target.closest("[data-sf-notify]");
      if (notify) {
        event.preventDefault();
        if (!checkFields(notify)) return;
        var notifyStatus = notify.querySelector(".sf-form-status");
        var notifyButton = notify.querySelector("button[type=submit]");
        var notifyData = new FormData(notify);
        if (!(API && API.contact)) {
          if (notifyStatus) { notifyStatus.textContent = "The contact service is unavailable right now. Please try again in a moment."; notifyStatus.className = "sf-form-status error"; }
          return;
        }
        notifyButton.disabled = true;
        if (notifyStatus) { notifyStatus.textContent = "Sending…"; notifyStatus.className = "sf-form-status"; }
        API.contact({
          inquiry_type: "project-bt",
          email: notifyData.get("email"),
          consent: notifyData.get("consent") === "on"
        }).then(function () {
          notify.reset();
          if (notifyStatus) { notifyStatus.textContent = "Thank you. We will contact you when Project B.T opens."; notifyStatus.className = "sf-form-status success"; }
        }).catch(function (error) {
          if (notifyStatus) { notifyStatus.textContent = error.message || "Could not send. Please try again."; notifyStatus.className = "sf-form-status error"; }
        }).finally(function () { notifyButton.disabled = false; });
        return;
      }
      var consult = event.target.closest("[data-sf-consult]");
      if (consult) {
        event.preventDefault();
        if (!checkFields(consult)) return;
        var consultStatus = consult.querySelector(".sf-form-status");
        var consultButton = consult.querySelector("button[type=submit]");
        var consultData = new FormData(consult);
        /* Errors are announced assertively (role=alert + assertive live region,
           the same pattern the estimator's validation uses); the success state
           returns to the polite live region the markup declares. */
        var setConsultError = function (message) {
          if (!consultStatus) return;
          consultStatus.textContent = message;
          consultStatus.className = "sf-form-status error";
          consultStatus.setAttribute("role", "alert");
          consultStatus.setAttribute("aria-live", "assertive");
        };
        if (!(API && API.contact)) {
          setConsultError("The contact service is unavailable right now. Please try again in a moment.");
          return;
        }
        consultButton.disabled = true;
        /* aria-busy marks the form as working for assistive tech while the
           request is in flight, matching the visible "Sending…" state. */
        consult.setAttribute("aria-busy", "true");
        if (consultStatus) {
          consultStatus.textContent = "Sending…";
          consultStatus.className = "sf-form-status";
          consultStatus.removeAttribute("role");
          consultStatus.setAttribute("aria-live", "polite");
        }
        API.contact({
          inquiry_type: "consult",
          full_name: consultData.get("name"),
          email: consultData.get("email"),
          phone: consultData.get("phone"),
          message: consultData.get("message"),
          consent: consultData.get("consent") === "on"
        }).then(function () {
          consult.reset();
          if (consultStatus) { consultStatus.textContent = "Sent. Thank you — a specialist will reply within one business day."; consultStatus.className = "sf-form-status success"; }
        }).catch(function (error) {
          setConsultError((error && error.message ? error.message + " " : "") + "Your answers are still here. Check your connection and press Send again.");
        }).finally(function () { consultButton.disabled = false; consult.removeAttribute("aria-busy"); });
      }
    });
  }

  window.ESREALTY_STOREFRONT = {
    mount: function (options) {
      host = options.host; openAuth = options.openAuth || openAuth; active = true;
      document.body.classList.remove("sf-has-sticky");
      document.body.classList.add("storefront-active");
      bind(); loadSiteContact(); loadCurrent();
    },
    unmount: function () {
      active = false; destroyDetailMap(); cacheKey = "";
      document.body.classList.remove("storefront-active", "sf-has-sticky");
    },
    refresh: function () { cacheKey = ""; loadCurrent(true); }
  };
})();
