'use client';

import { useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  Banknote,
  Check,
  Clock3,
  Plus,
  RotateCcw,
  Save,
  UserPlus,
  UsersRound,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import type {
  AdminSnapshot,
  CommissionRuleView,
  CommissionSource,
  CommissionStatus,
  CommissionTeam,
} from '@/lib/admin-types';

const sourceLabels: Record<CommissionSource, string> = {
  marketing: 'Marketing',
  field_promotion: 'Offline promotion',
  operations: 'Operations',
  referral: 'Referral',
};

const teamLabels: Record<CommissionTeam, string> = {
  marketing: 'Marketing',
  field_promotion: 'Offline promotion',
  operations: 'Operations',
  sales: 'Sales',
  other: 'Other',
};

type DialogKind = 'staff' | 'conversion' | null;

export function CommissionWorkspace({
  snapshot,
  dataMode,
  onFeedback,
}: {
  snapshot: AdminSnapshot;
  dataMode: 'live' | 'preview';
  onFeedback: (message: string) => void;
}) {
  const [rules, setRules] = useState(snapshot.commissionRules);
  const [savingRules, setSavingRules] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);

  const activeEntries = snapshot.commissionEntries.filter(
    (entry) => entry.status !== 'reversed',
  );
  const actionable = snapshot.commissionEntries.filter((entry) =>
    ['eligible', 'approved'].includes(entry.status),
  );

  function completed(message: string) {
    setDialog(null);
    onFeedback(message);
    if (dataMode === 'live') {
      window.setTimeout(
        () => window.location.assign('/admin?view=Commissions'),
        450,
      );
    }
  }

  function updateRule(
    sourceType: CommissionSource,
    key: 'poolRatePercent' | 'leadSharePercent' | 'salesSharePercent',
    rawValue: string,
  ) {
    const value = rawValue === '' ? 0 : Number(rawValue);
    setRules((current) =>
      current.map((rule) =>
        rule.sourceType === sourceType ? { ...rule, [key]: value } : rule,
      ),
    );
  }

  async function saveRules() {
    setSavingRules(true);
    setRuleError(null);
    try {
      const invalid = rules.find(
        (rule) =>
          !Number.isFinite(rule.poolRatePercent) ||
          rule.poolRatePercent < 0 ||
          rule.poolRatePercent > 100 ||
          rule.leadSharePercent < 0 ||
          rule.salesSharePercent < 0 ||
          Math.abs(rule.leadSharePercent + rule.salesSharePercent - 100) >
            0.001,
      );
      if (invalid) {
        throw new Error(
          `${sourceLabels[invalid.sourceType]}: lead and sales shares must total 100%.`,
        );
      }
      await postCommission('/api/admin/commissions/rules', { rules }, dataMode);
      onFeedback('Commission rules were saved for all lead sources.');
      if (dataMode === 'live') {
        window.setTimeout(
          () => window.location.assign('/admin?view=Commissions'),
          450,
        );
      }
    } catch (caught) {
      setRuleError(
        caught instanceof Error ? caught.message : 'Could not save the rules.',
      );
    } finally {
      setSavingRules(false);
    }
  }

  async function changeStatus(
    id: string,
    status: 'approved' | 'paid' | 'reversed',
  ) {
    try {
      await postCommission(
        `/api/admin/commissions/entries/${encodeURIComponent(id)}/status`,
        { status },
        dataMode,
      );
      completed(
        status === 'reversed'
          ? 'Commission was reversed.'
          : `Commission was marked ${status}.`,
      );
    } catch (caught) {
      onFeedback(
        caught instanceof Error
          ? caught.message
          : 'Could not change the commission status.',
      );
    }
  }

  return (
    <div className="space-y-6">
      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Commission metrics"
      >
        <CommissionMetric
          icon={BadgeDollarSign}
          label="Commission pool"
          value={currencyTotals(
            activeEntries,
            (entry) => entry.commissionPoolCents,
          )}
          note="All non-reversed conversions"
        />
        <CommissionMetric
          icon={Clock3}
          label="Refund hold"
          value={String(
            snapshot.commissionEntries.filter(
              (entry) => entry.status === 'pending',
            ).length,
          )}
          note="Pending for seven days"
        />
        <CommissionMetric
          icon={Check}
          label="Needs action"
          value={String(actionable.length)}
          note="Eligible or approved"
          warning={actionable.length > 0}
        />
        <CommissionMetric
          icon={Banknote}
          label="Paid"
          value={currencyTotals(
            snapshot.commissionEntries.filter(
              (entry) => entry.status === 'paid',
            ),
            (entry) => entry.commissionPoolCents,
          )}
          note="Recorded as paid"
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#062f3b]/9 bg-[#fffaf1] shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
        <div className="flex flex-col gap-4 border-b border-[#062f3b]/9 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black tracking-[-0.025em]">
                Commission rules
              </h2>
              <Badge className="bg-[#e8f8f3] text-[#0b6c59]">
                7-day hold fixed
              </Badge>
            </div>
            <p className="mt-1 text-xs text-[#708a87]">
              Choose the pool percentage, then split that pool between the lead
              generator and sales closer for each source.
            </p>
          </div>
          <Button
            className="h-10 rounded-xl bg-[#062f3b] font-bold text-white"
            onClick={() => void saveRules()}
            disabled={savingRules}
          >
            <Save /> {savingRules ? 'Saving…' : 'Save rules'}
          </Button>
        </div>
        {ruleError ? <ErrorMessage message={ruleError} /> : null}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#fbf4e8]/65">
                <TableHead>Lead source</TableHead>
                <TableHead>Pool from sale</TableHead>
                <TableHead>Lead generator</TableHead>
                <TableHead>Sales closer</TableHead>
                <TableHead>Check</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => {
                const balanced =
                  Math.abs(
                    rule.leadSharePercent + rule.salesSharePercent - 100,
                  ) < 0.001;
                return (
                  <TableRow key={rule.sourceType}>
                    <TableCell>
                      <p className="font-black">
                        {sourceLabels[rule.sourceType]}
                      </p>
                      <p className="mt-1 text-[11px] text-[#708a87]">
                        {rule.configured
                          ? 'Configured'
                          : 'Suggested values only'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <PercentInput
                        label={`${sourceLabels[rule.sourceType]} commission pool`}
                        value={rule.poolRatePercent}
                        onChange={(value) =>
                          updateRule(rule.sourceType, 'poolRatePercent', value)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <PercentInput
                        label={`${sourceLabels[rule.sourceType]} lead share`}
                        value={rule.leadSharePercent}
                        onChange={(value) =>
                          updateRule(rule.sourceType, 'leadSharePercent', value)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <PercentInput
                        label={`${sourceLabels[rule.sourceType]} sales share`}
                        value={rule.salesSharePercent}
                        onChange={(value) =>
                          updateRule(
                            rule.sourceType,
                            'salesSharePercent',
                            value,
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          balanced
                            ? 'border-[#b9e9dc] bg-[#e8f8f3] text-[#0b6c59]'
                            : 'border-[#f3c4ba] bg-[#fff0ec] text-[#b83f28]'
                        }
                      >
                        {balanced ? 'Totals 100%' : 'Must total 100%'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="border-t border-[#062f3b]/8 bg-[#fff8df] px-5 py-3 text-xs font-semibold leading-5 text-[#795a00]">
          Example: a $2,000 sale with a 10% pool creates $200 commission. A
          30/70 split gives $60 to the lead generator and $140 to the closer.
          The suggested values are not active until saved.
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#062f3b]/9 bg-[#fffaf1] shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
        <div className="flex flex-col gap-4 border-b border-[#062f3b]/9 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black">Commission ledger</h2>
            <p className="mt-1 text-xs text-[#708a87]">
              Each conversion keeps its original rule, attribution, and payment
              trail for audit.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-10 rounded-xl bg-white font-bold"
              onClick={() => setDialog('staff')}
            >
              <UserPlus /> Add staff
            </Button>
            <Button
              className="h-10 rounded-xl bg-[#062f3b] font-bold text-white"
              onClick={() => setDialog('conversion')}
            >
              <Plus /> Record conversion
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#fbf4e8]/65">
                <TableHead>Customer / source</TableHead>
                <TableHead>Sale</TableHead>
                <TableHead>Lead generator</TableHead>
                <TableHead>Sales closer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.commissionEntries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="min-w-[210px]">
                    <p className="font-black">{entry.contactName}</p>
                    <p className="mt-1 text-[11px] text-[#708a87]">
                      {sourceLabels[entry.sourceType]}
                      {entry.sourceDetail ? ` · ${entry.sourceDetail}` : ''}
                    </p>
                    <p className="mt-1 text-[10px] text-[#8a9996]">
                      Converted {entry.convertedAt}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="font-black">
                      {money(entry.grossAmountCents, entry.currency)}
                    </p>
                    <p className="mt-1 text-[11px] text-[#708a87]">
                      Pool {entry.poolRatePercent}% ·{' '}
                      {money(entry.commissionPoolCents, entry.currency)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="font-bold">{entry.leadStaffName}</p>
                    <p className="mt-1 text-[11px] text-[#708a87]">
                      {entry.leadSharePercent}% ·{' '}
                      {money(entry.leadCommissionCents, entry.currency)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="font-bold">{entry.salesStaffName}</p>
                    <p className="mt-1 text-[11px] text-[#708a87]">
                      {entry.salesSharePercent}% ·{' '}
                      {money(entry.salesCommissionCents, entry.currency)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <CommissionStatusBadge status={entry.status} />
                    {entry.status === 'pending' ? (
                      <p className="mt-1 text-[10px] text-[#708a87]">
                        Eligible {entry.eligibleAt}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-[140px] flex-wrap gap-1.5">
                      {entry.status === 'eligible' ? (
                        <Button
                          size="sm"
                          className="bg-[#062f3b] text-white"
                          onClick={() =>
                            void changeStatus(entry.id, 'approved')
                          }
                        >
                          Approve
                        </Button>
                      ) : null}
                      {entry.status === 'approved' ? (
                        <Button
                          size="sm"
                          className="bg-[#062f3b] text-white"
                          onClick={() => void changeStatus(entry.id, 'paid')}
                        >
                          Mark paid
                        </Button>
                      ) : null}
                      {entry.status !== 'reversed' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="bg-white text-[#b83f28]"
                          onClick={() =>
                            void changeStatus(entry.id, 'reversed')
                          }
                        >
                          <RotateCcw /> Reverse
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!snapshot.commissionEntries.length ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-12 text-center text-sm text-[#708a87]"
                  >
                    No conversions recorded yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="rounded-2xl border border-[#062f3b]/9 bg-[#fffaf1] p-5 shadow-[0_8px_28px_rgba(23,60,62,0.05)]">
        <div className="flex items-center gap-2">
          <UsersRound className="size-5 text-[#0b6c59]" />
          <h2 className="text-lg font-black">Commission staff</h2>
          <Badge variant="outline" className="bg-[#fbf4e8] text-[#587174]">
            {
              snapshot.commissionStaff.filter(
                (staff) => staff.status === 'active',
              ).length
            }{' '}
            active
          </Badge>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {snapshot.commissionStaff.map((staff) => (
            <div
              key={staff.id}
              className="rounded-xl border border-[#062f3b]/9 bg-white p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-black">{staff.name}</p>
                <Badge
                  variant="outline"
                  className={
                    staff.status === 'active'
                      ? 'border-[#b9e9dc] bg-[#e8f8f3] text-[#0b6c59]'
                      : 'bg-[#fbf4e8] text-[#708a87]'
                  }
                >
                  {staff.status}
                </Badge>
              </div>
              <p className="mt-1 text-xs font-semibold text-[#315f5f]">
                {teamLabels[staff.team]}
              </p>
              <p className="mt-2 truncate text-[11px] text-[#708a87]">
                {staff.email || 'No email recorded'}
              </p>
            </div>
          ))}
          {!snapshot.commissionStaff.length ? (
            <p className="text-sm text-[#708a87]">
              Add staff before recording a conversion.
            </p>
          ) : null}
        </div>
      </section>

      <Dialog
        open={Boolean(dialog)}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        {dialog ? (
          <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl p-0 sm:max-w-lg">
            {dialog === 'staff' ? (
              <StaffForm dataMode={dataMode} onSuccess={completed} />
            ) : (
              <ConversionForm
                snapshot={snapshot}
                rules={rules}
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

function CommissionMetric({
  icon: Icon,
  label,
  value,
  note,
  warning = false,
}: {
  icon: LucideIcon;
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
          <p className="mt-3 text-2xl font-black tracking-[-0.04em]">{value}</p>
          <p className="mt-2 text-xs text-[#708a87]">{note}</p>
        </div>
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-2xl ${warning ? 'bg-[#fff0ec] text-[#b83f28]' : 'bg-[#dff7ef] text-[#0b6c59]'}`}
        >
          <Icon className="size-5" />
        </span>
      </div>
    </article>
  );
}

function PercentInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-28">
      <Input
        type="number"
        min="0"
        max="100"
        step="0.01"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 bg-white pr-8"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#708a87]">
        %
      </span>
    </div>
  );
}

function CommissionStatusBadge({ status }: { status: CommissionStatus }) {
  const style =
    status === 'paid' || status === 'approved'
      ? 'border-[#b9e9dc] bg-[#e8f8f3] text-[#0b6c59]'
      : status === 'reversed'
        ? 'border-[#f3c4ba] bg-[#fff0ec] text-[#b83f28]'
        : status === 'eligible'
          ? 'border-[#c8b6df] bg-[#f3edfa] text-[#744d9e]'
          : 'border-[#ecd99e] bg-[#fff8df] text-[#795a00]';
  return (
    <Badge variant="outline" className={`font-bold capitalize ${style}`}>
      {status}
    </Badge>
  );
}

function StaffForm({
  dataMode,
  onSuccess,
}: {
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
      await postCommission(
        '/api/admin/commissions/staff',
        {
          name: form.get('name'),
          email: form.get('email'),
          team: form.get('team'),
        },
        dataMode,
      );
      onSuccess('Commission staff member was added.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not add this staff member.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <FormHeader
        eyebrow="Commission staff"
        title="Add staff member"
        description="Add employees who may generate leads or close sales."
      />
      <div className="space-y-4 px-6 py-3">
        <ErrorMessage message={error} />
        <div className="space-y-2">
          <Label htmlFor="commission-staff-name">Name</Label>
          <Input
            id="commission-staff-name"
            name="name"
            required
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="commission-staff-email">Email (optional)</Label>
          <Input
            id="commission-staff-email"
            name="email"
            type="email"
            maxLength={254}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="commission-staff-team">Team</Label>
          <select
            id="commission-staff-team"
            name="team"
            defaultValue="marketing"
            className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
          >
            {Object.entries(teamLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <FormFooter busy={busy} label="Add staff member" />
    </form>
  );
}

function ConversionForm({
  snapshot,
  rules,
  dataMode,
  onSuccess,
}: {
  snapshot: AdminSnapshot;
  rules: CommissionRuleView[];
  dataMode: 'live' | 'preview';
  onSuccess: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<CommissionSource>('marketing');
  const [grossAmount, setGrossAmount] = useState('');
  const activeStaff = snapshot.commissionStaff.filter(
    (staff) => staff.status === 'active',
  );
  const salesStaff = activeStaff.filter((staff) => staff.team === 'sales');
  const rule = rules.find((item) => item.sourceType === source);
  const preview = useMemo(() => {
    const gross = Number(grossAmount);
    if (!rule || !Number.isFinite(gross) || gross <= 0) return null;
    const pool = (gross * rule.poolRatePercent) / 100;
    return {
      pool,
      lead: (pool * rule.leadSharePercent) / 100,
      sales: (pool * rule.salesSharePercent) / 100,
    };
  }, [grossAmount, rule]);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postCommission(
        '/api/admin/commissions/entries',
        {
          contactUserId: form.get('contactUserId'),
          sourceType: source,
          sourceDetail: form.get('sourceDetail'),
          leadStaffId: form.get('leadStaffId'),
          salesStaffId: form.get('salesStaffId'),
          grossAmount,
          currency: form.get('currency'),
          convertedAt: form.get('convertedAt'),
          stripeInvoiceId: form.get('stripeInvoiceId'),
          note: form.get('note'),
        },
        dataMode,
      );
      onSuccess('Conversion and commission split were recorded.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not record this conversion.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <FormHeader
        eyebrow="Commission ledger"
        title="Record conversion"
        description="Attribute the lead and the sale. The selected rule is copied into this record."
      />
      <div className="space-y-4 px-6 py-3">
        <ErrorMessage message={error} />
        {!rule?.configured ? (
          <p className="rounded-lg bg-[#fff8df] px-3 py-2 text-xs font-semibold text-[#795a00]">
            Save commission rules before recording a live conversion.
          </p>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="commission-contact">B2C customer</Label>
          <select
            id="commission-contact"
            name="contactUserId"
            required
            defaultValue=""
            className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
          >
            <option value="" disabled>
              Select customer
            </option>
            {snapshot.crmContacts
              .filter((contact) => contact.contactType === 'B2C candidate')
              .map((contact) => (
                <option key={contact.userId} value={contact.userId}>
                  {contact.name} · {contact.email}
                </option>
              ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="commission-source">Lead source</Label>
            <select
              id="commission-source"
              name="sourceType"
              value={source}
              onChange={(event) =>
                setSource(event.target.value as CommissionSource)
              }
              className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
            >
              {Object.entries(sourceLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="commission-source-detail">Source detail</Label>
            <Input
              id="commission-source-detail"
              name="sourceDetail"
              maxLength={180}
              placeholder="Campaign, event, referrer"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="commission-lead-owner">Lead generator</Label>
            <select
              id="commission-lead-owner"
              name="leadStaffId"
              required
              defaultValue=""
              className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
            >
              <option value="" disabled>
                Select staff
              </option>
              {activeStaff.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name} · {teamLabels[staff.team]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="commission-sales-owner">Sales closer</Label>
            <select
              id="commission-sales-owner"
              name="salesStaffId"
              required
              defaultValue=""
              className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
            >
              <option value="" disabled>
                Select sales staff
              </option>
              {salesStaff.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
          <div className="space-y-2">
            <Label htmlFor="commission-gross">Sale amount</Label>
            <Input
              id="commission-gross"
              name="grossAmount"
              type="number"
              min="0.01"
              max="10000000"
              step="0.01"
              required
              value={grossAmount}
              onChange={(event) => setGrossAmount(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="commission-currency">Currency</Label>
            <select
              id="commission-currency"
              name="currency"
              defaultValue="AUD"
              className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
            >
              <option value="AUD">AUD</option>
              <option value="NZD">NZD</option>
            </select>
          </div>
        </div>
        {preview && rule ? (
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#e8f8f3] p-3 text-center">
            <PreviewValue label="Pool" value={preview.pool} />
            <PreviewValue
              label={`Lead ${rule.leadSharePercent}%`}
              value={preview.lead}
            />
            <PreviewValue
              label={`Sales ${rule.salesSharePercent}%`}
              value={preview.sales}
            />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="commission-date">Conversion date and time</Label>
          <Input
            id="commission-date"
            name="convertedAt"
            type="datetime-local"
            required
            defaultValue={localDateTimeValue()}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="commission-invoice">
            Stripe invoice ID (recommended)
          </Label>
          <Input
            id="commission-invoice"
            name="stripeInvoiceId"
            maxLength={120}
            placeholder="in_... enables automatic refund reversal"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="commission-note">Internal note</Label>
          <Textarea id="commission-note" name="note" maxLength={500} rows={3} />
        </div>
      </div>
      <FormFooter busy={busy} label="Record conversion" />
    </form>
  );
}

function PreviewValue({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[#587174]">
        {label}
      </p>
      <p className="mt-1 text-sm font-black">{value.toFixed(2)}</p>
    </div>
  );
}

function FormHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <DialogHeader className="px-6 pb-1 pt-6">
      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#c34527]">
        {eyebrow}
      </p>
      <DialogTitle className="text-2xl font-black tracking-[-0.04em]">
        {title}
      </DialogTitle>
      <DialogDescription className="leading-6">{description}</DialogDescription>
    </DialogHeader>
  );
}

function FormFooter({ busy, label }: { busy: boolean; label: string }) {
  return (
    <DialogFooter className="mx-0 mb-0 rounded-b-2xl px-6">
      <Button
        type="submit"
        disabled={busy}
        className="h-10 rounded-xl bg-[#062f3b] px-4 font-bold text-white"
      >
        {busy ? 'Saving…' : label}
      </Button>
    </DialogFooter>
  );
}

function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <p
      role="alert"
      className="mx-5 mt-3 rounded-lg bg-[#fff0ec] px-3 py-2 text-xs font-semibold text-[#b83f28]"
    >
      {message}
    </p>
  ) : null;
}

function money(cents: number, currency: 'AUD' | 'NZD') {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function currencyTotals(
  entries: AdminSnapshot['commissionEntries'],
  select: (entry: AdminSnapshot['commissionEntries'][number]) => number,
) {
  const totals = entries.reduce(
    (sum, entry) => ({
      ...sum,
      [entry.currency]: sum[entry.currency] + select(entry),
    }),
    { AUD: 0, NZD: 0 },
  );
  const values = (['AUD', 'NZD'] as const)
    .filter((currency) => totals[currency] > 0)
    .map((currency) => money(totals[currency], currency));
  return values.length ? values.join(' · ') : '$0.00';
}

function localDateTimeValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

async function postCommission(
  path: string,
  body: Record<string, unknown>,
  dataMode: 'live' | 'preview',
) {
  if (dataMode === 'preview') {
    throw new Error(
      'Preview data is read-only. Connect the project database to save commission changes.',
    );
  }
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok)
    throw new Error(payload.error || 'The action could not be completed.');
  return payload;
}
