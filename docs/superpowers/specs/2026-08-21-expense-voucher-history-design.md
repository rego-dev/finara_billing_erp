# Expense Voucher — Per-Voucher Edit History

Date: 2026-08-21

## Problem

`expenseController.js` never calls `recordAudit` (unlike `cashRequestController.js`, which
already does), so no history exists for expense voucher creates, edits, submits, approvals
(including item edits made in the Approve modal — see
`2026-08-21-expense-voucher-approve-items-design.md`), payments, rejections, or deletes.
There is no way to see what changed on a voucher or who changed it.

## Backend change

### `server/controllers/expenseController.js`

Add `recordAudit({ req, action, entity: 'ExpenseVoucher', entityId, summary, changes })` calls,
following the existing pattern already used in `cashRequestController.js`:

| Handler  | action    | summary                                                              | changes |
|----------|-----------|-----------------------------------------------------------------------|---------|
| `create` | `CREATE`  | `Created {type} voucher {voucherNo} for {payee}`                      | — |
| `update` | `UPDATE`  | `Updated voucher {voucherNo}`                                         | `diff(before, after)` over payee/category/purpose/receiptNo/notes/date/type/items/totalAmount |
| `submit` | `SUBMIT`  | `Submitted {voucherNo} for approval`                                  | — |
| `approve`| `APPROVE` | `Approved {voucherNo}` (append `— items adjusted` when items changed) | `diff` of items/totalAmount, only when `items` was sent in the request |
| `pay`    | `PAY`     | `Marked {voucherNo} as paid via {cashCode}`                           | — |
| `reject` | `REJECT`  | `Rejected {voucherNo}: {rejectedReason}`                              | — |
| `remove` | `DELETE`  | `Deleted voucher {voucherNo}`                                         | — |

`recordAudit` is fire-and-forget and already swallows its own errors (see
`server/utils/audit.js`), so no extra error handling is needed here.

For `update` and `approve`, build the before/after snapshot from the values already fetched
in the handler (the pre-update row) vs. the new values, using the existing `diff()` helper.
Items are diffed as a compact array (`description`, `amount`) rather than full nested
objects, to keep the stored `changes` JSON small and readable in the UI.

### `server/controllers/auditController.js`

`list()` currently filters by `action`, `entity`, `userId`, `from`, `to`, `search` — add:

```js
const { entityId } = req.query;
if (entityId) where.entityId = String(entityId);
```

This is a generic addition to the existing generic endpoint (useful for any future
per-record history view, not expense-voucher-specific), not a new endpoint.

## Frontend change

### `app/(dashboard)/expenses/page.jsx`

- Import `audit as auditApi` from `@/lib/api` (already exports `list`/`filters`).
- Add a **History** button (lucide `History` icon) to the Actions column, visible for every
  row regardless of status, placed next to Print.
- New state: `historyOpen`, `historyRecord`, `historyLogs`, `historyLoading`.
- Clicking History calls `auditApi.list({ entity: 'ExpenseVoucher', entityId: v.id, limit: 100 })`
  and opens a narrow `Drawer` titled `History — {voucherNo}`.
- Drawer body renders a timeline, most recent first: timestamp (`fmtDateTime`-style,
  matching the Audit Trail page's formatting), `userEmail`, an action badge reusing the
  `ACTION_BADGE` color map from `app/(dashboard)/audit/page.jsx` (copied locally — these two
  pages don't share a components file today), the `summary` text, and — when `changes` is
  present — a click-to-expand `<pre>` block with the JSON diff, matching the existing pattern
  in the Audit Trail page.
- Empty state: "No history recorded yet" (covers vouchers created before this change shipped,
  since they'll have no audit rows).

## Out of scope

- Retroactively backfilling audit history for existing vouchers — history starts from when
  this ships.
- Changing the global `/audit` page itself, beyond the `entityId` filter addition.
- Audit trails for other voucher-adjacent entities (Bills, Invoices, Journal Entries) —
  scoped to Expense Vouchers only, matching the request.
