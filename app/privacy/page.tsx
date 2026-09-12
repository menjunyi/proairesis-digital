import type { Metadata } from 'next';
import { LegalDocumentPage } from '@/app/legal/legal-document-page';
import { legalContent } from '../../lib/legal-content';
const source = legalContent["privacy-policy"];

export const metadata: Metadata = {
  title: 'Privacy Policy — Pip',
  description: 'How Pip handles personal information.',
};

export default function PrivacyPage() {
  return <LegalDocumentPage source={source} activeHref="/privacy" />;
}
