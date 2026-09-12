import {
  ArrowLeft,
  Check,
  CreditCard,
  FileText,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { chatGPTSignInPath, getChatGPTUser } from '@/app/chatgpt-auth';
import {
  billingIsConfigured,
  ensureBillingUser,
  getBillingOverview,
  type BillingOverview,
} from '@/lib/billing.server';

export const dynamic = 'force-dynamic';

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function PlanCard({ overview }: { overview: BillingOverview | null }) {
  const active = overview?.hasPaidAccess ?? false;
  const recoverable = new Set([
    'incomplete',
    'past_due',
    'unpaid',
    'paused',
  ]).has(overview?.subscriptionStatus ?? 'inactive');
  const canManageBilling = Boolean(
    overview?.stripeCustomerId && (active || recoverable),
  );
  const periodEnd = formatDate(overview?.currentPeriodEnd ?? null);
  const freeRemaining = overview?.freeGenerationsRemaining ?? 2;

  return (
    <article className="rounded-[2rem] border border-[#17324d]/10 bg-[#ffffff] p-7 shadow-[0_24px_70px_rgba(45,91,126,0.07)] sm:p-10">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#245f8e]">
            Pip monthly
          </p>
          <div className="mt-3 flex items-end gap-2 text-[#17324d]">
            <span className="text-6xl font-semibold tracking-[-0.07em]">
              $20
            </span>
            <span className="pb-2 text-sm font-bold text-[#536d83]">
              AUD / month
            </span>
          </div>
          <p className="mt-2 max-w-xs text-xs leading-5 text-[#60798e]">
            Available in Australia and New Zealand. Charged in AUD; payment
            provider conversion fees may apply.
          </p>
        </div>
        <span
          className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] ${active ? 'bg-[#deeffc] text-[#245f8e]' : 'bg-[#e7f1f9] text-[#536d83]'}`}
        >
          {active ? 'Active' : 'Available'}
        </span>
      </div>

      <ul className="mt-8 space-y-4 text-[#425e75]">
        <li className="flex gap-3">
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#286b9e]" />
          <span>
            <strong className="text-[#17324d]">
              Two complimentary résumé generations
            </strong>{' '}
            per account—no timed trial.
          </span>
        </li>
        <li className="flex gap-3">
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#286b9e]" />
          <span>
            Continue generating résumés while your subscription is active.
          </span>
        </li>
        <li className="flex gap-3">
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#286b9e]" />
          <span>
            Automatically renews monthly using your chosen payment method.
          </span>
        </li>
        <li className="flex gap-3">
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#286b9e]" />
          <span>
            Cancel anytime; access continues until the end of the current
            billing period.
          </span>
        </li>
        <li className="flex gap-3">
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#286b9e]" />
          <span>
            Full, no-reason refund within seven days of every membership
            payment.
          </span>
        </li>
      </ul>

      {overview && (
        <div className="mt-8 rounded-2xl bg-[#e7f1f9] p-5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-bold text-[#425e75]">
              Complimentary generations remaining
            </span>
            <span className="text-2xl font-semibold text-[#286b9e]">
              {freeRemaining} / {overview.freeGenerationLimit}
            </span>
          </div>
          {active && periodEnd && (
            <p className="mt-3 border-t border-[#17324d]/10 pt-3 text-sm text-[#536d83]">
              {overview.cancelAtPeriodEnd
                ? `Your plan will end on ${periodEnd}.`
                : `Your next billing date is ${periodEnd}.`}
            </p>
          )}
        </div>
      )}

      {canManageBilling ? (
        <form action="/api/billing/portal" method="post" className="mt-7">
          <button className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-[#17324d] px-7 text-base font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#17324d]/20">
            <CreditCard className="h-5 w-5" />{' '}
            {active
              ? 'Manage billing or cancel'
              : 'Fix payment or manage billing'}
          </button>
        </form>
      ) : (
        <form action="/api/billing/checkout" method="post" className="mt-7">
          <fieldset className="rounded-2xl border border-[#17324d]/10 bg-[#e7f1f9] p-4 text-left">
            <legend className="px-2 text-sm font-semibold text-[#17324d]">
              Electronically sign your membership agreement
            </legend>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-[#536d83]">
                Your country
                <select
                  name="memberCountry"
                  required
                  defaultValue=""
                  className="mt-2 min-h-11 w-full rounded-xl border border-[#17324d]/15 bg-white px-3 text-sm font-bold text-[#17324d] outline-none focus:border-[#286b9e] focus:ring-4 focus:ring-[#286b9e]/10"
                >
                  <option value="" disabled>
                    Select country
                  </option>
                  <option value="Australia">Australia</option>
                  <option value="New Zealand">New Zealand</option>
                </select>
              </label>
              <label className="text-xs font-bold text-[#536d83]">
                Full legal name — your signature
                <input
                  type="text"
                  name="membershipSignature"
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                  placeholder="Type your full legal name"
                  className="mt-2 min-h-11 w-full rounded-xl border border-[#17324d]/15 bg-white px-3 text-sm font-bold text-[#17324d] outline-none placeholder:font-normal placeholder:text-[#60798e] focus:border-[#286b9e] focus:ring-4 focus:ring-[#286b9e]/10"
                />
              </label>
            </div>
          </fieldset>
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#17324d]/10 bg-[#e7f1f9] p-4 text-left text-xs leading-5 text-[#536d83]">
            <input
              type="checkbox"
              name="membershipAgreementAcceptance"
              value="accepted"
              required
              className="mt-1 h-4 w-4 shrink-0 accent-[#17324d]"
            />
            <span>
              I have read and agree to the{' '}
              <Link
                href="/membership-agreement"
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                Membership Agreement
              </Link>{' '}
              and{' '}
              <Link
                href="/terms"
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                Terms & Conditions
              </Link>{' '}
              and acknowledge the{' '}
              <Link
                href="/privacy"
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                Privacy Policy
              </Link>{' '}
              and{' '}
              <Link
                href="/refunds"
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                Refund & Cancellation Policy
              </Link>
              . I intend my typed name to be my electronic signature.
            </span>
          </label>
          <p className="mt-3 text-center text-xs leading-5 text-[#60798e]">
            Your signature, country, account, agreement version, and signing
            time will be recorded. The membership begins only after payment
            succeeds.
          </p>
          <button className="mt-4 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-[#286b9e] px-7 text-base font-semibold text-white shadow-[0_12px_30px_rgba(45,91,126,0.12)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#286b9e]/25">
            <CreditCard className="h-5 w-5" /> Sign agreement & continue to
            payment
          </button>
        </form>
      )}
      <p className="mt-4 text-center text-xs leading-5 text-[#60798e]">
        Secure checkout and billing management are provided by Stripe. View the{' '}
        <Link
          href="/membership-agreement"
          className="font-bold underline underline-offset-2"
        >
          Membership Agreement
        </Link>
        ,{' '}
        <Link
          href="/cookies"
          className="font-bold underline underline-offset-2"
        >
          Cookie Notice
        </Link>{' '}
        and{' '}
        <Link
          href="/disclaimer"
          className="font-bold underline underline-offset-2"
        >
          Disclaimer
        </Link>
        .
      </p>
    </article>
  );
}

export default async function BillingPage() {
  const identity = await getChatGPTUser();
  let overview: BillingOverview | null = null;
  let accountReady = true;

  if (identity) {
    try {
      const user = await ensureBillingUser(identity);
      overview = await getBillingOverview(user.id);
    } catch {
      accountReady = false;
    }
  }

  return (
    <main className="min-h-screen bg-[#f3f8fc] px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#425e75] transition-colors hover:text-[#286b9e]"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Pip
        </Link>

        <div className="mt-10 grid gap-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-start">
          <section className="pt-4">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#deeffc] px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#245f8e]">
              <Sparkles className="h-4 w-4" /> Simple monthly membership
            </span>
            <h1 className="mt-6 text-5xl font-semibold leading-[0.95] tracking-[-0.065em] text-[#17324d] sm:text-6xl">
              Start free. Subscribe when Pip earns its place.
            </h1>
            <p className="mt-6 text-lg leading-8 text-[#536d83]">
              Generate two résumés before paying. There is no countdown and no
              card is required for the complimentary allowance.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div className="flex gap-4 rounded-2xl border border-[#17324d]/10 bg-white/60 p-5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#deeffc] text-[#245f8e]">
                  <FileText className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-semibold text-[#17324d]">
                    A usage allowance, not a trial
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-[#536d83]">
                    Your two free generations do not expire.
                  </p>
                </div>
              </div>
              <div className="flex gap-4 rounded-2xl border border-[#17324d]/10 bg-white/60 p-5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#deeffc] text-[#245f8e]">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-semibold text-[#17324d]">
                    You control renewal
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-[#536d83]">
                    Manage payment details and cancellation in Stripe’s secure
                    portal.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {!identity ? (
            <article className="rounded-[2rem] border border-[#17324d]/10 bg-[#ffffff] p-8 shadow-[0_24px_70px_rgba(45,91,126,0.07)] sm:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#245f8e]">
                Your plan
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] text-[#17324d]">
                Sign in to see your usage and subscription.
              </h2>
              <p className="mt-4 leading-7 text-[#536d83]">
                Your Pip account keeps the two complimentary generations and
                billing status attached to you.
              </p>
              <a
                href={chatGPTSignInPath('/billing')}
                target="_top"
                className="mt-7 inline-flex min-h-14 w-full items-center justify-center rounded-full bg-[#17324d] px-7 text-base font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#17324d]/20"
              >
                Sign in with ChatGPT
              </a>
            </article>
          ) : !accountReady ? (
            <article className="rounded-[2rem] border border-[#286b9e]/20 bg-[#ffffff] p-8 sm:p-10">
              <h2 className="text-2xl font-semibold text-[#17324d]">
                Billing is temporarily unavailable
              </h2>
              <p className="mt-3 leading-7 text-[#536d83]">
                Your account is safe. Please try again shortly.
              </p>
            </article>
          ) : !billingIsConfigured() ? (
            <article className="rounded-[2rem] border border-[#a9cfec]/50 bg-[#ffffff] p-8 sm:p-10">
              <h2 className="text-2xl font-semibold text-[#17324d]">
                Stripe setup is nearly complete
              </h2>
              <p className="mt-3 leading-7 text-[#536d83]">
                The plan is ready, but checkout will open after the Stripe
                product and secure keys are connected.
              </p>
            </article>
          ) : (
            <PlanCard overview={overview} />
          )}
        </div>
      </div>
    </main>
  );
}
