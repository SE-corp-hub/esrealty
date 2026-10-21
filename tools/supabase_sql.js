"use strict";
// Runs SQL on the live database through the Supabase Management API
// (POST /v1/projects/{ref}/database/query), with the personal access token
// that GitHub already holds for the function deploys (SUPABASE_ACCESS_TOKEN).
// Used by the GitHub workflows only; nothing in the app calls it.

const DEFAULT_REF = "mrngaqtbaseewzcsogqi";

function settings(env = process.env) {
  // A stray space or line break from copy-paste breaks the token.
  const token = String(env.SUPABASE_ACCESS_TOKEN || "").replace(/\s+/g, "");
  return {
    token,
    ref: env.PROJECT_REF || DEFAULT_REF,
    base: (env.SUPABASE_API_BASE || "https://api.supabase.com").replace(/\/+$/, ""),
  };
}

function checkToken(token) {
  if (!token) return "Add the SUPABASE_ACCESS_TOKEN repository secret first (Settings -> Secrets and variables -> Actions).";
  if (!/^sbp_/.test(token)) return "SUPABASE_ACCESS_TOKEN is not a personal access token (those start with sbp_).";
  return "";
}

async function runSql(query, opts = {}) {
  const s = Object.assign(settings(), opts);
  const bad = checkToken(s.token);
  if (bad) throw new Error(bad);
  const res = await fetch(s.base + "/v1/projects/" + s.ref + "/database/query", {
    method: "POST",
    headers: { authorization: "Bearer " + s.token, "content-type": "application/json" },
    body: JSON.stringify({ query }),
    // A stuck request must not hold a scheduled job for its whole time limit.
    signal: AbortSignal.timeout(opts.timeoutMs || 60000),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const msg = body && (body.message || body.error) ? (body.message || body.error) : text.slice(0, 500);
    const err = new Error("Database said (" + res.status + "): " + msg);
    err.status = res.status;
    throw err;
  }
  return Array.isArray(body) ? body : (body == null ? [] : body);
}

// A dollar-quote tag that doesn't occur in the text, for passing JSON into SQL safely.
function dollarTag(text) {
  let tag = "j";
  while (String(text).indexOf("$" + tag + "$") !== -1) tag += "x";
  return "$" + tag + "$";
}

module.exports = { runSql, settings, checkToken, dollarTag, DEFAULT_REF };
