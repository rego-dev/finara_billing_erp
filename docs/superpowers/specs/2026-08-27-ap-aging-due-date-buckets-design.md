# AP Aging — Due-Date Buckets

## Problem

The AP Aging report (`/payable/aging`) only groups not-yet-due bills into a single
`Current` bucket. Users want visibility into *when* upcoming bills are due
(Due Today / This Week / Next Week / This Month), not just that they aren't
overdue yet. The existing overdue buckets (`31-60 days`, `61-90 days`,
`Over 90 days`) are still useful but should become optional/hideable so the
table isn't cluttered when the user only cares about what's coming due soon.

Scope: AP Aging page only. AR Aging is unchanged.

## Bucket definitions

Replaces the single `Current` bucket. Week boundaries are calendar weeks,
Monday–Sunday.

| Bucket | Condition |
|---|---|
| `Due Today` | `dueDate` is today |
| `This Week` | `dueDate` is after today, through this Sunday |
| `Next Week` | `dueDate` is Monday–Sunday of the following week |
| `This Month` | `dueDate` is after next week's Sunday, through the end of the current calendar month |
| `Later` | `dueDate` is after the end of the current calendar month (catch-all — every not-yet-due bill lands somewhere) |
| `1-30 days` | overdue 1-30 days (unchanged) |
| `31-60 days` | overdue 31-60 days (unchanged, optional) |
| `61-90 days` | overdue 61-90 days (unchanged, optional) |
| `Over 90 days` | overdue 90+ days (unchanged, optional) |

Full bucket order: `Due Today, This Week, Next Week, This Month, Later, 1-30 days, 31-60 days, 61-90 days, Over 90 days`.

A bill's bucket is decided in this order: if overdue (`daysOverdue > 0`), use
the existing overdue-bucket logic. Otherwise, classify by due date using the
table above.

## Backend changes

`server/controllers/payableController.js` — `agingReport`:

- Compute `today`, end-of-this-week (Sunday), end-of-next-week (Sunday), and
  end-of-this-month once per request.
- For bills where `daysOverdue === 0`, classify into one of
  `Due Today / This Week / Next Week / This Month / Later` per the table
  above, instead of always `Current`.
- Overdue classification (`1-30 days` ... `Over 90 days`) is unchanged.
- Update the `buckets` array used to build `summary` to the new 9-bucket list.

Response shape (`items`, `summary`, `total`) is unchanged — only the set of
possible `bucket` string values changes.

## Frontend changes

`app/(dashboard)/payable/aging/page.jsx`:

- `BUCKETS` constant becomes the new 9-bucket ordered list.
- `BUCKET_COLORS` / `BUCKET_BADGE` get entries for the 5 new buckets (drop the
  old `Current` entry).
- New local state: `hiddenOptionalBuckets` (Set), tracking which of
  `31-60 days` / `61-90 days` / `Over 90 days` are unchecked. Empty by
  default (all three shown).
- New filter control (dropdown with 3 checkboxes) placed next to the existing
  vendor search input in the "Detail by Vendor" card header. Label: e.g.
  "Buckets ▾".
- Derive `visibleBuckets = BUCKETS.filter(b => !isOptional(b) || !hiddenOptionalBuckets.has(b))`.
  `isOptional(b)` is true for the 3 overdue buckets beyond `1-30 days`.
- Bar chart (`chartData`) and the "Bucket Summary" panel iterate over
  `visibleBuckets` instead of `BUCKETS`.
- "Detail by Vendor" table header/body columns iterate over `visibleBuckets`.
- KPI header cards keep summing over the **full** `BUCKETS` list (unaffected
  by the filter):
  - "Total Outstanding" — unchanged (full total).
  - "Current (Not Due)" card is renamed "Not Yet Due" and sums
    `Due Today + This Week + Next Week + This Month + Later`.
  - "Total Overdue" / "Overdue %" — unchanged definitionally (sum of all
    overdue buckets), still full totals regardless of filter.
- "No outstanding payables" empty state and vendor-name search filter are
  unaffected.

## Out of scope

- AR Aging report keeps its current bucket structure.
- No persistence of the filter selection (resets on page reload) — not
  requested.
