'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { auth as authApi } from '@/lib/api';
import { setSession } from '@/lib/auth';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await authApi.register(form);
      setSession(data);
      localStorage.removeItem('activeBusinessId');
      toast.success('Account created! Now set up your company.');
      router.push('/onboarding');
    } catch (err) {
      const errors = err.response?.data?.errors;
      toast.error(errors?.[0]?.msg || err.response?.data?.error || 'Could not create account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #1d4ed8 100%)' }}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        <h1 className="text-xl font-black text-gray-900">Create your Finara account</h1>
        <p className="text-xs text-gray-400 mt-1 mb-6">You&apos;ll set up your company in the next step.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">First name</label>
              <input className="input" required value={form.firstName} onChange={set('firstName')} />
            </div>
            <div>
              <label className="label">Last name</label>
              <input className="input" required value={form.lastName} onChange={set('lastName')} />
            </div>
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" required autoComplete="email" value={form.email} onChange={set('email')} />
          </div>
          <div>
            <label className="label">Password</label>
            <input type="password" className="input" required minLength={8} autoComplete="new-password"
              value={form.password} onChange={set('password')} />
            <p className="text-xs text-gray-400 mt-1">At least 8 characters with uppercase, lowercase, and a number.</p>
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-xs text-gray-500 text-center mt-6">
          Already have an account? <Link href="/login" className="text-blue-600 font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
