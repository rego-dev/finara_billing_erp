/**
 * Human-readable field name from a Prisma P2002 (unique constraint) error.
 *
 * `err.meta.target` is NOT the same shape across connectors:
 *   - PostgreSQL -> string[] of field names        ['poNumber']
 *   - MySQL      -> string, the index name         'purchase_orders_poNumber_key'
 *
 * Indexing with [0] therefore returns the first CHARACTER on MySQL, which is
 * how "poNumber" ended up rendered as "p".
 *
 * @param {string|string[]|undefined} target
 * @returns {string}
 */
function uniqueFieldLabel(target) {
  if (!target) return 'value';
  if (Array.isArray(target)) {
    return target.length ? target.join(', ') : 'value';
  }

  const s = String(target).replace(/_key$/, '');
  if (!s) return 'value';
  if (s.toUpperCase() === 'PRIMARY') return 'ID';

  // MySQL index names are prefixed with the table: purchase_orders_poNumber
  const parts = s.split('_');
  return parts[parts.length - 1] || 'value';
}

module.exports = { uniqueFieldLabel };
