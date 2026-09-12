import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  readJsonObject,
} from '@/lib/admin-actions.server';
import type { CrmPriority } from '@/lib/admin-types';

export const dynamic = 'force-dynamic';

const priorities = new Set<CrmPriority>(['low', 'normal', 'high']);

export async function POST(request: Request) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const body = await readJsonObject(request);
  const contactId = cleanText(body?.contactId, 100);
  const title = cleanText(body?.title, 240);
  const dueInput = cleanText(body?.dueAt, 40);
  const priority = body?.priority as CrmPriority;
  const dueDate = new Date(dueInput);

  if (
    !contactId ||
    title.length < 3 ||
    !priorities.has(priority) ||
    !dueInput ||
    !Number.isFinite(dueDate.getTime())
  ) {
    return Response.json(
      { error: 'Choose a contact, task, priority, and valid due time.' },
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

  const id = `crm_task_${crypto.randomUUID()}`;
  const requestId = crypto.randomUUID();
  const dueAt = dueDate.toISOString();

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO crm_tasks (
             id, contact_user_id, assigned_to, title, due_at, status, priority,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'open', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(id, contactId, actor.id, title, dueAt, priority),
      db
        .prepare(
          `INSERT INTO crm_profiles (
             user_id, owner_user_id, next_action, next_follow_up_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             owner_user_id = COALESCE(crm_profiles.owner_user_id, excluded.owner_user_id),
             next_action = excluded.next_action,
             next_follow_up_at = excluded.next_follow_up_at,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(contactId, actor.id, title, dueAt),
      auditStatement(db, {
        actor,
        action: 'crm.task_created',
        targetType: 'crm_task',
        targetId: id,
        reason: `Follow-up created for ${contact.full_name}`,
        after: { contactId, title, dueAt, priority },
        requestId,
      }),
    ]);
    return Response.json({ id, status: 'open' }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
