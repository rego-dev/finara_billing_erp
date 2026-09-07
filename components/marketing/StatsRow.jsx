import { Reveal } from './Reveal';
import CountUp from './CountUp';

const STATS = [
  { to: 20, suffix: '+', label: 'Integrated modules' },
  { to: 52, suffix: '', label: 'PFRS-aligned accounts' },
  { to: 4, suffix: '', label: 'Statutory agencies covered' },
  { to: 10, suffix: '+', label: 'Financial & BIR reports' },
];

export default function StatsRow() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
      <Reveal className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
        {STATS.map((s) => (
          <div key={s.label}>
            <div className="text-4xl sm:text-5xl font-black text-brand tracking-tight">
              <CountUp to={s.to} suffix={s.suffix} />
            </div>
            <p className="mt-2 text-xs sm:text-sm text-gray-500 font-medium">{s.label}</p>
          </div>
        ))}
      </Reveal>
    </section>
  );
}
