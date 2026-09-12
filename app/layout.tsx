import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.SITE_URL ?? 'https://pip-job-search-au.junyimen.chatgpt.site',
  ),
  title: 'Pip — Find the jobs you can actually pursue',
  description:
    'Your skills fit. Does the job? Explore work-rights, sponsorship, citizenship, clearance and location requirements for your next professional role in Australia, including applications from overseas.',
  openGraph: {
    title: 'Pip — Find the jobs you can actually pursue',
    description:
      'Check the hard gates before you spend hours applying. Evidence-backed shortlists, truthful application drafts and human approval by design.',
    type: 'website',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Pip — Find the jobs you can actually pursue',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pip — Find the jobs you can actually pursue',
    description:
      'Eligibility first. Evidence on every decision. No auto-apply.',
    images: ['/og.png'],
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
