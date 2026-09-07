import PricingSection from '@/components/marketing/PricingSection';
import CTABanner from '@/components/marketing/CTABanner';
import { Reveal } from '@/components/marketing/Reveal';

export const metadata = {
  title: 'Pricing',
  description: 'Simple plans for Philippine businesses of every size.',
};

export default function PricingPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-blue-50/80 to-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-8 text-center">
          <Reveal>
            <p className="text-xs font-bold tracking-widest uppercase text-brand mb-3">Pricing</p>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-gray-900">
              Plans that grow with your business
            </h1>
            <p className="mt-4 max-w-xl mx-auto text-gray-500 text-base sm:text-lg">
              Start with the books, add payroll and compliance when you&apos;re ready. No
              per-transaction fees.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-16">
        <PricingSection />
        <Reveal className="mt-10 text-center">
          <p className="text-xs text-gray-400">
            All prices are in Philippine pesos, VAT-exclusive. Annual billing discounts
            available — ask us.
          </p>
        </Reveal>
      </section>

      <CTABanner />
    </>
  );
}
