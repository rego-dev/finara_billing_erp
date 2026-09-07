'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { settings as settingsApi, auth as authApi } from '@/lib/api';
import { clearSession } from '@/lib/auth';
import { getSessionPhase, formatCountdown, WARNING_MS } from '@/lib/sessionTimeout';
import { setPendingRedirect, setIdleLogoutFlag } from '@/lib/postLoginRedirect';

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
const ACTIVITY_THROTTLE_MS = 5000;
const CHECK_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MINUTES = 480;

export default function SessionTimeoutGuard() {
  const pathname = usePathname();
  const [timeoutMinutes, setTimeoutMinutes] = useState(null);
  const [phase, setPhase] = useState('active');
  const [remainingMs, setRemainingMs] = useState(WARNING_MS);
  const lastWriteRef = useRef(0);
  const loggedOutRef = useRef(false);

  useEffect(() => {
    settingsApi.getAll()
      .then(({ data }) => setTimeoutMinutes(Number(data.sessionTimeout) || DEFAULT_TIMEOUT_MINUTES))
      .catch(() => setTimeoutMinutes(DEFAULT_TIMEOUT_MINUTES));
  }, []);

  const recordActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastWriteRef.current < ACTIVITY_THROTTLE_MS) return;
    lastWriteRef.current = now;
    try { window.localStorage.setItem('lastActivity', String(now)); } catch {}
  }, []);

  const doLogout = useCallback(() => {
    if (loggedOutRef.current) return;
    loggedOutRef.current = true;
    try {
      setPendingRedirect(window.localStorage, pathname);
      setIdleLogoutFlag(window.localStorage);
    } catch {}
    clearSession();
    authApi.logout().catch(() => {});
    window.location.href = '/login';
  }, [pathname]);

  useEffect(() => {
    if (timeoutMinutes == null) return undefined;

    try {
      if (!window.localStorage.getItem('lastActivity')) {
        window.localStorage.setItem('lastActivity', String(Date.now()));
      }
    } catch {}

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, recordActivity, { passive: true }));

    const interval = setInterval(() => {
      let lastActivity;
      try { lastActivity = Number(window.localStorage.getItem('lastActivity')) || Date.now(); }
      catch { lastActivity = Date.now(); }
      const now = Date.now();
      const nextPhase = getSessionPhase({ lastActivity, now, timeoutMinutes });
      setPhase(nextPhase);
      if (nextPhase === 'warning') {
        setRemainingMs(Math.max(0, timeoutMinutes * 60000 - (now - lastActivity)));
      }
      if (nextPhase === 'expired') doLogout();
    }, CHECK_INTERVAL_MS);

    const onStorage = (e) => {
      if (e.key === 'accessToken' && e.newValue === null) {
        window.location.href = '/login';
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, recordActivity));
      clearInterval(interval);
      window.removeEventListener('storage', onStorage);
    };
  }, [timeoutMinutes, recordActivity, doLogout]);

  const stayLoggedIn = () => {
    try { window.localStorage.setItem('lastActivity', String(Date.now())); } catch {}
    lastWriteRef.current = Date.now();
    setPhase('active');
  };

  if (phase !== 'warning') return null;

  return (
    <div className="modal-overlay">
      <div className="modal max-w-sm">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">Session Expiring</h3>
        </div>
        <div className="modal-body">
          <p className="text-sm text-gray-600">
            You&apos;ve been inactive for a while. For your security, you&apos;ll be logged out in{' '}
            <span className="font-mono font-semibold">{formatCountdown(remainingMs)}</span>.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-primary" onClick={stayLoggedIn}>Stay Logged In</button>
        </div>
      </div>
    </div>
  );
}
