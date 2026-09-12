import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';
import type {
  AgentSessionStatus,
  TaskWorkspaceSnapshot,
  WorkContextType,
  WorkExecutorType,
  WorkTaskPriority,
  WorkTaskStatus,
} from '@/lib/task-types';

export const dynamic = 'force-dynamic';

const contextTypes = new Set<WorkContextType>([
  'personal',
  'relationship',
  'company',
  'project',
]);
const taskStatuses = new Set<WorkTaskStatus>([
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
const priorities = new Set<WorkTaskPriority>([
  'low',
  'normal',
  'high',
  'urgent',
]);
const executorTypes = new Set<WorkExecutorType>(['human', 'agent', 'hybrid']);

type TaskRow = {
  id: string;
  title: string;
  description: string;
  context_type: WorkContextType;
  context_name: string;
  parent_id: string | null;
  workflow_key: string | null;
  workflow_type: string | null;
  status: WorkTaskStatus;
  priority: WorkTaskPriority;
  executor_type: WorkExecutorType;
  accountable_name: string | null;
  waiting_reason: string | null;
  activation_event: string | null;
  condition_text: string | null;
  source_label: string | null;
  source_path: string | null;
  start_at: string | null;
  due_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

type AgentRow = {
  id: string;
  task_id: string | null;
  task_title: string | null;
  name: string;
  codex_thread_id: string | null;
  status: AgentSessionStatus;
  summary: string;
  next_action: string;
  last_heartbeat_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

type DependencyRow = {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  requirement: 'complete';
};

function optionalDate(value: unknown): {
  valid: boolean;
  value: string | null;
} {
  const plain = cleanText(value, 40);
  if (!plain) return { valid: true, value: null };
  const date = new Date(plain);
  return Number.isFinite(date.getTime())
    ? { valid: true, value: date.toISOString() }
    : { valid: false, value: null };
}

export async function GET() {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;
  const { db } = authorization.value;

  try {
    const [taskResult, dependencyResult, agentResult, capacityRow] =
      await Promise.all([
      db
        .prepare(
          `SELECT task.id, task.title, task.description, task.context_type,
                  task.context_name, task.parent_id, task.workflow_key,
                  task.workflow_type, task.status, task.priority,
                  task.executor_type, owner.full_name AS accountable_name,
                  task.waiting_reason, task.activation_event, task.condition_text,
                  task.source_label, task.source_path, task.start_at, task.due_at,
                  task.completed_at, task.updated_at
             FROM work_tasks task
             LEFT JOIN users owner ON owner.id = task.accountable_user_id
             ORDER BY
               CASE task.status
                 WHEN 'doing' THEN 0 WHEN 'review' THEN 1 WHEN 'ready' THEN 2
                 WHEN 'waiting' THEN 3 WHEN 'blocked' THEN 4
                 WHEN 'planned' THEN 5 WHEN 'inbox' THEN 6
                 WHEN 'done' THEN 7 ELSE 8 END,
               CASE task.priority
                 WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                 WHEN 'normal' THEN 2 ELSE 3 END,
               COALESCE(task.due_at, '9999-12-31') ASC,
               task.created_at ASC
             LIMIT 500`,
        )
        .all<TaskRow>(),
      db
        .prepare(
          `SELECT id, task_id, depends_on_task_id, requirement
             FROM task_dependencies
             ORDER BY created_at ASC`,
        )
        .all<DependencyRow>(),
      db
        .prepare(
          `SELECT agent.id, agent.task_id, task.title AS task_title, agent.name,
                  agent.codex_thread_id, agent.status, agent.summary,
                  agent.next_action, agent.last_heartbeat_at, agent.started_at,
                  agent.completed_at, agent.updated_at
             FROM agent_sessions agent
             LEFT JOIN work_tasks task ON task.id = agent.task_id
             ORDER BY
               CASE agent.status
                 WHEN 'working' THEN 0 WHEN 'waiting_for_founder' THEN 1
                 WHEN 'review' THEN 2 WHEN 'queued' THEN 3
                 WHEN 'waiting_for_dependency' THEN 4 WHEN 'blocked' THEN 5
                 WHEN 'failed' THEN 6 ELSE 7 END,
               agent.updated_at DESC
             LIMIT 200`,
        )
        .all<AgentRow>(),
      db
        .prepare(
          `SELECT value_json FROM platform_settings
           WHERE key = 'agent.concurrent_capacity' LIMIT 1`,
        )
        .first<{ value_json: string }>(),
      ]);

    let agentCapacity = 4;
    if (capacityRow?.value_json) {
      try {
        const parsed = JSON.parse(capacityRow.value_json) as unknown;
        const candidate =
          typeof parsed === 'number'
            ? parsed
            : parsed && typeof parsed === 'object' && 'value' in parsed
              ? Number((parsed as { value: unknown }).value)
              : Number.NaN;
        if (Number.isInteger(candidate) && candidate > 0 && candidate <= 64) {
          agentCapacity = candidate;
        }
      } catch {
        // Keep the safe default when an older setting has an unexpected shape.
      }
    }

    const snapshot: TaskWorkspaceSnapshot = {
      agentCapacity,
      tasks: taskResult.results.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        contextType: row.context_type,
        contextName: row.context_name,
        parentId: row.parent_id,
        workflowKey: row.workflow_key,
        workflowType: row.workflow_type,
        status: row.status,
        priority: row.priority,
        executorType: row.executor_type,
        accountableName: row.accountable_name ?? 'Super admin',
        waitingReason: row.waiting_reason ?? '',
        activationEvent: row.activation_event,
        conditionText: row.condition_text ?? '',
        sourceLabel: row.source_label ?? '',
        sourcePath: row.source_path ?? '',
        startAt: row.start_at,
        dueAt: row.due_at,
        completedAt: row.completed_at,
        updatedAt: row.updated_at,
      })),
      dependencies: dependencyResult.results.map((row) => ({
        id: row.id,
        taskId: row.task_id,
        dependsOnTaskId: row.depends_on_task_id,
        requirement: row.requirement,
      })),
      agentSessions: agentResult.results.map((row) => ({
        id: row.id,
        taskId: row.task_id,
        taskTitle: row.task_title ?? 'Unlinked work',
        name: row.name,
        codexThreadId: row.codex_thread_id ?? '',
        status: row.status,
        summary: row.summary,
        nextAction: row.next_action,
        lastHeartbeatAt: row.last_heartbeat_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        updatedAt: row.updated_at,
      })),
    };

    return Response.json(snapshot);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const body = await readJsonObject(request);
  const title = cleanText(body?.title, 240);
  const description = cleanText(body?.description, 2000);
  const contextType = body?.contextType as WorkContextType;
  const contextName = cleanText(body?.contextName, 160);
  const parentId = cleanText(body?.parentId, 100) || null;
  const status = body?.status as WorkTaskStatus;
  const priority = body?.priority as WorkTaskPriority;
  const executorType = body?.executorType as WorkExecutorType;
  const waitingReason = cleanText(body?.waitingReason, 300) || null;
  const conditionText = cleanText(body?.conditionText, 500) || null;
  const activationEvent = cleanText(body?.activationEvent, 120) || null;
  const sourceLabel = cleanText(body?.sourceLabel, 160) || null;
  const sourcePath = cleanText(body?.sourcePath, 500) || null;
  const dueAt = optionalDate(body?.dueAt);

  if (
    title.length < 3 ||
    !contextTypes.has(contextType) ||
    !contextName ||
    !taskStatuses.has(status) ||
    !priorities.has(priority) ||
    !executorTypes.has(executorType) ||
    !dueAt.valid
  ) {
    return Response.json(
      {
        error:
          'Add a title, context, valid status, executor, priority and due date.',
      },
      { status: 400 },
    );
  }

  const { actor, db } = authorization.value;
  if (parentId) {
    const parent = await db
      .prepare('SELECT id FROM work_tasks WHERE id = ? LIMIT 1')
      .bind(parentId)
      .first<{ id: string }>();
    if (!parent) {
      return Response.json(
        { error: 'Parent task not found.' },
        { status: 404 },
      );
    }
  }

  const id = `task_${crypto.randomUUID()}`;
  const requestId = crypto.randomUUID();

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO work_tasks (
             id, title, description, context_type, context_name, parent_id,
             status, priority, executor_type, accountable_user_id,
             waiting_reason, activation_event, condition_text,
             source_label, source_path, due_at, completed_at,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             CASE WHEN ? = 'done' THEN CURRENT_TIMESTAMP ELSE NULL END,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(
          id,
          title,
          description,
          contextType,
          contextName,
          parentId,
          status,
          priority,
          executorType,
          actor.id,
          waitingReason,
          activationEvent,
          conditionText,
          sourceLabel,
          sourcePath,
          dueAt.value,
          status,
        ),
      auditStatement(db, {
        actor,
        action: 'work.task_created',
        targetType: 'work_task',
        targetId: id,
        reason: `Created ${contextType} task`,
        after: {
          title,
          contextType,
          contextName,
          parentId,
          status,
          priority,
          executorType,
          dueAt: dueAt.value,
        },
        requestId,
      }),
    ]);
    return Response.json({ id, status }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
