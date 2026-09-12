export type WorkContextType =
  | 'personal'
  | 'relationship'
  | 'company'
  | 'project';

export type WorkTaskStatus =
  | 'inbox'
  | 'planned'
  | 'ready'
  | 'doing'
  | 'review'
  | 'waiting'
  | 'blocked'
  | 'done'
  | 'cancelled';

export type WorkTaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type WorkExecutorType = 'human' | 'agent' | 'hybrid';

export type AgentSessionStatus =
  | 'queued'
  | 'working'
  | 'waiting_for_founder'
  | 'waiting_for_dependency'
  | 'review'
  | 'blocked'
  | 'completed'
  | 'failed';

export type WorkTaskView = {
  id: string;
  title: string;
  description: string;
  contextType: WorkContextType;
  contextName: string;
  parentId: string | null;
  workflowKey: string | null;
  workflowType: string | null;
  status: WorkTaskStatus;
  priority: WorkTaskPriority;
  executorType: WorkExecutorType;
  accountableName: string;
  waitingReason: string;
  activationEvent: string | null;
  conditionText: string;
  sourceLabel: string;
  sourcePath: string;
  startAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type AgentSessionView = {
  id: string;
  taskId: string | null;
  taskTitle: string;
  name: string;
  codexThreadId: string;
  status: AgentSessionStatus;
  summary: string;
  nextAction: string;
  lastHeartbeatAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type TaskDependencyView = {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
  requirement: 'complete';
};

export type TaskWorkspaceSnapshot = {
  tasks: WorkTaskView[];
  dependencies: TaskDependencyView[];
  agentSessions: AgentSessionView[];
  agentCapacity: number;
};

export type StarterWorkflowType =
  | 'skills_assessment'
  | 'job_application'
  | 'weekly_journal';
