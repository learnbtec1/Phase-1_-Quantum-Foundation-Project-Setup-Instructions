import './globals.css';

export const metadata = {
  title: 'Nexus Academy | BTEC Platform',
  description: 'نظام التقييم الذكي',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="icon" href="/logo-hamzeh.svg" type="image/svg+xml" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
