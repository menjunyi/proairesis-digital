'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Clock3,
  ExternalLink,
  GitBranch,
  Inbox,
  Link2,
  ListTodo,
  LockKeyhole,
  Loader2,
  Plus,
  Search,
  Sparkles,
  UserRound,
  Workflow,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { demoTaskWorkspace } from '@/lib/task-demo';
import type {
  AgentSessionStatus,
  AgentSessionView,
  StarterWorkflowType,
  TaskDependencyView,
  TaskWorkspaceSnapshot,
  WorkContextType,
  WorkExecutorType,
  WorkTaskPriority,
  WorkTaskStatus,
  WorkTaskView,
} from '@/lib/task-types';

type WorkspaceMode = 'tasks' | 'agents';
type TaskViewMode = 'hierarchy' | 'dag';
type DialogState = 'task' | 'workflow' | 'dependency' | 'agent' | null;

const taskStatusLabels: Record<WorkTaskStatus, string> = {
  inbox: 'Inbox',
  planned: 'Planned',
  ready: 'Ready',
  doing: 'Doing',
  review: 'Review',
  waiting: 'Waiting',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

const agentStatusLabels: Record<AgentSessionStatus, string> = {
  queued: 'Queued',
  working: 'Working',
  waiting_for_founder: 'Waiting for me',
  waiting_for_dependency: 'Waiting on dependency',
  review: 'Ready for review',
  blocked: 'Blocked',
  completed: 'Completed',
  failed: 'Failed',
};

const contextLabels: Record<WorkContextType, string> = {
  personal: 'Personal',
  relationship: 'Relationships',
  company: 'Companies',
  project: 'Projects',
};

const activatedStatuses = new Set<WorkTaskStatus>([
  'inbox',
  'ready',
  'doing',
  'review',
  'waiting',
  'blocked',
  'done',
]);

const agentColumns: Array<{
  label: string;
  statuses: AgentSessionStatus[];
  tone: string;
}> = [
  {
    label: 'Working',
    statuses: ['working'],
    tone: 'bg-[#e8f8f3] text-[#0b6c59]',
  },
  {
    label: 'Waiting for me',
    statuses: ['waiting_for_founder'],
    tone: 'bg-[#fff0ec] text-[#b83f28]',
  },
  {
    label: 'Queued',
    statuses: ['queued', 'waiting_for_dependency'],
    tone: 'bg-[#fff8df] text-[#795a00]',
  },
  {
    label: 'Review',
    statuses: ['review'],
    tone: 'bg-[#edf2ff] text-[#3856a4]',
  },
  {
    label: 'Blocked',
    statuses: ['blocked', 'failed'],
    tone: 'bg-[#fbf4e8] text-[#6f5a55]',
  },
  {
    label: 'Completed',
    statuses: ['completed'],
    tone: 'bg-[#edf1eb] text-[#587174]',
  },
];

function cloneDemo() {
  return JSON.parse(JSON.stringify(demoTaskWorkspace)) as TaskWorkspaceSnapshot;
}

export function TaskWorkspace({
  mode,
  dataMode,
  onFeedback,
}: {
  mode: WorkspaceMode;
  dataMode: 'live' | 'preview';
  onFeedback: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<TaskWorkspaceSnapshot>(() =>
    cloneDemo(),
  );
  const [loading, setLoading] = useState(dataMode === 'live');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [query, setQuery] = useState('');
  const [contextFilter, setContextFilter] = useState<'all' | WorkContextType>(
    'all',
  );
  const [statusFilter, setStatusFilter] = useState<'all' | WorkTaskStatus>(
    'all',
  );
  const [taskView, setTaskView] = useState<TaskViewMode>('dag');

  const reload = useCallback(async () => {
    if (dataMode === 'preview') return;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/admin/tasks', { cache: 'no-store' });
      const payload = (await response.json().catch(() => null)) as
        | TaskWorkspaceSnapshot
        | { error?: string }
        | null;
      if (!response.ok || !payload || !('tasks' in payload)) {
        throw new Error(
          payload && 'error' in payload && payload.error
            ? payload.error
            : 'Could not load the task workspace.',
        );
      }
      setSnapshot(payload);
    } catch (caught) {
      setLoadError(
        caught instanceof Error
          ? caught.message
          : 'Could not load the task workspace.',
      );
    } finally {
      setLoading(false);
    }
  }, [dataMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const metrics = useMemo(() => taskMetrics(snapshot), [snapshot]);
  const displayedTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const directMatches = snapshot.tasks.filter((task) => {
      const matchesQuery =
        !needle ||
        [task.title, task.contextName, task.description, task.sourceLabel].some(
          (value) => value.toLowerCase().includes(needle),
        );
      return (
        matchesQuery &&
        (contextFilter === 'all' || task.contextType === contextFilter) &&
        (statusFilter === 'all' || task.status === statusFilter)
      );
    });
    const keep = new Set(directMatches.map((task) => task.id));
    const byId = new Map(snapshot.tasks.map((task) => [task.id, task]));
    for (const task of directMatches) {
      let parentId = task.parentId;
      while (parentId) {
        keep.add(parentId);
        parentId = byId.get(parentId)?.parentId ?? null;
      }
    }
    return hierarchyOrder(snapshot.tasks.filter((task) => keep.has(task.id)));
  }, [contextFilter, query, snapshot.tasks, statusFilter]);

  async function write(
    path: string,
    body: Record<string, unknown>,
    previewChange: () => void,
    message: string,
    method: 'POST' | 'DELETE' = 'POST',
  ) {
    if (dataMode === 'preview') {
      previewChange();
      onFeedback(`${message} Preview changes reset when the page reloads.`);
      return;
    }
    const response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!response.ok)
      throw new Error(payload?.error ?? 'The change could not be saved.');
    onFeedback(message);
    await reload();
  }

  async function changeTaskStatus(task: WorkTaskView, status: WorkTaskStatus) {
    if (['ready', 'doing', 'review', 'done'].includes(status)) {
      const unresolved = snapshot.dependencies
        .filter((dependency) => dependency.taskId === task.id)
        .map((dependency) =>
          snapshot.tasks.find(
            (candidate) => candidate.id === dependency.dependsOnTaskId,
          ),
        )
        .find(
          (prerequisite) =>
            prerequisite &&
            !['done', 'cancelled'].includes(prerequisite.status),
        );
      if (unresolved) {
        onFeedback(`Finish “${unresolved.title}” before starting this task.`);
        return;
      }
      if (
        task.activationEvent &&
        task.status === 'planned' &&
        task.waitingReason !== 'Waiting for dependencies'
      ) {
        onFeedback(
          `Record ${eventLabel(task.activationEvent).toLowerCase()} before starting this task.`,
        );
        return;
      }
    }
    try {
      await write(
        `/api/admin/tasks/${encodeURIComponent(task.id)}/status`,
        { status },
        () =>
          setSnapshot((current) =>
            changePreviewTaskStatus(current, task.id, status),
          ),
        `${task.title} moved to ${taskStatusLabels[status].toLowerCase()}.`,
      );
    } catch (caught) {
      onFeedback(
        caught instanceof Error
          ? caught.message
          : 'Could not change task status.',
      );
    }
  }

  async function recordEvent(workflowKey: string, eventType: string) {
    try {
      await write(
        '/api/admin/tasks/events',
        { workflowKey, eventType },
        () =>
          setSnapshot((current) =>
            recordPreviewEvent(current, workflowKey, eventType),
          ),
        `${eventLabel(eventType)} recorded and conditional tasks activated.`,
      );
    } catch (caught) {
      onFeedback(
        caught instanceof Error
          ? caught.message
          : 'Could not record the event.',
      );
    }
  }

  async function addDependency(taskId: string, dependsOnTaskId: string) {
    const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
    const prerequisite = snapshot.tasks.find(
      (candidate) => candidate.id === dependsOnTaskId,
    );
    if (!task || !prerequisite) return;
    try {
      await write(
        '/api/admin/tasks/dependencies',
        { taskId, dependsOnTaskId },
        () =>
          setSnapshot((current) =>
            addPreviewDependency(current, taskId, dependsOnTaskId),
          ),
        `${task.title} now waits for ${prerequisite.title}.`,
      );
      setDialog(null);
    } catch (caught) {
      onFeedback(
        caught instanceof Error
          ? caught.message
          : 'Could not add the dependency.',
      );
      throw caught;
    }
  }

  async function removeDependency(dependency: TaskDependencyView) {
    const task = snapshot.tasks.find(
      (candidate) => candidate.id === dependency.taskId,
    );
    const prerequisite = snapshot.tasks.find(
      (candidate) => candidate.id === dependency.dependsOnTaskId,
    );
    try {
      await write(
        '/api/admin/tasks/dependencies',
        { dependencyId: dependency.id },
        () =>
          setSnapshot((current) =>
            removePreviewDependency(current, dependency.id),
          ),
        `${task?.title ?? 'Task'} no longer waits for ${prerequisite?.title ?? 'the prerequisite'}.`,
        'DELETE',
      );
    } catch (caught) {
      onFeedback(
        caught instanceof Error
          ? caught.message
          : 'Could not remove the dependency.',
      );
    }
  }

  async function changeAgentStatus(
    session: AgentSessionView,
    status: AgentSessionStatus,
  ) {
    try {
      await write(
        `/api/admin/agent-sessions/${encodeURIComponent(session.id)}/status`,
        { status },
        () =>
          setSnapshot((current) => ({
            ...current,
            agentSessions: current.agentSessions.map((candidate) =>
              candidate.id === session.id
                ? { ...candidate, status }
                : candidate,
            ),
          })),
        `${session.name} moved to ${agentStatusLabels[status].toLowerCase()}.`,
      );
    } catch (caught) {
      onFeedback(
        caught instanceof Error
          ? caught.message
          : 'Could not change agent status.',
      );
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-64 place-items-center rounded-2xl border border-[#062f3b]/9 bg-[#fffaf1]">
        <div className="flex items-center gap-3 text-sm font-bold text-[#587174]">
          <Loader2 className="size-5 animate-spin" /> Loading the work system…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-[#f3c4ba] bg-[#fff0ec] p-6 text-[#8a2f1e]">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            <h2 className="font-black">Task workspace unavailable</h2>
            <p className="mt-1 text-sm">{loadError}</p>
            <Button
              variant="outline"
              className="mt-4 bg-white"
              onClick={() => void reload()}
            >
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {dataMode === 'preview' ? (
        <div className="rounded-xl border border-[#ecd99e] bg-[#fff8df] px-4 py-3 text-sm font-semibold text-[#795a00]">
          This local preview uses a snapshot derived from your current journal
          and active goals. Changes here are temporary; deployed data is stored
          in the private database.
        </div>
      ) : null}

      {mode === 'tasks' ? (
        <>
          <MetricGrid metrics={metrics} />
          <WorkflowStrip tasks={snapshot.tasks} onRecordEvent={recordEvent} />

          <section className="overflow-hidden rounded-2xl border border-[#062f3b]/9 bg-[#fffaf1] shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
            <div className="flex flex-col gap-4 border-b border-[#062f3b]/9 p-5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="text-lg font-black tracking-[-0.025em]">
                  {taskView === 'hierarchy'
                    ? 'Task hierarchy'
                    : 'Dependency DAG'}
                </h2>
                <p className="mt-1 text-sm text-[#587174]">
                  {taskView === 'hierarchy'
                    ? 'Organise work by life area, company, project and parent task.'
                    : 'Execution flows left to right. A downstream task cannot start until every prerequisite is finished.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="flex rounded-xl bg-[#fbf4e8] p-1">
                  <Button
                    size="sm"
                    variant={taskView === 'hierarchy' ? 'default' : 'ghost'}
                    className={
                      taskView === 'hierarchy'
                        ? 'rounded-lg bg-[#062f3b] font-bold text-white'
                        : 'rounded-lg font-bold text-[#587174]'
                    }
                    onClick={() => setTaskView('hierarchy')}
                  >
                    <ListTodo /> Hierarchy
                  </Button>
                  <Button
                    size="sm"
                    variant={taskView === 'dag' ? 'default' : 'ghost'}
                    className={
                      taskView === 'dag'
                        ? 'rounded-lg bg-[#062f3b] font-bold text-white'
                        : 'rounded-lg font-bold text-[#587174]'
                    }
                    onClick={() => setTaskView('dag')}
                  >
                    <GitBranch /> DAG
                  </Button>
                </div>
                {taskView === 'dag' ? (
                  <Button
                    variant="outline"
                    className="rounded-xl bg-white font-bold"
                    onClick={() => setDialog('dependency')}
                  >
                    <Plus /> Add dependency
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="rounded-xl bg-white font-bold"
                  onClick={() => setDialog('workflow')}
                >
                  <Workflow /> Add workflow
                </Button>
                <Button
                  className="rounded-xl bg-[#062f3b] font-bold text-white"
                  onClick={() => setDialog('task')}
                >
                  <Plus /> New task
                </Button>
              </div>
            </div>

            {taskView === 'hierarchy' ? (
              <>
                <div className="border-b border-[#062f3b]/9 p-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_auto_auto]">
                    <div className="relative block">
                      <Label htmlFor="task-workspace-search" className="sr-only">
                        Search tasks
                      </Label>
                      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#708a87]" />
                      <Input
                        id="task-workspace-search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search task, context or source"
                        className="h-10 bg-white pl-9"
                      />
                    </div>
                    <select
                      aria-label="Filter task context"
                      value={contextFilter}
                      onChange={(event) =>
                        setContextFilter(
                          event.target.value as 'all' | WorkContextType,
                        )
                      }
                      className="h-10 rounded-lg border border-input bg-white px-3 text-sm font-semibold"
                    >
                      <option value="all">All contexts</option>
                      {Object.entries(contextLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Filter task status"
                      value={statusFilter}
                      onChange={(event) =>
                        setStatusFilter(
                          event.target.value as 'all' | WorkTaskStatus,
                        )
                      }
                      className="h-10 rounded-lg border border-input bg-white px-3 text-sm font-semibold"
                    >
                      <option value="all">All statuses</option>
                      {Object.entries(taskStatusLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="divide-y divide-[#062f3b]/8">
                  {displayedTasks.map(({ task, depth }) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      depth={depth}
                      onStatusChange={changeTaskStatus}
                    />
                  ))}
                  {!displayedTasks.length ? (
                    <div className="px-6 py-16 text-center">
                      <Inbox className="mx-auto size-8 text-[#8aa19e]" />
                      <p className="mt-3 font-black">No tasks match this view</p>
                      <p className="mt-1 text-sm text-[#708a87]">
                        Change the filters or add a new task.
                      </p>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <DependencyDag
                tasks={snapshot.tasks}
                dependencies={snapshot.dependencies}
                onStatusChange={changeTaskStatus}
                onRemoveDependency={removeDependency}
              />
            )}
          </section>
        </>
      ) : (
        <AgentControlRoom
          snapshot={snapshot}
          onNewAgent={() => setDialog('agent')}
          onStatusChange={changeAgentStatus}
        />
      )}

      <Dialog
        open={Boolean(dialog)}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        {dialog === 'task' ? (
          <TaskDialog
            tasks={snapshot.tasks}
            dataMode={dataMode}
            onCreate={async (task) => {
              await write(
                '/api/admin/tasks',
                task,
                () => setSnapshot((current) => addPreviewTask(current, task)),
                'Task created.',
              );
              setDialog(null);
            }}
          />
        ) : dialog === 'workflow' ? (
          <WorkflowDialog
            dataMode={dataMode}
            onCreate={async (templateType, jobTitle) => {
              await write(
                '/api/admin/tasks/workflows',
                { templateType, jobTitle },
                () =>
                  setSnapshot((current) =>
                    addPreviewWorkflow(current, templateType, jobTitle),
                  ),
                'Starter workflow created from your Obsidian goal structure.',
              );
              setDialog(null);
            }}
          />
        ) : dialog === 'dependency' ? (
          <DependencyDialog
            tasks={snapshot.tasks}
            dependencies={snapshot.dependencies}
            dataMode={dataMode}
            onCreate={addDependency}
          />
        ) : dialog === 'agent' ? (
          <AgentDialog
            tasks={snapshot.tasks}
            dataMode={dataMode}
            onCreate={async (agent) => {
              await write(
                '/api/admin/agent-sessions',
                agent,
                () => setSnapshot((current) => addPreviewAgent(current, agent)),
                'Codex session registered.',
              );
              setDialog(null);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function MetricGrid({ metrics }: { metrics: ReturnType<typeof taskMetrics> }) {
  const items: Array<{
    label: string;
    value: string;
    note: string;
    icon: LucideIcon;
    warning?: boolean;
  }> = [
    {
      label: 'Finished',
      value: `${metrics.done}/${metrics.activated}`,
      note: `${metrics.percent}% of activated tasks`,
      icon: CheckCircle2,
    },
    {
      label: 'Due now',
      value: String(metrics.due),
      note: 'Overdue or due today',
      icon: CalendarClock,
      warning: metrics.due > 0,
    },
    {
      label: 'Waiting for me',
      value: String(metrics.waitingForFounder),
      note: 'Tasks and agent handoffs',
      icon: UserRound,
      warning: metrics.waitingForFounder > 0,
    },
    {
      label: 'Agent capacity',
      value: `${metrics.available}/${metrics.capacity}`,
      note: `${metrics.working} currently working`,
      icon: Bot,
    },
  ];
  return (
    <section
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Task metrics"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <article
            key={item.label}
            className="rounded-2xl border border-[#062f3b]/9 bg-[#fffaf1] p-5 shadow-[0_8px_28px_rgba(23,60,62,0.05)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-[#587174]">{item.label}</p>
                <p className="mt-3 text-3xl font-black tracking-[-0.04em]">
                  {item.value}
                </p>
                <p className="mt-2 text-xs text-[#708a87]">{item.note}</p>
              </div>
              <span
                className={`grid size-11 place-items-center rounded-2xl ${
                  item.warning
                    ? 'bg-[#fff0ec] text-[#b83f28]'
                    : 'bg-[#dff7ef] text-[#0b6c59]'
                }`}
              >
                <Icon className="size-5" />
              </span>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function WorkflowStrip({
  tasks,
  onRecordEvent,
}: {
  tasks: WorkTaskView[];
  onRecordEvent: (workflowKey: string, eventType: string) => Promise<void>;
}) {
  const roots = tasks
    .filter((task) => task.workflowKey && !task.parentId)
    .slice(0, 4);
  if (!roots.length) return null;
  return (
    <section aria-labelledby="active-workflows-heading">
      <div className="mb-3 flex items-center gap-2">
        <GitBranch className="size-4 text-[#c34527]" />
        <h2 id="active-workflows-heading" className="text-sm font-black">
          Active workflows
        </h2>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {roots.map((root) => {
          const children = tasks.filter((task) => task.parentId === root.id);
          const activated = children.filter((task) =>
            activatedStatuses.has(task.status),
          );
          const done = activated.filter(
            (task) => task.status === 'done',
          ).length;
          const progress = activated.length
            ? Math.round((done / activated.length) * 100)
            : 0;
          const conditional = children.filter(
            (task) => task.status === 'planned' && task.activationEvent,
          );
          const events = [
            ...new Set(
              conditional.map((task) => task.activationEvent).filter(Boolean),
            ),
          ] as string[];
          return (
            <article
              key={root.id}
              className="rounded-2xl border border-[#062f3b]/9 bg-[#fffaf1] p-5 shadow-[0_8px_28px_rgba(23,60,62,0.05)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#c34527]">
                    {root.workflowType}
                  </p>
                  <h3 className="mt-1 truncate text-base font-black">
                    {root.title}
                  </h3>
                </div>
                <TaskStatusBadge status={root.status} />
              </div>
              <div className="mt-4 flex items-center justify-between text-xs font-bold text-[#587174]">
                <span>
                  {done} of {activated.length} active steps
                </span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="mt-2 h-2 bg-[#edf1eb]" />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[#708a87]">
                  {conditional.length
                    ? `${conditional.length} conditional task${conditional.length === 1 ? '' : 's'} not counted yet`
                    : 'No conditional tasks waiting'}
                </p>
                {events.map((event) => (
                  <Button
                    key={event}
                    size="sm"
                    variant="outline"
                    className="rounded-lg bg-white font-bold"
                    onClick={() => void onRecordEvent(root.workflowKey!, event)}
                  >
                    <CircleDot /> {eventActionLabel(event)}
                  </Button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DependencyDag({
  tasks,
  dependencies,
  onStatusChange,
  onRemoveDependency,
}: {
  tasks: WorkTaskView[];
  dependencies: TaskDependencyView[];
  onStatusChange: (task: WorkTaskView, status: WorkTaskStatus) => Promise<void>;
  onRemoveDependency: (dependency: TaskDependencyView) => Promise<void>;
}) {
  const [scope, setScope] = useState('__connected__');
  const workflows = useMemo(() => {
    const roots = tasks.filter((task) => task.workflowKey && !task.parentId);
    return roots.map((root) => ({
      key: root.workflowKey!,
      label: root.title,
    }));
  }, [tasks]);
  const graph = useMemo(
    () => makeDagGraph(tasks, dependencies, scope),
    [dependencies, scope, tasks],
  );
  const byId = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const blocked = graph.tasks.filter((task) =>
    graph.dependencies.some(
      (dependency) =>
        dependency.taskId === task.id &&
        !['done', 'cancelled'].includes(
          byId.get(dependency.dependsOnTaskId)?.status ?? 'planned',
        ),
    ),
  ).length;
  const ready = graph.tasks.filter((task) => task.status === 'ready').length;

  return (
    <div className="bg-[#fbfaf5]">
      <div className="flex flex-col gap-4 border-b border-[#062f3b]/9 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2 text-xs font-bold text-[#587174]">
          <span className="rounded-full bg-[#e8f8f3] px-3 py-1.5 text-[#0b6c59]">
            {graph.dependencies.length} dependency links
          </span>
          <span className="rounded-full bg-[#fff8df] px-3 py-1.5 text-[#795a00]">
            {blocked} waiting on prerequisites
          </span>
          <span className="rounded-full bg-[#edf2ff] px-3 py-1.5 text-[#3856a4]">
            {ready} ready now
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="dag-scope" className="text-xs font-black">
            Show
          </Label>
          <select
            id="dag-scope"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            className="h-9 max-w-[320px] rounded-lg border border-input bg-white px-3 text-xs font-bold"
          >
            <option value="__connected__">All connected tasks</option>
            {workflows.map((workflow) => (
              <option key={workflow.key} value={workflow.key}>
                {workflow.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {graph.tasks.length ? (
        <div className="overflow-x-auto p-5">
          <div className="flex min-w-max items-stretch gap-3">
            {graph.layers.map((layer, layerIndex) => (
              <div key={`layer-${layerIndex}`} className="flex items-stretch gap-3">
                <section className="w-[292px] rounded-2xl border border-[#062f3b]/8 bg-white/75 p-3">
                  <div className="mb-3 flex items-center justify-between px-1">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#c34527]">
                        Stage {layerIndex + 1}
                      </p>
                      <h3 className="mt-0.5 text-sm font-black">
                        {layerIndex === 0 ? 'Entry tasks' : 'Downstream work'}
                      </h3>
                    </div>
                    <Badge variant="outline" className="bg-white font-black">
                      {layer.length}
                    </Badge>
                  </div>
                  <div className="space-y-3">
                    {layer.map((task) => {
                      const incoming = graph.dependencies
                        .filter((dependency) => dependency.taskId === task.id)
                        .map((dependency) => ({
                          dependency,
                          prerequisite: byId.get(dependency.dependsOnTaskId),
                        }))
                        .filter(
                          (
                            entry,
                          ): entry is {
                            dependency: TaskDependencyView;
                            prerequisite: WorkTaskView;
                          } => Boolean(entry.prerequisite),
                        );
                      const unresolved = incoming.filter(
                        ({ prerequisite }) =>
                          !['done', 'cancelled'].includes(prerequisite.status),
                      );
                      const downstreamCount = graph.dependencies.filter(
                        (dependency) => dependency.dependsOnTaskId === task.id,
                      ).length;
                      return (
                        <article
                          key={task.id}
                          className={`rounded-xl border p-4 shadow-[0_5px_16px_rgba(23,60,62,0.04)] ${
                            unresolved.length
                              ? 'border-[#ecd99e] bg-[#fffaf1]'
                              : task.status === 'done'
                                ? 'border-[#b9e9dc] bg-[#f5fcf9]'
                                : 'border-[#062f3b]/9 bg-white'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <TaskStatusBadge status={task.status} />
                            <ExecutorBadge executor={task.executorType} />
                          </div>
                          <h4 className="mt-3 text-sm font-black leading-5">
                            {task.title}
                          </h4>
                          <p className="mt-1 text-[11px] font-semibold text-[#708a87]">
                            {contextLabels[task.contextType]} · {task.contextName}
                          </p>

                          {incoming.length ? (
                            <div className="mt-3 space-y-1.5 rounded-lg bg-[#fbf4e8] p-2.5">
                              <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#708a87]">
                                Prerequisites
                              </p>
                              {incoming.map(
                                ({ dependency, prerequisite }) => (
                                  <div
                                    key={dependency.id}
                                    className="flex items-start gap-1.5 text-[11px] leading-4 text-[#4e6967]"
                                  >
                                    {['done', 'cancelled'].includes(
                                      prerequisite.status,
                                    ) ? (
                                      <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-[#0b6c59]" />
                                    ) : (
                                      <LockKeyhole className="mt-0.5 size-3 shrink-0 text-[#b06b19]" />
                                    )}
                                    <span className="line-clamp-2 flex-1">
                                      {prerequisite.title}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void onRemoveDependency(dependency)
                                      }
                                      className="grid size-5 shrink-0 place-items-center rounded text-[#8a9996] hover:bg-white hover:text-[#b83f28]"
                                      aria-label={`Remove prerequisite ${prerequisite.title}`}
                                      title="Remove dependency"
                                    >
                                      <X className="size-3" />
                                    </button>
                                  </div>
                                ),
                              )}
                            </div>
                          ) : null}

                          {task.activationEvent ? (
                            <p className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-[#795a00]">
                              <CircleDot className="size-3" /> Event gate:{' '}
                              {eventLabel(task.activationEvent)}
                            </p>
                          ) : null}
                          {downstreamCount ? (
                            <p className="mt-2 flex items-center gap-1 text-[10px] font-bold text-[#0b6c59]">
                              <ArrowRight className="size-3" /> Unlocks{' '}
                              {downstreamCount} downstream task
                              {downstreamCount === 1 ? '' : 's'}
                            </p>
                          ) : null}

                          <select
                            aria-label={`Status for ${task.title}`}
                            value={task.status}
                            onChange={(event) =>
                              void onStatusChange(
                                task,
                                event.target.value as WorkTaskStatus,
                              )
                            }
                            className="mt-3 h-9 w-full rounded-lg border border-input bg-white px-2 text-xs font-bold"
                          >
                            {Object.entries(taskStatusLabels).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </article>
                      );
                    })}
                  </div>
                </section>
                {layerIndex < graph.layers.length - 1 ? (
                  <div className="flex w-8 items-start justify-center pt-16 text-[#c34527]">
                    <ArrowRight className="size-5" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-6 py-16 text-center">
          <GitBranch className="mx-auto size-9 text-[#8aa19e]" />
          <p className="mt-3 font-black">No connected tasks yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#708a87]">
            Add a dependency to say which task must finish before another can
            start. Independent tasks remain available in the hierarchy view.
          </p>
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  depth,
  onStatusChange,
}: {
  task: WorkTaskView;
  depth: number;
  onStatusChange: (task: WorkTaskView, status: WorkTaskStatus) => Promise<void>;
}) {
  return (
    <article className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(280px,1fr)_180px_145px_150px] lg:items-center lg:px-5">
      <div
        className="min-w-0"
        style={{ paddingLeft: `${Math.min(depth, 4) * 22}px` }}
      >
        <div className="flex items-start gap-2">
          {depth ? (
            <span
              className="mt-2 h-px w-3 shrink-0 bg-[#9cb0ad]"
              aria-hidden="true"
            />
          ) : (
            <ListTodo className="mt-0.5 size-4 shrink-0 text-[#13866f]" />
          )}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black">{task.title}</h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#587174]">
              {task.description || task.conditionText || 'No description'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[#708a87]">
              <Badge variant="outline" className="bg-white capitalize">
                {task.contextType} · {task.contextName}
              </Badge>
              {task.conditionText ? (
                <span className="inline-flex items-center gap-1 text-[#795a00]">
                  <GitBranch className="size-3" /> {task.conditionText}
                </span>
              ) : null}
              {task.sourcePath ? <ObsidianSource task={task} /> : null}
            </div>
          </div>
        </div>
      </div>
      <div>
        <ExecutorBadge executor={task.executorType} />
        <p className="mt-1 text-[11px] text-[#708a87]">
          Owner: {task.accountableName}
        </p>
      </div>
      <div className="text-xs">
        <p className="font-bold text-[#062f3b]">{formatDue(task.dueAt)}</p>
        {task.waitingReason ? (
          <p className="mt-1 line-clamp-2 text-[#b06b19]">
            {task.waitingReason}
          </p>
        ) : null}
      </div>
      <select
        aria-label={`Status for ${task.title}`}
        value={task.status}
        onChange={(event) =>
          void onStatusChange(task, event.target.value as WorkTaskStatus)
        }
        className="h-9 rounded-lg border border-input bg-white px-2 text-xs font-bold"
      >
        {Object.entries(taskStatusLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </article>
  );
}

function AgentControlRoom({
  snapshot,
  onNewAgent,
  onStatusChange,
}: {
  snapshot: TaskWorkspaceSnapshot;
  onNewAgent: () => void;
  onStatusChange: (
    session: AgentSessionView,
    status: AgentSessionStatus,
  ) => Promise<void>;
}) {
  const working = snapshot.agentSessions.filter(
    (agent) => agent.status === 'working',
  ).length;
  const available = Math.max(0, snapshot.agentCapacity - working);
  const waiting = snapshot.agentSessions.filter(
    (agent) => agent.status === 'waiting_for_founder',
  ).length;
  return (
    <>
      <section className="overflow-hidden rounded-2xl bg-[#062f3b] p-6 text-white shadow-[0_14px_40px_rgba(23,60,62,0.18)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.13em] text-[#85c5ae]">
              <Bot className="size-4" /> Agent map
            </div>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
              {working} working · {available} available
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#c9dad8]">
              Codex conversations are execution sessions. Finished work moves to
              review until you accept it.
            </p>
          </div>
          <Button
            className="rounded-xl bg-[#f5c85b] font-black text-[#062f3b] hover:bg-[#ffe08b]"
            onClick={onNewAgent}
          >
            <Plus /> Register Codex session
          </Button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <AgentStat label="Capacity" value={snapshot.agentCapacity} />
          <AgentStat label="Working" value={working} />
          <AgentStat
            label="Waiting for me"
            value={waiting}
            warning={waiting > 0}
          />
          <AgentStat label="Available" value={available} />
        </div>
      </section>

      <section
        className="overflow-x-auto pb-2"
        aria-label="Agent status kanban"
      >
        <div className="grid min-w-[1180px] grid-cols-6 gap-3">
          {agentColumns.map((column) => {
            const agents = snapshot.agentSessions.filter((agent) =>
              column.statuses.includes(agent.status),
            );
            return (
              <div key={column.label} className="min-w-0">
                <div className="mb-3 flex items-center justify-between px-1">
                  <h3 className="text-xs font-black uppercase tracking-[0.1em] text-[#587174]">
                    {column.label}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-black ${column.tone}`}
                  >
                    {agents.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {agents.map((agent) => (
                    <article
                      key={agent.id}
                      className="rounded-2xl border border-[#062f3b]/9 bg-[#fffaf1] p-4 shadow-[0_8px_22px_rgba(23,60,62,0.05)]"
                    >
                      <div className="flex items-start gap-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#dff7ef] text-[#0b6c59]">
                          <Bot className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <h4 className="line-clamp-2 text-sm font-black">
                            {agent.name}
                          </h4>
                          <p className="mt-1 text-[11px] font-semibold text-[#c34527]">
                            {agent.taskTitle}
                          </p>
                        </div>
                      </div>
                      <p className="mt-3 line-clamp-3 text-xs leading-5 text-[#587174]">
                        {agent.summary || 'No activity summary yet.'}
                      </p>
                      {agent.nextAction ? (
                        <div className="mt-3 rounded-xl bg-[#fbf4e8] p-3 text-[11px] leading-5 text-[#4e6967]">
                          <span className="font-black text-[#062f3b]">
                            Next:{' '}
                          </span>
                          {agent.nextAction}
                        </div>
                      ) : null}
                      <div className="mt-3 flex items-center gap-1 text-[10px] font-semibold text-[#8a9996]">
                        <Clock3 className="size-3" />{' '}
                        {formatActivity(agent.updatedAt)}
                      </div>
                      <select
                        aria-label={`Status for ${agent.name}`}
                        value={agent.status}
                        onChange={(event) =>
                          void onStatusChange(
                            agent,
                            event.target.value as AgentSessionStatus,
                          )
                        }
                        className="mt-3 h-9 w-full rounded-lg border border-input bg-white px-2 text-xs font-bold"
                      >
                        {Object.entries(agentStatusLabels).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </article>
                  ))}
                  {!agents.length ? (
                    <div className="rounded-2xl border border-dashed border-[#062f3b]/15 px-3 py-8 text-center text-xs text-[#8a9996]">
                      No sessions
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function TaskDialog({
  tasks,
  dataMode,
  onCreate,
}: {
  tasks: WorkTaskView[];
  dataMode: 'live' | 'preview';
  onCreate: (task: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        title: form.get('title'),
        description: form.get('description'),
        contextType: form.get('contextType'),
        contextName: form.get('contextName'),
        parentId: form.get('parentId'),
        status: form.get('status'),
        priority: form.get('priority'),
        executorType: form.get('executorType'),
        waitingReason: form.get('waitingReason'),
        dueAt: form.get('dueAt'),
        sourceLabel: form.get('sourceLabel'),
        sourcePath: form.get('sourcePath'),
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not create the task.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-xl">
      <form onSubmit={submit}>
        <DialogHeader>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#c34527]">
            Work OS
          </p>
          <DialogTitle className="text-2xl font-black tracking-[-0.04em]">
            New task
          </DialogTitle>
          <DialogDescription>
            Give the work one home, one accountable owner and a clear execution
            mode.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-5">
          <FormError message={error} />
          <Field
            label="Task title"
            name="title"
            required
            placeholder="What outcome is needed?"
          />
          <div className="space-y-2">
            <Label htmlFor="work-description">Description</Label>
            <Textarea
              id="work-description"
              name="description"
              maxLength={2000}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Context"
              name="contextType"
              defaultValue="personal"
            >
              {Object.entries(contextLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <Field
              label="Context name"
              name="contextName"
              required
              placeholder="e.g. Skilled migration"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField label="Status" name="status" defaultValue="ready">
              {Object.entries(taskStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Executor"
              name="executorType"
              defaultValue="human"
            >
              <option value="human">Human</option>
              <option value="agent">Agent</option>
              <option value="hybrid">Hybrid</option>
            </SelectField>
            <SelectField label="Priority" name="priority" defaultValue="normal">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </SelectField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Parent task" name="parentId" defaultValue="">
              <option value="">No parent</option>
              {tasks
                .filter((task) => task.status !== 'cancelled')
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
            </SelectField>
            <div className="space-y-2">
              <Label htmlFor="work-due">Due</Label>
              <Input id="work-due" name="dueAt" type="datetime-local" />
            </div>
          </div>
          <Field
            label="Waiting reason"
            name="waitingReason"
            placeholder="Only if this task is waiting"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Obsidian source label"
              name="sourceLabel"
              placeholder="e.g. 2026-W37 journal"
            />
            <Field
              label="Vault-relative path"
              name="sourcePath"
              placeholder="03 Agenda/Journal/…"
            />
          </div>
          {dataMode === 'preview' ? (
            <p className="text-xs text-[#795a00]">
              This task will be temporary in local preview.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-[#062f3b] font-bold text-white"
          >
            {busy ? 'Creating…' : 'Create task'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function WorkflowDialog({
  dataMode,
  onCreate,
}: {
  dataMode: 'live' | 'preview';
  onCreate: (template: StarterWorkflowType, jobTitle: string) => Promise<void>;
}) {
  const [template, setTemplate] =
    useState<StarterWorkflowType>('skills_assessment');
  const [jobTitle, setJobTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate(template, jobTitle.trim());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not create the workflow.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogContent className="rounded-2xl sm:max-w-lg">
      <form onSubmit={submit}>
        <DialogHeader>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#c34527]">
            Conditional work
          </p>
          <DialogTitle className="text-2xl font-black tracking-[-0.04em]">
            Add a starter workflow
          </DialogTitle>
          <DialogDescription>
            These templates preserve the decision gates in your Obsidian goals.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-5">
          <FormError message={error} />
          <SelectField
            label="Workflow"
            name="template"
            value={template}
            onChange={(value) => setTemplate(value as StarterWorkflowType)}
          >
            <option value="skills_assessment">ACS skills assessment</option>
            <option value="job_application">Job application</option>
            <option value="weekly_journal">Current journal · 2026-W37</option>
          </SelectField>
          {template === 'job_application' ? (
            <Field
              label="Role and company"
              name="jobTitle"
              value={jobTitle}
              onChange={setJobTitle}
              required
              placeholder="e.g. Network Engineer · Company X"
            />
          ) : template === 'skills_assessment' ? (
            <div className="rounded-xl bg-[#fbf4e8] p-4 text-sm leading-6 text-[#587174]">
              Post-result tasks stay hidden from progress until you record the
              assessment result.
            </div>
          ) : (
            <div className="rounded-xl bg-[#fbf4e8] p-4 text-sm leading-6 text-[#587174]">
              Creates the active application, PTE, outreach, referee and Agent
              Group commitments from this week’s journal.
            </div>
          )}
          {dataMode === 'preview' ? (
            <p className="text-xs text-[#795a00]">
              Preview workflows reset on reload.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-[#062f3b] font-bold text-white"
          >
            <Sparkles /> {busy ? 'Creating…' : 'Create workflow'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function DependencyDialog({
  tasks,
  dependencies,
  dataMode,
  onCreate,
}: {
  tasks: WorkTaskView[];
  dependencies: TaskDependencyView[];
  dataMode: 'live' | 'preview';
  onCreate: (taskId: string, dependsOnTaskId: string) => Promise<void>;
}) {
  const [taskId, setTaskId] = useState('');
  const [dependsOnTaskId, setDependsOnTaskId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetTasks = tasks.filter((task) =>
    ['inbox', 'planned', 'ready', 'waiting', 'blocked'].includes(task.status),
  );
  const prerequisiteTasks = tasks.filter(
    (task) =>
      task.id !== taskId &&
      task.status !== 'cancelled' &&
      !dependencies.some(
        (dependency) =>
          dependency.taskId === taskId &&
          dependency.dependsOnTaskId === task.id,
      ),
  );

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskId || !dependsOnTaskId) {
      setError('Choose both the downstream task and its prerequisite.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(taskId, dependsOnTaskId);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not add the dependency.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent className="rounded-2xl sm:max-w-lg">
      <form onSubmit={submit}>
        <DialogHeader>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#c34527]">
            Dependency DAG
          </p>
          <DialogTitle className="text-2xl font-black tracking-[-0.04em]">
            Add a prerequisite
          </DialogTitle>
          <DialogDescription>
            The downstream task stays planned until the prerequisite is done.
            Links that would create a cycle are rejected.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-5">
          <FormError message={error} />
          <SelectField
            label="Downstream task"
            name="taskId"
            value={taskId}
            onChange={(value) => {
              setTaskId(value);
              if (value === dependsOnTaskId) setDependsOnTaskId('');
            }}
          >
            <option value="">Choose the task that must wait</option>
            {targetTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title} · {taskStatusLabels[task.status]}
              </option>
            ))}
          </SelectField>
          <div className="flex justify-center text-[#c34527]">
            <ArrowRight className="size-5 rotate-90" aria-hidden="true" />
          </div>
          <SelectField
            label="Waits for"
            name="dependsOnTaskId"
            value={dependsOnTaskId}
            onChange={setDependsOnTaskId}
          >
            <option value="">Choose the prerequisite</option>
            {prerequisiteTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title} · {taskStatusLabels[task.status]}
              </option>
            ))}
          </SelectField>
          {dataMode === 'preview' ? (
            <p className="text-xs text-[#795a00]">
              This dependency will be temporary in local preview.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="submit"
            disabled={busy || !taskId || !dependsOnTaskId}
            className="rounded-xl bg-[#062f3b] font-bold text-white"
          >
            <GitBranch /> {busy ? 'Connecting…' : 'Add dependency'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function AgentDialog({
  tasks,
  dataMode,
  onCreate,
}: {
  tasks: WorkTaskView[];
  dataMode: 'live' | 'preview';
  onCreate: (agent: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name: form.get('name'),
        taskId: form.get('taskId'),
        codexThreadId: form.get('codexThreadId'),
        status: form.get('status'),
        summary: form.get('summary'),
        nextAction: form.get('nextAction'),
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not register the session.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogContent className="rounded-2xl sm:max-w-lg">
      <form onSubmit={submit}>
        <DialogHeader>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#c34527]">
            Agent map
          </p>
          <DialogTitle className="text-2xl font-black tracking-[-0.04em]">
            Register Codex session
          </DialogTitle>
          <DialogDescription>
            Link an unfinished Codex conversation to the outcome it is
            responsible for.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-5">
          <FormError message={error} />
          <Field
            label="Session name"
            name="name"
            required
            placeholder="e.g. Codex · Migration research"
          />
          <SelectField label="Linked task" name="taskId" defaultValue="">
            <option value="">No linked task</option>
            {tasks
              .filter((task) => !['done', 'cancelled'].includes(task.status))
              .map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
          </SelectField>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Codex task ID or link"
              name="codexThreadId"
              placeholder="Paste the task identifier"
            />
            <SelectField label="Status" name="status" defaultValue="queued">
              {Object.entries(agentStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-summary">Current activity</Label>
            <Textarea
              id="agent-summary"
              name="summary"
              maxLength={1000}
              placeholder="What is this session doing?"
            />
          </div>
          <Field
            label="Next action"
            name="nextAction"
            placeholder="What must happen next, and who owns it?"
          />
          {dataMode === 'preview' ? (
            <p className="text-xs text-[#795a00]">
              Preview sessions reset on reload.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-[#062f3b] font-bold text-white"
          >
            <Bot /> {busy ? 'Registering…' : 'Register session'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function Field({
  label,
  name,
  placeholder,
  required,
  value,
  onChange,
}: {
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  value?: string;
  onChange?: (value: string) => void;
}) {
  const id = `work-${name}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        placeholder={placeholder}
        required={required}
        minLength={required ? 3 : undefined}
        maxLength={500}
        value={value}
        onChange={
          onChange ? (event) => onChange(event.target.value) : undefined
        }
      />
    </div>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  value,
  onChange,
  children,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  children: React.ReactNode;
}) {
  const id = `work-${name}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={value === undefined ? defaultValue : undefined}
        value={value}
        onChange={
          onChange ? (event) => onChange(event.target.value) : undefined
        }
        className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
      >
        {children}
      </select>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p
      role="alert"
      className="rounded-lg bg-[#fff0ec] px-3 py-2 text-xs font-semibold text-[#b83f28]"
    >
      {message}
    </p>
  ) : null;
}

function TaskStatusBadge({ status }: { status: WorkTaskStatus }) {
  const styles =
    status === 'done'
      ? 'bg-[#e8f8f3] text-[#0b6c59]'
      : status === 'doing'
        ? 'bg-[#dff7ef] text-[#0b6c59]'
        : ['blocked', 'cancelled'].includes(status)
          ? 'bg-[#fff0ec] text-[#b83f28]'
          : status === 'review'
            ? 'bg-[#edf2ff] text-[#3856a4]'
            : 'bg-[#fff8df] text-[#795a00]';
  return (
    <Badge className={`${styles} font-black`}>{taskStatusLabels[status]}</Badge>
  );
}

function ExecutorBadge({ executor }: { executor: WorkExecutorType }) {
  const Icon =
    executor === 'human' ? UserRound : executor === 'agent' ? Bot : Sparkles;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-black capitalize text-[#062f3b]">
      <Icon className="size-3.5 text-[#13866f]" /> {executor}
    </span>
  );
}

function ObsidianSource({ task }: { task: WorkTaskView }) {
  const href = `obsidian://open?vault=${encodeURIComponent('Junyi AI OS')}&file=${encodeURIComponent(task.sourcePath.replace(/\.md$/, ''))}`;
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 text-[#0b6c59] underline-offset-2 hover:underline"
    >
      <Link2 className="size-3" /> {task.sourceLabel || 'Obsidian source'}
      <ExternalLink className="size-2.5" />
    </a>
  );
}

function AgentStat({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div
      className={`rounded-xl px-4 py-3 ${warning ? 'bg-[#714032]' : 'bg-white/8'}`}
    >
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#a9c1bf]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function taskMetrics(snapshot: TaskWorkspaceSnapshot) {
  const activated = snapshot.tasks.filter((task) =>
    activatedStatuses.has(task.status),
  );
  const done = activated.filter((task) => task.status === 'done').length;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const due = activated.filter(
    (task) =>
      task.dueAt &&
      !['done', 'cancelled'].includes(task.status) &&
      new Date(task.dueAt).getTime() <= endOfToday.getTime(),
  ).length;
  const waitingForFounder =
    snapshot.tasks.filter((task) =>
      `${task.waitingReason} ${task.conditionText}`
        .toLowerCase()
        .includes('founder'),
    ).length +
    snapshot.agentSessions.filter(
      (agent) => agent.status === 'waiting_for_founder',
    ).length;
  const working = snapshot.agentSessions.filter(
    (agent) => agent.status === 'working',
  ).length;
  return {
    activated: activated.length,
    done,
    percent: activated.length ? Math.round((done / activated.length) * 100) : 0,
    due,
    waitingForFounder,
    working,
    capacity: snapshot.agentCapacity,
    available: Math.max(0, snapshot.agentCapacity - working),
  };
}

function hierarchyOrder(tasks: WorkTaskView[]) {
  const byParent = new Map<string | null, WorkTaskView[]>();
  const ids = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    const parent =
      task.parentId && ids.has(task.parentId) ? task.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), task]);
  }
  const output: Array<{ task: WorkTaskView; depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const task of byParent.get(parentId) ?? []) {
      output.push({ task, depth });
      visit(task.id, depth + 1);
    }
  };
  visit(null, 0);
  return output;
}

function makeDagGraph(
  tasks: WorkTaskView[],
  dependencies: TaskDependencyView[],
  scope: string,
) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const included = new Set<string>();

  if (scope === '__connected__') {
    for (const dependency of dependencies) {
      included.add(dependency.taskId);
      included.add(dependency.dependsOnTaskId);
    }
    for (const task of tasks) {
      if (task.activationEvent) included.add(task.id);
    }
  } else {
    for (const task of tasks) {
      if (task.workflowKey === scope && task.parentId) included.add(task.id);
    }
    for (const dependency of dependencies) {
      if (
        included.has(dependency.taskId) ||
        included.has(dependency.dependsOnTaskId)
      ) {
        included.add(dependency.taskId);
        included.add(dependency.dependsOnTaskId);
      }
    }
  }

  const graphTasks = tasks.filter((task) => included.has(task.id));
  const graphDependencies = dependencies.filter(
    (dependency) =>
      included.has(dependency.taskId) &&
      included.has(dependency.dependsOnTaskId) &&
      taskById.has(dependency.taskId) &&
      taskById.has(dependency.dependsOnTaskId),
  );
  const inDegree = new Map(graphTasks.map((task) => [task.id, 0]));
  const levels = new Map(graphTasks.map((task) => [task.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const dependency of graphDependencies) {
    inDegree.set(
      dependency.taskId,
      (inDegree.get(dependency.taskId) ?? 0) + 1,
    );
    outgoing.set(dependency.dependsOnTaskId, [
      ...(outgoing.get(dependency.dependsOnTaskId) ?? []),
      dependency.taskId,
    ]);
  }

  const queue = graphTasks
    .filter((task) => inDegree.get(task.id) === 0)
    .map((task) => task.id);
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    visited.add(id);
    for (const downstreamId of outgoing.get(id) ?? []) {
      levels.set(
        downstreamId,
        Math.max(
          levels.get(downstreamId) ?? 0,
          (levels.get(id) ?? 0) + 1,
        ),
      );
      const remaining = (inDegree.get(downstreamId) ?? 1) - 1;
      inDegree.set(downstreamId, remaining);
      if (remaining === 0) queue.push(downstreamId);
    }
  }

  const fallbackLevel = Math.max(0, ...levels.values()) + 1;
  for (const task of graphTasks) {
    if (!visited.has(task.id)) levels.set(task.id, fallbackLevel);
  }
  const layerCount = graphTasks.length
    ? Math.max(...graphTasks.map((task) => levels.get(task.id) ?? 0)) + 1
    : 0;
  const layers = Array.from({ length: layerCount }, (_, level) =>
    graphTasks.filter((task) => (levels.get(task.id) ?? 0) === level),
  ).filter((layer) => layer.length);

  return { tasks: graphTasks, dependencies: graphDependencies, layers };
}

function formatDue(value: string | null) {
  if (!value) return 'No deadline';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatActivity(value: string) {
  const date = new Date(
    value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'),
  );
  if (!Number.isFinite(date.getTime())) return value;
  const minutes = Math.max(
    0,
    Math.round((Date.now() - date.getTime()) / 60000),
  );
  if (minutes < 2) return 'Active now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hours ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}

function eventLabel(event: string) {
  return event
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function eventActionLabel(event: string) {
  return event === 'assessment_result_received'
    ? 'Record result received'
    : event === 'interview_received'
      ? 'Record interview'
      : `Record ${eventLabel(event).toLowerCase()}`;
}

function previewText(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function changePreviewTaskStatus(
  snapshot: TaskWorkspaceSnapshot,
  taskId: string,
  status: WorkTaskStatus,
) {
  let tasks = snapshot.tasks.map((candidate) =>
    candidate.id === taskId
      ? {
          ...candidate,
          status,
          completedAt: status === 'done' ? new Date().toISOString() : null,
        }
      : candidate,
  );
  if (['done', 'cancelled'].includes(status)) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    tasks = tasks.map((candidate) => {
      if (
        candidate.status !== 'planned' ||
        (candidate.activationEvent &&
          candidate.waitingReason !== 'Waiting for dependencies')
      ) {
        return candidate;
      }
      const prerequisites = snapshot.dependencies.filter(
        (dependency) => dependency.taskId === candidate.id,
      );
      return prerequisites.length &&
        prerequisites.every((dependency) =>
          ['done', 'cancelled'].includes(
            byId.get(dependency.dependsOnTaskId)?.status ?? 'planned',
          ),
        )
        ? { ...candidate, status: 'ready' as const, waitingReason: '' }
        : candidate;
    });
  }
  return { ...snapshot, tasks };
}

function recordPreviewEvent(
  snapshot: TaskWorkspaceSnapshot,
  workflowKey: string,
  eventType: string,
) {
  let tasks = snapshot.tasks.map((task) =>
    task.workflowKey === workflowKey && task.status === 'waiting'
      ? {
          ...task,
          status: (task.parentId ? 'done' : 'doing') as WorkTaskStatus,
          completedAt: task.parentId ? new Date().toISOString() : null,
          waitingReason: '',
        }
      : task,
  );
  const byId = new Map(tasks.map((task) => [task.id, task]));
  tasks = tasks.map((task) => {
    if (
      task.workflowKey !== workflowKey ||
      task.activationEvent !== eventType ||
      task.status !== 'planned'
    ) {
      return task;
    }
    const unresolved = snapshot.dependencies.some(
      (dependency) =>
        dependency.taskId === task.id &&
        !['done', 'cancelled'].includes(
          byId.get(dependency.dependsOnTaskId)?.status ?? 'planned',
        ),
    );
    return {
      ...task,
      status: unresolved ? ('planned' as const) : ('ready' as const),
      waitingReason: unresolved ? 'Waiting for dependencies' : '',
    };
  });
  return { ...snapshot, tasks };
}

function addPreviewDependency(
  snapshot: TaskWorkspaceSnapshot,
  taskId: string,
  dependsOnTaskId: string,
) {
  const prerequisite = snapshot.tasks.find(
    (task) => task.id === dependsOnTaskId,
  );
  const unresolved =
    prerequisite && !['done', 'cancelled'].includes(prerequisite.status);
  return {
    ...snapshot,
    dependencies: [
      ...snapshot.dependencies,
      {
        id: `preview_dependency_${Date.now()}`,
        taskId,
        dependsOnTaskId,
        requirement: 'complete' as const,
      },
    ],
    tasks: snapshot.tasks.map((task) =>
      task.id === taskId &&
      unresolved &&
      ['inbox', 'ready'].includes(task.status)
        ? {
            ...task,
            status: 'planned' as const,
            waitingReason: 'Waiting for dependencies',
          }
        : task,
    ),
  };
}

function removePreviewDependency(
  snapshot: TaskWorkspaceSnapshot,
  dependencyId: string,
) {
  const removed = snapshot.dependencies.find(
    (dependency) => dependency.id === dependencyId,
  );
  if (!removed) return snapshot;
  const dependencies = snapshot.dependencies.filter(
    (dependency) => dependency.id !== dependencyId,
  );
  const byId = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const tasks = snapshot.tasks.map((task) => {
    if (task.id !== removed.taskId || task.status !== 'planned') return task;
    const unresolved = dependencies.some(
      (dependency) =>
        dependency.taskId === task.id &&
        !['done', 'cancelled'].includes(
          byId.get(dependency.dependsOnTaskId)?.status ?? 'planned',
        ),
    );
    const eventSatisfied =
      !task.activationEvent || task.waitingReason === 'Waiting for dependencies';
    return !unresolved && eventSatisfied
      ? { ...task, status: 'ready' as const, waitingReason: '' }
      : task;
  });
  return { ...snapshot, dependencies, tasks };
}

function addPreviewTask(
  snapshot: TaskWorkspaceSnapshot,
  input: Record<string, unknown>,
) {
  const task: WorkTaskView = {
    id: `preview_task_${Date.now()}`,
    title: previewText(input.title),
    description: previewText(input.description),
    contextType: input.contextType as WorkContextType,
    contextName: previewText(input.contextName),
    parentId: previewText(input.parentId) || null,
    workflowKey: null,
    workflowType: null,
    status: input.status as WorkTaskStatus,
    priority: input.priority as WorkTaskPriority,
    executorType: input.executorType as WorkExecutorType,
    accountableName: 'Jenny Men',
    waitingReason: previewText(input.waitingReason),
    activationEvent: null,
    conditionText: '',
    sourceLabel: previewText(input.sourceLabel),
    sourcePath: previewText(input.sourcePath),
    startAt: null,
    dueAt: previewText(input.dueAt)
      ? new Date(previewText(input.dueAt)).toISOString()
      : null,
    completedAt: input.status === 'done' ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
  };
  return { ...snapshot, tasks: [...snapshot.tasks, task] };
}

function addPreviewWorkflow(
  snapshot: TaskWorkspaceSnapshot,
  template: StarterWorkflowType,
  jobTitle: string,
): TaskWorkspaceSnapshot {
  const stamp = Date.now();
  const workflowKey = `preview_${template}_${stamp}`;
  const sourcePath =
    template === 'skills_assessment'
      ? '05 Goals/Active/Skilled Migration Outcome/Workstreams/ACS Skills Assessment.md'
      : template === 'job_application'
        ? '05 Goals/Active/Next IT Role/GOAL.md'
        : '03 Agenda/Journal/2026/2026-W37.md';
  const rootId = `preview_root_${stamp}`;
  const event =
    template === 'skills_assessment'
      ? 'assessment_result_received'
      : template === 'job_application'
        ? 'interview_received'
        : null;
  const label =
    template === 'skills_assessment'
      ? 'ACS skills assessment'
      : template === 'job_application'
        ? `Apply: ${jobTitle}`
        : '2026-W37 commitments';
  const shared = {
    contextType: (template === 'skills_assessment'
      ? 'personal'
      : 'project') as WorkContextType,
    contextName:
      template === 'skills_assessment'
        ? 'Skilled migration'
        : template === 'job_application'
          ? jobTitle
          : 'Weekly commitments',
    workflowKey,
    workflowType:
      template === 'skills_assessment'
        ? 'Skills assessment'
        : template === 'job_application'
          ? 'Job application'
          : 'Weekly journal',
    accountableName: 'Jenny Men',
    sourceLabel:
      template === 'skills_assessment'
        ? 'ACS Skills Assessment'
        : template === 'job_application'
          ? 'Next IT Role goal'
          : '2026-W37 journal',
    sourcePath,
    startAt: null,
    dueAt: null,
    completedAt: null,
    updatedAt: new Date().toISOString(),
  };
  const root: WorkTaskView = {
    ...shared,
    id: rootId,
    title: label,
    description: 'Conditional starter workflow created in preview.',
    parentId: null,
    status: template === 'skills_assessment' ? 'waiting' : 'doing',
    priority: 'high',
    executorType: 'hybrid',
    waitingReason:
      template === 'skills_assessment' ? 'Waiting for assessment result' : '',
    activationEvent: null,
    conditionText: '',
  };
  const ready: WorkTaskView = {
    ...shared,
    id: `preview_ready_${stamp}`,
    title:
      template === 'skills_assessment'
        ? 'Wait for assessment outcome'
        : template === 'job_application'
          ? 'Check eligibility and migration relevance'
          : 'Review this week’s commitments',
    description: 'First active step.',
    parentId: rootId,
    status: template === 'skills_assessment' ? 'waiting' : 'ready',
    priority: 'high',
    executorType: 'human',
    waitingReason: template === 'skills_assessment' ? 'External result' : '',
    activationEvent: null,
    conditionText: '',
  };
  if (!event) {
    return { ...snapshot, tasks: [...snapshot.tasks, root, ready] };
  }
  const conditional: WorkTaskView = {
    ...shared,
    id: `preview_conditional_${stamp}`,
    title:
      template === 'skills_assessment'
        ? 'Review assessment result'
        : 'Prepare interview evidence pack',
    description: 'This task is excluded from progress until its event occurs.',
    parentId: rootId,
    status: 'planned',
    priority: 'urgent',
    executorType: 'hybrid',
    waitingReason: 'Condition not met',
    activationEvent: event,
    conditionText: `Activates when ${eventLabel(event).toLowerCase()}`,
  };
  return {
    ...snapshot,
    tasks: [...snapshot.tasks, root, ready, conditional],
    dependencies: [
      ...snapshot.dependencies,
      {
        id: `preview_dependency_${stamp}`,
        taskId: conditional.id,
        dependsOnTaskId: ready.id,
        requirement: 'complete',
      },
    ],
  };
}

function addPreviewAgent(
  snapshot: TaskWorkspaceSnapshot,
  input: Record<string, unknown>,
) {
  const taskId = previewText(input.taskId) || null;
  const session: AgentSessionView = {
    id: `preview_agent_${Date.now()}`,
    taskId,
    taskTitle:
      snapshot.tasks.find((task) => task.id === taskId)?.title ??
      'Unlinked work',
    name: previewText(input.name),
    codexThreadId: previewText(input.codexThreadId),
    status: input.status as AgentSessionStatus,
    summary: previewText(input.summary),
    nextAction: previewText(input.nextAction),
    lastHeartbeatAt:
      input.status === 'working' ? new Date().toISOString() : null,
    startedAt: input.status === 'working' ? new Date().toISOString() : null,
    completedAt: input.status === 'completed' ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
  };
  return { ...snapshot, agentSessions: [...snapshot.agentSessions, session] };
}
