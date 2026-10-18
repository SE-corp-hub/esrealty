// Small copies of listing photos (2026-10-18): new uploads are stored as
// <id>-full.<ext> with <id>-thumb.jpg next to them; lists and cards show the
// small copy and fall back to the full photo; older photos are unchanged.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? "  " + detail : "")); passed++; console.log("[PASS] " + name); };

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(read("js/util.js"), ctx);
const U = ctx.window.ESREALTY_UTIL;
const base = "https://x.supabase.co/storage/v1/object/public/listing-photos/u1/2b6f-4c1a";

ok("a new photo's small copy sits next to it", U.thumbUrl(base + "-full.jpg") === base + "-thumb.jpg");
ok("any image type maps to the JPEG copy", U.thumbUrl(base + "-full.png") === base + "-thumb.jpg" && U.thumbUrl(base + "-full.webp?v=2") === base + "-thumb.jpg?v=2");
ok("older photos keep their own address", U.thumbUrl(base + ".jpg") === base + ".jpg" && U.thumbUrl("https://images.unsplash.com/photo-1") === "https://images.unsplash.com/photo-1");
ok("a name that only contains 'full' elsewhere is left alone", U.thumbUrl("https://x/full-house.jpg") === "https://x/full-house.jpg" && U.thumbUrl("https://x/a-fully.jpg") === "https://x/a-fully.jpg");
ok("empty input stays empty", U.thumbUrl("") === "" && U.thumbUrl(null) === "");

const a = U.thumbAttrs(base + "-full.jpg", "this.remove()");
ok("the image asks for the small copy", a.indexOf('src="' + base + '-thumb.jpg"') === 0);
ok("it falls back to the full photo, then to onFail", a.indexOf('data-full="' + base + '-full.jpg"') > 0 && /onerror="if\(this\.dataset\.full\)\{var f=this\.dataset\.full;delete this\.dataset\.full;this\.src=f\}else\{this\.remove\(\)\}"/.test(a), a);
ok("older photos: plain src, onFail kept", U.thumbAttrs(base + ".jpg", "this.remove()") === 'src="' + base + '.jpg" onerror="this.remove()"' && U.thumbAttrs(base + ".jpg") === 'src="' + base + '.jpg"');
ok("addresses are escaped", U.thumbAttrs('https://x/a"b-full.jpg').indexOf("&quot;") > 0 && U.thumbAttrs('https://x/a"b-full.jpg').indexOf('a"b') < 0);

const app = read("js/app.js");
ok("upload: the photo is named -full when a small copy is made", /const path = base \+ \(small \? "-full\." : "\."\) \+ optimized\.ext;/.test(app));
ok("upload: the small copy goes up after the photo, through the retrying upload", /if \(small\) await storageUpload\("listing-photos", base \+ "-thumb\.jpg", small,/.test(app) && app.indexOf('if (small) await storageUpload') > app.indexOf('const { error } = await storageUpload("listing-photos", path'));
ok("upload: the small copy is 640 px JPEG", /640 \/ Math\.max\(img\.width, img\.height\)/.test(app) && /"image\/jpeg", 0\.72\)/.test(app));
ok("back office: listing cards and form previews use the small copy", /<img class="ls-photo-img" ' \+ thumbAttrs\(img, "this\.remove\(\)"\)/.test(app) && /<div class="ls-photo-thumb" data-photo-url="' \+ esc\(url\) \+ '"><img ' \+ thumbAttrs\(url\)/.test(app));
ok("back office: removing a photo uses its own address, not the small copy's", /thumb\.getAttribute\("data-photo-url"\)/.test(app));
ok("back office: the listing's own page keeps the full photos", /<img class="ls-car-img" src="' \+ esc\(u\) \+ '"/.test(app) && /<img class="ls-photo-img" src="' \+ esc\(img\) \+ '" alt="" onerror="this\.remove\(\)">/.test(app));

const sf = read("js/storefront.js");
ok("public site: cards and the compare view use the small copy", (sf.match(/<img ' \+ thumbAttrs\(image/g) || []).length >= 3 && /'<img ' \+ thumbAttrs\(images\[0\]\)/.test(sf));
ok("public site: the listing page's big photos stay full size", /<div class="sf-slide" aria-hidden="' \+ \(i \? "true" : "false"\) \+ '"><img src="' \+ esc\(image\) \+ '" alt="' \+ esc\(listing\.title\) \+ ' photo ' \+ \(i \+ 1\) \+ '"><\/div>'/.test(sf));

console.log("\nphoto_thumbs_node: " + passed + " checks passed");
