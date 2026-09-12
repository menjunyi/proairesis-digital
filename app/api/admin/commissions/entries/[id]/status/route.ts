import {
  auditStatement,
  authorizeAdminApi,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';

export const dynamic = 'force-dynamic';

type RequestedStatus = 'approved' | 'paid' | 'reversed';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const body = await readJsonObject(request);
  const nextStatus = body?.status as RequestedStatus;
  if (!['approved', 'paid', 'reversed'].includes(nextStatus)) {
    return Response.json(
      { error: 'Choose a valid commission status.' },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const { actor, db } = authorization.value;
  const entry = await db
    .prepare(
      `SELECT id, status, eligible_at, commission_pool_cents, currency
       FROM commission_entries WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: string;
      status: 'pending' | 'approved' | 'paid' | 'reversed';
      eligible_at: string;
      commission_pool_cents: number;
      currency: 'AUD' | 'NZD';
    }>();

  if (!entry)
    return Response.json(
      { error: 'Commission entry not found.' },
      { status: 404 },
    );

  const eligible = new Date(entry.eligible_at).getTime() <= Date.now();
  const effectiveStatus =
    entry.status === 'pending' && eligible ? 'eligible' : entry.status;
  const transitionAllowed =
    (nextStatus === 'approved' && effectiveStatus === 'eligible') ||
    (nextStatus === 'paid' && effectiveStatus === 'approved') ||
    (nextStatus === 'reversed' && effectiveStatus !== 'reversed');

  if (!transitionAllowed) {
    const message =
      nextStatus === 'approved' && !eligible
        ? 'This commission is still inside the seven-day refund window.'
        : `A ${effectiveStatus} commission cannot be changed to ${nextStatus}.`;
    return Response.json({ error: message }, { status: 409 });
  }

  const timestampColumn =
    nextStatus === 'approved'
      ? 'approved_at'
      : nextStatus === 'paid'
        ? 'paid_at'
        : 'reversed_at';
  const requestId = crypto.randomUUID();

  try {
    await db.batch([
      db
        .prepare(
          `UPDATE commission_entries
           SET status = ?, ${timestampColumn} = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(nextStatus, id),
      auditStatement(db, {
        actor,
        action: `commission.${nextStatus}`,
        targetType: 'commission_entry',
        targetId: id,
        reason:
          nextStatus === 'reversed'
            ? 'Commission reversed or clawed back'
            : `Commission marked ${nextStatus}`,
        before: { status: effectiveStatus },
        after: {
          status: nextStatus,
          amountCents: entry.commission_pool_cents,
          currency: entry.currency,
        },
        requestId,
      }),
    ]);

    return Response.json({ id, status: nextStatus });
  } catch (error) {
    return errorResponse(error);
  }
}
