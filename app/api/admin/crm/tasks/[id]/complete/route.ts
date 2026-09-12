import {
  auditStatement,
  authorizeAdminApi,
  errorResponse,
} from '@/lib/admin-actions.server';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const { id } = await context.params;
  const { actor, db } = authorization.value;
  const task = await db
    .prepare(
      `SELECT task.id, task.contact_user_id, task.title, task.status, contact.full_name
       FROM crm_tasks task
       JOIN users contact ON contact.id = task.contact_user_id
       WHERE task.id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: string;
      contact_user_id: string;
      title: string;
      status: 'open' | 'completed';
      full_name: string;
    }>();

  if (!task)
    return Response.json({ error: 'CRM task not found.' }, { status: 404 });
  if (task.status === 'completed') {
    return Response.json(
      { error: 'This follow-up is already complete.' },
      { status: 409 },
    );
  }

  const requestId = crypto.randomUUID();

  try {
    await db.batch([
      db
        .prepare(
          `UPDATE crm_tasks
           SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'open'`,
        )
        .bind(id),
      auditStatement(db, {
        actor,
        action: 'crm.task_completed',
        targetType: 'crm_task',
        targetId: id,
        reason: `Completed follow-up for ${task.full_name}`,
        before: { status: task.status },
        after: {
          status: 'completed',
          contactId: task.contact_user_id,
          title: task.title,
        },
        requestId,
      }),
    ]);
    return Response.json({ id, status: 'completed' });
  } catch (error) {
    return errorResponse(error);
  }
}
