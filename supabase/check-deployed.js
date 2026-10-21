"use strict";
// Deployed versus repository, and secrets present (roadmap D5). Used by check-backend.js when
// the SUPABASE_ACCESS_TOKEN secret is available (the nightly Backend Health Check passes it).
//
//  - A function whose code in the repository is newer than what is deployed means someone merged
//    a change but did not run "Deploy edge functions". Up to GRACE_DAYS that is shown as a note;
//    after that it fails the check, which opens an issue.
//  - Secrets the functions read but that are not set are listed (names only; values are never
//    read). They are a note, not a failure: some are optional (email, SMS) until you turn the
//    feature on.
//
// Management API: GET /v1/projects/{ref}/functions and /v1/projects/{ref}/secrets.
const { execFileSync } = require("child_process");
const path = require("path");

const GRACE_DAYS = 3;
const AUTO_INJECTED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_DB_URL"];
const API = "https://api.supabase.com/v1/projects/";

// Supabase answers updated_at as milliseconds; accept seconds or an ISO date as well.
function toMs(v) {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (/^\d+$/.test(String(v))) return toMs(Number(v));
  return Date.parse(v);
}

// deployed: [{ slug, updated_at, version }]; repoAt: { slug: ms of the last commit touching it }.
function staleFunctions(deployed, repoAt, now, graceDays) {
  const grace = (graceDays == null ? GRACE_DAYS : graceDays) * 86400000;
  const bySlug = new Map((deployed || []).map(f => [f.slug, f]));
  const outList = [];
  Object.keys(repoAt || {}).sort().forEach(slug => {
    const repo = repoAt[slug];
    const f = bySlug.get(slug);
    if (!isFinite(repo)) return;
    if (!f) { outList.push({ slug, state: "not-deployed", days: null, blocking: false }); return; }
    const dep = toMs(f.updated_at);
    if (!isFinite(dep) || repo <= dep) return;
    const behind = now - repo; // how long the newer code has waited
    outList.push({ slug, state: "behind", days: Math.floor(behind / 86400000), blocking: behind > grace, version: f.version });
  });
  return outList;
}

function missingSecrets(setNames, referenced) {
  const have = new Set((setNames || []).map(String));
  return [...new Set(referenced || [])].filter(v => AUTO_INJECTED.indexOf(v) < 0 && !have.has(v)).sort();
}

// Last commit time (ms) of each function folder. Needs the full history (fetch-depth: 0):
// with a shallow checkout every folder would look as new as the last commit, so then this
// answers {} and the comparison is skipped.
function repoTimes(slugs, root) {
  const cwd = root || path.join(__dirname, "..");
  try {
    const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd, encoding: "utf8" }).trim();
    if (shallow === "true") return {};
  } catch (e) { return {}; }
  const outMap = {};
  slugs.forEach(slug => {
    try {
      const t = execFileSync("git", ["log", "-1", "--format=%ct", "--", "supabase/functions/" + slug], { cwd, encoding: "utf8" }).trim();
      if (t) outMap[slug] = Number(t) * 1000;
    } catch (e) { /* not a git checkout */ }
  });
  return outMap;
}

async function getJson(url, token) {
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// Returns { lines, blocking } for check-backend to print. Never throws.
async function report(ref, slugs, referencedVars, token, deps) {
  const d = deps || {};
  const lines = [];
  let blocking = false;
  if (!token) return { lines: ["  INFO  skipped: no SUPABASE_ACCESS_TOKEN (the nightly run in GitHub has it)"], blocking };
  try {
    const deployed = await (d.getJson || getJson)(API + ref + "/functions", token);
    const times = (d.repoTimes || repoTimes)(slugs);
    if (!Object.keys(times).length) lines.push("  INFO  repository history not available (shallow checkout); deployed-versus-repository comparison skipped");
    const stale = staleFunctions(deployed, times, (d.now || Date.now)());
    if (Object.keys(times).length && !stale.length) lines.push("  OK    every function in the repository is deployed at its latest version");
    stale.forEach(s => {
      if (s.state === "not-deployed") lines.push("  INFO  " + s.slug + ": in the repository but not deployed");
      else {
        lines.push("  " + (s.blocking ? "FAIL" : "NOTE") + "  " + s.slug + ": the repository has newer code than the deployed version (waiting " + s.days + " day" + (s.days === 1 ? "" : "s") + ")" + (s.blocking ? "  FIX: run Actions > Deploy edge functions" : ""));
        if (s.blocking) blocking = true;
      }
    });
  } catch (e) {
    lines.push("  INFO  could not list deployed functions (" + (e && e.message || e) + ")");
  }
  try {
    const secrets = await (d.getJson || getJson)(API + ref + "/secrets", token);
    const missing = missingSecrets((secrets || []).map(s => s && s.name), referencedVars);
    lines.push(missing.length
      ? "  NOTE  not set (names the functions read): " + missing.join(", ") + "  [optional ones turn features off; set the others in Edge Functions > Secrets]"
      : "  OK    every secret name the functions read is set");
  } catch (e) {
    lines.push("  INFO  could not list secret names (" + (e && e.message || e) + ")");
  }
  return { lines, blocking };
}

module.exports = { GRACE_DAYS, AUTO_INJECTED, toMs, staleFunctions, missingSecrets, repoTimes, report };
