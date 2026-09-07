const { classifyUpcomingBucket, AGING_BUCKETS } = require('../server/utils/apAgingBuckets');

describe('classifyUpcomingBucket', () => {
  // Monday, 2026-08-03 — a "today" with clean week/month boundaries:
  // This Week = Aug 4-9, Next Week = Aug 10-16, This Month = Aug 17-31, Later = Sep 1+.
  const TODAY = new Date('2026-08-03T00:00:00');

  test('due today', () => {
    expect(classifyUpcomingBucket(new Date('2026-08-03'), TODAY)).toBe('Due Today');
  });

  test('this week: day after today through this Sunday', () => {
    expect(classifyUpcomingBucket(new Date('2026-08-04'), TODAY)).toBe('This Week');
    expect(classifyUpcomingBucket(new Date('2026-08-09'), TODAY)).toBe('This Week');
  });

  test('next week: Monday through Sunday of the following week', () => {
    expect(classifyUpcomingBucket(new Date('2026-08-10'), TODAY)).toBe('Next Week');
    expect(classifyUpcomingBucket(new Date('2026-08-16'), TODAY)).toBe('Next Week');
  });

  test('this month: after next week through end of the calendar month', () => {
    expect(classifyUpcomingBucket(new Date('2026-08-17'), TODAY)).toBe('This Month');
    expect(classifyUpcomingBucket(new Date('2026-08-31'), TODAY)).toBe('This Month');
  });

  test('later: after the end of the current calendar month', () => {
    expect(classifyUpcomingBucket(new Date('2026-09-01'), TODAY)).toBe('Later');
    expect(classifyUpcomingBucket(new Date('2027-01-15'), TODAY)).toBe('Later');
  });

  test('near month-end: a short "next week" can already extend past month-end, leaving "This Month" empty', () => {
    // Thursday, 2026-08-27: this week ends Sun Aug 30, next week ends Sun Sep 6,
    // but the calendar month ends Aug 31 — before next week's Sunday. Any date
    // past next week's Sunday is therefore already past month-end too, so it's
    // "Later", never "This Month", for this particular "today".
    const nearMonthEnd = new Date('2026-08-27T00:00:00');
    expect(classifyUpcomingBucket(new Date('2026-09-07'), nearMonthEnd)).toBe('Later');
  });
});

describe('AGING_BUCKETS', () => {
  test('is the full ordered list, upcoming buckets before overdue buckets', () => {
    expect(AGING_BUCKETS).toEqual([
      'Due Today', 'This Week', 'Next Week', 'This Month', 'Later',
      '1-30 days', '31-60 days', '61-90 days', 'Over 90 days',
    ]);
  });
});
