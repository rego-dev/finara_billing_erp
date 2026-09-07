# Add Line Items to Open/Partial Bills — Design

**Date:** 2026-08-28
**Status:** Approved

## Goal

Today `Bill` (`prisma/schema.prisma:222-248`) has no edit capability at
all — only Create, Record Payment, and Void
(`server/controllers/payableController.js`). Staff need to add a forgotten
or late-arriving item to a bill after it's already been created, as long as
it isn't fully paid or voided, and see when that happened.

This is deliberately narrower than a general "edit invoice" feature: it
only **adds new line items**, never edits or removes existing ones, and it
records a single `lastEditedAt` timestamp rather than a full history log.

## Scope decision

Adding items is allowed only when `status === 'OPEN' || status === 'PARTIAL'`
— the same population Void today excludes `PAID`/`VOID` from, but broader
than Void's own `paidAmount == 0` gate: a `PARTIAL` bill (some payments
already recorded) can still receive new items, since adding items only ever
increases `totalAmount`, which can't create an inconsistency with what's
already been paid the way *reducing* a total could.

Existing lines are immutable through this feature — no edit, no delete.
Multiple new lines can be submitted in one save (matching the multi-line
table `CreateBillModal` already uses), all sharing the same user-entered
edit date and posted as one incremental GL entry.

## Data model

One new column: `Bill.lastEditedAt DateTime? @db.DateTime(0)` — null until
the first time items are added, then holds the **user-entered** edit date
from the most recent add-items call (not a full audit log; each new add
overwrites it). Requires `npm run db:generate && npm run db:migrate`.

`BillLine` (`prisma/schema.prisma:250-264`) is unchanged — new rows are
simply `create`d against the existing `billId`, same shape `createBill`
already produces.

## Backend — `addBillItems`

New `exports.addBillItems` in `server/controllers/payableController.js`,
routed as `POST /payable/:id/lines` in `server/routes/payable.js`, with
validators mirroring `POST /` (`param('id').isInt()`, `body('editDate').isISO8601()`,
`body('lines').isArray({ min: 1 })`, plus the same per-line validators
`createBill` uses: `accountId` int, `description` non-empty, `quantity`
float ≥ 0.001, `unitPrice` float ≥ 0, `vatCode` in `['VAT','EXEMPT','ZERO']`).

1. Fetch the bill (404 if missing).
2. `status === 'PAID'` → 400 `"Cannot add items to a fully paid bill."`
   `status === 'VOID'` → 400 `"Cannot add items to a voided bill."`
3. Compute each new line's amount/VAT with the exact same logic
   `createBill` uses (`payableController.js:114-120`): `l.vatCode === 'VAT'
   ? computeVAT(amt) : { base: amt, vat: 0, total: amt }`. Sum into
   `incSubtotal` / `incVat` / `incTotal`.
4. `prisma.bill.update({ where: { id }, data: { subtotal: { increment:
   incSubtotal }, vatAmount: { increment: incVat }, totalAmount: {
   increment: incTotal }, lastEditedAt: new Date(editDate), lines: {
   create: [...] } }, include: { vendor: true, lines: true } })`. Status is
   left untouched — adding items never reduces the outstanding balance, so
   `OPEN`/`PARTIAL` stays exactly what it already was.
5. GL posting (best-effort, same `safePost` convention as `createBill`,
   non-blocking):
   ```
   glPost.safePost({
     entryDate:   editDate,
     description: `AP Bill Edit — ${bill.vendor.name} (${bill.billNo})`,
     reference:   bill.billNo,
     lines: [
       ...newLines.map(l => ({ accountId: l.accountId, debit: l.amount, description: l.description })),
       ...(incVat > 0 ? [{ accountCode: '1330', debit: incVat, description: 'Input VAT' }] : []),
       { accountCode: '2010', credit: incTotal, description: `AP — ${bill.vendor.name} (${bill.billNo}) — item added` },
     ],
     userId: req.user?.id || 1,
     businessId: req.businessId,
   })
   ```
   This is a **second** posted `JournalEntry` sharing the same
   `reference = bill.billNo` as the original creation entry — `reference`
   is not unique on `JournalEntry` (`prisma/schema.prisma:159`), so this is
   safe, but it means any code that looks up "the" entry for a bill by
   `reference` needs to expect more than one row (see `voidBill` fix below).
6. Respond `200` with the updated bill (vendor + lines included), same
   shape `getBill` already returns.

The bill-update DB write (step 4) and the GL post (step 5) are **not**
wrapped in one transaction — matches `createBill`'s own existing structure
(DB write, then a separate best-effort GL post).

## Required fix — `voidBill`

`voidBill` (`payableController.js:207-240`) currently does
`prisma.journalEntry.findFirst({ where: { reference: bill.billNo, status:
'POSTED' } })` and voids that one entry. Once a bill can have two posted
entries sharing that reference (original + incremental), this must become
`findMany`, voiding every match:

```js
const entries = await prisma.journalEntry.findMany({
  where: { businessId: bill.businessId, reference: bill.billNo, status: 'POSTED' },
});
for (const entry of entries) {
  try {
    await prisma.journalEntry.update({ where: { id: entry.id }, data: { status: 'VOIDED' } });
  } catch (err) {
    // same per-entry logger.error + recordAudit(GL_POST_FAILED) as today,
    // one entry's failure must not stop the rest from being voided
  }
}
```

Voiding a bill is already gated to `paidAmount === 0` — unaffected by this
change; a bill can still have had items added (and thus two entries) while
never having received a payment.

## Frontend

**`lib/api.js`** (`lib/api.js:210-217`): add `addItems: (id, data) =>
api.post(\`/payable/${id}/lines\`, data)` to `payable.bills`.

**`BillDetailModal`** (`app/(dashboard)/payable/page.jsx:42-226`):

- When `bill.lastEditedAt` is set, show "Last edited: {formatDate(...)}"
  next to the existing Bill Date / Due Date / TIN row.
- When `bill.status === 'OPEN' || bill.status === 'PARTIAL'`, render a
  collapsed-by-default "Add Items" section below the existing Line Items
  table: an "Edit Date" date input (defaults to today, editable) and a
  multi-line table reusing the same column layout `CreateBillModal`'s line
  editor already uses (`page.jsx:441-531`: Account/Description/VAT/Qty/Unit
  Price/Amount + Add Line / remove-row), scoped to only the *new* lines
  being added — the existing lines table above it is untouched, read-only.
- A "Save Items" button posts via `pApi.bills.addItems(bill.id, { editDate,
  lines })`, then re-fetches the bill (`pApi.bills.get`) to refresh the
  modal in place and calls the same `load()` the parent already passes down
  for Payment/Void (list totals changed), then collapses the section back
  and clears its pending rows.
- Reuses `computeVAT` (already defined at `page.jsx:37-39`) for the running
  total shown while adding lines, same as `CreateBillModal`.

No new icon-button is added to the bills list row — Add Items is
reachable only through the detail modal (opened via the existing Eye
icon), matching how Payment and Void are already modal-only actions.

## Error handling

- 404 if the bill doesn't exist.
- 400 `status === 'PAID'` — cannot add items to a fully settled bill.
- 400 `status === 'VOID'` — cannot add items to a dead bill.
- Standard express-validator 400s for malformed body (missing `editDate`,
  empty `lines` array, bad line fields) — identical validator shapes to
  `POST /`, so behavior is consistent between the two endpoints.
- GL posting failure is non-blocking, matching `safePost`'s app-wide
  convention — the add-items call still succeeds, Audit Trail records the
  failure (`GL_POST_FAILED`).
- Frontend surfaces all errors via the existing toast-on-catch pattern
  `CreateBillModal.handleSubmit` already uses.

## Out of scope

- Editing or removing existing line items — only adding new ones.
- A full edit-history log (every add-items event, what was added, by whom)
  — only the single most-recent `lastEditedAt` timestamp is tracked.
- Reducing a bill's total, or any change to `paidAmount`/`PaymentAP`
  records — this feature only ever increases a bill's total.
- Editing bill header fields (vendor, bill date, due date, description) —
  unchanged from today; only line items can be added.
