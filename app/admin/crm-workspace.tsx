'use client';

import { useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  Clock3,
  ContactRound,
  FileText,
  ListTodo,
  Mail,
  MessageSquare,
  MoreHorizontal,
  PhoneCall,
  Plus,
  Search,
  UserRound,
} from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import type {
  AdminSnapshot,
  CrmContactView,
  CrmPriority,
  CrmStage,
} from '@/lib/admin-types';

const stages: Array<{ value: CrmStage; label: string; dot: string }> = [
  { value: 'lead', label: 'New lead', dot: 'bg-[#e7a91e]' },
  { value: 'qualified', label: 'Qualified', dot: 'bg-[#5c8fa9]' },
  { value: 'onboarding', label: 'Onboarding', dot: 'bg-[#9c72c2]' },
  { value: 'active_search', label: 'Active search', dot: 'bg-[#13866f]' },
  { value: 'placed', label: 'Placed', dot: 'bg-[#062f3b]' },
  { value: 'nurture', label: 'Nurture', dot: 'bg-[#9b9a91]' },
];

type CrmDialog =
  | { kind: 'contact'; contact: CrmContactView }
  | { kind: 'activity'; contactId?: string }
  | { kind: 'task'; contactId?: string }
  | null;

export function CrmWorkspace({
  snapshot,
  dataMode,
  onFeedback,
}: {
  snapshot: AdminSnapshot;
  dataMode: 'live' | 'preview';
  onFeedback: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<CrmDialog>(null);
  const contacts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return snapshot.crmContacts;
    return snapshot.crmContacts.filter((contact) =>
      [
        contact.name,
        contact.email,
        contact.contactType,
        contact.ownerName,
        contact.source,
        contact.tags.join(' '),
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [query, snapshot.crmContacts]);

  const openTasks = snapshot.crmTasks.filter((task) => task.status === 'open');
  const dueNow = openTasks.filter((task) => task.isDue);

  function completed(message: string) {
    setDialog(null);
    onFeedback(message);
    if (dataMode === 'live') {
      window.setTimeout(() => window.location.assign('/admin?view=CRM'), 450);
    }
  }

  return (
    <div className="space-y-6">
      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="CRM metrics"
      >
        <CrmMetric
          icon={ContactRound}
          label="All contacts"
          value={String(snapshot.crmContacts.length)}
          note="Candidates and consultants"
        />
        <CrmMetric
          icon={UserRound}
          label="New leads"
          value={String(snapshot.totals.crmLeads)}
          note="Waiting to be qualified"
        />
        <CrmMetric
          icon={Clock3}
          label="Follow-ups due"
          value={String(snapshot.totals.crmFollowUpsDue)}
          note={`${openTasks.length} open tasks`}
          warning={snapshot.totals.crmFollowUpsDue > 0}
        />
        <CrmMetric
          icon={ListTodo}
          label="Active pipeline"
          value={String(snapshot.totals.crmActivePipeline)}
          note="Qualified through job search"
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#062f3b]/9 bg-[#fffaf1] shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
        <div className="flex flex-col gap-4 border-b border-[#062f3b]/9 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black tracking-[-0.025em]">
                Relationship pipeline
              </h2>
              <Badge
                variant="outline"
                className="bg-[#fbf4e8] font-bold text-[#587174]"
              >
                {contacts.length} contacts
              </Badge>
            </div>
            <p className="mt-1 text-xs text-[#708a87]">
              Move every relationship from first contact through successful
              placement.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#708a87]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search CRM contacts"
                className="h-10 rounded-xl bg-white pl-10"
              />
            </div>
            <Button
              variant="outline"
              className="h-10 rounded-xl bg-white font-bold"
              onClick={() => setDialog({ kind: 'activity' })}
            >
              <MessageSquare /> Log interaction
            </Button>
            <Button
              className="h-10 rounded-xl bg-[#062f3b] font-bold text-white"
              onClick={() => setDialog({ kind: 'task' })}
            >
              <Plus /> Follow-up
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto bg-[#fbf4e8]/65 p-4">
          <div className="grid min-w-[1430px] grid-cols-6 gap-3">
            {stages.map((stage) => {
              const stageContacts = contacts.filter(
                (contact) => contact.stage === stage.value,
              );
              return (
                <div
                  key={stage.value}
                  className="rounded-xl border border-[#062f3b]/8 bg-[#ebe8de]/55 p-2.5"
                >
                  <div className="mb-3 flex items-center gap-2 px-1">
                    <span className={`size-2 rounded-full ${stage.dot}`} />
                    <h3 className="text-xs font-black uppercase tracking-[0.08em]">
                      {stage.label}
                    </h3>
                    <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-[#587174]">
                      {stageContacts.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {stageContacts.map((contact) => (
                      <button
                        key={contact.userId}
                        type="button"
                        onClick={() => setDialog({ kind: 'contact', contact })}
                        className="block w-full rounded-xl border border-[#062f3b]/9 bg-[#fffaf1] p-3 text-left shadow-[0_4px_12px_rgba(23,60,62,0.04)] transition hover:-translate-y-0.5 hover:border-[#13866f]/35 hover:shadow-md"
                      >
                        <div className="flex items-start gap-2.5">
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#dff7ef] text-[10px] font-black text-[#0b6c59]">
                            {contact.initials}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-black">
                              {contact.name}
                            </span>
                            <span className="mt-0.5 block truncate text-[10px] font-semibold text-[#708a87]">
                              {contact.contactType}
                            </span>
                          </span>
                          {contact.priority === 'high' ? (
                            <span
                              className="mt-1 size-2 rounded-full bg-[#c34527]"
                              title="High priority"
                            />
                          ) : null}
                        </div>
                        {contact.nextAction ? (
                          <p className="mt-3 line-clamp-2 text-[11px] font-semibold leading-4 text-[#315f5f]">
                            {contact.nextAction}
                          </p>
                        ) : null}
                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#062f3b]/7 pt-2 text-[10px] text-[#708a87]">
                          <span className="truncate">{contact.ownerName}</span>
                          <span className="shrink-0">
                            {contact.nextFollowUpAt}
                          </span>
                        </div>
                      </button>
                    ))}
                    {!stageContacts.length ? (
                      <div className="rounded-xl border border-dashed border-[#062f3b]/12 px-3 py-8 text-center text-[11px] font-semibold text-[#8a9996]">
                        No contacts
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="overflow-hidden rounded-2xl border border-[#062f3b]/9 bg-[#fffaf1] shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
          <div className="flex items-center justify-between border-b border-[#062f3b]/9 p-5">
            <div>
              <h2 className="text-lg font-black">Follow-up list</h2>
              <p className="mt-1 text-xs text-[#708a87]">
                Your next relationship actions
              </p>
            </div>
            {dueNow.length ? (
              <Badge className="bg-[#fff0ec] text-[#b83f28]">
                {dueNow.length} due
              </Badge>
            ) : null}
          </div>
          <div className="divide-y divide-[#062f3b]/8">
            {openTasks.slice(0, 8).map((task) => (
              <div key={task.id} className="flex items-center gap-3 px-5 py-4">
                <button
                  type="button"
                  onClick={() =>
                    void completeTask(task.id, dataMode, completed)
                  }
                  className="grid size-8 shrink-0 place-items-center rounded-full border border-[#062f3b]/15 bg-white text-[#708a87] hover:border-[#13866f] hover:bg-[#e8f8f3] hover:text-[#0b6c59]"
                  aria-label={`Complete ${task.title}`}
                >
                  <Check className="size-4" />
                </button>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black">
                    {task.title}
                  </span>
                  <span className="mt-1 block truncate text-xs text-[#708a87]">
                    {task.contactName} · {task.dueAt}
                  </span>
                </span>
                <PriorityBadge priority={task.priority} />
              </div>
            ))}
            {!openTasks.length ? (
              <p className="px-5 py-12 text-center text-sm text-[#708a87]">
                No open follow-ups.
              </p>
            ) : null}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#062f3b]/9 bg-[#fffaf1] shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
          <div className="border-b border-[#062f3b]/9 p-5">
            <h2 className="text-lg font-black">Recent contact history</h2>
            <p className="mt-1 text-xs text-[#708a87]">
              Calls, meetings, emails, notes, and pipeline changes
            </p>
          </div>
          <div className="divide-y divide-[#062f3b]/8">
            {snapshot.crmActivities.slice(0, 8).map((activity) => {
              const Icon =
                activity.activityType === 'call'
                  ? PhoneCall
                  : activity.activityType === 'email'
                    ? Mail
                    : activity.activityType === 'meeting'
                      ? CalendarDays
                      : activity.activityType === 'note'
                        ? FileText
                        : MoreHorizontal;
              return (
                <div key={activity.id} className="flex gap-3 px-5 py-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#dff7ef] text-[#0b6c59]">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black">
                      {activity.contactName}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[#587174]">
                      {activity.summary}
                    </span>
                    <span className="mt-1.5 block text-[10px] font-semibold text-[#8a9996]">
                      {activity.actorName} · {activity.occurredAt}
                    </span>
                  </span>
                </div>
              );
            })}
            {!snapshot.crmActivities.length ? (
              <p className="px-5 py-12 text-center text-sm text-[#708a87]">
                No interactions logged yet.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <Dialog
        open={Boolean(dialog)}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        {dialog ? (
          <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl p-0 sm:max-w-lg">
            {dialog.kind === 'contact' ? (
              <ContactForm
                contact={dialog.contact}
                dataMode={dataMode}
                onSuccess={completed}
                onLog={() =>
                  setDialog({
                    kind: 'activity',
                    contactId: dialog.contact.userId,
                  })
                }
                onTask={() =>
                  setDialog({ kind: 'task', contactId: dialog.contact.userId })
                }
              />
            ) : dialog.kind === 'activity' ? (
              <ActivityForm
                contacts={snapshot.crmContacts}
                defaultContactId={dialog.contactId}
                dataMode={dataMode}
                onSuccess={completed}
              />
            ) : (
              <TaskForm
                contacts={snapshot.crmContacts}
                defaultContactId={dialog.contactId}
                dataMode={dataMode}
                onSuccess={completed}
              />
            )}
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function CrmMetric({
  icon: Icon,
  label,
  value,
  note,
  warning = false,
}: {
  icon: typeof ContactRound;
  label: string;
  value: string;
  note: string;
  warning?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-[#062f3b]/9 bg-[#fffaf1] p-5 shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-[#587174]">{label}</p>
          <p className="mt-3 text-3xl font-black tracking-[-0.04em]">{value}</p>
          <p className="mt-2 text-xs text-[#708a87]">{note}</p>
        </div>
        <span
          className={`grid size-11 place-items-center rounded-2xl ${warning ? 'bg-[#fff0ec] text-[#b83f28]' : 'bg-[#dff7ef] text-[#0b6c59]'}`}
        >
          <Icon className="size-5" />
        </span>
      </div>
    </article>
  );
}

function PriorityBadge({ priority }: { priority: CrmPriority }) {
  const styles =
    priority === 'high'
      ? 'bg-[#fff0ec] text-[#b83f28]'
      : priority === 'low'
        ? 'bg-[#edf1eb] text-[#587174]'
        : 'bg-[#fff8df] text-[#795a00]';
  return <Badge className={`${styles} capitalize`}>{priority}</Badge>;
}

function CrmFormShell({
  eyebrow,
  title,
  description,
  children,
  busy,
  submitLabel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  busy: boolean;
  submitLabel: string;
}) {
  return (
    <>
      <DialogHeader className="px-6 pb-1 pt-6">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#c34527]">
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
          className="h-10 rounded-xl bg-[#062f3b] px-4 font-bold text-white"
        >
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <p
      role="alert"
      className="rounded-lg bg-[#fff0ec] px-3 py-2 text-xs font-semibold text-[#b83f28]"
    >
      {message}
    </p>
  ) : null;
}

function ContactForm({
  contact,
  dataMode,
  onSuccess,
  onLog,
  onTask,
}: {
  contact: CrmContactView;
  dataMode: 'live' | 'preview';
  onSuccess: (message: string) => void;
  onLog: () => void;
  onTask: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const tagsValue = form.get('tags');
      await postCrm(
        `/api/admin/crm/contacts/${encodeURIComponent(contact.userId)}`,
        {
          stage: form.get('stage'),
          priority: form.get('priority'),
          source: form.get('source'),
          tags:
            typeof tagsValue === 'string'
              ? tagsValue
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean)
              : [],
          nextAction: form.get('nextAction'),
          nextFollowUpAt: form.get('nextFollowUpAt'),
        },
        dataMode,
      );
      onSuccess(`${contact.name}’s CRM record was updated.`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not update this contact.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <CrmFormShell
        eyebrow="CRM contact"
        title={contact.name}
        description={`${contact.email} · ${contact.contactType}`}
        busy={busy}
        submitLabel="Save CRM record"
      >
        <ErrorMessage message={error} />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1 bg-white font-bold"
            onClick={onLog}
          >
            <MessageSquare /> Log interaction
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1 bg-white font-bold"
            onClick={onTask}
          >
            <Plus /> Add follow-up
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="crm-stage">Pipeline stage</Label>
            <select
              id="crm-stage"
              name="stage"
              defaultValue={contact.stage}
              className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
            >
              {stages.map((stage) => (
                <option key={stage.value} value={stage.value}>
                  {stage.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="crm-priority">Priority</Label>
            <select
              id="crm-priority"
              name="priority"
              defaultValue={contact.priority}
              className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="crm-source">Source</Label>
          <Input
            id="crm-source"
            name="source"
            maxLength={120}
            defaultValue={contact.source}
            placeholder="e.g. Referral, LinkedIn, event"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="crm-tags">Tags</Label>
          <Input
            id="crm-tags"
            name="tags"
            maxLength={300}
            defaultValue={contact.tags.join(', ')}
            placeholder="e.g. Product, Sydney, priority"
          />
          <p className="text-[11px] text-[#708a87]">
            Separate tags with commas.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="crm-next-action">Next action</Label>
          <Input
            id="crm-next-action"
            name="nextAction"
            maxLength={240}
            defaultValue={contact.nextAction}
            placeholder="What should happen next?"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="crm-follow-up">Next follow-up</Label>
          <Input
            id="crm-follow-up"
            name="nextFollowUpAt"
            type="datetime-local"
            defaultValue={contact.nextFollowUpAtIso?.slice(0, 16) ?? ''}
          />
        </div>
      </CrmFormShell>
    </form>
  );
}

function ActivityForm({
  contacts,
  defaultContactId,
  dataMode,
  onSuccess,
}: {
  contacts: CrmContactView[];
  defaultContactId?: string;
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
      await postCrm(
        '/api/admin/crm/activities',
        {
          contactId: form.get('contactId'),
          activityType: form.get('activityType'),
          summary: form.get('summary'),
        },
        dataMode,
      );
      onSuccess('Interaction added to the contact history.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not log this interaction.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <CrmFormShell
        eyebrow="Contact history"
        title="Log an interaction"
        description="Keep the relationship context where the rest of the team can find it."
        busy={busy}
        submitLabel="Log interaction"
      >
        <ErrorMessage message={error} />
        <ContactSelect
          contacts={contacts}
          defaultContactId={defaultContactId}
        />
        <div className="space-y-2">
          <Label htmlFor="activity-type">Interaction type</Label>
          <select
            id="activity-type"
            name="activityType"
            defaultValue="note"
            className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
          >
            <option value="note">Internal note</option>
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="activity-summary">Summary</Label>
          <Textarea
            id="activity-summary"
            name="summary"
            required
            minLength={3}
            maxLength={1000}
            placeholder="What happened, what matters, and what comes next?"
          />
        </div>
      </CrmFormShell>
    </form>
  );
}

function TaskForm({
  contacts,
  defaultContactId,
  dataMode,
  onSuccess,
}: {
  contacts: CrmContactView[];
  defaultContactId?: string;
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
      await postCrm(
        '/api/admin/crm/tasks',
        {
          contactId: form.get('contactId'),
          title: form.get('title'),
          dueAt: form.get('dueAt'),
          priority: form.get('priority'),
        },
        dataMode,
      );
      onSuccess('Follow-up added to your CRM list.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not create this follow-up.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <CrmFormShell
        eyebrow="Next action"
        title="Create a follow-up"
        description="Give every relationship a clear owner, action, and due time."
        busy={busy}
        submitLabel="Create follow-up"
      >
        <ErrorMessage message={error} />
        <ContactSelect
          contacts={contacts}
          defaultContactId={defaultContactId}
        />
        <div className="space-y-2">
          <Label htmlFor="task-title">Action</Label>
          <Input
            id="task-title"
            name="title"
            required
            minLength={3}
            maxLength={240}
            placeholder="e.g. Review profile and call candidate"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="task-due">Due</Label>
            <Input id="task-due" name="dueAt" type="datetime-local" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-priority">Priority</Label>
            <select
              id="task-priority"
              name="priority"
              defaultValue="normal"
              className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
      </CrmFormShell>
    </form>
  );
}

function ContactSelect({
  contacts,
  defaultContactId,
}: {
  contacts: CrmContactView[];
  defaultContactId?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="crm-contact">Contact</Label>
      <select
        id="crm-contact"
        name="contactId"
        required
        defaultValue={defaultContactId ?? ''}
        className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
      >
        <option value="" disabled>
          Select a contact
        </option>
        {contacts.map((contact) => (
          <option key={contact.userId} value={contact.userId}>
            {contact.name} · {contact.contactType}
          </option>
        ))}
      </select>
    </div>
  );
}

async function completeTask(
  taskId: string,
  dataMode: 'live' | 'preview',
  onSuccess: (message: string) => void,
) {
  try {
    await postCrm(
      `/api/admin/crm/tasks/${encodeURIComponent(taskId)}/complete`,
      {},
      dataMode,
    );
    onSuccess('Follow-up marked complete.');
  } catch (caught) {
    onSuccess(
      caught instanceof Error
        ? caught.message
        : 'Could not complete this follow-up.',
    );
  }
}

async function postCrm(
  path: string,
  body: Record<string, unknown>,
  dataMode: 'live' | 'preview',
) {
  if (dataMode === 'preview')
    throw new Error(
      'This preview uses representative CRM data. Connect the project database to save changes.',
    );
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!response.ok)
    throw new Error(payload?.error ?? 'The CRM action could not be completed.');
  return payload;
}
