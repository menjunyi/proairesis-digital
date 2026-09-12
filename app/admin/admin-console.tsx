'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import {
  Activity,
  BadgeDollarSign,
  Bell,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  ContactRound,
  Download,
  FileClock,
  Gauge,
  History,
  LayoutDashboard,
  LifeBuoy,
  ListTodo,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Search,
  ServerCog,
  Settings,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserRoundCog,
  Users,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  AdminIdentity,
  AdminSnapshot,
  AdminUserView,
} from '@/lib/admin-types';
import { CrmWorkspace } from './crm-workspace';
import { CommissionWorkspace } from './commission-workspace';
import { TaskWorkspace } from './task-workspace';

type View =
  | 'Overview'
  | 'Tasks'
  | 'Agents'
  | 'CRM'
  | 'Commissions'
  | 'B2C users'
  | 'Consultants'
  | 'Assignments'
  | 'Operations'
  | 'Audit log'
  | 'Settings';

const navItems: Array<{ label: View; icon: typeof LayoutDashboard }> = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Tasks', icon: ListTodo },
  { label: 'Agents', icon: Bot },
  { label: 'CRM', icon: ContactRound },
  { label: 'Commissions', icon: BadgeDollarSign },
  { label: 'B2C users', icon: Users },
  { label: 'Consultants', icon: BriefcaseBusiness },
  { label: 'Assignments', icon: UserCheck },
  { label: 'Operations', icon: Activity },
  { label: 'Audit log', icon: FileClock },
  { label: 'Settings', icon: Settings },
];

function StatusBadge({ value }: { value: string }) {
  const normalised = value.toLowerCase().replaceAll(' ', '_');
  const style =
    normalised === 'active' ||
    normalised === 'complete' ||
    normalised === 'approved' ||
    normalised === 'succeeded'
      ? 'border-[#b9e9dc] bg-[#e8f8f3] text-[#0b6c59]'
      : normalised === 'suspended' ||
          normalised === 'rejected' ||
          normalised === 'failed'
        ? 'border-[#f3c4ba] bg-[#fff0ec] text-[#b83f28]'
        : 'border-[#ecd99e] bg-[#fff8df] text-[#795a00]';

  const label = value
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());

  return (
    <Badge variant="outline" className={`font-bold ${style}`}>
      {label}
    </Badge>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 place-items-center overflow-hidden rounded-xl bg-[#dff7ef] ring-1 ring-white/15">
        <Image
          src="/pip-flight.gif"
          alt=""
          width={48}
          height={48}
          unoptimized
          className="size-12 scale-125 object-contain"
        />
      </span>
      <span>
        <span className="block text-lg font-black leading-none tracking-[-0.04em] text-white">
          Pip
        </span>
        <span className="mt-1 block text-[9px] font-black uppercase tracking-[0.18em] text-[#a9c1bf]">
          Admin centre
        </span>
      </span>
    </div>
  );
}

export function AdminConsole({
  initialSnapshot,
  currentAdmin,
  dataMode,
  initialView,
}: {
  initialSnapshot: AdminSnapshot;
  currentAdmin: AdminIdentity;
  dataMode: 'live' | 'preview';
  initialView?: string;
}) {
  const [activeView, setActiveView] = useState<View>(
    navItems.find((item) => item.label === initialView)?.label ?? 'Overview',
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<
    | { kind: 'invite' }
    | { kind: 'user'; user: AdminUserView }
    | { kind: 'consultant'; consultantId: string }
    | { kind: 'assignment' }
    | { kind: 'end_assignment'; assignmentId: string }
    | { kind: 'retry'; runId: string }
    | null
  >(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const modelContext = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: {
              name: string;
              title: string;
              description: string;
              inputSchema: object;
              annotations: {
                readOnlyHint: boolean;
                untrustedContentHint: boolean;
              };
              execute: (input: unknown) => Promise<unknown>;
            },
            options?: { signal?: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!modelContext?.registerTool) return;

    const lifecycle = new AbortController();
    const registration = modelContext.registerTool(
      {
        name: 'find_b2c_users',
        title: 'Find Pip B2C users',
        description:
          'Search the protected Pip B2C user directory by name, email, user ID or assigned consultant and show matching accounts.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 120 },
          },
          required: ['query'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        async execute(input) {
          if (!input || typeof input !== 'object' || Array.isArray(input)) {
            throw new Error('Input must be an object with a query.');
          }
          const candidate = (input as { query?: unknown }).query;
          if (
            typeof candidate !== 'string' ||
            !candidate.trim() ||
            candidate.trim().length > 120
          ) {
            throw new Error('Query must contain 1 to 120 characters.');
          }
          const nextQuery = candidate.trim();
          const needle = nextQuery.toLowerCase();
          const matches = initialSnapshot.users.filter((user) =>
            [user.name, user.email, user.id, user.consultant].some((value) =>
              value.toLowerCase().includes(needle),
            ),
          );
          setActiveView('B2C users');
          setQuery(nextQuery);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          return {
            matchCount: matches.length,
            users: matches.slice(0, 20).map((user) => ({
              id: user.id,
              name: user.name,
              email: user.email,
              status: user.status,
              consultant: user.consultant,
            })),
          };
        },
      },
      { signal: lifecycle.signal },
    );
    void Promise.resolve(registration).catch(() => undefined);
    return () => lifecycle.abort();
  }, [initialSnapshot.users]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return initialSnapshot.users;
    return initialSnapshot.users.filter((user) =>
      [user.name, user.email, user.id, user.consultant].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [initialSnapshot.users, query]);

  const sidebar = (
    <>
      <div className="flex h-[76px] items-center justify-between border-b border-white/10 px-5">
        <Brand />
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="grid size-9 place-items-center rounded-lg text-white/70 hover:bg-white/10 lg:hidden"
          aria-label="Close navigation"
        >
          <X className="size-5" />
        </button>
      </div>

      <nav
        className="flex-1 space-y-1 overflow-y-auto px-3 py-5"
        aria-label="Admin navigation"
      >
        <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#7fa19e]">
          Platform
        </p>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.label === activeView;
          const count =
            item.label === 'B2C users'
              ? initialSnapshot.totals.b2cUsers
              : item.label === 'Consultants'
                ? initialSnapshot.totals.pendingConsultants
                : item.label === 'Operations'
                  ? initialSnapshot.workflowRuns.filter((run) =>
                      ['partial', 'failed'].includes(run.status),
                    ).length
                  : item.label === 'CRM'
                    ? initialSnapshot.totals.crmFollowUpsDue
                    : item.label === 'Commissions'
                      ? initialSnapshot.totals.commissionActionable
                      : 0;
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setActiveView(item.label);
                setMobileOpen(false);
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-colors ${
                active
                  ? 'bg-[#dff7ef] text-[#0b5d50] shadow-sm'
                  : 'text-[#c9dad8] hover:bg-white/8 hover:text-white'
              }`}
            >
              <Icon className="size-[18px]" />
              <span className="flex-1">{item.label}</span>
              {item.label === 'Agents' ? (
                <span className="text-[9px] font-black uppercase tracking-[0.09em] text-[#72d6bd]">
                  Kanban
                </span>
              ) : null}
              {count ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                    active
                      ? 'bg-white/70 text-[#0b5d50]'
                      : 'bg-white/10 text-white/70'
                  }`}
                >
                  {count > 999 ? `${(count / 1000).toFixed(1)}k` : count}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        <button
          className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/8"
          type="button"
        >
          <span className="grid size-9 place-items-center rounded-full bg-[#f5c85b] text-xs font-black text-[#173c3e]">
            {currentAdmin.initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-white">
              {currentAdmin.name}
            </span>
            <span className="block truncate text-xs text-[#9eb8b5]">
              Super admin
            </span>
          </span>
          <ChevronDown className="size-4 text-[#9eb8b5]" />
        </button>
      </div>
    </>
  );

  return (
    <main className="min-h-screen bg-[#f4f1e8] text-[#173c3e]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col bg-[#173c3e] lg:flex">
        {sidebar}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-[#071c1d]/55 backdrop-blur-sm"
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
          <aside className="relative flex h-full w-[280px] flex-col bg-[#173c3e] shadow-2xl">
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center gap-3 border-b border-[#173c3e]/10 bg-[#fffdf7]/92 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid size-10 place-items-center rounded-xl border border-[#173c3e]/10 text-[#173c3e] lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <div className="relative hidden max-w-md flex-1 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#708a87]" />
            <Input
              aria-label="Search the platform"
              placeholder="Search users, consultants or ID…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 rounded-xl border-[#173c3e]/10 bg-[#f4f1e8] pl-10 shadow-none"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="mr-2 hidden items-center gap-2 rounded-full bg-[#e8f8f3] px-3 py-1.5 text-xs font-bold text-[#0b6c59] sm:flex">
              <span className="size-2 rounded-full bg-[#18a985]" />
              All systems normal
            </div>
            <Button
              variant="outline"
              size="icon-lg"
              className="relative rounded-xl bg-white"
              aria-label="Notifications"
            >
              <Bell className="size-[18px]" />
              <span className="absolute right-2 top-2 size-2 rounded-full bg-[#e55336] ring-2 ring-white" />
            </Button>
            <Button
              variant="outline"
              size="icon-lg"
              className="rounded-xl bg-white"
              aria-label="Support"
            >
              <LifeBuoy className="size-[18px]" />
            </Button>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
          <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.13em] text-[#e55336]">
                <ShieldCheck className="size-4" />
                Private operations workspace
              </div>
              <h1 className="text-3xl font-black tracking-[-0.045em] sm:text-4xl">
                {activeView === 'Agents' ? 'Agent Kanban' : activeView}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#587174]">
                {activeView === 'Overview'
                  ? 'A clear view of Pip’s people, service delivery and actions that need your attention.'
                  : activeView === 'Tasks'
                    ? 'Manage personal, relationship, company and project work as one connected system.'
                    : activeView === 'Agents'
                      ? 'See which Codex conversations are working, waiting, ready for review or available.'
                      : activeView === 'CRM'
                        ? 'Run your contact pipeline, relationship history, and follow-up work from one place.'
                        : activeView === 'Commissions'
                          ? 'Set lead and sales commission splits, attribute conversions, and control payout readiness.'
                          : `Manage ${activeView.toLowerCase()} across the Pip platform.`}
              </p>
            </div>
            {!['Tasks', 'Agents'].includes(activeView) ? (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="h-10 rounded-xl bg-white px-4 font-bold"
                  onClick={() => exportAdminView(activeView, initialSnapshot)}
                >
                  <Download /> Export view
                </Button>
                <Button
                  className="h-10 rounded-xl bg-[#173c3e] px-4 font-bold text-white hover:bg-[#28595b]"
                  onClick={() => setDialog({ kind: 'invite' })}
                >
                  <UserPlus /> Invite user
                </Button>
              </div>
            ) : null}
          </div>

          {feedback ? (
            <output className="mb-5 flex w-full items-center justify-between gap-3 rounded-xl border border-[#b9e9dc] bg-[#e8f8f3] px-4 py-3 text-sm font-semibold text-[#0b6c59]">
              <span>{feedback}</span>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                aria-label="Dismiss message"
              >
                <X className="size-4" />
              </button>
            </output>
          ) : null}

          {activeView === 'Overview' ? (
            <Overview
              query={query}
              filteredUsers={filteredUsers}
              snapshot={initialSnapshot}
              dataMode={dataMode}
              onNavigate={setActiveView}
              onManageUser={(user) => setDialog({ kind: 'user', user })}
            />
          ) : activeView === 'Tasks' ? (
            <TaskWorkspace
              mode="tasks"
              dataMode={dataMode}
              onFeedback={setFeedback}
            />
          ) : activeView === 'Agents' ? (
            <TaskWorkspace
              mode="agents"
              dataMode={dataMode}
              onFeedback={setFeedback}
            />
          ) : activeView === 'CRM' ? (
            <CrmWorkspace
              snapshot={initialSnapshot}
              dataMode={dataMode}
              onFeedback={setFeedback}
            />
          ) : activeView === 'Commissions' ? (
            <CommissionWorkspace
              snapshot={initialSnapshot}
              dataMode={dataMode}
              onFeedback={setFeedback}
            />
          ) : (
            <SectionContent
              view={activeView}
              snapshot={initialSnapshot}
              filteredUsers={filteredUsers}
              query={query}
              setQuery={setQuery}
              onManageUser={(user) => setDialog({ kind: 'user', user })}
              onReviewConsultant={(consultantId) =>
                setDialog({ kind: 'consultant', consultantId })
              }
              onAssign={() => setDialog({ kind: 'assignment' })}
              onEndAssignment={(assignmentId) =>
                setDialog({ kind: 'end_assignment', assignmentId })
              }
              onRetry={(runId) => setDialog({ kind: 'retry', runId })}
            />
          )}
        </div>
      </div>

      <ActionDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        snapshot={initialSnapshot}
        dataMode={dataMode}
        onSuccess={(message) => {
          setDialog(null);
          setFeedback(message);
          if (dataMode === 'live')
            window.setTimeout(() => window.location.reload(), 500);
        }}
      />
    </main>
  );
}

function Overview({
  query,
  filteredUsers,
  snapshot,
  dataMode,
  onNavigate,
  onManageUser,
}: {
  query: string;
  filteredUsers: AdminUserView[];
  snapshot: AdminSnapshot;
  dataMode: 'live' | 'preview';
  onNavigate: (view: View) => void;
  onManageUser: (user: AdminUserView) => void;
}) {
  const { totals } = snapshot;
  const metrics = [
    {
      label: 'Active B2C users',
      value: totals.activeB2cUsers.toLocaleString('en-AU'),
      detail: `${totals.b2cUsers.toLocaleString('en-AU')} total accounts`,
      icon: Users,
      tone: 'mint',
    },
    {
      label: 'Active consultants',
      value: totals.activeConsultants.toLocaleString('en-AU'),
      detail: `${totals.pendingConsultants} awaiting review`,
      icon: BriefcaseBusiness,
      tone: 'yellow',
    },
    {
      label: 'Unassigned users',
      value: totals.unassignedUsers.toLocaleString('en-AU'),
      detail: 'Ready for assignment',
      icon: UserRoundCog,
      tone: 'orange',
    },
    {
      label: 'Delivery success',
      value: `${totals.deliverySuccessRate.toFixed(1)}%`,
      detail: 'Recent completed runs',
      icon: Gauge,
      tone: 'blue',
    },
  ];

  return (
    <div className="space-y-6">
      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Platform metrics"
      >
        {metrics.map((metric) => {
          const Icon = metric.icon;
          const tones = {
            mint: 'bg-[#dff7ef] text-[#0b6c59]',
            yellow: 'bg-[#fff0c8] text-[#805c00]',
            orange: 'bg-[#ffe5dc] text-[#b83f28]',
            blue: 'bg-[#e2eef5] text-[#315f79]',
          } as const;
          return (
            <article
              key={metric.label}
              className="rounded-2xl border border-[#173c3e]/9 bg-[#fffdf7] p-5 shadow-[0_8px_28px_rgba(23,60,62,0.05)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-[#587174]">
                    {metric.label}
                  </p>
                  <p className="mt-3 text-[2rem] font-black leading-none tracking-[-0.045em]">
                    {metric.value}
                  </p>
                  <p className="mt-3 text-xs font-semibold text-[#708a87]">
                    {metric.detail}
                  </p>
                </div>
                <span
                  className={`grid size-11 place-items-center rounded-2xl ${tones[metric.tone as keyof typeof tones]}`}
                >
                  <Icon className="size-5" />
                </span>
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(330px,0.7fr)]">
        <article className="overflow-hidden rounded-2xl border border-[#173c3e]/9 bg-[#fffdf7] shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
          <div className="flex flex-col gap-3 border-b border-[#173c3e]/9 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-black tracking-[-0.025em]">
                Recent B2C users
              </h2>
              <p className="mt-1 text-xs text-[#708a87]">
                {query
                  ? `${filteredUsers.length} matching accounts`
                  : 'Latest candidate account activity'}
              </p>
            </div>
            <button
              className="flex items-center gap-1 text-sm font-black text-[#0b6c59] hover:text-[#173c3e]"
              type="button"
              onClick={() => onNavigate('B2C users')}
            >
              Manage all <ChevronRight className="size-4" />
            </button>
          </div>
          <UserTable rows={filteredUsers.slice(0, 5)} onManage={onManageUser} />
        </article>

        <article className="rounded-2xl border border-[#173c3e]/9 bg-[#173c3e] p-5 text-white shadow-[0_14px_36px_rgba(23,60,62,0.14)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.13em] text-[#8fdcc9]">
                Needs attention
              </p>
              <h2 className="mt-2 text-xl font-black tracking-[-0.03em]">
                5 actions today
              </h2>
            </div>
            <span className="grid size-10 place-items-center rounded-xl bg-white/10 text-[#f5c85b]">
              <ClipboardCheck className="size-5" />
            </span>
          </div>
          <div className="mt-5 space-y-2.5">
            {[
              {
                count: 3,
                label: 'Consultants awaiting review',
                icon: BriefcaseBusiness,
                urgent: true,
              },
              {
                count: 2,
                label: 'Delivery runs need review',
                icon: CircleAlert,
                urgent: true,
              },
              {
                count: 5,
                label: 'Users unassigned for 24h+',
                icon: Clock3,
                urgent: false,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/6 px-3 py-3 text-left transition-colors hover:bg-white/11"
                  type="button"
                >
                  <span
                    className={`grid size-9 place-items-center rounded-lg ${item.urgent ? 'bg-[#e55336]/20 text-[#ffac99]' : 'bg-white/10 text-[#c9dad8]'}`}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="flex-1 text-sm font-bold text-[#e8f1f0]">
                    {item.label}
                  </span>
                  <span className="rounded-full bg-white/10 px-2 py-1 text-xs font-black">
                    {item.count}
                  </span>
                  <ChevronRight className="size-4 text-white/40 transition-transform group-hover:translate-x-0.5" />
                </button>
              );
            })}
          </div>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
        <article className="rounded-2xl border border-[#173c3e]/9 bg-[#fffdf7] p-5 shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black tracking-[-0.025em]">
                Consultant review queue
              </h2>
              <p className="mt-1 text-xs text-[#708a87]">
                Applications waiting for a platform decision
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg bg-white font-bold"
              onClick={() => onNavigate('Consultants')}
            >
              Review queue
            </Button>
          </div>
          <div className="mt-4 divide-y divide-[#173c3e]/8">
            {snapshot.consultants
              .filter((consultant) =>
                ['submitted', 'more_information_required'].includes(
                  consultant.applicationStatus,
                ),
              )
              .slice(0, 3)
              .map((consultant) => {
                const checks =
                  consultant.checksCompleted === consultant.checksRequired
                    ? 'Ready to decide'
                    : `${consultant.checksCompleted} of ${consultant.checksRequired} checks`;
                const tone =
                  consultant.checksCompleted === consultant.checksRequired
                    ? 'good'
                    : consultant.applicationStatus ===
                        'more_information_required'
                      ? 'neutral'
                      : 'warning';
                return (
                  <div
                    key={consultant.name}
                    className="flex items-center gap-3 py-3.5"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#edf1eb] text-xs font-black text-[#315f5f]">
                      {consultant.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black">
                        {consultant.name}
                      </span>
                      <span className="block truncate text-xs text-[#708a87]">
                        {consultant.speciality} · {consultant.submitted}
                      </span>
                    </span>
                    <span
                      className={`hidden rounded-full px-2.5 py-1 text-[11px] font-bold sm:block ${tone === 'good' ? 'bg-[#e8f8f3] text-[#0b6c59]' : tone === 'warning' ? 'bg-[#fff8df] text-[#795a00]' : 'bg-[#edf1eb] text-[#587174]'}`}
                    >
                      {checks}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Open ${consultant.name}`}
                    >
                      <ChevronRight />
                    </Button>
                  </div>
                );
              })}
          </div>
        </article>

        <article className="rounded-2xl border border-[#173c3e]/9 bg-[#fffdf7] p-5 shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black tracking-[-0.025em]">
                Service health
              </h2>
              <p className="mt-1 text-xs text-[#708a87]">
                Live platform operations
              </p>
            </div>
            <Badge
              variant="outline"
              className="border-[#b9e9dc] bg-[#e8f8f3] font-bold text-[#0b6c59]"
            >
              <span className="size-1.5 rounded-full bg-[#18a985]" /> Healthy
            </Badge>
          </div>
          <div className="mt-5 space-y-4">
            {[
              {
                label: 'Job discovery',
                value: '99.2%',
                note: '312 roles processed',
                colour: '#13866f',
              },
              {
                label: 'Eligibility checks',
                value: '97.6%',
                note: '8 need human review',
                colour: '#e7a91e',
              },
              {
                label: 'Shortlist delivery',
                value: '96.8%',
                note: '2 partial deliveries',
                colour: '#e55336',
              },
            ].map((service) => (
              <div key={service.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold">{service.label}</span>
                  <span className="font-black">{service.value}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#ebe8de]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: service.value, background: service.colour }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-[#708a87]">
                  {service.note}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <div className="flex items-center gap-2 rounded-xl border border-[#d9d5c8] bg-[#ebe8de]/70 px-4 py-3 text-xs leading-5 text-[#587174]">
        <LockKeyhole className="size-4 shrink-0 text-[#315f5f]" />
        Candidate documents and eligibility facts stay hidden by default.
        Sensitive support access requires a reason and is recorded in the audit
        log.{' '}
        {dataMode === 'preview'
          ? 'This local preview uses representative data until the hosted database is connected.'
          : ''}
      </div>
    </div>
  );
}

function SectionContent({
  view,
  snapshot,
  filteredUsers,
  query,
  setQuery,
  onManageUser,
  onReviewConsultant,
  onAssign,
  onEndAssignment,
  onRetry,
}: {
  view: View;
  snapshot: AdminSnapshot;
  filteredUsers: AdminUserView[];
  query: string;
  setQuery: (value: string) => void;
  onManageUser: (user: AdminUserView) => void;
  onReviewConsultant: (consultantId: string) => void;
  onAssign: () => void;
  onEndAssignment: (assignmentId: string) => void;
  onRetry: (runId: string) => void;
}) {
  if (view === 'B2C users') {
    return (
      <section className="overflow-hidden rounded-2xl border border-[#173c3e]/9 bg-[#fffdf7] shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
        <div className="flex flex-col gap-3 border-b border-[#173c3e]/9 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#708a87]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email, ID or consultant"
              className="h-10 rounded-xl bg-white pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-10 rounded-xl bg-white">
              Status: All <ChevronDown />
            </Button>
            <Button variant="outline" className="h-10 rounded-xl bg-white">
              More filters <ChevronDown />
            </Button>
          </div>
        </div>
        <UserTable rows={filteredUsers} onManage={onManageUser} />
      </section>
    );
  }

  if (view === 'Consultants') {
    return (
      <section className="overflow-hidden rounded-2xl border border-[#173c3e]/9 bg-[#fffdf7] shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
        <div className="flex flex-col gap-3 border-b border-[#173c3e]/9 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black">Consultant accounts</h2>
            <p className="mt-1 text-xs text-[#708a87]">
              Review applications and monitor active candidate assignments.
            </p>
          </div>
          <Badge
            variant="outline"
            className="border-[#ecd99e] bg-[#fff8df] font-bold text-[#795a00]"
          >
            {snapshot.totals.pendingConsultants} pending decisions
          </Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-[#f7f4ec] hover:bg-[#f7f4ec]">
              <TableHead className="pl-5 text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87]">
                Consultant
              </TableHead>
              <TableHead className="text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87]">
                Application
              </TableHead>
              <TableHead className="hidden text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87] md:table-cell">
                Checks
              </TableHead>
              <TableHead className="hidden text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87] lg:table-cell">
                Assignments
              </TableHead>
              <TableHead className="hidden text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87] xl:table-cell">
                Submitted
              </TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshot.consultants.map((consultant) => (
              <TableRow key={consultant.userId}>
                <TableCell className="py-3.5 pl-5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-full bg-[#edf1eb] text-[11px] font-black">
                      {consultant.initials}
                    </span>
                    <span>
                      <span className="block font-black">
                        {consultant.name}
                      </span>
                      <span className="block text-xs text-[#708a87]">
                        {consultant.speciality}
                      </span>
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge value={consultant.applicationStatus} />
                </TableCell>
                <TableCell className="hidden font-semibold md:table-cell">
                  {consultant.checksCompleted}/{consultant.checksRequired}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {consultant.activeAssignments}
                </TableCell>
                <TableCell className="hidden text-xs text-[#708a87] xl:table-cell">
                  {consultant.submitted}
                </TableCell>
                <TableCell className="pr-4 text-right">
                  {['submitted', 'more_information_required'].includes(
                    consultant.applicationStatus,
                  ) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-white font-bold"
                      onClick={() => onReviewConsultant(consultant.userId)}
                    >
                      Review
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Manage ${consultant.name}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    );
  }

  if (view === 'Assignments') {
    return (
      <section className="overflow-hidden rounded-2xl border border-[#173c3e]/9 bg-[#fffdf7] shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
        <div className="flex flex-col gap-3 border-b border-[#173c3e]/9 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black">
              Candidate–consultant assignments
            </h2>
            <p className="mt-1 text-xs text-[#708a87]">
              Every assignment is tied to a recorded candidate consent scope.
            </p>
          </div>
          <Button
            className="h-9 rounded-xl bg-[#173c3e] px-4 font-bold text-white"
            onClick={onAssign}
          >
            <UserCheck /> New assignment
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-[#f7f4ec] hover:bg-[#f7f4ec]">
              <TableHead className="pl-5 text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87]">
                Candidate
              </TableHead>
              <TableHead className="text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87]">
                Consultant
              </TableHead>
              <TableHead className="hidden text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87] md:table-cell">
                Consent scope
              </TableHead>
              <TableHead className="hidden text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87] lg:table-cell">
                Assigned
              </TableHead>
              <TableHead className="text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87]">
                Status
              </TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshot.assignments.length ? (
              snapshot.assignments.map((assignment) => (
                <TableRow key={assignment.id}>
                  <TableCell className="py-4 pl-5 font-black">
                    {assignment.candidateName}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {assignment.consultantName}
                  </TableCell>
                  <TableCell className="hidden max-w-[280px] whitespace-normal text-xs leading-5 text-[#587174] md:table-cell">
                    {assignment.consentScope}
                  </TableCell>
                  <TableCell className="hidden text-xs text-[#708a87] lg:table-cell">
                    {assignment.createdAt}
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={assignment.status} />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {assignment.status === 'active' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white font-bold"
                        onClick={() => onEndAssignment(assignment.id)}
                      >
                        End access
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-32 text-center text-sm text-[#708a87]"
                >
                  No assignments yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    );
  }

  if (view === 'Operations') {
    const attention = snapshot.workflowRuns.filter((run) =>
      ['partial', 'failed'].includes(run.status),
    ).length;
    return (
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryTile
            icon={Activity}
            label="Recent runs"
            value={String(snapshot.workflowRuns.length)}
            note="Latest platform workflows"
          />
          <SummaryTile
            icon={CheckCircle2}
            label="Success rate"
            value={`${snapshot.totals.deliverySuccessRate.toFixed(1)}%`}
            note="Completed recent runs"
          />
          <SummaryTile
            icon={CircleAlert}
            label="Needs attention"
            value={String(attention)}
            note="Partial or failed runs"
            warning={attention > 0}
          />
        </div>
        <section className="overflow-hidden rounded-2xl border border-[#173c3e]/9 bg-[#fffdf7] shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
          <div className="border-b border-[#173c3e]/9 p-5">
            <h2 className="text-lg font-black">Workflow activity</h2>
            <p className="mt-1 text-xs text-[#708a87]">
              User-facing job discovery, eligibility and delivery activity.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-[#f7f4ec] hover:bg-[#f7f4ec]">
                <TableHead className="pl-5 text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87]">
                  Workflow
                </TableHead>
                <TableHead className="text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87]">
                  User
                </TableHead>
                <TableHead className="text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87]">
                  Status
                </TableHead>
                <TableHead className="hidden text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87] lg:table-cell">
                  Summary
                </TableHead>
                <TableHead className="hidden text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87] xl:table-cell">
                  Started
                </TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.workflowRuns.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="py-4 pl-5 font-black">
                    {run.workflowType}
                  </TableCell>
                  <TableCell>{run.userName}</TableCell>
                  <TableCell>
                    <StatusBadge value={run.status} />
                  </TableCell>
                  <TableCell className="hidden max-w-[300px] whitespace-normal text-xs leading-5 text-[#587174] lg:table-cell">
                    {run.summary}
                  </TableCell>
                  <TableCell className="hidden text-xs text-[#708a87] xl:table-cell">
                    {run.createdAt}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {['partial', 'failed'].includes(run.status) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white font-bold"
                        onClick={() => onRetry(run.id)}
                      >
                        Retry safely
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>
    );
  }

  if (view === 'Audit log') {
    return (
      <section className="overflow-hidden rounded-2xl border border-[#173c3e]/9 bg-[#fffdf7] shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
        <div className="flex items-center gap-3 border-b border-[#173c3e]/9 p-5">
          <span className="grid size-10 place-items-center rounded-xl bg-[#dff7ef] text-[#0b6c59]">
            <History className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-black">Append-only admin history</h2>
            <p className="mt-1 text-xs text-[#708a87]">
              Account, role, assignment and workflow changes are recorded here.
            </p>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-[#f7f4ec] hover:bg-[#f7f4ec]">
              <TableHead className="pl-5 text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87]">
                Action
              </TableHead>
              <TableHead className="text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87]">
                Target
              </TableHead>
              <TableHead className="hidden text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87] md:table-cell">
                Reason
              </TableHead>
              <TableHead className="hidden text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87] lg:table-cell">
                Actor
              </TableHead>
              <TableHead className="text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87]">
                Outcome
              </TableHead>
              <TableHead className="hidden text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87] xl:table-cell">
                Time
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshot.auditEvents.length ? (
              snapshot.auditEvents.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="py-4 pl-5 font-sans text-xs font-bold">
                    {event.action}
                  </TableCell>
                  <TableCell>
                    <span className="block text-xs font-bold">
                      {event.targetType}
                    </span>
                    <span className="block text-[11px] text-[#708a87]">
                      {event.targetId}
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-[300px] whitespace-normal text-xs leading-5 text-[#587174] md:table-cell">
                    {event.reason || 'No reason recorded'}
                  </TableCell>
                  <TableCell className="hidden text-xs lg:table-cell">
                    {event.actorEmail}
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={event.outcome} />
                  </TableCell>
                  <TableCell className="hidden text-xs text-[#708a87] xl:table-cell">
                    {event.createdAt}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-32 text-center text-sm text-[#708a87]"
                >
                  No administrative actions have been recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    );
  }

  if (view === 'Settings') {
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <SettingsCard
          icon={ShieldCheck}
          title="Admin security"
          body="Super admins authenticate with ChatGPT, are checked against a server-side allowlist, and must remain active in Pip."
          items={[
            'Deny-by-default role checks',
            'At least one active super admin',
            'High-risk actions require a reason',
          ]}
        />
        <SettingsCard
          icon={LockKeyhole}
          title="Privacy boundaries"
          body="Candidate documents, application answers and eligibility facts do not appear in the default admin surface."
          items={[
            'Metadata-first account views',
            'No password or MFA secret access',
            'Candidate remains the final approver',
          ]}
        />
        <SettingsCard
          icon={ServerCog}
          title="Data and migrations"
          body="Users, consultant reviews, assignments, operations and audit events are stored in the project database."
          items={[
            'Durable platform records',
            'Server-side ownership checks',
            'Append-only schema migrations',
          ]}
        />
        <SettingsCard
          icon={Bell}
          title="Notifications"
          body="Material account decisions have defined notification events. Delivery-provider connection is the next integration step."
          items={[
            'Consultant decision notices',
            'Account-status notices',
            'Assignment-change notices',
          ]}
        />
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-[#173c3e]/9 bg-[#fffdf7] p-10 text-center shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#dff7ef] text-[#0b6c59]">
        <CheckCircle2 className="size-7" />
      </span>
      <h2 className="mt-5 text-xl font-black">{view} workspace is ready</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#587174]">
        This section will use the same protected account data, explicit
        permissions and complete audit history as the rest of the admin centre.
      </p>
      <Button className="mt-5 rounded-xl bg-[#173c3e] px-4 font-bold text-white">
        Open first task
      </Button>
    </section>
  );
}

function UserTable({
  rows,
  onManage,
}: {
  rows: AdminUserView[];
  onManage: (user: AdminUserView) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-[#f7f4ec] hover:bg-[#f7f4ec]">
          <TableHead className="pl-5 text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87]">
            User
          </TableHead>
          <TableHead className="text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87]">
            Status
          </TableHead>
          <TableHead className="hidden text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87] md:table-cell">
            Onboarding
          </TableHead>
          <TableHead className="hidden text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87] lg:table-cell">
            Consultant
          </TableHead>
          <TableHead className="hidden text-[11px] font-black uppercase tracking-[0.09em] text-[#708a87] xl:table-cell">
            Last active
          </TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length ? (
          rows.map((user) => (
            <TableRow key={user.id} className="group">
              <TableCell className="py-3.5 pl-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#edf1eb] text-[11px] font-black text-[#315f5f]">
                    {user.initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-black">
                      {user.name}
                    </span>
                    <span className="block truncate text-xs text-[#708a87]">
                      {user.email}
                    </span>
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge value={user.status} />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <StatusBadge value={user.onboarding} />
              </TableCell>
              <TableCell
                className={`hidden text-sm font-semibold lg:table-cell ${user.consultant === 'Unassigned' ? 'text-[#b83f28]' : ''}`}
              >
                {user.consultant}
              </TableCell>
              <TableCell className="hidden text-xs text-[#708a87] xl:table-cell">
                {user.lastActive}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Manage ${user.name}`}
                  onClick={() => onManage(user)}
                >
                  <MoreHorizontal />
                </Button>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell
              colSpan={6}
              className="h-32 text-center text-sm text-[#708a87]"
            >
              No users match this search.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  note,
  warning = false,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  note: string;
  warning?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-[#173c3e]/9 bg-[#fffdf7] p-5 shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-[#587174]">{label}</p>
          <p className="mt-3 text-3xl font-black tracking-[-0.04em]">{value}</p>
          <p className="mt-2 text-xs text-[#708a87]">{note}</p>
        </div>
        <span
          className={`grid size-11 place-items-center rounded-2xl ${warning ? 'bg-[#ffe5dc] text-[#b83f28]' : 'bg-[#dff7ef] text-[#0b6c59]'}`}
        >
          <Icon className="size-5" />
        </span>
      </div>
    </article>
  );
}

function SettingsCard({
  icon: Icon,
  title,
  body,
  items,
}: {
  icon: typeof Activity;
  title: string;
  body: string;
  items: string[];
}) {
  return (
    <article className="rounded-2xl border border-[#173c3e]/9 bg-[#fffdf7] p-6 shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
      <span className="grid size-11 place-items-center rounded-2xl bg-[#dff7ef] text-[#0b6c59]">
        <Icon className="size-5" />
      </span>
      <h2 className="mt-5 text-lg font-black">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#587174]">{body}</p>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-center gap-2 text-xs font-semibold text-[#315f5f]"
          >
            <CheckCircle2 className="size-4 text-[#13866f]" /> {item}
          </li>
        ))}
      </ul>
    </article>
  );
}

type DialogState =
  | { kind: 'invite' }
  | { kind: 'user'; user: AdminUserView }
  | { kind: 'consultant'; consultantId: string }
  | { kind: 'assignment' }
  | { kind: 'end_assignment'; assignmentId: string }
  | { kind: 'retry'; runId: string }
  | null;

function ActionDialogs({
  dialog,
  onClose,
  snapshot,
  dataMode,
  onSuccess,
}: {
  dialog: DialogState;
  onClose: () => void;
  snapshot: AdminSnapshot;
  dataMode: 'live' | 'preview';
  onSuccess: (message: string) => void;
}) {
  return (
    <Dialog
      open={Boolean(dialog)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {dialog ? (
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl p-0 sm:max-w-lg">
          {dialog.kind === 'invite' ? (
            <InviteForm dataMode={dataMode} onSuccess={onSuccess} />
          ) : dialog.kind === 'user' ? (
            <UserManagementForm
              user={dialog.user}
              dataMode={dataMode}
              onSuccess={onSuccess}
            />
          ) : dialog.kind === 'consultant' ? (
            <ConsultantDecisionForm
              consultant={snapshot.consultants.find(
                (item) => item.userId === dialog.consultantId,
              )!}
              dataMode={dataMode}
              onSuccess={onSuccess}
            />
          ) : dialog.kind === 'assignment' ? (
            <AssignmentForm
              snapshot={snapshot}
              dataMode={dataMode}
              onSuccess={onSuccess}
            />
          ) : dialog.kind === 'end_assignment' ? (
            <EndAssignmentForm
              assignment={snapshot.assignments.find(
                (item) => item.id === dialog.assignmentId,
              )!}
              dataMode={dataMode}
              onSuccess={onSuccess}
            />
          ) : (
            <RetryForm
              run={snapshot.workflowRuns.find(
                (item) => item.id === dialog.runId,
              )!}
              dataMode={dataMode}
              onSuccess={onSuccess}
            />
          )}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function FormShell({
  eyebrow,
  title,
  description,
  children,
  submitLabel,
  busy,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  submitLabel: string;
  busy: boolean;
}) {
  return (
    <>
      <DialogHeader className="px-6 pb-1 pt-6">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#e55336]">
          {eyebrow}
        </p>
        <DialogTitle className="text-2xl font-black tracking-[-0.04em]">
          {title}
        </DialogTitle>
        <DialogDescription className="leading-6">
          {description}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 px-6 py-3">{children}</div>
      <DialogFooter className="mx-0 mb-0 rounded-b-2xl px-6">
        <Button
          type="submit"
          disabled={busy}
          className="h-10 rounded-xl bg-[#173c3e] px-4 font-bold text-white"
        >
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg bg-[#fff0ec] px-3 py-2 text-xs font-semibold text-[#b83f28]"
    >
      {message}
    </p>
  );
}

function InviteForm({
  dataMode,
  onSuccess,
}: {
  dataMode: 'live' | 'preview';
  onSuccess: (message: string) => void;
}) {
  const [role, setRole] = useState<'registered_user' | 'consultant'>(
    'registered_user',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postAdmin(
        '/api/admin/users',
        {
          name: form.get('name'),
          email: form.get('email'),
          role,
          speciality: form.get('speciality'),
        },
        dataMode,
      );
      onSuccess(
        role === 'consultant'
          ? 'Consultant invitation created.'
          : 'B2C user invitation created.',
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not create the invitation.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <FormShell
        eyebrow="New account"
        title="Invite someone to Pip"
        description="Create a B2C candidate account or start a consultant review."
        submitLabel="Create invitation"
        busy={busy}
      >
        <FieldError message={error} />
        <div className="space-y-2">
          <Label htmlFor="invite-name">Full name</Label>
          <Input
            id="invite-name"
            name="name"
            required
            minLength={2}
            maxLength={120}
            placeholder="e.g. Maya Chen"
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            maxLength={254}
            placeholder="name@example.com"
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-role">Account type</Label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as typeof role)}
            className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-[#e55336] focus:ring-3 focus:ring-[#e55336]/15"
          >
            <option value="registered_user">B2C candidate</option>
            <option value="consultant">Consultant applicant</option>
          </select>
        </div>
        {role === 'consultant' ? (
          <div className="space-y-2">
            <Label htmlFor="invite-speciality">Consultant speciality</Label>
            <Input
              id="invite-speciality"
              name="speciality"
              required
              maxLength={160}
              placeholder="e.g. Technology careers"
              className="h-10"
            />
          </div>
        ) : null}
      </FormShell>
    </form>
  );
}

function UserManagementForm({
  user,
  dataMode,
  onSuccess,
}: {
  user: AdminUserView;
  dataMode: 'live' | 'preview';
  onSuccess: (message: string) => void;
}) {
  const [status, setStatus] = useState(
    user.status === 'active' ? 'suspended' : 'active',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postAdmin(
        `/api/admin/users/${encodeURIComponent(user.id)}/status`,
        {
          status,
          reason: form.get('reason'),
        },
        dataMode,
      );
      onSuccess(`${user.name} is now ${status}.`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not update this account.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <FormShell
        eyebrow="B2C account"
        title={user.name}
        description={`${user.email} · ${user.id}`}
        submitLabel="Confirm account change"
        busy={busy}
      >
        <FieldError message={error} />
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#f4f1e8] p-4 text-xs">
          <div>
            <span className="block text-[#708a87]">Current status</span>
            <span className="mt-1 block font-black capitalize">
              {user.status}
            </span>
          </div>
          <div>
            <span className="block text-[#708a87]">Assigned consultant</span>
            <span className="mt-1 block font-black">{user.consultant}</span>
          </div>
          <div>
            <span className="block text-[#708a87]">Onboarding</span>
            <span className="mt-1 block font-black">{user.onboarding}</span>
          </div>
          <div>
            <span className="block text-[#708a87]">Email verified</span>
            <span className="mt-1 block font-black">
              {user.emailVerified ? 'Yes' : 'No'}
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-status">New account status</Label>
          <select
            id="user-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deactivated">Deactivated</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-reason">Administrative reason</Label>
          <Textarea
            id="user-reason"
            name="reason"
            required
            minLength={3}
            maxLength={500}
            placeholder="Why is this account changing?"
          />
          <p className="text-[11px] leading-5 text-[#708a87]">
            The reason is saved in the audit history. Suspending a consultant
            also ends active candidate access.
          </p>
        </div>
      </FormShell>
    </form>
  );
}

function ConsultantDecisionForm({
  consultant,
  dataMode,
  onSuccess,
}: {
  consultant: AdminSnapshot['consultants'][number];
  dataMode: 'live' | 'preview';
  onSuccess: (message: string) => void;
}) {
  const [decision, setDecision] = useState<
    'approved' | 'rejected' | 'more_information_required'
  >('more_information_required');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postAdmin(
        `/api/admin/consultants/${encodeURIComponent(consultant.userId)}/decision`,
        {
          decision,
          reason: form.get('reason'),
        },
        dataMode,
      );
      onSuccess(
        `Consultant application marked ${decision.replaceAll('_', ' ')}.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not save this decision.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <FormShell
        eyebrow="Consultant review"
        title={consultant.name}
        description={`${consultant.speciality} · ${consultant.email}`}
        submitLabel="Save decision"
        busy={busy}
      >
        <FieldError message={error} />
        <div className="rounded-xl bg-[#f4f1e8] p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-bold">Required checks</span>
            <span className="font-black">
              {consultant.checksCompleted} of {consultant.checksRequired}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-[#13866f]"
              style={{
                width: `${(consultant.checksCompleted / consultant.checksRequired) * 100}%`,
              }}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="consultant-decision">Decision</Label>
          <select
            id="consultant-decision"
            value={decision}
            onChange={(event) =>
              setDecision(event.target.value as typeof decision)
            }
            className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
          >
            <option value="more_information_required">
              Request more information
            </option>
            <option value="approved">Approve consultant</option>
            <option value="rejected">Reject application</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="consultant-reason">Decision reason</Label>
          <Textarea
            id="consultant-reason"
            name="reason"
            required
            minLength={3}
            maxLength={1000}
            placeholder="Record the evidence for this decision."
          />
        </div>
      </FormShell>
    </form>
  );
}

function AssignmentForm({
  snapshot,
  dataMode,
  onSuccess,
}: {
  snapshot: AdminSnapshot;
  dataMode: 'live' | 'preview';
  onSuccess: (message: string) => void;
}) {
  const candidates = snapshot.users.filter((user) => user.status === 'active');
  const consultants = snapshot.consultants.filter(
    (item) =>
      item.accountStatus === 'active' && item.applicationStatus === 'approved',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postAdmin(
        '/api/admin/assignments',
        {
          candidateId: form.get('candidateId'),
          consultantId: form.get('consultantId'),
          consentScope: form.get('consentScope'),
          reason: form.get('reason'),
        },
        dataMode,
      );
      onSuccess('Candidate assignment created and previous access revoked.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not create the assignment.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <FormShell
        eyebrow="Access assignment"
        title="Assign a consultant"
        description="This grants the selected consultant access within the candidate’s recorded consent scope."
        submitLabel="Create assignment"
        busy={busy}
      >
        <FieldError message={error} />
        <div className="space-y-2">
          <Label htmlFor="assignment-candidate">B2C candidate</Label>
          <select
            id="assignment-candidate"
            name="candidateId"
            required
            defaultValue=""
            className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
          >
            <option value="" disabled>
              Select candidate
            </option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="assignment-consultant">Approved consultant</Label>
          <select
            id="assignment-consultant"
            name="consultantId"
            required
            defaultValue=""
            className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
          >
            <option value="" disabled>
              Select consultant
            </option>
            {consultants.map((consultant) => (
              <option key={consultant.userId} value={consultant.userId}>
                {consultant.name} · {consultant.activeAssignments} active
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="consent-scope">Recorded consent scope</Label>
          <Textarea
            id="consent-scope"
            name="consentScope"
            required
            minLength={3}
            maxLength={500}
            placeholder="e.g. Career coaching and application review"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="assignment-reason">Assignment reason</Label>
          <Input
            id="assignment-reason"
            name="reason"
            required
            minLength={3}
            maxLength={500}
            placeholder="e.g. Candidate selected this consultant"
            className="h-10"
          />
        </div>
      </FormShell>
    </form>
  );
}

function RetryForm({
  run,
  dataMode,
  onSuccess,
}: {
  run: AdminSnapshot['workflowRuns'][number];
  dataMode: 'live' | 'preview';
  onSuccess: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postAdmin(
        `/api/admin/workflows/${encodeURIComponent(run.id)}/retry`,
        { reason: form.get('reason') },
        dataMode,
      );
      onSuccess(`${run.workflowType} was queued for a safe retry.`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not retry this workflow.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <FormShell
        eyebrow="Operations"
        title={`Retry ${run.workflowType}`}
        description={`${run.userName} · Current status: ${run.status}`}
        submitLabel="Queue safe retry"
        busy={busy}
      >
        <FieldError message={error} />
        <div className="rounded-xl border border-[#ecd99e] bg-[#fff8df] px-4 py-3 text-xs leading-5 text-[#795a00]">
          Retries are idempotent and must not create duplicate deliveries or
          application artifacts.
        </div>
        <div className="space-y-2">
          <Label htmlFor="retry-reason">Retry reason</Label>
          <Textarea
            id="retry-reason"
            name="reason"
            required
            minLength={3}
            maxLength={500}
            placeholder="Record why this run should be retried."
          />
        </div>
      </FormShell>
    </form>
  );
}

function EndAssignmentForm({
  assignment,
  dataMode,
  onSuccess,
}: {
  assignment: AdminSnapshot['assignments'][number];
  dataMode: 'live' | 'preview';
  onSuccess: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postAdmin(
        `/api/admin/assignments/${encodeURIComponent(assignment.id)}/end`,
        { reason: form.get('reason') },
        dataMode,
      );
      onSuccess(
        `Access between ${assignment.candidateName} and ${assignment.consultantName} ended.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not end this assignment.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <FormShell
        eyebrow="Revoke access"
        title="End consultant assignment"
        description={`${assignment.consultantName} will immediately lose assigned access to ${assignment.candidateName}.`}
        submitLabel="End assignment"
        busy={busy}
      >
        <FieldError message={error} />
        <div className="rounded-xl bg-[#f4f1e8] p-4 text-xs leading-5 text-[#587174]">
          <span className="block font-black text-[#173c3e]">
            Current consent scope
          </span>
          {assignment.consentScope}
        </div>
        <div className="space-y-2">
          <Label htmlFor="end-assignment-reason">
            Reason for ending access
          </Label>
          <Textarea
            id="end-assignment-reason"
            name="reason"
            required
            minLength={3}
            maxLength={500}
            placeholder="Record why this assignment is ending."
          />
        </div>
      </FormShell>
    </form>
  );
}

async function postAdmin(
  path: string,
  body: Record<string, unknown>,
  dataMode: 'live' | 'preview',
) {
  if (dataMode === 'preview') {
    throw new Error(
      'This preview uses representative data. Connect the project database to enable management actions.',
    );
  }
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!response.ok)
    throw new Error(payload?.error ?? 'The action could not be completed.');
  return payload;
}

function exportAdminView(view: View, snapshot: AdminSnapshot) {
  const rows: Array<Record<string, unknown>> =
    view === 'Consultants'
      ? snapshot.consultants
      : view === 'CRM'
        ? snapshot.crmContacts
        : view === 'Commissions'
          ? snapshot.commissionEntries
          : view === 'Assignments'
            ? snapshot.assignments
            : view === 'Operations'
              ? snapshot.workflowRuns
              : view === 'Audit log'
                ? snapshot.auditEvents
                : snapshot.users;

  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const plain =
      value == null
        ? ''
        : typeof value === 'string'
          ? value
          : typeof value === 'number' || typeof value === 'boolean'
            ? value.toString()
            : JSON.stringify(value);
    return `"${plain.replaceAll('"', '""')}"`;
  };
  const csv = [
    keys.map(escape).join(','),
    ...rows.map((row) => keys.map((key) => escape(row[key])).join(',')),
  ].join('\n');
  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `pip-${view.toLowerCase().replaceAll(' ', '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
