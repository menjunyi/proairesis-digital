import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  BillingConfigurationError,
  ensureBillingUser,
  getBillingOverview,
  requireSameOrigin,
  stripeRequest,
  trustedSiteOrigin,
} from '@/lib/billing.server';

export const dynamic = 'force-dynamic';

type StripePortalSession = { url: string };

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) {
    return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const identity = await getChatGPTUser();
  if (!identity) {
    return Response.json(
      { error: 'Sign in to manage billing.' },
      { status: 401 },
    );
  }

  try {
    const user = await ensureBillingUser(identity);
    const overview = await getBillingOverview(user.id);
    if (!overview.stripeCustomerId) {
      return Response.redirect(
        `${trustedSiteOrigin(request)}/billing?portal=unavailable`,
        303,
      );
    }

    const portal = await stripeRequest<StripePortalSession>(
      'billing_portal/sessions',
      new URLSearchParams({
        customer: overview.stripeCustomerId,
        return_url: `${trustedSiteOrigin(request)}/billing`,
      }),
    );
    return Response.redirect(portal.url, 303);
  } catch (error) {
    const message =
      error instanceof BillingConfigurationError
        ? error.message
        : 'Billing management is temporarily unavailable. Please try again.';
    return Response.json({ error: message }, { status: 503 });
  }
}
