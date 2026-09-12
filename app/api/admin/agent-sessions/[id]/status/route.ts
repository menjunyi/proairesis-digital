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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;
  const body = await readJsonObject(request);
  const status = body?.status as AgentSessionStatus;
  const summary = cleanText(body?.summary, 1000);
  const nextAction = cleanText(body?.nextAction, 500);
  if (!statuses.has(status)) {
    return Response.json(
      { error: 'Choose a valid agent status.' },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const { actor, db } = authorization.value;
  const session = await db
    .prepare('SELECT id, name, status FROM agent_sessions WHERE id = ? LIMIT 1')
    .bind(id)
    .first<{ id: string; name: string; status: AgentSessionStatus }>();
  if (!session) {
    return Response.json(
      { error: 'Agent session not found.' },
      { status: 404 },
    );
  }

  try {
    await db.batch([
      db
        .prepare(
          `UPDATE agent_sessions
              SET status = ?,
                  summary = CASE WHEN ? = '' THEN summary ELSE ? END,
                  next_action = CASE WHEN ? = '' THEN next_action ELSE ? END,
                  last_heartbeat_at = CASE WHEN ? = 'working' THEN CURRENT_TIMESTAMP ELSE last_heartbeat_at END,
                  started_at = CASE WHEN ? = 'working' THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END,
                  completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
        )
        .bind(
          status,
          summary,
          summary,
          nextAction,
          nextAction,
          status,
          status,
          status,
          id,
        ),
      auditStatement(db, {
        actor,
        action: 'work.agent_session_status_changed',
        targetType: 'agent_session',
        targetId: id,
        reason: `Moved ${session.name} to ${status}`,
        before: { status: session.status },
        after: { status, summary, nextAction },
        requestId: crypto.randomUUID(),
      }),
    ]);
    return Response.json({ id, status });
  } catch (error) {
    return errorResponse(error);
  }
}
