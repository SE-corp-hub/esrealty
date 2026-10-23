/* Agent websites: the agent directory (#/agents), check-an-agent and a client's review form
 * (#/review/<token>). Drawn and wired like js/agent_page.js: html() gives the markup, bind() attaches
 * the page's own handlers to its root, so the storefront keeps one line per route.
 *
 *   SEA_AGENT_DIRECTORY.use(api)                    the storefront's helpers (once, at start)
 *   SEA_AGENT_DIRECTORY.directoryHtml(view, params)  the directory; view is the storefront's loading state
 *   SEA_AGENT_DIRECTORY.reviewHtml(view, token)      the review form, or why the link does not work
 *   SEA_AGENT_DIRECTORY.bind(root)                   filters, chips, Show more, retry, Viber, check, review
 *   SEA_AGENT_DIRECTORY.reset()                      a fresh load: first page of cards, review not sent
 *
 * api: { API, esc, safeImage, telHref, officePhone(), go(path), params(), rerender(), reload(), checkFields(form) }
 */
(function () {
  "use strict";

  var api = {};
  function esc(s) { return api.esc(s); }

  /* ---- Find an agent (agent websites plan, Phases 2 and 3) --------------------------------
   * Published agents whose licence check holds, filtered by the fixed lists. Measured reply time
   * comes first (the server's order); "Most deals" and "Most listings" re-sort here. A number with
   * no record behind it is left out, never shown as a zero. Nobody pays for a place. */
  var PAGE = 10;
  var showCount = PAGE;
  var SORTS = [["", "Fastest reply"], ["deals", "Most deals"], ["listings", "Most listings"]];

  function selectOptions(list, picked, anyLabel) {
    return (anyLabel ? '<option value="">' + esc(anyLabel) + '</option>' : '') + list.map(function (pair) {
      return '<option value="' + esc(pair[0]) + '"' + (pair[0] === picked ? ' selected' : '') + '>' + esc(pair[1]) + '</option>';
    }).join("");
  }
  function countLabel(n, word) { return Number(n) + " " + word + (Number(n) === 1 ? "" : "s"); }

  function directoryCard(a) {
    var P = window.SEA_AGENT_PAGE;
    var towns = P.labels(P.TOWNS, a.towns), needs = P.labels(P.NEEDS, a.needs), langs = P.labels(P.LANGUAGES, a.languages);
    var photo = api.safeImage(a.photo);
    var href = "#/agents/" + encodeURIComponent(a.slug);
    var nums = [];
    if (Number(a.deals) > 0) nums.push('<div><b>' + Number(a.deals) + '</b><span>' + (Number(a.deals) === 1 ? "deal" : "deals") + (a.deals_window === "3y" ? " in 3 years" : ' since ' + esc(P.month(a.deals_since))) + '</span></div>');
    if (Number(a.listing_count) > 0) nums.push('<div><b>' + Number(a.listing_count) + '</b><span>' + (Number(a.listing_count) === 1 ? "listing" : "listings") + '</span></div>');
    if (Number(a.review_count) > 0) nums.push('<div><b>' + Number(a.review_count) + '</b><span>' + (Number(a.review_count) === 1 ? "review" : "reviews") + '</span></div>');
    return '<article class="agd-card">' +
      (photo ? '<img class="agd-photo" src="' + esc(photo) + '" alt="Photo of ' + esc(a.name) + '" width="104" height="104" loading="lazy">'
             : '<div class="agd-photo agd-initials" aria-hidden="true">' + esc(P.initials(a.name)) + '</div>') +
      '<div class="agd-who"><h2><a href="' + href + '">' + esc(a.name) + '</a></h2>' +
      '<p class="agd-sub">' + esc(a.role_label) + (towns.length ? ', ' + esc(P.joinWords(towns.slice(0, 2))) + (towns.length > 2 ? ' and nearby' : '') : '') + '.' +
        (langs.length ? ' Speaks ' + esc(P.joinWords(langs)) + '.' : '') + '</p>' +
      '<p class="agd-marks"><span class="agd-ok">' + P.icon("check") + 'Licence checked ' + esc(P.day(a.licence_checked_on)) + '</span>' +
        (a.verified_on ? '<span class="agd-ver">' + P.icon("shield") + 'Verified</span>' : '') + '</p>' +
      '<p class="agd-line">' + (a.reply ? 'Usually replies ' + esc(a.reply) : 'New on SEA ESTATES') + '</p>' +
      (needs.length ? '<p class="agd-line">' + esc(needs.join(", ")) + '</p>' : '') + '</div>' +
      (nums.length ? '<div class="agd-nums">' + nums.join("") + '</div>' : '') +
      '<div class="agd-acts"><a class="agd-btn agd-btn-primary agd-go" href="' + href + '">View website<span class="sr-only">: ' + esc(a.name) + '</span></a>' +
      (a.viber ? '<a class="agd-btn agd-go" href="viber://chat?number=' + encodeURIComponent(a.viber) + '" data-agd-viber="' + esc(a.slug) + '">Viber<span class="sr-only">: message ' + esc(a.name) + '</span></a>' : '') + '</div></article>';
  }

  function checkAgentBox() {
    return '<section class="agd-check" id="agd-check" aria-labelledby="agd-check-h"><h2 id="agd-check-h">Check an agent’s licence</h2>' +
      '<p>Got a call or a Facebook message from someone who says they work with us? Look them up before you pay anything.</p>' +
      '<form class="agd-check-form" data-agd-check novalidate><label class="agd-label" for="agd-q">PRC licence number or phone number</label>' +
      '<input class="agd-input" id="agd-q" name="q" inputmode="tel" autocomplete="off" maxlength="40" aria-describedby="agd-q-help">' +
      '<p class="agd-help" id="agd-q-help">For example 0012345, or the number that contacted you.</p>' +
      '<button type="submit" class="agd-btn agd-btn-trust">Check</button></form>' +
      '<div class="agd-check-result" role="status" aria-live="polite"></div>' +
      '<p class="agd-warn">SEA ESTATES never asks you to pay into a personal account.</p>' +
      '<p class="agd-help">You can also check any licence on the PRC website.</p></section>';
  }

  function directoryHtml(viewState, params) {
    var P = window.SEA_AGENT_PAGE;
    if (!P) return '<section class="sf-section"><p>Loading…</p></section>';
    var town = params.get("town") || "", need = params.get("need") || "", language = params.get("language") || "", sort = params.get("sort") || "";
    var result = viewState.result || {};
    var agents = Array.isArray(result.data) ? result.data.slice() : [];
    if (sort === "deals") agents.sort(function (a, b) { return (Number(b.deals) || 0) - (Number(a.deals) || 0); });
    if (sort === "listings") agents.sort(function (a, b) { return (Number(b.listing_count) || 0) - (Number(a.listing_count) || 0); });
    var picked = [["town", P.TOWNS, town], ["need", P.NEEDS, need], ["language", P.LANGUAGES, language]]
      .map(function (f) { var name = (P.labels(f[1], [f[2]])[0]) || ""; return name ? [f[0], name] : null; }).filter(Boolean);
    var townName = P.labels(P.TOWNS, [town])[0];
    var status;
    if (viewState.loading) status = 'Finding agents…';
    else if (viewState.error) status = 'Could not load agents. ' + esc(viewState.error);
    else status = countLabel(agents.length, "agent") + (townName ? ' in ' + esc(townName) : '');
    var shown = agents.slice(0, showCount);
    var list = viewState.loading ? '<p class="agd-empty" aria-busy="true">Finding agents…</p>'
      : viewState.error ? '<p class="agd-empty">Could not load agents. Check your connection and <button type="button" class="agd-link" data-agd-retry>try again</button>.</p>'
      : !agents.length ? '<p class="agd-empty">No agent matches ' + (picked.length ? 'these filters yet. Remove a filter or try a nearby town.' : 'yet.') + '</p>'
      : shown.map(directoryCard).join("") + (agents.length > shown.length ? '<button type="button" class="agd-btn agd-more" data-agd-more>Show ' + Math.min(PAGE, agents.length - shown.length) + ' more agents</button>' : '');
    return '<div class="agd"><section class="agd-top"><div class="agd-in">' +
      '<h1>Find an agent you can check</h1>' +
      '<p class="agd-lede">Every agent’s PRC licence is checked by our office before their page goes live. Deal counts come from our own records, and reviews come only from clients with a closed deal.</p>' +
      '<p class="agd-check-jump">Contacted by someone who says they work with us? <a href="#agd-check" data-sf-scroll="agd-check">Check their licence</a></p>' +
      '<form class="agd-filters" data-agd-filters aria-label="Filter agents">' +
      '<label class="agd-label">Town<select class="agd-input" name="town">' + selectOptions(P.TOWNS, town, "All towns") + '</select></label>' +
      '<label class="agd-label">I need help with<select class="agd-input" name="need">' + selectOptions(P.NEEDS, need, "Anything") + '</select></label>' +
      '<label class="agd-label">Language<select class="agd-input" name="language">' + selectOptions(P.LANGUAGES, language, "Any language") + '</select></label>' +
      '<label class="agd-label">Sort by<select class="agd-input" name="sort">' + selectOptions(SORTS, sort) + '</select></label>' +
      '<button type="submit" class="agd-btn agd-btn-primary">Show agents</button></form>' +
      '<div class="agd-status"><span role="status">' + status + '</span>' + picked.map(function (f) {
        return '<button type="button" class="agd-chip" data-agd-remove="' + f[0] + '"><span class="sr-only">Remove filter: </span>' + esc(f[1]) + '<span class="agd-x" aria-hidden="true">×</span></button>';
      }).join("") + '</div></div></section>' +
      '<div class="agd-in agd-body"><section class="agd-list" aria-label="Agents">' + list +
      '<div class="agd-fallback"><p>Not finding the right person? Try a nearby town, or tell our team what you need and we will match you with an agent.</p>' +
      '<a class="agd-btn" href="#/property-value?service=broker&amp;go=form">Ask our team</a></div></section>' +
      '<aside class="agd-aside">' + checkAgentBox() +
      '<section class="agd-box" aria-labelledby="agd-how-h"><h2 id="agd-how-h">How we check an agent</h2><ol>' +
      '<li><b>Licence checked</b> against the PRC record before the page goes live: every agent.</li>' +
      '<li><b>Verified badge:</b> government ID seen and phone confirmed by our office: shown when done.</li></ol>' +
      '<p>No agent pays to be here. Agents with a measured reply time come first, then the most recently updated pages. When a licence expires, the agent’s page comes down until it is renewed.</p></section>' +
      '<section class="agd-box agd-join" aria-labelledby="agd-join-h"><h2 id="agd-join-h">Licensed agent?</h2><p>Get your own website and appear here, free.</p>' +
      '<button type="button" class="agd-btn agd-btn-primary" data-sf-auth="signup-agent">Join as an agent</button></section></aside></div></div>';
  }

  function directoryGo(form) {
    var params = new URLSearchParams();
    ["town", "need", "language", "sort"].forEach(function (name) { var v = form.elements[name] && form.elements[name].value; if (v) params.set(name, v); });
    var qs = params.toString();
    api.go("agents" + (qs ? "?" + qs : ""));
  }

  function checkAgent(form) {
    var box = form.closest(".agd-check");
    var out = box.querySelector(".agd-check-result");
    var q = String(form.elements.q.value || "").trim();
    var office = api.officePhone();
    var phone = office ? ' on <a href="tel:' + encodeURIComponent(api.telHref(office)) + '">' + esc(office) + '</a>' : '';
    if (q.replace(/\D/g, "").length < 5) { out.innerHTML = '<p class="agd-result agd-result-miss">Enter a licence number or a full phone number.</p>'; form.elements.q.focus(); return; }
    var button = form.querySelector("button");
    button.disabled = true; out.innerHTML = '<p class="agd-result">Checking…</p>';
    api.API.agentCheck(q).then(function (result) {
      var found = (result && result.data) || [];
      var P = window.SEA_AGENT_PAGE;
      out.innerHTML = found.length ? found.map(function (a) {
        return '<div class="agd-result agd-result-hit"><p><b>' + esc(a.name) + '</b>, ' + esc(a.role_label) + ', licence no. ' + esc(a.licence_no) + '.' +
          (a.verified_on ? ' Verified on ' + esc(P.day(a.verified_on)) + '.' : '') + '</p>' +
          '<p>This matches a published SEA ESTATES agent. If they contacted you, check that the number is on <a href="#/agents/' + encodeURIComponent(a.slug) + '">their page</a>.</p></div>';
      }).join("") : '<p class="agd-result agd-result-miss">No published agent matches. Call our office' + phone + ' before paying anything.</p>';
    }).catch(function (error) {
      out.innerHTML = '<p class="agd-result agd-result-miss">' + (error && error.status === 429 ? 'Too many checks from this connection. Try again in an hour, or call our office' + phone + '.'
        : 'Could not check right now. Call our office' + phone + ' before paying anything.') + '</p>';
    }).finally(function () { button.disabled = false; });
  }

  /* ---- A client's review (Phase 3): the one-time link from our office ---------------------- */
  var reviewSent = false;
  function reviewHtml(viewState, token) {
    var data = viewState.result && viewState.result.data;
    var help = '<p><a class="sf-outline-btn" href="#/property-value?go=form">Contact SEA ESTATES</a></p>';
    if (viewState.loading) return ('<section class="sf-section sf-review" aria-busy="true"><p>Opening your review link…</p></section>');
    if (!data) return ('<section class="sf-section sf-review"><h1>This review link does not work</h1><p>Check that you opened the whole link from our message. Each link works once and for 30 days. Ask our office for a new one.</p>' + help + '</section>');
    var first = String(data.agent || "your agent").split(/\s+/)[0];
    if (reviewSent) return ('<section class="sf-section sf-review"><div class="sf-review-done" role="status" tabindex="-1"><h1>Thank you</h1><p>Your review was sent. It appears on ' + esc(data.agent) + '’s page after a quick check by our office.</p></div></section>');
    if (!data.open) return ('<section class="sf-section sf-review"><h1>' + (data.status === "used" ? "This review has already been sent" : "This review link has expired") + '</h1><p>' +
      (data.status === "used" ? "Each link works once. Thank you for your review." : "Links work for 30 days. Ask our office for a new one.") + '</p>' + help + '</section>');
    return ('<section class="sf-section sf-review"><h1>Review ' + esc(data.agent) + '</h1>' +
      '<p class="sf-review-lede">Your review helps other buyers and sellers in Batangas. Our office checks it, then it appears on ' + esc(first) + '’s page with your first name, the first letter of your last name, the town and the month of your deal. There are no star ratings.</p>' +
      '<form class="sf-review-form" data-sf-review="' + esc(token) + '" novalidate>' +
      '<label>First name<input name="first_name" required maxlength="40" autocomplete="given-name" data-msg="Enter your first name."></label>' +
      '<label>Last name<input name="last_name" maxlength="60" autocomplete="family-name" aria-describedby="sf-review-last"><small id="sf-review-last">Only the first letter is shown.</small></label>' +
      '<label>Your review<textarea name="review" rows="6" required minlength="20" maxlength="1200" data-msg="Write at least a sentence about ' + esc(first) + ' (20 characters or more)." placeholder="What did ' + esc(first) + ' do well? What should other clients know?"></textarea></label>' +
      '<label class="sf-consent"><input type="checkbox" name="consent" required data-msg="Tick this box so we may show your review."><span>I agree that SEA ESTATES may show this review on ' + esc(data.agent) + '’s page with my first name, the first letter of my last name, the town and the month of my deal, as the <a href="#/privacy">privacy notice</a> explains.</span></label>' +
      '<button type="submit" class="sf-primary-btn">Send my review</button><p class="sf-form-status" aria-live="polite"></p></form></section>');
  }

  function sendReview(form) {
    if (!api.checkFields(form)) return;
    var status = form.querySelector(".sf-form-status"), button = form.querySelector("button[type=submit]"), data = new FormData(form);
    button.disabled = true; status.textContent = "Sending…"; status.className = "sf-form-status";
    api.API.sendReview(form.getAttribute("data-sf-review"), {
      first_name: data.get("first_name"), last_name: data.get("last_name"), review: data.get("review"), consent: data.get("consent") === "on"
    }).then(function () {
      reviewSent = true; api.rerender();
      var done = document.querySelector(".sf-review-done"); if (done) done.focus();
    }).catch(function (error) {
      button.disabled = false;
      status.textContent = (error && error.status === 410 ? "This link has already been used or has expired." : (error && error.message ? error.message + " " : "") + "Your review is still here. Check your connection and press Send again.");
      status.className = "sf-form-status error";
    });
  }

  function bind(root) {
    if (!root) return;
    root.addEventListener("click", function (event) {
      var remove = event.target.closest("[data-agd-remove]");
      if (remove) { var params = api.params(); params.delete(remove.getAttribute("data-agd-remove")); var qs = params.toString(); api.go("agents" + (qs ? "?" + qs : "")); return; }
      if (event.target.closest("[data-agd-more]")) {
        var before = root.querySelectorAll(".agd-card").length;
        showCount += PAGE; api.rerender();
        var next = document.querySelectorAll(".agd-card h2 a")[before]; if (next) next.focus();
        return;
      }
      if (event.target.closest("[data-agd-retry]")) { api.reload(); return; }
      var viber = event.target.closest("[data-agd-viber]");
      if (viber && api.API.agentTap) api.API.agentTap(viber.getAttribute("data-agd-viber"), "viber").catch(function () {}); // counted, as on the agent's page
    });
    root.addEventListener("submit", function (event) {
      var form = event.target;
      if (form.matches("[data-agd-filters]")) { event.preventDefault(); directoryGo(form); return; }
      if (form.matches("[data-agd-check]")) { event.preventDefault(); checkAgent(form); return; }
      if (form.matches("[data-sf-review]")) { event.preventDefault(); sendReview(form); }
    });
  }

  window.SEA_AGENT_DIRECTORY = {
    use: function (helpers) { api = helpers; },
    directoryHtml: directoryHtml, reviewHtml: reviewHtml, bind: bind,
    reset: function () { showCount = PAGE; reviewSent = false; }
  };
})();
