'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { auth as authApi } from '@/lib/api';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await authApi.forgotPassword({ email });
      setSent(true);
      if (data.devResetToken) setDevToken(data.devResetToken);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #1d4ed8 100%)' }}>
      <div className="w-full max-w-md rounded-2xl bg-white p-8" style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.4)' }}>
        {!sent ? (
          <>
            <h1 className="text-xl font-black text-gray-900">Forgot your password?</h1>
            <p className="text-sm text-gray-500 mt-1 mb-6">
              Enter your email and we'll send you a link to reset your password.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="form-group">
                <label className="label text-xs font-semibold uppercase tracking-wide text-gray-500">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="email" required autoComplete="email" className="input pl-10"
                    placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3">
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </>
        ) : (
          <div className="text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h1 className="text-xl font-black text-gray-900">Check your email</h1>
            <p className="text-sm text-gray-500 mt-2">
              If an account exists for <strong>{email}</strong>, a password reset link has been sent.
            </p>
            {devToken && (
              <div className="mt-4 text-left bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-800 font-semibold mb-1">Dev mode — no email configured:</p>
                <a href={`/reset-password?token=${devToken}`} className="text-xs text-blue-600 break-all hover:underline">
                  Open reset link →
                </a>
              </div>
            )}
          </div>
        )}
        <a href="/login" className="mt-6 flex items-center justify-center gap-1 text-sm text-blue-600 hover:text-blue-700">
          <ArrowLeft className="w-4 h-4" /> Back to login
        </a>
      </div>
    </div>
  );
}
