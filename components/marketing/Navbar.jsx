'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, ArrowRight } from 'lucide-react';

const LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Features', href: '/features' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Contact', href: '/contact' },
];

export default function Navbar() {
  const pathname = usePathname();
  const [authed, setAuthed] = useState(false);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setAuthed(!!localStorage.getItem('accessToken'));
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-200 ${
        scrolled ? 'bg-white/90 backdrop-blur-md shadow-sm' : 'bg-white'
      }`}
    >
      <nav className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center">
          <img src="/finara-logo.svg" alt="Finara" className="h-8 w-auto" />
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === l.href
                  ? 'text-brand bg-blue-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center gap-3">
          {authed ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-brand hover:bg-brand-dark transition-colors"
            >
              Go to Dashboard <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <>
              <Link href="/login" className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">
                Login
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-brand hover:bg-brand-dark shadow-[0_4px_14px_rgba(0,56,168,0.35)] hover:shadow-[0_6px_20px_rgba(0,56,168,0.45)] hover:-translate-y-px transition-all"
              >
                Request a Demo <ArrowRight className="w-4 h-4" />
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 text-gray-600"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </nav>

      {/* Mobile panel */}
      {open && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 py-3 space-y-1 shadow-lg">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`block px-3 py-2.5 rounded-lg text-sm font-medium ${
                pathname === l.href ? 'text-brand bg-blue-50' : 'text-gray-600'
              }`}
            >
              {l.label}
            </Link>
          ))}
          <div className="pt-2 border-t border-gray-100 flex flex-col gap-2">
            {authed ? (
              <Link href="/dashboard" className="text-center px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-brand">
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-center px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200">
                  Login
                </Link>
                <Link href="/contact" className="text-center px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-brand">
                  Request a Demo
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
