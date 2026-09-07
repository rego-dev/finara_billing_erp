import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-400">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 sm:grid-cols-3 gap-10">
        <div>
          <img src="/finara-logo-white.svg" alt="Finara" className="h-8 w-auto mb-4" />
          <p className="text-sm leading-relaxed max-w-xs">
            Philippine-compliant accounting & ERP — double-entry GL, payroll, and BIR
            compliance in one system.
          </p>
        </div>
        <div>
          <h4 className="text-white text-sm font-semibold mb-3">Product</h4>
          <ul className="space-y-2 text-sm">
            <li><Link href="/features" className="hover:text-white transition-colors">Features</Link></li>
            <li><Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link></li>
            <li><Link href="/login" className="hover:text-white transition-colors">Login</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-white text-sm font-semibold mb-3">Company</h4>
          <ul className="space-y-2 text-sm">
            <li><Link href="/contact" className="hover:text-white transition-colors">Contact Us</Link></li>
            <li><Link href="/contact" className="hover:text-white transition-colors">Request a Demo</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <span>© {new Date().getFullYear()} Finara. All rights reserved.</span>
          <span>BIR · SSS · PhilHealth · Pag-IBIG · PFRS for SMEs · TRAIN Law</span>
        </div>
      </div>
    </footer>
  );
}
