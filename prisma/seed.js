const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Finara ERP database...');

  // ─── Admin User ────────────────────────────────────────────
  const hashedPw = await bcrypt.hash('Admin@123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@ph-erp.com' },
    update: {},
    create: {
      email: 'admin@ph-erp.com',
      password: hashedPw,
      firstName: 'System',
      lastName: 'Administrator',
      role: 'ADMIN',
    },
  });
  console.log(`✅ Admin user: ${admin.email} / Admin@123`);

  // ─── Chart of Accounts ─────────────────────────────────────
  // Advertising & Retail Business — PFRS-aligned
  // parentCode references accountCode of the header account
  const accounts = [

    // ══════════════════════════════════════════════════════════
    // ASSETS  (1000 – 1999)
    // ══════════════════════════════════════════════════════════
    { accountCode:'1000', accountName:'Current Assets',                      accountType:'ASSET',     normalBalance:'DEBIT'  },

    // Cash & Cash Equivalents
    { accountCode:'1010', accountName:'Cash on Hand',                        accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },
    { accountCode:'1011', accountName:'Petty Cash Fund',                     accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },
    { accountCode:'1012', accountName:'Cash — GCash',                        accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },
    { accountCode:'1020', accountName:'Cash in Bank — BDO Checking',         accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },
    { accountCode:'1021', accountName:'Cash in Bank — BDO Savings',          accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },
    { accountCode:'1022', accountName:'Cash in Bank — BPI Checking',         accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },
    { accountCode:'1023', accountName:'Cash in Bank — Metrobank',            accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },
    { accountCode:'1024', accountName:'Cash in Bank — UnionBank (GCash)',    accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },

    // Receivables
    { accountCode:'1100', accountName:'Accounts Receivable — Trade',         accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },
    { accountCode:'1101', accountName:'Allowance for Doubtful Accounts',     accountType:'ASSET',     normalBalance:'CREDIT', parentCode:'1000' },
    { accountCode:'1102', accountName:'Advances to Clients',                 accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },
    { accountCode:'1103', accountName:'Notes Receivable',                    accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },
    { accountCode:'1104', accountName:'Advances to Officers & Employees',    accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },
    { accountCode:'1105', accountName:'Dividends Receivable',                accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },

    // Inventories
    { accountCode:'1200', accountName:'Inventories',                         accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },
    { accountCode:'1210', accountName:'Merchandise Inventory — Retail',      accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1200' },
    { accountCode:'1220', accountName:'Advertising Materials Inventory',     accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1200' },
    { accountCode:'1230', accountName:'Production Supplies Inventory',       accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1200' },
    { accountCode:'1240', accountName:'Office Supplies Inventory',           accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1200' },
    { accountCode:'1250', accountName:'Goods in Transit',                    accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1200' },

    // Prepaid & Other Current
    { accountCode:'1300', accountName:'Prepaid Expenses',                    accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1000' },
    { accountCode:'1310', accountName:'Prepaid Rent',                        accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1300' },
    { accountCode:'1320', accountName:'Prepaid Insurance',                   accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1300' },
    { accountCode:'1330', accountName:'Input VAT',                           accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1300' },
    { accountCode:'1340', accountName:'Creditable Withholding Tax (CWT)',    accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1300' },
    { accountCode:'1350', accountName:'Prepaid Income Tax',                  accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1300' },
    { accountCode:'1360', accountName:'Other Prepaid Expenses',              accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1300' },

    // Non-Current Assets
    { accountCode:'1500', accountName:'Non-Current Assets',                  accountType:'ASSET',     normalBalance:'DEBIT'  },

    // Property, Plant & Equipment
    { accountCode:'1510', accountName:'Property, Plant & Equipment',         accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1500' },
    { accountCode:'1511', accountName:'Land',                                accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1510' },
    { accountCode:'1512', accountName:'Building',                            accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1510' },
    { accountCode:'1513', accountName:'Office Furniture & Fixtures',         accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1510' },
    { accountCode:'1514', accountName:'Computer Equipment & Peripherals',    accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1510' },
    { accountCode:'1515', accountName:'Production & Studio Equipment',       accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1510' },
    { accountCode:'1516', accountName:'Transportation Equipment',            accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1510' },
    { accountCode:'1517', accountName:'Leasehold Improvements',              accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1510' },
    { accountCode:'1518', accountName:'Display & Retail Fixtures',           accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1510' },

    // Accumulated Depreciation (contra-asset)
    { accountCode:'1520', accountName:'Accumulated Depreciation',            accountType:'ASSET',     normalBalance:'CREDIT', parentCode:'1500' },
    { accountCode:'1521', accountName:'Accum Depr — Building',               accountType:'ASSET',     normalBalance:'CREDIT', parentCode:'1520' },
    { accountCode:'1522', accountName:'Accum Depr — Office Furniture',       accountType:'ASSET',     normalBalance:'CREDIT', parentCode:'1520' },
    { accountCode:'1523', accountName:'Accum Depr — Computer Equipment',     accountType:'ASSET',     normalBalance:'CREDIT', parentCode:'1520' },
    { accountCode:'1524', accountName:'Accum Depr — Production Equipment',   accountType:'ASSET',     normalBalance:'CREDIT', parentCode:'1520' },
    { accountCode:'1525', accountName:'Accum Depr — Transportation',         accountType:'ASSET',     normalBalance:'CREDIT', parentCode:'1520' },
    { accountCode:'1526', accountName:'Accum Depr — Leasehold Improvements', accountType:'ASSET',     normalBalance:'CREDIT', parentCode:'1520' },
    { accountCode:'1527', accountName:'Accum Depr — Display Fixtures',       accountType:'ASSET',     normalBalance:'CREDIT', parentCode:'1520' },

    // Intangibles & Other Non-Current
    { accountCode:'1530', accountName:'Intangible Assets',                   accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1500' },
    { accountCode:'1531', accountName:'Software & Licenses',                 accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1530' },
    { accountCode:'1532', accountName:'Brand Assets & Trademarks',           accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1530' },
    { accountCode:'1533', accountName:'Website Development Costs',           accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1530' },
    { accountCode:'1534', accountName:'Accum Amortization — Intangibles',    accountType:'ASSET',     normalBalance:'CREDIT', parentCode:'1530' },
    { accountCode:'1540', accountName:'Security Deposits',                   accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1500' },
    { accountCode:'1550', accountName:'Long-term Investments',               accountType:'ASSET',     normalBalance:'DEBIT',  parentCode:'1500' },

    // ══════════════════════════════════════════════════════════
    // LIABILITIES  (2000 – 2999)
    // ══════════════════════════════════════════════════════════
    { accountCode:'2000', accountName:'Current Liabilities',                 accountType:'LIABILITY', normalBalance:'CREDIT' },

    // Payables
    { accountCode:'2010', accountName:'Accounts Payable — Trade',            accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2011', accountName:'Accounts Payable — Media Suppliers',  accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2012', accountName:'Accounts Payable — Production',       accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2015', accountName:'Post-Dated Checks Payable',           accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },

    // Accruals
    { accountCode:'2020', accountName:'Accrued Expenses',                    accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2021', accountName:'Accrued Salaries & Wages',            accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2020' },
    { accountCode:'2022', accountName:'Accrued Rent',                        accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2020' },
    { accountCode:'2023', accountName:'Accrued Utilities',                   accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2020' },
    { accountCode:'2024', accountName:'Accrued Professional Fees',           accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2020' },

    // Tax Payables
    { accountCode:'2030', accountName:'Output VAT Payable',                  accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2040', accountName:'Withholding Tax — Compensation (1601-C)', accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2041', accountName:'Withholding Tax — Expanded (1601-EQ)',accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2042', accountName:'Withholding Tax — Final',             accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },

    // Government Contributions
    { accountCode:'2050', accountName:'SSS Contributions Payable',           accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2060', accountName:'PhilHealth Contributions Payable',    accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2070', accountName:'Pag-IBIG Contributions Payable',      accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2080', accountName:'Income Tax Payable',                  accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },

    // Other Current
    { accountCode:'2090', accountName:'Customer Deposits & Advances',        accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2091', accountName:'Deferred Revenue — Retainers',        accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2100', accountName:'Short-term Notes Payable',            accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2110', accountName:'Current Portion — Long-term Debt',    accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },

    // Non-Current Liabilities
    { accountCode:'2500', accountName:'Non-Current Liabilities',             accountType:'LIABILITY', normalBalance:'CREDIT' },
    { accountCode:'2510', accountName:'Loans Payable — Long Term',           accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2500' },
    { accountCode:'2520', accountName:'Finance Lease Obligations',           accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2500' },
    { accountCode:'2530', accountName:'Retirement Benefit Obligation',       accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2500' },

    // ══════════════════════════════════════════════════════════
    // EQUITY  (3000 – 3999)
    // ══════════════════════════════════════════════════════════
    { accountCode:'3000', accountName:'Equity',                              accountType:'EQUITY',    normalBalance:'CREDIT' },
    { accountCode:'3010', accountName:"Share Capital / Owner's Capital",     accountType:'EQUITY',    normalBalance:'CREDIT', parentCode:'3000' },
    { accountCode:'3020', accountName:'Additional Paid-in Capital',          accountType:'EQUITY',    normalBalance:'CREDIT', parentCode:'3000' },
    { accountCode:'3030', accountName:'Retained Earnings',                   accountType:'EQUITY',    normalBalance:'CREDIT', parentCode:'3000' },
    { accountCode:'3040', accountName:'Current Year Earnings',               accountType:'EQUITY',    normalBalance:'CREDIT', parentCode:'3000' },
    { accountCode:'3050', accountName:"Owner's Drawings",                    accountType:'EQUITY',    normalBalance:'DEBIT',  parentCode:'3000' },
    { accountCode:'3060', accountName:'Treasury Stock',                      accountType:'EQUITY',    normalBalance:'DEBIT',  parentCode:'3000' },
    // Offsets the day-one migration entry. A non-zero balance left here after
    // migration is itself a signal that the opening figures did not reconcile.
    { accountCode:'3070', accountName:'Opening Balance Equity',              accountType:'EQUITY',    normalBalance:'CREDIT', parentCode:'3000' },

    // ══════════════════════════════════════════════════════════
    // REVENUE  (4000 – 4999)
    // ══════════════════════════════════════════════════════════
    { accountCode:'4000', accountName:'Revenue',                             accountType:'REVENUE',   normalBalance:'CREDIT' },

    // Advertising Services Revenue
    { accountCode:'4100', accountName:'Advertising Services Revenue',        accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4000' },
    { accountCode:'4110', accountName:'Creative Services',                   accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4120', accountName:'Media Planning & Buying',             accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4130', accountName:'Digital Marketing Services',          accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4131', accountName:'Social Media Management',             accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4132', accountName:'SEO / SEM Services',                  accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4133', accountName:'Email Marketing',                     accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4140', accountName:'Print & Publication Advertising',     accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4150', accountName:'Outdoor / Billboard Advertising',     accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4160', accountName:'Events & Activations',                accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4170', accountName:'Production Services',                 accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4171', accountName:'Video Production',                    accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4172', accountName:'Photography Services',                accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4173', accountName:'Graphic Design',                      accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4180', accountName:'Strategy & Brand Consultancy',        accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },
    { accountCode:'4190', accountName:'Agency Retainer Fees',                accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4100' },

    // Retail Sales Revenue
    { accountCode:'4200', accountName:'Retail Sales Revenue',                accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4000' },
    { accountCode:'4210', accountName:'Merchandise Sales — Walk-in',         accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4200' },
    { accountCode:'4220', accountName:'Online / E-commerce Sales',           accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4200' },
    { accountCode:'4230', accountName:'Wholesale / Trade Sales',             accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4200' },
    { accountCode:'4240', accountName:'Sales Discounts',                     accountType:'REVENUE',   normalBalance:'DEBIT',  parentCode:'4200' },
    { accountCode:'4250', accountName:'Sales Returns & Allowances',          accountType:'REVENUE',   normalBalance:'DEBIT',  parentCode:'4200' },

    // Other Income
    { accountCode:'4300', accountName:'Other Income',                        accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4000' },
    { accountCode:'4310', accountName:'Interest Income',                     accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4300' },
    { accountCode:'4320', accountName:'Rental Income',                       accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4300' },
    { accountCode:'4330', accountName:'Gain on Sale of Assets',              accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4300' },
    { accountCode:'4340', accountName:'Foreign Exchange Gain',               accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4300' },
    { accountCode:'4350', accountName:'Miscellaneous Income',                accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4300' },

    // ══════════════════════════════════════════════════════════
    // COST OF SALES  (5000 – 5999)
    // ══════════════════════════════════════════════════════════
    { accountCode:'5000', accountName:'Cost of Sales',                       accountType:'EXPENSE',   normalBalance:'DEBIT'  },

    // Retail COGS
    { accountCode:'5010', accountName:'Cost of Goods Sold — Retail',         accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'5000' },
    { accountCode:'5011', accountName:'Merchandise Purchase Cost',           accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'5010' },
    { accountCode:'5012', accountName:'Freight-in / Landed Cost',            accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'5010' },
    { accountCode:'5013', accountName:'Purchase Discounts',                  accountType:'EXPENSE',   normalBalance:'CREDIT', parentCode:'5010' },
    { accountCode:'5014', accountName:'Purchase Returns & Allowances',       accountType:'EXPENSE',   normalBalance:'CREDIT', parentCode:'5010' },

    // Advertising / Production Direct Costs
    { accountCode:'5020', accountName:'Direct Advertising Production Costs', accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'5000' },
    { accountCode:'5021', accountName:'Advertising Materials Cost',          accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'5020' },
    { accountCode:'5022', accountName:'Media Placement Costs',               accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'5020' },
    { accountCode:'5023', accountName:'Direct Labor — Production',           accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'5020' },
    { accountCode:'5024', accountName:'Subcontractor & Freelance Costs',     accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'5020' },
    { accountCode:'5025', accountName:'Talent & Modeling Fees',              accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'5020' },
    { accountCode:'5026', accountName:'Production Equipment Rental',         accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'5020' },
    { accountCode:'5027', accountName:'Studio Rental',                       accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'5020' },
    { accountCode:'5028', accountName:'Photography & Videography',           accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'5020' },
    { accountCode:'5029', accountName:'Printing & Reproduction Costs',       accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'5020' },

    // ══════════════════════════════════════════════════════════
    // OPERATING EXPENSES  (6000 – 6999)
    // ══════════════════════════════════════════════════════════
    { accountCode:'6000', accountName:'Operating Expenses',                  accountType:'EXPENSE',   normalBalance:'DEBIT'  },

    // Personnel Costs
    { accountCode:'6100', accountName:'Personnel Costs',                     accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6000' },
    { accountCode:'6110', accountName:'Salaries and Wages',                  accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6111', accountName:'Overtime Pay',                        accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6112', accountName:'Holiday Pay',                         accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6113', accountName:'Night Differential Pay',              accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6120', accountName:'SSS — Employer Share',                accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6130', accountName:'PhilHealth — Employer Share',         accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6140', accountName:'Pag-IBIG — Employer Share',           accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6150', accountName:'13th Month Pay',                      accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6151', accountName:'Performance Bonus',                   accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6160', accountName:'Employee Benefits & Allowances',      accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6161', accountName:'Rice Allowance',                      accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6162', accountName:'Medical & HMO Benefits',              accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6163', accountName:'Transportation Allowance',            accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6170', accountName:'Recruitment & Training Costs',        accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },
    { accountCode:'6180', accountName:'Retirement Benefit Expense',          accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6100' },

    // Occupancy Costs
    { accountCode:'6200', accountName:'Occupancy Costs',                     accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6000' },
    { accountCode:'6210', accountName:'Rent Expense',                        accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6200' },
    { accountCode:'6220', accountName:'Electricity Expense',                 accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6200' },
    { accountCode:'6230', accountName:'Water & Sewerage Expense',            accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6200' },
    { accountCode:'6240', accountName:'Building Repairs & Maintenance',      accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6200' },
    { accountCode:'6250', accountName:'Janitorial & Security Services',      accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6200' },

    // Administrative Expenses
    { accountCode:'6300', accountName:'Administrative Expenses',             accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6000' },
    { accountCode:'6310', accountName:'Internet & Telecommunications',       accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6300' },
    { accountCode:'6311', accountName:'Mobile & Data Plans',                 accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6300' },
    { accountCode:'6320', accountName:'Office Supplies Expense',             accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6300' },
    { accountCode:'6330', accountName:'Postage & Delivery Expense',          accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6300' },
    { accountCode:'6340', accountName:'Depreciation Expense',                accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6300' },
    { accountCode:'6341', accountName:'Amortization Expense',                accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6300' },
    { accountCode:'6350', accountName:'Insurance Expense',                   accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6300' },
    { accountCode:'6360', accountName:'Bank Charges & Service Fees',         accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6300' },
    { accountCode:'6370', accountName:'Licenses, Permits & Registration',    accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6300' },
    { accountCode:'6380', accountName:'Subscriptions & Memberships',         accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6300' },
    { accountCode:'6390', accountName:'Miscellaneous Expense',               accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6300' },

    // Professional & Legal
    { accountCode:'6400', accountName:'Professional & Legal Fees',           accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6000' },
    { accountCode:'6410', accountName:'Audit & Accounting Fees',             accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6400' },
    { accountCode:'6420', accountName:'Legal Fees',                          accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6400' },
    { accountCode:'6430', accountName:'Management Consultancy Fees',         accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6400' },
    { accountCode:'6440', accountName:'IT & Technical Services',             accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6400' },

    // Sales & Marketing
    { accountCode:'6500', accountName:'Sales & Marketing Expenses',          accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6000' },
    { accountCode:'6510', accountName:'Representation & Entertainment',      accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6500' },
    { accountCode:'6520', accountName:'Transportation & Travel',             accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6500' },
    { accountCode:'6521', accountName:'Airfare & Accommodation',             accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6500' },
    { accountCode:'6530', accountName:'Marketing & Promotions (Internal)',    accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6500' },
    { accountCode:'6531', accountName:'Social Media Advertising Spend',      accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6500' },
    { accountCode:'6532', accountName:'Trade Show & Exhibit Costs',          accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6500' },
    { accountCode:'6540', accountName:'Sales Commissions Expense',           accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6500' },
    { accountCode:'6550', accountName:'Bad Debts Expense',                   accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6500' },

    // Finance Costs
    { accountCode:'6600', accountName:'Finance Costs',                       accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6000' },
    { accountCode:'6610', accountName:'Interest Expense',                    accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6600' },
    { accountCode:'6620', accountName:'Foreign Exchange Loss',               accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6600' },
    { accountCode:'6630', accountName:'Loss on Sale of Assets',              accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6600' },

    // Income Tax
    { accountCode:'6900', accountName:'Income Tax Expense',                  accountType:'EXPENSE',   normalBalance:'DEBIT'  },
    { accountCode:'6910', accountName:'Current Tax Expense',                 accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6900' },
    { accountCode:'6920', accountName:'Deferred Tax Expense',                accountType:'EXPENSE',   normalBalance:'DEBIT',  parentCode:'6900' },
  ];

  // Build code → id map; must be done in order so parent exists before child
  const codeMap = {};
  let created = 0, skipped = 0;
  for (const acct of accounts) {
    const parentId = acct.parentCode ? codeMap[acct.parentCode] : null;
    const result = await prisma.account.upsert({
      where:  { businessId_accountCode: { businessId: 1, accountCode: acct.accountCode } },
      update: { accountName: acct.accountName, accountType: acct.accountType, normalBalance: acct.normalBalance, parentId },
      create: {
        businessId:    1,
        accountCode:   acct.accountCode,
        accountName:   acct.accountName,
        accountType:   acct.accountType,
        normalBalance: acct.normalBalance,
        parentId,
      },
    });
    codeMap[acct.accountCode] = result.id;
    if (result.createdAt.getTime() === result.updatedAt?.getTime?.() ?? true) created++;
    else skipped++;
  }
  console.log(`✅ ${accounts.length} accounts seeded (${created} new)`);

  // ─── Sample Vendor ─────────────────────────────────────────
  await prisma.vendor.upsert({
    where:  { businessId_vendorCode: { businessId: 1, vendorCode: 'VEN-001' } },
    update: {},
    create: {
      businessId: 1, vendorCode: 'VEN-001', name: 'ABC Office Supplies Inc.',
      tin: '123-456-789-000', address: 'Makati City, Metro Manila',
      contactName: 'Juan Cruz', email: 'abc@supplier.com', phone: '02-1234-5678',
    },
  });
  await prisma.vendor.upsert({
    where:  { businessId_vendorCode: { businessId: 1, vendorCode: 'VEN-002' } },
    update: {},
    create: {
      businessId: 1, vendorCode: 'VEN-002', name: 'MediaMax Philippines Corp.',
      tin: '234-567-890-000', address: 'Ortigas Center, Pasig City',
      contactName: 'Maria Reyes', email: 'media@mediamax.com.ph', phone: '02-8765-4321',
    },
  });

  // ─── Sample Customer ───────────────────────────────────────
  await prisma.customer.upsert({
    where:  { businessId_customerCode: { businessId: 1, customerCode: 'CUS-001' } },
    update: {},
    create: {
      businessId: 1, customerCode: 'CUS-001', name: 'XYZ Corporation',
      tin: '987-654-321-000', address: 'BGC, Taguig, Metro Manila',
      contactName: 'Maria Santos', email: 'xyz@client.com', phone: '02-9876-5432',
    },
  });
  await prisma.customer.upsert({
    where:  { businessId_customerCode: { businessId: 1, customerCode: 'CUS-002' } },
    update: {},
    create: {
      businessId: 1, customerCode: 'CUS-002', name: 'Sunrise Retail Group Inc.',
      tin: '876-543-210-000', address: 'Alabang, Muntinlupa City',
      contactName: 'Jose Mendoza', email: 'jose@sunrise.com', phone: '02-8888-1234',
    },
  });

  // ─── Sample Employee ───────────────────────────────────────
  await prisma.employee.upsert({
    where:  { businessId_employeeNo: { businessId: 1, employeeNo: 'EMP-001' } },
    update: {},
    create: {
      businessId: 1, employeeNo: 'EMP-001', firstName: 'Juan', lastName: 'dela Cruz', middleName: 'B.',
      position: 'Accountant', department: 'Finance & Accounting',
      tin: '111-222-333-000', sssNo: '33-1234567-8',
      philhealthNo: '01-234567890-1', pagibigNo: '1234-5678-9012',
      hireDate: new Date('2022-01-15'),
      employmentType: 'REGULAR', payFrequency: 'SEMI_MONTHLY', basicSalary: 35000,
    },
  });
  await prisma.employee.upsert({
    where:  { businessId_employeeNo: { businessId: 1, employeeNo: 'EMP-002' } },
    update: {},
    create: {
      businessId: 1, employeeNo: 'EMP-002', firstName: 'Anna', lastName: 'Reyes', middleName: 'C.',
      position: 'Creative Director', department: 'Creative',
      tin: '222-333-444-000', sssNo: '33-9876543-2',
      philhealthNo: '01-987654321-0', pagibigNo: '9876-5432-1098',
      hireDate: new Date('2021-06-01'),
      employmentType: 'REGULAR', payFrequency: 'SEMI_MONTHLY', basicSalary: 55000,
    },
  });

  // ─── Inventory Categories ──────────────────────────────────
  const invCats = [
    { name: 'Retail Products',          type: 'PRODUCT',  description: 'Merchandise for direct retail sale' },
    { name: 'Advertising Materials',    type: 'MATERIAL', description: 'Printed ads, banners, collaterals, flyers' },
    { name: 'Production Supplies',      type: 'SUPPLY',   description: 'Raw materials and consumables used in production' },
    { name: 'Office Supplies',          type: 'SUPPLY',   description: 'General office consumables' },
    { name: 'Promotional Assets',       type: 'ASSET',    description: 'Display units, booth equipment, demo assets' },
    { name: 'Digital Assets',           type: 'ASSET',    description: 'Licensed digital media, stock footage, templates' },
  ];
  for (const cat of invCats) {
    const exists = await prisma.inventoryCategory.findFirst({ where: { name: cat.name } });
    if (!exists) await prisma.inventoryCategory.create({ data: cat });
  }
  console.log(`✅ ${invCats.length} inventory categories seeded`);

  console.log('\n🎉 Database seeded successfully!');
  console.log('📋 Login: admin@ph-erp.com / Admin@123');
  console.log(`📊 Chart of Accounts: ${accounts.length} accounts`);
  console.log('📦 Inventory: 6 categories ready');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
