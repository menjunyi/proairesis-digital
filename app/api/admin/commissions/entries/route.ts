import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';
import type { CommissionSource } from '@/lib/admin-types';

export const dynamic = 'force-dynamic';

const sources = new Set<CommissionSource>([
  'marketing',
  'field_promotion',
  'operations',
  'referral',
]);

export async function POST(request: Request) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const body = await readJsonObject(request);
  const contactUserId = cleanText(body?.contactUserId, 100);
  const sourceType = body?.sourceType as CommissionSource;
  const sourceDetail = cleanText(body?.sourceDetail, 180);
  const leadStaffId = cleanText(body?.leadStaffId, 100);
  const salesStaffId = cleanText(body?.salesStaffId, 100);
  const stripeInvoiceId = cleanText(body?.stripeInvoiceId, 120);
  const note = cleanText(body?.note, 500);
  const currency = body?.currency === 'NZD' ? 'NZD' : 'AUD';
  const grossAmount = Number(body?.grossAmount);
  const convertedInput = cleanText(body?.convertedAt, 50);
  const convertedDate = convertedInput ? new Date(convertedInput) : new Date();

  if (
    !contactUserId ||
    !sources.has(sourceType) ||
    !leadStaffId ||
    !salesStaffId ||
    !Number.isFinite(grossAmount) ||
    grossAmount <= 0 ||
    grossAmount > 10_000_000 ||
    !Number.isFinite(convertedDate.getTime())
  ) {
    return Response.json(
      {
        error:
          'Choose the customer, source, lead owner, sales closer, amount, and conversion date.',
      },
      { status: 400 },
    );
  }

  const { actor, db } = authorization.value;
  const [contact, leadStaff, salesStaff, rule] = await Promise.all([
    db
      .prepare(
        `SELECT id, full_name FROM users
         WHERE id = ? AND role = 'registered_user' LIMIT 1`,
      )
      .bind(contactUserId)
      .first<{ id: string; full_name: string }>(),
    db
      .prepare(
        `SELECT id, name, team FROM commission_staff
         WHERE id = ? AND status = 'active' LIMIT 1`,
      )
      .bind(leadStaffId)
      .first<{ id: string; name: string; team: string }>(),
    db
      .prepare(
        `SELECT id, name, team FROM commission_staff
         WHERE id = ? AND status = 'active' LIMIT 1`,
      )
      .bind(salesStaffId)
      .first<{ id: string; name: string; team: string }>(),
    db
      .prepare(
        `SELECT pool_rate_bps, lead_share_bps, sales_share_bps
         FROM commission_rules WHERE source_type = ? LIMIT 1`,
      )
      .bind(sourceType)
      .first<{
        pool_rate_bps: number;
        lead_share_bps: number;
        sales_share_bps: number;
      }>(),
  ]);

  if (!contact)
    return Response.json({ error: 'B2C customer not found.' }, { status: 404 });
  if (!leadStaff)
    return Response.json(
      { error: 'Lead owner is not active.' },
      { status: 400 },
    );
  if (!salesStaff || salesStaff.team !== 'sales') {
    return Response.json(
      { error: 'The sales closer must be an active member of the sales team.' },
      { status: 400 },
    );
  }
  if (!rule) {
    return Response.json(
      { error: 'Save commission rules before recording a conversion.' },
      { status: 409 },
    );
  }

  const grossAmountCents = Math.round(grossAmount * 100);
  const commissionPoolCents = Math.round(
    (grossAmountCents * rule.pool_rate_bps) / 10_000,
  );
  const leadCommissionCents = Math.round(
    (commissionPoolCents * rule.lead_share_bps) / 10_000,
  );
  const salesCommissionCents = commissionPoolCents - leadCommissionCents;
  const convertedAt = convertedDate.toISOString();
  const eligibleAt = new Date(
    convertedDate.getTime() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const id = `commission_${crypto.randomUUID()}`;
  const requestId = crypto.randomUUID();
  const breakdown = {
    grossAmountCents,
    currency,
    poolRatePercent: rule.pool_rate_bps / 100,
    leadSharePercent: rule.lead_share_bps / 100,
    salesSharePercent: rule.sales_share_bps / 100,
    commissionPoolCents,
    leadCommissionCents,
    salesCommissionCents,
  };

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO commission_entries (
             id, contact_user_id, source_type, source_detail, lead_staff_id,
             sales_staff_id, gross_amount_cents, currency, pool_rate_bps,
             lead_share_bps, sales_share_bps, commission_pool_cents,
             lead_commission_cents, sales_commission_cents, status,
             converted_at, eligible_at, stripe_invoice_id, note, created_by,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(
          id,
          contactUserId,
          sourceType,
          sourceDetail,
          leadStaffId,
          salesStaffId,
          grossAmountCents,
          currency,
          rule.pool_rate_bps,
          rule.lead_share_bps,
          rule.sales_share_bps,
          commissionPoolCents,
          leadCommissionCents,
          salesCommissionCents,
          convertedAt,
          eligibleAt,
          stripeInvoiceId || null,
          note,
          actor.id,
        ),
      auditStatement(db, {
        actor,
        action: 'commission.conversion_recorded',
        targetType: 'commission_entry',
        targetId: id,
        reason: `Commission recorded for ${contact.full_name}`,
        after: {
          contactUserId,
          sourceType,
          sourceDetail,
          leadStaff: leadStaff.name,
          salesStaff: salesStaff.name,
          convertedAt,
          eligibleAt,
          stripeInvoiceId: stripeInvoiceId || null,
          ...breakdown,
        },
        requestId,
      }),
    ]);

    return Response.json(
      { id, status: 'pending', convertedAt, eligibleAt, ...breakdown },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
