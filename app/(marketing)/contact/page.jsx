import { Mail, Clock, MessageSquareText } from 'lucide-react';
import ContactForm from '@/components/marketing/ContactForm';
import { Reveal } from '@/components/marketing/Reveal';

export const metadata = {
  title: 'Contact Us',
  description: 'Request a demo or ask us anything about Finara.',
};

// Editable marketing copy — update the email/hours to your real contact details.
const INFO = [
  { icon: Mail, title: 'Email us', text: 'sales@finara.ph' },
  { icon: Clock, title: 'Response time', text: 'Within one business day' },
  { icon: MessageSquareText, title: 'What happens next', text: 'A short call, then a guided demo with your own use cases.' },
];

export default function ContactPage() {
  return (
    <section className="bg-gradient-to-b from-blue-50/80 to-white min-h-full">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-20">
        <Reveal className="text-center max-w-2xl mx-auto">
          <p className="text-xs font-bold tracking-widest uppercase text-brand mb-3">Contact Us</p>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-gray-900">
            Let&apos;s get your books in order
          </h1>
          <p className="mt-4 text-gray-500 text-base sm:text-lg">
            Tell us about your business — we&apos;ll show you exactly how Finara fits.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
          <Reveal className="lg:col-span-3">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_16px_40px_-12px_rgba(0,56,168,0.12)] p-6 sm:p-8">
              <ContactForm />
            </div>
          </Reveal>
          <Reveal delay={0.15} className="lg:col-span-2 space-y-4">
            {INFO.map((i) => (
              <div key={i.title} className="flex items-start gap-4 bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-brand flex items-center justify-center flex-shrink-0">
                  <i.icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">{i.title}</h3>
                  <p className="mt-0.5 text-sm text-gray-500">{i.text}</p>
                </div>
              </div>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
