# Value Guide accuracy: Phase 1 (model re-fit)

Date: 2026-11-01
Status: implemented (calculationVersion 2026.11.2), on top of Phase 0
(docs/plans/2026-11-01-value-guide-accuracy-phase-0.md).

Review doc: https://claude.ai/artifact/DK7VbCR5F4jrpH4t8qAVii, plan items
1.1, 1.3, 1.4 and 1.5. Items 1.2 (subdivision tiers) and 1.6 (one engine for
the back-office questions) are not in this change.

## Basis decision

The main figure is a **likely sale price**: the bank or Pag-IBIG "as is"
price x 1.10, the same lift the town calibration already used. The suggested
asking price stays guide x 1.07 (Phase 0), which now lands at the level of
current resale asking prices instead of 10-15% above them.

## What changed

1. **House-size grade on the construction rate** (`houseSizeGrade` in
   `js/estimator.js`, data in `data/calibration.json` `houseSize`). One rate
   (CHB 16,000/sqm) under-priced 30-79 sqm homes by about a quarter and
   over-priced rowhouses under 30 sqm and houses over 150 sqm against 264
   bank and Pag-IBIG prices. The rate is now multiplied by a floor-area band
   grade, blended across band edges (+/-10% of the boundary) so one extra
   square metre never jumps the figure. Land is untouched, so land + building
   still reconcile to the total on both surfaces.

   | Band | Prices | Developments | Grade | Effective CHB rate |
   |---|---|---|---|---|
   | under 30 sqm | 67 | 24 | 0.742 | 11,872 |
   | 30-49 sqm | 116 | 37 | 1.376 | 22,016 |
   | 50-79 sqm | 33 | 21 | 1.659 | 26,544 |
   | 80-149 sqm | 15 | 9 | 1.159 | 18,544 |
   | 150 sqm and up | 13 | 10 | 0.707 | 11,312 |

   Fitted by `market-scan/comparables/fit-model.js`: (price x 1.10 - guide
   land) / guide building, median per development, median across
   developments, shrunk by developments / (developments + 5) toward 1.
   Held out one development at a time, the typical miss against the likely
   sale price falls from 21% to about 15%, and the share within 20% rises
   from 46% to 68%.
2. **Measured range** (`rangeFactors`, data in `data/calibration.json`
   `range`). For houses and lots on residential land the band is where the
   middle 68% of developments fell relative to the guide: houses 83%-126%
   (71% of individual bank prices inside), lots 62%-143% (73% inside, against
   9% inside the old 85%-130% band). A location matched only at town or
   province level widens the band by 25%. Everything else keeps the 85%-130%
   planning scenarios. The back office prints the same band.
3. **Quick figure and home-page example** price at the town's typical
   barangay (the one whose all-other-streets rate is the median of all its
   barangays) with a 6-10-year-old house, instead of the town-wide median
   rate with a house under 5 years old. Homes matched only at town level
   were under-priced by about 30%; the note names the barangay used.
4. **Accuracy report** (`market-scan/comparables/accuracy.js`) adds the error
   against the likely sale price, the share of bank prices inside the guide's
   range, and houses by size band. Oct 2026, calculation 2026.11.2: houses
   median |error| 12.3% against bank prices (was 21.2%), 70.5% inside the
   range (was 52%); every size band within 10% of bank prices, one
   development counted once.
5. **Monthly workflow** runs the fit script and puts house-size and range
   proposals in the same calibration pull request as the town factors, so
   the grades follow the market without a code change.

## Not done here

- 1.2 subdivision tiers (needs the proposed SMV class lists per subdivision).
- 1.6 one engine for the back-office questions.
- Lots keep the current land model: 46 of the 77 bank lot prices are one
  development, too thin to re-fit.
