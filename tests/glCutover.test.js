jest.mock('../server/config/database', () => ({
  business:      { findUnique: jest.fn() },
  account:       { findFirst:  jest.fn() },
  journalEntry:  { findFirst:  jest.fn(), create: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const { post, clearBusinessCache, dateKey } = require('../server/utils/glPost');

const LINES = [
  { accountId: 1, debit: 100, description: 'dr' },
  { accountId: 2, credit: 100, description: 'cr' },
];

beforeEach(() => {
  jest.clearAllMocks();
  clearBusinessCache();
  prisma.journalEntry.findFirst.mockResolvedValue(null);
  prisma.journalEntry.create.mockResolvedValue({ id: 99, entryNo: 'JE-1-000001', lines: [] });
});

describe('dateKey', () => {
  test('normalises a YYYY-MM-DD string', () => {
    expect(dateKey('2026-08-01')).toBe('2026-08-01');
  });

  test('normalises an ISO datetime string to its date part', () => {
    expect(dateKey('2026-08-01T15:30:00.000Z')).toBe('2026-08-01');
  });

  test('normalises a Date using UTC parts', () => {
    expect(dateKey(new Date('2026-08-01T00:00:00.000Z'))).toBe('2026-08-01');
  });
});

describe('cutover guard', () => {
  test('skips an entry dated before the cutover', async () => {
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-08-01T00:00:00.000Z') });

    const result = await post({
      entryDate: '2026-05-14', description: 'Historical invoice',
      lines: LINES, businessId: 2, userId: 1,
    });

    expect(result).toEqual({ skipped: 'PRE_CUTOVER', entryDate: '2026-05-14', businessId: 2 });
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  test('POSTS an entry dated exactly ON the cutover date', async () => {
    // The cutover is the first live day — an off-by-one here silently drops a real day.
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-08-01T00:00:00.000Z') });

    await post({
      entryDate: '2026-08-01', description: 'First live entry',
      lines: LINES, businessId: 2, userId: 1,
    });

    expect(prisma.journalEntry.create).toHaveBeenCalled();
  });

  test('posts an entry dated after the cutover', async () => {
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-08-01T00:00:00.000Z') });

    await post({
      entryDate: '2026-09-20', description: 'Normal entry',
      lines: LINES, businessId: 2, userId: 1,
    });

    expect(prisma.journalEntry.create).toHaveBeenCalled();
  });

  test('is inert when the business has no cutover configured', async () => {
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: null });

    await post({
      entryDate: '1999-01-01', description: 'Ancient but allowed',
      lines: LINES, businessId: 2, userId: 1,
    });

    expect(prisma.journalEntry.create).toHaveBeenCalled();
  });

  test('accepts a Date object for entryDate', async () => {
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-08-01T00:00:00.000Z') });

    const result = await post({
      entryDate: new Date('2026-05-14T00:00:00.000Z'), description: 'Historical',
      lines: LINES, businessId: 2, userId: 1,
    });

    expect(result.skipped).toBe('PRE_CUTOVER');
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  test('isOpeningEntry bypasses the guard', async () => {
    // The opening entry is dated ON/BEFORE the cutover by definition. Without
    // this bypass it would skip itself and leave an empty balance sheet.
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-08-01T00:00:00.000Z') });

    await post({
      entryDate: '2026-07-31', description: 'Opening balances',
      lines: LINES, businessId: 2, userId: 1, isOpeningEntry: true,
    });

    expect(prisma.journalEntry.create).toHaveBeenCalled();
  });

  test('caches the cutover date — one lookup for repeated posts', async () => {
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-08-01T00:00:00.000Z') });

    await post({ entryDate: '2026-09-01', description: 'a', lines: LINES, businessId: 2 });
    await post({ entryDate: '2026-09-02', description: 'b', lines: LINES, businessId: 2 });

    expect(prisma.business.findUnique).toHaveBeenCalledTimes(1);
  });

  test('clearBusinessCache forces a fresh lookup', async () => {
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: null });
    await post({ entryDate: '2026-09-01', description: 'a', lines: LINES, businessId: 2 });

    clearBusinessCache(2);
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-10-01T00:00:00.000Z') });
    const result = await post({ entryDate: '2026-09-05', description: 'b', lines: LINES, businessId: 2 });

    expect(prisma.business.findUnique).toHaveBeenCalledTimes(2);
    expect(result.skipped).toBe('PRE_CUTOVER');
  });
});
