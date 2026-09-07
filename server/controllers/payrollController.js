const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { computePayroll, computeSSS, computePhilHealth, computePagIBIG, computeWithholdingTax } = require('../utils/phCompliance');
const glPost = require('../utils/glPost');

exports.listEmployees = async (req, res, next) => {
  try {
    const { search, active, department } = req.query;
    const where = { businessId: req.businessId };
    if (active !== undefined) where.isActive = active === 'true';
    if (department) where.department = { contains: department };
    if (search) where.OR = [
      { firstName: { contains: search } }, { lastName: { contains: search } },
      { employeeNo: { contains: search } },
    ];
    res.json(await prisma.employee.findMany({ where, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }));
  } catch (err) { next(err); }
};

exports.getEmployee = async (req, res, next) => {
  try {
    const emp = await prisma.employee.findUnique({
      where: { id: Number(req.params.id) },
      include: { payrollItems: { include: { period: true }, orderBy: { period: { startDate: 'desc' } }, take: 12 } },
    });
    if (!emp) throw createError('Employee not found', 404);
    res.json(emp);
  } catch (err) { next(err); }
};

// Next sequential employee number (EMP-001, EMP-002, …) per business
async function nextEmployeeNo(businessId) {
  const rows = await prisma.employee.findMany({
    where: { businessId, employeeNo: { startsWith: 'EMP-' } },
    select: { employeeNo: true },
  });
  let max = 0;
  for (const { employeeNo } of rows) {
    const m = /^EMP-(\d+)$/.exec(employeeNo);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'EMP-' + String(max + 1).padStart(3, '0');
}

exports.createEmployee = async (req, res, next) => {
  try {
    const data = req.body;
    const base = {
      businessId: req.businessId,
      firstName: data.firstName, lastName: data.lastName, middleName: data.middleName,
      position: data.position, department: data.department,
      tin: data.tin, sssNo: data.sssNo, philhealthNo: data.philhealthNo, pagibigNo: data.pagibigNo,
      hireDate: new Date(data.hireDate), employmentType: data.employmentType,
      payFrequency: data.payFrequency, basicSalary: Number(data.basicSalary),
    };
    const manual = data.employeeNo && data.employeeNo.trim();

    if (manual) {
      const emp = await prisma.employee.create({ data: { ...base, employeeNo: data.employeeNo.trim() } });
      return res.status(201).json(emp);
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const employeeNo = await nextEmployeeNo(req.businessId);
        const emp = await prisma.employee.create({ data: { ...base, employeeNo } });
        return res.status(201).json(emp);
      } catch (err) {
        if (err.code === 'P2002' && attempt < 4) continue;
        throw err;
      }
    }
  } catch (err) { next(err); }
};

exports.updateEmployee = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { firstName, lastName, middleName, position, department, basicSalary, isActive, tin, sssNo, philhealthNo, pagibigNo, payFrequency } = req.body;
    res.json(await prisma.employee.update({ where: { id }, data: { firstName, lastName, middleName, position, department, basicSalary: basicSalary ? Number(basicSalary) : undefined, isActive, tin, sssNo, philhealthNo, pagibigNo, payFrequency } }));
  } catch (err) { next(err); }
};

exports.listPeriods = async (req, res, next) => {
  try {
    const periods = await prisma.payrollPeriod.findMany({
      where: { businessId: req.businessId },
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { items: true } } },
    });
    res.json(periods);
  } catch (err) { next(err); }
};

exports.createPeriod = async (req, res, next) => {
  try {
    const { periodName, startDate, endDate, payDate } = req.body;
    res.status(201).json(await prisma.payrollPeriod.create({
      data: { businessId: req.businessId, periodName, startDate: new Date(startDate), endDate: new Date(endDate), payDate: new Date(payDate) },
    }));
  } catch (err) { next(err); }
};

exports.computePeriod = async (req, res, next) => {
  try {
    const periodId = Number(req.params.id);
    const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw createError('Period not found', 404);
    if (period.status !== 'OPEN') throw createError('Period already computed', 400);

    const employees = await prisma.employee.findMany({ where: { isActive: true, businessId: req.businessId } });
    const items = employees.map((emp) => {
      const result = computePayroll({
        basicSalary: Number(emp.basicSalary),
        payFrequency: emp.payFrequency,
      });
      return { periodId, employeeId: emp.id, ...result };
    });

    await prisma.$transaction([
      prisma.payrollItem.deleteMany({ where: { periodId } }),
      prisma.payrollItem.createMany({ data: items }),
      prisma.payrollPeriod.update({ where: { id: periodId }, data: { status: 'COMPUTED' } }),
    ]);

    res.json({ message: `Computed ${items.length} payroll items`, count: items.length });
  } catch (err) { next(err); }
};

exports.updatePeriod = async (req, res, next) => {
  try {
    const periodId = Number(req.params.id);
    const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw createError('Period not found', 404);

    const { status } = req.body;
    const VALID_TRANSITIONS = {
      OPEN: ['COMPUTED'],
      COMPUTED: ['APPROVED', 'OPEN'],
      APPROVED: ['PAID', 'COMPUTED'],
      PAID: [],
    };
    if (status && !VALID_TRANSITIONS[period.status]?.includes(status)) {
      throw createError(`Cannot transition from ${period.status} to ${status}`, 400);
    }

    res.json(await prisma.payrollPeriod.update({
      where: { id: periodId },
      data: { ...(status && { status }) },
    }));
  } catch (err) { next(err); }
};

exports.approvePeriod = async (req, res, next) => {
  try {
    const periodId = Number(req.params.id);
    const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw createError('Period not found', 404);
    if (period.status !== 'COMPUTED') throw createError('Period must be in COMPUTED status to approve', 400);

    const approved = await prisma.payrollPeriod.update({ where: { id: periodId }, data: { status: 'APPROVED' } });

    // ── Auto-post payroll accrual to GL ──────────────────────────────────────
    const items = await prisma.payrollItem.findMany({ where: { periodId } });
    if (items.length > 0) {
      const tot = items.reduce((s, i) => ({
        grossPay:       s.grossPay       + Number(i.grossPay),
        sssEmployee:    s.sssEmployee    + Number(i.sssEmployee),
        sssEmployer:    s.sssEmployer    + Number(i.sssEmployer),
        philhealthEe:   s.philhealthEe   + Number(i.philhealthEe),
        philhealthEr:   s.philhealthEr   + Number(i.philhealthEr),
        pagibigEe:      s.pagibigEe      + Number(i.pagibigEe),
        pagibigEr:      s.pagibigEr      + Number(i.pagibigEr),
        withholdingTax: s.withholdingTax + Number(i.withholdingTax),
        netPay:         s.netPay         + Number(i.netPay),
      }), { grossPay:0, sssEmployee:0, sssEmployer:0, philhealthEe:0, philhealthEr:0, pagibigEe:0, pagibigEr:0, withholdingTax:0, netPay:0 });

      await glPost.safePost({
        entryDate:   period.payDate,
        description: `Payroll Accrual — ${period.periodName}`,
        reference:   `PR-${String(periodId).padStart(6, '0')}`,
        lines: [
          // DR Salaries & Wages (gross pay)
          { accountCode: '6110', debit: tot.grossPay,     description: 'Gross Salaries & Wages' },
          // DR Employer contributions (expense side)
          ...(tot.sssEmployer    > 0 ? [{ accountCode: '6120', debit: tot.sssEmployer,    description: 'SSS — Employer Share' }]      : []),
          ...(tot.philhealthEr   > 0 ? [{ accountCode: '6130', debit: tot.philhealthEr,   description: 'PhilHealth — Employer Share' }] : []),
          ...(tot.pagibigEr      > 0 ? [{ accountCode: '6140', debit: tot.pagibigEr,      description: 'Pag-IBIG — Employer Share' }]   : []),
          // CR Government payables (employee + employer shares)
          ...(tot.sssEmployee + tot.sssEmployer > 0 ? [{
            accountCode: '2050', credit: tot.sssEmployee + tot.sssEmployer, description: 'SSS Contributions Payable',
          }] : []),
          ...(tot.philhealthEe + tot.philhealthEr > 0 ? [{
            accountCode: '2060', credit: tot.philhealthEe + tot.philhealthEr, description: 'PhilHealth Contributions Payable',
          }] : []),
          ...(tot.pagibigEe + tot.pagibigEr > 0 ? [{
            accountCode: '2070', credit: tot.pagibigEe + tot.pagibigEr, description: 'Pag-IBIG Contributions Payable',
          }] : []),
          ...(tot.withholdingTax > 0 ? [{
            accountCode: '2040', credit: tot.withholdingTax, description: 'Withholding Tax Payable (1601-C)',
          }] : []),
          // CR Net pay payable (accrued salaries)
          { accountCode: '2021', credit: tot.netPay, description: 'Accrued Net Pay to Employees' },
        ],
        userId: req.user?.id || 1,
        businessId: req.businessId,
      });
    }

    res.json(approved);
  } catch (err) { next(err); }
};

exports.getPeriodItems = async (req, res, next) => {
  try {
    const periodId = Number(req.params.id);
    const items = await prisma.payrollItem.findMany({
      where: { periodId },
      include: { employee: { select: { employeeNo: true, firstName: true, lastName: true, position: true, department: true } } },
      orderBy: { employee: { lastName: 'asc' } },
    });

    const totals = items.reduce((s, i) => ({
      grossPay:        s.grossPay        + Number(i.grossPay),
      sssEmployee:     s.sssEmployee     + Number(i.sssEmployee),
      philhealthEe:    s.philhealthEe    + Number(i.philhealthEe),
      pagibigEe:       s.pagibigEe       + Number(i.pagibigEe),
      withholdingTax:  s.withholdingTax  + Number(i.withholdingTax),
      totalDeductions: s.totalDeductions + Number(i.totalDeductions),
      netPay:          s.netPay          + Number(i.netPay),
    }), { grossPay: 0, sssEmployee: 0, philhealthEe: 0, pagibigEe: 0, withholdingTax: 0, totalDeductions: 0, netPay: 0 });

    res.json({ items, totals });
  } catch (err) { next(err); }
};

exports.calculator = async (req, res, next) => {
  try {
    const { basicSalary, payFrequency = 'SEMI_MONTHLY', allowances = 0, overtimePay = 0 } = req.query;
    if (!basicSalary) throw createError('basicSalary is required', 400);
    const result = computePayroll({
      basicSalary: Number(basicSalary),
      payFrequency,
      allowances: Number(allowances),
      overtimePay: Number(overtimePay),
    });
    res.json(result);
  } catch (err) { next(err); }
};

exports.generate2316 = async (req, res, next) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const year = Number(req.params.year);

    const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!emp) throw createError('Employee not found', 404);

    const items = await prisma.payrollItem.findMany({
      where: {
        employeeId,
        period: { startDate: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) }, status: { in: ['APPROVED','PAID'] } },
      },
      include: { period: true },
    });

    const totals = items.reduce((s, i) => ({
      grossPay:       s.grossPay       + Number(i.grossPay),
      sssEmployee:    s.sssEmployee    + Number(i.sssEmployee),
      philhealthEe:   s.philhealthEe   + Number(i.philhealthEe),
      pagibigEe:      s.pagibigEe      + Number(i.pagibigEe),
      withholdingTax: s.withholdingTax + Number(i.withholdingTax),
      netPay:         s.netPay         + Number(i.netPay),
    }), { grossPay: 0, sssEmployee: 0, philhealthEe: 0, pagibigEe: 0, withholdingTax: 0, netPay: 0 });

    res.json({
      form: 'BIR Form 2316',
      year,
      employee: {
        name: `${emp.lastName}, ${emp.firstName} ${emp.middleName || ''}`.trim(),
        tin: emp.tin, sssNo: emp.sssNo, philhealthNo: emp.philhealthNo, pagibigNo: emp.pagibigNo,
        position: emp.position,
      },
      totals,
      periodCount: items.length,
    });
  } catch (err) { next(err); }
};
