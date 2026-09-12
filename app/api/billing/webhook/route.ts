import { getWebhookSecret } from '@/lib/billing.server';
import { verifyStripeSignature } from '@/lib/stripe-signature';
import {
  parseStripeEvent,
  processStripeEvent,
} from '@/lib/stripe-webhook.server';

export const dynamic = 'force-dynamic';

const MAX_WEBHOOK_BYTES = 1024 * 1024;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: 'Payload too large.' }, { status: 413 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return Response.json(
      { error: 'Missing Stripe signature.' },
      { status: 400 },
    );
  }

  const payload = await request.text();
  if (new TextEncoder().encode(payload).byteLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: 'Payload too large.' }, { status: 413 });
  }

  let verified = false;
  try {
    verified = await verifyStripeSignature(
      payload,
      signature,
      getWebhookSecret(),
    );
  } catch {
    return Response.json(
      { error: 'Webhook is not configured.' },
      { status: 503 },
    );
  }
  if (!verified) {
    return Response.json(
      { error: 'Invalid Stripe signature.' },
      { status: 400 },
    );
  }

  const event = parseStripeEvent(payload);
  if (!event) {
    return Response.json({ error: 'Invalid Stripe event.' }, { status: 400 });
  }

  try {
    await processStripeEvent(event);
    return Response.json({ received: true });
  } catch {
    return Response.json(
      { error: 'Webhook processing failed.' },
      { status: 500 },
    );
  }
}
