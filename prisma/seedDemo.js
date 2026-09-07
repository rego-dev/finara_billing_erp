/**
 * Provisions (and, run again, resets) an isolated "Demo Trading Co." business
 * for client demonstrations — fully separate from the real business data.
 *
 * Usage:
 *   node prisma/seedDemo.js            # interactive confirm before wiping
 *   node prisma/seedDemo.js --yes      # non-interactive (e.g. `railway run`)
 *
 * Safety: the target business is always resolved by its unique `code: 'DEMO'`,
 * never by a numeric id. Before deleting anything, the script refuses to run
 * unless the resolved business is unambiguously the demo business (id is not
 * 1 or 2, and its name contains "Demo"). Only rows scoped to that business id
 * are ever touched — the real businesses are never queried for writes.
 */

const bcrypt = require('bcryptjs');
const readline = require('readline');
const { subDays, addDays } = require('date-fns');
const { cloneChartOfAccounts } = require('../server/utils/cloneChartOfAccounts');

// Reuse the app's shared Prisma singleton rather than opening a second
// connection pool — this file is also required from the running server
// (server/controllers/businessController.js's resetDemo endpoint), where a
// second `new PrismaClient()` per call would leak connections.
const prisma = require('../server/config/database');

const DEMO_CODE  = 'DEMO';
const DEMO_EMAIL = 'demo@finara.local';
const DEMO_PASS  = 'Demo@12345';

function maskDbUrl(url) {
  return (url || '').replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}

function promptConfirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

// ─── Guard: refuse to run against anything that isn't unambiguously the demo business ──
function assertSafeToWipe(biz) {
  if (biz.id === 1 || biz.id === 2) {
    throw new Error(`SAFETY ABORT: resolved "${DEMO_CODE}" business is id ${biz.id}, which is a real business id. Refusing to run.`);
  }
  if (!biz.name || !biz.name.toLowerCase().includes('demo')) {
    throw new Error(`SAFETY ABORT: business name "${biz.name}" does not look like a demo business. Refusing to run.`);
  }
}

// ─── Wipe every businessId-scoped row for the demo business, FK-safe order ──
async function wipeDemoBusiness(businessId) {
  await prisma.$transaction([
    // No cascade from Invoice/Bill to their payments — must go first.
    prisma.paymentAR.deleteMany({ where: { invoice: { businessId } } }),
    prisma.paymentAP.deleteMany({ where: { bill: { businessId } } }),
    // ExpenseVoucher.cashRequestId -> CashRequest has no cascade; none are
    // created by this script, but delete vouchers first regardless.
    prisma.expenseVoucher.deleteMany({ where: { businessId } }),
    // InvoiceLine/BillLine/DailyRemittanceItem cascade from their parent.
    prisma.invoice.deleteMany({ where: { businessId } }),
    prisma.bill.deleteMany({ where: { businessId } }),
    // JournalLine cascades from JournalEntry.
    prisma.journalEntry.deleteMany({ where: { businessId } }),
    prisma.dailyRemittance.deleteMany({ where: { businessId } }),
    prisma.customer.deleteMany({ where: { businessId } }),
    prisma.vendor.deleteMany({ where: { businessId } }),
    prisma.employee.deleteMany({ where: { businessId } }),
    // Only safe once every line item referencing an account (journal, invoice,
    // bill, expense voucher lines, all deleted/cascaded above) is gone.
    prisma.account.deleteMany({ where: { businessId } }),
    prisma.auditLog.deleteMany({ where: { businessId } }),
  ]);
}

// ─── Master data only — customers/vendors/employees to pick from live, ──
// ─── no transactions. This is what the in-app "Reset Demo Data" uses. ──
async function seedMasterData(businessId) {
  const today = new Date();

  // ── Customers ──
  const customers = await Promise.all([
    prisma.customer.create({ data: { businessId, customerCode: 'DEMO-CUS-001', name: 'Golden Harvest Trading', tin: '001-111-111-000', address: 'Cebu City, Philippines', contactName: 'Ana Villanueva', email: 'ana@goldenharvest.example', phone: '032-111-2222' } }),
    prisma.customer.create({ data: { businessId, customerCode: 'DEMO-CUS-002', name: 'Sunburst Retail Corp', tin: '002-222-222-000', address: 'Davao City, Philippines', contactName: 'Mark Fernandez', email: 'mark@sunburstretail.example', phone: '082-222-3333' } }),
    prisma.customer.create({ data: { businessId, customerCode: 'DEMO-CUS-003', name: 'Pacific Coast Distributors', tin: '003-333-333-000', address: 'Iloilo City, Philippines', contactName: 'Liza Gomez', email: 'liza@pacificcoast.example', phone: '033-333-4444' } }),
  ]);

  // ── Vendors ──
  const vendors = await Promise.all([
    prisma.vendor.create({ data: { businessId, vendorCode: 'DEMO-VEN-001', name: 'Metro Office Supplies', tin: '004-444-444-000', address: 'Quezon City, Philippines', contactName: 'Rico Alonzo', email: 'rico@metrooffice.example', phone: '02-4444-5555' } }),
    prisma.vendor.create({ data: { businessId, vendorCode: 'DEMO-VEN-002', name: 'Bayview Print Solutions', tin: '005-555-555-000', address: 'Mandaue City, Philippines', contactName: 'Grace Tan', email: 'grace@bayviewprint.example', phone: '032-555-6666' } }),
    prisma.vendor.create({ data: { businessId, vendorCode: 'DEMO-VEN-003', name: 'Coastal Logistics Inc.', tin: '006-666-666-000', address: 'Lapu-Lapu City, Philippines', contactName: 'Noel Bautista', email: 'noel@coastallogistics.example', phone: '032-666-7777' } }),
  ]);

  // ── Employees ──
  await prisma.employee.create({ data: { businessId, employeeNo: 'DEMO-EMP-001', firstName: 'Juan', lastName: 'Dela Cruz', middleName: 'B.', position: 'Sales Associate', department: 'Sales', tin: '007-777-777-000', sssNo: '00-0000000-0', philhealthNo: '00-000000000-0', pagibigNo: '0000-0000-0000', hireDate: subDays(today, 400), employmentType: 'REGULAR', payFrequency: 'SEMI_MONTHLY', basicSalary: 22000 } });
  await prisma.employee.create({ data: { businessId, employeeNo: 'DEMO-EMP-002', firstName: 'Maria', lastName: 'Santos', middleName: 'R.', position: 'Bookkeeper', department: 'Finance', tin: '008-888-888-000', sssNo: '00-0000001-1', philhealthNo: '00-000000001-1', pagibigNo: '0000-0000-0001', hireDate: subDays(today, 700), employmentType: 'REGULAR', payFrequency: 'SEMI_MONTHLY', basicSalary: 28000 } });

  return { customers, vendors };
}

// ─── Sample transactions (invoices, bills, journal entries, vouchers, ──
// ─── remittance) — layered on top of seedMasterData for a fully-populated ──
// ─── demo. Requires the Chart of Accounts to already be cloned. ──
async function seedTransactions(businessId, demoUserId, { customers, vendors }) {
  const today = new Date();

  const accounts   = await prisma.account.findMany({ where: { businessId } });
  const acct       = Object.fromEntries(accounts.map((a) => [a.accountCode, a.id]));
  const need = (code) => {
    if (!acct[code]) throw new Error(`Demo seed: expected account ${code} to exist after cloning the COA`);
    return acct[code];
  };

  // ── Invoices (spanning OPEN / PARTIAL / PAID / OVERDUE) ──
  const invLine = (amount) => {
    const subtotal = Math.round((amount / 1.12) * 100) / 100;
    const vatAmount = Math.round((amount - subtotal) * 100) / 100;
    return { subtotal, vatAmount, totalAmount: subtotal + vatAmount };
  };

  const invoicesSpec = [
    { no: 'DEMO-INV-0001', customer: customers[0], daysAgo: 20, due: 10, amount: 11200, status: 'PAID',    paid: true  },
    { no: 'DEMO-INV-0002', customer: customers[1], daysAgo: 10, due: 20, amount: 22400, status: 'PARTIAL', paid: 'half' },
    { no: 'DEMO-INV-0003', customer: customers[2], daysAgo: 5,  due: 25, amount: 8960,  status: 'OPEN',    paid: false },
    { no: 'DEMO-INV-0004', customer: customers[0], daysAgo: 45, due: -15, amount: 15680, status: 'OVERDUE', paid: false },
  ];

  let payArSeq = 1;
  for (const spec of invoicesSpec) {
    const { subtotal, vatAmount, totalAmount } = invLine(spec.amount);
    const paidAmount = spec.paid === true ? totalAmount : spec.paid === 'half' ? Math.round((totalAmount / 2) * 100) / 100 : 0;

    const invoice = await prisma.invoice.create({
      data: {
        businessId, invoiceNo: spec.no, customerId: spec.customer.id,
        invoiceDate: subDays(today, spec.daysAgo), dueDate: addDays(subDays(today, spec.daysAgo), spec.due),
        description: 'Sample merchandise sale', subtotal, vatAmount, totalAmount, paidAmount,
        status: spec.status,
        lines: { create: [{ accountId: need('4210'), description: 'Merchandise sold', quantity: 1, unitPrice: subtotal, amount: subtotal, vatCode: 'VAT' }] },
      },
    });

    if (paidAmount > 0) {
      await prisma.paymentAR.create({
        data: {
          paymentNo: `DEMO-PAY-AR-${String(payArSeq++).padStart(4, '0')}`,
          invoiceId: invoice.id,
          paymentDate: addDays(subDays(today, spec.daysAgo), 3),
          amount: paidAmount, paymentMethod: 'Bank Transfer',
        },
      });
    }
  }

  // ── Bills (spanning OPEN / PARTIAL / PAID / OVERDUE) ──
  const billsSpec = [
    { no: 'DEMO-BILL-0001', vendor: vendors[0], daysAgo: 18, due: 12, amount: 5600,  status: 'PAID',    paid: true, acct: '6320' },
    { no: 'DEMO-BILL-0002', vendor: vendors[1], daysAgo: 8,  due: 22, amount: 13440, status: 'PARTIAL', paid: 'half', acct: '5029' },
    { no: 'DEMO-BILL-0003', vendor: vendors[2], daysAgo: 4,  due: 26, amount: 7280,  status: 'OPEN',    paid: false, acct: '6520' },
    { no: 'DEMO-BILL-0004', vendor: vendors[0], daysAgo: 40, due: -10, amount: 3920, status: 'OVERDUE', paid: false, acct: '6320' },
  ];

  let payApSeq = 1;
  for (const spec of billsSpec) {
    const { subtotal, vatAmount, totalAmount } = invLine(spec.amount);
    const paidAmount = spec.paid === true ? totalAmount : spec.paid === 'half' ? Math.round((totalAmount / 2) * 100) / 100 : 0;

    const bill = await prisma.bill.create({
      data: {
        businessId, billNo: spec.no, vendorId: spec.vendor.id,
        billDate: subDays(today, spec.daysAgo), dueDate: addDays(subDays(today, spec.daysAgo), spec.due),
        description: 'Sample vendor bill', subtotal, vatAmount, totalAmount, paidAmount,
        status: spec.status,
        lines: { create: [{ accountId: need(spec.acct), description: 'Goods/services received', quantity: 1, unitPrice: subtotal, amount: subtotal, vatCode: 'VAT' }] },
      },
    });

    if (paidAmount > 0) {
      await prisma.paymentAP.create({
        data: {
          paymentNo: `DEMO-PAY-AP-${String(payApSeq++).padStart(4, '0')}`,
          billId: bill.id,
          paymentDate: addDays(subDays(today, spec.daysAgo), 3),
          amount: paidAmount, paymentMethod: 'Bank Transfer',
        },
      });
    }
  }

  // ── Journal Entries (mix of DRAFT / POSTED) ──
  await prisma.journalEntry.create({
    data: {
      businessId, entryNo: 'DEMO-JE-0001', entryDate: subDays(today, 30),
      description: 'Owner capital contribution — opening cash', status: 'POSTED', createdBy: demoUserId, postedAt: subDays(today, 30),
      lines: {
        create: [
          { accountId: need('1010'), debit: 50000, credit: 0, description: 'Cash contributed', lineOrder: 0 },
          { accountId: need('3010'), debit: 0, credit: 50000, description: 'Owner capital', lineOrder: 1 },
        ],
      },
    },
  });
  await prisma.journalEntry.create({
    data: {
      businessId, entryNo: 'DEMO-JE-0002', entryDate: subDays(today, 15),
      description: 'Monthly rent payment', status: 'POSTED', createdBy: demoUserId, postedAt: subDays(today, 15),
      lines: {
        create: [
          { accountId: need('6210'), debit: 12000, credit: 0, description: 'Rent expense', lineOrder: 0 },
          { accountId: need('1020'), debit: 0, credit: 12000, description: 'Paid from bank', lineOrder: 1 },
        ],
      },
    },
  });
  await prisma.journalEntry.create({
    data: {
      businessId, entryNo: 'DEMO-JE-0003', entryDate: subDays(today, 1),
      description: 'Utilities accrual (pending review)', status: 'DRAFT', createdBy: demoUserId,
      lines: {
        create: [
          { accountId: need('6220'), debit: 3500, credit: 0, description: 'Electricity expense', lineOrder: 0 },
          { accountId: need('2020'), debit: 0, credit: 3500, description: 'Accrued payable', lineOrder: 1 },
        ],
      },
    },
  });

  // ── Expense Vouchers (spanning DRAFT / SUBMITTED / APPROVED / PAID) ──
  const vouchersSpec = [
    { no: 'DEMO-EV-0001', payee: 'Grab', category: 'TRANSPORTATION', purpose: 'Client meeting transport', amount: 450, status: 'DRAFT' },
    { no: 'DEMO-EV-0002', payee: 'Office Warehouse', category: 'OFFICE_SUPPLIES', purpose: 'Printer paper and ink', amount: 1250, status: 'SUBMITTED' },
    { no: 'DEMO-EV-0003', payee: 'Cafe Enroute', category: 'MISCELLANEOUS', purpose: 'Team meeting snacks', amount: 680, status: 'APPROVED' },
    { no: 'DEMO-EV-0004', payee: 'Petron Gas Station', category: 'TRANSPORTATION', purpose: 'Delivery van fuel', amount: 2000, status: 'PAID' },
  ];
  for (const spec of vouchersSpec) {
    await prisma.expenseVoucher.create({
      data: {
        businessId, voucherNo: spec.no, type: 'PETTY_CASH', date: subDays(today, 3),
        payee: spec.payee, category: spec.category, purpose: spec.purpose, totalAmount: spec.amount,
        status: spec.status, requestedBy: 'Demo User',
        approvedBy: ['APPROVED', 'PAID'].includes(spec.status) ? 'Demo User' : null,
        paidDate: spec.status === 'PAID' ? subDays(today, 2) : null,
        paidBy: spec.status === 'PAID' ? 'Demo User' : null,
        paymentAccountCode: spec.status === 'PAID' ? '1011' : null,
      },
    });
  }

  // ── Daily Remittance (a couple of days so the report isn't empty) ──
  await prisma.dailyRemittance.create({
    data: {
      businessId, date: subDays(today, 2),
      totalSales: 11200, cashReceived: 5000, totalExpenses: 2000, cashDisbursed: 2000, netCash: 3000,
      vatCollected: 1200, cashOnHandIn: 5000, cashOnHandOut: 2000, pettyCashIn: 0, pettyCashOut: 680,
      status: 'APPROVED', preparedBy: 'Demo User', approvedBy: 'Demo User',
    },
  });
  await prisma.dailyRemittance.create({
    data: {
      businessId, date: subDays(today, 1),
      totalSales: 8960, cashReceived: 3000, totalExpenses: 450, cashDisbursed: 450, netCash: 2550,
      vatCollected: 960, cashOnHandIn: 3000, cashOnHandOut: 0, pettyCashIn: 0, pettyCashOut: 450,
      status: 'DRAFT', preparedBy: 'Demo User',
    },
  });
}

// ─── Master data + full sample transactions — the original "fully-populated ──
// ─── demo" behaviour, still used by the CLI script's default run. ──
async function seedSampleData(businessId, demoUserId) {
  const { customers, vendors } = await seedMasterData(businessId);
  await seedTransactions(businessId, demoUserId, { customers, vendors });
}

// ─── One-call reset: wipe (if it already exists) then rebuild the demo ──
// ─── business from scratch. Shared by the CLI script and the in-app ──
// ─── "Reset Demo Data" endpoint — this is the single source of truth for ──
// ─── what "reset" means, so the two never drift apart.
//
// withTransactions:false (the app's default) leaves AR/AP empty — customers,
// vendors and employees exist to pick from, but no sample invoices/bills —
// so a live demo starts from a clean slate instead of stale fake history.
async function resetDemoBusiness({ withTransactions = false } = {}) {
  let biz = await prisma.business.findUnique({ where: { code: DEMO_CODE } });

  if (biz) {
    assertSafeToWipe(biz);
    await wipeDemoBusiness(biz.id);
  }

  biz = await prisma.business.upsert({
    where: { code: DEMO_CODE },
    update: {},
    create: {
      code: DEMO_CODE, name: 'Demo Trading Co.',
      tin: '000-000-000-000', address: '123 Sample Street, Demo City, Philippines',
      phone: '000-000-0000', email: 'demo@example.com', industry: 'Retail / Trading (Demo)',
    },
  });

  await cloneChartOfAccounts(1, biz.id);

  const hashedPw = await bcrypt.hash(DEMO_PASS, 12);
  const demoUser = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, password: hashedPw, firstName: 'Demo', lastName: 'User', role: 'MANAGER' },
  });

  await prisma.userBusiness.upsert({
    where: { userId_businessId: { userId: demoUser.id, businessId: biz.id } },
    update: {},
    create: { userId: demoUser.id, businessId: biz.id },
  });

  const { customers, vendors } = await seedMasterData(biz.id);
  if (withTransactions) {
    await seedTransactions(biz.id, demoUser.id, { customers, vendors });
  }

  return { business: biz, demoUser };
}

async function main() {
  const autoYes = process.argv.includes('--yes');

  let biz = await prisma.business.findUnique({ where: { code: DEMO_CODE } });

  console.log('='.repeat(64));
  console.log('DEMO ACCOUNT SEED / RESET');
  console.log('Target DB:  ', maskDbUrl(process.env.DATABASE_URL));
  console.log('Target biz: ', biz ? `#${biz.id} "${biz.name}"` : '(not yet created — first run)');
  console.log('='.repeat(64));

  if (biz) {
    assertSafeToWipe(biz);

    const [invC, billC, jeC, evC, drC, cusC, venC, empC, acctC] = await Promise.all([
      prisma.invoice.count({ where: { businessId: biz.id } }),
      prisma.bill.count({ where: { businessId: biz.id } }),
      prisma.journalEntry.count({ where: { businessId: biz.id } }),
      prisma.expenseVoucher.count({ where: { businessId: biz.id } }),
      prisma.dailyRemittance.count({ where: { businessId: biz.id } }),
      prisma.customer.count({ where: { businessId: biz.id } }),
      prisma.vendor.count({ where: { businessId: biz.id } }),
      prisma.employee.count({ where: { businessId: biz.id } }),
      prisma.account.count({ where: { businessId: biz.id } }),
    ]);
    console.log(`About to WIPE business #${biz.id}: ${invC} invoices, ${billC} bills, ${jeC} journal entries, ${evC} expense vouchers, ${drC} daily remittances, ${cusC} customers, ${venC} vendors, ${empC} employees, ${acctC} accounts.`);
    console.log('This does NOT touch business 1 or 2 — verified by the guard above.');

    if (!autoYes) {
      const answer = await promptConfirm('\nType "RESET DEMO" to continue: ');
      if (answer !== 'RESET DEMO') {
        console.log('Aborted — confirmation phrase did not match. Nothing was deleted.');
        process.exit(1);
      }
    }
  }

  // CLI default is the fully-populated demo (withTransactions: true) — unlike
  // the in-app reset button, which deliberately leaves AR/AP empty.
  const { business, demoUser } = await resetDemoBusiness({ withTransactions: true });
  biz = business;
  console.log('✅ Wiped, Chart of Accounts cloned, demo user provisioned, sample data seeded.');

  console.log('\n🎉 Demo account ready.');
  console.log(`📋 Login:    ${DEMO_EMAIL} / ${DEMO_PASS}`);
  console.log(`🏢 Business: #${biz.id} "${biz.name}"`);
}

if (require.main === module) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}

module.exports = {
  assertSafeToWipe, DEMO_CODE, DEMO_EMAIL,
  wipeDemoBusiness, seedMasterData, seedTransactions, seedSampleData,
  resetDemoBusiness,
};
