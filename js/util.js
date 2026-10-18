/* Shared helpers. One implementation, loaded before the modules that use it.
 *
 * esc() was previously duplicated three times — in app.js, estimator.js and
 * storefront.js — as byte-identical logic. Duplicated escaping is the classic
 * way an XSS fix lands in one file and silently misses the other two, so this
 * is the single place to change.
 *
 * Each consumer keeps a local fallback because the Node test suite requires
 * these modules directly (tests/estimator_core_node.js and friends), where no
 * window is present. The fallback is byte-identical, so behaviour is unchanged
 * in either environment. */
(function () {
  "use strict";
  var ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  var util = window.ESREALTY_UTIL || (window.ESREALTY_UTIL = {});
  util.esc = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) { return ESCAPES[ch]; });
  };
  /* Join class names, dropping falsy entries. New code should prefer this over
   * hand-built className strings. */
  util.cls = function () {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (!a) continue;
      if (typeof a === "string") { out.push(a); continue; }
      if (typeof a === "object") {
        for (var k in a) { if (Object.prototype.hasOwnProperty.call(a, k) && a[k]) out.push(k); }
      }
    }
    return out.join(" ");
  };
  /* Listing photos uploaded since 2026-10-18 are stored as <id>-full.<ext>
   * with a small copy, <id>-thumb.jpg (640 px), next to it. Lists and cards
   * show the small copy; older photos have none and keep their own URL. */
  util.thumbUrl = function (url) {
    return String(url == null ? "" : url).replace(/-full\.(?:jpe?g|png|webp|gif|avif)(?=$|[?#])/i, "-thumb.jpg");
  };
  /* Phone alerts (web push). base64url <-> bytes, and a new key pair made in
   * this browser: the public half goes to the app's settings, the private
   * half is shown once for the person to store as a GitHub secret. */
  util.b64url = function (bytes) {
    var s = ""; bytes = new Uint8Array(bytes);
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  util.b64urlBytes = function (text) {
    var b = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    var raw = atob(b), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };
  util.makePushKeys = function () {
    var subtle = crypto.subtle;
    return subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]).then(function (kp) {
      return Promise.all([subtle.exportKey("raw", kp.publicKey), subtle.exportKey("jwk", kp.privateKey)]);
    }).then(function (r) { return { publicKey: util.b64url(r[0]), privateKey: r[1].d }; });
  };
  /* src (plus a fallback to the full photo if the small copy is missing) for an
   * <img>. onFail runs if the full photo fails too. */
  util.thumbAttrs = function (url, onFail) {
    var full = String(url == null ? "" : url), small = util.thumbUrl(full);
    if (small === full) return 'src="' + util.esc(full) + '"' + (onFail ? ' onerror="' + util.esc(onFail) + '"' : "");
    return 'src="' + util.esc(small) + '" data-full="' + util.esc(full) + '" onerror="' +
      util.esc("if(this.dataset.full){var f=this.dataset.full;delete this.dataset.full;this.src=f}" + (onFail ? "else{" + onFail + "}" : "")) + '"';
  };
})();
