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
