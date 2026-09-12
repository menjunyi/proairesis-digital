import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDatabase } from '@/db';
import { requireSuperAdmin } from './admin.server';
import type { AdminIdentity } from './admin-types';

export type ApiAdmin = {
  actor: AdminIdentity;
  db: D1Database;
};

export async function authorizeAdminApi(): Promise<
  { ok: true; value: ApiAdmin } | { ok: false; response: Response }
> {
  const authenticated = await getChatGPTUser();
  if (!authenticated && process.env.NODE_ENV !== 'development') {
    return {
      ok: false,
      response: Response.json({ error: 'Authentication required.' }, { status: 401 }),
    };
  }

  const context = await requireSuperAdmin('/admin');
  if (!context) {
    return {
      ok: false,
      response: Response.json({ error: 'Super-admin access required.' }, { status: 403 }),
    };
  }
  if (context.dataMode === 'preview') {
    return {
      ok: false,
      response: Response.json(
        { error: 'Management actions are disabled until the local or hosted database is connected.' },
        { status: 409 },
      ),
    };
  }

  return { ok: true, value: { actor: context.admin, db: getDatabase() } };
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function normaliseEmail(value: unknown): string {
  return cleanText(value, 254).toLowerCase();
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function auditStatement(
  db: D1Database,
  input: {
    actor: AdminIdentity;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    before?: unknown;
    after?: unknown;
    requestId: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO audit_events (
        actor_user_id, actor_email, action, target_type, target_id, reason,
        before_json, after_json, request_id, outcome, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', CURRENT_TIMESTAMP)`,
    )
    .bind(
      input.actor.id,
      input.actor.email,
      input.action,
      input.targetType,
      input.targetId,
      input.reason,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.requestId,
    );
}

export function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Unknown error';
  if (
    message.includes(
      'UNIQUE constraint failed: commission_entries.stripe_invoice_id',
    )
  ) {
    return Response.json(
      { error: 'A commission entry already exists for this Stripe invoice.' },
      { status: 409 },
    );
  }
  if (
    message.includes('UNIQUE constraint failed: commission_staff.email')
  ) {
    return Response.json(
      { error: 'A commission staff member with this email already exists.' },
      { status: 409 },
    );
  }
  if (message.includes('UNIQUE constraint failed')) {
    return Response.json({ error: 'An account with this email already exists.' }, { status: 409 });
  }
  return Response.json({ error: 'The action could not be completed.' }, { status: 500 });
}
