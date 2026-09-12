import { env } from 'cloudflare:workers';

export function getDatabase(): D1Database {
  if (!env.DB) {
    throw new Error(
      'Cloudflare D1 binding `DB` is unavailable. Configure the DB binding before using admin data.',
    );
  }

  return env.DB;
}

export function getRuntimeAdminEmails(): string[] {
  return (env.SITE_SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
