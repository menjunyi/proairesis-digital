import type { Metadata } from 'next';
import { AdminConsole } from './admin-console';
import { AdminAccessDenied } from './access-denied';
import { getAdminSnapshot, requireSuperAdmin } from '@/lib/admin.server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'RoleClue Admin — Platform operations',
  description:
    'Manage RoleClue relationships, candidates, consultants, assignments and operations.',
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const context = await requireSuperAdmin('/admin');
  if (!context) return <AdminAccessDenied />;

  const snapshot = await getAdminSnapshot(context.dataMode);
  const { view } = await searchParams;
  return (
    <AdminConsole
      initialSnapshot={snapshot}
      currentAdmin={context.admin}
      dataMode={context.dataMode}
      initialView={view}
    />
  );
}
