# Business Detail View (My Businesses "View" Action)

## Goal
On the My Businesses page, a SUPER_ADMIN can click a "View" action on any business row to see its full profile, who ordered/created it, and its order/payment history — without leaving the page.

## Decisions
- Visible only to `SUPER_ADMIN`, matching the existing role boundary on the rest of the orders-admin API (`ADMIN` is deliberately excluded there, per `server/routes/orders.js`'s `superOnly` gate). `ADMIN` continues to see the plain business list with no Actions column.
- Shown as a modal on the same page (not a separate route), consistent with the existing `AddBusinessModal` pattern.
- One combined backend endpoint returns both the business profile and its order history in a single call.
- "Created by" is not a stored field. It's derived from the earliest `BusinessOrder` row linked to the business (by `businessId`, which is only ever set once, at approval time). A business with no linked order (seeded/legacy, e.g. the default business or DEMO) shows "Legacy business — no order on record" instead.
- "Order & payment history" is every `BusinessOrder` row linked to that business, not just the creating one — forward-compatible with a future renewal flow, even though today it will hold at most one row per business (no renewal flow exists yet).

## Backend
- New route: `GET /api/orders/admin/business/:businessId`, added in `server/routes/orders.js` next to the other `superOnly` admin routes. Add a `router.param('businessId', ...)` numeric-id guard mirroring the existing `:id` one.
- New controller `orderAdminController.businessDetail`:
  - `businessId = Number(req.params.businessId)`.
  - Loads the `Business` row; 404s (`createError('Business not found', 404)`) if missing.
  - Loads all `BusinessOrder` rows `where: { businessId }`, `orderBy: { createdAt: 'asc' }`, `include: { user: { select: { id, email, firstName, lastName } } }`.
  - Responds `{ business, orders }` (orders in ascending order so the frontend can treat `orders[0]` as the creator and still display the full list oldest-first).

## Frontend
- `lib/api.js`: add `orders.admin.businessDetail: (businessId) => api.get(\`/orders/admin/business/${businessId}\`)`.
- `app/(dashboard)/my-businesses/page.jsx`:
  - Import `getUser` from `@/lib/auth`; compute `isSuperAdmin = getUser()?.role === 'SUPER_ADMIN'`.
  - When `isSuperAdmin`, render an extra "Actions" `<th>`/`<td>` in the Businesses table with a "View" button (Eye icon from `lucide-react`) that opens the new modal with that row's business id. Column is omitted entirely (not just disabled) for non-super-admins.
  - New state `viewBizId` (business id or null) controls the modal.
- New `components/orders/BusinessDetailModal.jsx`:
  - Props: `businessId`, `onClose`.
  - On mount, calls `orders.admin.businessDetail(businessId)`; on failure shows a toast (`Failed to load business details`) and calls `onClose()`.
  - Renders three sections inside the existing modal chrome (overlay + white/dark card, matching `AddBusinessModal`'s markup):
    1. **Business profile** — name, code, type (`industry`), tax type, TIN, address, phone, email, active/inactive badge, paid-until, books start date. Missing values render as `—`, matching the rest of the app's convention.
    2. **Created by** — from `orders[0]` (if any): `{firstName} {lastName}` + email, order #, ordered-on (`createdAt`), approved-on (`reviewedAt`). If `orders` is empty: "Legacy business — no order on record".
    3. **Order & payment history** — a table of all `orders`: order #, period (Monthly/Yearly), amount (`formatCurrency`), reference #, status badge (move the `STATUS` label/class map currently defined in `my-businesses/page.jsx` into a new shared `lib/orderStatus.js`, imported by both that page and the modal, so it isn't duplicated), created/approved dates, and a "View proof" button when `proofFileName` is set, wired the same way as `admin/orders/page.jsx`'s `viewProof` (`ordersApi.proofBlob(id)` → `window.open(URL.createObjectURL(...))`).
  - Uses `formatCurrency`/`formatDate` from `@/lib/auth`.

## Error handling
- Non-SUPER_ADMIN hitting the endpoint directly gets the existing `superOnly` 403 (defense in depth; the button is already hidden for them in the UI).
- Unknown business id → 404, surfaced as a toast in the modal.
- Proof download failure reuses the existing "Could not open the proof" toast pattern from `admin/orders/page.jsx`.

## Testing (Jest, existing style)
- `tests/orderAdminController.test.js`: add cases for `businessDetail` —
  - 404 for a non-existent business id.
  - 403 for a non-SUPER_ADMIN caller (consistent with existing route-level tests).
  - Returns `{ business, orders }` with orders ascending by `createdAt` and the `user` relation included, for a business with orders.
  - Returns `{ business, orders: [] }` for a business with none (e.g. the seeded default business).

## Out of scope
Renewal orders (no such flow exists yet), showing users-with-access in this modal (already covered by the separate "Users" button on Settings > Businesses), any change to the `ADMIN`-visible business list, audit-log display beyond the order history itself.
