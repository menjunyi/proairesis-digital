import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  normaliseEmail,
  readJsonObject,
  validEmail,
} from '@/lib/admin-actions.server';
import type { CommissionTeam } from '@/lib/admin-types';

export const dynamic = 'force-dynamic';

const teams = new Set<CommissionTeam>([
  'marketing',
  'field_promotion',
  'operations',
  'sales',
  'other',
]);

export async function POST(request: Request) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const body = await readJsonObject(request);
  const name = cleanText(body?.name, 120);
  const email = normaliseEmail(body?.email);
  const team = body?.team as CommissionTeam;

  if (name.length < 2 || !teams.has(team) || (email && !validEmail(email))) {
    return Response.json(
      { error: 'Enter a name, a valid optional email, and a valid team.' },
      { status: 400 },
    );
  }

  const { actor, db } = authorization.value;
  const id = `commission_staff_${crypto.randomUUID()}`;
  const requestId = crypto.randomUUID();

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO commission_staff (
             id, name, email, team, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(id, name, email || null, team),
      auditStatement(db, {
        actor,
        action: 'commission.staff_created',
        targetType: 'commission_staff',
        targetId: id,
        reason: `Commission staff member added to ${team.replaceAll('_', ' ')}`,
        after: { name, email: email || null, team, status: 'active' },
        requestId,
      }),
    ]);

    return Response.json(
      { id, name, email, team, status: 'active' },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
