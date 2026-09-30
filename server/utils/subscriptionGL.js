// Posts Finara's own subscription/renewal payment as a journal entry in a
// dedicated internal business's books ("Finara Operations") — never in the
// paying customer's own business, which never sees this income; it's
// Finara's, not theirs. See
// docs/superpowers/specs/2026-09-30-subscription-gl-posting-design.md.
const prisma = require('../config/database');
const glPost = require('./glPost');

const FINARA_OPS_CODE = 'FINARA-OPS';
const CASH_ACCOUNT_CODE = '1010';
const REVENUE_ACCOUNT_CODE = '4000';

// Cached like glPost.js's own _bizCache — resolved once per process, not
// hardcoded, since the id differs across environments/seed order.
let _finaraOpsBusinessId = null;

async function getFinaraOpsBusinessId() {
  if (_finaraOpsBusinessId) return _finaraOpsBusinessId;
  const biz = await prisma.business.findFirst({ where: { code: FINARA_OPS_CODE }, select: { id: true } });
  if (!biz) throw new Error(`GL: "${FINARA_OPS_CODE}" business not found — subscription revenue cannot be posted`);
  _finaraOpsBusinessId = biz.id;
  return _finaraOpsBusinessId;
}

// kind: 'NEW' | 'RENEWAL'
async function postSubscriptionPayment({ order, companyName, kind, userId }) {
  const businessId = await getFinaraOpsBusinessId();
  const label = kind === 'RENEWAL' ? 'Renewal' : 'New';
  return glPost.safePost({
    entryDate: new Date(),
    description: `Subscription — ${label}: ${companyName} (${order.orderNo})`,
    reference: order.orderNo,
    lines: [
      { accountCode: CASH_ACCOUNT_CODE, debit: Number(order.amount), description: `Payment received — ${order.orderNo}` },
      { accountCode: REVENUE_ACCOUNT_CODE, credit: Number(order.amount), description: `Subscription revenue — ${companyName}` },
    ],
    userId,
    businessId,
  });
}

module.exports = { postSubscriptionPayment, getFinaraOpsBusinessId, FINARA_OPS_CODE };
