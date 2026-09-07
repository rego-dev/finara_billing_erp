# Lead Webhook — Design

**Goal:** When a visitor submits the marketing site's contact/CTA form, forward the lead to an external application in real time via an outbound webhook, in addition to the existing local DB save. The local save and the visitor-facing response are unaffected by whether the webhook succeeds.

**Context:** The marketing funnel feature (Home/Features/Pricing/Contact) already has a working lead pipeline: `POST /api/leads` (public, rate-limited) validates via `server/utils/validateLead.js` and writes to the `Lead` Prisma model; `GET /api/leads` (ADMIN/MANAGER) lists them. This design adds a notification side-effect on creation — no changes to the existing request/response contract for the form itself.

## Architecture

`leadController.create` (`server/controllers/leadController.js`) keeps its current behavior — validate, `prisma.lead.create`, respond `201` — unchanged. After the DB write succeeds, it calls a new `sendLeadWebhook(lead)` from `server/utils/leadWebhook.js` **without awaiting it**. The controller's response to the visitor is never delayed or affected by webhook outcome (success, failure, or timeout).

If `LEAD_WEBHOOK_URL` is not set in `.env`, `sendLeadWebhook` returns immediately as a no-op — the feature is fully optional and safe for environments where the external app doesn't exist yet (including the current worktree/dev setup).

## JSON contract

```
POST {LEAD_WEBHOOK_URL}
Content-Type: application/json
X-Webhook-Signature: sha256=<hex-hmac-of-raw-body>
```

Body:
```json
{
  "event": "lead.created",
  "data": {
    "id": 123,
    "name": "Juan Dela Cruz",
    "company": "ABC Corp",
    "email": "juan@abc.com",
    "phone": "09171234567",
    "message": "Interested in payroll module",
    "source": "contact",
    "status": "NEW",
    "createdAt": "2026-07-13T10:00:00.000Z"
  }
}
```

`data` mirrors the `Lead` Prisma model fields verbatim (`company`/`phone` may be `null`). `createdAt` is ISO 8601 UTC, matching Prisma's default `DateTime` serialization.

### Signature verification (for the receiving app)
1. Take the raw request body exactly as received (no re-serialization).
2. Compute `HMAC-SHA256(LEAD_WEBHOOK_SECRET, rawBody)`, hex-encoded.
3. Compare (constant-time) to the value after `sha256=` in `X-Webhook-Signature`.
4. Reject the request if it doesn't match.

Both sides share `LEAD_WEBHOOK_SECRET` out-of-band (set in each app's own `.env`).

## Delivery: retry & failure handling

- HTTP call via Node's built-in `fetch` (Node 24 in this repo — no new dependency).
- Per-attempt timeout: 5s (`AbortSignal.timeout(5000)`).
- Up to 3 attempts total, backoff delays 1s → 5s between attempts (2 gaps for 3 attempts), only on network error or non-2xx response.
- If all attempts fail, log once via the existing `server/utils/logger.js` (`logger.error`) with the lead id and last error/status — no delivery-tracking table or admin UI for retries (YAGNI; can revisit if failed deliveries become a real operational problem).
- This all happens after the controller has already responded — a background task, not part of the request lifecycle.

## Configuration

New optional `.env` vars (both blank by default, documented in `.env.example`):
```
LEAD_WEBHOOK_URL=
LEAD_WEBHOOK_SECRET=
```

## Testing

- Unit tests for `sendLeadWebhook` (`tests/leadWebhook.test.js`) mocking `fetch`:
  - No-op when `LEAD_WEBHOOK_URL` unset.
  - Correct JSON body shape and `X-Webhook-Signature` header value for a known secret/body (fixed HMAC vector).
  - Retries on failure up to 3 attempts, then gives up and logs.
  - Succeeds on first attempt without retrying when the mock returns 200.
- No change needed to existing `validateLead`/`leadController` tests — the webhook call is additive and fire-and-forget, so `POST /api/leads`'s existing contract and tests stay green.
- Manual verification: point `LEAD_WEBHOOK_URL` at a local echo endpoint (e.g. `https://webhook.site` or a throwaway Express listener) and submit the real `/contact` form; confirm the received payload and signature match.

## Out of scope (future enhancements, not building now)
- Delivery-tracking table / admin UI for failed webhooks.
- Multiple webhook subscribers (currently single `LEAD_WEBHOOK_URL`).
- Webhook for lead *status updates* (only `lead.created` for now).
