import { redirect } from 'next/navigation';
import { chatGPTSignInPath, getChatGPTUser } from '@/app/chatgpt-auth';
import { getDatabase, getRuntimeAdminEmails } from '@/db';
import { demoAdmin, demoSnapshot } from './admin-demo';
import type {
  AdminIdentity,
  AdminSnapshot,
  AdminUserView,
  AssignmentView,
  AuditEventView,
  CommissionEntryView,
  CommissionRuleView,
  CommissionSource,
  CommissionStaffView,
  ConsultantView,
  CrmActivityView,
  CrmContactView,
  CrmTaskView,
  WorkflowRunView,
} from './admin-types';

const commissionSources: CommissionSource[] = [
  'marketing',
  'field_promotion',
  'operations',
  'referral',
];

const suggestedCommissionRule = {
  poolRatePercent: 10,
  leadSharePercent: 30,
  salesSharePercent: 70,
  holdDays: 7 as const,
};

type AdminContext = {
  admin: AdminIdentity;
  dataMode: 'live' | 'preview';
};

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  role: AdminUserView['role'];
  status: AdminUserView['status'];
  onboarding_status: 'not_started' | 'profile_review' | 'complete';
  email_verified_at: string | null;
  last_active_at: string | null;
  created_at: string;
  consultant_name: string | null;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function formatRelative(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(
    value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'),
  );
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (!Number.isFinite(seconds)) return value;
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatDate(value: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(
    value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'),
  );
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Not scheduled';
  const date = new Date(
    value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'),
  );
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

export async function requireSuperAdmin(
  returnTo = '/admin',
): Promise<AdminContext | null> {
  let authenticated = await getChatGPTUser();

  if (!authenticated && process.env.NODE_ENV === 'development') {
    authenticated = {
      userId: 'sites-local-admin',
      email: 'seedy@sites.test',
      displayName: 'Jenny Men',
      fullName: 'Jenny Men',
    };
  }

  if (!authenticated) redirect(chatGPTSignInPath(returnTo));

  const allowlisted =
    getRuntimeAdminEmails().includes(authenticated.email.toLowerCase()) ||
    (process.env.NODE_ENV === 'development' &&
      authenticated.email.endsWith('@sites.test'));

  try {
    const db = getDatabase();
    if (allowlisted) {
      const id = `usr_${authenticated.userId}`;
      await db
        .prepare(
          `INSERT INTO users (
            id, auth_user_id, email, full_name, role, status, email_verified_at,
            onboarding_status, last_active_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'super_admin', 'active', CURRENT_TIMESTAMP, 'complete', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(email) DO UPDATE SET
            auth_user_id = excluded.auth_user_id,
            full_name = excluded.full_name,
            role = 'super_admin',
            status = 'active',
            last_active_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          id,
          authenticated.userId,
          authenticated.email.toLowerCase(),
          authenticated.displayName,
        )
        .run();
    }

    const row = await db
      .prepare(
        `SELECT id, email, full_name
         FROM users
         WHERE (auth_user_id = ? OR lower(email) = lower(?))
           AND role = 'super_admin'
           AND status = 'active'
         LIMIT 1`,
      )
      .bind(authenticated.userId, authenticated.email)
      .first<{ id: string; email: string; full_name: string }>();

    if (!row) return null;
    return {
      admin: {
        id: row.id,
        name: row.full_name,
        email: row.email,
        initials: initials(row.full_name),
      },
      dataMode: 'live',
    };
  } catch (error) {
    if (process.env.NODE_ENV !== 'development') throw error;
    return { admin: demoAdmin, dataMode: 'preview' };
  }
}

export async function getAdminSnapshot(
  dataMode: 'live' | 'preview',
): Promise<AdminSnapshot> {
  if (dataMode === 'preview') return demoSnapshot;

  const db = getDatabase();
  const [
    userResult,
    consultantResult,
    assignmentResult,
    workflowResult,
    crmContactResult,
    crmActivityResult,
    crmTaskResult,
    commissionStaffResult,
    commissionRuleResult,
    commissionEntryResult,
    auditResult,
    totalsResult,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT u.id, u.email, u.full_name, u.role, u.status, u.onboarding_status,
                  u.email_verified_at, u.last_active_at, u.created_at,
                  consultant.full_name AS consultant_name
           FROM users u
           LEFT JOIN consultant_assignments a
             ON a.candidate_user_id = u.id AND a.status = 'active'
           LEFT JOIN users consultant ON consultant.id = a.consultant_user_id
           WHERE u.role = 'registered_user'
           ORDER BY u.created_at DESC
           LIMIT 100`,
      )
      .all<UserRow>(),
    db
      .prepare(
        `SELECT u.id AS user_id, u.full_name, u.email, u.status AS account_status,
                  cp.speciality, cp.application_status, cp.checks_completed,
                  cp.checks_required, cp.submitted_at,
                  COUNT(a.id) AS active_assignments
           FROM consultant_profiles cp
           JOIN users u ON u.id = cp.user_id
           LEFT JOIN consultant_assignments a
             ON a.consultant_user_id = u.id AND a.status = 'active'
           GROUP BY u.id, u.full_name, u.email, u.status, cp.speciality,
                    cp.application_status, cp.checks_completed, cp.checks_required,
                    cp.submitted_at
           ORDER BY CASE cp.application_status WHEN 'submitted' THEN 0 ELSE 1 END,
                    cp.submitted_at DESC
           LIMIT 100`,
      )
      .all<{
        user_id: string;
        full_name: string;
        email: string;
        account_status: ConsultantView['accountStatus'];
        speciality: string;
        application_status: ConsultantView['applicationStatus'];
        checks_completed: number;
        checks_required: number;
        submitted_at: string | null;
        active_assignments: number;
      }>(),
    db
      .prepare(
        `SELECT a.id, a.candidate_user_id, candidate.full_name AS candidate_name,
                  a.consultant_user_id, consultant.full_name AS consultant_name,
                  a.consent_scope, a.consented_at, a.created_at, a.status
           FROM consultant_assignments a
           JOIN users candidate ON candidate.id = a.candidate_user_id
           JOIN users consultant ON consultant.id = a.consultant_user_id
           ORDER BY CASE a.status WHEN 'active' THEN 0 ELSE 1 END, a.created_at DESC
           LIMIT 100`,
      )
      .all<{
        id: string;
        candidate_user_id: string;
        candidate_name: string;
        consultant_user_id: string;
        consultant_name: string;
        consent_scope: string;
        consented_at: string;
        created_at: string;
        status: AssignmentView['status'];
      }>(),
    db
      .prepare(
        `SELECT w.id, COALESCE(u.full_name, 'Platform') AS user_name, w.workflow_type,
                  w.status, w.summary, w.created_at
           FROM workflow_runs w
           LEFT JOIN users u ON u.id = w.user_id
           ORDER BY w.created_at DESC
           LIMIT 50`,
      )
      .all<{
        id: string;
        user_name: string;
        workflow_type: string;
        status: WorkflowRunView['status'];
        summary: string;
        created_at: string;
      }>(),
    db
      .prepare(
        `SELECT u.id AS user_id, u.full_name, u.email, u.role,
                  u.status AS account_status,
                  COALESCE(
                    crm.stage,
                    CASE
                      WHEN u.role = 'consultant' THEN 'qualified'
                      WHEN u.onboarding_status = 'complete' THEN 'active_search'
                      WHEN u.onboarding_status = 'profile_review' THEN 'onboarding'
                      ELSE 'lead'
                    END
                  ) AS stage,
                  COALESCE(crm.priority, 'normal') AS priority,
                  COALESCE(owner.full_name, 'Unassigned') AS owner_name,
                  COALESCE(crm.source, 'Pip') AS source,
                  COALESCE(crm.tags_json, '[]') AS tags_json,
                  COALESCE(crm.next_action, '') AS next_action,
                  crm.next_follow_up_at,
                  crm.last_contacted_at
           FROM users u
           LEFT JOIN crm_profiles crm ON crm.user_id = u.id
           LEFT JOIN users owner ON owner.id = crm.owner_user_id
           WHERE u.role IN ('registered_user', 'consultant')
           ORDER BY
             CASE COALESCE(crm.priority, 'normal') WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
             COALESCE(crm.next_follow_up_at, '9999-12-31') ASC,
             u.created_at DESC
           LIMIT 250`,
      )
      .all<{
        user_id: string;
        full_name: string;
        email: string;
        role: 'registered_user' | 'consultant';
        account_status: CrmContactView['accountStatus'];
        stage: CrmContactView['stage'];
        priority: CrmContactView['priority'];
        owner_name: string;
        source: string;
        tags_json: string;
        next_action: string;
        next_follow_up_at: string | null;
        last_contacted_at: string | null;
      }>(),
    db
      .prepare(
        `SELECT activity.id, activity.contact_user_id, contact.full_name AS contact_name,
                  activity.activity_type, activity.summary, activity.occurred_at,
                  COALESCE(actor.full_name, 'Former admin') AS actor_name
           FROM crm_activities activity
           JOIN users contact ON contact.id = activity.contact_user_id
           LEFT JOIN users actor ON actor.id = activity.actor_user_id
           ORDER BY activity.occurred_at DESC
           LIMIT 100`,
      )
      .all<{
        id: string;
        contact_user_id: string;
        contact_name: string;
        activity_type: CrmActivityView['activityType'];
        summary: string;
        occurred_at: string;
        actor_name: string;
      }>(),
    db
      .prepare(
        `SELECT task.id, task.contact_user_id, contact.full_name AS contact_name,
                  task.title, task.due_at, task.status, task.priority
           FROM crm_tasks task
           JOIN users contact ON contact.id = task.contact_user_id
           ORDER BY CASE task.status WHEN 'open' THEN 0 ELSE 1 END,
                    task.due_at ASC
           LIMIT 100`,
      )
      .all<{
        id: string;
        contact_user_id: string;
        contact_name: string;
        title: string;
        due_at: string;
        status: CrmTaskView['status'];
        priority: CrmTaskView['priority'];
      }>(),
    db
      .prepare(
        `SELECT id, name, COALESCE(email, '') AS email, team, status
           FROM commission_staff
           ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, team, name`,
      )
      .all<{
        id: string;
        name: string;
        email: string;
        team: CommissionStaffView['team'];
        status: CommissionStaffView['status'];
      }>(),
    db
      .prepare(
        `SELECT source_type, pool_rate_bps, lead_share_bps, sales_share_bps,
                  hold_days
           FROM commission_rules`,
      )
      .all<{
        source_type: CommissionSource;
        pool_rate_bps: number;
        lead_share_bps: number;
        sales_share_bps: number;
        hold_days: number;
      }>(),
    db
      .prepare(
        `SELECT entry.id, COALESCE(entry.contact_user_id, '') AS contact_user_id,
                  COALESCE(contact.full_name, 'Deleted contact') AS contact_name,
                  entry.source_type, entry.source_detail,
                  COALESCE(lead_staff.name, 'Unassigned') AS lead_staff_name,
                  COALESCE(sales_staff.name, 'Unassigned') AS sales_staff_name,
                  entry.gross_amount_cents, entry.currency,
                  entry.pool_rate_bps, entry.lead_share_bps,
                  entry.sales_share_bps, entry.commission_pool_cents,
                  entry.lead_commission_cents, entry.sales_commission_cents,
                  CASE
                    WHEN entry.status = 'pending'
                     AND entry.eligible_at <= CURRENT_TIMESTAMP THEN 'eligible'
                    ELSE entry.status
                  END AS display_status,
                  entry.converted_at, entry.eligible_at,
                  COALESCE(entry.stripe_invoice_id, '') AS stripe_invoice_id,
                  entry.note
           FROM commission_entries entry
           LEFT JOIN users contact ON contact.id = entry.contact_user_id
           LEFT JOIN commission_staff lead_staff ON lead_staff.id = entry.lead_staff_id
           LEFT JOIN commission_staff sales_staff ON sales_staff.id = entry.sales_staff_id
           ORDER BY entry.converted_at DESC
           LIMIT 250`,
      )
      .all<{
        id: string;
        contact_user_id: string;
        contact_name: string;
        source_type: CommissionSource;
        source_detail: string;
        lead_staff_name: string;
        sales_staff_name: string;
        gross_amount_cents: number;
        currency: CommissionEntryView['currency'];
        pool_rate_bps: number;
        lead_share_bps: number;
        sales_share_bps: number;
        commission_pool_cents: number;
        lead_commission_cents: number;
        sales_commission_cents: number;
        display_status: CommissionEntryView['status'];
        converted_at: string;
        eligible_at: string;
        stripe_invoice_id: string;
        note: string;
      }>(),
    db
      .prepare(
        `SELECT id, actor_email, action, target_type, target_id,
                  COALESCE(reason, '') AS reason, outcome, created_at
           FROM audit_events
           ORDER BY id DESC
           LIMIT 100`,
      )
      .all<{
        id: number;
        actor_email: string;
        action: string;
        target_type: string;
        target_id: string;
        reason: string;
        outcome: AuditEventView['outcome'];
        created_at: string;
      }>(),
    db
      .prepare(
        `SELECT
             SUM(CASE WHEN role = 'registered_user' THEN 1 ELSE 0 END) AS b2c_users,
             SUM(CASE WHEN role = 'registered_user' AND status = 'active' THEN 1 ELSE 0 END) AS active_b2c_users,
             SUM(CASE WHEN role = 'consultant' AND status = 'active' THEN 1 ELSE 0 END) AS active_consultants
           FROM users`,
      )
      .first<{
        b2c_users: number;
        active_b2c_users: number;
        active_consultants: number;
      }>(),
  ]);

  const users: AdminUserView[] = userResult.results.map((row) => ({
    id: row.id,
    name: row.full_name,
    email: row.email,
    initials: initials(row.full_name),
    role: row.role,
    status: row.status,
    onboarding:
      row.onboarding_status === 'complete'
        ? 'Complete'
        : row.onboarding_status === 'profile_review'
          ? 'Profile review'
          : 'Not started',
    consultant: row.consultant_name ?? 'Unassigned',
    lastActive: formatRelative(row.last_active_at),
    createdAt: formatDate(row.created_at),
    emailVerified: Boolean(row.email_verified_at),
  }));

  const consultants: ConsultantView[] = consultantResult.results.map((row) => ({
    userId: row.user_id,
    name: row.full_name,
    email: row.email,
    initials: initials(row.full_name),
    speciality: row.speciality || 'Not supplied',
    submitted: formatRelative(row.submitted_at),
    checksCompleted: row.checks_completed,
    checksRequired: row.checks_required,
    applicationStatus: row.application_status,
    accountStatus: row.account_status,
    activeAssignments: Number(row.active_assignments ?? 0),
  }));

  const assignments: AssignmentView[] = assignmentResult.results.map((row) => ({
    id: row.id,
    candidateId: row.candidate_user_id,
    candidateName: row.candidate_name,
    consultantId: row.consultant_user_id,
    consultantName: row.consultant_name,
    consentScope: row.consent_scope,
    consentedAt: formatDate(row.consented_at),
    createdAt: formatDate(row.created_at),
    status: row.status,
  }));

  const workflowRuns: WorkflowRunView[] = workflowResult.results.map((row) => ({
    id: row.id,
    userName: row.user_name,
    workflowType: row.workflow_type,
    status: row.status,
    summary: row.summary,
    createdAt: formatRelative(row.created_at),
  }));

  const auditEvents: AuditEventView[] = auditResult.results.map((row) => ({
    id: row.id,
    actorEmail: row.actor_email,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    outcome: row.outcome,
    createdAt: formatRelative(row.created_at),
  }));

  const crmContacts: CrmContactView[] = crmContactResult.results.map((row) => ({
    userId: row.user_id,
    name: row.full_name,
    email: row.email,
    initials: initials(row.full_name),
    contactType: row.role === 'consultant' ? 'Consultant' : 'B2C candidate',
    accountStatus: row.account_status,
    stage: row.stage,
    priority: row.priority,
    ownerName: row.owner_name,
    source: row.source,
    tags: parseTags(row.tags_json),
    nextAction: row.next_action,
    nextFollowUpAt: formatDateTime(row.next_follow_up_at),
    nextFollowUpAtIso: row.next_follow_up_at,
    lastContactedAt: formatRelative(row.last_contacted_at),
  }));

  const crmActivities: CrmActivityView[] = crmActivityResult.results.map(
    (row) => ({
      id: row.id,
      contactUserId: row.contact_user_id,
      contactName: row.contact_name,
      activityType: row.activity_type,
      summary: row.summary,
      actorName: row.actor_name,
      occurredAt: formatRelative(row.occurred_at),
    }),
  );

  const crmTasks: CrmTaskView[] = crmTaskResult.results.map((row) => ({
    id: row.id,
    contactUserId: row.contact_user_id,
    contactName: row.contact_name,
    title: row.title,
    dueAt: formatDateTime(row.due_at),
    dueAtIso: row.due_at,
    status: row.status,
    priority: row.priority,
    isDue:
      row.status === 'open' && new Date(row.due_at).getTime() <= Date.now(),
  }));

  const commissionStaff: CommissionStaffView[] =
    commissionStaffResult.results.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      team: row.team,
      status: row.status,
    }));

  const commissionRules: CommissionRuleView[] = commissionSources.map(
    (sourceType) => {
      const configured = commissionRuleResult.results.find(
        (rule) => rule.source_type === sourceType,
      );

      return configured
        ? {
            sourceType,
            poolRatePercent: configured.pool_rate_bps / 100,
            leadSharePercent: configured.lead_share_bps / 100,
            salesSharePercent: configured.sales_share_bps / 100,
            holdDays: 7,
            configured: true,
          }
        : {
            sourceType,
            ...suggestedCommissionRule,
            configured: false,
          };
    },
  );

  const commissionEntries: CommissionEntryView[] =
    commissionEntryResult.results.map((row) => ({
      id: row.id,
      contactUserId: row.contact_user_id,
      contactName: row.contact_name,
      sourceType: row.source_type,
      sourceDetail: row.source_detail,
      leadStaffName: row.lead_staff_name,
      salesStaffName: row.sales_staff_name,
      grossAmountCents: row.gross_amount_cents,
      currency: row.currency,
      poolRatePercent: row.pool_rate_bps / 100,
      leadSharePercent: row.lead_share_bps / 100,
      salesSharePercent: row.sales_share_bps / 100,
      commissionPoolCents: row.commission_pool_cents,
      leadCommissionCents: row.lead_commission_cents,
      salesCommissionCents: row.sales_commission_cents,
      status: row.display_status,
      convertedAt: formatDateTime(row.converted_at),
      eligibleAt: formatDateTime(row.eligible_at),
      eligibleAtIso: row.eligible_at,
      stripeInvoiceId: row.stripe_invoice_id,
      note: row.note,
    }));

  const pendingConsultants = consultants.filter(
    (item) => item.applicationStatus === 'submitted',
  ).length;
  const unassignedUsers = users.filter(
    (item) => item.consultant === 'Unassigned',
  ).length;
  const completedRuns = workflowRuns.filter((item) =>
    ['succeeded', 'partial', 'failed'].includes(item.status),
  );
  const successfulRuns = completedRuns.filter(
    (item) => item.status === 'succeeded',
  ).length;

  return {
    users,
    consultants,
    assignments,
    workflowRuns,
    auditEvents,
    crmContacts,
    crmActivities,
    crmTasks,
    commissionStaff,
    commissionRules,
    commissionEntries,
    totals: {
      b2cUsers: Number(totalsResult?.b2c_users ?? 0),
      activeB2cUsers: Number(totalsResult?.active_b2c_users ?? 0),
      activeConsultants: Number(totalsResult?.active_consultants ?? 0),
      pendingConsultants,
      unassignedUsers,
      deliverySuccessRate: completedRuns.length
        ? Math.round((successfulRuns / completedRuns.length) * 1000) / 10
        : 100,
      crmLeads: crmContacts.filter((contact) => contact.stage === 'lead')
        .length,
      crmActivePipeline: crmContacts.filter((contact) =>
        ['qualified', 'onboarding', 'active_search'].includes(contact.stage),
      ).length,
      crmFollowUpsDue: crmTasks.filter(
        (task) =>
          task.status === 'open' &&
          new Date(task.dueAtIso).getTime() <= Date.now(),
      ).length,
      commissionActionable: commissionEntries.filter((entry) =>
        ['eligible', 'approved'].includes(entry.status),
      ).length,
    },
  };
}

export function getPreviewSnapshot() {
  return demoSnapshot;
}
