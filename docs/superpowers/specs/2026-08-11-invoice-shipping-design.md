# Invoice Shipping / Delivery Status — Design

**Date:** 2026-08-11
**Status:** Approved

## Goal

Let staff record that an invoice's goods have shipped — ship date, shipping
address, courier, tracking number — and see delivery status at a glance,
without conflating it with payment status. Today `Invoice` has no shipping
or delivery concept at all.

## Scope decision

**Two-state delivery status only: `PENDING` → `SHIPPED`.** No `DELIVERED`
confirmation step — once goods are out the door, staff mark it shipped and
that's the end of the lifecycle this feature tracks. This is deliberately
narrower than a full logistics/fulfillment module: no carrier API
integration, no delivery confirmation webhook, no partial shipment (an
invoice ships as a whole, not per line item).

**Delivery status is orthogonal to payment status** (`InvoiceStatus`:
`OPEN`/`PARTIAL`/`PAID`/`OVERDUE`/`VOID`). An invoice can be any combination
— `OPEN` + `SHIPPED`, `PAID` + `PENDING`, etc. — these are two independent
facts about the same invoice, not a combined state machine. This mirrors
how `paidAmount` and `status` already coexist on `Invoice` without one
driving the other directly (payment progress is derived into `status`
separately from any shipping concern).

**No GL posting.** Marking an invoice shipped is a logistics fact, not a
financial event — no journal entry, no `glPost` call anywhere in this
feature. This keeps it clearly separate from Cash Sale's stock-deduction
work (2026-08-11 Cash Sale POS Picker design), which is a financial
transaction touching Inventory/COGS; this is not.

## Data model

New enum + five new nullable/defaulted columns on `Invoice`, requiring a
Prisma migration:

```prisma
enum DeliveryStatus {
  PENDING
  SHIPPED
}

model Invoice {
  // ...existing fields unchanged...
  deliveryStatus   DeliveryStatus @default(PENDING)
  shippedDate      DateTime?      @db.Date
  shippingAddress  String?        @db.Text
  courier          String?        @db.VarChar(100)
  trackingNumber   String?        @db.VarChar(100)
}
```

No new table, no relation — this is invoice-level, not per-line, matching
the "ships as a whole" scope decision above. `shippingAddress` is a plain
text snapshot (not a link back to `Customer.address`) so a shipment to a
different site than the customer's billing address doesn't require editing
the customer record, and so a later change to the customer's address
doesn't retroactively rewrite what a past shipment's paperwork said.

## Backend — `markShipped`

New `exports.markShipped` in `server/controllers/receivableController.js`,
routed as `POST /receivable/:id/ship` in `server/routes/receivable.js`,
validated with `param('id').isInt()`. No `authorize()` role restriction —
this is logistics data, not a GL-posting action, so it doesn't warrant
Void's ADMIN/MANAGER gate; it's lower-risk than `createInvoice`, which
already has no role gate either.

1. Fetch the invoice (404 if missing).
2. `status === 'VOID'` → 400 `"Cannot ship a voided invoice."`
3. `prisma.invoice.update({ where: { id }, data: { deliveryStatus: 'SHIPPED', shippedDate: new Date(shippedDate), shippingAddress, courier: courier || null, trackingNumber: trackingNumber || null } })`.
4. Respond `200` with the updated invoice.

Callable again after the invoice is already `SHIPPED` — not a one-way
lock. Re-calling just overwrites the four detail fields (correcting a
mistyped tracking number, for instance); `deliveryStatus` stays `SHIPPED`.
No separate "unship" action in this scope — if that's ever needed, it's a
follow-up.

## Frontend

New `ShippingModal` component in
`app/(dashboard)/receivable/page.jsx`, following the same shape as the
existing `CollectionModal`:

- **Ship Date** — defaults to today.
- **Shipping Address** — pre-filled from `invoice.customer.address` the
  first time the modal opens for a given invoice (editable; once the
  invoice itself has a `shippingAddress` saved, that value pre-fills
  instead, so re-opening to correct a typo doesn't lose the edit).
- **Courier** — free text (e.g. "LBC", "J&T Express", "Own Delivery").
- **Tracking Number** — free text, optional.
- Submit button reads "Mark as Shipped" when `deliveryStatus === 'PENDING'`,
  "Update Shipping Info" when already `SHIPPED`.

A new truck icon-button (`Truck` from `lucide-react`) is added alongside
the existing Void/Collect/Edit action icons:

- The invoice list's row actions, gated by `invoice.status !== 'VOID'`
  (shipping is available regardless of payment status — `OPEN`, `PARTIAL`,
  `PAID`, `OVERDUE` can all be shipped, only `VOID` blocks it).
- `InvoiceDetailModal`'s footer, same gate.

A small badge next to the existing payment-status badge shows delivery
status: nothing (or a muted "Pending" label) for `PENDING`, a green
"Shipped" badge for `SHIPPED` — visually secondary to the payment-status
badge, which remains the primary status indicator on the row.

## Error handling

- 404 if the invoice doesn't exist.
- 400 `status === 'VOID'` — cannot ship a dead invoice.
- Standard express-validator 400 for a malformed `id` param.
- No GL-posting failure mode exists for this feature (there is no GL post).
- Frontend surfaces errors via the existing toast-on-catch pattern.

## Out of scope

- A `DELIVERED` confirmation state beyond `SHIPPED` (per scope decision).
- Per-line/partial shipment.
- Carrier API integration (tracking auto-update, label generation).
- Any GL/financial effect from shipping (this is not a COGS/inventory
  event the way Cash Sale's item picker is).
- An "unship" / revert-to-`PENDING` action.
- Voiding a shipped invoice's shipping data on void — `voidInvoice`
  doesn't touch `deliveryStatus` at all; a voided invoice simply keeps
  whatever delivery status it had, visible but not actionable (blocked by
  the `status === 'VOID'` guard on `markShipped`).
