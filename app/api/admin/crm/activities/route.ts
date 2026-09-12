import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';

export const dynamic = 'force-dynamic';

const activityTypes = new Set(['note', 'call', 'email', 'meeting']);

export async function POST(request: Request) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const body = await readJsonObject(request);
  const contactId = cleanText(body?.contactId, 100);
  const activityType = cleanText(body?.activityType, 30);
  const summary = cleanText(body?.summary, 1000);

  if (!contactId || !activityTypes.has(activityType) || summary.length < 3) {
    return Response.json(
      { error: 'Choose a contact, interaction type, and useful summary.' },
      { status: 400 },
    );
  }

  const { actor, db } = authorization.value;
  const contact = await db
    .prepare(
      `SELECT id, full_name FROM users
       WHERE id = ? AND role IN ('registered_user', 'consultant') LIMIT 1`,
    )
    .bind(contactId)
    .first<{ id: string; full_name: string }>();
  if (!contact)
    return Response.json({ error: 'CRM contact not found.' }, { status: 404 });

  const id = `crm_activity_${crypto.randomUUID()}`;
  const requestId = crypto.randomUUID();

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO crm_activities (
             id, contact_user_id, actor_user_id, activity_type, summary,
             occurred_at, created_at
           ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(id, contactId, actor.id, activityType, summary),
      db
        .prepare(
          `INSERT INTO crm_profiles (
             user_id, owner_user_id, last_contacted_at, created_at, updated_at
           ) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             owner_user_id = COALESCE(crm_profiles.owner_user_id, excluded.owner_user_id),
             last_contacted_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(contactId, actor.id),
      auditStatement(db, {
        actor,
        action: 'crm.activity_logged',
        targetType: 'crm_contact',
        targetId: contactId,
        reason: `${activityType} logged for ${contact.full_name}`,
        after: { id, activityType, summary },
        requestId,
      }),
    ]);
    return Response.json({ id, contactId }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
