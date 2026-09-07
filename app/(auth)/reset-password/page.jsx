'use client';
import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { auth as authApi } from '@/lib/api';
import { Lock, Eye, EyeOff, CheckCircle, ArrowLeft } from 'lucide-react';

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') || '';
  const [form, setForm] = useState({ newPassword: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const strong = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(form.newPassword);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) { toast.error('Missing reset token'); return; }
    if (!strong) { toast.error('Password must be 8+ chars with upper, lower, and a number'); return; }
    if (form.newPassword !== form.confirm) { toast.error('Passwords do not match'); return; }
    setLoading(true);
    try {
      await authApi.resetPassword({ token, newPassword: form.newPassword });
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="text-center">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
        <h1 className="text-xl font-black text-gray-900">Password reset!</h1>
        <p className="text-sm text-gray-500 mt-2">Redirecting you to login…</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-xl font-black text-gray-900">Set a new password</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">Choose a strong password for your account.</p>
      {!token && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
          No reset token found in the link. Request a new reset email.
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="form-group">
          <label className="label text-xs font-semibold uppercase tracking-wide text-gray-500">New Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type={showPw ? 'text' : 'password'} required className="input pl-10 pr-10"
              placeholder="••••••••" value={form.newPassword}
              onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} />
            <button type="button" onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {form.newPassword && !strong && (
            <p className="text-xs text-amber-600 mt-1">Must be 8+ chars with uppercase, lowercase, and a number.</p>
          )}
        </div>
        <div className="form-group">
          <label className="label text-xs font-semibold uppercase tracking-wide text-gray-500">Confirm Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type={showPw ? 'text' : 'password'} required className="input pl-10"
              placeholder="••••••••" value={form.confirm}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} />
          </div>
        </div>
        <button type="submit" disabled={loading || !token} className="btn-primary w-full justify-center py-3">
          {loading ? 'Resetting…' : 'Reset password'}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #1d4ed8 100%)' }}>
      <div className="w-full max-w-md rounded-2xl bg-white p-8" style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.4)' }}>
        <Suspense fallback={<p className="text-center text-gray-400">Loading…</p>}>
          <ResetForm />
        </Suspense>
        <a href="/login" className="mt-6 flex items-center justify-center gap-1 text-sm text-blue-600 hover:text-blue-700">
          <ArrowLeft className="w-4 h-4" /> Back to login
        </a>
      </div>
    </div>
  );
}
