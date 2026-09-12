import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';
import type { WorkTaskStatus } from '@/lib/task-types';

export const dynamic = 'force-dynamic';

const statuses = new Set<WorkTaskStatus>([
  'inbox',
  'planned',
  'ready',
  'doing',
  'review',
  'waiting',
  'blocked',
  'done',
  'cancelled',
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;
  const body = await readJsonObject(request);
  const status = body?.status as WorkTaskStatus;
  const waitingReason = cleanText(body?.waitingReason, 300) || null;
  if (!statuses.has(status)) {
    return Response.json(
      { error: 'Choose a valid task status.' },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const { actor, db } = authorization.value;
  const task = await db
    .prepare(
      `SELECT id, title, status, workflow_key, activation_event
         FROM work_tasks WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: string;
      title: string;
      status: WorkTaskStatus;
      workflow_key: string | null;
      activation_event: string | null;
    }>();
  if (!task)
    return Response.json({ error: 'Task not found.' }, { status: 404 });

  if (['ready', 'doing', 'review', 'done'].includes(status)) {
    const unresolved = await db
      .prepare(
        `SELECT prerequisite.title
           FROM task_dependencies dependency
           JOIN work_tasks prerequisite
             ON prerequisite.id = dependency.depends_on_task_id
          WHERE dependency.task_id = ?
            AND prerequisite.status NOT IN ('done', 'cancelled')
          ORDER BY prerequisite.created_at ASC
          LIMIT 1`,
      )
      .bind(id)
      .first<{ title: string }>();
    if (unresolved) {
      return Response.json(
        { error: `Finish “${unresolved.title}” before starting this task.` },
        { status: 409 },
      );
    }

    if (task.activation_event && task.workflow_key) {
      const activation = await db
        .prepare(
          `SELECT id FROM task_events
            WHERE workflow_key = ? AND event_type = ? LIMIT 1`,
        )
        .bind(task.workflow_key, task.activation_event)
        .first<{ id: string }>();
      if (!activation) {
        return Response.json(
          { error: `Record ${task.activation_event.replaceAll('_', ' ')} before starting this task.` },
          { status: 409 },
        );
      }
    }
  }

  const requestId = crypto.randomUUID();
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE work_tasks
              SET status = ?, waiting_reason = ?,
                  completed_at = CASE WHEN ? = 'done' THEN CURRENT_TIMESTAMP ELSE NULL END,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
        )
        .bind(status, waitingReason, status, id),
      db.prepare(
        `UPDATE work_tasks
              SET status = 'ready', waiting_reason = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE status = 'planned'
              AND (
                activation_event IS NULL
                OR EXISTS (
                  SELECT 1
                    FROM task_events activation
                   WHERE activation.workflow_key = work_tasks.workflow_key
                     AND activation.event_type = work_tasks.activation_event
                )
              )
              AND id IN (
                SELECT dependency.task_id
                  FROM task_dependencies dependency
                  JOIN work_tasks prerequisite
                    ON prerequisite.id = dependency.depends_on_task_id
                 GROUP BY dependency.task_id
                HAVING SUM(CASE WHEN prerequisite.status IN ('done', 'cancelled') THEN 1 ELSE 0 END)
                       = COUNT(*)
              )`,
      ),
      auditStatement(db, {
        actor,
        action: 'work.task_status_changed',
        targetType: 'work_task',
        targetId: id,
        reason: waitingReason ?? `Moved ${task.title} to ${status}`,
        before: { status: task.status },
        after: { status, waitingReason },
        requestId,
      }),
    ]);
    return Response.json({ id, status });
  } catch (error) {
    return errorResponse(error);
  }
}
