import Link from 'next/link';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { Reveal } from './Reveal';
import BrowserFrame from './BrowserFrame';

export default function ModuleShowcase({
  title,
  kicker,
  description,
  bullets = [],
  image,
  alt,
  reverse = false,
}) {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
      <div
        className={`grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center ${
          reverse ? 'lg:[&>*:first-child]:order-2' : ''
        }`}
      >
        <Reveal>
          <p className="text-xs font-bold tracking-widest uppercase text-brand mb-3">{kicker}</p>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">{title}</h2>
          <p className="mt-4 text-gray-500 leading-relaxed">{description}</p>
          <ul className="mt-6 space-y-3">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-gray-700">
                <CheckCircle2 className="w-5 h-5 text-brand flex-shrink-0 mt-0.5" />
                {b}
              </li>
            ))}
          </ul>
          <Link
            href="/contact"
            className="mt-7 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:gap-2.5 transition-all"
          >
            See it in action <ArrowRight className="w-4 h-4" />
          </Link>
        </Reveal>
        <div>
          <BrowserFrame src={image} alt={alt} />
        </div>
      </div>
    </section>
  );
}
