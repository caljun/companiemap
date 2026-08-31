import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '企業星図 — Global Company Atlas',
  description: '世界の企業規模と勢力図を、地図上で直感的に探索。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
