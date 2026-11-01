# Value Guide accuracy: Phase 0 (trust fixes)

Date: 2026-11-01
Status: implemented (calculationVersion 2026.11.1). Phase 1 (house-size
correction, likely-sale basis, measured range, town quick figure) follows on
its own branch.

Review doc: https://claude.ai/artifact/DK7VbCR5F4jrpH4t8qAVii (findings 1, 2,
6, 9, 10, 12 are the ones fixed here).

## What changed

1. **Asking price label.** The public report's asking box said "Upper planning
   scenario (130%)" while showing total x 1.07; the back office printed
   `r.high` (x1.30) as the asking price. Both now print one figure, guide total
   x (1 + `askingPrice.premiumPct` / 100) from `data/zonal-config.json`
   (7%), labelled "Suggested asking price (guide + 7%)". The 130% figure is
   the top of the planning range and is described as such.
2. **Back-office factor panel.** `js/app.js` and the listing API carried the
   September 2026 factor set (CHB 25,000/sqm, commercial 1.7x, farmland 0.5x,
   industrial 1.35x) as the state's defaults, so the panel pre-filled values
   that were never live and one "Approve and publish" would have put them on
   the public site. The defaults now mirror the live calculator
   (`valueGuideLiveDefaults`, `VALUE_GUIDE_LIVE_FACTORS`), the panel pre-fills
   from the approved override or the live values (never an unapproved row),
   shows the live line, and offers a reset. `tests/value_guide_phase0_node.js`
   pins both default sets to `data/zonal-config.json`.
3. **Range wording.** "Likely range" became "Planning range" on the home page,
   quick estimate and storefront; the glossary says it is a planning band and
   that the monthly bank check reports how often prices fall inside it.
4. **Registration fee.** Flat 0.1% replaced by the LRA schedule of fees
   (`js/value_guide_finance.js` `lraRegistrationFee`; PHP 8,796 at 1.7M plus
   PHP 90 per 20,000 above). Used by the public cost panel, the back-office
   PDF and the deal closing-cost calculator (a per-deal percentage still
   overrides it).
5. **City transfer tax.** The five Batangas cities (Batangas, Lipa, Tanauan,
   Sto. Tomas, Calaca) are shown at the legal ceiling of 0.75% (RA 7160 Sec.
   135), labelled "up to", until each city's revenue code is confirmed.
   Municipalities stay at 0.5%.
6. **Estate scenario.** Estate tax is computed on the statutory basis (BIR
   zonal land plus the house at depreciated cost, NIRC Sec. 88(B)); the market
   guide figure is shown as the upper case. `likelyPayable` follows the
   statutory basis.

## Decisions applied

- Main figure stays the planning estimate until Phase 1 re-fits it to a
  likely sale price (bank and Pag-IBIG prices x 1.10).
- The +7% asking premium is kept and labelled rather than dropped: once the
  Phase 1 re-fit lands the guide at the likely sale price, total x 1.07 sits
  at the level of current asking prices.

## Not done here

- The listing API's built-in defaults changed; redeploy the edge function
  (deploy-functions.yml) when convenient so the no-admin fallback matches.
- The monthly comparables refresh did not run on 1 Nov (plan item 0.6).
