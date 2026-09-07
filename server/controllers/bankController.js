const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');

// ─── Bank Accounts ─────────────────────────────────────────
exports.listAccounts = async (req, res, next) => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      where: { businessId: req.businessId },
      orderBy: { name: 'asc' },
    });
    res.json(accounts);
  } catch (err) { next(err); }
};

exports.createAccount = async (req, res, next) => {
  try {
    const { name, bankName, accountNumber, glAccountId, currentBalance } = req.body;
    const account = await prisma.bankAccount.create({
      data: {
        businessId: req.businessId,
        name, bankName, accountNumber,
        glAccountId: glAccountId ? Number(glAccountId) : null,
        currentBalance: Number(currentBalance || 0),
      },
    });
    await recordAudit({ req, action: 'CREATE', entity: 'BankAccount', entityId: account.id, summary: `Created bank account ${account.name}` });
    res.status(201).json(account);
  } catch (err) { next(err); }
};

exports.updateAccount = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.bankAccount.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('Bank account not found', 404);
    const { name, bankName, accountNumber, glAccountId, currentBalance, isActive } = req.body;
    const account = await prisma.bankAccount.update({
      where: { id },
      data: {
        name, bankName, accountNumber,
        glAccountId: glAccountId ? Number(glAccountId) : null,
        ...(currentBalance != null && { currentBalance: Number(currentBalance) }),
        ...(isActive != null && { isActive }),
      },
    });
    await recordAudit({ req, action: 'UPDATE', entity: 'BankAccount', entityId: id, summary: `Updated bank account ${account.name}` });
    res.json(account);
  } catch (err) { next(err); }
};

exports.removeAccount = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.bankAccount.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('Bank account not found', 404);
    const txnCount = await prisma.bankTransaction.count({ where: { bankAccountId: id } });
    if (txnCount > 0) throw createError('Cannot delete an account that has transactions', 400);
    await prisma.bankAccount.delete({ where: { id } });
    await recordAudit({ req, action: 'DELETE', entity: 'BankAccount', entityId: id, summary: 'Deleted bank account' });
    res.json({ message: 'Bank account deleted' });
  } catch (err) { next(err); }
};

// ─── Transactions ──────────────────────────────────────────
exports.listTransactions = async (req, res, next) => {
  try {
    const { bankAccountId, reconciled, from, to } = req.query;
    const where = {
      // Scope to business via the parent bank account
      bankAccount: { businessId: req.businessId },
    };
    if (bankAccountId) where.bankAccountId = Number(bankAccountId);
    if (reconciled != null && reconciled !== '') where.isReconciled = reconciled === 'true';
    if (from || to) where.txnDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };
    const txns = await prisma.bankTransaction.findMany({ where, orderBy: { txnDate: 'desc' } });
    res.json(txns);
  } catch (err) { next(err); }
};

exports.createTransaction = async (req, res, next) => {
  try {
    const { bankAccountId, txnDate, description, reference, amount, type } = req.body;
    // Verify the account belongs to this business
    const acct = await prisma.bankAccount.findFirst({ where: { id: Number(bankAccountId), businessId: req.businessId } });
    if (!acct) throw createError('Bank account not found', 404);
    const signed = type === 'CREDIT' ? -Math.abs(Number(amount)) : Math.abs(Number(amount));
    const txn = await prisma.bankTransaction.create({
      data: {
        bankAccountId: Number(bankAccountId),
        txnDate: new Date(txnDate),
        description, reference,
        amount: signed,
        type: type === 'CREDIT' ? 'CREDIT' : 'DEBIT',
      },
    });
    await recordAudit({ req, action: 'CREATE', entity: 'BankTransaction', entityId: txn.id, summary: `Bank txn ${type} ${amount} — ${description}` });
    res.status(201).json(txn);
  } catch (err) { next(err); }
};

exports.removeTransaction = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const txn = await prisma.bankTransaction.findFirst({
      where: { id, bankAccount: { businessId: req.businessId } },
    });
    if (!txn) throw createError('Transaction not found', 404);
    if (txn.isReconciled) throw createError('Cannot delete a reconciled transaction', 400);
    await prisma.bankTransaction.delete({ where: { id } });
    res.json({ message: 'Transaction deleted' });
  } catch (err) { next(err); }
};

// ─── Reconciliations ───────────────────────────────────────
exports.listReconciliations = async (req, res, next) => {
  try {
    const { bankAccountId } = req.query;
    const where = {
      bankAccount: { businessId: req.businessId },
    };
    if (bankAccountId) where.bankAccountId = Number(bankAccountId);
    const recs = await prisma.bankReconciliation.findMany({
      where,
      include: { bankAccount: { select: { name: true } }, _count: { select: { transactions: true } } },
      orderBy: { id: 'desc' },
    });
    res.json(recs);
  } catch (err) { next(err); }
};

exports.getReconciliation = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const rec = await prisma.bankReconciliation.findFirst({
      where: { id, bankAccount: { businessId: req.businessId } },
      include: { bankAccount: true },
    });
    if (!rec) throw createError('Reconciliation not found', 404);

    const transactions = await prisma.bankTransaction.findMany({
      where: {
        bankAccountId: rec.bankAccountId,
        txnDate: { lte: rec.statementDate },
        OR: [{ reconciliationId: id }, { reconciliationId: null, isReconciled: false }],
      },
      orderBy: { txnDate: 'asc' },
    });

    const clearedTotal = transactions
      .filter((t) => t.reconciliationId === id && t.isReconciled)
      .reduce((s, t) => s + Number(t.amount), 0);
    const difference = Number(rec.statementBalance) - clearedTotal;

    res.json({ ...rec, transactions, clearedTotal, difference });
  } catch (err) { next(err); }
};

exports.createReconciliation = async (req, res, next) => {
  try {
    const { bankAccountId, statementDate, statementBalance, notes } = req.body;
    // Verify account belongs to business
    const acct = await prisma.bankAccount.findFirst({ where: { id: Number(bankAccountId), businessId: req.businessId } });
    if (!acct) throw createError('Bank account not found', 404);
    const rec = await prisma.bankReconciliation.create({
      data: {
        bankAccountId: Number(bankAccountId),
        statementDate: new Date(statementDate),
        statementBalance: Number(statementBalance),
        notes,
        createdBy: req.user?.id ?? null,
      },
    });
    await recordAudit({ req, action: 'CREATE', entity: 'BankReconciliation', entityId: rec.id, summary: `Started reconciliation for ${statementDate}` });
    res.status(201).json(rec);
  } catch (err) { next(err); }
};

exports.toggleTransaction = async (req, res, next) => {
  try {
    const recId = Number(req.params.id);
    const txnId = Number(req.params.txnId);
    const rec = await prisma.bankReconciliation.findFirst({
      where: { id: recId, bankAccount: { businessId: req.businessId } },
    });
    if (!rec) throw createError('Reconciliation not found', 404);
    if (rec.status === 'COMPLETED') throw createError('Reconciliation already completed', 400);

    const txn = await prisma.bankTransaction.findUnique({ where: { id: txnId } });
    if (!txn) throw createError('Transaction not found', 404);

    const willClear = !(txn.reconciliationId === recId && txn.isReconciled);
    const updated = await prisma.bankTransaction.update({
      where: { id: txnId },
      data: willClear
        ? { isReconciled: true, reconciliationId: recId }
        : { isReconciled: false, reconciliationId: null },
    });

    const cleared = await prisma.bankTransaction.findMany({ where: { reconciliationId: recId, isReconciled: true } });
    const reconciledBalance = cleared.reduce((s, t) => s + Number(t.amount), 0);
    await prisma.bankReconciliation.update({ where: { id: recId }, data: { reconciledBalance } });

    res.json({ transaction: updated, reconciledBalance, difference: Number(rec.statementBalance) - reconciledBalance });
  } catch (err) { next(err); }
};

exports.completeReconciliation = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const rec = await prisma.bankReconciliation.findFirst({
      where: { id, bankAccount: { businessId: req.businessId } },
    });
    if (!rec) throw createError('Reconciliation not found', 404);
    if (rec.status === 'COMPLETED') throw createError('Already completed', 400);

    const difference = Number(rec.statementBalance) - Number(rec.reconciledBalance);
    if (Math.abs(difference) > 0.01 && !req.body.force) {
      throw createError(`Cannot complete — out of balance by ${difference.toFixed(2)}. Send force:true to override.`, 400);
    }
    const updated = await prisma.bankReconciliation.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await recordAudit({ req, action: 'COMPLETE', entity: 'BankReconciliation', entityId: id, summary: `Completed reconciliation (diff ${difference.toFixed(2)})` });
    res.json(updated);
  } catch (err) { next(err); }
};
