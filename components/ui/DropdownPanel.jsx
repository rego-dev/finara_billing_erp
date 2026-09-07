'use client';
import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Floating panel for comboboxes. Renders into <body> with position:fixed so it
 * is never clipped by an ancestor's `overflow` — the modal body scrolls, which
 * used to cut off dropdowns opened near its edges.
 *
 * Tracks the anchor element: flips above it when there is more room up there,
 * and re-measures on scroll/resize.
 *
 * Props:
 *   anchorRef  – ref to the element the panel should align under
 *   panelRef   – optional ref forwarded to the panel (use it in outside-click
 *                checks, since the panel is no longer a DOM child of the anchor)
 *   minHeight  – don't bother flipping unless the open side is at least this tall
 *   maxHeight  – cap on the panel height (px)
 */
export default function DropdownPanel({
  anchorRef, panelRef, className = '', minHeight = 160, maxHeight = 260, minWidth = 0, children,
}) {
  const [style, setStyle] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useLayoutEffect(() => {
    const place = () => {
      const el = anchorRef?.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 4;
      const below = window.innerHeight - r.bottom - gap - 8;
      const above = r.top - gap - 8;
      const up = below < minHeight && above > below;
      const width = Math.min(Math.max(r.width, minWidth), window.innerWidth - 16);

      setStyle({
        position: 'fixed',
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        width,
        maxHeight: Math.max(120, Math.min(maxHeight, up ? above : below)),
        ...(up
          ? { bottom: window.innerHeight - r.top + gap }
          : { top: r.bottom + gap }),
      });
    };

    place();
    // capture:true so scrolling inside .modal-body (not just the window) repositions
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchorRef, minHeight, maxHeight, minWidth]);

  if (!mounted || !style) return null;

  return createPortal(
    <div ref={panelRef} style={style} className={`z-[400] overflow-auto ${className}`}>
      {children}
    </div>,
    document.body
  );
}
