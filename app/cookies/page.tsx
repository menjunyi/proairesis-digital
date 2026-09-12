import type { Metadata } from 'next';
import { LegalDocumentPage } from '@/app/legal/legal-document-page';
import { legalContent } from '../../lib/legal-content';
const source = legalContent["cookie-notice"];

export const metadata: Metadata = {
  title: 'Cookie Notice — RoleClue',
  description: 'How RoleClue uses cookies and similar technologies.',
};

export default function CookiesPage() {
  return <LegalDocumentPage source={source} activeHref="/cookies" />;
}
