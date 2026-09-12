import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;
  const { id } = await params;
  const body = await readJsonObject(request);
  const reason = cleanText(body?.reason, 500);
  if (reason.length < 3) return Response.json({ error: 'Provide a reason for ending access.' }, { status: 400 });

  const { actor, db } = authorization.value;
  const assignment = await db
    .prepare(
      `SELECT id, candidate_user_id, consultant_user_id, status
       FROM consultant_assignments WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: string;
      candidate_user_id: string;
      consultant_user_id: string;
      status: string;
    }>();

  if (!assignment) return Response.json({ error: 'Assignment not found.' }, { status: 404 });
  if (assignment.status !== 'active') {
    return Response.json({ error: 'This assignment has already ended.' }, { status: 409 });
  }

  try {
    await db.batch([
      db
        .prepare(
          `UPDATE consultant_assignments
           SET status = 'ended', ended_at = CURRENT_TIMESTAMP,
               ended_by = ?, note = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'active'`,
        )
        .bind(actor.id, reason, id),
      auditStatement(db, {
        actor,
        action: 'assignment.ended',
        targetType: 'candidate',
        targetId: assignment.candidate_user_id,
        reason,
        before: { assignmentId: id, status: 'active', consultantId: assignment.consultant_user_id },
        after: { assignmentId: id, status: 'ended' },
        requestId: crypto.randomUUID(),
      }),
    ]);
    return Response.json({ id, status: 'ended' });
  } catch (error) {
    return errorResponse(error);
  }
}
