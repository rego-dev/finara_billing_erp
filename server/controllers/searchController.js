const prisma = require('../config/database');

const PER_GROUP = 6;

/**
 * Global search across the main entities. Returns grouped, link-ready results.
 * GET /api/search?q=term
 */
exports.search = async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ query: q, groups: [] });

    const like = { contains: q };
    const biz  = req.businessId;

    const [accounts, journal, vendors, customers, bills, invoices, employees, pos, assets] = await Promise.all([
      prisma.account.findMany({
        where: { businessId: biz, OR: [{ accountCode: like }, { accountName: like }] },
        take: PER_GROUP, select: { id: true, accountCode: true, accountName: true },
      }),
      prisma.journalEntry.findMany({
        where: { businessId: biz, OR: [{ entryNo: like }, { description: like }, { reference: like }] },
        take: PER_GROUP, orderBy: { id: 'desc' }, select: { id: true, entryNo: true, description: true },
      }),
      prisma.vendor.findMany({
        where: { businessId: biz, OR: [{ vendorCode: like }, { name: like }, { tin: like }] },
        take: PER_GROUP, select: { id: true, vendorCode: true, name: true },
      }),
      prisma.customer.findMany({
        where: { businessId: biz, OR: [{ customerCode: like }, { name: like }, { tin: like }] },
        take: PER_GROUP, select: { id: true, customerCode: true, name: true },
      }),
      prisma.bill.findMany({
        where: { businessId: biz, OR: [{ billNo: like }, { description: like }] },
        take: PER_GROUP, orderBy: { id: 'desc' }, select: { id: true, billNo: true, vendor: { select: { name: true } } },
      }),
      prisma.invoice.findMany({
        where: { businessId: biz, OR: [{ invoiceNo: like }, { description: like }] },
        take: PER_GROUP, orderBy: { id: 'desc' }, select: { id: true, invoiceNo: true, customer: { select: { name: true } } },
      }),
      prisma.employee.findMany({
        where: { businessId: biz, OR: [{ employeeNo: like }, { firstName: like }, { lastName: like }] },
        take: PER_GROUP, select: { id: true, employeeNo: true, firstName: true, lastName: true },
      }),
      prisma.purchaseOrder.findMany({
        where: { businessId: biz, OR: [{ poNumber: like }, { notes: like }] },
        take: PER_GROUP, orderBy: { id: 'desc' }, select: { id: true, poNumber: true, vendor: { select: { name: true } } },
      }),
      prisma.fixedAsset.findMany({
        where: { businessId: biz, OR: [{ assetCode: like }, { name: like }, { category: like }] },
        take: PER_GROUP, select: { id: true, assetCode: true, name: true },
      }),
    ]);

    const groups = [];
    const add = (label, items) => { if (items.length) groups.push({ label, items }); };

    add('Chart of Accounts', accounts.map((a) => ({ id: a.id, label: a.accountName, sub: a.accountCode, href: '/accounts' })));
    add('Journal Entries',   journal.map((j) => ({ id: j.id, label: j.entryNo, sub: j.description, href: '/journal' })));
    add('Vendors',           vendors.map((v) => ({ id: v.id, label: v.name, sub: v.vendorCode, href: '/payable/vendors' })));
    add('Customers',         customers.map((c) => ({ id: c.id, label: c.name, sub: c.customerCode, href: '/receivable/customers' })));
    add('Bills',             bills.map((b) => ({ id: b.id, label: b.billNo, sub: b.vendor?.name, href: '/payable' })));
    add('Invoices',          invoices.map((i) => ({ id: i.id, label: i.invoiceNo, sub: i.customer?.name, href: '/receivable' })));
    add('Employees',         employees.map((e) => ({ id: e.id, label: `${e.firstName} ${e.lastName}`, sub: e.employeeNo, href: '/payroll/employees' })));
    add('Purchase Orders',   pos.map((p) => ({ id: p.id, label: p.poNumber, sub: p.vendor?.name, href: '/purchase-orders' })));
    add('Fixed Assets',      assets.map((a) => ({ id: a.id, label: a.name, sub: a.assetCode, href: '/assets' })));

    res.json({ query: q, groups });
  } catch (err) { next(err); }
};
