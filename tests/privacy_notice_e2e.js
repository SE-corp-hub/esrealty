(async function () {
  var checks = [];
  var wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  var check = (name, ok, detail) => checks.push({ name: name, ok: !!ok, detail: detail || "" });
  window.__msChecks = checks;
  window.__msDone = false;
  setTimeout(function () { window.__msDone = true; }, 40000);
  try {
    location.hash = "#/privacy";
    await wait(650);
    var privacy = document.querySelector(".sf-privacy-page");
    var privacyText = privacy ? privacy.textContent : "";
    check("privacy route renders", !!privacy && /Privacy notice/i.test(privacyText), privacyText.slice(0, 70));
    check("privacy notice explains property-guide inputs", /BIR classification/.test(privacyText) && /property type/.test(privacyText), "guide inputs");
    check("privacy notice explains CRM/report handling", /Supabase/.test(privacyText) && /Resend/.test(privacyText), "CRM and delivery providers");
    check("privacy requests have a contact path", !!privacy && !!privacy.querySelector('a[href="#/property-value"]'), "contact form link");
    check("footer links to privacy notice", !!document.querySelector('.sf-footer a[href="#/privacy"]'), "footer link");

    location.hash = "#/home";
    await wait(500);
    /* Home's long form became a short band (2026-10-15); it sends people to the
       request form, whose consent links the notice (checked below). */
    check("homepage contact band leads to the request form", !!document.querySelector('#sf-contact a[href="#/property-value"]'), "band link");
    check("homepage states BIR independence", /independent of the BIR/i.test(document.body.textContent), "BIR notice");

    location.hash = "#/property-value";
    await wait(500);
    check("appraisal consultation consent links privacy notice", !!document.querySelector('.sf-pv-form a[href="#/privacy"]'), "property-value consent link");
    check("consultation CTA avoids promising a free formal appraisal", !/Request my free appraisal/i.test(document.body.textContent) && /Talk to our team|Request an appraisal consultation/.test(document.body.textContent), "consultation wording");
  } catch (error) {
    checks.push({ name: "privacy runner", ok: false, detail: String(error && error.message || error) });
  }
  window.__msOk = checks.every(c => c.ok) && checks.length > 0;
  window.__msDone = true;
})();
