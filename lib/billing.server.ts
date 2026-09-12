import { env } from 'cloudflare:workers';
import type { ChatGPTUser } from '@/app/chatgpt-auth';
import { getDatabase } from '@/db';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const FREE_RESUME_GENERATIONS = 2;
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

export type SubscriptionStatus =
  | 'inactive'
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'paused'
  | 'canceled';

export type BillingUser = {
  id: string;
  email: string;
  fullName: string;
  status: 'invited' | 'active' | 'suspended' | 'deactivated';
};

export type BillingOverview = {
  subscriptionStatus: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  freeGenerationLimit: number;
  freeGenerationsUsed: number;
  freeGenerationsRemaining: number;
  totalGenerations: number;
  hasPaidAccess: boolean;
};

type StripeErrorResponse = {
  error?: { message?: string; type?: string };
};

export class BillingConfigurationError extends Error {}

export class StripeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function billingIsConfigured(): boolean {
  return Boolean(
    validRuntimeValue(env.STRIPE_SECRET_KEY, 'sk_') &&
    validRuntimeValue(env.STRIPE_WEBHOOK_SECRET, 'whsec_') &&
    validRuntimeValue(env.STRIPE_MONTHLY_PRICE_ID, 'price_'),
  );
}

export function webhookIsConfigured(): boolean {
  return validRuntimeValue(env.STRIPE_WEBHOOK_SECRET, 'whsec_');
}

function validRuntimeValue(
  value: string | undefined,
  prefix: string,
): value is string {
  const candidate = value?.trim() ?? '';
  return candidate.startsWith(prefix) && !candidate.includes('replace_me');
}

export function getMonthlyPriceId(): string {
  const priceId = env.STRIPE_MONTHLY_PRICE_ID?.trim();
  if (!validRuntimeValue(priceId, 'price_')) {
    throw new BillingConfigurationError(
      'The monthly Stripe price has not been configured.',
    );
  }
  return priceId;
}

export function getWebhookSecret(): string {
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!validRuntimeValue(secret, 'whsec_')) {
    throw new BillingConfigurationError(
      'The Stripe webhook secret has not been configured.',
    );
  }
  return secret;
}

function getStripeSecretKey(): string {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  if (!validRuntimeValue(secret, 'sk_')) {
    throw new BillingConfigurationError('Stripe has not been configured.');
  }
  return secret;
}

export async function stripeRequest<T>(
  path: string,
  parameters: URLSearchParams,
  idempotencyKey?: string,
): Promise<T> {
  const headers = new Headers({
    Authorization: `Bearer ${getStripeSecretKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);

  const response = await fetch(`${STRIPE_API_BASE}/${path}`, {
    method: 'POST',
    headers,
    body: parameters,
  });
  const data = (await response.json()) as T & StripeErrorResponse;
  if (!response.ok) {
    throw new StripeRequestError(
      data.error?.message ?? 'Stripe could not complete the request.',
      response.status,
    );
  }
  return data;
}

export async function stripeGet<T>(path: string): Promise<T> {
  const response = await fetch(`${STRIPE_API_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${getStripeSecretKey()}` },
  });
  const data = (await response.json()) as T & StripeErrorResponse;
  if (!response.ok) {
    throw new StripeRequestError(
      data.error?.message ?? 'Stripe could not complete the request.',
      response.status,
    );
  }
  return data;
}

export async function ensureBillingUser(
  identity: ChatGPTUser,
): Promise<BillingUser> {
  const db = getDatabase();
  const email = identity.email.trim().toLowerCase();
  const fullName = (identity.fullName ?? identity.displayName ?? email).trim();
  const existing = await db
    .prepare(
      `SELECT id, email, full_name, status
       FROM users
       WHERE auth_user_id = ? OR lower(email) = lower(?)
       LIMIT 1`,
    )
    .bind(identity.userId, email)
    .first<{
      id: string;
      email: string;
      full_name: string;
      status: BillingUser['status'];
    }>();

  const userId = existing?.id ?? `usr_${identity.userId}`;
  if (existing) {
    await db
      .prepare(
        `UPDATE users
         SET auth_user_id = ?, email = ?, full_name = ?,
             status = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
             email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
             last_active_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(identity.userId, email, fullName, userId)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO users (
           id, auth_user_id, email, full_name, role, status,
           email_verified_at, onboarding_status, last_active_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'registered_user', 'active',
                   CURRENT_TIMESTAMP, 'not_started', CURRENT_TIMESTAMP,
                   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(userId, identity.userId, email, fullName)
      .run();
  }

  await db
    .prepare(
      `INSERT INTO resume_generation_usage (
         user_id, free_generation_limit, free_generations_used,
         total_generations, created_at, updated_at
       ) VALUES (?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO NOTHING`,
    )
    .bind(userId, FREE_RESUME_GENERATIONS)
    .run();

  return {
    id: userId,
    email,
    fullName,
    status:
      existing?.status === 'invited' || !existing ? 'active' : existing.status,
  };
}

export async function getBillingOverview(
  userId: string,
): Promise<BillingOverview> {
  const db = getDatabase();
  const row = await db
    .prepare(
      `SELECT
         COALESCE(s.status, 'inactive') AS subscription_status,
         COALESCE(s.cancel_at_period_end, 0) AS cancel_at_period_end,
         s.current_period_end,
         s.stripe_customer_id,
         u.free_generation_limit,
         u.free_generations_used,
         u.total_generations,
         s.stripe_price_id
       FROM resume_generation_usage u
       LEFT JOIN subscriptions s ON s.user_id = u.user_id
       WHERE u.user_id = ?
       LIMIT 1`,
    )
    .bind(userId)
    .first<{
      subscription_status: SubscriptionStatus;
      cancel_at_period_end: number;
      current_period_end: string | null;
      stripe_customer_id: string | null;
      free_generation_limit: number;
      free_generations_used: number;
      total_generations: number;
      stripe_price_id: string | null;
    }>();

  const limit = row?.free_generation_limit ?? FREE_RESUME_GENERATIONS;
  const used = row?.free_generations_used ?? 0;
  const status = row?.subscription_status ?? 'inactive';
  const configuredPriceId = env.STRIPE_MONTHLY_PRICE_ID?.trim();
  const isConfiguredPlan =
    !configuredPriceId || row?.stripe_price_id === configuredPriceId;

  return {
    subscriptionStatus: status,
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    currentPeriodEnd: row?.current_period_end ?? null,
    stripeCustomerId: row?.stripe_customer_id ?? null,
    freeGenerationLimit: limit,
    freeGenerationsUsed: used,
    freeGenerationsRemaining: Math.max(0, limit - used),
    totalGenerations: row?.total_generations ?? 0,
    hasPaidAccess: ACTIVE_SUBSCRIPTION_STATUSES.has(status) && isConfiguredPlan,
  };
}

export async function storeStripeCustomer(
  userId: string,
  customerId: string,
): Promise<void> {
  const db = getDatabase();
  await db
    .prepare(
      `INSERT INTO subscriptions (
         user_id, stripe_customer_id, status, created_at, updated_at
       ) VALUES (?, ?, 'inactive', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         stripe_customer_id = excluded.stripe_customer_id,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(userId, customerId)
    .run();
}

export async function reserveResumeGeneration(userId: string): Promise<{
  allowed: boolean;
  access: 'complimentary' | 'subscription' | 'none';
  freeGenerationsRemaining: number;
}> {
  const db = getDatabase();
  await db
    .prepare(
      `INSERT INTO resume_generation_usage (
         user_id, free_generation_limit, free_generations_used,
         total_generations, created_at, updated_at
       ) VALUES (?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO NOTHING`,
    )
    .bind(userId, FREE_RESUME_GENERATIONS)
    .run();

  const configuredPriceId = env.STRIPE_MONTHLY_PRICE_ID?.trim() ?? '';
  const row = await db
    .prepare(
      `UPDATE resume_generation_usage
       SET free_generations_used = free_generations_used + CASE
             WHEN EXISTS (
               SELECT 1 FROM subscriptions s
               WHERE s.user_id = resume_generation_usage.user_id
                 AND s.status IN ('active', 'trialing')
                 AND (? = '' OR s.stripe_price_id = ?)
             ) THEN 0 ELSE 1 END,
           total_generations = total_generations + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?
         AND (
           free_generations_used < free_generation_limit
           OR EXISTS (
             SELECT 1 FROM subscriptions s
             WHERE s.user_id = resume_generation_usage.user_id
               AND s.status IN ('active', 'trialing')
               AND (? = '' OR s.stripe_price_id = ?)
           )
         )
       RETURNING free_generation_limit, free_generations_used`,
    )
    .bind(
      configuredPriceId,
      configuredPriceId,
      userId,
      configuredPriceId,
      configuredPriceId,
    )
    .first<{
      free_generation_limit: number;
      free_generations_used: number;
    }>();

  if (!row) {
    return { allowed: false, access: 'none', freeGenerationsRemaining: 0 };
  }

  const overview = await getBillingOverview(userId);
  return {
    allowed: true,
    access: overview.hasPaidAccess ? 'subscription' : 'complimentary',
    freeGenerationsRemaining: Math.max(
      0,
      row.free_generation_limit - row.free_generations_used,
    ),
  };
}

export function requireSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

export function trustedSiteOrigin(request: Request): string {
  const configured = env.SITE_URL?.trim();
  if (configured) {
    const parsed = new URL(configured);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      throw new BillingConfigurationError('SITE_URL must use HTTPS.');
    }
    return parsed.origin;
  }
  return new URL(request.url).origin;
}
