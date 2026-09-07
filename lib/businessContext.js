'use client';
/**
 * BusinessContext — Multi-business support for Finara ERP
 *
 * Provides:
 *   useBusiness() → { businesses, activeBusiness, activeBusinessId, setActive, loading }
 *
 * The active businessId is persisted in localStorage ('activeBusinessId') and
 * injected into every API call via the Axios request interceptor in lib/api.js.
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const BusinessContext = createContext(null);

const STORAGE_KEY = 'activeBusinessId';

export function BusinessProvider({ children }) {
  const [businesses, setBusinesses]   = useState([]);
  const [activeId,   setActiveId]     = useState(null);
  const [loading,    setLoading]       = useState(true);

  // Load businesses from API + restore last active selection from localStorage
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Dynamic import avoids circular dep (api.js imports nothing from here)
        const { businesses: bizApi } = await import('./api');
        const { data } = await bizApi.list();

        if (cancelled || !data?.length) return;

        setBusinesses(data);

        const stored = Number(localStorage.getItem(STORAGE_KEY));
        const valid  = stored && data.find((b) => b.id === stored);
        const chosen = valid ? stored : data[0].id;

        setActiveId(chosen);
        localStorage.setItem(STORAGE_KEY, chosen);

        // Also update the global getter so api.js interceptor picks it up
        _setGlobalActiveId(chosen);
      } catch (err) {
        console.warn('[BusinessContext] Failed to load businesses:', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const setActive = useCallback((id) => {
    const numId = Number(id);
    setActiveId(numId);
    localStorage.setItem(STORAGE_KEY, numId);
    _setGlobalActiveId(numId);
    // Reload the page so all queries re-run with the new businessId header
    window.location.reload();
  }, []);

  const activeBusiness = businesses.find((b) => b.id === activeId) || null;

  return (
    <BusinessContext.Provider value={{ businesses, activeBusiness, activeBusinessId: activeId, setActive, loading }}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness() {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error('useBusiness must be used within <BusinessProvider>');
  return ctx;
}

// ── Global activeId accessor used by the Axios interceptor ───────
// This lives outside React state so api.js (not a component) can read it.
let _activeId = null;

export function getActiveBusinessId() {
  if (_activeId) return _activeId;
  if (typeof window !== 'undefined') {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (stored) { _activeId = stored; }
  }
  return _activeId;
}

function _setGlobalActiveId(id) {
  _activeId = id;
}

// ── Books cutover ────────────────────────────────────────────────
/**
 * True when a document predates the business's books start date, meaning it is
 * recorded for history only and never posted to the general ledger.
 *
 * Mirrors the server-side guard in server/utils/glPost.js — compare
 * 'YYYY-MM-DD' strings, never Date objects, so timezones cannot shift the day.
 */
export function isPreCutover(docDate, booksStartDate) {
  if (!docDate || !booksStartDate) return false;
  return String(docDate).slice(0, 10) < String(booksStartDate).slice(0, 10);
}
