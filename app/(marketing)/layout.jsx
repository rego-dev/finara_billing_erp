import Navbar from '@/components/marketing/Navbar';
import Footer from '@/components/marketing/Footer';

export const metadata = {
  title: {
    default: 'Finara — Philippine-Compliant Accounting & ERP',
    template: '%s | Finara',
  },
  description:
    'Finara is an all-in-one accounting and ERP system built for Philippine businesses — general ledger, payables, receivables, payroll with SSS/PhilHealth/Pag-IBIG, and BIR compliance.',
};

export default function MarketingLayout({ children }) {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
