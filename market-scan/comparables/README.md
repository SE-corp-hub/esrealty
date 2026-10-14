# Monthly comparables (bank-acquired properties, Batangas)

Runs by itself on the 1st of every month (`.github/workflows/comparables-monthly.yml`).

| Step | File |
|---|---|
| Download each source once, identifying user agent, 1.5 s apart | `fetch-raw.js`, `sources.json` |
| BDO province PDF -> rows (reads the PDF's positioned text, no poppler) | `sources/bdo.js` |
| BPI Buena Mano page -> Batangas rows (Sales Officer column never read) | `sources/bpi.js` |
| Address -> BIR municipality / barangay / street and its zonal rate | `match.js` |
| Normalise, de-duplicate, filter outliers, write the snapshot | `build-comparables.js` |

## What gets written

- `data/comparables/accuracy-latest.json` - the Value Guide run on every
  house, townhouse and vacant-lot record (`accuracy.js`): error by kind, town,
  bank and project. The headline is the **project-weighted** median (each
  project counts once). Bank prices usually sit below resale, so +0% to +25%
  is expected. It never changes a price.


- `data/comparables/batangas-latest.json` - **replaced in full every run.**
  Last month's listings are deleted, so a property that was sold or withdrawn
  simply disappears. Exception: a source that *failed* this month keeps its
  previous records for one more month, marked `carriedOver: true`, so an outage
  is not mistaken for everything selling at once. A second missed month drops them.
- `data/comparables/history.json` - one small summary per month (counts, median
  price per sqm by town and vacant/built). No individual listings.

Rejected records (outside Batangas, duplicates, prices far from the BIR rate or
the town median) are listed with the reason under `rejected` in the snapshot.

## When something breaks

The run opens one issue, "Comparables monthly run needs attention", listing the
problems: a source that failed or was refused, 40%+ fewer rows than last month,
under 80% of records matched to a BIR barangay, or data older than 40 days.

**BDO** refuses connections from GitHub's servers, so its PDF usually has to be
added by a person: save
[Luzon_Batangas.pdf](https://www.bdo.com.ph/content/dam/bdounibank/en-ph/mcg-digital-marketing/asset-for-sale/asset-listings/Luzon_Batangas.pdf)
and upload it to `market-scan/comparables/inbox/` on GitHub (Add file -> Upload
files). The upload re-runs the workflow.

**Manual rows**: for a source no robot may read (Security Bank answers 403; we
do not get around blocks), its table can be typed into
`inbox/<source>.rows.json`:

```json
{ "observedOn": "2026-10-12",
  "rows": [ { "address": "..., Brgy. Santiago, Santo Tomas, Batangas", "propertyType": "Vacant Lot",
              "price": 4500000, "lotArea": 500, "floorArea": 0 } ] }
```

The newest file for a source wins; anything older than 62 days is refused.

## Run it locally

```
node market-scan/comparables/fetch-raw.js /tmp/raw
node market-scan/comparables/build-comparables.js --raw /tmp/raw
node tests/comparables_pipeline_node.js
```
