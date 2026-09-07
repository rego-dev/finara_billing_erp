# Expense Voucher Void — Design

## Purpose

Expense Vouchers currently support Delete (DRAFT/REJECTED only), but there's no way to cancel a voucher that has already been Submitted, Approved, or Paid — including reversing the GL entry a PAID voucher posted. This mirrors the existing Void feature on Bills (`payableController.voidBill`) and Invoices (`receivableController.voidInvoice`).

## Scope

- Void applies to `SUBMITTED`, `APPROVED`, and `PAID` vouchers. `DRAFT`/`REJECTED` continue to use the existing Delete action; `VOID` cannot be voided again.
- Voiding a `PAID` voucher must reverse its posted GL entry so it stops affecting the Trial Balance, Income Statement, and Balance Sheet. `SUBMITTED`/`APPROVED` vouchers have no GL entry yet (posting happens at `pay`), so there's nothing to reverse there.
- A reason is required, matching the existing Reject flow.

## Schema Changes (`prisma/schema.prisma`)

- Add `VOID` to the `ExpenseStatus` enum.
- Add to `ExpenseVoucher`:
  - `voidedReason String? @db.Text`
  - `voidedBy     String? @db.VarChar(100)`

## Backend (`server/controllers/expenseController.js`)

New `exports.void`:
1. Load the voucher by id; 404 if not found.
2. 400 if `status === 'VOID'` or `status` is `DRAFT`/`REJECTED` (use Delete instead).
3. 400 if `voidedReason` is blank.
4. Update: `status: 'VOID'`, `voidedReason`, `voidedBy` (from request body, falling back to nothing — same convention as `rejectedReason`).
5. If the voucher's prior status was `PAID`: find any `JournalEntry` with `businessId`, `reference: voucher.voucherNo`, `status: 'POSTED'` and flip it to `VOIDED`. Wrap in try/catch; on failure, log via `logger.error` and write a `GL_POST_FAILED` audit entry — same pattern as `payableController.voidPostedEntriesByReference` / `receivableController.voidInvoice`. Never let a GL-void failure block the voucher's own status change.
6. Record a `recordAudit` entry: `action: 'VOID'`, summary `Voided ${voucherNo}: ${voidedReason}`.
7. Return the updated voucher.

### Route (`server/routes/expense.js`)

```js
router.post('/:id/void', approve, ctrl.void);
```

Uses the existing `approve = authorize('ADMIN', 'MANAGER')` gate — same permission level as approve/pay/reject.

### API helper (`lib/api.js`)

```js
void: (id, data) => api.post(`/expenses/${id}/void`, data),
```

## Frontend (`app/(dashboard)/expenses/page.jsx`)

- `STATUS_BADGE`: add `VOID: 'badge-red'`.
- Status filter `<select>`: add `'VOID'` to the options list.
- Row actions: show a Void button (red, distinct icon e.g. `Ban` from lucide-react) when `['SUBMITTED','APPROVED','PAID'].includes(v.status)`.
- Reuse the existing Action Drawer:
  - `actionConfig.void = { title: 'Void Voucher', btnLabel: 'Void Voucher', btnClass: 'btn-danger', fieldLabel: 'Reason' }`.
  - Reuse the same reason-textarea branch currently gated on `actionMode !== 'reject'` — extend the condition to also treat `'void'` as a reason-only mode (`actionMode === 'reject' || actionMode === 'void'`).
  - `handleAction`: `if (actionMode === 'void') await expApi.void(id, { voidedReason: actionForm.reason });` and require `actionForm.reason` non-empty before submitting (same validation style as reject).
- Toast message and drawer subtitle follow the existing per-mode conventions already in the file.

## Out of Scope / No Change Needed

- Daily Remittance report (`dailyRemittanceController.js`) already filters expense vouchers with an explicit `status: { in: ['APPROVED','PAID'] }` allowlist, so voided vouchers drop out automatically.
- No changes to `NotificationBell.jsx` (entity-to-route mapping only, not status-aware).
- Editing (`update`) and Approve continue to reject any non-`DRAFT`/`REJECTED` (or non-`SUBMITTED`, for approve) status as they do today — `VOID` falls through those existing guards with no code change.

## Testing

- Void a `SUBMITTED` voucher — no GL entry exists, status flips to `VOID`, audit log recorded.
- Void an `APPROVED` voucher — same, no GL entry to touch.
- Void a `PAID` voucher — confirm its `POSTED` journal entry (by `reference`) flips to `VOIDED`, and that the Trial Balance / Income Statement / Daily Remittance no longer reflect it.
- Attempt to void a `DRAFT`, `REJECTED`, or already-`VOID` voucher — expect 400.
- Attempt to void without a reason — expect 400.
- Confirm a non-ADMIN/MANAGER role gets 403 on the void route.
