import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';
import type {
  StarterWorkflowType,
  WorkContextType,
  WorkExecutorType,
  WorkTaskPriority,
  WorkTaskStatus,
} from '@/lib/task-types';

export const dynamic = 'force-dynamic';

type TemplateTask = {
  key: string;
  title: string;
  description: string;
  contextType: WorkContextType;
  contextName: string;
  parentKey?: string;
  status: WorkTaskStatus;
  priority: WorkTaskPriority;
  executorType: WorkExecutorType;
  waitingReason?: string;
  activationEvent?: string;
  conditionText?: string;
  sourceLabel: string;
  sourcePath: string;
  dependsOn?: string[];
};

const skillsSource =
  '05 Goals/Active/Skilled Migration Outcome/Workstreams/ACS Skills Assessment.md';
const migrationGoal = '05 Goals/Active/Skilled Migration Outcome/GOAL.md';
const roleGoal = '05 Goals/Active/Next IT Role/GOAL.md';
const journalSource = '03 Agenda/Journal/2026/2026-W37.md';

function skillsAssessmentTasks(): TemplateTask[] {
  return [
    {
      key: 'root',
      title: 'ACS skills assessment outcome',
      description:
        'Track the submitted assessment and activate post-result migration work.',
      contextType: 'personal',
      contextName: 'Skilled migration',
      status: 'waiting',
      priority: 'high',
      executorType: 'hybrid',
      waitingReason: 'Waiting for the ACS outcome',
      sourceLabel: 'ACS Skills Assessment',
      sourcePath: skillsSource,
    },
    {
      key: 'wait',
      parentKey: 'root',
      title: 'Wait for assessment outcome',
      description:
        'No routine ACS action is required while the outcome is pending.',
      contextType: 'personal',
      contextName: 'Skilled migration',
      status: 'waiting',
      priority: 'normal',
      executorType: 'human',
      waitingReason: 'External result',
      sourceLabel: 'ACS Skills Assessment',
      sourcePath: skillsSource,
    },
    {
      key: 'review',
      parentKey: 'root',
      title: 'Review result, occupation and validity dates',
      description: 'Verify the outcome before changing any migration pathway.',
      contextType: 'personal',
      contextName: 'Skilled migration',
      status: 'planned',
      priority: 'urgent',
      executorType: 'hybrid',
      waitingReason: 'Condition not met',
      activationEvent: 'assessment_result_received',
      conditionText: 'Activates when the ACS result is received',
      sourceLabel: 'Skilled Migration Outcome',
      sourcePath: migrationGoal,
    },
    {
      key: 'evidence',
      parentKey: 'root',
      title: 'Save result and update migration evidence',
      description:
        'Record the result, dates, evidence and affected assumptions.',
      contextType: 'personal',
      contextName: 'Skilled migration',
      status: 'planned',
      priority: 'high',
      executorType: 'agent',
      waitingReason: 'Condition not met',
      activationEvent: 'assessment_result_received',
      conditionText: 'Activates when the ACS result is received',
      sourceLabel: 'Skilled Migration Outcome',
      sourcePath: migrationGoal,
    },
    {
      key: 'advice',
      parentKey: 'root',
      title: 'Validate pathway impact with the migration agent',
      description: 'Confirm points, sequence and job-relevance implications.',
      contextType: 'relationship',
      contextName: 'Migration adviser',
      status: 'planned',
      priority: 'high',
      executorType: 'human',
      waitingReason: 'Condition not met',
      activationEvent: 'assessment_result_received',
      conditionText: 'Activates when the ACS result is received',
      sourceLabel: 'Skilled Migration Outcome',
      sourcePath: migrationGoal,
    },
  ];
}

function jobApplicationTasks(jobTitle: string): TemplateTask[] {
  const contextName = jobTitle || 'New job application';
  return [
    {
      key: 'root',
      title: `Apply: ${contextName}`,
      description:
        'Approval-gated application workflow with an interview branch.',
      contextType: 'project',
      contextName,
      status: 'doing',
      priority: 'high',
      executorType: 'hybrid',
      sourceLabel: 'Next IT Role goal',
      sourcePath: roleGoal,
    },
    {
      key: 'eligibility',
      parentKey: 'root',
      title: 'Check eligibility and migration relevance',
      description: 'Separate verified facts from assumptions before applying.',
      contextType: 'project',
      contextName,
      status: 'ready',
      priority: 'urgent',
      executorType: 'hybrid',
      sourceLabel: 'Next IT Role goal',
      sourcePath: roleGoal,
    },
    {
      key: 'resume',
      parentKey: 'root',
      title: 'Prepare evidence-backed tailored résumé',
      description: 'Use only claims supported by the canonical evidence bank.',
      contextType: 'project',
      contextName,
      status: 'planned',
      priority: 'high',
      executorType: 'agent',
      sourceLabel: 'Next IT Role goal',
      sourcePath: roleGoal,
      dependsOn: ['eligibility'],
    },
    {
      key: 'review',
      parentKey: 'root',
      title: 'Review application manually',
      description: 'Approve every claim and document before submission.',
      contextType: 'project',
      contextName,
      status: 'planned',
      priority: 'high',
      executorType: 'human',
      sourceLabel: 'Next IT Role goal',
      sourcePath: roleGoal,
      dependsOn: ['resume'],
    },
    {
      key: 'submit',
      parentKey: 'root',
      title: 'Submit application and record it',
      description: 'Submit manually and update the application pipeline.',
      contextType: 'project',
      contextName,
      status: 'planned',
      priority: 'high',
      executorType: 'human',
      sourceLabel: 'Next IT Role goal',
      sourcePath: roleGoal,
      dependsOn: ['review'],
    },
    {
      key: 'interview_pack',
      parentKey: 'root',
      title: 'Prepare interview evidence pack',
      description:
        'Prepare role evidence, stories, questions and rehearsal tasks.',
      contextType: 'project',
      contextName,
      status: 'planned',
      priority: 'urgent',
      executorType: 'agent',
      waitingReason: 'Condition not met',
      activationEvent: 'interview_received',
      conditionText: 'Activates when an interview invitation is recorded',
      sourceLabel: 'Next IT Role goal',
      sourcePath: roleGoal,
    },
    {
      key: 'reference_draft',
      parentKey: 'root',
      title: 'Draft reference-request email',
      description: 'Prepare a personalised draft; do not send automatically.',
      contextType: 'relationship',
      contextName: 'Professional references',
      status: 'planned',
      priority: 'high',
      executorType: 'agent',
      waitingReason: 'Condition not met',
      activationEvent: 'interview_received',
      conditionText: 'Activates when an interview invitation is recorded',
      sourceLabel: 'Next IT Role goal',
      sourcePath: roleGoal,
    },
    {
      key: 'reference_send',
      parentKey: 'root',
      title: 'Review and send reference request',
      description: 'Human approval and sending are required.',
      contextType: 'relationship',
      contextName: 'Professional references',
      status: 'planned',
      priority: 'high',
      executorType: 'human',
      sourceLabel: 'Next IT Role goal',
      sourcePath: roleGoal,
      dependsOn: ['reference_draft'],
    },
  ];
}

function weeklyJournalTasks(): TemplateTask[] {
  return [
    {
      key: 'root',
      title: '2026-W37 commitments',
      description: 'Current actions collected from the active weekly journal.',
      contextType: 'project',
      contextName: 'Weekly commitments',
      status: 'doing',
      priority: 'high',
      executorType: 'hybrid',
      sourceLabel: '2026-W37 journal',
      sourcePath: journalSource,
    },
    {
      key: 'applications',
      parentKey: 'root',
      title: 'Apply for every suitable opportunity',
      description:
        'Use the approval-gated job application workflow for each selected role.',
      contextType: 'project',
      contextName: 'Next IT role',
      status: 'ready',
      priority: 'urgent',
      executorType: 'hybrid',
      sourceLabel: '2026-W37 journal',
      sourcePath: journalSource,
    },
    {
      key: 'pte',
      parentKey: 'root',
      title: 'Complete the scheduled PTE study block',
      description: 'Record the study outcome against the PTE goal.',
      contextType: 'personal',
      contextName: 'English learning',
      status: 'ready',
      priority: 'high',
      executorType: 'human',
      sourceLabel: '2026-W37 journal',
      sourcePath: journalSource,
    },
    {
      key: 'outreach',
      parentKey: 'root',
      title: 'Send 3–5 personalised customer messages',
      description: 'Record the messages in the Proairesis AI sales pipeline.',
      contextType: 'company',
      contextName: 'Proairesis AI',
      status: 'ready',
      priority: 'high',
      executorType: 'human',
      sourceLabel: '2026-W37 journal',
      sourcePath: journalSource,
    },
    {
      key: 'reference',
      parentKey: 'root',
      title: 'Email Graham about being a referee',
      description: 'Draft with an agent; review and send personally.',
      contextType: 'relationship',
      contextName: 'Professional references',
      status: 'ready',
      priority: 'high',
      executorType: 'hybrid',
      sourceLabel: '2026-W37 journal',
      sourcePath: journalSource,
    },
    {
      key: 'agents',
      parentKey: 'root',
      title: 'Pilot an Agent Group on real daily work',
      description: 'Test permissions, handoffs, reporting and human review.',
      contextType: 'project',
      contextName: 'Personal operations',
      status: 'doing',
      priority: 'normal',
      executorType: 'hybrid',
      sourceLabel: '2026-W37 journal',
      sourcePath: journalSource,
    },
  ];
}

export async function POST(request: Request) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;
  const body = await readJsonObject(request);
  const templateType = body?.templateType as StarterWorkflowType;
  const jobTitle = cleanText(body?.jobTitle, 160);
  if (
    !['skills_assessment', 'job_application', 'weekly_journal'].includes(
      templateType,
    )
  ) {
    return Response.json(
      { error: 'Choose a supported workflow.' },
      { status: 400 },
    );
  }

  const { actor, db } = authorization.value;
  const workflowKey = `${templateType}_${crypto.randomUUID()}`;
  const workflowType =
    templateType === 'skills_assessment'
      ? 'Skills assessment'
      : templateType === 'job_application'
        ? 'Job application'
        : 'Weekly journal';
  const template =
    templateType === 'skills_assessment'
      ? skillsAssessmentTasks()
      : templateType === 'job_application'
        ? jobApplicationTasks(jobTitle)
        : weeklyJournalTasks();
  const ids = new Map(
    template.map((task) => [task.key, `task_${crypto.randomUUID()}`]),
  );

  const statements = template.map((task) =>
    db
      .prepare(
        `INSERT INTO work_tasks (
           id, title, description, context_type, context_name, parent_id,
           workflow_key, workflow_type, status, priority, executor_type,
           accountable_user_id, waiting_reason, activation_event, condition_text,
           source_label, source_path, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(
        ids.get(task.key),
        task.title,
        task.description,
        task.contextType,
        task.contextName,
        task.parentKey ? ids.get(task.parentKey) : null,
        workflowKey,
        workflowType,
        task.status,
        task.priority,
        task.executorType,
        actor.id,
        task.waitingReason ?? null,
        task.activationEvent ?? null,
        task.conditionText ?? null,
        task.sourceLabel,
        task.sourcePath,
      ),
  );

  for (const task of template) {
    for (const dependencyKey of task.dependsOn ?? []) {
      statements.push(
        db
          .prepare(
            `INSERT INTO task_dependencies (
               id, task_id, depends_on_task_id, requirement, created_at
             ) VALUES (?, ?, ?, 'complete', CURRENT_TIMESTAMP)`,
          )
          .bind(
            `dependency_${crypto.randomUUID()}`,
            ids.get(task.key),
            ids.get(dependencyKey),
          ),
      );
    }
  }

  statements.push(
    auditStatement(db, {
      actor,
      action: 'work.workflow_created',
      targetType: 'work_workflow',
      targetId: workflowKey,
      reason: `Created ${workflowType} starter workflow`,
      after: { templateType, jobTitle, taskCount: template.length },
      requestId: crypto.randomUUID(),
    }),
  );

  try {
    await db.batch(statements);
    return Response.json(
      { workflowKey, rootTaskId: ids.get('root'), taskCount: template.length },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
