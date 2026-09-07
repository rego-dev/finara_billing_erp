import './globals.css';
import { Toaster } from 'react-hot-toast';
import TopLoader from '@/components/layout/TopLoader';

export const metadata = {
  title: 'PH-ERP Accounting System',
  description: 'Philippine-compliant ERP Accounting System — BIR, SSS, PhilHealth, Pag-IBIG',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply saved theme before paint to avoid a flash of the wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <TopLoader />
        {children}
        <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
      </body>
    </html>
  );
}
