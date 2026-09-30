const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');

// Shared by every endpoint that reads or acts on a single business by id.
// ADMIN/SUPER_ADMIN can act on any business; anyone else needs an explicit
// UserBusiness grant. Extracted from businessController.get, which had this
// check duplicated inline.
async function assertBusinessAccess(user, businessId) {
  if (['ADMIN', 'SUPER_ADMIN'].includes(user.role)) return;
  const ub = await prisma.userBusiness.findUnique({
    where: { userId_businessId: { userId: user.id, businessId } },
  });
  if (!ub) throw createError('Access denied to this business', 403);
}

module.exports = { assertBusinessAccess };
