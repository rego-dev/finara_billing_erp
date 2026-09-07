'use client';
import { useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { saveDraft, loadDraft, clearDraft as removeDraft } from './draftStorage';

export function useDraftGuard(key, form, setForm, { enabled = true } = {}) {
  const restoredRef = useRef(false);
  const initialSnapshotRef = useRef(null);
  if (initialSnapshotRef.current === null) {
    initialSnapshotRef.current = JSON.stringify(form);
  }

  useEffect(() => {
    if (!enabled || restoredRef.current || typeof window === 'undefined') return;
    restoredRef.current = true;
    const draft = loadDraft(window.localStorage, key);
    if (draft && typeof draft === 'object' && !Array.isArray(draft)) {
      setForm((f) => ({ ...f, ...draft }));
      toast('Draft restored from your last session', { icon: '📝' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    if (JSON.stringify(form) === initialSnapshotRef.current) return undefined;
    const t = setTimeout(() => saveDraft(window.localStorage, key, form), 500);
    return () => clearTimeout(t);
  }, [form, enabled, key]);

  const clearDraft = useCallback(() => {
    if (typeof window === 'undefined') return;
    removeDraft(window.localStorage, key);
  }, [key]);

  return { clearDraft };
}
