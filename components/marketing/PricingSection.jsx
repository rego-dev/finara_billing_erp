'use client';
import Link from 'next/link';
import { Check, ArrowRight } from 'lucide-react';
import { Stagger, StaggerItem } from './Reveal';

// PLACEHOLDER PRICING — user will edit the amounts below before launch.
const TIERS = [
  {
    key: 'starter',
    name: 'Starter',
    price: '₱1,499',
    per: '/month',
    tagline: 'For small businesses getting their books in order.',
    features: [
      '1 business',
      'Up to 3 users',
      'General Ledger & Chart of Accounts',
      'Accounts Payable & Receivable',
      'Standard financial reports',
    ],
    highlighted: false,
  },
  {
    key: 'professional',
    name: 'Professional',
    price: '₱3,499',
    per: '/month',
    tagline: 'For growing teams that need payroll and compliance.',
    features: [
      'Everything in Starter',
      'Up to 10 users',
      'Payroll with SSS / PhilHealth / Pag-IBIG / TRAIN',
      'BIR compliance (VAT, EWT, Alphalist, RELIEF)',
      'Inventory & Purchase Orders',
      'Priority support',
    ],
    highlighted: true,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    per: '',
    tagline: 'For multi-company operations with custom needs.',
    features: [
      'Everything in Professional',
      'Unlimited users & multi-business',
      'Custom report builder onboarding',
      'Data migration assistance',
      'Dedicated support & training',
    ],
    highlighted: false,
  },
];

export default function PricingSection() {
  return (
    <Stagger className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
      {TIERS.map((t) => (
        <StaggerItem key={t.key} className="h-full">
          <div
            className={`relative h-full flex flex-col rounded-2xl border p-7 transition-all duration-200 hover:-translate-y-1 ${
              t.highlighted
                ? 'border-brand bg-white shadow-[0_20px_50px_-12px_rgba(0,56,168,0.3)] lg:scale-[1.03]'
                : 'border-gray-200 bg-white shadow-sm hover:shadow-md'
            }`}
          >
            {t.highlighted && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand text-white text-[11px] font-bold tracking-wide uppercase">
                Most Popular
              </span>
            )}
            <h3 className="text-lg font-bold text-gray-900">{t.name}</h3>
            <p className="mt-1 text-xs text-gray-500">{t.tagline}</p>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-4xl font-black text-gray-900 tracking-tight">{t.price}</span>
              <span className="text-sm text-gray-400">{t.per}</span>
            </div>
            <ul className="mt-6 space-y-2.5 flex-1">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                  <Check className="w-4 h-4 text-brand flex-shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href={`/contact?plan=${t.key}`}
              className={`mt-7 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all ${
                t.highlighted
                  ? 'text-white bg-brand hover:bg-brand-dark shadow-[0_6px_18px_rgba(0,56,168,0.35)]'
                  : 'text-brand bg-blue-50 hover:bg-blue-100'
              }`}
            >
              {t.key === 'enterprise' ? 'Talk to Us' : 'Get Started'} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
