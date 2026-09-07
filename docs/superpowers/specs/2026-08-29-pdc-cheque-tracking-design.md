# Post-Dated Cheque Tracking (Accounts Payable) — Design

**Date:** 2026-08-29
**Status:** Approved

## Goal

The owner pays vendors with post-dated cheques (issued now, cash-dated weeks
or a month out) and currently has no visibility into which cheques are still
outstanding, when each is due to clear, or a way to flag one that bounced.
Today `recordPayment`/`editPayment` treat a `'Check'`-method payment exactly
like cash — `DR Accounts Payable 2010 / CR Cash in Bank 1020` — the instant
it's recorded, which is both operationally blind (no aging/reminder) and
accounting-incorrect (the bank hasn't actually released the funds yet).

This adds a cheque lifecycle (`Outstanding → Cleared / Bounced / Cancelled`)
on top of the existing `PaymentAP` record, a holding liability account so
Cash isn't touched until a cheque is confirmed cleared, and a dedicated
**Payables → Cheques** page showing every outstanding cheque bucketed by how
soon it's due, with print/Excel export matching the existing AP Aging page.

## Scope decision

**Every `'Check'`-method payment goes through this workflow**, not just
ones dated in the future — a same-day check is still not cash until the
bank actually honors it, so there is no "immediate" fast path. Every other
payment method (Cash, Bank Transfer, Online Banking, GCash, Maya) is
completely unaffected and keeps posting straight to Cash exactly as today.

AP only. AR/customer cheques received are a separate, unrequested problem
(different risk — bounced *incoming* cheques are a collections issue, not a
cash-planning one) and out of scope here.

## Data model

Two new nullable columns on the existing `PaymentAP` model, one new enum —
no new top-level entity, because a cheque *is* a bill payment, just one that
isn't cash yet:

```prisma
enum ChequeStatus {
  OUTSTANDING
  CLEARED
  BOUNCED
  CANCELLED
}

model PaymentAP {
  id            Int           @id @default(autoincrement())
  paymentNo     String        @unique @db.VarChar(30)
  billId        Int
  bill          Bill          @relation(fields: [billId], references: [id])
  paymentDate   DateTime      @db.Date
  amount        Decimal       @db.Decimal(15, 2)
  paymentMethod String        @db.VarChar(50)
  reference     String?       @db.VarChar(100)
  notes         String?       @db.Text
  createdAt     DateTime      @default(now())

  checkDate      DateTime?     @db.Date      // NEW — maturity date on the cheque; null unless paymentMethod === 'Check'
  clearingStatus ChequeStatus?               // NEW — null unless paymentMethod === 'Check'

  @@index([billId])
  @@index([clearingStatus])                  // NEW — the Cheques page always filters on this
  @@map("payments_ap")
}
```

`reference` keeps doing double duty as the cheque number — it's already
labeled "Check no., transaction ID..." on the payment form
(`app/(dashboard)/payable/page.jsx:307`), no new field needed. A bounce/
cancel reason is appended to the existing `notes` field (`[BOUNCED:
<reason>]` / `[CANCELLED: <reason>]` prefix) rather than adding a dedicated
column — `AuditLog` already timestamps *when* and *who*, so no `clearedAt`/
`bouncedAt` columns either; the GL entries themselves carry the dates.

### Chart of Accounts

New liability account, seeded via `prisma/seed.js`'s existing `accounts`
array (upsert-based, so re-running `npm run db:seed` inserts this one row
into an already-seeded database without touching anything else):

```javascript
{ accountCode:'2015', accountName:'Post-Dated Checks Payable', accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
```

Placed right after `2010 Accounts Payable — Trade` / `2011`/`2012` in the
Payables group (`prisma/seed.js:107-110`). This is a holding account for
cheque value between "handed to the vendor" (AP relieved) and "actually
cashed by the bank" (Cash reduced) — the standard PFRS treatment, and what
makes the aging report meaningful (every row on it is real, uncashed
liability, not an accounting fiction).

## GL treatment — three moments, three entries

**1. Issue** (`recordPayment` or `editPayment`, when the payment's final
`paymentMethod === 'Check'`):
```
DR Accounts Payable — Trade (2010)      amount
    CR Post-Dated Checks Payable (2015)     amount
```
Posted under `reference: payment.paymentNo`, exactly like today's single
entry — only the credit account changes (`2015` instead of `1020`), and the
description changes from `"AP Payment"` to `"AP Payment (Check — Outstanding)"`
so it's self-explanatory in the General Ledger. Every other payment method
keeps `CR Cash in Bank (1020)` exactly as now.

**2. Cleared** (new `clearCheque` action, the owner confirms the bank
honored it):
```
DR Post-Dated Checks Payable (2015)     amount
    CR Cash in Bank (1020)                  amount
```
A **second, separate** journal entry, `entryDate: clearDate` (the date the
owner confirms the bank actually honored it — not necessarily the same as
`checkDate`), posted under `reference: \`${payment.paymentNo}-CLR\`` (not the
same reference as the issue entry) —
keeping the two entries independently addressable is what lets `bounce`/
`cancel` below safely void *only* the issue entry without risk of also
voiding a clearing entry that doesn't exist yet (bounce/cancel are only
reachable from `OUTSTANDING`, before any `-CLR` entry exists — see Backend).
The bill itself (`paidAmount`, `status`) is untouched by this step — it was
already relieved at issue time. `clearingStatus` moves `OUTSTANDING →
CLEARED`.

**3. Bounced / Cancelled** (new `bounceCheque`/`cancelCheque` actions): void
the **issue** entry (`voidPostedEntriesByReference(businessId,
payment.paymentNo, req, 'CHEQUE BOUNCED'|'CHEQUE CANCELLED')` — the same
helper `updateBill`/`voidBill`/`editPayment` already share) and put the
bill's `paidAmount`/`status` back to what they were before this payment
existed — the vendor is unpaid again. No new GL entry posts; there is
nothing to move, the cheque never became real money. This reuses
`editPayment`'s exact recompute arithmetic:
```javascript
const otherPaid = Number(bill.paidAmount) - Number(payment.amount);
const remaining = Number(bill.totalAmount) - otherPaid;
const status = remaining <= 0.01 ? 'PAID' : (otherPaid > 0.01 ? 'PARTIAL' : 'OPEN');
// bill.update({ paidAmount: otherPaid, status })
```
`clearingStatus` moves `OUTSTANDING → BOUNCED` or `OUTSTANDING → CANCELLED`.

## Backend

### `recordPayment` / `editPayment` — conditional cheque branch

Both existing functions (`server/controllers/payableController.js`) gain
one conditional: when the (possibly newly-edited) `paymentMethod ===
'Check'`, `checkDate` becomes required, `clearingStatus` is set/kept
`'OUTSTANDING'`, and the GL credit line targets `2015` instead of `1020`
with the adjusted description. When `paymentMethod` is anything else,
`checkDate`/`clearingStatus` are written as `null` and the GL line targets
`1020` exactly as today — so switching a payment *from* Check *to* Cash (or
vice versa) via Edit Payment is fully supported, driven entirely by the
final `paymentMethod` value at save time, not by what it used to be.

**`editPayment` gains one more eligibility guard**: once a cheque is no
longer `OUTSTANDING` (`CLEARED`, `BOUNCED`, or `CANCELLED`), the generic
Edit Payment path is blocked — `400 "This payment has already been
<cleared/bounced/cancelled> and can no longer be edited here."` A cleared
cheque has two linked GL entries under two different references; editing it
through the single-entry-per-`paymentNo` logic `editPayment` already uses
would be wrong. Non-check payments, and check payments still `OUTSTANDING`,
are unaffected and remain editable exactly as today.

### New endpoints, all under `/api/payable/cheques`, all ADMIN/MANAGER-only
(same risk tier as `editPayment`/`voidBill` — each one changes historical
money state):

- **`GET /api/payable/cheques`** — every `PaymentAP` row where
  `paymentMethod === 'Check'`, scoped `where: { paymentMethod: 'Check',
  bill: { businessId: req.businessId } }`, with `bill.billNo`,
  `bill.vendor.name` joined in. Optional `?status=OUTSTANDING|CLEARED|
  BOUNCED|CANCELLED` query filter (default: all, so the frontend can offer
  both an "Outstanding" aging tab and a "History" tab from one endpoint).
  Since `PaymentAP` carries no `businessId` column of its own (only `Bill`
  does), every lookup in this feature — this list, and each of
  `clear`/`bounce`/`cancel` below — filters through the `bill` relation
  rather than reading `PaymentAP` unscoped, the same scoped-lookup
  convention `editPayment` already established (in contrast to this file's
  older unscoped reads in `recordPayment`/`getBill`/`voidBill`, which this
  feature does not touch or need to fix).
- **`POST /api/payable/cheques/:paymentId/clear`** — body `{ clearDate }`.
  404 if not found; 400 if `clearingStatus !== 'OUTSTANDING'`. Posts the
  Cleared GL entry (above), sets `clearingStatus = 'CLEARED'`, records an
  audit `UPDATE` entry.
- **`POST /api/payable/cheques/:paymentId/bounce`** — body `{ reason }`
  (required — this is exactly the information the owner needs later to
  remember *why*). 404/400 guards as above. Voids the issue entry, reverts
  the bill, sets `clearingStatus = 'BOUNCED'`, appends `[BOUNCED: <reason>]`
  to `notes`, audits.
- **`POST /api/payable/cheques/:paymentId/cancel`** — identical to bounce
  (a stopped/voided-before-clearing cheque has the same accounting effect
  as a bounced one — the vendor was never actually paid), `clearingStatus =
  'CANCELLED'`, `[CANCELLED: <reason>]`. Implemented as the same internal
  helper as bounce, parameterized by target status/label, to avoid
  duplicating the revert arithmetic twice.

### Aging bucket helper

Bucketed on `checkDate` (the cheque's maturity date), not `paymentDate`:

```javascript
function chequeAgingBucket(checkDate) {
  const days = Math.floor((new Date(checkDate) - new Date()) / 86400000);
  if (days < 0)   return 'Past Due';   // outstanding but should already have cleared — flag red
  if (days <= 7)  return '0-7 days';
  if (days <= 14) return '8-14 days';
  if (days <= 30) return '15-30 days';
  return '30+ days';
}
```
Computed server-side in the `GET /cheques` response (mirrors how AP Aging's
`overdueSeverity`/bucket logic is already server-computed,
`payable/aging/page.jsx:69-77`), applied only to `OUTSTANDING` rows (a
`CLEARED`/`BOUNCED`/`CANCELLED` row has no meaningful "days until due" —
its story is already over).

## Frontend

- **New page** `app/(dashboard)/payable/cheques/page.jsx` — an "Outstanding"
  tab (default) grouped/summarized by the four buckets + Past Due, and a
  "History" tab (Cleared/Bounced/Cancelled) for the record. Each outstanding
  row shows vendor, bill no., amount, cheque no. (`reference`), check date,
  bucket badge, and three action buttons (Clear / Bounced / Cancel), each
  opening a small confirm dialog (`clear` asks for a clear date, defaulting
  to today; `bounce`/`cancel` require a reason).
- **Nav entry**: `components/layout/Sidebar.jsx`'s `NAV` array, Accounts
  Payable section (`Sidebar.jsx:54-59`) — add `{ label: 'Cheques', href:
  '/payable/cheques' }` alongside the existing Bills/Vendors/AP Aging links.
- **`lib/api.js`**: new `payable.cheques` group — `list(params)`,
  `clear(paymentId, data)`, `bounce(paymentId, data)`,
  `cancel(paymentId, data)`.
- **`PaymentModal`/`EditPaymentModal`** (`app/(dashboard)/payable/page.jsx`):
  a conditional "Check Date" date input appears when `form.paymentMethod ===
  'Check'`, required before submit. `EditPaymentModal`'s pencil-icon trigger
  in `BillDetailModal`'s Payment History list is hidden (not just disabled)
  for a row whose `clearingStatus` is `CLEARED`/`BOUNCED`/`CANCELLED` — that
  row is frozen, matching the backend guard. A `CLEARED`/`BOUNCED`/
  `CANCELLED` row also gets a small status badge next to it in Payment
  History so the bill detail view itself shows cheque state at a glance,
  not just the dedicated Cheques page.
- **Print/export**: same pattern as AP Aging — `printDocument()`
  (`lib/print.js`) for a branded print/Save-as-PDF view of the outstanding
  list (grouped by bucket, matching the owner's "avoid bounced checks" use
  case), plus `exportToExcel()` (`lib/export.js`) for a downloadable
  spreadsheet. No new dependency, consistent with the whole app.

## Error handling

- 404 if the `paymentId` doesn't exist, isn't a Check-method payment, or
  belongs to a bill outside the caller's business (never distinguished from
  each other, matching this file's existing non-leaking convention).
- 400 if `clear`/`bounce`/`cancel` is attempted on a payment whose
  `clearingStatus` isn't `OUTSTANDING` (already settled one way or another).
- 400 if `recordPayment`/`editPayment` is given `paymentMethod: 'Check'`
  with no `checkDate` (express-validator conditional: `body('checkDate')
  .if(body('paymentMethod').equals('Check')).isISO8601()`).
- 400 `bounce`/`cancel` with no `reason` — the whole point of tracking this
  is remembering why, so it isn't optional.
- GL posting/voiding failures are non-blocking (`safePost`/
  `voidPostedEntriesByReference` convention throughout this file) — the
  status transition still succeeds; a failure is recorded to the Audit
  Trail as `GL_POST_FAILED`, same as every other write path in this
  controller.

## Out of scope

- AR/customer-received cheques (a different, unrequested problem).
- Which specific bank account a cheque clears into — `Clear` always credits
  `1020 Cash in Bank — BDO Checking`, matching the pre-existing
  simplification that every payment method already posts through the same
  hardcoded cash account regardless of method (`recordPayment`'s current
  `accountCode: '1020'` is unconditional today). Multi-bank-account cheque
  routing is a separate, larger feature.
- Editing a `CLEARED`/`BOUNCED`/`CANCELLED` cheque's amount/date/reference
  after the fact — if one of those was recorded wrong, the correction is a
  manual adjusting journal entry, the same fallback this codebase already
  uses for a fully `PAID` bill.
- Automated reminders/notifications as a cheque approaches its due date
  (e.g. email/push) — the Cheques page and its aging buckets/print/export
  are the visibility mechanism requested; a notification system is a
  separate feature.
- A `checkDate`-vs-`paymentDate` sanity check (e.g. warning if someone
  enters a `checkDate` in the past for a brand-new payment) — the owner's
  own bucket ("Past Due") already surfaces that same information post-save,
  and blocking entry would get in the way of legitimately back-dating a
  correction.
