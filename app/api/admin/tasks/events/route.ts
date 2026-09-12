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
  const workflowKey = cleanText(body?.workflowKey, 160);
  const eventType = cleanText(body?.eventType, 120);
  if (!workflowKey || !eventType) {
    return Response.json(
      { error: 'Choose a workflow and event to record.' },
      { status: 400 },
    );
  }

  const { actor, db } = authorization.value;
  const workflow = await db
    .prepare(
      `SELECT workflow_type, COUNT(*) AS task_count
         FROM work_tasks WHERE workflow_key = ? GROUP BY workflow_type LIMIT 1`,
    )
    .bind(workflowKey)
    .first<{ workflow_type: string; task_count: number }>();
  if (!workflow) {
    return Response.json({ error: 'Workflow not found.' }, { status: 404 });
  }

  const existing = await db
    .prepare(
      `SELECT id FROM task_events
       WHERE workflow_key = ? AND event_type = ? LIMIT 1`,
    )
    .bind(workflowKey, eventType)
    .first<{ id: string }>();
  if (existing) {
    return Response.json({ workflowKey, eventType, alreadyRecorded: true });
  }

  const id = `event_${crypto.randomUUID()}`;
  try {
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO task_events (
             id, workflow_key, event_type, payload_json, actor_user_id, occurred_at
           ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        )
        .bind(
          id,
          workflowKey,
          eventType,
          JSON.stringify(body?.payload ?? {}),
          actor.id,
        ),
      db
        .prepare(
          `UPDATE work_tasks
              SET status = CASE WHEN parent_id IS NULL THEN 'doing' ELSE 'done' END,
                  completed_at = CASE WHEN parent_id IS NULL THEN completed_at ELSE CURRENT_TIMESTAMP END,
                  waiting_reason = NULL,
                  updated_at = CURRENT_TIMESTAMP
            WHERE workflow_key = ?
              AND status = 'waiting'
              AND (parent_id IS NULL OR lower(title) LIKE 'wait%')`,
        )
        .bind(workflowKey),
      db
        .prepare(
          `UPDATE work_tasks
              SET status = CASE
                    WHEN EXISTS (
                      SELECT 1
                        FROM task_dependencies dependency
                        JOIN work_tasks prerequisite
                          ON prerequisite.id = dependency.depends_on_task_id
                       WHERE dependency.task_id = work_tasks.id
                         AND prerequisite.status NOT IN ('done', 'cancelled')
                    ) THEN 'planned'
                    ELSE 'ready'
                  END,
                  waiting_reason = CASE
                    WHEN EXISTS (
                      SELECT 1
                        FROM task_dependencies dependency
                        JOIN work_tasks prerequisite
                          ON prerequisite.id = dependency.depends_on_task_id
                       WHERE dependency.task_id = work_tasks.id
                         AND prerequisite.status NOT IN ('done', 'cancelled')
                    ) THEN 'Waiting for dependencies'
                    ELSE NULL
                  END,
                  updated_at = CURRENT_TIMESTAMP
            WHERE workflow_key = ?
              AND activation_event = ?
              AND status = 'planned'`,
        )
        .bind(workflowKey, eventType),
      auditStatement(db, {
        actor,
        action: 'work.workflow_event_recorded',
        targetType: 'work_workflow',
        targetId: workflowKey,
        reason: `${eventType} recorded for ${workflow.workflow_type}`,
        after: { eventType, payload: body?.payload ?? {} },
        requestId: crypto.randomUUID(),
      }),
    ]);
    return Response.json({
      workflowKey,
      eventType,
      alreadyRecorded: false,
      activated: results[2]?.meta?.changes ?? 0,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
