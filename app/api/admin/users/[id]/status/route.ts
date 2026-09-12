import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';
import type { UserStatus } from '@/lib/admin-types';

export const dynamic = 'force-dynamic';

const allowedStatuses = new Set<UserStatus>(['active', 'suspended', 'deactivated']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const { id } = await params;
  const body = await readJsonObject(request);
  const status = cleanText(body?.status, 30) as UserStatus;
  const reason = cleanText(body?.reason, 500);

  if (!allowedStatuses.has(status) || reason.length < 3) {
    return Response.json({ error: 'Choose a valid status and provide a reason.' }, { status: 400 });
  }

  const { actor, db } = authorization.value;
  const target = await db
    .prepare(`SELECT id, email, full_name, role, status FROM users WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<{ id: string; email: string; full_name: string; role: string; status: UserStatus }>();

  if (!target) return Response.json({ error: 'User not found.' }, { status: 404 });
  if (target.id === actor.id && status !== 'active') {
    return Response.json({ error: 'You cannot disable your own admin account.' }, { status: 409 });
  }

  if (target.role === 'super_admin' && status !== 'active') {
    const count = await db
      .prepare(`SELECT COUNT(*) AS total FROM users WHERE role = 'super_admin' AND status = 'active'`)
      .first<{ total: number }>();
    if (Number(count?.total ?? 0) <= 1) {
      return Response.json({ error: 'RoleClue must retain at least one active super admin.' }, { status: 409 });
    }
  }

  const requestId = crypto.randomUUID();
  const statements = [
    db
      .prepare(
        `UPDATE users
         SET status = ?,
             suspended_at = CASE WHEN ? = 'suspended' THEN CURRENT_TIMESTAMP ELSE NULL END,
             suspended_reason = CASE WHEN ? = 'suspended' THEN ? ELSE NULL END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(status, status, status, reason, id),
  ];

  if (target.role === 'consultant' && status !== 'active') {
    statements.push(
      db
        .prepare(
          `UPDATE consultant_assignments
           SET status = 'ended', ended_at = CURRENT_TIMESTAMP, ended_by = ?, updated_at = CURRENT_TIMESTAMP
           WHERE consultant_user_id = ? AND status = 'active'`,
        )
        .bind(actor.id, id),
    );
  }

  statements.push(
    auditStatement(db, {
      actor,
      action: `user.${status}`,
      targetType: 'user',
      targetId: id,
      reason,
      before: { status: target.status },
      after: { status },
      requestId,
    }),
  );

  try {
    await db.batch(statements);
    return Response.json({ id, status });
  } catch (error) {
    return errorResponse(error);
  }
}
