import type { Metadata } from 'next';
import { LegalDocumentPage } from '@/app/legal/legal-document-page';
import { legalContent } from '../../lib/legal-content';
const source = legalContent["cookie-notice"];

export const metadata: Metadata = {
  title: 'Cookie Notice — Pip',
  description: 'How Pip uses cookies and similar technologies.',
};

export default function CookiesPage() {
  return <LegalDocumentPage source={source} activeHref="/cookies" />;
}
