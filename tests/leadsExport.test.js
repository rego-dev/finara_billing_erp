jest.mock('../server/config/database', () => ({
  lead: { findMany: jest.fn() },
}));

const prisma = require('../server/config/database');
const { apiKeyAuth } = require('../server/middleware/apiKeyAuth');
const { exportList } = require('../server/controllers/leadController');

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('apiKeyAuth', () => {
  const OLD_ENV = process.env;
  beforeEach(() => { process.env = { ...OLD_ENV }; });
  afterEach(() => { process.env = OLD_ENV; });

  test('404s when LEAD_EXPORT_API_KEY is not configured', () => {
    delete process.env.LEAD_EXPORT_API_KEY;
    const res = createRes();
    const next = jest.fn();
    apiKeyAuth({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  test('404s when LEAD_EXPORT_API_KEY is blank', () => {
    process.env.LEAD_EXPORT_API_KEY = '   ';
    const res = createRes();
    const next = jest.fn();
    apiKeyAuth({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  test('401s when the header is missing', () => {
    process.env.LEAD_EXPORT_API_KEY = 'secret-key';
    const res = createRes();
    const next = jest.fn();
    apiKeyAuth({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
    expect(next).not.toHaveBeenCalled();
  });

  test('401s on a wrong key', () => {
    process.env.LEAD_EXPORT_API_KEY = 'secret-key';
    const res = createRes();
    const next = jest.fn();
    apiKeyAuth({ headers: { 'x-api-key': 'wrong-key!' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() on the correct key', () => {
    process.env.LEAD_EXPORT_API_KEY = 'secret-key';
    const res = createRes();
    const next = jest.fn();
    apiKeyAuth({ headers: { 'x-api-key': 'secret-key' } }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('exportList', () => {
  beforeEach(() => { prisma.lead.findMany.mockReset(); });

  test('returns all leads newest first with no filters', async () => {
    const rows = [{ id: 2 }, { id: 1 }];
    prisma.lead.findMany.mockResolvedValue(rows);
    const res = createRes();
    await exportList({ query: {} }, res, jest.fn());
    expect(prisma.lead.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
    });
    expect(res.json).toHaveBeenCalledWith(rows);
  });

  test('400s on an unparseable since', async () => {
    const res = createRes();
    await exportList({ query: { since: 'not-a-date' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.lead.findMany).not.toHaveBeenCalled();
  });

  test('400s on an invalid status', async () => {
    const res = createRes();
    await exportList({ query: { status: 'PENDING' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.lead.findMany).not.toHaveBeenCalled();
  });

  test('applies since and status filters', async () => {
    prisma.lead.findMany.mockResolvedValue([]);
    const res = createRes();
    await exportList({ query: { since: '2026-07-14T00:00:00Z', status: 'NEW' } }, res, jest.fn());
    expect(prisma.lead.findMany).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: new Date('2026-07-14T00:00:00Z') },
        status: 'NEW',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(res.json).toHaveBeenCalledWith([]);
  });

  test('forwards DB errors to next()', async () => {
    const boom = new Error('db down');
    prisma.lead.findMany.mockRejectedValue(boom);
    const next = jest.fn();
    await exportList({ query: {} }, createRes(), next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});
