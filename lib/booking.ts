/** A public scheduling link only; never a calendar API credential. */
export function getBookingSchedule(): { url: string; embedUrl: string | null } | null {
  const value = (process.env.CONTACT_BOOKING_URL ?? 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ3lm9q0zenb-oRZGNMVkdohsSqxLMBT57cjKzMwPkgn8C1if7SzQh5VxIJPbbUd-uCk9upNcKzI').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    // Only the documented Google appointment-schedule endpoint is embedded.
    const isGoogleSchedule = url.hostname === 'calendar.google.com'
      && /^\/calendar\/appointments\/schedules\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
    const embed = isGoogleSchedule ? new URL(url.href) : null;
    if (embed) embed.searchParams.set('gv', 'true');
    return { url: url.href, embedUrl: embed?.href ?? null };
  } catch { return null; }
}
