import { ShieldCheck } from 'lucide-react';
import { Reveal, Stagger, StaggerItem } from './Reveal';

const BADGES = [
  'BIR VAT (2550)', 'Expanded Withholding Tax', 'Alphalist', 'RELIEF',
  'SSS', 'PhilHealth', 'Pag-IBIG', 'TRAIN Law Payroll', 'PFRS for SMEs',
];

export default function ComplianceStrip() {
  return (
    <section className="bg-brand">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 text-center">
        <Reveal>
          <ShieldCheck className="w-10 h-10 text-blue-200 mx-auto mb-4" />
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Compliance is built in, not bolted on
          </h2>
          <p className="mt-3 text-blue-200 max-w-xl mx-auto text-sm sm:text-base">
            Statutory tables and BIR report formats ship with the system and stay current —
            no spreadsheets, no manual lookups.
          </p>
        </Reveal>
        <Stagger className="mt-8 flex flex-wrap justify-center gap-2.5">
          {BADGES.map((b) => (
            <StaggerItem key={b}>
              <span className="inline-block px-4 py-2 rounded-full text-xs font-semibold text-white bg-white/10 border border-white/20 backdrop-blur-sm">
                {b}
              </span>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
