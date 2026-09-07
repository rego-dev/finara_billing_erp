'use client';
import { usePathname } from 'next/navigation';

// key={pathname} causes React to unmount + remount the div on every navigation,
// which restarts the CSS stagger animations defined in globals.css.
export default function PageTransition({ children }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-stagger">
      {children}
    </div>
  );
}
