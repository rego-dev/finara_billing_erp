# Expense Voucher Approve — Editable Line Items

Date: 2026-08-21

## Problem

The Approve Voucher action drawer (`app/(dashboard)/expenses/page.jsx`, action drawer for
`actionMode === 'approve'`) shows only a read-only summary card (voucher no., payee, total,
purpose). The approver cannot see or correct the individual line items before approving,
even though line items exist on every voucher and drive the GL postings made later at
`pay()` time.

## Scope

Only the **Approve** action drawer changes. Submit, Mark Paid, and Reject action drawers are
unchanged.

## Backend change

`server/controllers/expenseController.js` → `exports.approve`

- Accept an optional `items` array in the request body (same shape as `create`/`update`:
  `{ description, accountId, amount, receiptNo }`).
- When `items` is an array:
  - Delete existing `ExpenseVoucherItem` rows for the voucher and recreate them from the
    payload (same delete+recreate pattern already used in `exports.update`).
  - Recompute `totalAmount` as the sum of the new items' amounts.
- When `items` is not provided, behavior is unchanged (status → `APPROVED`, `approvedBy`
  set, `totalAmount`/items untouched) — keeps the endpoint backward compatible for any other
  caller.
- Response includes the updated voucher with `items` (including `account`), matching the
  shape returned by `get`/`update`.

No change to `exports.update`'s existing `DRAFT`/`REJECTED`-only restriction — this is a
separate, approve-specific path.

## Frontend change

`app/(dashboard)/expenses/page.jsx`

- New state `actionItems`, an array in the same shape as the New/Edit drawer's `fItems`.
- `openAction('approve', rec)` seeds `actionItems` from `rec.items` (mapped to
  `{ description, accountId, amount: String(amount), receiptNo }`); other action modes leave
  it untouched/unused.
- Add local handlers scoped to the approve drawer: `addActionItem`, `updateActionItem(idx,
  field, val)`, `removeActionItem(idx)` — mirrors `addItem`/`updateItem`/`removeItem` used by
  the main drawer.
- When `actionMode === 'approve'`, render inside the drawer (below the existing summary
  card):
  - Column headers (Description / COA Account / Amount / Receipt #) — same labels as the
    main drawer.
  - One `ItemRow` per item (the existing component, reused as-is), wired to the new
    handlers.
  - "Add Line" button.
  - A running total (`actionItems` sum), right-aligned, same styling as the main drawer's
    total row.
- Submit/Pay/Reject drawers render exactly as before (no item list).

## Validation

Before calling `expApi.approve`, when `actionMode === 'approve'`:
- At least one item required.
- Every item requires a non-empty `description` and a positive `amount`.
- On failure, `toast.error(...)` and do not submit — same pattern as `handleSave`'s existing
  item validation.

## Submit payload

`handleAction`, approve branch becomes:

```js
if (actionMode === 'approve') {
  await expApi.approve(id, {
    approvedBy: actionForm.name,
    items: actionItems.map(it => ({ ...it, amount: Number(it.amount) })),
  });
}
```

Single combined action — editing items and approving happen together on one "Approve" click;
there is no separate save step.

## Consequence (intentional, not a side effect to guard against)

`totalAmount` is currently frozen at creation time. After this change, approving with edited
items updates `totalAmount` to match what was actually approved. Since `pay()` already reads
`voucher.items` for GL posting, this keeps the paid amount and posted GL lines consistent
with the approved items rather than the originally-submitted ones.

## Out of scope

- Submit/Pay/Reject drawers gaining an item list (even read-only).
- Changing `update()`'s DRAFT/REJECTED-only restriction.
- Any change to how `pay()` builds GL lines — it already reads `voucher.items`, which will
  now correctly reflect what was approved.
