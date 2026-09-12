import type { Metadata } from 'next';
import { LegalDocumentPage } from '@/app/legal/legal-document-page';
import { legalContent } from '../../lib/legal-content';
const source = legalContent["membership-agreement"];

export const metadata: Metadata = {
  title: 'Membership Agreement — RoleClue',
  description:
    'The agreement electronically signed when purchasing a RoleClue membership.',
};

export default function MembershipAgreementPage() {
  return (
    <LegalDocumentPage source={source} activeHref="/membership-agreement" />
  );
}
