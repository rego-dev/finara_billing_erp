# Bill Editing (Open, Partial, or Overdue Bills) — Design

**Date:** 2026-08-28
**Status:** Approved
**Supersedes:** `2026-08-28-bill-add-items-design.md` — this design replaces the
"Add Items" feature it specified (built and shipped earlier in this same
session) with full editing, matching how `2026-08-11-invoice-edit-design.md`
already lets staff edit a Sales Invoice.

## Goal

Let staff correct or add to a Bill — wrong vendor, wrong line item, wrong
price, an additional item — without voiding and recreating it, for as long
as it isn't fully paid. This mirrors Invoice editing exactly: same
eligibility rule, same "can't drop the total below what's already paid"
guard, same full-replace line-item mechanics, same GL-void-then-repost
correction. The user explicitly asked for parity with Invoice editing
rather than the narrower "add items only" feature this session built first.

## Why the earlier "Add Items" design is being replaced, not extended

The 2026-08-28 "Add Items" design (`addBillItems`, `POST /payable/:id/lines`)
only ever added new lines and asked the user to type a separate "edit date"
for the incremental GL entry. Once existing lines can also be edited or
removed — which full parity with Invoice requires — that endpoint's
additive-only mechanics (`{ increment: ... }` on the bill's totals, a
second GL entry alongside the original) can't express "the vendor was
wrong" or "delete this line." Rather than run two divergent edit paths
side by side, this design retires `addBillItems` entirely in favor of one
`updateBill` that can do everything, exactly as Invoice has only one
`updateInvoice`.

The "edit date" concept is also dropped. Invoice editing has no such field
— the corrected GL entry posts on the bill's own (possibly also-edited)
`billDate`, and no "last edited" timestamp is shown anywhere. Posting on
`billDate` instead of a separately-typed date also removes the VAT-period
discrepancy risk the "Add Items" design's final review flagged (the BIR
purchases-book reads bills by `billDate`; posting the GL on that same date
keeps the two in agreement by construction, so no UI warning is needed
either).

## Scope decision

**Edit is allowed whenever the bill isn't fully paid or voided:**
`status !== 'PAID' && status !== 'VOID'` — i.e. `OPEN`, `PARTIAL`, or
`OVERDUE`. This is deliberately broader than Void's own eligibility rule
(`paidAmount == 0`) — a `PARTIAL` bill (some payments already recorded) is
still editable, e.g. to add a line the vendor is asking for before final
settlement. The one guard this broader scope requires, identical to
Invoice: **the edited total can never drop below what's already been
paid.** If `newTotalAmount < paidAmount`, the save is rejected — existing
`PaymentAP` records are never touched or reversed by an edit, only the
bill's own totals and status are recomputed around them.

Everything on the bill is editable when the status check passes: vendor,
bill date, due date, description, notes, and the full line-items table
(add/remove/edit lines) — the same fields `CreateBillModal` already
exposes on create. There is no narrower "amounts only" mode. Once a bill
is fully `PAID`, it is frozen — the only correction available is a manual
adjusting entry (Void is also blocked at that point, same as today, since
`voidBill` already requires `paidAmount == 0`).

## Data model

**Drop `Bill.lastEditedAt`** — the column added for the now-retired "Add
Items" design (`prisma/schema.prisma`, added 2026-08-28 migration
`20260828013508_add_bill_last_edited_at`). A new migration removes it;
nothing else references it once the frontend display is removed (below).

No other schema change. `Bill.billNo` never changes on edit — same bill,
same number, corrected contents. `BillLine` rows are fully replaced on
each edit (delete-all-then-recreate via Prisma's nested `lines: {
deleteMany: {}, create: [...] }`), matching `BillLine`'s existing cascade
(`prisma/schema.prisma:253`, `onDelete: Cascade`) and exactly how
`updateInvoice` already handles `InvoiceLine`.

## Backend

### Two helpers shared by `createBill` and `updateBill`

`server/controllers/payableController.js` currently computes VAT/totals
inline inside `createBill` (lines 113-120) with no `normalBalance` check —
so a contra-expense account (`5013 Purchase Discounts`, `5014 Purchase
Returns & Allowances` — both `EXPENSE` type but `normalBalance: CREDIT`,
`prisma/seed.js:205-206`) gets *added* to the bill total instead of
subtracted. This is the exact bug class `computeInvoiceTotals`
(`receivableController.js:21-38`) already fixes on the AR side. Both
`createBill` and the new `updateBill` move to a shared, sign-aware helper
so create and edit never drift apart the way AP and AR did:

```javascript
// Shared by createBill/updateBill: recompute per-line VAT + running totals.
// Contra-expense accounts (e.g. Purchase Discounts, Purchase Returns &
// Allowances — EXPENSE type but normalBalance CREDIT) reduce the subtotal
// instead of adding to it, so their line amount is negated before VAT is
// applied.
async function computeBillTotals(lines) {
  const accountIds = [...new Set(lines.map((l) => Number(l.accountId)))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, normalBalance: true },
  });
  const normalBalanceById = new Map(accounts.map((a) => [a.id, a.normalBalance]));

  let subtotal = 0, vatAmount = 0;
  const processedLines = lines.map((l) => {
    const sign = normalBalanceById.get(Number(l.accountId)) === 'CREDIT' ? -1 : 1;
    const amt = sign * Number(l.quantity) * Number(l.unitPrice);
    const v = l.vatCode === 'VAT' ? computeVAT(amt) : { base: amt, vat: 0, total: amt };
    subtotal += v.base; vatAmount += v.vat;
    return { ...l, amount: v.base };
  });
  return { subtotal, vatAmount, totalAmount: subtotal + vatAmount, processedLines };
}

// Shared by createBill/updateBill: DR each expense/cost line (or CR for a
// contra-expense line, since l.amount is already negative for those,
// matching their CREDIT normal balance) / DR Input VAT / CR Accounts
// Payable — Trade.
function buildBillGLLines(bill) {
  return [
    ...bill.lines.map((l) => {
      const amt = Number(l.amount);
      return amt < 0
        ? { accountId: l.accountId, credit: -amt, description: l.description }
        : { accountId: l.accountId, debit: amt, description: l.description };
    }),
    ...(Number(bill.vatAmount) > 0 ? [{
      accountCode: '1330', debit: Number(bill.vatAmount), description: 'Input VAT',
    }] : []),
    {
      accountCode: '2010', credit: Number(bill.totalAmount),
      description: `AP — ${bill.vendor.name} (${bill.billNo})`,
    },
  ];
}
```

This mirrors `computeInvoiceTotals`/`buildInvoiceGLLines`
(`receivableController.js:21-54`) with the sign flipped: contra-*revenue*
lines carry `normalBalance: DEBIT` (subtracted from a normally-CREDIT
revenue book), while contra-*expense* lines carry `normalBalance: CREDIT`
(subtracted from a normally-DEBIT expense book) — hence `=== 'CREDIT'`
here versus `=== 'DEBIT'` on the AR side. The DR/CR balance still holds by
construction: total debits (`sum of positive-line amounts + vatAmount`)
always equals total credits (`sum of negated negative-line amounts +
totalAmount`), the same algebraic guarantee `buildInvoiceGLLines` already
relies on.

`createBill` (lines 109-169) changes to call `computeBillTotals(lines)`
instead of its current inline loop, and `buildBillGLLines(bill)` instead
of its current inline `glLines` array — same resulting shape, now
contra-account-aware and shared with `updateBill`.

### One helper shared by `voidBill` and `updateBill`

`voidBill` (lines 272-307) already voids *every* `POSTED` journal entry
sharing `reference = bill.billNo` (a fix from the now-retired "Add Items"
design, needed because that design could leave a bill with two entries).
`updateBill` needs the identical "find every posted entry for this
reference, void each one, keep going if one fails" logic for its own GL
correction step. Extracted into one helper both call:

```javascript
// Shared by voidBill/updateBill: void every POSTED journal entry sharing a
// reference — a bill can carry more than one after being edited before (or
// from the retired add-items flow, on older data), so this can't stop at
// the first match. Continues past any single entry's failure.
async function voidPostedEntriesByReference(businessId, reference, req, contextLabel) {
  const entries = await prisma.journalEntry.findMany({
    where: { businessId, reference, status: 'POSTED' },
  });
  for (const entry of entries) {
    try {
      await prisma.journalEntry.update({ where: { id: entry.id }, data: { status: 'VOIDED' } });
    } catch (err) {
      logger.error(`[${contextLabel} — GL VOID FAILED] reference=${reference} biz=${businessId} entryId=${entry.id} — ${err.message}`);
      try {
        await recordAudit({
          action:     'GL_POST_FAILED',
          entity:     'JournalEntry',
          entityId:   String(entry.id),
          summary:    `Failed to void GL entry for ${contextLabel.toLowerCase()} ${reference} — ${err.message}`,
          user:       req.user?.id ? { id: req.user.id } : undefined,
          businessId,
        });
      } catch { /* auditing must never break anything either */ }
    }
  }
}
```

`voidBill`'s own body (lines 272-307) shrinks to fetching the bill,
enforcing its existing `paidAmount > 0` guard, updating status to `VOID`,
then `await voidPostedEntriesByReference(bill.businessId, bill.billNo,
req, 'BILL VOID')` — identical observable behavior (same `findMany`/
`update` call shapes), so `tests/payableControllerVoidBill.test.js` needs
no changes.

### `updateBill`

New `exports.updateBill` in `server/controllers/payableController.js`,
routed as `PUT /payable/:id`, with the same body validators `POST /`
already uses (`vendorId` int, `billDate`/`dueDate` ISO8601, `lines` array
min 1, per-line `accountId`/`description`/`quantity`/`unitPrice`/
`vatCode`) plus `param('id').isInt()` — matching how `router.put('/:id',
...)` validates `updateInvoice` in `server/routes/receivable.js:30-43`. No
`authorize()` role restriction — matches `createBill`'s own stance (any
authenticated user); `Void` requires ADMIN/MANAGER because it removes a
transaction outright, a different risk level.

1. Fetch the bill **scoped to the caller's business in the query itself**
   — `prisma.bill.findFirst({ where: { id, businessId: req.businessId } })`
   — 404 if missing. (This is the scoped-lookup pattern `updateInvoice`
   already uses, `receivableController.js:184`, and the same fix just
   applied to `addBillItems` after the final review of the "Add Items"
   design caught it fetching unscoped. `updateBill` is new code, so it's
   written scoped from the start rather than needing a follow-up fix.)
2. `status === 'PAID'` → 400 `"Cannot edit a fully paid bill."`
3. `status === 'VOID'` → 400 `"Cannot edit a voided bill."`
4. `const { subtotal, vatAmount, totalAmount, processedLines } = await
   computeBillTotals(lines)`. Then: `if (totalAmount <
   Number(bill.paidAmount) - 0.01) throw createError(\`New total
   (₱${totalAmount.toFixed(2)}) is less than the amount already paid
   (₱${Number(bill.paidAmount).toFixed(2)}). Adjust line items so the
   total covers what's been paid.\`, 400)` — identical shape to
   `updateInvoice`'s own guard (`receivableController.js:192-197`).
5. Recompute status the same way `updateInvoice` does
   (`receivableController.js:199-200`): `const remaining = totalAmount -
   Number(bill.paidAmount); const status = remaining <= 0.01 ? 'PAID' :
   (Number(bill.paidAmount) > 0 ? 'PARTIAL' : bill.status);` — only flips
   to `PAID` when the edit itself zeroes the balance; an `OPEN`/`OVERDUE`
   bill with no payments keeps its existing status untouched.
6. `prisma.bill.update({ where: { id }, data: { vendorId: Number(vendorId),
   billDate: new Date(billDate), dueDate: new Date(dueDate), description,
   notes, subtotal, vatAmount, totalAmount, status, lines: { deleteMany:
   {}, create: [...] } }, include: { vendor: true, lines: { include: {
   account: { select: { accountCode: true, accountName: true } } } },
   payments: true } })`.
7. GL correction: `await voidPostedEntriesByReference(bill.businessId,
   bill.billNo, req, 'BILL EDIT')`, then `await glPost.safePost({
   entryDate: updated.billDate, description: \`AP Bill (Edited) —
   ${updated.vendor.name} (${updated.billNo})\`, reference:
   updated.billNo, lines: buildBillGLLines(updated), userId: req.user?.id
   || 1, businessId: req.businessId })` — best-effort, non-blocking, same
   `safePost` convention as everywhere else; a failure lands in the Audit
   Trail as `GL_POST_FAILED` without failing the edit.
8. Respond `200` with the updated bill (vendor + lines + payments
   included), same shape `getBill` already returns.

Step 6 (the DB write) and step 7 (GL-void-then-repost) are **not** wrapped
in one atomic transaction — matches `updateInvoice`'s own structure and
`createBill`'s existing pattern (DB write, then a separate best-effort GL
post) rather than introducing a new one.

### Retiring `addBillItems`

Delete `exports.addBillItems` from `payableController.js` (lines 207-270),
its route `router.post('/:id/lines', ...)` in `server/routes/payable.js`
(lines 40-51), and `tests/payableControllerAddItems.test.js` in full — all
superseded by `updateBill`. Nothing else references
`pApi.bills.addItems`.

## Frontend

`CreateBillModal` (`app/(dashboard)/payable/page.jsx:480`) takes an
optional `bill` prop, following `CreateInvoiceModal`'s exact pattern
(`app/(dashboard)/receivable/page.jsx:508-528`, `569-601`, `607`, `771`):

- **Absent (today's behavior):** title "New Bill / Purchase Invoice", form
  starts empty, submits via `pApi.bills.create()`.
- **Present (edit mode):** title "Edit Bill", submit button reads "Save
  Changes" (or "Saving..." while in flight), form state initializes from
  `bill.vendorId`, `bill.billDate`, `bill.dueDate`, `bill.description`,
  `bill.notes`, and `bill.lines` mapped to the form's existing line shape
  (`{ accountId, description, quantity, unitPrice, vatCode }`). Submits
  via a new `pApi.bills.update(bill.id, payload)`
  (`lib/api.js`: `update: (id, data) => api.put(\`/payable/${id}\`,
  data)`, replacing the `addItems` entry at `lib/api.js:215`). The
  due-date auto-fill effect (`+30 days from bill date`,
  `page.jsx:505-511`) only fires when `dueDate` is empty, so it does not
  clobber an existing bill's due date when the modal opens pre-filled.

An **Edit** action (`Pencil` icon — needs adding to the `lucide-react`
import list at `page.jsx:5-9`, alongside the existing Void/Payment icon
buttons) is added in two places, both gated by `bill.status !== 'PAID' &&
bill.status !== 'VOID'`:

- The bills list row actions (`page.jsx:1011-1042`), alongside the
  existing "Record payment" and "Void bill" icon buttons — fetches the
  full bill (`pApi.bills.get`, needed for its `lines`, same as the
  existing payment-icon handler already does) then `setModal({ type:
  'edit', bill: data })`.
- `BillDetailModal`'s footer (`page.jsx:357-378`), alongside the existing
  "Void Bill" and "Record Payment" buttons — calls a new `onEdit` prop.

Both open `CreateBillModal` in edit mode via a new `modal?.type === 'edit'`
branch in `BillsPage`'s modal rendering (`page.jsx:1067-1097`), mirroring
`modal?.type === 'edit'` in `receivable/page.jsx:1168-1177`.

**`BillDetailModal` loses the "Add Items" panel entirely** — all of its
state (`addingItems`, `editDate`, `newLines`, `savingItems`), handlers
(`setNewLine`, `addNewLine`, `removeNewLine`, `handleSaveItems`,
`newItemsTotal`), and JSX (`page.jsx:47-87`, `169-171` the "Last edited"
line, `204-312` the panel itself) are removed, since `updateBill` replaces
what it did. Its props shrink from `{ bill, accounts, onClose, onPayment,
onVoid, onItemsAdded }` to `{ bill, onClose, onPayment, onVoid, onEdit }`
— `accounts` was only needed for the panel's account picker, and
`onItemsAdded` is replaced by the parent's `onSaved` callback already
wired for `CreateBillModal`.

`BillsPage`'s `modal?.type === 'detail'` render block
(`page.jsx:1077-1090`) drops the `accounts` and `onItemsAdded` props,
keeps `onClose`/`onPayment`/`onVoid`, and adds `onEdit={() => setModal({
type: 'edit', bill: modal.bill })}`.

## Error handling

- 404 if the bill doesn't exist, or belongs to a different business (never
  distinguished from "doesn't exist" — same non-leaking convention
  `cashSaleController.js`'s `getOne`/`voidSale` already use).
- 400 `status === 'PAID'` — cannot edit a fully settled bill.
- 400 `status === 'VOID'` — cannot edit a dead bill.
- 400 if the edited total would drop below `paidAmount` — never allow an
  edit to create an overpayment/negative-balance state.
- Standard express-validator 400/422s for malformed body (missing
  `vendorId`, empty `lines` array, bad line fields) — identical validators
  to create, so behavior is consistent between the two endpoints.
- GL posting/voiding failures are non-blocking, matching `safePost`'s
  app-wide convention — the edit still succeeds, Audit Trail records the
  failure.
- Frontend surfaces all errors via the existing toast-on-catch pattern
  `CreateBillModal.handleSubmit` already uses.

## Out of scope

- Editing a fully `PAID` bill, or reducing a `PARTIAL`/`OVERDUE` bill's
  total below what's already been paid — the existing correction path (a
  manual adjusting entry) is unchanged for both.
- Reversing or editing existing `PaymentAP` records themselves — a bill
  edit only ever touches the bill's own vendor/dates/description/notes/
  lines/status, never a past payment.
- An edit-history log of what changed on each edit beyond what the Audit
  Trail already captures for the GL side (matches Invoice editing's own
  scope).
- Fixing `voidBill`'s own unscoped `prisma.bill.findUnique` (no
  `businessId` check) — pre-existing house pattern shared with `getBill`/
  `recordPayment`, out of scope here exactly as the final review of the
  "Add Items" design already noted; `updateBill` is new code and is
  written scoped from the start, but this design does not retrofit the
  older handlers.
- The unrelated pre-existing failure in `tests/receivableController.test.js`
  (7 tests failing because `computeInvoiceTotals`'s `prisma.account.findMany`
  call isn't mocked there) — same root cause class this design's own
  `computeBillTotals` introduces for AP tests (which this design's test
  tasks account for), but fixing the AR test file itself is a separate,
  unrelated cleanup the user has not asked for.
