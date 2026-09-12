export type UserRole = 'registered_user' | 'consultant' | 'super_admin';
export type UserStatus = 'invited' | 'active' | 'suspended' | 'deactivated';
export type ConsultantDecision =
  | 'submitted'
  | 'more_information_required'
  | 'approved'
  | 'rejected';
export type CrmStage =
  | 'lead'
  | 'qualified'
  | 'onboarding'
  | 'active_search'
  | 'placed'
  | 'nurture';
export type CrmPriority = 'low' | 'normal' | 'high';
export type CommissionSource =
  | 'marketing'
  | 'field_promotion'
  | 'operations'
  | 'referral';
export type CommissionTeam =
  | 'marketing'
  | 'field_promotion'
  | 'operations'
  | 'sales'
  | 'other';
export type CommissionStatus =
  | 'pending'
  | 'eligible'
  | 'approved'
  | 'paid'
  | 'reversed';

export type AdminIdentity = {
  id: string;
  name: string;
  email: string;
  initials: string;
};

export type AdminUserView = {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: UserRole;
  status: UserStatus;
  onboarding: 'Not started' | 'Profile review' | 'Complete';
  consultant: string;
  lastActive: string;
  createdAt: string;
  emailVerified: boolean;
};

export type ConsultantView = {
  userId: string;
  name: string;
  email: string;
  initials: string;
  speciality: string;
  submitted: string;
  checksCompleted: number;
  checksRequired: number;
  applicationStatus:
    | 'draft'
    | 'submitted'
    | 'more_information_required'
    | 'approved'
    | 'rejected'
    | 'withdrawn';
  accountStatus: UserStatus;
  activeAssignments: number;
};

export type AssignmentView = {
  id: string;
  candidateId: string;
  candidateName: string;
  consultantId: string;
  consultantName: string;
  consentScope: string;
  consentedAt: string;
  createdAt: string;
  status: 'active' | 'ended';
};

export type WorkflowRunView = {
  id: string;
  userName: string;
  workflowType: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
  summary: string;
  createdAt: string;
};

export type AuditEventView = {
  id: number;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  outcome: 'succeeded' | 'denied' | 'failed';
  createdAt: string;
};

export type CrmContactView = {
  userId: string;
  name: string;
  email: string;
  initials: string;
  contactType: 'B2C candidate' | 'Consultant';
  accountStatus: UserStatus;
  stage: CrmStage;
  priority: CrmPriority;
  ownerName: string;
  source: string;
  tags: string[];
  nextAction: string;
  nextFollowUpAt: string;
  nextFollowUpAtIso: string | null;
  lastContactedAt: string;
};

export type CrmActivityView = {
  id: string;
  contactUserId: string;
  contactName: string;
  activityType: 'note' | 'call' | 'email' | 'meeting' | 'status_change';
  summary: string;
  actorName: string;
  occurredAt: string;
};

export type CrmTaskView = {
  id: string;
  contactUserId: string;
  contactName: string;
  title: string;
  dueAt: string;
  dueAtIso: string;
  status: 'open' | 'completed';
  priority: CrmPriority;
  isDue: boolean;
};

export type CommissionStaffView = {
  id: string;
  name: string;
  email: string;
  team: CommissionTeam;
  status: 'active' | 'inactive';
};

export type CommissionRuleView = {
  sourceType: CommissionSource;
  poolRatePercent: number;
  leadSharePercent: number;
  salesSharePercent: number;
  holdDays: 7;
  configured: boolean;
};

export type CommissionEntryView = {
  id: string;
  contactUserId: string;
  contactName: string;
  sourceType: CommissionSource;
  sourceDetail: string;
  leadStaffName: string;
  salesStaffName: string;
  grossAmountCents: number;
  currency: 'AUD' | 'NZD';
  poolRatePercent: number;
  leadSharePercent: number;
  salesSharePercent: number;
  commissionPoolCents: number;
  leadCommissionCents: number;
  salesCommissionCents: number;
  status: CommissionStatus;
  convertedAt: string;
  eligibleAt: string;
  eligibleAtIso: string;
  stripeInvoiceId: string;
  note: string;
};

export type AdminSnapshot = {
  users: AdminUserView[];
  consultants: ConsultantView[];
  assignments: AssignmentView[];
  workflowRuns: WorkflowRunView[];
  auditEvents: AuditEventView[];
  crmContacts: CrmContactView[];
  crmActivities: CrmActivityView[];
  crmTasks: CrmTaskView[];
  commissionStaff: CommissionStaffView[];
  commissionRules: CommissionRuleView[];
  commissionEntries: CommissionEntryView[];
  totals: {
    b2cUsers: number;
    activeB2cUsers: number;
    activeConsultants: number;
    pendingConsultants: number;
    unassignedUsers: number;
    deliverySuccessRate: number;
    crmLeads: number;
    crmActivePipeline: number;
    crmFollowUpsDue: number;
    commissionActionable: number;
  };
};
