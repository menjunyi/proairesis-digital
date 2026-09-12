import {
  auditStatement,
  authorizeAdminApi,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';
import type { CommissionSource } from '@/lib/admin-types';

export const dynamic = 'force-dynamic';

const sources: CommissionSource[] = [
  'marketing',
  'field_promotion',
  'operations',
  'referral',
];

type RuleInput = {
  sourceType: CommissionSource;
  poolRatePercent: number;
  leadSharePercent: number;
  salesSharePercent: number;
};

function readPercent(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

export async function POST(request: Request) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const body = await readJsonObject(request);
  const rawRules = Array.isArray(body?.rules) ? body.rules : [];
  const rules: RuleInput[] = rawRules.map((item) => {
    const value =
      item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return {
      sourceType: value.sourceType as CommissionSource,
      poolRatePercent: readPercent(value.poolRatePercent),
      leadSharePercent: readPercent(value.leadSharePercent),
      salesSharePercent: readPercent(value.salesSharePercent),
    };
  });

  const receivedSources = new Set(rules.map((rule) => rule.sourceType));
  const valid =
    rules.length === sources.length &&
    receivedSources.size === sources.length &&
    sources.every((source) => receivedSources.has(source)) &&
    rules.every(
      (rule) =>
        Number.isFinite(rule.poolRatePercent) &&
        rule.poolRatePercent >= 0 &&
        rule.poolRatePercent <= 100 &&
        Number.isFinite(rule.leadSharePercent) &&
        rule.leadSharePercent >= 0 &&
        rule.leadSharePercent <= 100 &&
        Number.isFinite(rule.salesSharePercent) &&
        rule.salesSharePercent >= 0 &&
        rule.salesSharePercent <= 100 &&
        Math.round(rule.leadSharePercent * 100) +
          Math.round(rule.salesSharePercent * 100) ===
          10_000,
    );

  if (!valid) {
    return Response.json(
      {
        error:
          'Set one rule for every lead source. The lead and sales shares must total 100%.',
      },
      { status: 400 },
    );
  }

  const { actor, db } = authorization.value;
  const requestId = crypto.randomUUID();
  const normalised = rules.map((rule) => ({
    ...rule,
    poolRateBps: Math.round(rule.poolRatePercent * 100),
    leadShareBps: Math.round(rule.leadSharePercent * 100),
    salesShareBps: Math.round(rule.salesSharePercent * 100),
    holdDays: 7,
  }));

  try {
    await db.batch([
      ...normalised.map((rule) =>
        db
          .prepare(
            `INSERT INTO commission_rules (
               source_type, pool_rate_bps, lead_share_bps, sales_share_bps,
               hold_days, updated_by, created_at, updated_at
             ) VALUES (?, ?, ?, ?, 7, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(source_type) DO UPDATE SET
               pool_rate_bps = excluded.pool_rate_bps,
               lead_share_bps = excluded.lead_share_bps,
               sales_share_bps = excluded.sales_share_bps,
               hold_days = 7,
               updated_by = excluded.updated_by,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .bind(
            rule.sourceType,
            rule.poolRateBps,
            rule.leadShareBps,
            rule.salesShareBps,
            actor.id,
          ),
      ),
      auditStatement(db, {
        actor,
        action: 'commission.rules_updated',
        targetType: 'commission_rules',
        targetId: 'all_sources',
        reason: 'Commission pool and attribution shares updated',
        after: normalised,
        requestId,
      }),
    ]);

    return Response.json({ rules: normalised });
  } catch (error) {
    return errorResponse(error);
  }
}
