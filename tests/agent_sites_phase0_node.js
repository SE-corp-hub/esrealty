/* Agent websites, Phase 0: reply-time stamp and name lock (migration 0014), the settings
 * screen honouring the lock, and backend check failures shown as annotations.
 *
 *   node tests/agent_sites_phase0_node.js
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const c = (name, ok, detail) => {
  if (ok) { pass++; console.log("[PASS] " + name); }
  else { fail++; console.log("[FAIL] " + name + (detail ? " — " + detail : "")); }
};

const mig = read("supabase/migrations/0014_agent_sites_prep.sql");
c("0014 says to apply it after 0013", /AFTER 0013/.test(mig));
c("0014 adds the first-contact columns idempotently",
  /add column if not exists first_contacted_at timestamptz/.test(mig) && /add column if not exists first_contacted_by uuid/.test(mig));
c("0014 stamps first contact on insert and update",
  /create trigger crm_leads_first_contact\s+before insert or update on public\.crm_leads/.test(mig));
c("0014 drops its triggers before creating them (safe to run twice)",
  /drop trigger if exists crm_leads_first_contact/.test(mig) && /drop trigger if exists profiles_protect_name/.test(mig));
c("0014 locks the name of approved brokers and agents only",
  /old\.role in \('broker', 'agent'\)/.test(mig) && /old\.registration_status = 'approved'/.test(mig) && /not public\.is_super_admin\(\)/.test(mig));
c("migrations README lists 0014", /0014_agent_sites_prep\.sql/.test(read("supabase/migrations/README.md")));

const app = read("js/app.js");
c("settings: the name field is read-only when locked", /id="st-name"[^\n]*settingsNameLocked\(\) \? ' readonly/.test(app));
c("settings: a locked name is not sent on save", /if \(settingsNameLocked\(\)\) \{ delete payload\.full_name;/.test(app));
c("settings: only approved brokers and agents are locked",
  /function settingsNameLocked\(\) \{\s*return settingsLicenceLocked\(\) && \(userRole\(\) === "broker" \|\| userRole\(\) === "agent"\);/.test(app));

const check = read("supabase/check-backend.js");
c("backend check prints each failure as a GitHub annotation", /::error title=Backend check::/.test(check) && /process\.env\.GITHUB_ACTIONS/.test(check));

console.log(fail ? fail + "/" + (pass + fail) + " FAILED" : "ALL GREEN (" + pass + " checks)");
process.exit(fail ? 1 : 0);
