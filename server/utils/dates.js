// Shared date helpers for endpoints that accept a 'YYYY-MM-DD' query/body
// parameter and need to build a POSTED-entry day/range window from it.
//
// DATE_RE only checks shape ('YYYY-MM-DD'); it happily accepts '2026-13-40'.
// A calendar-invalid string still parses to shape but JavaScript silently rolls over
// (e.g. '2026-02-30' becomes March 2), which is worse than a crash — the user gets
// a wrong report window with no error. Use round-trip validation: format the parsed
// Date back to YYYY-MM-DD and check it matches the input exactly. First reject
// grammar-invalid dates (month/day out of range) via NaN check, then catch rollover.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const startOf = (d) => new Date(`${d}T00:00:00.000Z`);
const endOf   = (d) => new Date(`${d}T23:59:59.999Z`);
const dateKey = (d) => new Date(d).toISOString().slice(0, 10);

const isValidDateStr = (s) => DATE_RE.test(s) && !Number.isNaN(startOf(s).getTime()) && dateKey(startOf(s)) === s;

// Build a date range for a single calendar day.
function dayRange(dateStr) {
  return { gte: startOf(dateStr), lte: endOf(dateStr) };
}

module.exports = { DATE_RE, startOf, endOf, dateKey, isValidDateStr, dayRange };
