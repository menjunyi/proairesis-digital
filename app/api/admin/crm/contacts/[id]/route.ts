import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';
import type { CrmPriority, CrmStage } from '@/lib/admin-types';

export const dynamic = 'force-dynamic';

const stages = new Set<CrmStage>([
  'lead',
  'qualified',
  'onboarding',
  'active_search',
  'placed',
  'nurture',
]);
const priorities = new Set<CrmPriority>(['low', 'normal', 'high']);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const body = await readJsonObject(request);
  const stage = body?.stage as CrmStage;
  const priority = body?.priority as CrmPriority;
  const source = cleanText(body?.source, 120) || 'Pip';
  const nextAction = cleanText(body?.nextAction, 240);
  const followUpInput = cleanText(body?.nextFollowUpAt, 40);
  const tags = Array.isArray(body?.tags)
    ? body.tags
        .map((tag) => cleanText(tag, 40))
        .filter(Boolean)
        .slice(0, 12)
    : [];

  if (!stages.has(stage) || !priorities.has(priority)) {
    return Response.json(
      { error: 'Choose a valid CRM stage and priority.' },
      { status: 400 },
    );
  }

  let nextFollowUpAt: string | null = null;
  if (followUpInput) {
    const followUpDate = new Date(followUpInput);
    if (!Number.isFinite(followUpDate.getTime())) {
      return Response.json(
        { error: 'Choose a valid follow-up date and time.' },
        { status: 400 },
      );
    }
    nextFollowUpAt = followUpDate.toISOString();
  }

  const { id } = await context.params;
  const { actor, db } = authorization.value;
  const contact = await db
    .prepare(
      `SELECT u.id, u.full_name, u.role, crm.stage, crm.priority, crm.source,
              crm.tags_json, crm.next_action, crm.next_follow_up_at
       FROM users u
       LEFT JOIN crm_profiles crm ON crm.user_id = u.id
       WHERE u.id = ? AND u.role IN ('registered_user', 'consultant')
       LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: string;
      full_name: string;
      role: string;
      stage: string | null;
      priority: string | null;
      source: string | null;
      tags_json: string | null;
      next_action: string | null;
      next_follow_up_at: string | null;
    }>();

  if (!contact)
    return Response.json({ error: 'CRM contact not found.' }, { status: 404 });

  const requestId = crypto.randomUUID();
  const activityId = `crm_activity_${crypto.randomUUID()}`;
  const before = {
    stage: contact.stage,
    priority: contact.priority,
    source: contact.source,
    tags: contact.tags_json,
    nextAction: contact.next_action,
    nextFollowUpAt: contact.next_follow_up_at,
  };
  const after = { stage, priority, source, tags, nextAction, nextFollowUpAt };

  try {
    const statements = [
      db
        .prepare(
          `INSERT INTO crm_profiles (
             user_id, stage, priority, owner_user_id, source, tags_json,
             next_action, next_follow_up_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             stage = excluded.stage,
             priority = excluded.priority,
             owner_user_id = excluded.owner_user_id,
             source = excluded.source,
             tags_json = excluded.tags_json,
             next_action = excluded.next_action,
             next_follow_up_at = excluded.next_follow_up_at,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          id,
          stage,
          priority,
          actor.id,
          source,
          JSON.stringify(tags),
          nextAction,
          nextFollowUpAt,
        ),
    ];

    if (contact.stage !== stage) {
      statements.push(
        db
          .prepare(
            `INSERT INTO crm_activities (
               id, contact_user_id, actor_user_id, activity_type, summary,
               occurred_at, created_at
             ) VALUES (?, ?, ?, 'status_change', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(
            activityId,
            id,
            actor.id,
            `Moved from ${contact.stage ?? 'new contact'} to ${stage.replaceAll('_', ' ')}.`,
          ),
      );
    }

    statements.push(
      auditStatement(db, {
        actor,
        action: 'crm.contact_updated',
        targetType: 'crm_contact',
        targetId: id,
        reason: `CRM record updated for ${contact.full_name}`,
        before,
        after,
        requestId,
      }),
    );

    await db.batch(statements);
    return Response.json({ id, stage, priority });
  } catch (error) {
    return errorResponse(error);
  }
}
