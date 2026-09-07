'use client';
import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default function DashboardError({ error, reset }) {
  useEffect(() => {
    console.error('[dashboard error]', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
        <AlertTriangle className="w-7 h-7 text-red-500" />
      </div>
      <div>
        <p className="font-semibold text-gray-900 text-lg">Something went wrong loading this page</p>
        <p className="text-sm text-gray-400 mt-1">
          Please try again. If the problem continues, contact support.
        </p>
      </div>
      <div className="flex gap-3 mt-2">
        <button onClick={reset} className="btn-primary">
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
        <a href="/" className="btn-secondary">
          <Home className="w-4 h-4" /> Dashboard
        </a>
      </div>
    </div>
  );
}
