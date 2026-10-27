// Phone alerts (web push): the keys made in the browser are a valid pair in
// the format push libraries expect; tools/send_push.js sends, marks and
// forgets phones correctly; the service worker, the app and the workflow are
// wired the way the plan says. The push library itself (web-push) is
// installed by the workflow on GitHub; here a stand-in records the calls.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const nodeCrypto = require("crypto");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? "  " + detail : "")); passed++; console.log("[PASS] " + name); };

const ctx = { window: {}, btoa, atob, crypto: globalThis.crypto, Uint8Array, Promise, String };
vm.createContext(ctx);
vm.runInContext(read("js/util.js"), ctx);
const U = ctx.window.ESREALTY_UTIL;

(async () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
  ok("base64url round trip, no padding or + /", Buffer.from(U.b64urlBytes(U.b64url(bytes))).equals(Buffer.from(bytes)) && !/[+/=]/.test(U.b64url(bytes)));

  const k = await U.makePushKeys();
  const pub = Buffer.from(U.b64urlBytes(k.publicKey)), priv = Buffer.from(U.b64urlBytes(k.privateKey));
  ok("public key: 65-byte uncompressed P-256 point, 87 characters", pub.length === 65 && pub[0] === 4 && k.publicKey.length === 87, k.publicKey.length);
  ok("private key: 32 bytes, 43 characters (the VAPID format)", priv.length === 32 && k.privateKey.length === 43);
  ok("the public key passes the database check", /^[A-Za-z0-9_-]{80,100}$/.test(k.publicKey));
  const jwk = { kty: "EC", crv: "P-256", d: k.privateKey, x: U.b64url(pub.subarray(1, 33)), y: U.b64url(pub.subarray(33, 65)) };
  const privKey = nodeCrypto.createPrivateKey({ key: jwk, format: "jwk" });
  const pubKey = nodeCrypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
  const sig = nodeCrypto.sign("sha256", Buffer.from("vapid"), { key: privKey, dsaEncoding: "ieee-p1363" });
  ok("the two halves are a matching pair (a VAPID signature checks out)", nodeCrypto.verify("sha256", Buffer.from("vapid"), { key: pubKey, dsaEncoding: "ieee-p1363" }, sig));

  const { main, payloadFor, PENDING } = require("../tools/send_push.js");
  ok("payload: title, body, tag, and the screen to open", JSON.parse(payloadFor({ id: "n1", title: "New lead: Maria", body: "From Value Guide.", link_view: "leads" })).url === "./index.html?open=leads" && JSON.parse(payloadFor({ id: "n1", title: "x", link_view: "../evil" })).url === "./index.html");
  ok("only recent, unread, not-yet-pushed notifications of people with phones", /n\.pushed_at is null and n\.read_at is null and n\.created_at > now\(\) - interval '6 hours'/.test(PENDING) && /join public\.push_subscriptions s on s\.user_id = n\.user_id/.test(PENDING));

  const logs = [], out = l => logs.push(l);
  let r = await main({}, { run: async () => [], out });
  ok("no private key: nothing happens, says how to set it up", r.sent === 0 && /VAPID_PRIVATE_KEY/.test(logs.pop()));
  r = await main({ VAPID_PRIVATE_KEY: k.privateKey }, { run: async () => [], out });
  ok("no public key yet: nothing happens", r.sent === 0 && /makes the keys in Settings/.test(logs.pop()));

  const queries = [], calls = [];
  const rows = [
    { id: "11111111-0000-0000-0000-000000000001", title: "New lead: Maria Santos", body: "From Value Guide.", link_view: "leads", endpoint: "https://push.example/a", p256dh: "P1", auth: "A1" },
    { id: "11111111-0000-0000-0000-000000000001", title: "New lead: Maria Santos", body: "From Value Guide.", link_view: "leads", endpoint: "https://push.example/gone", p256dh: "P2", auth: "A2" },
    { id: "11111111-0000-0000-0000-000000000002", title: "Due today: Rent", body: "₱10,000", link_view: "pms", endpoint: "https://push.example/gone", p256dh: "P2", auth: "A2" },
    { id: "11111111-0000-0000-0000-000000000003", title: "Overdue", body: "", link_view: "pms", endpoint: "https://push.example/flaky", p256dh: "P3", auth: "A3" },
  ];
  const run = async q => { queries.push(q); if (/from public\.push_config/.test(q)) return [{ public_key: k.publicKey }]; if (q === PENDING) return rows; return []; };
  const webpush = {
    setVapidDetails: (s, p, v) => calls.push({ vapid: [s, p, v] }),
    sendNotification: async (sub, payload, opts) => { calls.push({ sub, payload, opts }); if (sub.endpoint.endsWith("/gone")) { const e = new Error("gone"); e.statusCode = 410; throw e; } if (sub.endpoint.endsWith("/flaky")) { const e = new Error("busy"); e.statusCode = 500; throw e; } },
  };
  r = await main({ VAPID_PRIVATE_KEY: " " + k.privateKey + "\n" }, { run, webpush, out, wait: async () => {} });
  ok("VAPID set with the site, the stored public key and the secret (spaces trimmed)", calls[0].vapid[0] === "https://esrealty.extraricestore.workers.dev" && calls[0].vapid[1] === k.publicKey && calls[0].vapid[2] === k.privateKey);
  const sends = calls.filter(c => c.sub);
  ok("each notification goes to each of the person's phones", sends.length === 5 && sends[0].sub.endpoint === "https://push.example/a" && sends[0].sub.keys.p256dh === "P1" && JSON.parse(sends[0].payload).url === "./index.html?open=leads" && sends[0].opts.TTL === 21600, JSON.stringify(sends.map(s => s.sub.endpoint)));
  ok("a phone the push service says is gone isn't tried again in the same run", !sends.some((s, i) => i > 1 && s.sub.endpoint.endsWith("/gone")));
  ok("a busy phone is tried three times in all", sends.filter(s => s.sub.endpoint.endsWith("/flaky")).length === 3);
  ok("notifications that reached a phone, or had none left to reach, are marked pushed; the one that failed everywhere is not (tried again next run)", queries.some(q => /update public\.notifications set pushed_at = now\(\)/.test(q) && q.indexOf("11111111-0000-0000-0000-000000000001") > 0 && q.indexOf("11111111-0000-0000-0000-000000000002") > 0 && q.indexOf("11111111-0000-0000-0000-000000000003") < 0));
  ok("gone phones are removed, others kept", queries.some(q => /delete from public\.push_subscriptions/.test(q) && q.indexOf("https://push.example/gone") > 0 && q.indexOf("flaky") < 0));
  ok("result and log: counts only, no titles or amounts", r.sent === 1 && r.failed === 1 && r.gone === 1 && r.marked === 2 && r.retry === 1 && /1 notifications will be tried again/.test(logs.join(" ")) && !/Maria|Rent|₱|push\.example/.test(logs.join(" ")), logs.join(" | "));

  // A failure that clears on the second try counts as sent.
  const { sendWithRetry } = require("../tools/send_push.js");
  let tries = 0;
  const waits = [];
  const sometimes = { sendNotification: async () => { tries++; if (tries < 2) { const e = new Error("busy"); e.statusCode = 503; throw e; } } };
  const second = await sendWithRetry(sometimes, {}, "{}", {}, async ms => waits.push(ms));
  ok("a push service that is busy once: sent on the second try, after a short wait", second.ok === true && tries === 2 && waits.length === 1 && waits[0] >= 1000);
  tries = 0;
  const badRequest = { sendNotification: async () => { tries++; const e = new Error("bad"); e.statusCode = 400; throw e; } };
  const bad = await sendWithRetry(badRequest, {}, "{}", {}, async () => {});
  ok("a bad request is not retried (it would fail the same way)", bad.failed === true && tries === 1);
  tries = 0;
  const timeout = { sendNotification: async () => { tries++; throw new Error("timeout"); } };
  const to = await sendWithRetry(timeout, {}, "{}", {}, async () => {});
  ok("a network error is tried three times, then reported failed", to.failed === true && tries === 3);
  const sentAll = fs.readFileSync(path.join(root, "tools/send_push.js"), "utf8");
  ok("the job turns red when nothing could be sent", /r\.failed > 0 && r\.sent === 0\) \{ console\.error\("::error::/.test(sentAll) && /process\.exit\(1\)/.test(sentAll));
  ok("each send gives up after 10 seconds", /timeout: 10000/.test(sentAll));

  const sw = read("sw.js");
  ok("service worker: shows the alert", /addEventListener\("push"/.test(sw) && /showNotification\(title/.test(sw));
  ok("service worker: a tap opens this site only, at the screen named", /addEventListener\("notificationclick"/.test(sw) && /target\.origin === self\.location\.origin \? target\.href : self\.registration\.scope/.test(sw) && /openWindow\(url\)/.test(sw));

  const app = read("js/app.js");
  ok("app: subscribes with the stored public key and saves through push_subscribe", /applicationServerKey: U\.b64urlBytes\(pushState\.key\)/.test(app) && /SB\.rpc\("push_subscribe", \{ p_endpoint: j\.endpoint, p_p256dh: j\.keys\.p256dh, p_auth: j\.keys\.auth/.test(app));
  ok("app: making keys saves only the public half", /SB\.rpc\("push_set_public_key", \{ p_key: k\.publicKey \}\)/.test(app) && !/rpc\([^)]*privateKey|from\([^)]*\)\.(insert|update|upsert)\([^)]*privateKey/.test(app));
  ok("app: a phone alert opens the screen it names, if the person may see it", /get\("open"\)/.test(app) && /open && \/\^\[a-z-\]\{2,30\}\$\/\.test\(open\) && navAllowed\(open\)/.test(app));
  ok("app: Settings has the Phone alerts card; the bell links to it", /html \+= pushCardHtml\(\);/.test(app) && /id="ntf-phone"/.test(app));

  const wf = read(".github/workflows/push-alerts.yml");
  ok("workflow: every 10 minutes, skipped until PUSH_ALERTS is on, pinned library", /cron: "\*\/10 \* \* \* \*"/.test(wf) && /if: vars\.PUSH_ALERTS == 'on'/.test(wf) && /web-push@3\.6\.7/.test(wf) && /VAPID_PRIVATE_KEY: \$\{\{ secrets\.VAPID_PRIVATE_KEY \}\}/.test(wf));

  console.log("\npush_alerts_node: " + passed + " checks passed");
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
