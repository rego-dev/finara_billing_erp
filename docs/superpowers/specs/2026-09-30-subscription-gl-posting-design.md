# Subscription Payment GL Posting

## Goal
When an admin approves a business order (new business or renewal), the payment Finara collected is recorded as a journal entry in Finara's own books — today it isn't recorded anywhere at all.

## Decisions
- This money is Finara's own SaaS revenue, not any customer's — it must never touch a customer's `Business`'s own Chart of Accounts. It needs a dedicated book of its own.
- New `Business` row, code `FINARA-OPS`, name "Finara Operations", seeded via a Prisma **migration** (so it exists in every real deployment automatically, unlike `db:seed` which is dev/demo-only).
- That business gets a **minimal**, dedicated 2-account COA (not the full ~52-account default clone, which is built for an advertising/retail/services tenant and mostly irrelevant here):
  - `1010` — Cash — Subscription Collections (`ASSET` / `DEBIT`)
  - `4000` — Subscription Revenue (`REVENUE` / `CREDIT`)
- No VAT line — Finara Operations' `taxType` stays `NULL` ("not specified"), consistent with the schema's existing meaning for that value. Revisit when/if VAT registration applies.
- Both a new-business order and a renewal order post to the **same** `4000 Subscription Revenue` account — distinguished only by the journal entry's description (e.g. "Subscription — New: …" vs "Subscription — Renewal: …"), not by separate GL accounts. Simpler COA; if per-type revenue tracking is ever needed, it's derivable from the entry description/reference without a schema change.
- Posts on approval, for both order types, using the **existing** `glPost.safePost()` utility (every other module already uses this — it never throws; on failure it logs and records a `GL_POST_FAILED` audit entry instead, so a GL hiccup can never block a real payment approval).
- No retroactive backfill — only approvals from this point forward get a journal entry. Orders already approved before this ships are left alone.
- The Finara Operations business is a normal `Business` row: it automatically appears in the existing multi-business switcher for `ADMIN`/`SUPER_ADMIN` (so its Trial Balance/Journal are viewable through the existing Reports pages with zero new UI), and it is never granted to any regular customer via `UserBusiness`, so it never appears in a customer's own business list. It will also incidentally appear in the "My Businesses" list for `SUPER_ADMIN` like any other business — accepted as harmless (no `paidUntil`, so no "Renew" button; "Legacy business — no order on record" in its View modal) rather than special-cased to hide it.

## Backend
- New migration `prisma/migrations/<timestamp>_add_finara_ops_business/migration.sql`:
  - `INSERT INTO businesses (code, name, industry, isActive, createdAt, updatedAt) VALUES ('FINARA-OPS', 'Finara Operations', 'Internal', TRUE, NOW(), NOW());`
  - Capture its id via `LAST_INSERT_ID()` (MySQL) and insert the two `accounts` rows (`1010` Cash, `4000` Subscription Revenue) scoped to that `businessId`, matching the existing `Account` schema (`accountType`, `normalBalance`, `isActive`).
- New `server/utils/subscriptionGL.js`:
  - Exports a constant `FINARA_OPS_CODE = 'FINARA-OPS'` and the two account codes.
  - `getFinaraOpsBusinessId()`: resolves and caches (module-level, like `glPost.js`'s existing `_bizCache` pattern) the Finara Operations business's id by its `code`, so callers never hardcode a raw numeric id (ids differ across environments/seed order).
  - `postSubscriptionPayment({ order, companyName, kind, userId })` (`kind`: `'NEW' | 'RENEWAL'`): resolves the business id, then calls `glPost.safePost({ entryDate: now, description: "Subscription — {New|Renewal}: {companyName} ({order.orderNo})", reference: order.orderNo, lines: [{ accountCode: '1010', debit: order.amount }, { accountCode: '4000', credit: order.amount }], userId, businessId })`.
- `orderAdminController.approve`: after the business is successfully created (new-business branch) or extended (renewal branch) — i.e. after the existing revert-on-failure `try`/`catch` block, alongside the existing `recordAudit` call, for **both** branches — calls `postSubscriptionPayment({ order, companyName: biz.name, kind: order.businessId ? 'RENEWAL' : 'NEW', userId: req.user.id })`. Since `postSubscriptionPayment` uses `safePost` internally (never throws), this needs no extra error handling at the call site — the business-side approval has already fully succeeded by the time this runs, and a GL failure must never undo that.
- No changes to `orderController.js` (order creation/renewal are unaffected — only approval posts to GL).

## Testing (Jest, existing style)
- New `tests/subscriptionGL.test.js`: `getFinaraOpsBusinessId` resolves by code and caches (second call doesn't re-query); `postSubscriptionPayment` calls `glPost.safePost` with the correct two-line shape (debit `1010`, credit `4000`, both equal to `order.amount`) and the correct description for `kind: 'NEW'` vs `kind: 'RENEWAL'`.
- `tests/orderAdminController.test.js`: mock `server/utils/subscriptionGL` (this is orchestration-level — verifying `approve()` calls the helper with the right `kind`/args in each branch, not re-testing the helper's own internals, which get their own dedicated unit tests above) and assert `postSubscriptionPayment` is called with `kind: 'NEW'` for a new-business approval and `kind: 'RENEWAL'` for a renewal approval, with the correct `companyName`.
- No Prisma migration test — consistent with this repo's existing migrations, which aren't unit-tested (only the code that depends on the resulting schema is).

## Out of scope
Retroactive journal entries for orders approved before this ships, VAT handling, splitting new-business vs renewal revenue into separate GL accounts, any new UI for viewing Finara Operations' books (the existing business switcher + Reports pages already cover it), hiding Finara Operations from the "My Businesses" list.
