import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
};

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    authUserId: text('auth_user_id'),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    role: text('role', {
      enum: ['registered_user', 'consultant', 'super_admin'],
    })
      .notNull()
      .default('registered_user'),
    status: text('status', {
      enum: ['invited', 'active', 'suspended', 'deactivated'],
    })
      .notNull()
      .default('invited'),
    emailVerifiedAt: text('email_verified_at'),
    onboardingStatus: text('onboarding_status', {
      enum: ['not_started', 'profile_review', 'complete'],
    })
      .notNull()
      .default('not_started'),
    lastActiveAt: text('last_active_at'),
    suspendedAt: text('suspended_at'),
    suspendedReason: text('suspended_reason'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('idx_users_email').on(table.email),
    uniqueIndex('idx_users_auth_user_id').on(table.authUserId),
    index('idx_users_role_status').on(table.role, table.status),
    index('idx_users_created_at').on(table.createdAt),
  ],
);

export const consultantProfiles = sqliteTable(
  'consultant_profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    speciality: text('speciality').notNull().default(''),
    serviceScope: text('service_scope').notNull().default(''),
    applicationStatus: text('application_status', {
      enum: [
        'draft',
        'submitted',
        'more_information_required',
        'approved',
        'rejected',
        'withdrawn',
      ],
    })
      .notNull()
      .default('draft'),
    checksCompleted: integer('checks_completed').notNull().default(0),
    checksRequired: integer('checks_required').notNull().default(5),
    submittedAt: text('submitted_at'),
    decidedAt: text('decided_at'),
    decidedBy: text('decided_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    decisionReason: text('decision_reason'),
    internalNotes: text('internal_notes'),
    ...timestamps,
  },
  (table) => [
    index('idx_consultants_application_status').on(table.applicationStatus),
  ],
);

export const consultantAssignments = sqliteTable(
  'consultant_assignments',
  {
    id: text('id').primaryKey(),
    candidateUserId: text('candidate_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    consultantUserId: text('consultant_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['active', 'ended'] })
      .notNull()
      .default('active'),
    consentScope: text('consent_scope').notNull(),
    consentedAt: text('consented_at').notNull(),
    assignedBy: text('assigned_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    endedAt: text('ended_at'),
    endedBy: text('ended_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    ...timestamps,
  },
  (table) => [
    index('idx_assignments_candidate_status').on(
      table.candidateUserId,
      table.status,
    ),
    index('idx_assignments_consultant_status').on(
      table.consultantUserId,
      table.status,
    ),
  ],
);

export const crmProfiles = sqliteTable(
  'crm_profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    stage: text('stage', {
      enum: [
        'lead',
        'qualified',
        'onboarding',
        'active_search',
        'placed',
        'nurture',
      ],
    })
      .notNull()
      .default('lead'),
    priority: text('priority', { enum: ['low', 'normal', 'high'] })
      .notNull()
      .default('normal'),
    ownerUserId: text('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    source: text('source').notNull().default('Pip'),
    tagsJson: text('tags_json').notNull().default('[]'),
    nextAction: text('next_action').notNull().default(''),
    nextFollowUpAt: text('next_follow_up_at'),
    lastContactedAt: text('last_contacted_at'),
    ...timestamps,
  },
  (table) => [
    index('idx_crm_profiles_stage').on(table.stage, table.updatedAt),
    index('idx_crm_profiles_follow_up').on(table.nextFollowUpAt),
    index('idx_crm_profiles_owner').on(table.ownerUserId, table.stage),
  ],
);

export const crmActivities = sqliteTable(
  'crm_activities',
  {
    id: text('id').primaryKey(),
    contactUserId: text('contact_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    activityType: text('activity_type', {
      enum: ['note', 'call', 'email', 'meeting', 'status_change'],
    }).notNull(),
    summary: text('summary').notNull(),
    occurredAt: text('occurred_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_crm_activities_contact').on(
      table.contactUserId,
      table.occurredAt,
    ),
    index('idx_crm_activities_occurred').on(table.occurredAt),
  ],
);

export const crmTasks = sqliteTable(
  'crm_tasks',
  {
    id: text('id').primaryKey(),
    contactUserId: text('contact_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedTo: text('assigned_to').references(() => users.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    dueAt: text('due_at').notNull(),
    status: text('status', { enum: ['open', 'completed'] })
      .notNull()
      .default('open'),
    priority: text('priority', { enum: ['low', 'normal', 'high'] })
      .notNull()
      .default('normal'),
    completedAt: text('completed_at'),
    ...timestamps,
  },
  (table) => [
    index('idx_crm_tasks_status_due').on(table.status, table.dueAt),
    index('idx_crm_tasks_contact').on(table.contactUserId, table.status),
    index('idx_crm_tasks_assignee').on(table.assignedTo, table.status),
  ],
);

export const workTasks = sqliteTable(
  'work_tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    contextType: text('context_type', {
      enum: ['personal', 'relationship', 'company', 'project'],
    }).notNull(),
    contextName: text('context_name').notNull(),
    parentId: text('parent_id'),
    workflowKey: text('workflow_key'),
    workflowType: text('workflow_type'),
    status: text('status', {
      enum: [
        'inbox',
        'planned',
        'ready',
        'doing',
        'review',
        'waiting',
        'blocked',
        'done',
        'cancelled',
      ],
    })
      .notNull()
      .default('inbox'),
    priority: text('priority', {
      enum: ['low', 'normal', 'high', 'urgent'],
    })
      .notNull()
      .default('normal'),
    executorType: text('executor_type', {
      enum: ['human', 'agent', 'hybrid'],
    })
      .notNull()
      .default('human'),
    accountableUserId: text('accountable_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    waitingReason: text('waiting_reason'),
    activationEvent: text('activation_event'),
    conditionText: text('condition_text'),
    sourceLabel: text('source_label'),
    sourcePath: text('source_path'),
    startAt: text('start_at'),
    dueAt: text('due_at'),
    completedAt: text('completed_at'),
    ...timestamps,
  },
  (table) => [
    index('idx_work_tasks_status_due').on(table.status, table.dueAt),
    index('idx_work_tasks_context').on(table.contextType, table.contextName),
    index('idx_work_tasks_parent').on(table.parentId),
    index('idx_work_tasks_workflow').on(table.workflowKey, table.status),
    index('idx_work_tasks_executor').on(table.executorType, table.status),
  ],
);

export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => workTasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: text('depends_on_task_id')
      .notNull()
      .references(() => workTasks.id, { onDelete: 'cascade' }),
    requirement: text('requirement', { enum: ['complete', 'successful'] })
      .notNull()
      .default('complete'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('idx_task_dependencies_unique').on(
      table.taskId,
      table.dependsOnTaskId,
    ),
    index('idx_task_dependencies_prerequisite').on(table.dependsOnTaskId),
  ],
);

export const taskEvents = sqliteTable(
  'task_events',
  {
    id: text('id').primaryKey(),
    workflowKey: text('workflow_key').notNull(),
    eventType: text('event_type').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    actorUserId: text('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    occurredAt: text('occurred_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('idx_task_events_workflow_event').on(
      table.workflowKey,
      table.eventType,
    ),
    index('idx_task_events_occurred').on(table.occurredAt),
  ],
);

export const agentSessions = sqliteTable(
  'agent_sessions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').references(() => workTasks.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    codexThreadId: text('codex_thread_id'),
    status: text('status', {
      enum: [
        'queued',
        'working',
        'waiting_for_founder',
        'waiting_for_dependency',
        'review',
        'blocked',
        'completed',
        'failed',
      ],
    })
      .notNull()
      .default('queued'),
    summary: text('summary').notNull().default(''),
    nextAction: text('next_action').notNull().default(''),
    lastHeartbeatAt: text('last_heartbeat_at'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    ...timestamps,
  },
  (table) => [
    index('idx_agent_sessions_status').on(table.status, table.updatedAt),
    index('idx_agent_sessions_task').on(table.taskId, table.status),
    uniqueIndex('idx_agent_sessions_codex_thread').on(table.codexThreadId),
  ],
);

export const commissionStaff = sqliteTable(
  'commission_staff',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    team: text('team', {
      enum: ['marketing', 'field_promotion', 'operations', 'sales', 'other'],
    }).notNull(),
    status: text('status', { enum: ['active', 'inactive'] })
      .notNull()
      .default('active'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('idx_commission_staff_email').on(table.email),
    index('idx_commission_staff_team_status').on(table.team, table.status),
  ],
);

export const commissionRules = sqliteTable(
  'commission_rules',
  {
    sourceType: text('source_type', {
      enum: ['marketing', 'field_promotion', 'operations', 'referral'],
    }).primaryKey(),
    poolRateBps: integer('pool_rate_bps').notNull(),
    leadShareBps: integer('lead_share_bps').notNull(),
    salesShareBps: integer('sales_share_bps').notNull(),
    holdDays: integer('hold_days').notNull().default(7),
    updatedBy: text('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [index('idx_commission_rules_updated').on(table.updatedAt)],
);

export const commissionEntries = sqliteTable(
  'commission_entries',
  {
    id: text('id').primaryKey(),
    contactUserId: text('contact_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    sourceType: text('source_type', {
      enum: ['marketing', 'field_promotion', 'operations', 'referral'],
    }).notNull(),
    sourceDetail: text('source_detail').notNull().default(''),
    leadStaffId: text('lead_staff_id').references(() => commissionStaff.id, {
      onDelete: 'set null',
    }),
    salesStaffId: text('sales_staff_id').references(() => commissionStaff.id, {
      onDelete: 'set null',
    }),
    grossAmountCents: integer('gross_amount_cents').notNull(),
    currency: text('currency', { enum: ['AUD', 'NZD'] })
      .notNull()
      .default('AUD'),
    poolRateBps: integer('pool_rate_bps').notNull(),
    leadShareBps: integer('lead_share_bps').notNull(),
    salesShareBps: integer('sales_share_bps').notNull(),
    commissionPoolCents: integer('commission_pool_cents').notNull(),
    leadCommissionCents: integer('lead_commission_cents').notNull(),
    salesCommissionCents: integer('sales_commission_cents').notNull(),
    status: text('status', {
      enum: ['pending', 'approved', 'paid', 'reversed'],
    })
      .notNull()
      .default('pending'),
    convertedAt: text('converted_at').notNull(),
    eligibleAt: text('eligible_at').notNull(),
    approvedAt: text('approved_at'),
    paidAt: text('paid_at'),
    reversedAt: text('reversed_at'),
    stripeInvoiceId: text('stripe_invoice_id'),
    note: text('note').notNull().default(''),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('idx_commission_entries_invoice').on(table.stripeInvoiceId),
    index('idx_commission_entries_status_eligible').on(
      table.status,
      table.eligibleAt,
    ),
    index('idx_commission_entries_contact').on(
      table.contactUserId,
      table.convertedAt,
    ),
    index('idx_commission_entries_lead_staff').on(
      table.leadStaffId,
      table.status,
    ),
    index('idx_commission_entries_sales_staff').on(
      table.salesStaffId,
      table.status,
    ),
  ],
);

export const workflowRuns = sqliteTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    workflowType: text('workflow_type').notNull(),
    status: text('status', {
      enum: ['queued', 'running', 'succeeded', 'partial', 'failed'],
    })
      .notNull()
      .default('queued'),
    summary: text('summary').notNull().default(''),
    errorCode: text('error_code'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    ...timestamps,
  },
  (table) => [
    index('idx_workflow_runs_status_created').on(table.status, table.createdAt),
    index('idx_workflow_runs_user_created').on(table.userId, table.createdAt),
  ],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorUserId: text('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actorEmail: text('actor_email').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason'),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    requestId: text('request_id').notNull(),
    outcome: text('outcome', { enum: ['succeeded', 'denied', 'failed'] })
      .notNull()
      .default('succeeded'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_audit_target').on(
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    index('idx_audit_actor').on(table.actorUserId, table.createdAt),
    index('idx_audit_action').on(table.action, table.createdAt),
  ],
);

export const platformSettings = sqliteTable('platform_settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedBy: text('updated_by').references(() => users.id, {
    onDelete: 'set null',
  }),
  ...timestamps,
});

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripePriceId: text('stripe_price_id'),
    status: text('status', {
      enum: [
        'inactive',
        'incomplete',
        'incomplete_expired',
        'trialing',
        'active',
        'past_due',
        'unpaid',
        'paused',
        'canceled',
      ],
    })
      .notNull()
      .default('inactive'),
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' })
      .notNull()
      .default(false),
    currentPeriodEnd: text('current_period_end'),
    cancelAt: text('cancel_at'),
    canceledAt: text('canceled_at'),
    latestInvoiceId: text('latest_invoice_id'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('idx_subscriptions_stripe_customer').on(table.stripeCustomerId),
    uniqueIndex('idx_subscriptions_stripe_subscription').on(
      table.stripeSubscriptionId,
    ),
    index('idx_subscriptions_status').on(table.status),
  ],
);

export const resumeGenerationUsage = sqliteTable(
  'resume_generation_usage',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    freeGenerationLimit: integer('free_generation_limit').notNull().default(2),
    freeGenerationsUsed: integer('free_generations_used').notNull().default(0),
    totalGenerations: integer('total_generations').notNull().default(0),
    ...timestamps,
  },
  (table) => [index('idx_resume_generation_usage_updated').on(table.updatedAt)],
);

export const billingEvents = sqliteTable(
  'billing_events',
  {
    stripeEventId: text('stripe_event_id').primaryKey(),
    eventType: text('event_type').notNull(),
    processedAt: text('processed_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_billing_events_processed').on(table.processedAt)],
);
