import type { Metadata } from 'next';
import { LegalDocumentPage } from '@/app/legal/legal-document-page';
import { legalContent } from '../../lib/legal-content';
const source = legalContent["refund-and-cancellation-policy"];

export const metadata: Metadata = {
  title: 'Refund and Cancellation Policy — RoleClue',
  description:
    'RoleClue’s seven-day no-reason membership refund promise and cancellation process.',
};

export default function RefundsPage() {
  return <LegalDocumentPage source={source} activeHref="/refunds" />;
}
