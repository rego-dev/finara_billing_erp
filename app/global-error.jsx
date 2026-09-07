'use client';
import { useEffect } from 'react';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('[global error]', error);
  }, [error]);

  return (
    <html>
      <body style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#111827' }}>Something went wrong</h1>
          <p style={{ fontSize: '0.875rem', color: '#9ca3af', marginTop: '0.25rem' }}>
            Please refresh the page. If the problem continues, contact support.
          </p>
          <button
            onClick={reset}
            style={{ marginTop: '1rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', background: '#2563eb', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
