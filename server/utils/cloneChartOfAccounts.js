const prisma = require('../config/database');

// Copies every Account row from sourceBusinessId into targetBusinessId,
// preserving the parent/child hierarchy. Two passes are required because a
// child's parentId must point at the *new* row's id, not the source row's —
// roots are inserted first so their new ids exist before children reference them.
async function cloneChartOfAccounts(sourceBusinessId, targetBusinessId) {
  const sourceAccounts = await prisma.account.findMany({
    where: { businessId: sourceBusinessId },
    orderBy: { accountCode: 'asc' },
  });

  const idMap = {}; // old id → new id

  for (const acc of sourceAccounts.filter((a) => !a.parentId)) {
    const newAcc = await prisma.account.create({
      data: {
        businessId:    targetBusinessId,
        accountCode:   acc.accountCode,
        accountName:   acc.accountName,
        accountType:   acc.accountType,
        normalBalance: acc.normalBalance,
        description:   acc.description,
        isActive:      acc.isActive,
      },
    });
    idMap[acc.id] = newAcc.id;
  }

  for (const acc of sourceAccounts.filter((a) => a.parentId)) {
    const newAcc = await prisma.account.create({
      data: {
        businessId:    targetBusinessId,
        accountCode:   acc.accountCode,
        accountName:   acc.accountName,
        accountType:   acc.accountType,
        normalBalance: acc.normalBalance,
        parentId:      idMap[acc.parentId] || null,
        description:   acc.description,
        isActive:      acc.isActive,
      },
    });
    idMap[acc.id] = newAcc.id;
  }

  return idMap;
}

module.exports = { cloneChartOfAccounts };
