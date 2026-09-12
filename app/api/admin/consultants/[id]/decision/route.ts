import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';
import type { ConsultantDecision } from '@/lib/admin-types';

export const dynamic = 'force-dynamic';

const decisions = new Set<ConsultantDecision>([
  'approved',
  'rejected',
  'more_information_required',
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const { id } = await params;
  const body = await readJsonObject(request);
  const decision = cleanText(body?.decision, 50) as ConsultantDecision;
  const reason = cleanText(body?.reason, 1000);

  if (!decisions.has(decision) || reason.length < 3) {
    return Response.json({ error: 'Choose a valid decision and provide a reason.' }, { status: 400 });
  }

  const { actor, db } = authorization.value;
  const profile = await db
    .prepare(
      `SELECT cp.application_status, cp.checks_completed, cp.checks_required, u.status
       FROM consultant_profiles cp JOIN users u ON u.id = cp.user_id
       WHERE cp.user_id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{
      application_status: string;
      checks_completed: number;
      checks_required: number;
      status: string;
    }>();

  if (!profile) return Response.json({ error: 'Consultant application not found.' }, { status: 404 });
  if (decision === 'approved' && profile.checks_completed < profile.checks_required) {
    return Response.json({ error: 'Complete all required checks before approval.' }, { status: 409 });
  }

  const accountStatus = decision === 'approved' ? 'active' : decision === 'rejected' ? 'deactivated' : 'invited';
  const requestId = crypto.randomUUID();

  try {
    await db.batch([
      db
        .prepare(
          `UPDATE consultant_profiles
           SET application_status = ?, decided_at = CURRENT_TIMESTAMP,
               decided_by = ?, decision_reason = ?, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?`,
        )
        .bind(decision, actor.id, reason, id),
      db
        .prepare(`UPDATE users SET role = 'consultant', status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(accountStatus, id),
      auditStatement(db, {
        actor,
        action: `consultant.application_${decision}`,
        targetType: 'consultant',
        targetId: id,
        reason,
        before: { applicationStatus: profile.application_status, accountStatus: profile.status },
        after: { applicationStatus: decision, accountStatus },
        requestId,
      }),
    ]);
    return Response.json({ id, decision, accountStatus });
  } catch (error) {
    return errorResponse(error);
  }
}
