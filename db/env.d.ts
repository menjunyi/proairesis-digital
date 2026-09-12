declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SITE_SUPER_ADMIN_EMAILS?: string;
    SITE_URL?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    STRIPE_MONTHLY_PRICE_ID?: string;
  }
}
