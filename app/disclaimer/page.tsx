import type { Metadata } from 'next';
import { LegalDocumentPage } from '@/app/legal/legal-document-page';
import { legalContent } from '../../lib/legal-content';
const source = legalContent["disclaimer"];

export const metadata: Metadata = {
  title: 'Disclaimer — RoleClue',
  description:
    'Important limitations of RoleClue job-search and AI-assisted outputs.',
};

export default function DisclaimerPage() {
  return <LegalDocumentPage source={source} activeHref="/disclaimer" />;
}
