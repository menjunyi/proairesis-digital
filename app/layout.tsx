import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.SITE_URL ?? 'https://pip-job-search-au.junyimen.chatgpt.site',
  ),
  title: 'RoleClue — AI job search and eligibility checks for Australia',
  description:
    'RoleClue helps you check Australian job requirements, including work rights, sponsorship, citizenship, clearance and location, before preparing truthful applications.',
  openGraph: {
    siteName: 'RoleClue',
    title: 'RoleClue — AI job search and eligibility checks for Australia',
    description:
      'Check the hard gates before you spend hours applying. Evidence-backed shortlists, truthful application drafts and human approval by design.',
    type: 'website',
    images: [
      {
        url: '/og.png?v=roleclue-focus',
        width: 1731,
        height: 909,
        alt: 'RoleClue — AI job search and eligibility checks for Australia',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RoleClue — AI job search and eligibility checks for Australia',
    description:
      'Eligibility first. Evidence on every decision. No auto-apply.',
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
