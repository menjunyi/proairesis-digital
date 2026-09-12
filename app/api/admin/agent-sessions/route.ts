import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';
import type { AgentSessionStatus } from '@/lib/task-types';

export const dynamic = 'force-dynamic';

const statuses = new Set<AgentSessionStatus>([
  'queued',
  'working',
  'waiting_for_founder',
  'waiting_for_dependency',
  'review',
  'blocked',
  'completed',
  'failed',
]);

export async function POST(request: Request) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;
  const body = await readJsonObject(request);
  const name = cleanText(body?.name, 160);
  const taskId = cleanText(body?.taskId, 100) || null;
  const codexThreadId = cleanText(body?.codexThreadId, 300) || null;
  const status = body?.status as AgentSessionStatus;
  const summary = cleanText(body?.summary, 1000);
  const nextAction = cleanText(body?.nextAction, 500);

  if (name.length < 3 || !statuses.has(status)) {
    return Response.json(
      { error: 'Add an agent-session name and valid status.' },
      { status: 400 },
    );
  }

  const { actor, db } = authorization.value;
  if (taskId) {
    const task = await db
      .prepare('SELECT id FROM work_tasks WHERE id = ? LIMIT 1')
      .bind(taskId)
      .first<{ id: string }>();
    if (!task)
      return Response.json(
        { error: 'Linked task not found.' },
        { status: 404 },
      );
  }

  const id = `agent_${crypto.randomUUID()}`;
  const nowWorking = status === 'working';
  const nowCompleted = status === 'completed';

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO agent_sessions (
             id, task_id, name, codex_thread_id, status, summary, next_action,
             last_heartbeat_at, started_at, completed_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?,
             CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
             CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
             CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(
          id,
          taskId,
          name,
          codexThreadId,
          status,
          summary,
          nextAction,
          nowWorking ? 1 : 0,
          nowWorking ? 1 : 0,
          nowCompleted ? 1 : 0,
        ),
      auditStatement(db, {
        actor,
        action: 'work.agent_session_registered',
        targetType: 'agent_session',
        targetId: id,
        reason: `Registered ${name}`,
        after: { taskId, codexThreadId, status, summary, nextAction },
        requestId: crypto.randomUUID(),
      }),
    ]);
    return Response.json({ id, status }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
