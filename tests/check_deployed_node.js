/* Deployed versus repository and secret names (supabase/check-deployed.js, roadmap D5). */
const D = require("../supabase/check-deployed.js");
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });
const DAY = 86400000, now = Date.UTC(2026, 9, 21, 5);

c("milliseconds, seconds and dates are read", D.toMs(1760000000000) === 1760000000000 && D.toMs(1760000000) === 1760000000000 && D.toMs("1760000000000") === 1760000000000 && D.toMs("2026-10-20T00:00:00Z") === Date.UTC(2026, 9, 20));
let s = D.staleFunctions([{ slug: "seo", updated_at: now - 5 * DAY }], { seo: now - 6 * DAY }, now);
c("deployed after the last change: nothing to report", s.length === 0, JSON.stringify(s));
s = D.staleFunctions([{ slug: "seo", updated_at: now - 5 * DAY }], { seo: now - 1 * DAY }, now);
c("newer code for one day: a note, not a failure", s.length === 1 && s[0].state === "behind" && s[0].days === 1 && !s[0].blocking, JSON.stringify(s));
s = D.staleFunctions([{ slug: "seo", updated_at: now - 9 * DAY }], { seo: now - 4 * DAY }, now);
c("newer code waiting 4 days: fails (grace is 3)", s.length === 1 && s[0].blocking && s[0].days === 4, JSON.stringify(s));
s = D.staleFunctions([], { "nearby-scan": now - DAY }, now);
c("in the repository but never deployed: informational", s.length === 1 && s[0].state === "not-deployed" && !s[0].blocking);
s = D.staleFunctions([{ slug: "seo", updated_at: "garbage" }], { seo: now }, now);
c("an unreadable deploy date is skipped, not a failure", s.length === 0);
c("missing secrets: auto-injected names are never reported", D.missingSecrets(["FB_VERIFY_TOKEN"], ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "FB_VERIFY_TOKEN", "RESEND_API_KEY", "RESEND_API_KEY"]).join() === "RESEND_API_KEY");

(async () => {
  let r = await D.report("ref", ["seo"], ["X"], "");
  c("no token: says it was skipped, never fails", !r.blocking && /skipped: no SUPABASE_ACCESS_TOKEN/.test(r.lines.join("\n")));
  const deps = (fns, secrets) => ({ now: () => now, repoTimes: () => ({ seo: now - 5 * DAY, "listing-api": now - 10 * DAY }),
    getJson: async url => /functions$/.test(url) ? fns : secrets });
  r = await D.report("ref", ["seo", "listing-api"], ["FB_VERIFY_TOKEN", "SUPABASE_URL"], "t", deps([{ slug: "seo", updated_at: now - 8 * DAY }, { slug: "listing-api", updated_at: now - 2 * DAY }], [{ name: "FB_VERIFY_TOKEN", value: "digest" }]));
  c("report: a stale function fails and names the fix", r.blocking && /FAIL  seo: the repository has newer code/.test(r.lines.join("\n")) && /Deploy edge functions/.test(r.lines.join("\n")), r.lines.join(" | "));
  c("report: all secret names set", /OK    every secret name/.test(r.lines.join("\n")));
  r = await D.report("ref", ["seo"], ["RESEND_API_KEY"], "t", { now: () => now, repoTimes: () => ({}), getJson: async url => { if (/functions$/.test(url)) throw new Error("HTTP 401"); return []; } });
  c("report: API refusal and shallow history are notes, not failures", !r.blocking && /could not list deployed functions \(HTTP 401\)/.test(r.lines.join("\n")) && /not set .*RESEND_API_KEY/.test(r.lines.join("\n")), r.lines.join(" | "));
  c("report never prints secret values", !/digest/.test(JSON.stringify(r.lines)));
  const ok = checks.every(x => x.ok) && checks.length >= 12;
  console.log("\n[check_deployed_node] " + checks.length + " checks");
  checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : "  " + x.detail)));
  console.log(ok ? "ALL PASS" : "FAILURES PRESENT");
  process.exit(ok ? 0 : 1);
})();
