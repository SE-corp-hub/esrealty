/* Services 3D Light page (services-3d.html): static contract.
 * The page is a standalone campaign page next to the single-page app. What must stay true:
 *  - it runs under the site's Content-Security-Policy (no script from a CDN, only hosts the policy allows),
 *  - three.js is the vendored r147 copy, loaded without blocking first paint,
 *  - nothing on it pretends to send a request (no form); every call to action leads to a real route
 *    of the site, and the nine services match the Services menu (SERVICES in js/storefront.js),
 *  - the fallback phone and email match the site's built-in contact,
 *  - motion can be paused, reduced motion is respected, controls are at least 44 px. */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });

const html = read("services-3d.html");
const story = read("js/storefront.js");
const headers = read("_headers");
const sw = read("sw.js");

// --- document basics
c("html lang and viewport", /<html lang="en">/.test(html) && /name="viewport"[^>]*viewport-fit=cover/.test(html));
c("title names the site", /<title>[^<]*SEA ESTATES<\/title>/.test(html));
c("open to search engines now that the Services menu links it", !/noindex/.test(html));
c("no prototype leftovers", !/claude\.ai|Concept page|does not send anything|cowritten|claude:viewport/i.test(html));

// --- CSP
const csp = (headers.match(/Content-Security-Policy:\s*(.+)/) || [])[1] || "";
const directive = name => ((csp.match(new RegExp("(?:^|;)\\s*" + name + "\\s+([^;]+)")) || [])[1] || "").trim().split(/\s+/);
const hostOk = (url, dir) => {
  const u = new URL(url);
  return directive(dir).some(src => src === u.origin || (src.startsWith("https://*.") && u.hostname.endsWith(src.slice("https://*".length))));
};
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
c("every external script is on this site", scripts.length >= 1 && scripts.every(s => !/^https?:/i.test(s)), scripts.join(", "));
c("three.js comes from the vendor folder", scripts.length === 1 && scripts[0] === "vendor/three/three.min.js", scripts.join(", "));
c("three.js script is deferred", /<script src="vendor\/three\/three\.min\.js" defer><\/script>/.test(html));
c("the page starts after DOMContentLoaded (deferred scripts have run)", /document\.addEventListener\('DOMContentLoaded'/.test(html));
const three = read("vendor/three/three.min.js");
c("vendored three.js is r147", /REVISION="147"|REVISION=\w+/.test(three) && /"147"/.test(three) && /Three\.js Authors/.test(three.slice(0, 400)));
c("three.js licence kept beside it", /MIT License/i.test(read("vendor/three/LICENSE")));
const links = [...html.matchAll(/<link\b[^>]*\bhref="(https?:[^"]+)"/g)].map(m => m[1]);
c("stylesheets only from Google Fonts (allowed by style-src)", links.filter(l => /stylesheet|css2/.test(l)).every(l => hostOk(l, "style-src")), links.join(" "));
c("font files from fonts.gstatic.com are allowed (font-src)", hostOk("https://fonts.gstatic.com/s/x.woff2", "font-src"));
const fetched = [...html.matchAll(/fetch\('([^']+)'/g)].map(m => m[1]);
c("fetches only hosts connect-src allows", fetched.length === 1 && fetched.every(u => hostOk(u, "connect-src")), fetched.join(", "));
c("the contact fetch is the public site-settings endpoint", /listing-api\/api\/site-settings$/.test(fetched[0] || ""));
c("no other absolute URL is loaded", !/(?:src|href)="https?:\/\/(?!fonts\.g)/.test(html));
c("no inline handlers or eval", !/\son[a-z]+="/i.test(html) && !/\beval\(|new Function\(/.test(html));

// --- no pretend form
c("no form on the page", !/<form\b/i.test(html) && !/reqForm|formStatus/.test(html));
c("no leftover form styling", !/\.fld\b|\.consent\b/.test(html));

// --- nine services match the Services menu
const block = story.slice(story.indexOf("var SERVICES = ["), story.indexOf("];", story.indexOf("var SERVICES = [")));
const menu = [...block.matchAll(/href: "(#\/[^"]+)"/g)].map(m => m[1]);
c("the Services menu has nine entries", menu.length === 9, String(menu.length));
const chapters = [...html.matchAll(/<section class="chap" id="s(\d)"[\s\S]*?<a class="btn" href="([^"]+)"/g)].map(m => ({ i: +m[1], href: m[2] }));
c("nine chapters in order", chapters.length === 9 && chapters.every((x, k) => x.i === k), chapters.map(x => x.i).join());
const norm = h => h.replace(/^\.\//, "").replace(/&amp;/g, "&").replace(/&go=form$/, "");
c("each chapter button goes to the same place as its menu entry", chapters.length === 9 && chapters.every((x, k) => norm(x.href) === menu[k]), chapters.map((x, k) => norm(x.href) + " vs " + menu[k]).filter(s => s.split(" vs ")[0] !== s.split(" vs ")[1]).join(" | "));
c("selling-type buttons open the form on arrival", chapters.filter((x, k) => /property-value/.test(menu[k])).every(x => /&amp;go=form$/.test(x.href)));
const routes = ["home", "search", "project-bt", "privacy", "property-value"];
const internal = [...html.matchAll(/href="\.\/#\/([a-z-]+)/g)].map(m => m[1]);
const known = r => story.includes('"#/' + r) || story.includes('path === "' + r + '"') || story.includes('"' + r + '": ');
c("every link back into the site targets a real route", internal.length >= 8 && [...new Set(internal)].every(r => routes.indexOf(r) >= 0 && known(r)), [...new Set(internal)].join());
c("the closing card opens the real request form", /href="\.\/#\/property-value\?go=form">Open the request form</.test(html));

// --- contact
const phone = (story.match(/phone: "([^"]+)"/) || [])[1], email = (story.match(/email: "([^"]+)"/) || [])[1];
c("fallback phone matches the site's built-in contact", !!phone && html.includes(">" + phone + "<"), phone);
c("fallback email matches the site's built-in contact", !!email && html.includes(">" + email + "<"), email);
c("placeholder contact values are ignored like on the main site", /\+63 900 000 0000\|hello@esrealty/.test(html));

// --- motion, controls, accessibility
c("reduced motion is respected in CSS and script", /prefers-reduced-motion:reduce/.test(html) && /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/.test(html));
c("pause button exposes its state", /id="pauseBtn" aria-pressed="false"/.test(html) && /setAttribute\('aria-pressed'/.test(html));
c("previous and next buttons are named", /id="prevBtn" aria-label="Previous service"/.test(html) && /id="nextBtn" aria-label="Next service"/.test(html));
const dots = [...html.matchAll(/<button type="button" data-go="(\d)" aria-label="([^"]+)"/g)];
c("nine named dot buttons", dots.length === 9 && dots.every(d => d[2].length > 3), String(dots.length));
c("controls are at least 44 px", /\.hud button\{min-width:44px;min-height:44px/.test(html) && /\.dots button\{width:44px/.test(html) && /\.btn\{[^}]*min-height:52px/.test(html));
c("a visible focus ring", /:focus-visible\{outline:3px solid/.test(html));
c("canvas is hidden from assistive technology", /<canvas id="gl" aria-hidden="true">/.test(html));
c("no WebGL leaves the text readable (fallback class)", /no-gl/.test(html) && /\.no-gl #gl/.test(html));
c("every chapter has a heading and tags the reader can read as text", (html.match(/<h2 id="h\d?x?[a-z]*">/g) || []).length >= 10);

// --- served by the existing service worker rules
c("vendor files are cache-first in the service worker", /pathname\.startsWith\(SCOPE_PATH \+ "vendor\/"\)/.test(sw));

// --- phones: a menu (logo + menu button), and the tour bar stays off the hero's buttons
c("phone menu button says what it does and what it opens", /<button type="button" class="menu-btn" id="menuBtn" aria-expanded="false" aria-controls="menuPanel" aria-label="Open menu">/.test(html));
c("phone menu lists every page and the Value Guide", /<nav class="menu-panel" id="menuPanel" aria-label="Menu" hidden>[\s\S]*Home[\s\S]*Properties[\s\S]*Services[\s\S]*Project B\.T[\s\S]*Free Value Guide[\s\S]*?<\/nav>/.test(html));
c("the tour bar hides on phones while the hero's buttons show", /\.cta-visible \.hud\{opacity:0;/.test(html) && /root\.classList\.toggle\('cta-visible'/.test(html));
c("the menu closes with Escape", /e\.key === 'Escape' && !panel\.hidden/.test(html));

const ok = checks.every(x => x.ok) && checks.length >= 35;
console.log("\n[services_3d_node] " + checks.length + " checks");
checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : "  " + x.detail)));
console.log(ok ? "ALL PASS" : "FAILURES PRESENT");
process.exit(ok ? 0 : 1);
