import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const body = await readJsonObject(request);
  const candidateId = cleanText(body?.candidateId, 100);
  const consultantId = cleanText(body?.consultantId, 100);
  const consentScope = cleanText(body?.consentScope, 500);
  const reason = cleanText(body?.reason, 500);

  if (!candidateId || !consultantId || consentScope.length < 3 || reason.length < 3) {
    return Response.json({ error: 'Choose both accounts and record the consent scope and reason.' }, { status: 400 });
  }

  const { actor, db } = authorization.value;
  const [candidate, consultant] = await Promise.all([
    db
      .prepare(`SELECT id, role, status FROM users WHERE id = ? LIMIT 1`)
      .bind(candidateId)
      .first<{ id: string; role: string; status: string }>(),
    db
      .prepare(
        `SELECT u.id, u.role, u.status, cp.application_status
         FROM users u JOIN consultant_profiles cp ON cp.user_id = u.id
         WHERE u.id = ? LIMIT 1`,
      )
      .bind(consultantId)
      .first<{ id: string; role: string; status: string; application_status: string }>(),
  ]);

  if (!candidate || candidate.role !== 'registered_user' || candidate.status !== 'active') {
    return Response.json({ error: 'The candidate must have an active B2C account.' }, { status: 409 });
  }
  if (
    !consultant ||
    consultant.role !== 'consultant' ||
    consultant.status !== 'active' ||
    consultant.application_status !== 'approved'
  ) {
    return Response.json({ error: 'The consultant must be approved and active.' }, { status: 409 });
  }

  const id = `asn_${crypto.randomUUID()}`;
  const requestId = crypto.randomUUID();

  try {
    await db.batch([
      db
        .prepare(
          `UPDATE consultant_assignments
           SET status = 'ended', ended_at = CURRENT_TIMESTAMP, ended_by = ?, updated_at = CURRENT_TIMESTAMP
           WHERE candidate_user_id = ? AND status = 'active'`,
        )
        .bind(actor.id, candidateId),
      db
        .prepare(
          `INSERT INTO consultant_assignments (
            id, candidate_user_id, consultant_user_id, status, consent_scope,
            consented_at, assigned_by, note, created_at, updated_at
          ) VALUES (?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(id, candidateId, consultantId, consentScope, actor.id, reason),
      auditStatement(db, {
        actor,
        action: 'assignment.created',
        targetType: 'candidate',
        targetId: candidateId,
        reason,
        after: { assignmentId: id, consultantId, consentScope },
        requestId,
      }),
    ]);
    return Response.json({ id, status: 'active' }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
