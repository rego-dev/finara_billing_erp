# Cash Sale — Multi-Item POS Cart — Design

**Date:** 2026-08-22
**Status:** Approved

## Goal

Turn **New Cash Sale** into a real multi-item POS cart: staff can add several
items to one sale (from Inventory or typed free-text), see Item/Description,
Qty, Price, Total per line, then a single Revenue Account, VAT Code, and
Payment Method for the whole sale at the bottom — instead of today's
one-description/one-amount record.

This is the multi-item cart that
[2026-08-11-cash-sale-pos-picker-design.md](2026-08-11-cash-sale-pos-picker-design.md)
explicitly deferred ("Out of scope: Multi-item cart ... separate design if
wanted later"). That design's single-item tile-grid picker becomes the
primary way to add a row to the cart here; its stock-deduction/COGS/void
mechanics are extended from "at most one item per sale" to "one or more
items per sale."

## Scope decisions

- **Mixed cart allowed**: a sale can contain both Inventory-linked lines and
  free-text custom lines (e.g. a product plus a service fee) in the same
  cart.
- **One Revenue Account for the whole sale** — not per line. Matches the
  screenshot layout (single field at the bottom) and keeps GL posting to one
  Cash/Revenue/VAT entry.
- **One VAT Code for the whole sale** — not per line. VAT is computed once
  on the summed subtotal, not per item.

## Data model

New `CashSaleItem` table. `CashSale` keeps its existing aggregate columns
(`subtotal`, `vatAmount`, `totalAmount`, `accountId`, `vatCode`) unchanged —
this is additive, no existing column changes shape.

```prisma
model CashSaleItem {
  id          Int            @id @default(autoincrement())
  cashSaleId  Int
  cashSale    CashSale       @relation(fields: [cashSaleId], references: [id])
  itemId      Int?
  item        InventoryItem? @relation(fields: [itemId], references: [id])
  description String         @db.VarChar(255)
  quantity    Decimal        @default(1) @db.Decimal(12, 3)
  unitPrice   Decimal        @default(0) @db.Decimal(15, 2)
  amount      Decimal        @default(0) @db.Decimal(15, 2)

  @@index([cashSaleId])
  @@index([itemId])
  @@map("cash_sale_items")
}
```

`CashSale` gains `items CashSaleItem[]`. `itemId` is null for a custom
free-text line. `unitPrice`/`amount` are **VAT-exclusive**, matching the
convention `InvoiceLine`/`QuotationLine` already use (unit price = the
item's `sellingPrice` as configured in Inventory, no VAT baked in) — this
replaces today's cash-sale-only convention of treating a single "Amount" as
VAT-inclusive, which doesn't extend cleanly to a multi-line cart.

`CashSale.description` stops being user-typed. It becomes an
auto-generated summary string, computed on create as:
- 1 line → that line's `description`
- 2+ lines → first line's `description` + `" +N more"` (N = remaining line
  count)

This keeps the list page's search/table column and the receipt's fallback
working without a shape change. Confirmed by reading `birController.js`
(RELIEF export) and `dailyRemittanceController.js` (daily cash report) that
neither reads `CashSale.description` — both build their own strings from
`buyerName`/`saleNo` — so this repurposing is safe.

## Money math

Per line: `amount = round2(quantity × unitPrice)`.

Sale-level: `subtotal = round2(sum of line amounts)`, then
`computeVAT(subtotal)` (existing `server/utils/phCompliance.js` helper,
`inclusive = false` default) gives `{ base, vat, total }` when
`vatCode === 'VAT'`; otherwise `{ base: subtotal, vat: 0, total: subtotal }`.

This is simpler than today's `create`, which backs a VAT-inclusive single
amount apart with a manual rounding workaround (see the comment currently
in `cashSaleController.js` above the `v = vatCode === 'VAT' ? ... : ...`
block). Starting from VAT-exclusive line prices means `computeVAT()` can be
used directly — the workaround and its regression test comment are removed
as part of this change.

## Backend — `cashSaleController.create`

Request body changes:

- Removed: `description`, `amount`, `itemId`, `quantity` (top-level).
- Added: `items: [{ itemId?: number, description: string, quantity: number, unitPrice: number }]`.
- Unchanged: `saleDate`, `buyerName`, `accountId`, `vatCode`, `paymentMethod`, `notes`.

Validation:

1. `items` must be a non-empty array.
2. Each line: `quantity > 0`, `unitPrice >= 0`, non-empty `description`.
3. For each line with `itemId` set: fetch the `InventoryItem`
   (`id`, `businessId`, `isActive: true`) — 404 if not found. Check
   `currentStock >= quantity` — 400
   `"Insufficient stock — only {currentStock} {unit} available for {name}"`
   if not.
   - The frontend cart never lets the same item appear as two separate
     rows (tapping an already-added tile increments that row's qty and
     clamps to stock instead of adding a duplicate row), so the backend
     does not need to aggregate quantities across rows sharing an
     `itemId` — each row is checked and deducted independently. This is a
     deliberate simplification enabled by the frontend invariant in the
     "Frontend" section below; if that invariant is ever removed, this
     validation must change to aggregate by `itemId` first.

Inside one `prisma.$transaction([...])`:
- `CashSale.create` (with the auto-generated `description` summary and the
  summed `subtotal`/`vatAmount`/`totalAmount`)
- `CashSaleItem.create` for every line (in a fixed order matching the cart)
- For every inventory-linked line: `InventoryItem.update` (`currentStock -=
  quantity`) and `InventoryTransaction.create` (`type: 'OUT'`, `itemId`,
  `quantity`, `unitCost: item.costPrice`, `totalCost: quantity *
  item.costPrice`, `runningStock`, `reference: saleNo`, `notes: "Cash sale
  — {saleNo}"`, `txnNo` via the existing `nextTxnNo()` helper)

After the transaction commits, two independent best-effort
`glPost.safePost()` calls (unchanged non-blocking convention):

1. The existing Cash/Revenue/Output-VAT entry (`buildCashSaleEntry`,
   unchanged — still takes the sale-level `subtotal`/`vatAmount`/`totalAmount`).
2. **One combined** COGS/Inventory entry covering every inventory-linked
   line in the sale — not one entry per item. Its `lines` array contains one
   DR-COGS/CR-Inventory pair per distinct inventory-linked line (using each
   item's `cogsAccountId`/`inventoryAccountId` if set, else the `5010`/`1210`
   fallback codes, same as today), all posted together as a single journal
   entry. Skipped entirely if no line has `itemId` set.

Response shape: unchanged (`{ ...sale, journalEntryId, posted }`) — the
frontend already only branches on `posted`.

## Backend — `voidSale`

Changes the single-item `inventoryTransaction.findFirst` to
`findMany({ where: { reference: sale.saleNo, type: 'OUT' } })` and loops
over every match:

1. For each: create a reversing `RETURN_IN` `InventoryTransaction`
   (restocking that item), `reference: sale.saleNo`.
2. Restock each `InventoryItem.currentStock += quantity`.
3. After all reversals, one combined `safePost` reversing GL entry with a
   DR-Inventory/CR-COGS pair per reversed line (mirrors the combined-entry
   shape from `create`).

If no matching `InventoryTransaction` exists (an all-custom-lines sale),
void behaves exactly as it does today.

## Frontend — `NewSaleModal`

Replaces the current "Pick Item" / "Custom" tab switcher with a single
unified view:

- **Item picker** (top) — the existing search box + category chips + tile
  grid, unchanged in behavior, except tapping a tile now:
  - If that item isn't in the cart yet: appends a new cart row
    (`description = item.name`, `quantity = 1`, `unitPrice =
    item.sellingPrice`, `itemId = item.id`).
  - If that item is already a row in the cart: increments that row's `quantity`
    by 1, clamped to `item.currentStock` (same clamp `changeQty` already
    does today). This is the invariant the backend validation above relies
    on — one cart row per distinct `itemId`, ever.
- **"+ Add custom line"** button — appends a blank row
  (`description: ''`, `quantity: 1`, `unitPrice: 0`, `itemId: null`) with
  Description/Qty/Price all directly editable, for anything not in
  Inventory.
- **Cart table** (below the picker) — one row per cart line:
  **Item/Description, Qty (− / + steppers, or typed for custom rows),
  Price, Total (computed, read-only), × remove button**. Inventory-linked
  rows show Description read-only (it's the item name); custom rows have an
  editable text input. Price is editable on every row (lets staff apply a
  manual discount/markup on an inventory item without touching Inventory's
  configured `sellingPrice`) — stock deduction and COGS always use the
  item's real `costPrice`/`currentStock`, never the edited `unitPrice`.
  Removing the last inventory-linked row for an item clears it so it can be
  re-added from the picker.
- **Bottom section** (unchanged fields): Sale Date, Buyer Name, Revenue
  Account (single `AccountSelect`), VAT Code, Payment Method, Notes, then a
  computed Subtotal/VAT/Total summary strip, then Cancel/Record Sale.

Submit is blocked client-side (toast, no request) when the cart is empty,
when any row has empty description or non-positive quantity, or when no
Revenue Account is selected — same recoverable-error UX pattern as today.

Payload: `{ saleDate, buyerName, accountId, vatCode, paymentMethod, notes,
items: [{ itemId, description, quantity, unitPrice }, ...] }`.

## Receipt (`printCashSale`)

`cashSaleController.list` and `getOne` add `include: { items: true }` (list
already includes `account`; this is additive to both). The receipt table
becomes one row per `CashSaleItem` (Description, Qty, Price, Total) instead
of the single description row, with the existing Subtotal/VAT/Total footer
and "Not a BIR-registered sales invoice" note unchanged. For a pre-existing
sale recorded before this change (`sale.items` is an empty array, since it
has no `CashSaleItem` rows), `printCashSale` falls back to today's single
row built from `sale.description`/`subtotal`/`vatAmount`/`totalAmount` —
the exact markup that exists today — so old receipts keep printing
unchanged.

## Error handling

- Insufficient stock on any line at submit time → 400, sale not created
  (whole transaction rolls back), cart stays intact so staff can lower that
  line's quantity or remove it — same recoverable-error UX as any other
  create failure.
- GL posting failures (either the cash-sale entry or the combined COGS
  entry) never block the sale or the void — matches the existing app-wide
  `safePost` convention. Audit Trail remains the source of truth for
  "something didn't post."
- RELIEF export, BIR VAT Summary, and the Daily Cash Report are unaffected
  — confirmed they only read `subtotal`/`vatAmount`/`totalAmount`/
  `buyerName`/`saleDate`/`vatCode`/`paymentMethod`/`saleNo`, none of which
  change shape.

## Out of scope

- Per-line VAT code or per-line revenue account (single VAT code / single
  revenue account per sale, as decided above).
- Fractional-quantity input UI (steppers still increment by whole units,
  same limitation the single-item picker already had).
- Editing an already-recorded cash sale's cart (void + re-create is the
  existing correction path for cash sales generally).
- Barcode scanning input.
- Migrating/backfilling existing single-description `CashSale` rows into
  `CashSaleItem` — old rows simply have no `items` rows; the receipt and
  list already fall back to `CashSale.description` when `items` is empty.
