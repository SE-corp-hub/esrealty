#!/usr/bin/env node
// Passes new notifications on to the phones that turned alerts on, for
// .github/workflows/push-alerts.yml (every 10 minutes once PUSH_ALERTS is on).
//
// Reads notifications from the last 6 hours that weren't pushed yet and are
// still unread, sends each to its person's phones (web push, VAPID), marks
// them pushed, and forgets phones the push service says are gone. A send that
// fails for a reason that may pass (push service busy, timeout) is tried twice
// more; a notification that reached no phone stays unpushed so the next run
// (10 minutes later) tries again, until it is 6 hours old. The job turns red
// when nothing at all could be sent. The log shows counts only (the
// repository is public).
//
// Needs: SUPABASE_ACCESS_TOKEN (Management API) and VAPID_PRIVATE_KEY. The
// public key is read from push_config (made in Settings by a super-admin).
"use strict";
const { runSql, dollarTag } = require("./supabase_sql.js");

const SITE = "https://esrealty.extraricestore.workers.dev";

function payloadFor(n) {
  const view = /^[a-z-]{2,30}$/.test(String(n.link_view || "")) ? n.link_view : "";
  return JSON.stringify({ title: String(n.title || "SEA ESTATES").slice(0, 120), body: String(n.body || "").slice(0, 300), tag: String(n.id), url: "./index.html" + (view ? "?open=" + view : "") });
}

const PENDING = "select n.id, n.title, n.body, n.link_view, s.endpoint, s.p256dh, s.auth " +
  "from public.notifications n join public.push_subscriptions s on s.user_id = n.user_id " +
  "where n.pushed_at is null and n.read_at is null and n.created_at > now() - interval '6 hours' " +
  "order by n.created_at limit 300";

const RETRIES = 2; // extra tries after the first
const sleep = ms => new Promise(r => setTimeout(r, ms));

// One send, with retries for failures that can pass. 404/410 mean the phone is gone for good;
// other 4xx answers (bad request, bad key) will not change on a retry.
async function sendWithRetry(webpush, sub, payload, opts, wait) {
  for (let attempt = 0; ; attempt++) {
    try {
      await webpush.sendNotification(sub, payload, opts);
      return { ok: true };
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) return { gone: true };
      const mayPass = !code || code === 408 || code === 429 || code >= 500;
      if (!mayPass || attempt >= RETRIES) return { failed: true };
      await wait(attempt === 0 ? 1000 : 4000);
    }
  }
}

async function main(env = process.env, deps = {}) {
  const run = deps.run || runSql, out = deps.out || console.log, wait = deps.wait || sleep;
  const priv = String(env.VAPID_PRIVATE_KEY || "").replace(/\s+/g, "");
  if (!priv) { out("Phone alerts aren't set up: add the VAPID_PRIVATE_KEY secret (Settings > Phone alerts shows how)."); return { sent: 0 }; }
  const cfg = await run("select public_key from public.push_config where id = 1");
  const pub = cfg[0] && cfg[0].public_key;
  if (!pub) { out("No public key yet: a super-admin makes the keys in Settings > Phone alerts."); return { sent: 0 }; }
  const webpush = deps.webpush || require("web-push");
  webpush.setVapidDetails(env.VAPID_SUBJECT || SITE, pub, priv);
  const rows = await run(PENDING);
  const seen = new Map(), gone = new Set(); // seen: notification id -> { sent, failed }
  let sent = 0, failed = 0;
  for (const r of rows) {
    const st = seen.get(r.id) || { sent: 0, failed: 0 };
    seen.set(r.id, st);
    if (gone.has(r.endpoint)) continue;
    const res = await sendWithRetry(webpush, { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payloadFor(r), { TTL: 6 * 3600, urgency: "high", timeout: 10000 }, wait);
    if (res.ok) { sent++; st.sent++; }
    else if (res.gone) gone.add(r.endpoint);
    else { failed++; st.failed++; }
  }
  // Done with: reached a phone, or had no phone left to reach. Not done with: tried and failed everywhere.
  const ids = new Set([...seen].filter(([, st]) => !(st.failed > 0 && st.sent === 0)).map(([id]) => id));
  const retry = seen.size - ids.size;
  if (ids.size) {
    const list = JSON.stringify([...ids]), tag = dollarTag(list);
    await run("update public.notifications set pushed_at = now() where id in (select value::uuid from json_array_elements_text(" + tag + list + tag + "::json))");
  }
  if (gone.size) {
    const list = JSON.stringify([...gone]), tag = dollarTag(list);
    await run("delete from public.push_subscriptions where endpoint in (select value from json_array_elements_text(" + tag + list + tag + "::json))");
  }
  out("Phone alerts: " + sent + " sent for " + ids.size + " notifications" + (failed ? ", " + failed + " failed" + (retry ? " (" + retry + " notifications will be tried again)" : "") : "") + (gone.size ? ", " + gone.size + " phones no longer reachable (removed)" : "") + ".");
  return { sent, failed, gone: gone.size, marked: ids.size, retry };
}

if (require.main === module) {
  main().then(r => {
    // Nothing reached any phone although there was something to send: show it as a red run.
    if (r.failed > 0 && r.sent === 0) { console.error("::error::No phone alert could be sent. Check the push key and the VAPID_PRIVATE_KEY secret."); process.exit(1); }
    process.exit(0);
  }, e => { console.error("::error::" + (e && e.message || e)); process.exit(1); });
}
module.exports = { main, payloadFor, PENDING, sendWithRetry };
