const prisma = require('../config/database');

exports.list = async (req, res, next) => {
  try {
    const { action, entity, entityId, userId, from, to, search, page = 1, limit = 50 } = req.query;
    const where = {};
    if (action) where.action = action;
    if (entity) where.entity = entity;
    if (entityId) where.entityId = String(entityId);
    if (userId) where.userId = Number(userId);
    if (from || to) {
      where.createdAt = {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(`${to}T23:59:59.999Z`) }),
      };
    }
    if (search) {
      where.OR = [
        { summary: { contains: search } },
        { userEmail: { contains: search } },
        { entityId: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ data, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
};

// Distinct values for filter dropdowns
exports.filters = async (req, res, next) => {
  try {
    const [actions, entities] = await Promise.all([
      prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
      prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
    ]);
    res.json({
      actions: actions.map((a) => a.action),
      entities: entities.map((e) => e.entity),
    });
  } catch (err) { next(err); }
};
