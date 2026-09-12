import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  BillingConfigurationError,
  billingIsConfigured,
  ensureBillingUser,
  getBillingOverview,
  getMonthlyPriceId,
  requireSameOrigin,
  storeStripeCustomer,
  stripeGet,
  stripeRequest,
  trustedSiteOrigin,
} from '@/lib/billing.server';

export const dynamic = 'force-dynamic';

const LEGAL_DOCUMENT_VERSION = '2026-09-06';
const MEMBERSHIP_AGREEMENT_VERSION = '2026-09-06';

type StripeCustomer = { id: string };
type StripeCheckoutSession = { url: string | null };
type StripePortalSession = { url: string };
type StripePrice = {
  active: boolean;
  currency: string;
  unit_amount: number | null;
  recurring: { interval: string; interval_count: number } | null;
};

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) {
    return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: 'Invalid checkout request.' },
      { status: 400 },
    );
  }
  if (formData.get('membershipAgreementAcceptance') !== 'accepted') {
    return Response.json(
      { error: 'Sign the Membership Agreement before subscribing.' },
      { status: 400 },
    );
  }

  const memberCountry = formData.get('memberCountry');
  if (memberCountry !== 'Australia' && memberCountry !== 'New Zealand') {
    return Response.json(
      { error: 'RoleClue membership is available in Australia and New Zealand.' },
      { status: 400 },
    );
  }

  const signatureValue = formData.get('membershipSignature');
  const membershipSignature =
    typeof signatureValue === 'string'
      ? signatureValue.trim().replace(/\s+/g, ' ')
      : '';
  if (membershipSignature.length < 2 || membershipSignature.length > 100) {
    return Response.json(
      { error: 'Enter your full legal name to sign the agreement.' },
      { status: 400 },
    );
  }

  const identity = await getChatGPTUser();
  if (!identity) {
    return Response.json({ error: 'Sign in to subscribe.' }, { status: 401 });
  }

  try {
    if (!billingIsConfigured()) {
      throw new BillingConfigurationError(
        'Stripe checkout and webhooks have not been fully configured.',
      );
    }
    const user = await ensureBillingUser(identity);
    if (user.status === 'suspended' || user.status === 'deactivated') {
      return Response.json(
        { error: 'This account cannot subscribe.' },
        { status: 403 },
      );
    }

    const overview = await getBillingOverview(user.id);
    const origin = trustedSiteOrigin(request);
    const agreementAcceptanceId = crypto.randomUUID();
    const agreementSignedAt = new Date().toISOString();

    const shouldManageExistingSubscription = new Set([
      'incomplete',
      'trialing',
      'active',
      'past_due',
      'unpaid',
      'paused',
    ]).has(overview.subscriptionStatus);
    if (shouldManageExistingSubscription && overview.stripeCustomerId) {
      const portal = await stripeRequest<StripePortalSession>(
        'billing_portal/sessions',
        new URLSearchParams({
          customer: overview.stripeCustomerId,
          return_url: `${origin}/billing`,
        }),
      );
      return Response.redirect(portal.url, 303);
    }

    let customerId = overview.stripeCustomerId;
    if (!customerId) {
      const customer = await stripeRequest<StripeCustomer>(
        'customers',
        new URLSearchParams({
          email: user.email,
          name: user.fullName,
          'metadata[user_id]': user.id,
        }),
        `pip-customer-${user.id}`,
      );
      customerId = customer.id;
      await storeStripeCustomer(user.id, customerId);
    }

    const priceId = getMonthlyPriceId();
    const price = await stripeGet<StripePrice>(
      `prices/${encodeURIComponent(priceId)}`,
    );
    if (
      !price.active ||
      price.currency.toLowerCase() !== 'aud' ||
      price.unit_amount !== 2000 ||
      price.recurring?.interval !== 'month' ||
      price.recurring.interval_count !== 1
    ) {
      throw new BillingConfigurationError(
        'The Stripe price must be an active AUD 20 monthly recurring price.',
      );
    }
    const checkout = await stripeRequest<StripeCheckoutSession>(
      'checkout/sessions',
      new URLSearchParams({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: user.id,
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        'metadata[user_id]': user.id,
        'metadata[price_id]': priceId,
        'metadata[legal_terms_version]': LEGAL_DOCUMENT_VERSION,
        'metadata[membership_agreement_version]': MEMBERSHIP_AGREEMENT_VERSION,
        'metadata[membership_acceptance_id]': agreementAcceptanceId,
        'metadata[membership_signed_at]': agreementSignedAt,
        'metadata[membership_signer]': membershipSignature,
        'metadata[member_country]': memberCountry,
        'subscription_data[metadata][user_id]': user.id,
        'subscription_data[metadata][plan]': 'pip_monthly_aud_20',
        'subscription_data[metadata][legal_terms_version]':
          LEGAL_DOCUMENT_VERSION,
        'subscription_data[metadata][membership_agreement_version]':
          MEMBERSHIP_AGREEMENT_VERSION,
        'subscription_data[metadata][membership_acceptance_id]':
          agreementAcceptanceId,
        'subscription_data[metadata][membership_signed_at]': agreementSignedAt,
        'subscription_data[metadata][membership_signer]': membershipSignature,
        'subscription_data[metadata][member_country]': memberCountry,
        billing_address_collection: 'required',
        'customer_update[address]': 'auto',
        success_url: `${origin}/billing?checkout=success`,
        cancel_url: `${origin}/billing?checkout=cancelled`,
        locale: 'auto',
        'custom_text[submit][message]':
          'AUD 20 is charged monthly. Every membership payment has a full, no-reason refund period of 168 hours. Your membership agreement takes effect when payment succeeds.',
      }),
    );

    if (!checkout.url) {
      return Response.json(
        { error: 'Stripe did not return a checkout URL.' },
        { status: 502 },
      );
    }
    return Response.redirect(checkout.url, 303);
  } catch (error) {
    const message =
      error instanceof BillingConfigurationError
        ? error.message
        : 'Checkout is temporarily unavailable. Please try again.';
    return Response.json({ error: message }, { status: 503 });
  }
}
