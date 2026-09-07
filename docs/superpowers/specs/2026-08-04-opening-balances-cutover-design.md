# Opening Balances & Books Cutover

**Date:** 2026-08-04
**Branch:** to be created off `feat/cash-request` or `main`
**Status:** Approved for planning

## Problem

Finara has no concept of a "books start date". Every document posts to the GL
regardless of its date, so entering historical records — receivables raised and
collected before the business started using Finara — corrupts the current books
three ways.

Entering one already-paid ₱10,000 historical invoice today produces:

```
createInvoice   (receivableController.js:148)
  DR 1100 Accounts Receivable    10,000
  CR 4xxx Revenue                 8,929   ← inflates the CURRENT period's revenue
  CR 2030 Output VAT              1,071   ← VAT already declared in a prior filing

recordPayment   (receivableController.js:192)
  DR 1010 Cash on Hand           10,000   ← cash that does not physically exist
  CR 1100 Accounts Receivable    10,000
```

The Output VAT is the most serious: that invoice's VAT was already remitted
under a previous 2550M/Q, and re-recording it overstates the current VAT payable
to BIR.

## Accounting principle

A transaction dated before the cutover is already represented inside the opening
balances. Re-posting it double-counts. An invoice both **raised and settled**
before cutover has a net effect of **zero** on today's balance sheet — receivable
up then down, cash in then out — so it must post nothing at all.

An invoice raised before cutover but **still outstanding** is different: it must
appear in receivables, offset against equity rather than revenue, because the
revenue was earned in a prior period.

## Goals

- Stop pre-cutover documents from touching revenue, VAT and cash.
- Establish a correct day-one balance sheet.
- Prove the migration is arithmetically consistent.

## Non-goals

Importing historical data from spreadsheets or other systems (documents are
entered through the existing screens), restating prior-period financial
statements, and multi-currency opening balances.

---

## Architecture

### The single choke point

There are **15 `glPost.safePost` call sites across 11 controllers** —
receivables, payables, payroll, inventory, assets, expenses, cash requests,
quotations, purchase orders, remittances. Putting a cutover check in each one
would be 15 chances to forget, and every future module would be a new chance.

The guard belongs inside `glPost.post()` instead. It already receives
`entryDate` and `businessId`, which is everything the decision needs.

```js
post({ entryDate, businessId, ... })
  └─ businessId's booksStartDate exists AND entryDate < booksStartDate
       └─ return { skipped: 'PRE_CUTOVER' }   // no journal entry written
```

`safePost` delegates to `post`, so both entry points are covered by one change,
as is any module added later.

### Business cutover date

`Business.booksStartDate DateTime? @db.Date` — nullable. A null date means "no
cutover configured", and the guard is inert, so existing installations behave
exactly as they do today. Each of the three businesses migrates on its own date.

Looked up through an in-memory cache keyed by `businessId`, mirroring the
existing `_cache` used for account codes in the same module. Updating the
setting must clear that cache, or posting keeps honouring the stale date.

---

## Phase 1 — Cutover guard

- `Business.booksStartDate` plus migration.
- The guard in `glPost.post()`, returning `{ skipped: 'PRE_CUTOVER' }`.
- Business cache and `clearBusinessCache()`, called on business update.
- Books-start-date field on the business settings screen.
- An "Opening entry · not posted to GL" badge on documents dated before cutover,
  so an encoder can see at a glance why no journal entry exists.

**Callers must tolerate a skipped post.** Most already ignore the return value;
`assetController.js:173` assigns it to `je` and must handle the skip marker
rather than assuming a journal entry object.

## Phase 2 — Opening balances

New account `3070 Opening Balance Equity` (`EQUITY`, `CREDIT`, parent `3000`),
added to `prisma/seed.js` after `3060 Treasury Stock` and backfilled into the
three existing businesses.

Why a dedicated account rather than reusing `3030 Retained Earnings`: migration
entries stay isolated and auditable instead of being mixed into real prior-year
profit. A non-zero balance in 3070 after migration is itself a signal that
something did not reconcile.

A screen collects the day-one figures and posts **one balanced journal entry**
dated on the cutover date:

```
DR 1100 Accounts Receivable      500,000   ← only invoices STILL outstanding
DR 1010 Cash on Hand              25,000   ← actual physical count
DR 1020 Cash in Bank             310,000   ← actual bank statement balance
   CR 2010 Accounts Payable — Trade         180,000
   CR 3070 Opening Balance Equity           655,000
```

Fully-settled historical invoices contribute nothing here, which is correct —
they are closed.

**⚠️ The opening entry must bypass its own guard.** It is dated on the cutover
date, so the Phase 1 rule would skip it and silently leave the balance sheet
empty. `post()` takes an explicit `isOpeningEntry: true` flag that bypasses the
check. This is the single most dangerous detail in this design: the failure is
silent, and it would look like the feature simply did nothing.

## Phase 3 — Reconciliation and BIR safety

**Reconciliation.** Sum the unpaid balances of all pre-cutover invoices and
compare against the AR figure in the opening entry; same for bills against AP.
A mismatch means a document was mis-entered or the opening figure is wrong.
This is what turns the migration from hope into arithmetic.

**BIR safety — a real trap.** `birController` reads **directly from the
`invoice` and `bill` tables**, not from the GL (`birController.js:32`, `:217`).
Skipping GL posting therefore does *not* protect VAT returns: a historical
invoice dated May 2026 still appears in a May 2026 SLSP or 2550 run and
re-declares VAT already filed.

Pre-cutover documents must be excluded from BIR report queries, and a report
whose range starts before the cutover date must warn the user explicitly.

---

## Testing

| What | How |
|---|---|
| Guard skips a pre-cutover date, allows on/after, inert when `booksStartDate` is null | Unit tests against `glPost.post` with a mocked Prisma |
| Date-boundary correctness — entry exactly on the cutover date **posts** | Unit test; off-by-one here silently drops a real day of entries |
| `entryDate` accepted as both `'YYYY-MM-DD'` string and `Date` | Unit test — call sites pass both forms today |
| `isOpeningEntry` bypasses the guard | Unit test |
| Opening entry balances and lands in 3070 | Post one and inspect the journal entry |
| Reconciliation flags a deliberate mismatch | Seed a wrong figure and confirm it reports |
| Historical invoice produces no revenue, VAT or cash movement | Browser walkthrough plus a GL query |

## Risks

- **Silent skipping.** A misconfigured cutover date would quietly stop posting
  real entries. Mitigated by the badge, by logging every skip, and by making the
  boundary date an explicit test case.
- **Cache staleness.** Changing the date without clearing the cache keeps the old
  behaviour until restart. Mitigated by `clearBusinessCache()` on update.
- **Scope.** This touches the module every posting flows through. Phase 1 is
  deliberately small and independently shippable for that reason.
