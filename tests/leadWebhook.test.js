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
