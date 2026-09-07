# Daily Cash Movement & Cash Position Report — Design

**Date:** 2026-08-06
**Status:** Approved

## Goal

Separate two questions that the Daily Remittance Report currently answers at the
same time, badly:

- **"Tama ba ang na-remit karon?"** — a one-day operational document, prepared
  and approved, showing only what moved that day.
- **"Pila ang cash namo, ug asa gikan?"** — a running position across a date
  range, always live from the GL.

The Daily Remittance Report keeps the first. A new Cash Position report owns the
second.

## Problem in the current code

`server/controllers/dailyRemittanceController.js` computes the Petty Cash and
Cash on Hand cards with `asOfEndOf(date)` — every POSTED entry up to and
including the chosen day. It then labels the raw debit and credit sums as
`pettyCashFunded` and `pettyCashUsed`, which are **lifetime** totals rendered on
a **daily** report.

That mismatch produced the reported bug: the card read
`7,830 funded − 15,750 used = −7,920 remaining`, where 15,750 was every peso
ever credited to 1011, not the day's spend.

Two further defects follow from the same confusion:

- `app/(dashboard)/remittance/daily/page.jsx` rebuilds `calcData` from a saved
  record but never restores the petty cash fields, so **reloading an approved
  report shows blank cash figures**. Nobody noticed because a freshly generated
  report recomputes them live.
- The progress bar renders `pettyCashUsed ÷ pettyCashFunded` — a percentage of
  lifetime funding, which has no daily meaning at all.

## Design rule

> The Daily Remittance Report never shows a balance.
> The Cash Position report never shows a single day in isolation.

Tying them together, for any cash account and any date range:

```
opening balance + Σ (daily in − daily out) = closing balance
```

If the two reports ever disagree, that is a bug. The rule is directly
assertable, and the test suite asserts it.

## Decision

**Derive everything from the GL on demand.** No new balance tables, no
materialised daily snapshots.

Considered and rejected:

- **Materialised `CashDailyBalance` table**, written nightly or on post. Fast
  reads and cheap history, but it is a second copy of the truth that drifts the
  moment an entry is voided or backdated — and this business *does* backdate
  (EV-000009 posted Aug 3, funded Aug 5). At the current volume — 126 journal
  lines total, 42 of them cash, across six months — it buys a
  rebuild-and-reconcile problem that does not exist yet.
- **A range mode on the existing daily remittance endpoint.** Fewest new files,
  but it welds together the two reports this design exists to separate, inside a
  controller that is already carrying a lot.

## Part 1 — Daily Remittance becomes movement-only

### Card semantics

Each cash card shows **what left that account that day**, and nothing else. No
balance, no carry-in, no progress bar.

Where there is no cash activity on the chosen date, every card reads **₱0.00**.
Nothing from an adjacent day may appear on this report.

Worked example from live data:

| Date | Petty Cash (1011) | Cash on Hand (1010) |
|---|---|---|
| Aug 3 | ₱30.00 spent · 1 voucher | ₱264.00 cash out |
| Aug 4 | ₱0.00 | ₱0.00 |
| Aug 5 | ₱7,890.00 spent · 8 vouchers | ₱7,830.00 cash out |
| Aug 6 | ₱0.00 | ₱0.00 |

### Internal transfers count as out

The Aug 5 Cash on Hand figure of ₱7,830.00 is the transfer *into* petty cash —
money that moved between the company's own funds rather than being spent.

It still counts. The card ties line-for-line to the GL and to the physical
drawer, because the money genuinely left that drawer. The Cash on Hand card is
therefore labelled **"cash out"**, not "spent"; only the petty cash cards, whose
outflows are all voucher disbursements, are labelled "spent".

### Relationship to the existing "Cash Paid Out" card

`cashDisbursed` (the Cash Paid Out card) and the new Cash on Hand figure overlap
but are not the same number, and both are correct:

- **Cash Paid Out** is *document-driven* — AP payments plus non-petty-cash
  vouchers, whatever account settled them, including bank-paid ones.
- **Cash on Hand** is *account-driven* — everything credited to 1010, including
  transfers to petty cash.

The two cards keep distinct subtitles so the difference is legible on the page.

### Freezing approved reports

An approved Daily Remittance is a signed document; its numbers must not change
when someone later backdates or voids an entry.

The day's outflow figures are persisted on the record. They cannot be recovered
from `daily_remittance_items`, because a replenishment is a plain journal entry
rather than a voucher and so was never an item.

Adding them to `daily_remittance_items` under a new category was rejected: a
voucher payment is *also* a GL credit to 1011, so the same peso would appear
under two categories and double-count.

Three columns on `DailyRemittance`:

```prisma
cashOnHandOut     Decimal @default(0) @db.Decimal(15, 2)   // 1010
pettyCashOut      Decimal @default(0) @db.Decimal(15, 2)   // 1011
pettyCashGcashOut Decimal @default(0) @db.Decimal(15, 2)   // 1012
```

Only outflows are stored, because only outflows are displayed. Inflows remain
available live from the GL via the Cash Position report.

The migration backfills existing saved reports from the GL.

Voucher counts are not persisted — the petty cash count is derived from the
saved `daily_remittance_items` rows, which already work.

### Controller changes

`calculate` swaps its `entryDate: { lte: endOfDay }` cash aggregates for
`entryDate: dayRange` ones — the same query shape with one filter changed. It
stops returning `pettyCashBalance`, `pettyCashFunded`, `pettyCashUsed`,
`cashOnHandBalance` and their GCash equivalents, and returns `cashOnHandOut`,
`pettyCashOut`, `pettyCashGcashOut` instead.

`save` persists the three new fields; `loadSaved` in the page reads them back.
The `asOfEndOf` helper is removed — it has no remaining caller.

The GCash card continues to render only when 1012 has activity.

## Part 2 — Cash Position report

### Endpoint

```
GET /api/reports/cash-position?from=YYYY-MM-DD&to=YYYY-MM-DD[&accountCode=1011]
```

New `server/controllers/cashPositionController.js`, mounted under the existing
reports routes. Three GL reads, then pure computation:

1. **Resolve accounts** — active `ASSET` accounts for the business whose
   `accountCode` starts `10` **and which have no child accounts**. This covers
   physical funds (1010, 1011, 1012) *and* banks (1020–1024), making it a full
   cash report. Omitting `accountCode` returns every one of them.

   The leaf test is required, not cosmetic: `1000 Current Assets` is an ASSET
   account whose code starts `10`, but it is the parent header of every account
   above and holds no postings. A plain `LIKE '10%'` filter would emit it as an
   empty row. Excluding parents is also the accounting-correct definition of a
   postable account, so it stays right if the COA is reorganised.
2. **Opening balance** per account — sum debit and credit over POSTED entries
   with `entryDate < from`.
3. **Movement** — `groupBy(entryDate, accountId)` summing debit and credit over
   POSTED entries within `[from, to]`.

DRAFT and VOIDED entries are excluded throughout, consistent with every other
report in the codebase.

### The cashbook function

The logic lives in one pure function, which is where the tests point:

```js
buildCashbook(opening, movements) →
  { rows: [{ date, begin, in, out, ending }], totalIn, totalOut, closing }
```

It walks the movement days in order, carrying the running balance. The
controller only feeds it and shapes the response.

**Rows are emitted only for days with movement.** A quiet month must not produce
thirty identical rows; the running balance already states the figure for any
date in between.

Response shape:

```json
{
  "from": "2026-08-01", "to": "2026-08-06",
  "accounts": [
    { "accountCode": "1011", "accountName": "Petty Cash Fund",
      "opening": 0, "closing": -90, "totalIn": 7830, "totalOut": 7920,
      "rows": [ { "date": "2026-08-03", "begin": 0, "in": 0, "out": 30, "ending": -30 } ] }
  ]
}
```

### Drill-down

```
GET /api/reports/cash-position/day?date=YYYY-MM-DD&accountCode=1011
```

Returns that day's journal lines for the account — entry no, reference,
description, in, out. Fetched lazily when a row is expanded, so opening the
report stays a single round trip.

### Frontend

New page at `app/(dashboard)/reports/cash-position/page.jsx`, following the
standard three-block pattern: `page-header`, filter `card`, data `card`.

- Filters: from/to dates, account selector defaulting to all cash accounts
- One table per account — Date, Begin, In, Out, Ending — with a totals row
- Clicking a date expands that day's transactions inline beneath the row
- Printing through `printDocument` from `@/lib/print`, as every other report does
- Nav entry under **Reports → Cash Position**, beside Trial Balance
- API helpers added to `lib/api.js` under `reports.cashPosition`

### Error handling

| Condition | Behaviour |
|---|---|
| `from` or `to` missing | 400 |
| `from` later than `to` | 400 |
| Range wider than 366 days | 400 — guards against an unbounded scan |
| `accountCode` is not a cash account, or is a header account | 400 |
| No cash accounts on the business | 200 with an empty `accounts` array |
| No movement in range | 200, `rows: []`, opening equal to closing |

## Testing

`buildCashbook` is pure, so the substantive tests need no database.

- **Running balance** — chains correctly across days; each row's `begin` equals
  the previous row's `ending`
- **Negative balances** — an overdrawn fund reports a negative ending rather
  than clamping (1011 genuinely sits at −₱90.00)
- **Gaps** — days with no movement emit no row and do not disturb the chain
- **Empty range** — opening equals closing, no rows
- **The invariant** — `opening + Σ(in − out) === closing`, for every account and
  every range
- **Cross-report agreement** — the Cash Position outflow for a date equals the
  Daily Remittance outflow for that same date. Both read the same GL; divergence
  is a bug and this test is what catches it.
- **Account resolution** — header accounts such as `1000 Current Assets` are
  excluded, and non-cash assets such as `1102`/`1104` never appear
- **Zero-activity day** — the Daily Remittance cards return ₱0.00 for a date
  with no cash entries, with nothing carried in from the previous day
- **Frozen report** — a saved record reloads with the outflow figures it was
  approved with, unchanged by a later backdated entry

The existing `tests/pettyCash.test.js` regression suite stays as-is.

## Out of scope

- Bank reconciliation — unchanged, and the existing page keeps that job
- Cash flow statement (operating/investing/financing) — a different report
- Multi-currency
- Any change to how vouchers or journal entries are posted

## Known data issue, not addressed here

Petty cash 1011 stands at **−₱90.00**: ₱7,920.00 disbursed against ₱7,830.00
funded. EV-000009 (₱30.00) was paid on Aug 3, two days before the fund was
established on Aug 5, and the Aug 5 vouchers exceed the top-up by ₱60.00.

This is a bookkeeping matter for the user — either a missing funding entry or a
voucher settled from a different pocket. The Cash Position report will surface
it as a negative running balance on Aug 3 and 4, which is the report doing its
job rather than a defect in it.
