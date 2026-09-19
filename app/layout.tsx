import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.SITE_URL ?? 'https://proairesis.digital',
  ),
  title: 'RoleClue | Australian Job Search by Proairesis Digital',
  description:
    'RoleClue by Proairesis Digital helps you check Australian job ads for work rights, sponsorship, citizenship and clearance requirements. Explore the prototype.',
  openGraph: {
    siteName: 'RoleClue',
    title: 'RoleClue | Australian Job Search by Proairesis Digital',
    description:
      'RoleClue by Proairesis Digital helps you check Australian job ads for work rights, sponsorship, citizenship and clearance requirements. Explore the prototype.',
    type: 'website',
    images: [
      {
        url: '/og.png?v=roleclue-focus',
        width: 1731,
        height: 909,
        alt: 'RoleClue | Australian Job Search by Proairesis Digital',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RoleClue | Australian Job Search by Proairesis Digital',
    description:
      'RoleClue by Proairesis Digital helps you check Australian job ads for work rights, sponsorship, citizenship and clearance requirements. Explore the prototype.',
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
