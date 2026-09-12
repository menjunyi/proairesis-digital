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
  if (reason.length < 3) return Response.json({ error: 'Provide a retry reason.' }, { status: 400 });

  const { actor, db } = authorization.value;
  const run = await db
    .prepare(`SELECT id, status FROM workflow_runs WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<{ id: string; status: string }>();

  if (!run) return Response.json({ error: 'Workflow run not found.' }, { status: 404 });
  if (!['failed', 'partial'].includes(run.status)) {
    return Response.json({ error: 'Only failed or partial runs can be retried.' }, { status: 409 });
  }

  try {
    await db.batch([
      db
        .prepare(
          `UPDATE workflow_runs
           SET status = 'queued', error_code = NULL, started_at = NULL,
               finished_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(id),
      auditStatement(db, {
        actor,
        action: 'workflow.retry_requested',
        targetType: 'workflow_run',
        targetId: id,
        reason,
        before: { status: run.status },
        after: { status: 'queued' },
        requestId: crypto.randomUUID(),
      }),
    ]);
    return Response.json({ id, status: 'queued' });
  } catch (error) {
    return errorResponse(error);
  }
}
