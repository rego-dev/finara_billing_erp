'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export default function TopLoader() {
  const pathname = usePathname();
  const [phase, setPhase]   = useState('idle');   // idle | running | done
  const [width, setWidth]   = useState(0);
  const r = useRef({ interval: null, t1: null, t2: null, mounted: false });

  const start = () => {
    clearInterval(r.current.interval);
    clearTimeout(r.current.t1);
    clearTimeout(r.current.t2);
    setPhase('running');
    setWidth(12);
    r.current.interval = setInterval(() => {
      setWidth((w) => {
        if (w >= 82) { clearInterval(r.current.interval); return 82; }
        return w + Math.random() * 7 + 2;
      });
    }, 280);
  };

  const finish = () => {
    clearInterval(r.current.interval);
    setWidth(100);
    setPhase('done');
    r.current.t1 = setTimeout(() => setPhase('idle'), 380);
    r.current.t2 = setTimeout(() => setWidth(0), 700);
  };

  // Detect internal link clicks → start bar
  useEffect(() => {
    const onClick = (e) => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || /^(https?:|#|mailto:|tel:)/.test(href) || a.target === '_blank') return;
      start();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Pathname change → finish bar
  useEffect(() => {
    if (!r.current.mounted) { r.current.mounted = true; return; }
    finish();
  }, [pathname]);

  useEffect(() => () => {
    clearInterval(r.current.interval);
    clearTimeout(r.current.t1);
    clearTimeout(r.current.t2);
  }, []);

  if (phase === 'idle' && width === 0) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 9999,
        height: '3px',
        width: `${width}%`,
        background: 'linear-gradient(90deg, #3b82f6 0%, #818cf8 60%, #a78bfa 100%)',
        boxShadow: '0 0 10px rgba(99,102,241,0.55)',
        borderRadius: '0 3px 3px 0',
        pointerEvents: 'none',
        transition:
          phase === 'done'
            ? 'width 140ms ease, opacity 380ms ease 140ms'
            : 'width 300ms ease',
        opacity: phase === 'idle' ? 0 : 1,
      }}
    />
  );
}
