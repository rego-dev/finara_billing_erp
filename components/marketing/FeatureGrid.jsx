import {
  FileText, Boxes, ShoppingCart, PiggyBank, Building2, ScrollText, Briefcase,
} from 'lucide-react';
import PesoReceipt from '@/components/icons/PesoReceipt';
import { Reveal, Stagger, StaggerItem } from './Reveal';

const FEATURES = [
  { icon: PesoReceipt,      title: 'Accounts Payable',    text: 'Track vendor bills, due dates, and payments with aging reports.' },
  { icon: FileText,     title: 'Accounts Receivable', text: 'Invoices, quotations, collections, and customer aging at a glance.' },
  { icon: Boxes,        title: 'Inventory',           text: 'Items, stock transactions, and inventory valuation reports.' },
  { icon: ShoppingCart, title: 'Purchase Orders',     text: 'Create POs and convert them straight into vendor bills.' },
  { icon: PiggyBank,    title: 'Budgeting',           text: 'Set budgets per account and monitor actual vs. plan.' },
  { icon: Briefcase,    title: 'Fixed Assets',        text: 'Asset registry with automatic depreciation schedules.' },
  { icon: ScrollText,   title: 'Audit Trail',         text: 'Every change logged — who, what, and when, for full accountability.' },
  { icon: Building2,    title: 'Multi-Business',      text: 'Run multiple companies in one system with separated books.' },
];

export default function FeatureGrid() {
  return (
    <section className="bg-gray-50/70 border-y border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <Reveal className="text-center max-w-2xl mx-auto">
          <p className="text-xs font-bold tracking-widest uppercase text-brand mb-3">Everything included</p>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            One system for the whole back office
          </h2>
          <p className="mt-4 text-gray-500">
            Beyond the core books, Finara covers the day-to-day operations around them.
          </p>
        </Reveal>
        <Stagger className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f) => (
            <StaggerItem key={f.title}>
              <div className="h-full bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-200">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-brand flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-gray-900 text-sm">{f.title}</h3>
                <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">{f.text}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
