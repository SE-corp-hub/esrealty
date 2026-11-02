# Value Guide accuracy: Phases 2 and 3 (what the figure is worth, and for how long)

Date: 2026-11-01
Status: implemented, on top of Phase 1
(docs/plans/2026-11-01-value-guide-accuracy-phase-1.md). No price changes;
calculation version stays 2026.11.2.

Review doc: https://claude.ai/artifact/DK7VbCR5F4jrpH4t8qAVii, plan items
2.1, 2.3, 2.4, 2.5, 3.1 and 3.2. Items 2.2 (RPVARA schedule of market
values) and 3.3 (appraiser review) are not in this change.

## What changed

Every result now carries four small objects, built once in
`computeEstimate` from `config.evidence` (the bank snapshot, the accuracy
report and the trend file, compacted at load by `evidenceContext`). Each
comes with its sentence, so the public report, the back office and the PDF
print the same words.

1. **Validity date** (`validity`, plan item 2.5): the bank data date plus
   90 days. "Good as a planning figure until 2027-01-30 (bank and Pag-IBIG
   data of Nov 2026 plus 90 days); after that, run it again." Printed under
   the range, in the data strip ("Bank data as of"), in the full report, in
   the back-office summary ("Review after"), in the PDF footer, the summary
   tile and the model table.
2. **Evidence level** (`evidenceLevel`, items 2.4 and 3.2):
   - Residential houses and lots: "Monthly check (Nov 2026): houses were
     typically within 11% of bank and Pag-IBIG prices, and 70% of those
     prices fell inside the guide's range (391 prices, 86 developments)."
     The numbers are the accuracy report's own (`accuracy-latest.json`),
     so the published error is the measured one.
   - Farm, industrial and commercial land: a **low evidence** mark until the
     snapshot holds 20 farm, 10 industrial or 10 commercial prices ("Low
     evidence: the monthly bank check holds 0 farm prices (20 needed), so
     this figure has not been checked against sales. Treat it as a starting
     point for an appraiser."). Once the prices exist but the check does not
     yet cover that use, the mark reads "unmeasured". The badge on the result
     card, a boxed line under the range, a sentence in the full report, a
     banner in the back office and a limitation line in the PDF.
3. **Hazard** (`hazardContext`, item 2.3): the Surroundings questions and
   the full report link HazardHunterPH (PHIVOLCS, MGB, PAGASA). For the
   fourteen towns with barangays inside the 14-km radius around Taal
   Volcano's main crater (Agoncillo, Alitagtag, Balete, Cuenca, Laurel,
   Lemery, Lipa City, Malvar, Mataas na Kahoy, San Nicolas, Sta. Teresita,
   Taal, Talisay, Tanauan City) the note says so and asks the reader to check
   the map for the exact address. It is a prompt, not a deduction.
4. **Trend** (`trendFor`, item 2.1): `market-scan/comparables/trend.js`
   runs in the monthly workflow after the fit and writes
   `data/comparables/trend-latest.json`: for every town with three months
   of five or more prices inside the trailing twelve, the change in the
   median price per sqm from the first of those months to the latest, and
   the annualised rate. Rows are "proposed"; a person changes a row to
   "reviewed" (with reviewedBy) and only then does the site print "Prices
   here: +x% over N months ... Shown for context; the figure is not indexed
   by it." A later run keeps a reviewed row while its figure stays within 2
   points, otherwise the row goes to "re-review" and disappears again. The
   BSP Residential Property Price Index note (2026 Q2: areas outside NCR
   down year on year for the first time; houses down, condominiums up)
   stays in the file as context for the reviewer and survives the monthly
   rewrite. Today the file says "insufficient-history": two months exist,
   so the first proposals can appear with the January 2027 run.
5. **Final sale price on closed deals** (item 3.1): a closed lead that came
   through the Value Guide (it carries `fullReport.estimate`) shows a
   "Final sale price" card on the lead; saving it stores
   `finalSalePrice` and `finalSaleOn` on the lead (synced like the rest of
   the record), logs the activity with the guide's error, and the foot of
   the Value Guide view keeps the ledger: each deal's guide, sale price and
   error, with the median and the typical miss
   (`ESREALTY_ATTR.guideAccuracy`). Nothing in it changes a price.

## Not done here

- 2.2 RPVARA schedule of market values: the proposed SMV class lists per
  subdivision are not published in a usable form yet.
- 3.3 appraiser review: the owner's action.
- The trend is display only. Indexing a figure by it (an `landTimeEvidence`
  record in the government reference register) stays a reviewed, manual
  step.

## Tests

`tests/value_guide_phase2_node.js`: the evidence context, the validity
arithmetic, the evidence levels by use, the Taal list against the index,
the reviewed-only trend rule, the same sentences on both surfaces, the PDF
text, the back-office hooks, the sales ledger arithmetic, and the trend
script on synthetic histories (insufficient, proposed, reviewed carry-over,
re-review).
