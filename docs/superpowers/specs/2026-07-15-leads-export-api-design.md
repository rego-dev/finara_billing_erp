# Leads Export API (API-Key Pull) — Design

**Date:** 2026-07-15
**Status:** Approved

## Goal

Let an external system pull **all** landing-page inquiries (leads) from Finara
over HTTP, machine-to-machine, without the JWT login flow. Complements the
existing push webhook (`lead.created` → `LEAD_WEBHOOK_URL`), which only covers
newly created leads.

## Decision

New endpoint `GET /api/leads/export` protected by a static API key, chosen over
reusing the JWT-protected `GET /api/leads` because embedding admin credentials
and handling 8-hour token expiry in another system is impractical and less safe.

## Contract

```
GET /api/leads/export[?since=<ISO-8601>][&status=NEW|CONTACTED|CLOSED]
X-API-Key: <LEAD_EXPORT_API_KEY>
```

- **Auth:** `X-API-Key` header compared timing-safe against the
  `LEAD_EXPORT_API_KEY` env var.
  - Env var unset/blank → endpoint disabled → `404` (feature off, like the
    webhook's silent no-op).
  - Header missing or wrong → `401 { "error": "Invalid API key" }`.
- **Filters (optional):**
  - `since` — ISO date/datetime; returns leads with `createdAt >= since`.
    Unparseable → `400`.
  - `status` — one of `NEW | CONTACTED | CLOSED`. Anything else → `400`.
- **Response:** `200` JSON array of leads, newest first — same shape as
  `GET /api/leads` (id, name, company, email, phone, message, source, status,
  createdAt).

## Implementation

- `server/routes/leads.js`: local `apiKeyAuth` middleware + `GET /export`
  route registered **before** any `/:id`-style routes (none today).
- `server/controllers/leadController.js`: `exportList` handler with the
  filter validation.
- `.env.example`: document `LEAD_EXPORT_API_KEY` (blank = disabled).
- Tests in `tests/` for auth (disabled/missing/wrong key) and filter
  validation, following the existing jest patterns.

## Out of Scope (YAGNI)

- Pagination (volume is low; `since` covers incremental polling).
- Key rotation/multiple keys, per-key audit logging.
- Write access of any kind — read-only endpoint.
