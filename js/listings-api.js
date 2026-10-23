(function () {
  "use strict";

  async function accessToken() {
    const client = window.ESREALTY_SUPABASE;
    if (!client) return "";
    const result = await client.auth.getSession();
    return result.data && result.data.session ? result.data.session.access_token : "";
  }

  async function request(path, options) {
    const config = options || {};
    const headers = { Accept: "application/json" };
    const token = await accessToken();
    if (token) headers.Authorization = "Bearer " + token;
    if (config.body !== undefined) headers["Content-Type"] = "application/json";
    if (config.key) headers["Idempotency-Key"] = config.key;

    const response = await fetch(window.ESREALTY_API_BASE + path, {
      method: config.method || "GET",
      headers: headers,
      body: config.body === undefined ? undefined : JSON.stringify(config.body)
    });
    let payload = {};
    try { payload = await response.json(); } catch (e) {}
    if (!response.ok) {
      const error = new Error(payload.error || "Request failed");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function queryString(filters) {
    const params = new URLSearchParams();
    Object.keys(filters || {}).forEach(function (key) {
      const value = filters[key];
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    });
    const result = params.toString();
    return result ? "?" + result : "";
  }

  window.ESREALTY_LISTINGS_API = {
    list: function (filters) { return request("/listings" + queryString(filters)); },
    get: function (id) { return request("/listings/" + encodeURIComponent(id)); },
    create: function (listing) { return request("/listings", { method: "POST", body: listing }); },
    update: function (id, listing) { return request("/listings/" + encodeURIComponent(id), { method: "PUT", body: listing }); },
    remove: function (id) { return request("/listings/" + encodeURIComponent(id), { method: "DELETE" }); },
    mine: function (filters) { return request("/users/me/listings" + queryString(filters)); },
    toggleFavorite: function (id) { return request("/listings/" + encodeURIComponent(id) + "/favorite", { method: "POST" }); },
    favorites: function () { return request("/users/me/favorites"); },
    siteSettings: function () { return request("/site-settings"); },
    inquire: function (id, inquiry) { return request("/listings/" + encodeURIComponent(id) + "/inquiries", { method: "POST", body: inquiry }); },
    contact: function (inquiry) { return request("/contacts", { method: "POST", body: inquiry }); },
    agent: function (slug) { return request("/agents/" + encodeURIComponent(slug)); },
    agentTap: function (slug, kind) { return request("/agents/" + encodeURIComponent(slug) + "/taps", { method: "POST", body: { kind: kind } }); },
    agentInquire: function (slug, inquiry, key) { return request("/agents/" + encodeURIComponent(slug) + "/inquiries", { method: "POST", body: inquiry, key: key }); },
    agents: function (filters) { return request("/agents" + queryString(filters)); },
    agentCheck: function (q) { return request("/agent-check" + queryString({ q: q })); },
    review: function (token) { return request("/reviews/" + encodeURIComponent(token)); },
    sendReview: function (token, review) { return request("/reviews/" + encodeURIComponent(token), { method: "POST", body: review }); }
  };
})();
