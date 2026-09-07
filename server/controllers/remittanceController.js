const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const glPost = require('../utils/glPost');

// ── Type → GL payable account code mapping ───────────────────────
const TYPE_GL = {
  SSS:       { payable: '2050', expenseCode: '6120' },
  PHILHEALTH:{ payable: '2060', expenseCode: '6130' },
  PAGIBIG:   { payable: '2070', expenseCode: '6140' },
  BIR_1601C: { payable: '2040', expenseCode: null   },
};

// ─── Helpers ────────────────────────────────────────────────────

function getDueDate(type, month, year) {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  if (type === 'SSS') {
    const lastDay = new Date(nextYear, nextMonth, 0).getDate();
    return new Date(nextYear, nextMonth - 1, lastDay);
  }
  return new Date(nextYear, nextMonth - 1, 15);
}

function resolveStatus(rp) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due   = new Date(rp.dueDate);
  if ((rp.status === 'DRAFT' || rp.status === 'FILED') && due < today) {
    return { ...rp, status: 'OVERDUE' };
  }
  return rp;
}

const TYPE_FIELDS = {
  SSS:       { ee: 'sssEmployee',   er: 'sssEmployer',   gross: null },
  PHILHEALTH:{ ee: 'philhealthEe',  er: 'philhealthEr',  gross: null },
  PAGIBIG:   { ee: 'pagibigEe',     er: 'pagibigEr',     gross: null },
  BIR_1601C: { ee: 'withholdingTax',er: null,            gross: 'grossPay' },
};

// ─── Dashboard Summary ───────────────────────────────────────────

exports.getSummary = async (req, res, next) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yr    = today.getFullYear();
    const mo    = today.getMonth() + 1;
    const biz   = req.businessId;

    const [all, thisMonth, paidYTD] = await Promise.all([
      prisma.remittancePeriod.findMany({
        where: { businessId: biz },
        select: { status: true, dueDate: true, totalAmount: true },
      }),
      prisma.remittancePeriod.findMany({
        where: { businessId: biz, periodMonth: mo, periodYear: yr },
        select: { type: true, status: true, totalAmount: true, dueDate: true },
      }),
      prisma.remittancePeriod.findMany({
        where: { businessId: biz, status: 'PAID', periodYear: yr },
        select: { paidAmount: true, totalAmount: true },
      }),
    ]);

    const overdue = all.filter(r => (r.status === 'DRAFT' || r.status === 'FILED') && new Date(r.dueDate) < today).length;
    const filed   = all.filter(r => r.status === 'FILED').length;
    const thisMonthTotal = thisMonth.reduce((s, r) => s + Number(r.totalAmount), 0);
    const paidTotal      = paidYTD.reduce((s, r) => s + Number(r.paidAmount || r.totalAmount), 0);

    const TYPES = ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR_1601C'];
    const upcoming = [];
    for (let i = 0; i < 3; i++) {
      const m = ((mo - 1 + i) % 12) + 1;
      const y = yr + Math.floor((mo - 1 + i) / 12);
      for (const t of TYPES) {
        upcoming.push({ type: t, periodMonth: m, periodYear: y, dueDate: getDueDate(t, m, y) });
      }
    }

    res.json({ overdue, filed, thisMonthTotal, paidTotal, upcoming });
  } catch (err) { next(err); }
};

// ─── List ────────────────────────────────────────────────────────

exports.list = async (req, res, next) => {
  try {
    const { type, status, year, month } = req.query;
    const where = { businessId: req.businessId };
    if (type)   where.type        = type;
    if (status) where.status      = status;
    if (year)   where.periodYear  = Number(year);
    if (month)  where.periodMonth = Number(month);

    const rows = await prisma.remittancePeriod.findMany({
      where,
      include: { details: { include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } } } } },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { type: 'asc' }],
    });

    res.json(rows.map(resolveStatus));
  } catch (err) { next(err); }
};

// ─── Get One ─────────────────────────────────────────────────────

exports.get = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.remittancePeriod.findFirst({
      where: { id, businessId: req.businessId },
      include: { details: { include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, sssNo: true, philhealthNo: true, pagibigNo: true, tin: true } } } } },
    });
    if (!row) throw createError('Remittance record not found', 404);
    res.json(resolveStatus(row));
  } catch (err) { next(err); }
};

// ─── Auto-Calculate ──────────────────────────────────────────────

exports.calculate = async (req, res, next) => {
  try {
    const { type, periodMonth, periodYear } = req.body;
    if (!TYPE_FIELDS[type]) throw createError('Invalid remittance type', 400);

    const mo = Number(periodMonth);
    const yr = Number(periodYear);

    const items = await prisma.payrollItem.findMany({
      where: {
        period: {
          businessId: req.businessId,           // ← fixed: filter by business
          endDate: {
            gte: new Date(yr, mo - 1, 1),
            lt:  new Date(yr, mo, 1),
          },
        },
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, sssNo: true, philhealthNo: true, pagibigNo: true, tin: true } },
        period:   { select: { periodName: true } },
      },
    });

    const { ee, er, gross } = TYPE_FIELDS[type];

    const byEmployee = {};
    for (const item of items) {
      const empId = item.employeeId;
      if (!byEmployee[empId]) {
        byEmployee[empId] = {
          employee: item.employee,
          employeeShare: 0, employerShare: 0, totalContribution: 0, grossCompensation: 0,
        };
      }
      byEmployee[empId].employeeShare     += Number(item[ee] || 0);
      byEmployee[empId].employerShare     += er ? Number(item[er] || 0) : 0;
      byEmployee[empId].grossCompensation += gross ? Number(item[gross] || 0) : 0;
    }

    const details = Object.values(byEmployee).map(d => ({
      ...d,
      totalContribution: d.employeeShare + d.employerShare,
    }));

    const totalEmployeeShare = details.reduce((s, d) => s + d.employeeShare, 0);
    const totalEmployerShare = details.reduce((s, d) => s + d.employerShare, 0);
    const totalAmount        = totalEmployeeShare + totalEmployerShare;
    const dueDate            = getDueDate(type, mo, yr);

    res.json({ type, periodMonth: mo, periodYear: yr, dueDate, totalEmployeeShare, totalEmployerShare, totalAmount, details, payrollPeriodsCount: items.length });
  } catch (err) { next(err); }
};

// ─── Create ──────────────────────────────────────────────────────

exports.create = async (req, res, next) => {
  try {
    const {
      type, periodMonth, periodYear,
      totalEmployeeShare, totalEmployerShare, totalAmount,
      isManual = false, notes, details = [],
    } = req.body;

    const mo  = Number(periodMonth);
    const yr  = Number(periodYear);
    const biz = req.businessId;

    // Check uniqueness per business
    const exists = await prisma.remittancePeriod.findFirst({
      where: { businessId: biz, type, periodMonth: mo, periodYear: yr },
    });
    if (exists) throw createError(`A ${type} remittance for ${mo}/${yr} already exists`, 409);

    const dueDate = getDueDate(type, mo, yr);

    const record = await prisma.remittancePeriod.create({
      data: {
        businessId: biz,
        type, periodMonth: mo, periodYear: yr, dueDate,
        totalEmployeeShare: Number(totalEmployeeShare || 0),
        totalEmployerShare: Number(totalEmployerShare || 0),
        totalAmount:        Number(totalAmount || 0),
        isManual,
        notes,
        details: {
          create: details.map(d => ({
            employeeId:        d.employeeId,
            employeeShare:     Number(d.employeeShare  || 0),
            employerShare:     Number(d.employerShare  || 0),
            totalContribution: Number(d.totalContribution || 0),
            grossCompensation: d.grossCompensation != null ? Number(d.grossCompensation) : null,
          })),
        },
      },
      include: { details: { include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } } } } },
    });

    res.status(201).json(record);
  } catch (err) { next(err); }
};

// ─── Update ──────────────────────────────────────────────────────

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const {
      totalEmployeeShare, totalEmployerShare, totalAmount,
      isManual, notes, details,
    } = req.body;

    const existing = await prisma.remittancePeriod.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('Remittance record not found', 404);
    if (existing.status === 'PAID') throw createError('Cannot edit a paid remittance', 400);

    await prisma.remittancePeriod.update({
      where: { id },
      data: {
        totalEmployeeShare: totalEmployeeShare != null ? Number(totalEmployeeShare) : undefined,
        totalEmployerShare: totalEmployerShare != null ? Number(totalEmployerShare) : undefined,
        totalAmount:        totalAmount        != null ? Number(totalAmount)        : undefined,
        isManual:           isManual           != null ? isManual                   : undefined,
        notes,
      },
    });

    if (Array.isArray(details)) {
      await prisma.remittanceDetail.deleteMany({ where: { remittancePeriodId: id } });
      if (details.length) {
        await prisma.remittanceDetail.createMany({
          data: details.map(d => ({
            remittancePeriodId: id,
            employeeId:         d.employeeId,
            employeeShare:      Number(d.employeeShare  || 0),
            employerShare:      Number(d.employerShare  || 0),
            totalContribution:  Number(d.totalContribution || 0),
            grossCompensation:  d.grossCompensation != null ? Number(d.grossCompensation) : null,
          })),
        });
      }
    }

    const updated = await prisma.remittancePeriod.findFirst({
      where: { id, businessId: req.businessId },
      include: { details: { include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } } } } },
    });
    res.json(resolveStatus(updated));
  } catch (err) { next(err); }
};

// ─── Mark Filed ──────────────────────────────────────────────────

exports.markFiled = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { referenceNo, filedDate } = req.body;
    const existing = await prisma.remittancePeriod.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('Remittance record not found', 404);
    const updated = await prisma.remittancePeriod.update({
      where: { id },
      data: { status: 'FILED', referenceNo, filedDate: filedDate ? new Date(filedDate) : new Date() },
    });
    res.json(resolveStatus(updated));
  } catch (err) { next(err); }
};

// ─── Mark Paid ───────────────────────────────────────────────────

exports.markPaid = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { paidAmount, paidDate, referenceNo, penalty } = req.body;

    const rp = await prisma.remittancePeriod.findFirst({ where: { id, businessId: req.businessId } });
    if (!rp) throw createError('Remittance period not found', 404);

    const updated = await prisma.remittancePeriod.update({
      where: { id },
      data: {
        status:      'PAID',
        paidDate:    paidDate ? new Date(paidDate) : new Date(),
        paidAmount:  paidAmount  != null ? Number(paidAmount) : undefined,
        penalty:     penalty     != null ? Number(penalty)    : 0,
        referenceNo: referenceNo || undefined,
      },
    });

    // ── Auto-post to GL ─────────────────────────────────────────────
    const glMap    = TYPE_GL[rp.type];
    const amount   = Number(paidAmount ?? rp.totalAmount);
    const entryDate = paidDate || new Date().toISOString().slice(0, 10);
    const label    = `${rp.type.replace('_', ' ')} — ${rp.periodMonth}/${rp.periodYear}`;

    if (glMap) {
      await glPost.safePost({
        entryDate,
        description: `Remittance Payment — ${label}`,
        reference:   referenceNo || `REM-${id}`,
        businessId:  req.businessId,               // ← fixed: was missing
        lines: [
          { accountCode: glMap.payable, debit: amount,  description: `Clear ${label}` },
          { accountCode: '1020',        credit: amount,  description: `Cash paid — ${label}` },
        ],
        userId: req.user?.id || 1,
      });
    }

    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Delete (draft only) ─────────────────────────────────────────

exports.remove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.remittancePeriod.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('Not found', 404);
    if (existing.status !== 'DRAFT' && existing.status !== 'OVERDUE') {
      throw createError('Only DRAFT remittances can be deleted', 400);
    }
    await prisma.remittancePeriod.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
};
