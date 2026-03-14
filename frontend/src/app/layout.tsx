// app/layout.tsx

import type { Metadata } from 'next';
import { Cairo } from 'next/font/google';
import '@/app/globals.css';
import { ProgressProvider } from '@/context/ProgressContext';
import LayoutSwitcher from '@/components/LayoutSwitcher';
import DevLogFilter from '@/app/dev-log-filter';

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['400', '700', '900'],
  variable: '--font-cairo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Nexus Academy | BTEC Platform',
  description: 'Future of Education',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} h-full`}>
      <body className="font-cairo bg-midnight text-white min-h-screen antialiased">
        <DevLogFilter />
        <ProgressProvider>
          <LayoutSwitcher>{children}</LayoutSwitcher>
        </ProgressProvider>
      </body>
    </html>
  );
}
