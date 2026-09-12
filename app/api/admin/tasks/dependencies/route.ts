import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';
import type { WorkTaskStatus } from '@/lib/task-types';

export const dynamic = 'force-dynamic';

type TaskRow = {
  id: string;
  title: string;
  status: WorkTaskStatus;
};

export async function POST(request: Request) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const body = await readJsonObject(request);
  const taskId = cleanText(body?.taskId, 100);
  const dependsOnTaskId = cleanText(body?.dependsOnTaskId, 100);
  if (!taskId || !dependsOnTaskId || taskId === dependsOnTaskId) {
    return Response.json(
      { error: 'Choose two different tasks for the dependency.' },
      { status: 400 },
    );
  }

  const { actor, db } = authorization.value;
  const [task, prerequisite, existing, cycle] = await Promise.all([
    db
      .prepare('SELECT id, title, status FROM work_tasks WHERE id = ? LIMIT 1')
      .bind(taskId)
      .first<TaskRow>(),
    db
      .prepare('SELECT id, title, status FROM work_tasks WHERE id = ? LIMIT 1')
      .bind(dependsOnTaskId)
      .first<TaskRow>(),
    db
      .prepare(
        `SELECT id FROM task_dependencies
          WHERE task_id = ? AND depends_on_task_id = ? LIMIT 1`,
      )
      .bind(taskId, dependsOnTaskId)
      .first<{ id: string }>(),
    db
      .prepare(
        `WITH RECURSIVE prerequisites(id) AS (
           SELECT depends_on_task_id
             FROM task_dependencies
            WHERE task_id = ?
           UNION
           SELECT dependency.depends_on_task_id
             FROM task_dependencies dependency
             JOIN prerequisites
               ON dependency.task_id = prerequisites.id
         )
         SELECT id FROM prerequisites WHERE id = ? LIMIT 1`,
      )
      .bind(dependsOnTaskId, taskId)
      .first<{ id: string }>(),
  ]);

  if (!task || !prerequisite) {
    return Response.json({ error: 'One of the tasks was not found.' }, { status: 404 });
  }
  if (existing) {
    return Response.json(
      { error: 'That dependency already exists.' },
      { status: 409 },
    );
  }
  if (cycle) {
    return Response.json(
      { error: 'That link would create a cycle. A DAG must stay acyclic.' },
      { status: 409 },
    );
  }
  if (['doing', 'review', 'done'].includes(task.status)) {
    return Response.json(
      {
        error:
          'Move the downstream task to planned, ready or waiting before adding a new prerequisite.',
      },
      { status: 409 },
    );
  }

  const id = `dependency_${crypto.randomUUID()}`;
  const unresolved = !['done', 'cancelled'].includes(prerequisite.status);
  const requestId = crypto.randomUUID();

  try {
    const statements = [
      db
        .prepare(
          `INSERT INTO task_dependencies (
             id, task_id, depends_on_task_id, requirement, created_at
           ) VALUES (?, ?, ?, 'complete', CURRENT_TIMESTAMP)`,
        )
        .bind(id, taskId, dependsOnTaskId),
    ];
    if (unresolved && ['inbox', 'ready'].includes(task.status)) {
      statements.push(
        db
          .prepare(
            `UPDATE work_tasks
                SET status = 'planned', waiting_reason = 'Waiting for dependencies',
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
          )
          .bind(taskId),
      );
    }
    statements.push(
      auditStatement(db, {
        actor,
        action: 'work.task_dependency_created',
        targetType: 'work_task',
        targetId: taskId,
        reason: `${task.title} now depends on ${prerequisite.title}`,
        before: { status: task.status },
        after: {
          dependencyId: id,
          dependsOnTaskId,
          status:
            unresolved && ['inbox', 'ready'].includes(task.status)
              ? 'planned'
              : task.status,
        },
        requestId,
      }),
    );
    await db.batch(statements);
    return Response.json({ id, taskId, dependsOnTaskId }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const body = await readJsonObject(request);
  const dependencyId = cleanText(body?.dependencyId, 100);
  if (!dependencyId) {
    return Response.json(
      { error: 'Choose a dependency to remove.' },
      { status: 400 },
    );
  }

  const { actor, db } = authorization.value;
  const dependency = await db
    .prepare(
      `SELECT dependency.id, dependency.task_id, dependency.depends_on_task_id,
              task.title AS task_title, prerequisite.title AS prerequisite_title
         FROM task_dependencies dependency
         JOIN work_tasks task ON task.id = dependency.task_id
         JOIN work_tasks prerequisite
           ON prerequisite.id = dependency.depends_on_task_id
        WHERE dependency.id = ? LIMIT 1`,
    )
    .bind(dependencyId)
    .first<{
      id: string;
      task_id: string;
      depends_on_task_id: string;
      task_title: string;
      prerequisite_title: string;
    }>();
  if (!dependency) {
    return Response.json({ error: 'Dependency not found.' }, { status: 404 });
  }

  try {
    await db.batch([
      db
        .prepare('DELETE FROM task_dependencies WHERE id = ?')
        .bind(dependencyId),
      db
        .prepare(
          `UPDATE work_tasks
              SET status = 'ready', waiting_reason = NULL,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND status = 'planned'
              AND (
                activation_event IS NULL
                OR EXISTS (
                  SELECT 1
                    FROM task_events activation
                   WHERE activation.workflow_key = work_tasks.workflow_key
                     AND activation.event_type = work_tasks.activation_event
                )
              )
              AND NOT EXISTS (
                SELECT 1
                  FROM task_dependencies remaining
                  JOIN work_tasks prerequisite
                    ON prerequisite.id = remaining.depends_on_task_id
                 WHERE remaining.task_id = work_tasks.id
                   AND prerequisite.status NOT IN ('done', 'cancelled')
              )`,
        )
        .bind(dependency.task_id),
      auditStatement(db, {
        actor,
        action: 'work.task_dependency_removed',
        targetType: 'work_task',
        targetId: dependency.task_id,
        reason: `${dependency.task_title} no longer depends on ${dependency.prerequisite_title}`,
        before: {
          dependencyId,
          dependsOnTaskId: dependency.depends_on_task_id,
        },
        after: { dependencyRemoved: true },
        requestId: crypto.randomUUID(),
      }),
    ]);
    return Response.json({ dependencyId, removed: true });
  } catch (error) {
    return errorResponse(error);
  }
}
