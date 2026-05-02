import type { Metadata } from "next";
import { DM_Sans, Inter, Noto_Sans_Arabic } from "next/font/google";
import Script from "next/script";
import { Toaster } from "sonner";
import AuthBootstrap from "@/components/AuthBootstrap";
import { OptionalAvatarMount } from "@/components/policy/optional-avatar-mount";
import { AppProviders } from "@/components/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-dm-sans",
  display: "swap",
});

const notoArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-arabic",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "EDUVERS-CORE",
  description: "BTEC assessment and RAG-based similarity — text only.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${dmSans.variable} ${notoArabic.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
        suppressHydrationWarning
      >
        <AppProviders>
          <AuthBootstrap />
          {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ? (
            <>
              <Script
                src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`}
                strategy="afterInteractive"
              />
              <Script id="ga4" strategy="afterInteractive">
                {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}', { send_page_view: true });`}
              </Script>
            </>
          ) : null}
          {children}
          <OptionalAvatarMount />
          <Toaster position="top-right" richColors closeButton />
        </AppProviders>
      </body>
    </html>
  );
}
