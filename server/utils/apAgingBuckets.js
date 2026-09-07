const { startOfDay, endOfWeek, addWeeks, endOfMonth, isSameDay, isAfter } = require('date-fns');

// Full aging-bucket order shared by the "not yet due" and "overdue" halves of
// a bill's lifecycle. payableController.agingReport reduces bill totals into
// these keys to build the bucket summary.
const AGING_BUCKETS = [
  'Due Today', 'This Week', 'Next Week', 'This Month', 'Later',
  '1-30 days', '31-60 days', '61-90 days', 'Over 90 days',
];

// Classifies a not-yet-due bill (dueDate >= today) into one of the five
// upcoming buckets. Weeks run Monday-Sunday (PH business week).
function classifyUpcomingBucket(dueDate, today) {
  const day = startOfDay(dueDate);
  const now = startOfDay(today);

  if (isSameDay(day, now)) return 'Due Today';

  const endThisWeek = endOfWeek(now, { weekStartsOn: 1 });
  if (!isAfter(day, endThisWeek)) return 'This Week';

  const endNextWeek = endOfWeek(addWeeks(now, 1), { weekStartsOn: 1 });
  if (!isAfter(day, endNextWeek)) return 'Next Week';

  const endThisMonth = endOfMonth(now);
  if (!isAfter(day, endThisMonth)) return 'This Month';

  return 'Later';
}

module.exports = { AGING_BUCKETS, classifyUpcomingBucket };
