# Cash Sale — POS-Style Item Picker — Design

**Date:** 2026-08-11
**Status:** Approved

## Goal

Make **New Cash Sale** feel like a point-of-sale till instead of a plain
form: staff search/browse Inventory items in a tile grid, tap one, adjust
quantity, and the description/amount/revenue-account fields fill themselves
in — instead of typing a description and price by hand every time.

This supersedes the "Out of scope" line in
[2026-08-10-cash-sales-design.md](2026-08-10-cash-sales-design.md) that
excluded inventory stock deduction — that exclusion was for the initial
ship; this design adds it back deliberately, scoped to single-item sales.

## Scope decision

`CashSale` stays a **single description + single amount per record** — no
new `CashSaleItem` line-items table, no schema migration for the sale model
itself. A real multi-item cart (add several items, one checkout) was
considered and explicitly rejected for this pass: it would need a new table,
changes to the receipt/BIR VAT Summary/RELIEF export code that all assume
one description/amount per sale, and is more than "make the picker feel like
a POS" requires. If multi-item carts are wanted later, that's a separate
design.

Because a single sale can now be linked to a stocked item, it also deducts
that item's stock and books COGS. The link is **not** a new column on
`CashSale` — it rides on the existing `InventoryTransaction.reference`
field, set to the sale's `saleNo` (see "Data model / linkage" below). This
avoids a migration entirely.

## Frontend — `NewSaleModal`

The modal becomes two tabs, **Pick Item** (default) and **Custom**, above
the existing shared fields (Sale Date, Buyer Name, Revenue Account, VAT
Code, Payment Method, subtotal/VAT/total summary, Notes).

### Pick Item tab

- Search box (matches `name`/`sku`/`description`, client-side filter over
  the already-loaded `items` list) + category filter chips ("All" plus each
  distinct `item.category.name`).
- Responsive tile grid. Each tile shows item name, SKU, `formatCurrency(sellingPrice)`,
  and a stock badge:
  - green `"{currentStock} {unit}"` when stock is healthy
  - yellow `"Low stock"` when `currentStock <= reorderLevel`
  - gray `"Out of stock"` when `currentStock <= 0` — tile is disabled
    (no `onClick`, reduced opacity, `cursor-not-allowed`)
- Tapping an in-stock tile selects it (highlighted border) and reveals a
  "Selected Item" strip: item name, unit price, a qty stepper (`− 1 +`,
  min 1, max `currentStock`), and a live line total.
- On selection or qty change:
  - `description` = `"<Item Name> x<Qty>"`
  - `amount` = `sellingPrice × qty`, ×1.12 when `vatCode === 'VAT'` (same
    VAT-exclusive-price convention the existing datalist autofill already
    uses — round to 2dp)
  - `accountId` autofills from `item.revenueAccountId` if the field is
    still empty (stays user-editable via the existing `AccountSelect`,
    since some items may have no revenue account configured)
- Switching tiles resets qty to 1. Switching to **Custom** clears the
  selected item (`itemId` stays unset for that submission).

### Custom tab

Unchanged from today: free-text `description` input + manual `amount`
input, no inventory link, no stock impact. This is the fallback for
services or anything not yet in Inventory.

### Submit payload

- Pick Item tab with a selection: existing fields + `itemId`, `quantity`.
- Custom tab, or Pick Item with nothing selected (blocked client-side —
  toast "Select an item or switch to Custom"): existing fields only, no
  `itemId`/`quantity`, identical to current behavior.

## Backend — `cashSaleController.create`

Accepts two new optional body fields: `itemId`, `quantity`.

**When `itemId` is present:**

1. Validate `quantity` is a positive number.
2. Fetch the `InventoryItem` (`id`, `businessId`, `isActive: true`) — 404 if
   not found.
3. Check `currentStock >= quantity` — 400
   `"Insufficient stock — only {currentStock} {unit} available"` if not.
   (Covers the race where stock changed after the grid was loaded; the
   frontend already disables out-of-stock tiles but doesn't re-check live
   at submit time.)
4. Inside one `prisma.$transaction([...])`, atomic with the existing
   `CashSale.create`:
   - `InventoryItem.update` — `currentStock -= quantity`
   - `InventoryTransaction.create` — `type: 'OUT'`, `itemId`, `quantity`,
     `unitCost: item.costPrice`, `totalCost: quantity * item.costPrice`,
     `runningStock` (the post-deduction stock), `reference: saleNo`,
     `notes: "Cash sale — {saleNo}"`, `txnNo` via the existing
     `nextTxnNo()` helper (`inventoryController.js`)

   If any part of this fails, nothing is written — same guarantee the
   existing single-item stock-out flow already has.

5. After the transaction commits, two independent best-effort
   `glPost.safePost()` calls (unchanged pattern — never throws, logs +
   records a `GL_POST_FAILED` audit entry on failure, doesn't block the
   response):
   - the existing Cash / Revenue / Output VAT entry (`buildCashSaleEntry`,
     unchanged)
   - a new COGS / Inventory entry, reusing the exact debit/credit shape
     `inventoryController.createTransaction`'s `OUT` branch already uses
     (`DR 5010 COGS`, `CR 1210 Inventory`, using the item's
     `cogsAccountId`/`inventoryAccountId` if set, else those fallback
     codes) — skipped if `totalCost` is 0.

**When `itemId` is absent:** identical to current behavior — no stock or
second GL entry.

Response shape gains nothing new that the frontend must branch on — the
existing `posted` flag / unposted-badge convention already covers "sale
recorded, GL posting had a problem, check Audit Trail." A failed inventory
GL post surfaces the same way (Audit Trail `GL_POST_FAILED` entry), not as
a new field.

## Void — `voidSale`

Extended: after the existing `CashSale.status → VOID` +
`JournalEntry.status → VOIDED` steps, look up
`InventoryTransaction.findMany({ where: { reference: sale.saleNo, type: 'OUT' } })`.
For each match (there is at most one, since one sale links to at most one
item under this design):

1. Create a reversing `RETURN_IN` `InventoryTransaction` for the same
   `itemId`/`quantity` (restocking it), `reference: sale.saleNo`,
   `notes: "Void reversal — {sale.saleNo}"`.
2. Restock `InventoryItem.currentStock += quantity`.
3. `safePost` a reversing GL entry (`DR 1210 Inventory`, `CR 5010 COGS`),
   same best-effort/non-blocking convention as everywhere else.

If no matching `InventoryTransaction` exists (a Custom-tab sale), void
behaves exactly as it does today — no inventory work.

## Error handling

- Insufficient stock at submit time → 400, sale not created, item stays
  selected in the modal so staff can lower the quantity or pick another
  item — same recoverable-error UX as any other create failure.
- GL posting failures (either the cash-sale entry or the new COGS entry)
  never block the sale or the void — matches the existing app-wide
  `safePost` convention (see the 2026-08-10 design and Cash Request
  design). Audit Trail is the source of truth for "something didn't post."
- A sale's `itemId`/`quantity` are request-time-only — not persisted on
  `CashSale` itself. The receipt, BIR VAT Summary, and RELIEF export are
  unaffected since they already only read `description`/`subtotal`/`vatAmount`/`totalAmount`,
  none of which change shape.

## Out of scope

- Multi-item cart / multiple items per cash sale (would need a
  `CashSaleItem` table and touches the receipt/VAT Summary/RELIEF export
  code — separate design if wanted later).
- Editing an already-recorded cash sale's item/quantity (void + re-create
  is the existing correction path for cash sales generally).
- Barcode scanning input.
