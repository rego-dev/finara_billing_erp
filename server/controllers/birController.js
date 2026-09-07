const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');

const parseRange = (req) => {
  const { from, to, month, quarter, year } = req.query;
  if (from && to) return { gte: new Date(from), lte: new Date(to) };
  if (month && year) {
    const m = Number(month);
    const y = Number(year);
    return { gte: new Date(y, m - 1, 1), lte: new Date(y, m, 0, 23, 59, 59) };
  }
  if (quarter && year) {
    const q = Number(quarter);
    const y = Number(year);
    const startMonth = (q - 1) * 3;
    return { gte: new Date(y, startMonth, 1), lte: new Date(y, startMonth + 3, 0, 23, 59, 59) };
  }
  const now = new Date();
  return {
    gte: new Date(now.getFullYear(), now.getMonth(), 1),
    lte: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
  };
};

/**
 * BIR reports read the source `invoice` / `bill` tables, not the GL, so the
 * cutover guard in glPost does NOT protect them. A historical invoice entered
 * for history would otherwise reappear in a return covering its old date and
 * re-declare VAT already filed under the previous books.
 *
 * Clamps the requested period to start no earlier than the books start date,
 * and reports when that clamping actually happened.
 */
const rangeWithCutover = async (req) => {
  const range = parseRange(req);
  const biz = await prisma.business.findUnique({
    where:  { id: req.businessId },
    select: { booksStartDate: true },
  });
  const start = biz?.booksStartDate;
  if (!start) return { range, cutoverWarning: null };

  if (new Date(range.gte) >= new Date(start)) return { range, cutoverWarning: null };

  const startKey = new Date(start).toISOString().slice(0, 10);
  return {
    range: { ...range, gte: new Date(start) },
    cutoverWarning:
      `This period begins before the books start date (${startKey}). Documents dated earlier are ` +
      `excluded — they were declared under your previous books.`,
  };
};

// ─── VAT Summary (Form 2550M / 2550Q) ─────────────────────
exports.vatSummary = async (req, res, next) => {
  try {
    const { range: dateRange, cutoverWarning } = await rangeWithCutover(req);
    const biz = req.businessId;

    const [salesLines, purchaseLines, cashSales] = await Promise.all([
      prisma.invoiceLine.findMany({
        where: {
          invoice: {
            businessId: biz,                        // ← fixed
            invoiceDate: dateRange,
            status: { not: 'VOID' },
          },
        },
        include: { invoice: { select: { invoiceNo: true, invoiceDate: true, customer: { select: { name: true, tin: true } } } } },
      }),
      prisma.billLine.findMany({
        where: {
          bill: {
            businessId: biz,                        // ← fixed
            billDate: dateRange,
            status: { not: 'VOID' },
          },
        },
        include: { bill: { select: { billNo: true, billDate: true, vendor: { select: { name: true, tin: true } } } } },
      }),
      prisma.cashSale.findMany({
        where: { businessId: biz, saleDate: dateRange, status: 'ACTIVE' },
      }),
    ]);

    // Cash sales have no line-items table and no customer relation — synthesize
    // the same shape an invoiceLine+invoice+customer produces, so every
    // downstream filter/reduce/transactions-building step below treats a cash
    // sale exactly like an invoice line with no code changes needed there.
    const cashSaleLines = cashSales.map((c) => ({
      amount: Number(c.subtotal),
      vatCode: c.vatCode,
      invoice: {
        invoiceNo: c.saleNo,
        invoiceDate: c.saleDate,
        customer: { name: c.buyerName || 'Walk-in', tin: null },
      },
    }));
    salesLines.push(...cashSaleLines);

    const vatableSalesLines  = salesLines.filter((l) => l.vatCode === 'VAT');
    const zeroRatedLines     = salesLines.filter((l) => l.vatCode === 'ZERO');
    const exemptSalesLines   = salesLines.filter((l) => l.vatCode === 'EXEMPT');

    const vatableSales   = vatableSalesLines.reduce((s, l)  => s + Number(l.amount), 0);
    const outputVat      = vatableSales * 0.12;
    const zeroRatedSales = zeroRatedLines.reduce((s, l)     => s + Number(l.amount), 0);
    const exemptSales    = exemptSalesLines.reduce((s, l)   => s + Number(l.amount), 0);
    const totalSalesNet  = vatableSales + zeroRatedSales + exemptSales;

    const vatablePurchLines  = purchaseLines.filter((l) => l.vatCode === 'VAT');
    const vatablePurchases   = vatablePurchLines.reduce((s, l) => s + Number(l.amount), 0);
    const inputVat           = vatablePurchases * 0.12;

    const transactions = salesLines.slice(0, 50).map((l) => ({
      type: 'SALES',
      name: l.invoice.customer.name,
      tin: l.invoice.customer.tin,
      invoiceNo: l.invoice.invoiceNo,
      invoiceDate: l.invoice.invoiceDate,
      amount: Number(l.amount),
      vatCode: l.vatCode,
      vatAmount: l.vatCode === 'VAT' ? Number(l.amount) * 0.12 : 0,
    })).concat(purchaseLines.slice(0, 50).map((l) => ({
      type: 'PURCHASES',
      name: l.bill.vendor.name,
      tin: l.bill.vendor.tin,
      invoiceNo: l.bill.billNo,
      invoiceDate: l.bill.billDate,
      amount: Number(l.amount),
      vatCode: l.vatCode,
      vatAmount: l.vatCode === 'VAT' ? Number(l.amount) * 0.12 : 0,
    })));

    res.json({
      period: dateRange,
      cutoverWarning,
      outputVat, inputVat,
      vatableSales, zeroRatedSales, exemptSales, totalSalesNet,
      vatablePurchases, priorExcessInput: 0,
      transactions,
    });
  } catch (err) { next(err); }
};

// ─── EWT Summary (Form 1601-EQ) ────────────────────────────
exports.ewtSummary = async (req, res, next) => {
  try {
    const { range: dateRange, cutoverWarning } = await rangeWithCutover(req);
    const biz = req.businessId;

    const bills = await prisma.bill.findMany({
      where: { businessId: biz, billDate: dateRange, status: { not: 'VOID' } },
      include: { vendor: true },
    });

    const totalVendors = await prisma.vendor.count({ where: { businessId: biz, isActive: true } }); // ← fixed

    const vendorMap = {};
    for (const b of bills) {
      const vid = b.vendorId;
      if (!vendorMap[vid]) {
        vendorMap[vid] = {
          id: b.vendor.id,
          vendorName: b.vendor.name,
          vendorCode: b.vendor.vendorCode,
          tin: b.vendor.tin,
          atcCode: 'WC200',
          totalPayments: 0, vatableAmount: 0, vatComponent: 0, ewtAmount: 0,
          bills: [],
        };
      }
      const gross   = Number(b.totalAmount);
      const vat     = Number(b.vatAmount);
      const net     = Number(b.subtotal);
      const subject = net > 10000;
      const ewt     = subject ? net * 0.02 : 0;

      vendorMap[vid].totalPayments  += gross;
      vendorMap[vid].vatableAmount  += net;
      vendorMap[vid].vatComponent   += vat;
      vendorMap[vid].ewtAmount      += ewt;
      vendorMap[vid].bills.push({ billNo: b.billNo, billDate: b.billDate, gross, net, ewtRate: subject ? 0.02 : 0, ewtAmount: ewt });
    }

    const vendors           = Object.values(vendorMap);
    const ewtVendors        = vendors.filter((v) => v.ewtAmount > 0);
    const totalPayments     = vendors.reduce((s, v) => s + v.totalPayments, 0);
    const vatableAmount     = vendors.reduce((s, v) => s + v.vatableAmount, 0);
    const totalVatComponent = vendors.reduce((s, v) => s + v.vatComponent, 0);
    const totalEwt          = vendors.reduce((s, v) => s + v.ewtAmount, 0);

    res.json({ period: dateRange, cutoverWarning, vendorCount: ewtVendors.length, totalVendors, totalPayments, vatableAmount, totalVatComponent, totalEwt, vendors });
  } catch (err) { next(err); }
};

// ─── Compensation Withholding Summary (Form 1601-C) ────────
exports.withholdingSummary = async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const y   = Number(year || new Date().getFullYear());
    const m   = Number(month || new Date().getMonth() + 1);
    const biz = req.businessId;

    const items = await prisma.payrollItem.findMany({
      where: {
        period: {
          businessId: biz,                          // ← fixed
          startDate: { gte: new Date(y, m - 1, 1) },
          endDate:   { lte: new Date(y, m, 0, 23, 59, 59) },
          status: { in: ['APPROVED', 'PAID'] },
        },
      },
      include: {
        employee: { select: { firstName: true, lastName: true, tin: true, position: true } },
        period:   { select: { id: true, periodName: true, startDate: true, endDate: true, payDate: true, status: true } },
      },
    });

    const totalCompensation = items.reduce((s, i) => s + Number(i.grossPay), 0);
    const totalTaxWithheld  = items.reduce((s, i) => s + Number(i.withholdingTax), 0);
    const totalNetPay       = items.reduce((s, i) => s + Number(i.netPay), 0);
    const totalSss          = items.reduce((s, i) => s + Number(i.sssEmployee), 0);
    const totalPhilhealth   = items.reduce((s, i) => s + Number(i.philhealthEe), 0);
    const totalPagibig      = items.reduce((s, i) => s + Number(i.pagibigEe), 0);
    const totalNonTaxable   = totalSss + totalPhilhealth + totalPagibig;
    const totalTaxable      = Math.max(0, totalCompensation - totalNonTaxable);

    const periodMap = {};
    for (const i of items) {
      const pid = i.period.id;
      if (!periodMap[pid]) periodMap[pid] = { ...i.period, employees: [] };
      periodMap[pid].employees.push({
        name: `${i.employee.lastName}, ${i.employee.firstName}`,
        tin: i.employee.tin,
        position: i.employee.position,
        grossPay: Number(i.grossPay),
        withholdingTax: Number(i.withholdingTax),
        netPay: Number(i.netPay),
      });
    }

    const employeeCount = new Set(items.map((i) => i.employeeId)).size;

    res.json({
      period: { month: m, year: y },
      employeeCount, totalCompensation, totalTaxWithheld, totalNetPay,
      totalNonTaxable, totalTaxable, totalSss, totalPhilhealth, totalPagibig,
      periods: Object.values(periodMap),
    });
  } catch (err) { next(err); }
};

// ─── RELIEF Export ─────────────────────────────────────────
exports.reliefExport = async (req, res, next) => {
  try {
    const { range: dateRange, cutoverWarning } = await rangeWithCutover(req);
    const biz = req.businessId;

    const [bills, invoices, cashSales] = await Promise.all([
      prisma.bill.findMany({
        where: { businessId: biz, billDate: dateRange, status: { not: 'VOID' } }, // ← fixed
        include: { vendor: true },
      }),
      prisma.invoice.findMany({
        where: { businessId: biz, invoiceDate: dateRange, status: { not: 'VOID' } }, // ← fixed
        include: { customer: true },
      }),
      prisma.cashSale.findMany({
        where: { businessId: biz, saleDate: dateRange, status: 'ACTIVE' },
      }),
    ]);

    const purchases = bills.map((b) => ({
      tin: b.vendor.tin || '',
      name: b.vendor.name,
      invoiceDate: b.billDate,
      invoiceNo: b.billNo,
      vatablePurchases: Number(b.subtotal),
      inputTax: Number(b.vatAmount),
    }));

    const sales = invoices.map((i) => ({
      tin: i.customer.tin || '',
      name: i.customer.name,
      invoiceDate: i.invoiceDate,
      invoiceNo: i.invoiceNo,
      vatableSales: Number(i.subtotal),
      outputTax: Number(i.vatAmount),
    }));

    // Cash sales have no customer/TIN — tin: '' is correct (matches this
    // export's own "Missing TIN" convention for any transaction where the buyer
    // TIN is genuinely unknown, same as a real walk-in sale).
    const cashSaleRows = cashSales.map((c) => ({
      tin: '',
      name: c.buyerName || 'Walk-in',
      invoiceDate: c.saleDate,
      invoiceNo: c.saleNo,
      vatableSales: Number(c.subtotal),
      outputTax: Number(c.vatAmount),
    }));
    sales.push(...cashSaleRows);

    res.json({
      period: dateRange,
      cutoverWarning,
      purchases,
      sales,
      summary: {
        totalVatablePurchases: purchases.reduce((s, p) => s + p.vatablePurchases, 0),
        totalInputTax:         purchases.reduce((s, p) => s + p.inputTax, 0),
        totalVatableSales:     sales.reduce((s, p) => s + p.vatableSales, 0),
        totalOutputTax:        sales.reduce((s, p) => s + p.outputTax, 0),
      },
    });
  } catch (err) { next(err); }
};

// ─── Alphalist ─────────────────────────────────────────────
exports.alphalist = async (req, res, next) => {
  try {
    const year = Number(req.query.year || new Date().getFullYear());
    const biz  = req.businessId;

    const items = await prisma.payrollItem.findMany({
      where: {
        period: {
          businessId: biz,                          // ← fixed
          startDate: { gte: new Date(year, 0, 1) },
          endDate:   { lte: new Date(year, 11, 31, 23, 59, 59) },
          status: { in: ['APPROVED', 'PAID'] },
        },
      },
      include: { employee: true },
    });

    const byEmployee = {};
    for (const i of items) {
      const eid = i.employeeId;
      if (!byEmployee[eid]) {
        byEmployee[eid] = {
          emp: i.employee,
          grossPay: 0, basicPay: 0, allowances: 0, overtimePay: 0,
          sssEmployee: 0, philhealthEe: 0, pagibigEe: 0,
          withholdingTax: 0, netPay: 0, periodCount: 0,
        };
      }
      byEmployee[eid].grossPay       += Number(i.grossPay);
      byEmployee[eid].basicPay       += Number(i.basicPay);
      byEmployee[eid].allowances     += Number(i.allowances);
      byEmployee[eid].overtimePay    += Number(i.overtimePay);
      byEmployee[eid].sssEmployee    += Number(i.sssEmployee);
      byEmployee[eid].philhealthEe   += Number(i.philhealthEe);
      byEmployee[eid].pagibigEe      += Number(i.pagibigEe);
      byEmployee[eid].withholdingTax += Number(i.withholdingTax);
      byEmployee[eid].netPay         += Number(i.netPay);
      byEmployee[eid].periodCount    += 1;
    }

    const list = Object.values(byEmployee).map((e) => {
      const totalDeductions = e.sssEmployee + e.philhealthEe + e.pagibigEe + e.withholdingTax;
      return {
        id: e.emp.id, employeeNo: e.emp.employeeNo,
        firstName: e.emp.firstName, lastName: e.emp.lastName, middleName: e.emp.middleName,
        tin: e.emp.tin, sssNo: e.emp.sssNo, philhealthNo: e.emp.philhealthNo, pagibigNo: e.emp.pagibigNo,
        position: e.emp.position, department: e.emp.department,
        basicSalary: Number(e.emp.basicSalary),
        allowances: e.allowances, overtime: e.overtimePay,
        month13: Number(e.emp.basicSalary) / 12,
        grossCompensation: e.grossPay,
        sssContributions: e.sssEmployee,
        philhealthContributions: e.philhealthEe,
        pagibigContributions: e.pagibigEe,
        totalDeductions,
        taxableCompensation: Math.max(0, e.grossPay - (e.sssEmployee + e.philhealthEe + e.pagibigEe)),
        totalTaxWithheld: e.withholdingTax,
        netPay: e.netPay,
        periodCount: e.periodCount,
      };
    }).sort((a, b) => a.lastName.localeCompare(b.lastName));

    res.json({ year, employees: list, count: list.length });
  } catch (err) { next(err); }
};
