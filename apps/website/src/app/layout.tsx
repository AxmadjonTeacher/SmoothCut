import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://smoothcut.app'),
  title: 'SmoothCut — Beautiful screen recordings, instantly',
  description:
    'Record your screen and get auto-zoom, a smooth cursor, and a styled background — free, no account, no watermark. macOS and Windows.',
  openGraph: {
    title: 'SmoothCut — Beautiful screen recordings, instantly',
    description:
      'Record your screen and get auto-zoom, a smooth cursor, and a styled background — free, no account, no watermark.',
    url: 'https://smoothcut.app',
    siteName: 'SmoothCut',
    images: ['/icon.png'],
  },
  twitter: {
    card: 'summary',
    title: 'SmoothCut — Beautiful screen recordings, instantly',
    description:
      'Record your screen and get auto-zoom, a smooth cursor, and a styled background — free, no account, no watermark.',
    images: ['/icon.png'],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
