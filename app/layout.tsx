import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.SITE_URL ?? 'https://proairesis.digital',
  ),
  title: 'RoleClue — Australian jobs that fit your situation',
  description:
    'Find Australian jobs that fit your citizenship, clearance, work rights, location and experience. Check the requirements before spending time applying.',
  openGraph: {
    siteName: 'RoleClue',
    title: 'RoleClue — Australian jobs that fit your situation',
    description:
      'Find Australian jobs that fit your citizenship, clearance, work rights, location and experience. Check the requirements before spending time applying.',
    type: 'website',
    images: [
      {
        url: '/og.png?v=roleclue-focus',
        width: 1731,
        height: 909,
        alt: 'RoleClue — Australian jobs that fit your situation',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RoleClue — Australian jobs that fit your situation',
    description:
      'Find Australian jobs that fit your citizenship, clearance, work rights, location and experience. Check the requirements before spending time applying.',
    images: ['/og.png?v=roleclue-focus'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
