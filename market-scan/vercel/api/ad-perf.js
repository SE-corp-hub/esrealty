"use strict";

// Ad-performance sync seam for the CRM "Ad ROI" card (docs/specs/phase-0-1-compliance-and-leadgen.md 1.3).
// Marketplace channels (Lamudi, Property24, Facebook, TikTok) only expose
// view/inquiry counts behind partner credentials, so this endpoint is a no-op
// until AD_PERF_SOURCE_URL is configured. When set it fetches the upstream feed
// and normalizes it to { ok:true, ads:[{id,perfViews,perfInquiries,url}] } for
// the browser to merge into each ad_posts.payload record. No data is fabricated.

const AD_PERF_SOURCE_URL = process.env.AD_PERF_SOURCE_URL || "";
const AD_PERF_SOURCE_TOKEN = process.env.AD_PERF_SOURCE_TOKEN || "";
// Only approved back-office staff may read ad performance. The browser sends its
// SEA ESTATES sign-in token; it is checked with Supabase on every call.
const SUPABASE_URL = (process.env.SUPABASE_URL || "https://hdkmvwxgjgzbuycjrbyq.supabase.co").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_cZYofHijKLif1YXkHY8QLA_jK5SxY2I";
const STAFF_ROLES = ["super-admin", "broker", "agent"];

// Returns the caller's role if they are approved staff, otherwise "".
async function staffRole(authorization, fetchImpl) {
  const token = String(authorization || "").replace(/^Bearer\s+/i, "");
  if (!token || token.split(".").length !== 3) return "";
  const doFetch = fetchImpl || fetch;
  const userRes = await doFetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
  if (!userRes.ok) return "";
  const user = await userRes.json().catch(() => null);
  if (!user || !user.id) return "";
  // Row rules let each user read only their own profile.
  const profRes = await doFetch(SUPABASE_URL + "/rest/v1/profiles?select=role,registration_status&id=eq." + encodeURIComponent(user.id), { headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
  if (!profRes.ok) return "";
  const rows = await profRes.json().catch(() => []);
  const me = Array.isArray(rows) ? rows[0] : null;
  return me && me.registration_status === "approved" && STAFF_ROLES.indexOf(me.role) >= 0 ? me.role : "";
}

function normNum(v) {
  const n = Number(v);
  return isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function normalize(data) {
  const rows = Array.isArray(data) ? data : (data && Array.isArray(data.ads) ? data.ads : []);
  return rows
    .map(r => {
      r = r || {};
      const views = normNum(r.perfViews != null ? r.perfViews : r.views);
      const inquiries = normNum(r.perfInquiries != null ? r.perfInquiries : r.inquiries);
      return {
        id: String(r.id || r.adId || ""),
        perfViews: views,
        perfInquiries: inquiries,
        url: String(r.url || "")
      };
    })
    .filter(x => x.id && (x.perfViews !== null || x.perfInquiries !== null));
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  let role = "";
  try { role = await staffRole(req.headers.authorization); } catch (e) { role = ""; }
  if (!role) {
    res.status(401).json({ ok: false, error: "Sign in with an approved staff account" });
    return;
  }
  if (!AD_PERF_SOURCE_URL) {
    res.status(200).json({ ok: true, skipped: "ad perf source not configured" });
    return;
  }
  try {
    const headers = { Accept: "application/json" };
    if (AD_PERF_SOURCE_TOKEN) headers.Authorization = "Bearer " + AD_PERF_SOURCE_TOKEN;
    const r = await fetch(AD_PERF_SOURCE_URL, { headers, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error("upstream HTTP " + r.status);
    const data = await r.json().catch(() => null);
    res.status(200).json({ ok: true, ads: normalize(data), syncedAt: new Date().toISOString() });
  } catch (e) {
    console.error("ad-perf source failed:", String((e && e.message) || e));
    res.status(502).json({ ok: false, error: "The ad report source did not answer" });
  }
};

module.exports.normalize = normalize;
module.exports.staffRole = staffRole;
