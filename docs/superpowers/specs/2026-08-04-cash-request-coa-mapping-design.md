# Cash Request — Automatic COA Mapping, Data Wiring & Printable Form

**Date:** 2026-08-04
**Branch:** `feat/cash-request`
**Status:** Approved for planning

## Problem

The Cash Request module works end-to-end (request → submit → approve → release →
liquidate) but three things are unfinished:

1. **Liquidations land in the wrong account.** `CashRequestItem.accountId` is
   optional and the Liquidate modal starts with a blank line, so in practice no
   account is chosen and `buildLiquidationEntry` falls back to
   `6390 Miscellaneous Expense`. Booth-build plywood and tarpaulin printing —
   billable client production cost — are being booked as Miscellaneous.
2. **The estimate is not wired to the liquidation.** The request already lists
   what will be bought, but Liquidate opens with one empty line and the whole
   list is retyped.
3. **There is no form to print.** The existing print output is a summary report:
   no signature lines, no items total. Nobody can sign it.

## Goals

- Derive the GL account automatically from what the user types, visibly and overridably.
- Carry the request's items into the liquidation instead of retyping them.
- Produce a Cash Request Form that can be printed, routed and signed.

## Non-goals

Partial liquidations, salary deduction for unliquidated advances, receipt
attachments, converting a request to a PO or bill, and a user-editable mapping
table in Settings. The map is code, matching the existing `CATEGORY_ACCOUNT`
precedent.

---

## 1. Keyword → account engine

New module `server/utils/accountMap.js`. Pure CommonJS, no Prisma, no I/O — so
`npx jest` can test it directly, the same slot `server/utils/cashAdvance.js`
occupies.

### Interface

```js
matchAccountCode(description) -> string   // always returns a code; '6390' when nothing matches
matchAccount(description)     -> { accountCode, matched: boolean, rule?: string }
KEYWORD_RULES                 -> [{ accountCode, keywords: string[] }]  // ordered, first match wins
FALLBACK_ACCOUNT              -> '6390'
```

Matching is case-insensitive on word boundaries against the description. Rules
are ordered; the first rule with any keyword hit wins. `matched: false` tells
the UI to flag the line for review.

### Rules

Drawn from the live COA, which is identical across all three businesses
(`My Business`, `BEULAH I.T SERVICES`, `BFAITH ADVERTISING`).

| Account | Name | Keywords |
|---|---|---|
| 5021 | Advertising Materials Cost | plywood, paint, nails, screws, lumber, vinyl, sintra, acrylic, foam, glue, tape, wood, steel, tarp material |
| 5029 | Printing & Reproduction Costs | print, printing, tarpaulin, sticker, decal, photocopy, xerox, reproduction, layout print |
| 5026 | Production Equipment Rental | rental, rent equipment, generator, genset, lights rental, sound system |
| 5028 | Photography & Videography | photography, videography, photo, video, shoot, drone |
| 5025 | Talent & Modeling Fees | talent, model, host, emcee, voice over |
| 5024 | Subcontractor & Freelance Costs | subcon, subcontractor, freelance, freelancer |
| 5027 | Studio Rental | studio |
| 6520 | Transportation & Travel | grab, taxi, fare, gas, gasoline, diesel, toll, parking, fuel, jeep, tricycle, habal, transport, shipping fare |
| 6510 | Representation & Entertainment | meal, meals, food, snack, snacks, merienda, lunch, dinner, breakfast, catering, drinks, water |
| 6320 | Office Supplies Expense | bond paper, ink, ballpen, pen, folder, stapler, office supplies, envelope, notebook |
| 6330 | Postage & Delivery Expense | courier, lbc, jrs, delivery, freight, padala, shipping |
| 6370 | Licenses, Permits & Registration | permit, license, clearance, registration, barangay, mayor, bir |
| 6240 | Building Repairs & Maintenance | repair, maintenance, fix, replacement part |
| 6310 | Internet & Telecommunications | internet, wifi, load, prepaid load, data plan, sim |
| 6360 | Bank Charges & Service Fees | bank charge, transfer fee, service fee, remittance fee |
| — | *no match* | → `6390 Miscellaneous Expense`, flagged in UI |

**Accounting policy — confirmed by the business owner on 2026-08-04:** build
materials and printing map to Cost of Sales (50xx) because this spend is
consumed producing work billed to clients. The cost therefore matches the
revenue for that job and gross margin stays meaningful.

This is a settled decision, not an open assumption. Supporting evidence: the
COA names `6530` "Marketing & Promotions **(Internal)**", deliberately
separating the company's own promo spend from client production in 5020–5029.

Spend on the company's own booths or signage still belongs in 6530 — that is
what the per-line override is for. Do not flip the 5021/5029 defaults without
revisiting this decision with the owner.

### Safety constraint

`glPost.getAccountByCode` throws when a code is absent from a business's COA, so
every code in `KEYWORD_RULES` must exist in **every** business. A verification
step asserts this against the live DB before the feature ships, and the seed COA
is the contract for new businesses.

---

## 2. Distribution to the browser

The map is canonical on the server. `GET /api/cash-requests/account-map` returns
`{ rules, fallback }`; the page fetches it once on mount and matches locally, so
the account resolves as the user types with no per-keystroke round-trip.

The server **re-applies the same map** in `liquidate` for any line arriving
without an `accountId`. A line can therefore never land in 6390 merely because
the browser didn't run the match. Client-side matching is a convenience; the
server is the authority.

---

## 3. Wiring

### Request modal
As a description is typed, the account auto-selects and is shown inline in the
existing `AccountSelect`. Unmatched lines show the 6390 fallback with a subtle
"review" affordance. Any line can be changed by hand; a manual choice is sticky
and is not overwritten by later typing in that line.

### Liquidate modal
Opens with lines **prefilled from the request's items** — description, account
and estimated amount. The user corrects amounts against receipts and adds
unplanned lines with `+ Add Line`. The variance block behaves as it does today.

Rationale for prefilling amounts rather than blanking them: the estimate is
usually right, and the variance total makes any uncorrected figure immediately
visible as an unexpected Exact/₱0.00 result.

### Posting
`buildLiquidationEntry` is unchanged — it already honours per-line `accountId`
and falls back to a code. Only the inputs improve.

---

## 4. Printable Cash Request Form

Replaces the current summary print. One adaptive `printCashRequestForm(cr)` at
module level in `app/(dashboard)/cash-requests/page.jsx`, mirroring `printPO` in
the purchase-orders page. The detail modal's single Print button calls it.

Body, top to bottom:

1. Letterhead via `printDocument` — title `Cash Request Form`, subtitle `CR-000001 · Juan Dela Cruz`
2. Info grid — Request No., Requested For, Status, Request Date, Needed By, Cash Source
3. Purpose in a `desc-box`
4. Items table — Description / **Account** / Qty / Est. Cost, with a **TOTAL** footer row
5. *If released* — released amount, cash account, release date
6. *If liquidated* — liquidation lines (with account and receipt no.) and the
   Released / Actual Spent / variance block labelled Sukli Returned, Reimbursed or Exact
7. Three-column signature grid — Requested by / Approved by / Released by, each
   printing the recorded name above the rule, `Signature over printed name / Date` beneath
8. Full-width acknowledgement — `Received the sum of ₱X as cash advance...` with
   its own blank rule. The amount prints when released; otherwise a blank rule.

The Account column is what puts "where does this fall in the chart of accounts"
on the paper itself.

Styling is inline in the body HTML, matching `printPO`, so no single-use classes
are added to the shared `lib/print.js` stylesheet.

### Signatory guard

Rows written before the `actorName` fix hold the literal string
`"undefined undefined"` in `requestedBy` / `approvedBy` / `releasedBy`. A
`signatory(name)` helper treats blank **or** that literal as absent and prints an
empty rule. This is a display guard over stale data, not a substitute for
cleaning it — printing garbage onto a document people sign is the worse failure.
The five affected rows are left untouched pending a separate decision.

---

## Testing

| What | How |
|---|---|
| `matchAccountCode` — each rule, case-insensitivity, word boundaries, fallback, ordering | `tests/accountMap.test.js`, `npx jest` |
| Every mapped code exists in all 3 businesses' COA | Node script against the live DB |
| Server-side re-match when `accountId` is absent | Extend cash-request controller verification |
| Liquidation still posts balanced entries in all 3 variance modes | Existing `tests/cashAdvance.test.js` must stay green |
| Prefill, auto-select, override stickiness, print form | Browser walkthrough on `CR-000001` |

`lib/` cannot be unit-tested here — it is ESM and jest has no transform
configured — which is exactly why the engine lives in `server/utils/`.

## Risks

- **A confident wrong guess.** Mitigated by always showing the account inline and
  making it editable; nothing is hidden at post time.
- **Keyword collisions** — "tarpaulin material" matches both 5021 and 5029.
  Resolved by rule order, which is deliberate and tested.
- **COA drift.** A business whose COA lacks a mapped code would throw on post.
  Guarded by the verification step and the seed contract.
