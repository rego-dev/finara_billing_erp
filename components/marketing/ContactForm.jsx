'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Send, CheckCircle2 } from 'lucide-react';
import { leads } from '@/lib/api';

const PLAN_LABELS = {
  starter: 'Starter plan',
  professional: 'Professional plan',
  enterprise: 'Enterprise plan',
};

function ContactFormInner() {
  const searchParams = useSearchParams();
  const [form, setForm] = useState({ name: '', company: '', email: '', phone: '', message: '' });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  // Pre-fill the message when arriving from a pricing tier CTA.
  useEffect(() => {
    const plan = PLAN_LABELS[searchParams.get('plan')];
    if (plan) {
      setForm((f) => (f.message ? f : { ...f, message: `Hi! I'm interested in the ${plan}. ` }));
    }
  }, [searchParams]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const plan = searchParams.get('plan');
      await leads.submit({ ...form, source: plan ? `pricing:${plan}` : 'contact' });
      setSent(true);
      toast.success('Message sent! We will get back to you shortly.');
    } catch (err) {
      const details = err.response?.data?.details;
      toast.error(
        details ? Object.values(details)[0] : err.response?.data?.error || 'Something went wrong. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-gray-900">Thank you!</h3>
        <p className="mt-2 text-sm text-gray-500 max-w-sm mx-auto">
          Your message is in. We&apos;ll reach out within one business day to schedule your demo.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Full Name *</label>
          <input className="input" required maxLength={100} value={form.name} onChange={set('name')} placeholder="Juan Dela Cruz" />
        </div>
        <div>
          <label className="label">Company</label>
          <input className="input" maxLength={150} value={form.company} onChange={set('company')} placeholder="ABC Trading Corp." />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Email Address *</label>
          <input className="input" type="email" required maxLength={150} value={form.email} onChange={set('email')} placeholder="you@company.com" />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" maxLength={30} value={form.phone} onChange={set('phone')} placeholder="0917 123 4567" />
        </div>
      </div>
      <div>
        <label className="label">How can we help? *</label>
        <textarea
          className="input min-h-[120px] resize-y"
          required
          maxLength={2000}
          value={form.message}
          onChange={set('message')}
          placeholder="Tell us about your business and what you're looking for…"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl text-base font-bold text-white bg-brand hover:bg-brand-dark disabled:bg-blue-300 shadow-[0_6px_18px_rgba(0,56,168,0.35)] hover:-translate-y-0.5 transition-all"
      >
        {loading ? 'Sending…' : (<>Send Message <Send className="w-4 h-4" /></>)}
      </button>
    </form>
  );
}

export default function ContactForm() {
  return (
    <Suspense fallback={null}>
      <ContactFormInner />
    </Suspense>
  );
}
