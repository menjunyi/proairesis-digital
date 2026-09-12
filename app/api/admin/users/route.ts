import {
  auditStatement,
  authorizeAdminApi,
  cleanText,
  errorResponse,
  normaliseEmail,
  readJsonObject,
  validEmail,
} from '@/lib/admin-actions.server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const authorization = await authorizeAdminApi();
  if (!authorization.ok) return authorization.response;

  const body = await readJsonObject(request);
  const name = cleanText(body?.name, 120);
  const email = normaliseEmail(body?.email);
  const role = body?.role === 'consultant' ? 'consultant' : 'registered_user';
  const speciality = cleanText(body?.speciality, 160);

  if (name.length < 2 || !validEmail(email)) {
    return Response.json({ error: 'Enter a valid name and email address.' }, { status: 400 });
  }
  if (role === 'consultant' && speciality.length < 2) {
    return Response.json({ error: 'Add the consultant’s speciality.' }, { status: 400 });
  }

  const { actor, db } = authorization.value;
  const id = `usr_${crypto.randomUUID()}`;
  const requestId = crypto.randomUUID();

  try {
    const statements = [
      db
        .prepare(
          `INSERT INTO users (
            id, email, full_name, role, status, onboarding_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'invited', 'not_started', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(id, email, name, role),
    ];

    if (role === 'consultant') {
      statements.push(
        db
          .prepare(
            `INSERT INTO consultant_profiles (
              user_id, speciality, service_scope, application_status,
              submitted_at, created_at, updated_at
            ) VALUES (?, ?, 'Candidate coaching and application review', 'submitted',
                      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(id, speciality),
      );
    }

    statements.push(
      auditStatement(db, {
        actor,
        action: role === 'consultant' ? 'consultant.invited' : 'user.invited',
        targetType: role === 'consultant' ? 'consultant' : 'user',
        targetId: id,
        reason: 'Invited through the admin console',
        after: { email, name, role, status: 'invited' },
        requestId,
      }),
    );

    await db.batch(statements);
    return Response.json({ id, status: 'invited' }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
