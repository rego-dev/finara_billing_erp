'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import BrowserFrame from './BrowserFrame';

const EASE = [0.22, 0.68, 0, 1];

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-blue-50/80 via-white to-white">
      {/* soft decorative blobs */}
      <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-blue-100/60 blur-3xl" />
      <div className="pointer-events-none absolute top-40 -left-32 w-80 h-80 rounded-full bg-blue-50 blur-3xl" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 text-center">
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-100/70 text-brand text-xs font-semibold tracking-wide uppercase"
        >
          <CheckCircle2 className="w-3.5 h-3.5" /> Philippine-Compliant ERP
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
          className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-gray-900 leading-[1.08]"
        >
          Accounting software built for
          <span className="text-brand"> Philippine businesses</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: EASE }}
          className="mt-5 max-w-2xl mx-auto text-base sm:text-lg text-gray-500 leading-relaxed"
        >
          Finara brings your general ledger, payables, receivables, payroll, and BIR
          compliance into one system — PFRS-aligned and TRAIN Law ready.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3, ease: EASE }}
          className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-base font-bold text-white bg-brand hover:bg-brand-dark shadow-[0_8px_24px_rgba(0,56,168,0.35)] hover:shadow-[0_12px_32px_rgba(0,56,168,0.45)] hover:-translate-y-0.5 transition-all"
          >
            Request a Demo <ArrowRight className="w-5 h-5" />
          </Link>
          <Link
            href="/features"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-base font-semibold text-gray-700 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all"
          >
            Explore Features
          </Link>
        </motion.div>

        <div className="mt-14 max-w-5xl mx-auto">
          <BrowserFrame src="/marketing/screenshots/dashboard.png" alt="Finara Dashboard" priority />
        </div>
      </div>
    </section>
  );
}
