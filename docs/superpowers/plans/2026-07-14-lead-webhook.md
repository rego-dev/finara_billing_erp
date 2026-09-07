# Lead Webhook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a visitor submits the marketing site's CTA/contact form, forward the newly created lead to an external application in real time via an outbound, HMAC-signed webhook — without ever delaying or breaking the visitor's form submission.

**Architecture:** A new pure utility module, `server/utils/leadWebhook.js`, exports `sendLeadWebhook(lead)`. It builds the JSON payload, signs it, and POSTs it via Node's built-in `fetch` with bounded retries. `server/controllers/leadController.js` calls it once, fire-and-forget, immediately after the existing `prisma.lead.create` succeeds. `sendLeadWebhook` never throws or rejects — all failures are caught and logged internally — so the fire-and-forget call site needs no `.catch()`.

**Tech Stack:** Node.js built-in `fetch` and `crypto` (no new npm dependency), Jest 30 (existing), Winston `logger` (existing, `server/utils/logger.js`).

## Global Constraints

- Existing `POST /api/leads` request/response contract (used by the live `/contact` page) must not change.
- No new npm dependency — use Node's built-in `fetch`/`AbortSignal.timeout`/`crypto`.
- `LEAD_WEBHOOK_URL` / `LEAD_WEBHOOK_SECRET` are optional; blank by default. When `LEAD_WEBHOOK_URL` is unset, `sendLeadWebhook` is a no-op.
- The visitor-facing response from `POST /api/leads` must never wait on or fail because of webhook delivery.
- Webhook body field names and JSON shape must exactly match the design spec (`docs/superpowers/specs/2026-07-14-lead-webhook-design.md`).

---

### Task 1: `sendLeadWebhook` utility (TDD)

**Files:**
- Create: `server/utils/leadWebhook.js`
- Test: `tests/leadWebhook.test.js`
- Modify: `.env.example`

**Interfaces:**
- Produces: `sendLeadWebhook(lead) -> Promise<void>`, where `lead` is a plain object with `{ id, name, company, email, phone, message, source, status, createdAt }` (the shape returned by `prisma.lead.create`). The returned promise always resolves — it never rejects, even on total delivery failure (errors are caught and logged via `logger.error`). No-ops (resolves immediately, no network call) when `process.env.LEAD_WEBHOOK_URL` is unset. Consumed by Task 2's `leadController.create`.

- [ ] **Step 1: Write the failing tests**

Create `tests/leadWebhook.test.js`:

```js
const crypto = require('crypto');
const logger = require('../server/utils/logger');

jest.mock('../server/utils/logger', () => ({
  error: jest.fn(),
}));

const { sendLeadWebhook } = require('../server/utils/leadWebhook');

const lead = {
  id: 1,
  name: 'Ana Cruz',
  company: null,
  email: 'ana@abc.ph',
  phone: null,
  message: 'Hi',
  source: 'contact',
  status: 'NEW',
  createdAt: '2026-07-13T10:00:00.000Z',
};

describe('sendLeadWebhook', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    global.fetch = jest.fn();
    logger.error.mockClear();
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.useRealTimers();
  });

  test('no-ops when LEAD_WEBHOOK_URL is unset', async () => {
    delete process.env.LEAD_WEBHOOK_URL;
    await sendLeadWebhook(lead);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('POSTs the exact JSON contract with a valid signature', async () => {
    process.env.LEAD_WEBHOOK_URL = 'https://example.test/webhook';
    process.env.LEAD_WEBHOOK_SECRET = 'testsecret123';
    global.fetch.mockResolvedValue({ ok: true, status: 200 });

    await sendLeadWebhook(lead);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://example.test/webhook');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');

    const expectedBody = JSON.stringify({
      event: 'lead.created',
      data: lead,
    });
    expect(options.body).toBe(expectedBody);

    const expectedSig = 'sha256=' + crypto
      .createHmac('sha256', 'testsecret123')
      .update(expectedBody)
      .digest('hex');
    expect(options.headers['X-Webhook-Signature']).toBe(expectedSig);
  });

  test('omits the signature header when no secret is configured', async () => {
    process.env.LEAD_WEBHOOK_URL = 'https://example.test/webhook';
    delete process.env.LEAD_WEBHOOK_SECRET;
    global.fetch.mockResolvedValue({ ok: true, status: 200 });

    await sendLeadWebhook(lead);

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['X-Webhook-Signature']).toBeUndefined();
  });

  test('retries on failure up to 3 attempts total, then logs and gives up', async () => {
    jest.useFakeTimers();
    process.env.LEAD_WEBHOOK_URL = 'https://example.test/webhook';
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const promise = sendLeadWebhook(lead);
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain(String(lead.id));
  });

  test('succeeds on first attempt without retrying', async () => {
    process.env.LEAD_WEBHOOK_URL = 'https://example.test/webhook';
    global.fetch.mockResolvedValue({ ok: true, status: 200 });

    await sendLeadWebhook(lead);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/leadWebhook.test.js`
Expected: FAIL with `Cannot find module '../server/utils/leadWebhook'`

- [ ] **Step 3: Write the implementation**

Create `server/utils/leadWebhook.js`:

```js
const crypto = require('crypto');
const logger = require('./logger');

const TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 5000]; // delay before attempt 2, before attempt 3

function sign(secret, rawBody) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptDelivery(url, rawBody, headers) {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: rawBody,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Webhook endpoint responded ${res.status}`);
}

async function sendLeadWebhook(lead) {
  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) return;

  const rawBody = JSON.stringify({ event: 'lead.created', data: lead });
  const headers = { 'Content-Type': 'application/json' };
  const secret = process.env.LEAD_WEBHOOK_SECRET;
  if (secret) headers['X-Webhook-Signature'] = sign(secret, rawBody);

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await attemptDelivery(url, rawBody, headers);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  logger.error(`[leadWebhook] Failed to deliver lead ${lead.id} after ${MAX_ATTEMPTS} attempts: ${lastErr.message}`);
}

module.exports = { sendLeadWebhook };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/leadWebhook.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Document the new env vars**

Modify `.env.example` — add this block after the `# ─── Email ──` section (before `# ─── Database backups ──`):

```
# ─── Lead webhook (optional — forwards new marketing leads to an external app) ──
# Leave LEAD_WEBHOOK_URL blank to disable; the feature no-ops silently.
LEAD_WEBHOOK_URL=
LEAD_WEBHOOK_SECRET=
```

- [ ] **Step 6: Commit**

```bash
git add server/utils/leadWebhook.js tests/leadWebhook.test.js .env.example
git commit -m "feat: add outbound lead webhook utility"
```

---

### Task 2: Wire the webhook into lead creation

**Files:**
- Modify: `server/controllers/leadController.js`

**Interfaces:**
- Consumes: `sendLeadWebhook(lead) -> Promise<void>` from Task 1 (`../utils/leadWebhook`). Never rejects, so no `.catch()` is required at the call site.

- [ ] **Step 1: Add the import and fire-and-forget call**

Modify `server/controllers/leadController.js` — add the import at the top and call `sendLeadWebhook` right after the lead is saved, before responding:

```js
const prisma = require('../config/database');
const { validateLead } = require('../utils/validateLead');
const { sendLeadWebhook } = require('../utils/leadWebhook');

// POST /api/leads — public (marketing site contact form)
exports.create = async (req, res, next) => {
  try {
    const { valid, errors, data } = validateLead(req.body);
    if (!valid) return res.status(400).json({ error: 'Validation failed', details: errors });
    const lead = await prisma.lead.create({ data });
    sendLeadWebhook(lead);
    res.status(201).json({ id: lead.id, message: 'Thank you! We will get back to you shortly.' });
  } catch (err) {
    next(err);
  }
};
```

(The rest of the file — `exports.list` — is unchanged.)

No new automated test here: `sendLeadWebhook` is already fully unit-tested in Task 1, this call site is a single non-branching line with no logic of its own, and the existing codebase convention doesn't unit-test controllers against a live Prisma connection (see `tests/` — only pure `utils/` are unit tested).

- [ ] **Step 2: Manual end-to-end verification**

Start a disposable local listener to stand in for "the other application" (run in a separate terminal, keep it running for this step):

```bash
node -e "
require('http').createServer((req, res) => {
  let body = '';
  req.on('data', (c) => body += c);
  req.on('end', () => {
    console.log('Signature:', req.headers['x-webhook-signature']);
    console.log('Body:', body);
    res.writeHead(200); res.end('ok');
  });
}).listen(4001, () => console.log('listening on :4001'));
"
```

In `.env`, temporarily set:
```
LEAD_WEBHOOK_URL=http://localhost:4001
LEAD_WEBHOOK_SECRET=devsecret
```

Restart `npm run dev` so the API process picks up the new env vars, then submit a lead:

```bash
curl -s -X POST http://localhost:5000/api/leads \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","message":"Manual webhook check"}'
```

Expected: the curl call gets `201` with a `message`, and within a second the listener terminal prints a `Signature:` line and a `Body:` line containing `"event":"lead.created"` and `"email":"test@example.com"`. Stop the listener (Ctrl+C) and revert the two temporary `.env` lines back to blank afterward.

- [ ] **Step 3: Run the full test suite**

Run: `npx jest`
Expected: all tests pass (no regressions to `validateLead`, `audit`, `finance`, `phCompliance`, or the new `leadWebhook` tests).

- [ ] **Step 4: Commit**

```bash
git add server/controllers/leadController.js
git commit -m "feat: forward newly created leads to the configured webhook"
```
