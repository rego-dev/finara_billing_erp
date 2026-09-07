# Edit AP Bill Payment — Design

**Date:** 2026-08-29
**Status:** Approved

## Goal

Let ADMIN/MANAGER correct a wrong `PaymentAP` record on a Bill — e.g. staff
recorded the bill as fully paid when the actual cash received/paid was much
smaller. Today the AP module has no way to touch an existing payment: only
`recordPayment` (add a new one) and `voidBill` (which requires
`paidAmount === 0`, so it can't help once any payment exists) exist. This
closes that gap by letting a payment's amount/date/method/reference/notes be
edited in place, with the bill's `paidAmount`/`status` and GL entries
corrected to match — mirroring the GL-void-then-repost pattern
`updateBill` already uses (`2026-08-28-bill-full-edit-design.md`).

## Scope decision

Edit is allowed on any individual `PaymentAP` row as long as its parent bill
is not `VOID`. In particular it **is** allowed when the bill's status is
`PAID` — that is exactly the accidental-full-payment scenario this feature
exists for, so it cannot be gated behind the same `status !== 'PAID'` rule
`updateBill`/Record Payment use for the *bill's* own fields.

Restricted to `ADMIN`/`MANAGER`, same as `voidBill` — editing a payment can
change historical cash/AP balances, a different risk tier than editing a
bill's not-yet-settled line items (which `createBill`/`updateBill` allow any
authenticated user to do).

All of `PaymentAP`'s user-entered fields are editable: `paymentDate`,
`amount`, `paymentMethod`, `reference`, `notes` — not just `amount` — so a
wrong check number or payment date can be corrected the same way. `billId`
is never editable (a payment can't be moved to a different bill; that would
be void-and-recreate, out of scope here).

## Data model

No schema change. `PaymentAP.paymentNo` never changes on edit — same
payment record, same number, corrected contents — exactly how `Bill.billNo`
survives a bill edit unchanged.

## Backend

### Route

`server/routes/payable.js`, added after the existing `router.put('/:id',
...)` block:

```javascript
router.put('/:id/payment/:paymentId',
  authorize('ADMIN','MANAGER'),
  [
    param('id').isInt(),
    param('paymentId').isInt(),
    body('paymentDate').isISO8601(),
    body('amount').isFloat({ min: 0.01 }),
    body('paymentMethod').notEmpty(),
  ],
  validate, ctrl.editPayment);
```

Same body validators `POST /:id/payment` already uses.

### `editPayment` (`server/controllers/payableController.js`)

1. `prisma.bill.findFirst({ where: { id, businessId: req.businessId },
   include: { payments: true, vendor: true } })` — 404 `'Bill not found'` if
   missing (scoped lookup, matching `updateBill`'s convention rather than
   `recordPayment`'s older unscoped `findUnique`).
2. `const payment = bill.payments.find(p => p.id === paymentId)` — 404
   `'Payment not found'` if it doesn't belong to this bill.
3. `bill.status === 'VOID'` → 400 `'Cannot edit a payment on a voided
   bill.'`
4. Compute `otherPaid = Number(bill.paidAmount) - Number(payment.amount)`
   (the bill's paid total with this payment backed out), then `newPaid =
   otherPaid + Number(amount)`.
5. `if (newPaid > Number(bill.totalAmount) + 0.01) throw createError(
   \`Amount exceeds bill total. Balance available for this payment: ₱
   ${(Number(bill.totalAmount) - otherPaid).toFixed(2)}.\`, 400)` — the
   equivalent of `PaymentModal`'s existing "exceeds balance" check, just
   computed with this payment's old amount excluded.
6. Recompute status the same way `recordPayment` does, but now also
   covering the drop-to-zero case this feature exists for: `const remaining
   = Number(bill.totalAmount) - newPaid; const status = remaining <= 0.01 ?
   'PAID' : (newPaid > 0.01 ? 'PARTIAL' : 'OPEN');`
7. `await prisma.$transaction([ prisma.paymentAP.update({ where: { id:
   paymentId }, data: { paymentDate: new Date(paymentDate), amount:
   Number(amount), paymentMethod, reference, notes } }),
   prisma.bill.update({ where: { id }, data: { paidAmount: newPaid, status
   } }) ]);` — same two-write transaction shape `recordPayment` already
   uses.
8. GL correction, reusing the `voidPostedEntriesByReference` helper
   `updateBill`/`voidBill` already share — but keyed on the **payment's**
   reference (`payment.paymentNo`), not the bill's `billNo`, since each
   payment posts its own DR-AP/CR-Cash entry under its own `paymentNo`
   reference (`recordPayment`, existing code): `await
   voidPostedEntriesByReference(bill.businessId, payment.paymentNo, req,
   'PAYMENT EDIT');` then
   ```javascript
   const glResult = await glPost.safePost({
     entryDate:   paymentDate,
     description: `AP Payment (Edited) — ${bill.vendor.name} (${bill.billNo})`,
     reference:   payment.paymentNo,
     lines: [
       { accountCode: '2010', debit:  Number(amount), description: `Clear AP — ${bill.vendor.name}` },
       { accountCode: '1020', credit: Number(amount), description: `Cash out — ${payment.paymentNo}` },
     ],
     userId: req.user?.id || 1,
     businessId: req.businessId,
   });
   ```
   followed by the same non-blocking `GL_POST_FAILED` audit-on-skip/failure
   handling `updateBill` already has after its own `safePost` call (copied
   verbatim, same rationale: voiding already happened, so silence here
   would drop the correction from the ledger with no trace).
9. Respond `200` with `{ message: 'Payment updated', remainingBalance:
   Math.max(0, remaining) }` — same response shape `recordPayment` returns,
   so the frontend can reuse its existing success handling.

## Frontend

### `lib/api.js`

Add to the `bills` object (`lib/api.js:210-218`), after `payment`:
```javascript
editPayment: (id, paymentId, data) => api.put(`/payable/${id}/payment/${paymentId}`, data),
```

### `app/(dashboard)/payable/page.jsx`

- `Pencil` is already imported (`page.jsx:8`, used by the bill-level Edit
  button) — reused for the per-payment edit icon, no new icon import
  needed.
- **Payment History list** in `BillDetailModal` (`page.jsx:182-198`): each
  row gets a small edit icon button, shown whenever `bill.status !==
  'VOID'` (i.e. not gated by the bill's own status, unlike the bill-level
  Edit/Record-Payment buttons at `page.jsx:211-220`) — calls a new
  `onEditPayment(payment)` prop. `BillDetailModal`'s prop list grows from
  `{ bill, onClose, onPayment, onVoid, onEdit }` to `{ bill, onClose,
  onPayment, onVoid, onEdit, onEditPayment }`.
- New `EditPaymentModal` component, placed after `PaymentModal`
  (`page.jsx:326`), same structure as `PaymentModal` but:
  - Title "Edit Payment".
  - Form state initializes from the passed-in `payment`
    (`paymentDate.slice(0,10)`, `amount`, `paymentMethod`, `reference`,
    `notes`), not a fresh blank form.
  - Balance shown/validated excludes this payment's own current amount:
    `const otherPaid = Number(bill.paidAmount) - Number(payment.amount);
    const balance = Number(bill.totalAmount) - otherPaid;` — same "Max:
    {balance}" hint and >balance rejection `PaymentModal` already has, just
    computed against `otherPaid` instead of `bill.paidAmount`.
  - Submits via `pApi.bills.editPayment(bill.id, payment.id, { ...form,
    amount: Number(form.amount) })`.
  - Success toast "Payment updated successfully"; error toast reuses
    `err.response?.data?.error || 'Payment update failed'`.
  - `onSaved()` callback (reuses the same refresh path `onPaid` triggers
    for `PaymentModal` today — reload the bill detail + list).
- `BillsPage`'s modal state gains `modal?.type === 'editPayment'` (carrying
  both `bill` and `payment`), rendered alongside the existing
  `modal?.type === 'payment'` block (`page.jsx:980-...`), and
  `BillDetailModal`'s render gets `onEditPayment={(payment) =>
  setModal({ type: 'editPayment', bill: modal.bill, payment })}`.
- No frontend role-gating for ADMIN/MANAGER — consistent with how Void
  Bill is handled today (backend `authorize()` is the only enforcement; a
  disallowed user gets the standard toast-on-403).

## Error handling

- 404 if the bill doesn't exist, isn't in the caller's business, or the
  `paymentId` doesn't belong to that bill — never distinguished from each
  other (matches the non-leaking convention `updateBill` uses).
- 400 if the bill is `VOID`.
- 400 if the corrected amount would push `paidAmount` past `totalAmount`.
- Standard express-validator 400s for malformed body (bad date, amount
  `<= 0`, empty method) — identical validators to Record Payment.
- GL posting/voiding failures are non-blocking (`safePost` convention) —
  the edit still succeeds; a failure is recorded to the Audit Trail as
  `GL_POST_FAILED`, same as `updateBill`.
- Frontend surfaces all errors via the existing toast-on-catch pattern.

## Out of scope

- Editing a payment on a `VOID` bill.
- Deleting a payment outright (only editing its fields) — if a payment
  needs to disappear entirely, editing its amount down to correct and
  leaving a note is the supported path; a dedicated delete/void-payment
  action is not part of this design.
- AR (`PaymentAR` / customer invoices) — this design covers AP bills only.
  The same gap likely exists on the AR side but the user's request was
  specifically about vendor bills.
- Any change to how `OVERDUE` status gets applied — out of scope for this
  feature; `editPayment`'s status recompute only ever produces `PAID`,
  `PARTIAL`, or `OPEN`, matching `recordPayment`'s own existing behavior of
  never itself setting `OVERDUE`.
- An edit-history log of prior payment values beyond what the Audit Trail
  already captures for the GL side.
