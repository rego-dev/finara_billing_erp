import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Reveal } from './Reveal';

export default function CTABanner() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
      <Reveal>
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-brand-dark px-6 sm:px-12 py-12 sm:py-16 text-center">
          <div className="pointer-events-none absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-white/5 blur-2xl" />
          <h2 className="relative text-2xl sm:text-4xl font-black text-white tracking-tight">
            Ready to see Finara in action?
          </h2>
          <p className="relative mt-3 text-blue-200 max-w-lg mx-auto text-sm sm:text-base">
            Tell us about your business and we&apos;ll walk you through the system with your
            own use cases.
          </p>
          <Link
            href="/contact"
            className="relative mt-8 inline-flex items-center gap-2 px-8 py-4 rounded-xl text-base font-bold text-brand bg-white hover:bg-blue-50 shadow-lg hover:-translate-y-0.5 transition-all"
          >
            Request a Demo <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
