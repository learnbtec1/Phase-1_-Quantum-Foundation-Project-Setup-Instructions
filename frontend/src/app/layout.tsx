// app/layout.tsx

import type { Metadata } from 'next';
import { Cairo } from 'next/font/google';
import '@/app/globals.css';
import { ProgressProvider } from '@/context/ProgressContext';
import LayoutSwitcher from '@/components/LayoutSwitcher';
import DevLogFilter from '@/app/dev-log-filter';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import AuthBootstrap from '@/components/AuthBootstrap';

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['400', '700', '900'],
  variable: '--font-cairo',
  display: 'swap',
});

// 🚀 التعديل الجذري هنا: تم تغيير الاسم نهائياً
export const metadata: Metadata = {
  title: 'إيدوفيرس | كوجني - المعلم الذكي',
  description: 'الجيل القادم من التعليم التفاعلي',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'إيدوفيرس',
    statusBarStyle: 'black-translucent',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} h-full`}>
      <body className="font-sans min-h-screen antialiased cognie dark">
        <div className="cognie-root relative isolate min-h-dvh w-full">
          {/* HTML env backdrop — styles: cognie-html-env-bg + cognie-bg-overlay in globals.css */}
          <div aria-hidden className="cognie-html-env-bg pointer-events-none absolute inset-0 -z-[1]" />
          <div aria-hidden className="cognie-bg-overlay pointer-events-none absolute inset-0 -z-[1]" />
          <ServiceWorkerRegister />
          <AuthBootstrap />
          <DevLogFilter />
          <ProgressProvider>
            <LayoutSwitcher>{children}</LayoutSwitcher>
          </ProgressProvider>
        </div>
      </body>
    </html>
  );
}