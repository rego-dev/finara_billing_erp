import Hero from '@/components/marketing/Hero';
import ModuleShowcase from '@/components/marketing/ModuleShowcase';
import FeatureGrid from '@/components/marketing/FeatureGrid';
import ComplianceStrip from '@/components/marketing/ComplianceStrip';
import StatsRow from '@/components/marketing/StatsRow';
import CTABanner from '@/components/marketing/CTABanner';

export const metadata = {
  title: 'Finara — Philippine-Compliant Accounting & ERP',
  description:
    'General ledger, payables, receivables, payroll with SSS/PhilHealth/Pag-IBIG, and BIR compliance — one system built for Philippine businesses.',
  openGraph: {
    title: 'Finara — Philippine-Compliant Accounting & ERP',
    description: 'One system for your books, payroll, and BIR compliance.',
    images: ['/marketing/screenshots/dashboard.png'],
  },
};

export default function HomePage() {
  return (
    <>
      <Hero />

      <ModuleShowcase
        kicker="General Ledger"
        title="Double-entry that balances itself"
        description="Post journal entries with a draft → posted → voided workflow on top of a 52-account, PFRS-aligned chart of accounts. Your trial balance is always in balance — by construction."
        bullets={[
          'PFRS-aligned chart of accounts out of the box',
          'Draft, post, and void workflow with full audit trail',
          'Recurring entries for month-end routines',
        ]}
        image="/marketing/screenshots/journal.png"
        alt="Finara General Ledger"
      />

      <ModuleShowcase
        reverse
        kicker="Payroll"
        title="TRAIN Law payroll in minutes"
        description="Run payroll periods with SSS, PhilHealth, Pag-IBIG, and BIR withholding computed automatically from built-in statutory tables — no manual lookups."
        bullets={[
          'SSS, PhilHealth & Pag-IBIG contribution tables built in',
          'BIR TRAIN Law withholding tax computation',
          'Payslips, payroll periods, and remittance summaries',
        ]}
        image="/marketing/screenshots/payroll.png"
        alt="Finara Payroll"
      />

      <ModuleShowcase
        kicker="BIR Compliance"
        title="BIR reports without the spreadsheet gymnastics"
        description="Generate the reports your accountant files every month and quarter — straight from your posted books."
        bullets={[
          'VAT summary and returns support (2550)',
          'Expanded withholding tax (EWT) tracking',
          'Alphalist and RELIEF exports',
        ]}
        image="/marketing/screenshots/bir.png"
        alt="Finara BIR Compliance"
      />

      <ModuleShowcase
        reverse
        kicker="Reports"
        title="Financial statements on demand"
        description="Income statement, balance sheet, and trial balance are always up to date — plus a custom report builder when you need a different cut of the numbers."
        bullets={[
          'Income statement & balance sheet in one click',
          'Trial balance with drill-down to entries',
          'Custom report builder for your own formats',
        ]}
        image="/marketing/screenshots/reports.png"
        alt="Finara Financial Reports"
      />

      <FeatureGrid />
      <ComplianceStrip />
      <StatsRow />
      <CTABanner />
    </>
  );
}
