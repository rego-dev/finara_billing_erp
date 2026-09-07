const prisma = require('../config/database');
const logger = require('./logger');

/**
 * Record an audit trail entry. Fire-and-forget: never blocks or fails the
 * request it is logging — any error is swallowed and logged to the app logger.
 *
 * @param {object} opts
 * @param {object} [opts.req]      Express request (used to derive user + IP + UA)
 * @param {string} opts.action     CREATE | UPDATE | DELETE | POST | VOID | LOGIN | LOGIN_FAILED | ...
 * @param {string} opts.entity     Entity name, e.g. "JournalEntry"
 * @param {string|number} [opts.entityId]
 * @param {string} [opts.summary]  Human-readable one-liner
 * @param {object} [opts.changes]  Arbitrary metadata / { before, after } diff
 * @param {object} [opts.user]     Explicit user override ({ id, email }) when req is unavailable
 */
async function recordAudit({ req, action, entity, entityId, summary, changes, user, businessId } = {}) {
  try {
    const actor = user || req?.user || {};
    const ip =
      req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
      req?.ip ||
      req?.connection?.remoteAddress ||
      null;

    await prisma.auditLog.create({
      data: {
        userId:    actor.id ?? null,
        userEmail: actor.email ?? null,
        businessId: businessId ?? req?.businessId ?? null,
        action,
        entity,
        entityId:  entityId != null ? String(entityId) : null,
        summary:   summary ? String(summary).slice(0, 255) : null,
        changes:   changes ?? undefined,
        ipAddress: ip ? String(ip).slice(0, 60) : null,
        userAgent: req?.headers?.['user-agent']?.slice(0, 255) || null,
      },
    });
  } catch (err) {
    // Auditing must never break the underlying operation.
    logger.error(`[audit] failed to record ${action} ${entity}: ${err.message}`);
  }
}

/** Build a shallow before/after diff of only the changed fields. */
function diff(before = {}, after = {}) {
  const out = { before: {}, after: {} };
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    const b = before?.[k];
    const a = after?.[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      out.before[k] = b;
      out.after[k] = a;
    }
  }
  return out;
}

module.exports = { recordAudit, diff };
