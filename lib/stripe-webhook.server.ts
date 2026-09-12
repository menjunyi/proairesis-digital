import type {
  D1Database,
  D1PreparedStatement,
} from '@cloudflare/workers-types';
import { getDatabase } from '@/db';
import type { SubscriptionStatus } from './billing.server';

const KNOWN_STATUSES = new Set<SubscriptionStatus>([
  'inactive',
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'paused',
  'canceled',
]);

type StripeReference = string | { id?: string } | null | undefined;

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

function referenceId(value: StripeReference): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value.id === 'string') return value.id;
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function unixToIso(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
}

function subscriptionIdFromInvoice(
  object: Record<string, unknown>,
): string | null {
  const legacy = referenceId(object.subscription as StripeReference);
  if (legacy) return legacy;
  const parent = object.parent as Record<string, unknown> | undefined;
  const details = parent?.subscription_details as
    | Record<string, unknown>
    | undefined;
  return referenceId(details?.subscription as StripeReference);
}

function subscriptionPeriodEnd(object: Record<string, unknown>): string | null {
  const direct = unixToIso(object.current_period_end);
  if (direct) return direct;
  const items = object.items as
    | { data?: Array<Record<string, unknown>> }
    | undefined;
  const itemEnds = (items?.data ?? [])
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === 'number');
  return itemEnds.length ? unixToIso(Math.max(...itemEnds)) : null;
}

function subscriptionPriceId(object: Record<string, unknown>): string | null {
  const items = object.items as
    | { data?: Array<Record<string, unknown>> }
    | undefined;
  const firstItem = items?.data?.[0];
  const price = firstItem?.price as Record<string, unknown> | undefined;
  return stringValue(price?.id);
}

function metadataUserId(object: Record<string, unknown>): string | null {
  const metadata = object.metadata as Record<string, unknown> | undefined;
  return stringValue(metadata?.user_id);
}

function normaliseStatus(value: unknown): SubscriptionStatus {
  return typeof value === 'string' &&
    KNOWN_STATUSES.has(value as SubscriptionStatus)
    ? (value as SubscriptionStatus)
    : 'inactive';
}

export function parseStripeEvent(payload: string): StripeEvent | null {
  try {
    const event = JSON.parse(payload) as Partial<StripeEvent>;
    if (
      typeof event.id !== 'string' ||
      typeof event.type !== 'string' ||
      !event.data ||
      typeof event.data.object !== 'object' ||
      !event.data.object
    ) {
      return null;
    }
    return event as StripeEvent;
  } catch {
    return null;
  }
}

async function eventWasProcessed(
  db: D1Database,
  eventId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      'SELECT stripe_event_id FROM billing_events WHERE stripe_event_id = ? LIMIT 1',
    )
    .bind(eventId)
    .first<{ stripe_event_id: string }>();
  return Boolean(row);
}

async function resolveUserId(
  db: D1Database,
  object: Record<string, unknown>,
): Promise<string | null> {
  const metadataId = metadataUserId(object);
  if (metadataId) {
    const exists = await db
      .prepare('SELECT id FROM users WHERE id = ? LIMIT 1')
      .bind(metadataId)
      .first<{ id: string }>();
    if (exists) return exists.id;
  }

  const subscriptionId = stringValue(object.id)?.startsWith('sub_')
    ? stringValue(object.id)
    : (subscriptionIdFromInvoice(object) ??
      referenceId(object.subscription as StripeReference));
  const customerId = referenceId(object.customer as StripeReference);
  if (!subscriptionId && !customerId) return null;

  const row = await db
    .prepare(
      `SELECT user_id FROM subscriptions
       WHERE (? IS NOT NULL AND stripe_subscription_id = ?)
          OR (? IS NOT NULL AND stripe_customer_id = ?)
       LIMIT 1`,
    )
    .bind(subscriptionId, subscriptionId, customerId, customerId)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

function recordEventStatement(
  db: D1Database,
  event: StripeEvent,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO billing_events (stripe_event_id, event_type, processed_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(event.id, event.type);
}

export async function processStripeEvent(event: StripeEvent): Promise<void> {
  const db = getDatabase();
  if (await eventWasProcessed(db, event.id)) return;

  const object = event.data.object;
  const statements: D1PreparedStatement[] = [];

  if (event.type === 'checkout.session.completed') {
    const candidateUserId =
      stringValue(object.client_reference_id) ?? metadataUserId(object);
    const verifiedUser = candidateUserId
      ? await db
          .prepare('SELECT id FROM users WHERE id = ? LIMIT 1')
          .bind(candidateUserId)
          .first<{ id: string }>()
      : null;
    const userId = verifiedUser?.id ?? null;
    const customerId = referenceId(object.customer as StripeReference);
    const subscriptionId = referenceId(object.subscription as StripeReference);
    if (userId && customerId) {
      statements.push(
        db
          .prepare(
            `INSERT INTO subscriptions (
               user_id, stripe_customer_id, stripe_subscription_id,
               stripe_price_id, status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, 'incomplete', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id) DO UPDATE SET
               stripe_customer_id = excluded.stripe_customer_id,
               stripe_subscription_id = excluded.stripe_subscription_id,
               stripe_price_id = COALESCE(excluded.stripe_price_id, subscriptions.stripe_price_id),
               status = CASE
                 WHEN subscriptions.status IN ('active', 'trialing') THEN subscriptions.status
                 ELSE 'incomplete' END,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .bind(
            userId,
            customerId,
            subscriptionId,
            metadataUserId(object)
              ? stringValue(
                  (object.metadata as Record<string, unknown>).price_id,
                )
              : null,
          ),
      );
    }
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const userId = await resolveUserId(db, object);
    const customerId = referenceId(object.customer as StripeReference);
    const subscriptionId = stringValue(object.id);
    if (userId && customerId && subscriptionId) {
      const status =
        event.type === 'customer.subscription.deleted'
          ? 'canceled'
          : normaliseStatus(object.status);
      statements.push(
        db
          .prepare(
            `INSERT INTO subscriptions (
               user_id, stripe_customer_id, stripe_subscription_id,
               stripe_price_id, status, cancel_at_period_end,
               current_period_end, cancel_at, canceled_at,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id) DO UPDATE SET
               stripe_customer_id = excluded.stripe_customer_id,
               stripe_subscription_id = excluded.stripe_subscription_id,
               stripe_price_id = COALESCE(excluded.stripe_price_id, subscriptions.stripe_price_id),
               status = excluded.status,
               cancel_at_period_end = excluded.cancel_at_period_end,
               current_period_end = excluded.current_period_end,
               cancel_at = excluded.cancel_at,
               canceled_at = excluded.canceled_at,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .bind(
            userId,
            customerId,
            subscriptionId,
            subscriptionPriceId(object),
            status,
            object.cancel_at_period_end === true ? 1 : 0,
            subscriptionPeriodEnd(object),
            unixToIso(object.cancel_at),
            unixToIso(object.canceled_at),
          ),
      );
    }
  }

  if (
    event.type === 'invoice.paid' ||
    event.type === 'invoice.payment_failed'
  ) {
    const userId = await resolveUserId(db, object);
    const subscriptionId = subscriptionIdFromInvoice(object);
    const customerId = referenceId(object.customer as StripeReference);
    const invoiceId = stringValue(object.id);
    const lines = object.lines as
      | { data?: Array<Record<string, unknown>> }
      | undefined;
    const period = lines?.data?.[0]?.period as
      | Record<string, unknown>
      | undefined;
    if (userId) {
      statements.push(
        db
          .prepare(
            `UPDATE subscriptions
             SET stripe_subscription_id = COALESCE(?, stripe_subscription_id),
                 stripe_customer_id = COALESCE(?, stripe_customer_id),
                 status = CASE
                   WHEN ? = 'invoice.paid' THEN 'active'
                   WHEN status IN ('canceled', 'unpaid') THEN status
                   ELSE 'past_due' END,
                 current_period_end = COALESCE(?, current_period_end),
                 latest_invoice_id = COALESCE(?, latest_invoice_id),
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ?`,
          )
          .bind(
            subscriptionId,
            customerId,
            event.type,
            unixToIso(period?.end),
            invoiceId,
            userId,
          ),
      );
    }
  }

  if (event.type === 'charge.refunded' && object.refunded === true) {
    const invoiceId = referenceId(object.invoice as StripeReference);
    if (invoiceId) {
      statements.push(
        db
          .prepare(
            `UPDATE commission_entries
             SET status = 'reversed', reversed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE stripe_invoice_id = ? AND status != 'reversed'`,
          )
          .bind(invoiceId),
        db
          .prepare(
            `INSERT INTO audit_events (
               actor_user_id, actor_email, action, target_type, target_id,
               reason, before_json, after_json, request_id, outcome, created_at
             ) VALUES (
               NULL, 'stripe-webhook@system.pip', 'commission.refund_reversed',
               'stripe_invoice', ?, 'Full Stripe refund received', NULL,
               ?, ?, 'succeeded', CURRENT_TIMESTAMP
             )`,
          )
          .bind(
            invoiceId,
            JSON.stringify({ status: 'reversed', stripeChargeId: stringValue(object.id) }),
            event.id,
          ),
      );
    }
  }

  statements.push(recordEventStatement(db, event));
  await db.batch(statements);
}
