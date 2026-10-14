"use strict";
/* The applied market multiple, disclosed as one number.
 *
 * The public guide shows a BIR zonal reference and a market estimate with no
 * visible link between them. The link is a factor stack: (1 + corner) x
 * property-use proxy x market band x regional adjustment. This file pins that
 * stack for every use group the engine can reach, so a later disclosure task can
 * render it without re-deriving it.
 *
 * It then pins the disclosure itself: the builder in js/value_guide_reference.js
 * that owns the public copy, the multiple formatter, the guards that make it
 * refuse to speak at all when there is no usable multiple, the
 * accuracy-language rule from docs/batangas-value-guide-sources.md:50-58, and
 * the HTML the result screen and the report build-up actually emit for it.
 *
 * Fixture: the Bauan Poblacion III street rate already asserted by
 * tests/value_guide_reference_node.js:22 (birZonalRatePerSqm === 11500).
 */
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const EST = require("../js/estimator.js"), REF = require("../js/value_guide_reference.js");
const ROOT = path.join(__dirname, "..");
const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const config = read("data/zonal-config.json"), index = read("data/batangas-zonal.json"), md = read("data/bir-batangas/municipalities/bauan.json");
let count = 0;
async function checkAsync(name, fn) { await fn(); count++; console.log("[PASS] " + name); }
  function check(name, fn) { fn(); count++; console.log("[PASS] " + name); }
(async () => {
  const options = { municipality: "BAUAN", barangay: "POBLACION III", streetKey: "binay st ressurreccion st", classification: "RR", area: 100, type: "vacant_lot" };

  // residential, no corner — Binay St is 11,500/sqm, so the rate-ramped band
  // applies: 2.5 - ((11500-2000)/(25000-2000))*(2.5-1.4) = 2.045652...
  const RAMPED = 2.5 - ((11500 - 2000) / (25000 - 2000)) * (2.5 - 1.4);
  check("residential multiple is the rate-ramped band", () => {
    const r = EST.core.computeEstimate(config, index, md, options);
    assert.ok(Math.abs(r.appliedMultiple - RAMPED) < 1e-9);
  });
  check("residential factorStack is the rate-ramped band", () => {
    const r = EST.core.computeEstimate(config, index, md, options);
    assert.ok(Math.abs(r.factorStack - RAMPED) < 1e-9);
  });

  /* Every remaining use-group vector. The classification codes are the real BIR
     codes this fixture can resolve, not invented labels: RR and CR are street
     rates on Binay St; A50 ("Other Agricultural Lands") and I ("Industrial") are
     Poblacion III all-other-streets rates. Each maps to a distinct proxy factor
     and market band, which is what the multiples below are made of. */
  check("residential + corner multiple is the ramped band x 1.025", () => {
    const r = EST.core.computeEstimate(config, index, md, { ...options, corner: true });
    assert.ok(Math.abs(r.appliedMultiple - RAMPED * 1.025) < 1e-9);
    /* Full precision, not the rounded rate. On this vector rounding is visible:
       11500 x RAMPED x 1.025 is not a whole peso, so the rounded land rate over
       the zonal rate reads differently from the full-precision stack. */
    assert.notStrictEqual(r.factorStack, r.landPerSqm / r.birZonalRatePerSqm);
  });
  check("commercial multiple is 4.25", () => {
    const r = EST.core.computeEstimate(config, index, md, { ...options, classification: "CR" });
    assert.strictEqual(r.appliedMultiple, 4.25);
  });
  check("agricultural multiple is 0.75", () => {
    const r = EST.core.computeEstimate(config, index, md, { ...options, classification: "A50" });
    assert.strictEqual(r.appliedMultiple, 0.75);
  });
  check("industrial multiple is 2.7", () => {
    const r = EST.core.computeEstimate(config, index, md, { ...options, classification: "I" });
    assert.strictEqual(r.appliedMultiple, 2.7);
  });

  /* The identity is pinned on the corner vector FIRST. On a non-corner result
     corner.pct is 0, so (1 + corner) collapses to 1 and the identity holds no
     matter what the corner term does - it cannot tell a correct stack from one
     with the corner term deleted, or from one that divides the corner term by
     100. The corner vector is the only one where the term is non-zero, so it
     is the only one that has teeth.

     corner.pct is a FRACTION (0.025), not a percentage (2.5):
     data/zonal-config.json carries cornerLotPct: 0.025, js/estimator.js:169
     reads it straight into cornerPct, and :290 copies it into the result
     unscaled. Renderers scale it themselves (js/estimator.js:1321 rounds
     pct * 1000 / 10; js/value_guide_pdf.js:674 uses pct * 100). Dividing by 100
     here would be wrong twice over and is pinned by the corner.pct assertion.

     Teeth checked by mutation on 2026-10-04 (each mutation run against this
     file, then reverted): deleting the corner term from `expected` makes the
     corner check below FAIL, and restoring the `/ 100` makes it FAIL. Neither
     mutation is visible to the old non-corner-only assertion. */
  check("factorStack is the product of the disclosed factors, corner term included", () => {
    const r = EST.core.computeEstimate(config, index, md, { ...options, corner: true });
    assert.strictEqual(r.corner.pct, 0.025);
    const expected = (1 + r.corner.pct) * r.factors.proxyFactor * r.factors.bandMid * r.factors.regionalAdj;
    assert.ok(Math.abs(r.factorStack - expected) < 1e-12);
  });
  check("factorStack is the product of the disclosed factors, no corner term", () => {
    const r = EST.core.computeEstimate(config, index, md, options);
    assert.strictEqual(r.corner.pct, 0);
    const expected = (1 + r.corner.pct) * r.factors.proxyFactor * r.factors.bandMid * r.factors.regionalAdj;
    assert.ok(Math.abs(r.factorStack - expected) < 1e-12);
  });

  /* The indexed scenario is not a factor estimate: no market, region, corner or
     property-use multiplier is stacked onto it, so there is no multiple to
     disclose. null, not 0 and not a leftover factor value. */
  const indexed = { ...options, landMethod: "time-indexed", timeSource: "manual", timeAnnualPct: 5, timeBaseDate: "2022-07-23", timeTargetDate: "2026-10-03" };
  check("time-indexed land method discloses no multiple", () => {
    const r = EST.core.computeEstimate(config, index, md, indexed);
    assert.strictEqual(r.landMethod, "time-indexed");
    assert.strictEqual(r.appliedMultiple, null);
    assert.strictEqual(r.factorStack, null);
  });

  check("fixture is the known-good Bauan street rate", () => {
    const r = EST.core.computeEstimate(config, index, md, options);
    assert.strictEqual(r.birZonalRatePerSqm, 11500);
  });
  check("factorStack and appliedMultiple are the same disclosed number", () => {
    const r = EST.core.computeEstimate(config, index, md, options);
    assert.strictEqual(r.appliedMultiple, r.factorStack);
  });

  /* ===================================================================
     Task 2 - the disclosure builder and the accuracy-language guard.

     The builder is the single source of the public copy. The HTML result
     screen, the report build-up and the PDF all read this object and none of
     them restate the wording, so the three surfaces cannot drift apart.

     The copy is fixed by docs/specs/market-multiple-disclosure.md section 4
     and is reproduced here character for character. It is not paraphrased
     here, and it must not be paraphrased in js/value_guide_reference.js
     either: the limitation sentence ("likely too high for rural locations")
     is deliberately unflattering and softening it into vagueness would make
     the disclosure worthless. */
  const LABEL = "SEA ESTATES market band factor";
  const ASSUMPTION = "A SEA ESTATES planning assumption. It is not derived from completed sales and has not been reviewed by an independent qualified appraiser.";
  const LIMITATION = "The factor descends from 2.5x for low BIR rates toward 1.4x at 25,000/sqm and above, because high-BIR streets (beachfront, prime town centres) already carry their location premium in the BIR rate itself. It is a planning assumption, not a market-comparable calibration.";

  check("disclosure publishes the multiple and the verbatim copy", () => {
    const r = EST.core.computeEstimate(config, index, md, options);
    const d = REF.appliedMultipleDisclosure(r);
    assert.strictEqual(d.multiple, "2.04565");
    assert.strictEqual(d.multipleLabel, LABEL);
    assert.strictEqual(d.text, "2.04565\u00d7 the BIR reference for land");
    assert.strictEqual(d.assumption, ASSUMPTION);
    assert.strictEqual(d.limitation, LIMITATION);
  });

  /* Review Focus 1 and 2: the multiple is derived per result, never hardcoded.
     A corner lot is 2.5625, not 2.5, and agricultural is 0.75 - BELOW 1, which
     is why the copy must never imply the estimate is always the higher number.
     The text is built from whatever the stack resolved to, so all eight vectors
     are checked rather than just the residential one.

     The corner x non-residential vectors are here because that is the class
     that broke. 4 decimals renders 2.5 x 1.025 fine, so a formatter pinned
     only against residential+corner passed while publishing "4.3562x" for a
     commercial corner lot whose applied multiple was 4.35625. See the
     reconciliation check below. */
  const vectors = [
    ["residential", options, "2.04565"],
    ["residential + corner", { ...options, corner: true }, "2.09679"],
    ["commercial", { ...options, classification: "CR" }, "4.25"],
    ["commercial + corner", { ...options, classification: "CR", corner: true }, "4.35625"],
    ["agricultural", { ...options, classification: "A50" }, "0.75"],
    ["agricultural + corner", { ...options, classification: "A50", corner: true }, "0.76875"],
    ["industrial", { ...options, classification: "I" }, "2.7"],
    ["industrial + corner", { ...options, classification: "I", corner: true }, "2.7675"]
  ];
  vectors.forEach(([name, opts, expected]) => {
    check("disclosure multiple for " + name + " is " + expected, () => {
      const d = REF.appliedMultipleDisclosure(EST.core.computeEstimate(config, index, md, opts));
      assert.ok(d, "expected a disclosure");
      assert.strictEqual(d.multiple, expected);
      assert.strictEqual(d.text, expected + "\u00d7 the BIR reference for land");
    });
  });

  /* The point of publishing the multiple at all: a reader multiplies it by the
     BIR rate shown beside it and must land on the estimate. This pins that
     property directly instead of trusting the display strings above, so it
     catches a formatter that loses a digit the moment a new vector appears.

     Tolerance is 1e-4 because the disclosed number is the factorStack rounded
     to 5 decimals - the rate-ramped residential band is 2.0456521..., which
     rounds to 2.04565, so the two can differ by up to half of 1e-5. The defect
     this exists to catch is orders of magnitude larger: dropping a digit
     changes the multiple by 0.1 or more, which fails here by thousands of
     times the tolerance. */
  check("every disclosed multiple reconciles with the applied factor stack", () => {
    vectors.forEach(([name, opts]) => {
      const r = EST.core.computeEstimate(config, index, md, opts);
      const d = REF.appliedMultipleDisclosure(r);
      const shown = Number(d.multiple);
      assert.ok(Math.abs(shown - r.factorStack) < 1e-4,
        name + ": disclosed " + shown + " does not reconcile with applied " + r.factorStack);
      assert.ok(Math.abs(shown * r.birZonalRatePerSqm - r.factorStack * r.birZonalRatePerSqm) < 1e-6 + r.birZonalRatePerSqm * 5e-6,
        name + ": disclosed multiple x BIR rate does not reconcile with the applied build-up");
    });
  });

  /* The builder hands back the result's own factor object so the renderers can
     print the build-up that produced the multiple without recomputing it. */
  check("disclosure carries the result's own factors", () => {
    const r = EST.core.computeEstimate(config, index, md, { ...options, corner: true });
    const d = REF.appliedMultipleDisclosure(r);
    assert.strictEqual(d.factors, r.factors);
    assert.deepStrictEqual(d.factors, { proxyFactor: 1, bandMid: 2.0456521739130435, regionalAdj: 1 });
  });

  /* ------------------------------------------------------------------
     The refusal guards. Each check below hands the builder an input that
     ONLY the guard named in the comment can refuse, so removing that guard
     turns the check red. Inputs the brief lists but that several guards could
     each catch (a bare {} has no landMethod AND no multiple) are kept
     verbatim further down, but they are not the teeth.

     Mutation proof, run on 2026-10-04 against this file, each mutation
     applied to js/value_guide_reference.js and then reverted. Prefixed G so
     they cannot be confused with the M-numbered estimator/CSS mutations
     further down, which are a separate ledger:
        G1.  drop `!result`                    -> "no result at all" THROWS
        G2.  `!== "factor"` becomes `=== "time-indexed"` (deny-list)
                                            -> "unrecognised or absent land
                                                method" FAILS
        G3.  drop the isFinite check           -> "non-finite multiple" FAILS
        G4.  drop the `> 0` check              -> "zero multiple" and
                                                "negative multiple" FAIL
        G5.  drop the `|| {}` on factors       -> "defaults the factors object"
                                                FAILS
        G6.  copy factors instead of passing the result's own object through
                                            -> "carries the result's own
                                                factors" FAILS
        G7.  hardcode `shown = "2.5"`          -> the commercial, agricultural,
                                                industrial and corner vector
                                                checks FAIL
        G8.  round to 2 decimals               -> the corner vector check FAILS
        G9.  toFixed(5) instead of String()    -> "drops trailing zeros" FAILS
        G10. no rounding at all                -> "rounds to 5 decimals" FAILS
        G11. reword, soften or drop either fixed sentence
                                            -> "verbatim copy" FAILS
        G12. plant "accurate to +/-3%" in the label
                                            -> RED, but at the verbatim
                                                multipleLabel assertion, NOT at
                                                the accuracy guard - see the
                                                note below
        G13. round to 4 decimals               -> RED at "disclosure multiple
                                                for commercial + corner", the
                                                FIRST vector that needs five
                                                decimals, actual '4.3562' vs
                                                expected '4.35625'. The run
                                                aborts at the first throw, so
                                                nothing after it was observed
                                                failing in that run - in
                                                particular the two checks with
                                                the most teeth,
                                                "every disclosed multiple
                                                reconciles with the applied
                                                factor stack" and "formatMultiple
                                                rounds to 5 decimals", were not
                                                exercised to failure here.
                                                (added in fix round 1)

     G2 was GREEN on the first run. Every check then present was also
     satisfied by a deny-list on "time-indexed", because the indexed path and
     every unavailable result are separately refused by the value guards. The
     "unrecognised or absent land method" check was added to close that, and
     G2 re-run to confirm it is now RED. Recorded because the whole
     point of this file is that a guard nobody can distinguish from its
     opposite is not a guard.

     On G12: the accuracy guard has NO discriminating power over
     today's code. Every banned term is planted in one of the three fixed
     strings, and the verbatim assertions on `multipleLabel`, `assumption`
     and `limitation` fire first - 285 lines before the guard is reached
     (measured, not estimated: the assertion below is at line 422 and the
     verbatim `multipleLabel` assertion at line 137) - so the run goes RED
     without the guard ever executing. That is
     correct behaviour, not a defect: a banned term cannot reach the copy. But
     it does mean the guard proves nothing yet. Its value is forward-looking,
     for the sentences Tasks 3 and 4 compose, which are NOT pinned verbatim
     and therefore can only be policed by the regex. */

  // Guard 1: no result object at all.
  check("guard: no result at all discloses nothing", () => {
    assert.strictEqual(REF.appliedMultipleDisclosure(null), null);
    assert.strictEqual(REF.appliedMultipleDisclosure(undefined), null);
  });

  /* Guard 2: only the factor land method has a multiple to disclose.
     The value is 2.5 - finite and positive - so neither value guard can
     explain this refusal; removing the landMethod clause makes the builder
     announce a market band factor for an indexed scenario that never applied
     one. */
  check("guard: land method other than factor refuses even a usable multiple", () => {
    assert.strictEqual(REF.appliedMultipleDisclosure({ landMethod: "time-indexed", appliedMultiple: 2.5 }), null);
  });
  /* The landMethod guard is an allow-list, not a deny-list: an UNRECOGNISED
     method is refused too, and so is a missing one. Without this check the
     guard has no teeth - flipping `!== "factor"` to `=== "time-indexed"` keeps
     every other check green, because the indexed path and every unavailable
     result are separately caught by the value guards. What separates the two
     implementations is a result that carries a usable multiple under a land
     method that is not "factor", which is exactly what a future third method
     (one that does not apply the market band) would look like. For such a
     result "SEA ESTATES market band factor x the BIR reference" would be a
     false sentence, so the builder must stay silent. */
  check("guard: unrecognised or absent land method refuses even a usable multiple", () => {
    assert.strictEqual(REF.appliedMultipleDisclosure({ landMethod: "time-evidence", appliedMultiple: 2.5 }), null);
    assert.strictEqual(REF.appliedMultipleDisclosure({ landMethod: "", appliedMultiple: 2.5 }), null);
    assert.strictEqual(REF.appliedMultipleDisclosure({ appliedMultiple: 2.5 }), null);
  });
  check("guard: land method is absent on a real unavailable result", () => {
    const r = EST.core.computeEstimate(config, index, md, { ...options, classification: "ZZ" });
    assert.strictEqual(r.available, false);
    assert.strictEqual(r.reason, "no-data");
    assert.strictEqual(r.landMethod, undefined);
    assert.strictEqual(r.factors, undefined);
    assert.strictEqual(REF.appliedMultipleDisclosure(r), null); // must not throw
  });
  check("guard: a real time-indexed result discloses nothing", () => {
    const r = EST.core.computeEstimate(config, index, md, indexed);
    assert.strictEqual(REF.appliedMultipleDisclosure(r), null);
  });

  /* Guard 3: a non-finite multiple is refused. Infinity is the isolating
     input - Number(Infinity) > 0 is TRUE, so the positivity guard cannot
     catch it and only isFinite can. (NaN falls out of the positivity guard
     instead, which is why the NaN case is asserted separately below.) */
  check("guard: non-finite multiple is refused", () => {
    assert.strictEqual(REF.appliedMultipleDisclosure({ landMethod: "factor", appliedMultiple: Infinity }), null);
    assert.strictEqual(REF.appliedMultipleDisclosure({ landMethod: "factor", appliedMultiple: -Infinity }), null);
  });

  /* Guard 4: zero is not a usable multiple - "0x the BIR reference" is a
     number the reader would take literally. A negative multiple is refused
     for the same reason; the shipped engine cannot produce one, but the
     builder is a public entry point and must not render it if it ever did. */
  check("guard: zero multiple is refused", () => {
    assert.strictEqual(REF.appliedMultipleDisclosure({ landMethod: "factor", appliedMultiple: 0 }), null);
  });
  check("guard: negative multiple is refused", () => {
    assert.strictEqual(REF.appliedMultipleDisclosure({ landMethod: "factor", appliedMultiple: -1 }), null);
  });
  check("guard: absent multiple is refused", () => {
    assert.strictEqual(REF.appliedMultipleDisclosure({ landMethod: "factor" }), null);
  });

  /* Guard 5: missing factors are tolerated, not fatal. The brief's guard
     table reads as if absent factors should return null, but the same
     section says `factors` is "defaulted to {}" - and an unavailable result
     is already refused by guard 2, which the real no-data case above
     proves. So a factor-mode result still discloses; it just has no
     build-up to show. Deleting the `|| {}` fails the next check. */
  check("guard: a factor-mode result with no factors still discloses", () => {
    const d = REF.appliedMultipleDisclosure({ landMethod: "factor", appliedMultiple: 2.5 });
    assert.ok(d);
    assert.strictEqual(d.multiple, "2.5");
  });
  check("disclosure defaults the factors object to an empty object", () => {
    const d = REF.appliedMultipleDisclosure({ landMethod: "factor", appliedMultiple: 2.5 });
    assert.deepStrictEqual(d.factors, {});
  });

  /* The brief's hostile-input list, verbatim. Each of these returns null, but
     for the landMethod reason rather than the value reason - see the
     isolating guards above for the ones that pin the value guards. */
  check("hostile inputs from the brief disclose nothing", () => {
    assert.strictEqual(REF.appliedMultipleDisclosure({ landMethod: "time-indexed", appliedMultiple: null }), null);
    assert.strictEqual(REF.appliedMultipleDisclosure({}), null);
    assert.strictEqual(REF.appliedMultipleDisclosure({ appliedMultiple: null }), null);
    assert.strictEqual(REF.appliedMultipleDisclosure({ appliedMultiple: 0 }), null);
    assert.strictEqual(REF.appliedMultipleDisclosure({ appliedMultiple: NaN }), null);
    assert.strictEqual(REF.appliedMultipleDisclosure({ appliedMultiple: Infinity }), null);
  });

  /* ------------------------------------------------------------------
     The accuracy-language guard. This is what makes the rule in
     docs/batangas-value-guide-sources.md:50-58 enforceable instead of
     aspirational. Two halves, and both matter: a positive control proving
     the regex actually bites (a guard that can never match is a green lie),
     and the negative assertion on the real copy.

     Widened in Task 2 fix round 1. Three gaps let real variants through:
       - `\baccur\w*` has no word boundary inside "inaccurate", so the most
         natural way to break the rule - denying accuracy - was unguarded.
       - `\bprecision\b` missed "precise" and "precisely".
       - `within \d+\s*%` missed "within 5 percent", which is the spelled-out
         form a human writing prose is likelier to reach for.
     The published copy is fixed and contains none of these, so widening
     cannot produce a false positive today; it matters because Tasks 3 and 4
     introduce prose that is NOT pinned verbatim and can only be policed by
     this regex.

     Widened again in Task 3 fix round 1, adding `close to` and `exact match`.
     Task 2 declined them deliberately; Task 3 is the first task whose
     RENDERER owns prose, so the guard has to police it. Task 2's reason for
     declining - "they are not asserted, so the gap is invisible" - was the
     defect: a term the regex cannot catch looks identical to a clean copy
     until the day someone writes the phrase. Both are now asserted in the
     positive control below. Neither occurs in the fixed copy, so this cannot
     false-positive today. */
  /* Every term docs/batangas-value-guide-sources.md:56-57 prohibits in public
     copy, plus the accuracy stems that were already covered. The four the rule
     names - PVS-compliance, "evaluation standards", certified-accuracy,
     value-loss - are now all matched by the regex, not by reviewer
     convention: a guard that cannot match looks identical to a clean copy.
     Accepted asymmetry, unchanged: the regex cannot tell a claim from a denial,
     so "not PVS-compliant" also fails. That is deliberate. */
  const BANNED = /\b(?:in)?accur\w*|\bguarantee|\u00b1|\bwithin \d+\s*(?:%|percent)|\berror margin|\bprecis\w*|\bclose to\b|\bexact match\b|\bPVS[\s-]?(?:complian\w*|conform\w*)\b|\bvalue[\s-]?loss\b|\bevaluation standards\b/i;

  check("accuracy guard rejects every forbidden term (positive control)", () => {
    ["accurate", "accuracy", "accurately", "inaccurate", "inaccurately", "guarantee", "guaranteed",
     "\u00b1 5%", "within 5%", "within 10 %", "within 5 percent", "within 10 percent",
"error margin", "precision", "precise", "precisely",
      "close to", "exact match",
      "PVS-compliance", "PVS compliance", "PVS-compliant", "PVS conformant",
      "value-loss", "value loss", "evaluation standards"].forEach(phrase => {
      assert.ok(BANNED.test(phrase), "guard failed to catch " + JSON.stringify(phrase));
    });
  });

  /* One check per gap a fix round widened, so the widened pattern is itself
     pinned rather than merely present. Each asserts the specific variant the
     pre-fix pattern missed, which is the only way to catch a future
     well-meaning "simplification" back to the narrower regex. */
  check("accuracy guard catches the variants the narrow pattern missed", () => {
    /* Pre-fix `\baccur\w*` did not match: "in" runs straight into "accurate"
       with no word boundary. */
    assert.ok(BANNED.test("The estimate is not inaccurate"), "missed: inaccurate");
    assert.ok(BANNED.test("derived inaccurately"), "missed: inaccurately");
    /* Pre-fix `\bprecision\b` did not match. */
    assert.ok(BANNED.test("precise"), "missed: precise");
    assert.ok(BANNED.test("computed precisely"), "missed: precisely");
    /* Pre-fix `within \d+\s*%` did not match the spelled-out unit. */
    assert.ok(BANNED.test("within 5 percent"), "missed: within 5 percent");
    assert.ok(BANNED.test("within 10 percent"), "missed: within 10 percent");
    /* Never in the pattern at all, so nothing caught them until Task 3's fix
       round added the two alternatives. Both are ways of claiming closeness
       or exactness without using a word on the earlier list. */
    assert.ok(BANNED.test("The estimate is close to the BIR reference"), "missed: close to");
    assert.ok(BANNED.test("an exact match"), "missed: exact match");
    /* Never in the pattern at all until the final widening, so the four terms
       docs/batangas-value-guide-sources.md:56-57 actually prohibits reached the
       public copy unchecked. Each is a spelling of a prohibition the file
       claims to enforce. */
    assert.ok(BANNED.test("in PVS-compliance"), "missed: PVS-compliance");
    assert.ok(BANNED.test("stated in PVS compliance"), "missed: PVS compliance");
    assert.ok(BANNED.test("the guide is PVS-compliant"), "missed: PVS-compliant");
    /* The hyphen and the space are the same word to this file's authors and both
       occur in prose; the rule names the phrase with a hyphen. */
    assert.ok(BANNED.test("a value-loss claim"), "missed: value-loss");
    assert.ok(BANNED.test("a value loss claim"), "missed: value loss");
    assert.ok(BANNED.test("meets evaluation standards"), "missed: evaluation standards");
  });

  /* The published copy must survive the widened guard. Without this the
     widening above could be passing because it now matches something the
     disclosure legitimately says, which is a different defect from missing a
     banned term and would be just as invisible. */
  check("the widened accuracy guard does not match the fixed copy", () => {
    [LABEL, ASSUMPTION, LIMITATION, "2.04565\u00d7 the BIR reference for land"].forEach(phrase =>
      assert.strictEqual(BANNED.test(phrase), false, "the fixed copy now trips the guard: " + phrase));
  });

  check("no disclosure string claims accuracy", () => {
    const strings = [];
    vectors.forEach(([name, opts]) => {
      const d = REF.appliedMultipleDisclosure(EST.core.computeEstimate(config, index, md, opts));
      assert.ok(d, "expected a disclosure for " + name);
      strings.push(d.multiple, d.multipleLabel, d.text, d.assumption, d.limitation);
    });
    const blob = strings.join(" ");
    assert.strictEqual(BANNED.test(blob), false, "accuracy language leaked into: " + blob);
  });

  /* The formatter. Three independent teeth: it pads (toFixed) if the first
     check is broken, it drops precision if the first or second is, and it
     stops rounding entirely if the third is. The 5-decimal divisor is pinned
     by the corner x non-residential vectors above - 4.35625 and 0.76875 need
     five digits, and 2.5 x 1.025 alone would have passed at four. */
  check("formatMultiple drops trailing zeros and keeps corner precision", () => {
    assert.strictEqual(REF.formatMultiple(2.5), "2.5");
    assert.strictEqual(REF.formatMultiple(4.25), "4.25");
    assert.strictEqual(REF.formatMultiple(0.75), "0.75");
    assert.strictEqual(REF.formatMultiple(2.7), "2.7");
    assert.strictEqual(REF.formatMultiple(2.5625), "2.5625");
    assert.strictEqual(REF.formatMultiple(2.7675), "2.7675");
  });
  check("formatMultiple rounds to 5 decimals", () => {
    assert.strictEqual(REF.formatMultiple(2.123456789), "2.12346");
    assert.strictEqual(REF.formatMultiple(2.562500001), "2.5625");
    assert.strictEqual(REF.formatMultiple(2.999999), "3");
    /* The lossy case that motivated the divisor: at 4 decimals these both
       truncated. */
    assert.strictEqual(REF.formatMultiple(4.356249999999999), "4.35625");
    assert.strictEqual(REF.formatMultiple(0.7687499999999999), "0.76875");
  });

  /* ===================================================================
     Task 3 - the HTML render.

     The result screen and the report build-up are one string concatenation
     each, inside functions that are not exported, so a source grep can only
     ever say that some characters exist somewhere in the file. The checks
     below drive the real renderer instead. js/estimator.js is loaded into a
     vm context with a minimal document, the wizard state is set the way
     runEstimate() sets it, and renderLayout() is asked for screen 4. What
     comes back is the exact innerHTML the reader sees, with nothing inside
     the renderer stubbed or re-implemented.

     Only the disclosure builder is wrapped, in two ways: permanently, to
     count calls per render, and temporarily, with a marked copy, to prove
     the markup prints what the builder returned rather than a second copy
     of the words.

     This is what gives the accuracy guard above its teeth. Over the
     published copy it never executes, because the verbatim assertions fire
     first - see the note there. Over the RENDERED text it does run, and a
     banned word planted in the renderer's own connective prose reaches it.
     Mutation proof for that is recorded on the check itself.

     M-series, DEFINED HERE. The G-series above is the reference module's own
     guards; this is the js/estimator.js renderer's ledger, and it is a
     separate set - G12 and M12 are not the same kind of thing (see the G12
     entry, which is a counter-example rather than mutation evidence). All
     were applied to js/estimator.js on 2026-10-04 and reverted. The run
     aborts at the first throw, so only the check named in each entry was
     OBSERVED red:
        M2.  replaced the null branch of the result block with an empty
             `<div class="sf-est-result-multiple"></div>`
             -> "a time-indexed result renders no disclosure element at all"
                FAILS, on the empty-element assertion. Nothing before it.
        M3.  moved the builder call inside the string concatenation
             -> "the disclosure is resolved once per render, not once per
                interpolated field" FAILS, "resolved the disclosure 5 times".
        M4.  replaced the label with a hardcoded byte-identical literal
             -> "the markup prints the builder's own strings" FAILS, 6 of 7
                marks. Every verbatim check stayed green.
        M5.  dropped esc() on multipleDisclosure.text alone
             -> "every interpolated disclosure value is escaped" FAILS.
        M12. scaled the printed BIR base by 1.5
             -> "the rendered multiple reconciles with the rendered BIR base
                and land rate" FAILS on the arithmetic alone.
        M13. rewrote the build-up emission as
             `var multipleNoteHtml = (true ? multipleDisclosure : ...)` -
             behaviourally identical, no longer the guarded shape
             -> "source: both render sites resolve the disclosure and guard on
                it" FAILS.
        M14. added a third, unreachable resolution site
             -> "source: both render sites resolve the disclosure and guard on
                it" FAILS on the site count (3). The behavioural count check
                stayed green at 2, which is why the source check exists.

     M1, M6-M11 were never assigned: the numbering came from a scratch review
     ledger, not from a plan, so it has gaps. Nothing here depends on a label
     being contiguous. M20-M29 (the PDF renderer) are defined in the Task 4
     block below. */

  const card = { innerHTML: "", dataset: {}, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} };
  const sandbox = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    location: { hash: "#/home" },
    /* loadJSON() fetches repo-relative URLs, which Node's fetch rejects. The
       same bytes are served from disk instead; no value is faked. */
    fetch: url => {
      const file = path.join(ROOT, String(url).replace(/^\//, ""));
      return Promise.resolve({ ok: fs.existsSync(file), json: () => Promise.resolve(JSON.parse(fs.readFileSync(file, "utf8"))) });
    }
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext("globalThis.window = globalThis; globalThis.self = globalThis;", sandbox);
  /* js/estimator.js mounts itself at load time whenever a document already
     exists, so the document is injected AFTER the module has run and mount()
     never fires. Every read of `document` inside the renderer happens at call
     time, so renderLayout() still finds the card. util.js and the three
     value-guide modules are the browser <script> tags from index.html, in
     order, so referenceTools is the same object the page uses. */
  ["js/util.js", "js/value_guide_finance.js", "js/value_guide_evidence.js", "js/value_guide_reference.js", "js/estimator.js"]
    .forEach(file => vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), sandbox, { filename: file }));
  sandbox.document = {
    querySelector: sel => (sel === "[data-est-card]" ? card : null),
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ setAttribute() {}, addEventListener() {}, classList: { toggle() {} } }),
    documentElement: { classList: { add() {}, remove() {} } },
    body: { classList: { add() {}, remove() {} } },
    getElementById: () => null
  };
  const browserEST = sandbox.ESREALTY_EST;
  const disclosure = sandbox.ESREALTY_REFERENCE;

  await browserEST.loadData();
  const muniData = await browserEST.loadMunicipality("bauan");
  const referenceTables = browserEST.reference();
  const muniRow = browserEST.municipalityRow("BAUAN");

  let disclosureCalls = 0;
  const realDisclosure = disclosure.appliedMultipleDisclosure;
  const countingDisclosure = function (result) { disclosureCalls += 1; return realDisclosure(result); };
  disclosure.appliedMultipleDisclosure = countingDisclosure;

  function renderScreen(opts) {
    const state = browserEST._state();
    const result = browserEST.core.computeEstimate(referenceTables.config, referenceTables.index, muniData, opts);
    result.integrity = browserEST.core.integrityCheck(result);
    Object.assign(state, {
      municipality: "BAUAN", barangay: opts.barangay, streetLabel: "Binay St Ressurreccion St",
      classification: opts.classification, area: opts.area, type: opts.type || "vacant_lot",
      corner: !!opts.corner, landMethod: opts.landMethod || "factor",
      timeSource: opts.timeSource, timeAnnualPct: opts.timeAnnualPct,
      timeBaseDate: opts.timeBaseDate, timeTargetDate: opts.timeTargetDate,
      leadOpen: false, leadSubmitted: false, pricingUnlocked: true,
      muniRow: muniRow, muniData: muniData
    });
    state.result = result;
    state.screen = 4;
    card.innerHTML = "";
    disclosureCalls = 0;
    browserEST.debug.render(4);
    return card.innerHTML;
  }

  /* The residential vector and the commercial corner vector. The second is not
     decoration: 4.35625 is the vector that a 4-decimal formatter truncates, so
     it is the one that proves the RENDERED number reconciles with the rendered
     build-up rather than merely looking plausible. */
  const factorHtml = renderScreen(options);
  const cornerCommercialHtml = renderScreen({ ...options, classification: "CR", corner: true });
  const indexedHtml = renderScreen(indexed);
  /* A house and lot, on the web as well as in the PDF. This is the vector that
     made the unqualified sentence wrong, so every check below that reads it
     needs a screen that actually renders it. 100 sqm lot, 180 sqm floor,
     mixed CHB, 2 storeys, 6-10 yrs. */
  const webHouseOptions = Object.assign({}, options, { type: "house_lot", floorArea: 180, ageBand: "6-10", floors: "2", construction: "mixed_chb" });
  const houseHtml = renderScreen(webHouseOptions);

  const RESULT_BLOCK = /<div class="sf-est-result-multiple">[\s\S]*?<\/div>/;
  const NOTE_BLOCK = /<p class="sf-est-multiple-note">[\s\S]*?<\/p>/;
  const LIMIT_BLOCK = /<p class="sf-est-multiple-limit">[\s\S]*?<\/p>/;
  const stripTags = html => html.replace(/<[^>]*>/g, "");
  const peso = value => Number(String(value).replace(/[^\d.]/g, ""));
  const DISCLOSURE_BLOCKS = [RESULT_BLOCK, NOTE_BLOCK, LIMIT_BLOCK];

  /* ---- the accuracy rule, applied to what is actually rendered ----
     FIRST, deliberately. Over the published copy the verbatim assertions
     elsewhere in this file fire long before any regex, so the guard never
     executes (see the G12 note above). The connective prose around the
     three blocks below is the RENDERER's, and this is the only check that reads
     it, so this has to run before the verbatim pins or it can never be reached.

     Mutation proof, run on 2026-10-04 against this file: inserting "accurate
     to the printed build-up" into that connective prose in js/estimator.js
     makes THIS check fail and nothing before it, with the offending sentence
     in the assertion message. Inserting the same word anywhere the verbatim
     pins already cover would be caught by those pins first, which is correct
     but proves nothing about this guard - so the mutation had to land here. */

  check("no rendered disclosure text claims accuracy", () => {
    const words = [];
    [factorHtml, cornerCommercialHtml].forEach(html => {
      DISCLOSURE_BLOCKS.forEach(re => {
        const found = re.exec(html);
        assert.ok(found, "missing disclosure markup on the rendered screen: " + re.source);
        words.push(stripTags(found[0]));
      });
    });
    const blob = words.join(" ");
    assert.strictEqual(BANNED.test(blob), false, "accuracy language rendered into: " + blob);
  });

  /* ---- the result screen ---- */

  check("result screen renders the multiple immediately after the BIR block", () => {
    assert.ok(/sf-est-result-bir/.test(factorHtml), "the BIR block is gone from the result screen");
    /* A SIBLING of the BIR block, not a child: the disclosure qualifies the BIR
       figure, so it must not be nested inside the BIR card. The assertion is
       the closing </div> immediately followed by the opening <div>, which is
       what makes it a sibling rather than merely adjacent. */
    assert.ok(/<\/div><div class="sf-est-result-multiple">/.test(factorHtml),
      "the disclosure is not emitted immediately after the BIR block");
  });

  check("result screen prints the label, the multiple and the assumption verbatim, in that order", () => {
    const block = RESULT_BLOCK.exec(factorHtml);
    assert.ok(block, "no .sf-est-result-multiple on the result screen");
    /* Whole-element equality, not three substring tests: the element order is
       part of the contract (label, then the number, then the qualifier) and a
       substring test cannot see a reordering. */
    assert.strictEqual(block[0],
      '<div class="sf-est-result-multiple"><b>' + LABEL + '</b><span>2.04565\u00d7 the BIR reference for land</span><small>' + ASSUMPTION + '</small></div>');
  });

  /* ---- the report land build-up ---- */

  check("report land build-up renders the multiple, after the effective land rate row", () => {
    assert.ok(/Land value build-up/.test(factorHtml), "the land build-up section is gone from the report");
    const section = /Land value build-up[\s\S]*?<\/section>/.exec(factorHtml);
    assert.ok(section, "the land build-up section did not render");
    /* Positions, not "does this string appear somewhere". An earlier version
       used loose [\s\S]*? chains, and a build-up that printed the note TWICE -
       once above the breakdown and once below the rate - satisfied them. Each
       needle is therefore required to appear exactly once, and in order: the
       disclosure explains the product on the row above it. */
    const at = function (needle, label) {
      const first = section[0].indexOf(needle);
      assert.ok(first > -1, label + " is missing from the land build-up section");
      assert.strictEqual(section[0].split(needle).length - 1, 1, label + " appears more than once in the land build-up section");
      return first;
    };
    const breakdown = at("sf-est-breakdown", "the factor breakdown");
    const coverage = at("sf-est-coverage", "the effective land rate row");
    const note = at("sf-est-multiple-note", "the multiple note");
    const limit = at("sf-est-multiple-limit", "the multiple limitation");
    assert.ok(coverage > breakdown, "the effective land rate row moved above the factor breakdown");
    assert.ok(note > coverage, "the multiple note does not follow the effective land rate row");
    assert.ok(limit > note, "the multiple limitation does not follow the multiple note");
  });

  check("report land build-up prints the note and the limitation verbatim", () => {
    const note = NOTE_BLOCK.exec(factorHtml), limit = LIMIT_BLOCK.exec(factorHtml);
    assert.ok(note, "no .sf-est-multiple-note in the report");
    assert.ok(limit, "no .sf-est-multiple-limit in the report");
    assert.strictEqual(stripTags(note[0]), LABEL + " \u2014 2.04565\u00d7 the BIR reference for land. " + ASSUMPTION);
    assert.strictEqual(stripTags(limit[0]), LIMITATION);
  });

  /* ---- the reconciliation, on the screen the reader sees ---- */

  check("the rendered multiple reconciles with the rendered BIR base and land rate", () => {
    /* The point of publishing the multiple: a reader multiplies it by the BIR
       rate printed on the same screen and must land on the land rate printed on
       that same screen. Checking the three numbers against each other is the
       only assertion here that can see a screen whose figures no longer
       multiply out.

       Teeth: M12 on 2026-10-04 scaled the printed BIR base by 1.5 in
       js/estimator.js. Every verbatim pin, the sentinel count and the escaping
       checks all stayed green - the words really are the builder's - and this
       check went red on the arithmetic alone.

       The 0.5 tolerance is money()'s own: it prints two decimals, so the
       displayed rate is the product to within half a cent. For scale, the 4-
       decimal truncation of the 5-decimal commercial corner vector moves the
       product by 0.98 (4.3562 x 19,500 = 84,945.90 against a printed
       84,946.88), so a formatter that lost that digit could not hide here
       either - although in practice the verbatim pin above catches a formatter
       change first. */
    [["residential", factorHtml], ["commercial + corner", cornerCommercialHtml]].forEach(pair => {
      const name = pair[0], html = pair[1];
      const shown = /class="sf-est-result-multiple"><b>[^<]*<\/b><span>([\d.]+)\u00d7/.exec(html);
      const base = /sf-est-breakdown"><span>\u20b1([\d,.]+)\/sqm BIR base/.exec(html);
      const rate = /Effective land rate <b>\u20b1([\d,.]+) \/sqm/.exec(html);
      assert.ok(shown && base && rate, name + ": could not read the multiple, the BIR base and the land rate off the rendered screen");
      const multiple = Number(shown[1]), birRate = peso(base[1]), landRate = peso(rate[1]);
      assert.ok(Math.abs(multiple * birRate - landRate) <= 0.5,
        name + ": the screen shows " + multiple + " \u00d7 " + birRate + " = " + (multiple * birRate) + " but " + landRate + " /sqm on the same screen");
    });
  });

  /* ---- the sentence has to say which part of the value it explains ----

     Review finding, reproduced on the real engine before the fix: for
     house_lot the result screen shows a headline TOTAL of 6,655,000 and, two
     lines under the BIR figure, "SEA ESTATES market band factor: 2.5x the BIR
     reference". A reader multiplying 2.5 x 1,150,000 gets 2,875,000 - a 125.2%
     gap against the headline - and neither the label nor the sentence said
     anything was missing from the product. The multiple IS a land factor: the
     stack multiplies the lot area, and the building component is computed
     separately in js/estimator.js. So the sentence must name the land.

     Three assertions, and each can fail on its own:
       - the arithmetic: multiple x birZonalValue === landValue. This is what
         makes "for land" true rather than a hedge, and it is checked on the
         result object, where the engine's own numbers are.
       - the negative: that same product !== total. Without it the assertion
         above also passes for a factor that happens to explain the whole
         property, which is the reading the sentence has to exclude.
       - the published string: d.text and the rendered block both end in
         "for land", and the rendered block is checked on the house-and-lot
         screen - the surface the defect was found on.

     Teeth, verified by mutation on 2026-10-04: reverting `text` in
     js/value_guide_reference.js to the unqualified sentence turns this RED on
     the rendered-string assertion (and on the verbatim copy pin at line 141,
     which is why the arithmetic assertions are here too - they are the ones
     that survive a copy edit and keep meaning). Widening the multiple to the
     total turns it RED on the negative assertion. Deleting the word "land"
     from `multipleLabel` only would NOT turn it red, which is intended: the
     label is deliberately unqualified. */
  check("the disclosed multiple explains the land, not the total", () => {
    const r = EST.core.computeEstimate(config, index, md, webHouseOptions);
    const d = REF.appliedMultipleDisclosure(r);
    assert.strictEqual(r.type, "house_lot", "the fixture stopped being a house and lot");
    /* Pinned so the check cannot pass on a degenerate result where land and
       total coincide (a zero improvement value). */
    assert.ok(r.total > r.landValue, "the house fixture no longer has a building component, so land === total and this check proves nothing");
    const product = Number(d.multiple) * r.birZonalValue;
    /* The disclosed multiple is rounded to 5 decimals, so a reader multiplying it
       by the BIR base lands within a few pesos of the full-precision land value:
       2.04565 x 1,150,000 = 2,352,497.5 vs the applied 2.0456521... x 1,150,000 =
       2,352,500. The contract is "the reader reproduces the estimate", so the
       drift must stay within display rounding (a few pesos), never a multiple
       of the land value. */
    assert.ok(Math.abs(product - r.landValue) < 5,
      "the disclosed-multiple product " + product + " drifts more than display rounding from the land value " + r.landValue);
    assert.notStrictEqual(product, r.total,
      "the multiple reproduces the total, so \"for land\" would be false: " + product + " === " + r.total);
  });

  check("the published sentence and the rendered result screen both say 'for land'", () => {
    const d = REF.appliedMultipleDisclosure(EST.core.computeEstimate(config, index, md, webHouseOptions));
    assert.ok(/\u00d7 the BIR reference for land$/.test(d.text), "the published sentence is " + JSON.stringify(d.text));
    /* The label is asserted UNCHANGED and unqualified on purpose: the report
       and PDF build-up print it beside a "Land value" row that already scopes
       it, so qualifying the label would read worse there. */
    assert.strictEqual(d.multipleLabel, LABEL, "multipleLabel must stay exactly " + JSON.stringify(LABEL));
    const block = RESULT_BLOCK.exec(houseHtml);
    assert.ok(block, "no .sf-est-result-multiple on the house and lot result screen");
    assert.strictEqual(block[0],
      '<div class="sf-est-result-multiple"><b>' + LABEL + '</b><span>2.04565\u00d7 the BIR reference for land</span><small>' + ASSUMPTION + '</small></div>');
    /* The screen the reader reconciles against: the printed total and the
       printed multiple side by side, and the product is nowhere near it. This
       is the 131.5% gap, read off the rendered HTML rather than the engine. */
    const headline = /class="sf-est-result-value">(₱[\d,]+)</.exec(houseHtml);
    assert.ok(headline, "could not read the headline total off the house and lot result screen");
    /* 2,352,500 land (11,500 x 100 x the 2.04565 rate-ramped band) + 2,304,000
       building (16,000 x 180 sqm x 80% remaining; CHB was 25,000 until
       2026-10-14) = 4,656,500. The storeys
       multiplier was 1.05 until Task 4 removed it, and the flat 2.5x band
       became the rate ramp in 2026.10.5. The headline is read off the rendered
       HTML rather than the engine, so it tracks whatever the model now
       produces; this assertion names the number a reader can reconcile by hand
       from the printed rows. */
    assert.strictEqual(Number(peso(headline[1])), 4656500,
      "the rendered headline is " + headline[1] + ", not the 4,656,500 the printed rows reconcile to");
    assert.notStrictEqual(Number(peso(headline[1])), 2352500,
      "the rendered total equals the land product, so this screen is not the vector the finding was reproduced on");
  });

  /* The precondition the reconciliation above silently assumes.
     js/estimator.js prints the build-up's base from r.reference.value, but the
     reader multiplies by the CARD's r.birZonalRatePerSqm - two different result
     fields, two different places on the screen. They are equal for this fixture
     (11,500 === 11,500) and nothing else in this file said so, so if they ever
     diverged the arithmetic in the sentence above the disclosure would silently
     become wrong while every other check stayed green: the reconciliation would
     still be internally consistent (it multiplies the build-up base by the
     disclosed multiple), and every verbatim pin would still pass.

     This is asserted on the RENDERED strings, not on the result object, because
     the thing that can diverge is the two render sites. Both screens are
     checked, and both figures are produced by the same money(), so the printed
     forms must be identical strings - a numeric tolerance would hide a
     formatting drift that changes what the reader reads. */
  check("the build-up's BIR base is the same figure the card prints as its per-sqm rate", () => {
    [["residential", factorHtml], ["commercial + corner", cornerCommercialHtml]].forEach(pair => {
      const name = pair[0], html = pair[1];
      const card = /sf-est-result-bir"><span>[^<]*<\/span><b>[^<]*<\/b><small>\u20b1([\d,.]+)\/sqm/.exec(html);
      const buildUp = /sf-est-breakdown"><span>\u20b1([\d,.]+)\/sqm BIR base/.exec(html);
      assert.ok(card && buildUp, name + ": could not read both BIR figures off the rendered screen");
      assert.strictEqual(buildUp[1], card[1],
        name + ": the build-up multiplies by " + buildUp[1] + "/sqm but the card shows the reader " + card[1] + "/sqm");
    });
  });

  /* ---- Review Focus 3: a null disclosure renders NOTHING ---- */

  check("a time-indexed result renders no disclosure element at all", () => {
    /* Teeth: M2 on 2026-10-04 replaced the null branch of the result
       block with an empty <div class="sf-est-result-multiple"></div> - exactly
       the Review Focus 3 defect, "no element at all" quietly becoming "an empty
       element". This check went red on it and nothing before it. */
    assert.ok(indexedHtml.length > 5000, "the indexed screen did not render at all (" + indexedHtml.length + " chars) - the check below would pass vacuously");
    assert.ok(/Indexed-reference planning scenario/.test(indexedHtml), "the indexed screen did not render its own summary heading");
    [RESULT_BLOCK, NOTE_BLOCK, LIMIT_BLOCK].forEach(re => {
      assert.strictEqual(re.exec(indexedHtml), null, "the indexed screen still emits " + re.source);
    });
    assert.strictEqual(indexedHtml.indexOf("0\u00d7"), -1, "the indexed screen renders a 0x multiple");
    assert.strictEqual(indexedHtml.indexOf("sf-est-result-multiple"), -1, "an empty disclosure element survived on the indexed screen");
  });

  /* ---- the markup prints the builder's words, not a second copy ---- */

  check("the markup prints the builder's own strings", () => {
    /* Every field the builder returns is marked. If the renderer carried its
       own copy of the words - or recomputed the multiple - the marker would be
       missing, and if it dropped or duplicated a field the count would be off.
       This is the check that would catch Task 3 quietly forking the copy from
       Task 2, and the verbatim pins above cannot see it: M4 on
       2026-10-04 replaced the label with a hardcoded literal that happened to
       be byte-identical, so every verbatim check stayed green and this one went
       red on 6 of 7. */
    disclosure.appliedMultipleDisclosure = function (result) {
      const d = realDisclosure(result);
      if (!d) return null;
      return {
        multiple: d.multiple + " SENTINEL", multipleLabel: d.multipleLabel + " SENTINEL", text: d.text + " SENTINEL",
        assumption: d.assumption + " SENTINEL", limitation: d.limitation + " SENTINEL", factors: d.factors
      };
    };
    try {
      const html = renderScreen(options);
      const marked = (html.match(/SENTINEL/g) || []).length;
      /* label + text in the result block, then assumption there: 3. The report
         note repeats label + text + assumption and the limit adds limitation:
         4. Seven in total. */
      assert.strictEqual(marked, 7, "expected the builder's 7 interpolated fields to be marked, found " + marked);
    } finally {
      disclosure.appliedMultipleDisclosure = countingDisclosure;
    }
  });

  check("every interpolated disclosure value is escaped", () => {
    /* Teeth: M5 on 2026-10-04 dropped the esc() on one field only -
       multipleDisclosure.text - and this check went red on it. */
    disclosure.appliedMultipleDisclosure = function (result) {
      const d = realDisclosure(result);
      if (!d) return null;
      return {
        multiple: d.multiple, multipleLabel: '<img src=x onerror="boom">',
        text: "<script>boom</" + "script>", assumption: "a & b < c > d ' e",
        limitation: "<b>limitation</b> & co", factors: d.factors
      };
    };
    try {
      const html = renderScreen(options);
      assert.strictEqual(html.indexOf("<script>boom<"), -1, "the multiple text was interpolated without esc()");
      assert.strictEqual(html.indexOf('<img src=x onerror="boom">'), -1, "the label was interpolated without esc()");
      assert.ok(html.indexOf("&lt;script&gt;boom&lt;/script&gt;") !== -1, "the escaped multiple text is missing from the result screen");
      assert.ok(html.indexOf("&lt;img src=x onerror=&quot;boom&quot;&gt;") !== -1, "the escaped label is missing from the result screen");
      assert.ok(html.indexOf("a &amp; b &lt; c &gt; d &#39; e") !== -1, "the escaped assumption is missing");
      assert.ok(html.indexOf("&lt;b&gt;limitation&lt;/b&gt; &amp; co") !== -1, "the escaped limitation is missing");
    } finally {
      disclosure.appliedMultipleDisclosure = countingDisclosure;
    }
  });

  check("the disclosure is resolved once per render, not once per interpolated field", () => {
    renderScreen(options);
    /* Two render sites, two resolutions: the result summary and the report
       build-up. A renderer that called the builder inside the concatenation
       scores 5 here - once for the guard plus once per field - and the count
       grows every time the markup gains an interpolation.

       Teeth: M3 on 2026-10-04 moved the call inside the concatenation
       in js/estimator.js, exactly as described, and this check went red with
       "resolved the disclosure 5 times". */
    assert.strictEqual(disclosureCalls, 2,
      "a full screen render resolved the disclosure " + disclosureCalls + " times; it must resolve once per render site");
  });

  /* ---- the spec's static source guards, kept alongside the real ones ---- */

  /* A shape check, not behavioural coverage, and labelled as such. It earns
     its place for one thing the rendered screen cannot see: a disclosure
     resolved somewhere the screen never reaches. Everything about WHAT is
     printed is pinned by the assertions above.

     Teeth: M13 on 2026-10-04 rewrote the build-up emission as
     `var multipleNoteHtml = (true ? multipleDisclosure : multipleDisclosure)`
     - behaviourally identical, no longer matching the guarded shape - and the
     guard assertion below turned red on it.

     The resolution-COUNT assertion is the STRONGER of the two count checks,
     not the weaker. The behavioural check above only counts calls made while
     rendering screen 4, so a third resolution site anywhere else in
     js/estimator.js - a function no screen reaches, or one reached by a route
     this harness does not drive - leaves it at 2 and turns only this
     assertion red (M14). This one counts the sites in the file itself, so it
     fails on that mutation on its own. */
  const estSrc = fs.readFileSync(path.join(ROOT, "js/estimator.js"), "utf8");
  check("source: both render sites resolve the disclosure and guard on it", () => {
    const resolutions = estSrc.split("referenceTools.appliedMultipleDisclosure(").length - 1;
    assert.strictEqual(resolutions, 2, "expected exactly 2 resolution sites in js/estimator.js, found " + resolutions);
    assert.ok(/var multipleDisclosure = referenceTools\.appliedMultipleDisclosure\(/.test(estSrc), "the disclosure is not resolved into a named local");
    assert.ok(/var multipleHtml = multipleDisclosure\s*\n?\s*\?/.test(estSrc), "the result-screen emission is not guarded on the disclosure being truthy");
    assert.ok(/var multipleNoteHtml = multipleDisclosure\s*\n?\s*\?/.test(estSrc), "the build-up emission is not guarded on the disclosure being truthy");
  });

  /* ---- the stylesheet ---- */

  check("the disclosure styles reuse the existing muted token and add none", () => {
    /* The rules live beside .sf-est-result-bir in css/estimator.css, which is
       where css/styles.css:7-8 documents the value guide belongs. The token is
       declared in the other sheet, which is why the read below is not enough
       on its own - see the next check. */
    const css = fs.readFileSync(path.join(ROOT, "css", "estimator.css"), "utf8");
    const lines = css.split(/\r?\n/).filter(line => /sf-est-result-multiple|sf-est-multiple-note|sf-est-multiple-limit/.test(line));
    assert.ok(lines.length >= 4, "expected the disclosure rules in css/estimator.css, found " + lines.length);
    const coloured = lines.filter(line => /color\s*:/.test(line));
    assert.ok(coloured.length >= 1, "no colour rule for the disclosure at all");
    coloured.forEach(line => assert.ok(/var\(--sf-ink-mute/.test(line),
      "not the project's existing muted token: " + line.trim()));
    /* A second token would be a new --sf-* declaration on one of these lines. */
    lines.forEach(line => assert.strictEqual(/--sf-[a-z-]+\s*:/.test(line), false,
      "a second muted token was declared: " + line.trim()));
    assert.strictEqual(/var\(--sf-ink-mute,/.test(css), false,
      "the token has a var() fallback here; --sf-ink-mute is declared on an ancestor, so a fallback is dead weight that hides a broken inheritance");
  });

  /* The move to css/estimator.css separated the consuming rules from the
     token's declaration, so "it still resolves" stops being obvious and has to
     be pinned. Custom properties inherit, so the only thing that matters is
     that the declaration is on a selector that wraps this markup - it is not
     load-order dependent, because inheritance has no ordering rule. If the
     declaration ever moves below the consuming rules' common ancestor, this
     goes red. */
  check("the muted token the disclosure consumes is declared on an ancestor of it", () => {
    const storefront = fs.readFileSync(path.join(ROOT, "css", "storefront.css"), "utf8");
    /* .sf-site opens the token block (css/storefront.css:18-21) and is also the
       wrapper js/storefront.js:156 puts around the whole storefront, the
       estimator included. Asserting the declaration sits inside that block is
       what makes the inheritance claim true rather than hopeful. */
    const siteBlock = /\.sf-site\s*\{([^}]*)\}/.exec(storefront);
    assert.ok(siteBlock, "css/storefront.css no longer declares a .sf-site block");
    assert.ok(/--sf-ink-mute\s*:\s*#6B605A\s*;/.test(siteBlock[1]),
      "--sf-ink-mute is no longer declared inside .sf-site, so the estimator rules cannot inherit it");
  });

  /* ===================================================================
     Task 4 - the PDF.

     pdfText() below is a copy of the helper in
     tests/value_guide_reference_node.js:11-20. That file exports nothing, so
     the helper cannot be imported from it, and the alternative - adding an
     export to a file this task must not touch - is worse. It is a harness,
     not part of the feature: it inflates the content streams and reads the
     hex text runs back out. Nothing inside the renderer is replaced.

     Every PDF below comes from VG.toBlob() with the vendored pdf-lib bundle,
     the same call tests/value_guide_reference_node.js:80-82 makes inside its
     --capture branch. meta carries no tax figures: the disclosure is not a tax
     output, and a fixture that dragged the tax engine in would be testing the
     tax path instead.

     Mutations, run against this file on 2026-10-04, each applied to
     js/value_guide_pdf.js and then reverted. The run aborts at the first
     throw, so only the check named in each entry was OBSERVED red - later
     checks that would also have fired were not exercised to failure:
        M20. the label hardcoded as a byte-identical literal
          -> "the PDF prints the builder's own strings, once each" FAILS,
             "expected the builder's 6 interpolated fields to be marked, found
             5". Nothing before it turned red.
        M21. the assumption paragraph dropped
          -> "the PDF land build-up prints the label, the factor and both
             published sentences" FAILS, "the assumption sentence is not printed
             verbatim"
        M22. the limitation paragraph dropped
          -> the same check FAILS, "the limitation sentence is not printed
             verbatim"
        M23. the summary line dropped
          -> "the PDF summary names the applied multiple under the BIR figure"
             FAILS, "the summary never prints the label", and only that one
        M24. the build-up row's value hardcoded as "x 2.5"
          -> "the printed multiple reconciles with the printed BIR base and
             land rate" FAILS, "commercial corner: the build-up prints 2.5 where
             the builder returns 4.35625". The vacant lot and house lot vectors
             on the same check stayed green - a 2.5 hardcode is correct for
             those two, which is why that check reads three fixtures.
        M25. the summary guard dropped and a locally forged disclosure
          substituted whenever the builder returns null
          -> "a time-indexed result renders no disclosure anywhere in the PDF"
             FAILS, "the indexed PDF still names the factor" (index 440)
        M25b. the same forgery, restricted to factor-mode results
          -> "the factor build-up prints nothing when the builder returns null"
             FAILS, "the silenced PDF still names the factor anywhere"
             (index 435), with the indexed check green - which is the point of
             running both variants
        M26, M27, M28. see the note on the static source guard below
        M29. the browser branch bound to the wrong global
          (window.ESREALTY_REFERENCE -> window.ESREALTY_FINANCE, a global that
          does exist in that context)
          -> the browser-branch check fails with "TypeError:
             referenceTools.appliedMultipleDisclosure is not a function", after
             every text assertion above it stayed green. It is the only check
             that executes the window branch at all.
     =================================================================== */
  const VG = require("../js/value_guide_pdf.js"), PDFLib = require("../vendor/pdf-lib/pdf-lib.min.js"), zlib = require("zlib");

  function pdfText(bytes) {
    const buffer = Buffer.from(bytes), text = [];
    for (let at = 0; (at = buffer.indexOf("stream", at)) >= 0;) {
      let start = at + 6; if (buffer[start] === 13) start++; if (buffer[start] === 10) start++;
      const end = buffer.indexOf("endstream", start); if (end < 0) break;
      try {
        const ops = zlib.inflateSync(buffer.subarray(start, end)).toString("latin1");
        for (const match of ops.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) text.push(Buffer.from(match[1], "hex").toString("latin1"));
      } catch (_) {}
      at = end + 9;
    }
    return text.join(" ");
  }

  const PDF_META = { preparedFor: "multiple disclosure", preparedBy: "SEA ESTATES", generatedOn: "2026-10-02" };
  const PDF_PARTS = VG.PARTS.map(p => p.title);
  const MARK = " SENTINEL";
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /* Whitespace-collapsed, so a sentence the renderer wrapped across two lines
     still reads back as the sentence the builder returned. The layout is
     deterministic - fixed fixture, fixed fonts, no randomness - so this is not
     a source of flakiness; if a page break ever lands mid-sentence the run
     below goes red and says which string was broken. */
  async function renderPdf(opts) {
    const result = EST.core.computeEstimate(config, index, md, opts);
    const blob = await VG.toBlob(PDFLib, result, PDF_META);
    return { result: result, text: pdfText(Buffer.from(await blob.arrayBuffer())).replace(/\s+/g, " ").trim() };
  }
  /* The only seam: the disclosure builder itself, through the same module
     object js/value_guide_pdf.js holds. Everything else in the renderer runs
     unmodified. */
  async function renderPdfWithStub(stub) {
    const real = REF.appliedMultipleDisclosure;
    REF.appliedMultipleDisclosure = stub;
    try { return await renderPdf(options); } finally { REF.appliedMultipleDisclosure = real; }
  }

  /* A running header reads "SEA ESTATES <municipality> - RDO <n>" then the part
     title, so the part title only appears as a section START in that form. The
     contents table on the cover also names every part, which is why a plain
     indexOf on the title cannot scope a section. */
  function pdfSection(text, result, title) {
    const at = text.indexOf("RDO " + result.rdo + " " + title);
    if (at < 0) return "";
    const next = PDF_PARTS.indexOf(title) + 1;
    const stop = next < PDF_PARTS.length ? text.indexOf("RDO " + result.rdo + " " + PDF_PARTS[next], at) : -1;
    return text.slice(at, stop < 0 ? text.length : stop);
  }
  function sliceBetween(text, from, to) {
    const at = text.indexOf(from);
    if (at < 0) return "";
    const end = text.indexOf(to, at + from.length);
    return text.slice(at, end < 0 ? text.length : end);
  }

  const houseOptions = Object.assign({}, options, { type: "house_lot", area: 300, floorArea: 180, ageBand: "6-10", floors: "2", construction: "mixed_chb" });
  const lotPdf = await renderPdf(options);
  const cornerCommercialPdf = await renderPdf(Object.assign({}, options, { classification: "CR", corner: true }));
  const housePdf = await renderPdf(houseOptions);
  const indexedPdf = await renderPdf(indexed);
  const silencedPdf = await renderPdfWithStub(function () { return null; });
  const pdfRealDisclosure = REF.appliedMultipleDisclosure;
  const markedPdf = await renderPdfWithStub(function (result) {
    const d = pdfRealDisclosure(result);
    if (!d) return null;
    return {
      multiple: d.multiple + MARK, multipleLabel: d.multipleLabel + MARK, text: d.text + MARK,
      assumption: d.assumption + MARK, limitation: d.limitation + MARK, factors: d.factors
    };
  });

  /* Every later check reads a fixture through one of these, so a vector that
     quietly stopped resolving cannot turn the rest of this block vacuous. */
  check("the PDF fixtures are the vectors the checks below assume", () => {
    [["vacant lot", lotPdf, "factor", "2.04565", "vacant_lot"],
     ["commercial corner", cornerCommercialPdf, "factor", "4.35625", "vacant_lot"],
     ["house lot", housePdf, "factor", "2.04565", "house_lot"],
     ["time-indexed", indexedPdf, "time-indexed", null, "vacant_lot"]].forEach(v => {
      assert.ok(v[1].result.available, v[0] + " produced no estimate, so its PDF is empty");
      assert.strictEqual(v[1].result.landMethod, v[2], v[0] + " land method");
      assert.strictEqual(v[1].result.type, v[4], v[0] + " property type");
      const d = REF.appliedMultipleDisclosure(v[1].result);
      assert.strictEqual(d ? d.multiple : null, v[3], v[0] + " disclosed multiple");
    });
    [lotPdf, cornerCommercialPdf, housePdf, indexedPdf, silencedPdf, markedPdf].forEach(pdf => {
      assert.ok(pdf.text.length > 8000, "a fixture rendered only " + pdf.text.length + " chars; the checks on it would pass vacuously");
    });
  });

  /* ---- the summary site ---- */

  const lotSummary = pdfSection(lotPdf.text, lotPdf.result, PDF_PARTS[0]);
  const lotCalc = pdfSection(lotPdf.text, lotPdf.result, PDF_PARTS[1]);

  check("the PDF summary names the applied multiple under the BIR figure", () => {
    const d = REF.appliedMultipleDisclosure(lotPdf.result);
    assert.ok(lotSummary.length > 400, "the summary section did not render (" + lotSummary.length + " chars)");
    const at = lotSummary.indexOf(LABEL);
    assert.ok(at > -1, "the summary never prints the label " + JSON.stringify(LABEL));
    assert.strictEqual(lotSummary.split(LABEL).length - 1, 1, "the label appears " + (lotSummary.split(LABEL).length - 1) + " times in the summary");
    assert.ok(lotSummary.indexOf(d.text) > at, "the summary does not follow the label with the multiple sentence");
    /* Under the BIR figure, which is the relationship the label explains and
       the same position the web result screen puts it in. */
    const birAt = lotSummary.indexOf("PHP 1,150,000");
    assert.ok(birAt > -1 && birAt < at, "the label is not printed after the BIR reference figure on the summary");
  });

  /* ---- the land build-up site ---- */

  check("the PDF land build-up prints the label, the factor and both published sentences", () => {
    const d = REF.appliedMultipleDisclosure(lotPdf.result);
    assert.ok(lotCalc.length > 800, "the computation section did not render (" + lotCalc.length + " chars)");
    assert.strictEqual(lotCalc.split(LABEL).length - 1, 1, "the label appears " + (lotCalc.split(LABEL).length - 1) + " times in the build-up");
    /* Label and value are adjacent text runs in one table row. "x 2.5" alone
       would not isolate it: the market band row above prints "x 2.50". */
    assert.ok(lotCalc.indexOf(LABEL + " x " + d.multiple) > -1, "the build-up row does not print the factor next to the label");
    assert.ok(lotCalc.indexOf("Land value") > -1 && lotCalc.indexOf("Land value") < lotCalc.indexOf(LABEL), "the disclosure row does not follow the land value it explains");
    assert.ok(lotCalc.indexOf(ASSUMPTION) > -1, "the assumption sentence is not printed verbatim");
    assert.ok(lotCalc.indexOf(LIMITATION) > -1, "the limitation sentence is not printed verbatim");
    assert.ok(lotCalc.indexOf(ASSUMPTION) > lotCalc.indexOf(LABEL), "the assumption does not follow the disclosure row");
    assert.ok(lotCalc.indexOf(LIMITATION) > lotCalc.indexOf(ASSUMPTION), "the limitation does not follow the assumption");
  });

  /* The printed number has to multiply out to the printed rate, on the page
     that prints all three. A hardcoded 2.5 passes every presence check above
     and fails here on the commercial corner vector. */
  check("the printed multiple reconciles with the printed BIR base and land rate", () => {
    [["vacant lot", lotPdf], ["commercial corner", cornerCommercialPdf], ["house lot", housePdf]].forEach(pair => {
      const name = pair[0], calc = pdfSection(pair[1].text, pair[1].result, PDF_PARTS[1]);
      const d = REF.appliedMultipleDisclosure(pair[1].result);
      const base = /BIR zonal base (PHP [\d,]+)/.exec(calc);
      const rate = /Effective land rate (PHP [\d,]+)/.exec(calc);
      const shown = new RegExp(escapeRe(LABEL) + " x ([\\d.]+)").exec(calc);
      assert.ok(base && rate && shown, name + ": could not read the base, the effective rate and the printed multiple off the build-up");
      const peso = s => Number(String(s).replace(/[^\d.]/g, ""));
      assert.strictEqual(shown[1], d.multiple, name + ": the build-up prints " + shown[1] + " where the builder returns " + d.multiple);
      /* Half a peso: the rate is rounded to whole pesos for printing. */
      assert.ok(Math.abs(Number(shown[1]) * peso(base[1]) - peso(rate[1])) <= 0.5,
        name + ": the build-up prints " + shown[1] + " x " + peso(base[1]) + " = " + (Number(shown[1]) * peso(base[1])) + " but " + peso(rate[1]) + "/sqm");
    });
  });

  check("a house lot renders the disclosure from the same build-up path", () => {
    /* The web task pinned only vacant_lot. house_lot enters the same Step 2
       branch - the split is on r.timeIndex, not on the property type - so this
       check exists to prove it rather than to assume it. */
    const calc = pdfSection(housePdf.text, housePdf.result, PDF_PARTS[1]);
    const sum = pdfSection(housePdf.text, housePdf.result, PDF_PARTS[0]);
    const d = REF.appliedMultipleDisclosure(housePdf.result);
    assert.ok(calc.indexOf("replacement cost") > -1, "the house fixture did not take the house path in this PDF");
    assert.strictEqual(calc.split(LABEL).length - 1, 1, "the label appears " + (calc.split(LABEL).length - 1) + " times in a house lot build-up");
    assert.ok(calc.indexOf(LABEL + " x " + d.multiple) > -1, "the house lot build-up row does not print the factor");
    assert.ok(calc.indexOf(ASSUMPTION) > -1 && calc.indexOf(LIMITATION) > -1, "a house lot PDF drops the assumption or the limitation");
    assert.ok(sum.indexOf(d.text) > -1, "a house lot PDF drops the summary line");
  });

  /* ---- a null disclosure renders nothing ---- */

  check("a time-indexed result renders no disclosure anywhere in the PDF", () => {
    assert.ok(indexedPdf.text.indexOf("Indexed land reference") > -1, "the indexed PDF did not render its own land table");
    assert.ok(indexedPdf.text.indexOf("Factor guide comparison") > -1, "the indexed PDF did not render its own land table");
    assert.strictEqual(indexedPdf.text.indexOf(LABEL), -1, "the indexed PDF still names the factor");
    assert.strictEqual(indexedPdf.text.indexOf("the BIR reference"), -1, "the indexed PDF still states the multiple sentence");
    assert.strictEqual(indexedPdf.text.indexOf("planning assumption"), -1, "the indexed PDF still prints the assumption");
    assert.strictEqual(indexedPdf.text.indexOf("likely too high for rural locations"), -1, "the indexed PDF still prints the limitation");
    assert.strictEqual(/\bx 0(\.0+)?\b/.test(indexedPdf.text), false, "the indexed PDF prints a zero factor");
  });

  /* The same guard seen from the other side. The indexed fixture above reaches
     a different table branch, so on its own it cannot show that the row and
     the two paragraphs in THIS branch are gated on the builder's return value.
     Forcing a null on a factor-mode result does: the build-up survives and the
     disclosure does not. */
  check("the factor build-up prints nothing when the builder returns null", () => {
    const d = REF.appliedMultipleDisclosure(lotPdf.result);
    assert.ok(d, "the vacant lot fixture is supposed to disclose");
    const calc = pdfSection(silencedPdf.text, silencedPdf.result, PDF_PARTS[1]);
    assert.ok(calc.indexOf("Effective land rate") > -1 && calc.indexOf("Land value") > -1, "the land build-up itself vanished, so the assertions below would pass vacuously");
    [LABEL, d.text, ASSUMPTION, LIMITATION].forEach(needle =>
      assert.strictEqual(calc.indexOf(needle), -1, "the silenced build-up still prints " + JSON.stringify(needle)));
    assert.strictEqual(silencedPdf.text.indexOf(LABEL), -1, "the silenced PDF still names the factor anywhere");
    assert.strictEqual(silencedPdf.text.indexOf(ASSUMPTION), -1, "the silenced PDF still prints the assumption anywhere");
  });

  /* ---- the PDF prints the builder's words, not a second copy ---- */

  check("the PDF prints the builder's own strings, once each", () => {
    const d = REF.appliedMultipleDisclosure(markedPdf.result);
    const sum = pdfSection(markedPdf.text, markedPdf.result, PDF_PARTS[0]);
    const calc = pdfSection(markedPdf.text, markedPdf.result, PDF_PARTS[1]);
    /* Six interpolated fields: label and text in the summary line, label and
       multiple in the build-up row, the assumption, the limitation. A renderer
       carrying its own copy - or one byte-identical to the builder's, which is
       what M20 planted - drops a mark and the count moves. */
    const marks = markedPdf.text.split(MARK).length - 1;
    assert.strictEqual(marks, 6, "expected the builder's 6 interpolated fields to be marked, found " + marks);
    assert.ok(sum.indexOf(LABEL + MARK) > -1, "the summary line does not print the builder's label");
    assert.ok(sum.indexOf(d.text + MARK) > -1, "the summary line does not print the builder's multiple sentence");
    assert.ok(calc.indexOf(LABEL + MARK + " x " + d.multiple + MARK) > -1, "the build-up row does not print the builder's label and factor");
    assert.ok(calc.indexOf(ASSUMPTION + MARK) > -1, "the assumption paragraph does not print the builder's sentence");
    assert.ok(calc.indexOf(LIMITATION + MARK) > -1, "the limitation paragraph does not print the builder's sentence");
  });

  /* ---- the accuracy rule, applied to what the PDF actually prints ----

     Scoped to the two blocks the disclosure occupies, delimited by MARKER
     anchors and the next block's own first string. It cannot run over the
     whole document: the summary callout already publishes a sentence denying
     that match depth is a statistical score (js/value_guide_pdf.js line 600,
     asserted by tests/value_guide_pdf_node.js) and the regex rejects it on the
     word alone. Widening the guard to cover that would refuse a sentence this
     project publishes on purpose, so the rule is enforced where the renderer
     owns the words - and only the builder's strings reach it. */
  check("no PDF text added for the multiple claims accuracy", () => {
    const sum = pdfSection(markedPdf.text, markedPdf.result, PDF_PARTS[0]);
    const calc = pdfSection(markedPdf.text, markedPdf.result, PDF_PARTS[1]);
    const blocks = [
      sliceBetween(sum, LABEL + MARK, "Source match:"),
      sliceBetween(calc, LABEL + MARK, "Step 3 - house value")
    ];
    blocks.forEach((block, i) => {
      assert.ok(block.length > 40, "disclosure block " + i + " did not render (" + block.length + " chars)");
      assert.strictEqual(BANNED.test(block), false, "accuracy language printed into the PDF: " + block);
    });
  });

/* ---- the browser branch of the binding ----

     js/value_guide_pdf.js binds the disclosure builder the way
     js/estimator.js does - require() under Node, window.ESREALTY_REFERENCE in
     the browser. Every PDF above went through the require() branch, so the
     browser branch is never executed by any suite in this file, and
     tests/value_guide_pdf_browser_e2e only proves that clicking Download still
     produces a PDF: a browser build whose referenceTools came back undefined
     would fail at the first call, and that suite's text assertions would never
     reach the disclosure either way.

     So the browser branch is executed here, for real: the three scripts the
     renderer needs are loaded into a context with no module and no exports, in
     index.html's order (value_guide_finance, value_guide_reference,
     value_guide_pdf - the first is there because the renderer requires it for
     the transaction-costs row), and the renderer is asked for a PDF through its
     own global.

     pdf-lib is evaluated inside that context too, and the reason is a harness
     one, recorded rather than worked around: pdf-lib's option type checks use
     instanceof, and the renderer's A4 page-size literal is an Array belonging
     to the context that loaded the renderer. Handed a pdf-lib from this realm,
     addPage() rejects it with "`page` must be of type ... but was actually of
     type `NaN`" - a realm artefact, not a renderer error. This is the same
     arrangement tests/value_guide_reference_node.js:41-44 already uses, for
     the same reason. */
  const browserSandbox = { console: console, Blob: Blob };
  browserSandbox.window = browserSandbox; browserSandbox.self = browserSandbox;
  vm.createContext(browserSandbox);
  vm.runInContext("globalThis.window = globalThis; globalThis.self = globalThis;", browserSandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"), "utf8"), browserSandbox, { filename: "vendor/pdf-lib/pdf-lib.min.js" });
  ["js/value_guide_finance.js", "js/value_guide_reference.js", "js/value_guide_pdf.js"].forEach(file =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), browserSandbox, { filename: file }));
  const browserVG = browserSandbox.ESREALTY_VG_PDF, browserPDFLib = browserSandbox.PDFLib;

  await checkAsync("the PDF renders the disclosure through the browser branch of the binding", async () => {
    assert.ok(browserSandbox.ESREALTY_REFERENCE, "js/value_guide_reference.js did not publish its global in the browser shape");
    assert.ok(browserVG && typeof browserVG.toBlob === "function", "js/value_guide_pdf.js did not publish its global in the browser shape");
    assert.ok(browserPDFLib && browserPDFLib.PDFDocument, "the vendored pdf-lib did not publish its global in the context");
    /* No module in the context, so the renderer took the window branch. Had it
       bound nothing, appliedMultipleDisclosure would throw a TypeError on the
       first call rather than return. */
    assert.strictEqual(typeof browserSandbox.ESREALTY_REFERENCE.appliedMultipleDisclosure, "function");
    const blob = await browserVG.toBlob(browserPDFLib, lotPdf.result, PDF_META);
    const text = pdfText(Buffer.from(await blob.arrayBuffer())).replace(/\s+/g, " ").trim();
    const d = REF.appliedMultipleDisclosure(lotPdf.result);
    assert.ok(text.length > 8000, "the browser-branch PDF rendered only " + text.length + " chars");
    assert.strictEqual(text.split(LABEL).length - 1, 2, "the browser-branch PDF does not carry the label at both sites");
    assert.ok(text.indexOf(ASSUMPTION) > -1 && text.indexOf(LIMITATION) > -1, "the browser-branch PDF drops the assumption or the limitation");
    assert.ok(text.indexOf(d.text) > -1, "the browser-branch PDF drops the summary line");
  });

  /* ---- the spec's static source guard, kept alongside the real ones ----
     A shape check, not behavioural coverage, and labelled as such: it can only
     see that the characters exist in the file. What is printed is pinned by the
     assertions above. It is here for the one defect text extraction is blind to,
     and blindness was measured rather than assumed.

     Three mutations, all applied to js/value_guide_pdf.js on 2026-10-04:
       M26. drop `.filter(...)` and hand landRows to table() unfiltered
            -> the render THROWS: "TypeError: Cannot read properties of null
               (reading 'length')" at js/value_guide_pdf.js:347, on the first
               fixture that reaches the branch with a null disclosure. So the
               filter is load-bearing and the silenced fixture above exercises
               it for real - the crash is the coverage.
       M27. keep the filter but make the falsy branch `[null]` instead of
            `null` -> ALL GREEN. table() accepts a one-element row,
             (that run printed ALL GREEN (63 checks); the file has since gained
             checks - it printed 67 on 2026-10-05 - and none of them can see an
             empty cell, which is the point)
            wrap() renders an empty cell as no ink at all, the row is at an even
            index so no shade band is drawn either, and the cost is 17.46pt of
            blank vertical space that no extracted text can show.

     M27 is the reason the falsy branch is pinned here rather than trusted. It
     is the only defect in this feature that behavioural assertions cannot see.

     M28. add a second, unreachable resolution site
          -> "expected exactly one resolution site in js/value_guide_pdf.js,
             found 2". A renderer that called the builder per printed field
             would pass every presence check above, because the words would
             still be the builder's - this is the only thing that sees it. */
  check("source: the PDF resolves the disclosure once and guards both emissions", () => {
    const src = fs.readFileSync(path.join(ROOT, "js/value_guide_pdf.js"), "utf8");
    assert.strictEqual(src.split("referenceTools.appliedMultipleDisclosure(").length - 1, 1,
      "expected exactly one resolution site in js/value_guide_pdf.js, found " + (src.split("referenceTools.appliedMultipleDisclosure(").length - 1));
    assert.ok(/var multipleDisclosure = referenceTools\.appliedMultipleDisclosure\(/.test(src), "the disclosure is not resolved into a named local");
    assert.ok(/if \(multipleDisclosure\) line\(multipleDisclosure\.multipleLabel, multipleDisclosure\.text/.test(src), "the summary emission is not guarded on the disclosure being truthy");
    assert.ok(/multipleDisclosure \? \[multipleDisclosure\.multipleLabel, "x " \+ multipleDisclosure\.multiple\] : null/.test(src), "the build-up row is not a conditional entry whose falsy branch is null");
    assert.ok(/landRows\.filter\(function \(row\) \{ return row; \}\)/.test(src), "the conditional row is not filtered out of the table array");
    assert.ok(/if \(multipleDisclosure\) \{\s*para\(multipleDisclosure\.assumption, 8, gray\);\s*para\(multipleDisclosure\.limitation, 8, gray\);/.test(src), "the two sentences are not emitted together under a guard");
  });

  console.log("ALL GREEN (" + count + " checks)");
})().catch(error => { console.error(error); process.exitCode = 1; });
