import type { Metadata } from 'next';
import { LegalDocumentPage } from '@/app/legal/legal-document-page';
import { legalContent } from '../../lib/legal-content';
const source = legalContent["terms-and-conditions"];

export const metadata: Metadata = {
  title: 'Terms and Conditions — RoleClue',
  description: 'Terms governing access to and use of RoleClue.',
};

export default function TermsPage() {
  return <LegalDocumentPage source={source} activeHref="/terms" />;
}
