// Public contact details only. Never use an authentication/admin email as a fallback.
export function getContactDetails() {
  const candidate = (process.env.CONTACT_EMAIL ?? 'hello@proairesis.digital').trim();
  const email = /^[^\s@<>?&#]+@[^\s@<>?&#]+\.[^\s@<>?&#]+$/.test(candidate)
    ? candidate
    : null;
  let bookingUrl: string | null = null;
  try {
    const url = new URL(process.env.CONTACT_BOOKING_URL ?? '');
    if (url.protocol === 'https:' && !url.username && !url.password)
      bookingUrl = url.href;
  } catch {
    /* A booking service is optional; email can arrange the meeting. */
  }
  const subject = encodeURIComponent(
    'Arrange a conversation about my job search',
  );
  const body = encodeURIComponent(
    'Hi,\n\nI would like to arrange a conversation about my job search.\n\nTarget roles:\nPreferred locations:\nQuestions I would like to discuss:\nSuitable dates and times:\nMy time zone:\n\nThank you.',
  );
  return {
    email,
    hasBookingLink: Boolean(bookingUrl),
    meetingHref:
      bookingUrl ??
      (email ? `mailto:${email}?subject=${subject}&body=${body}` : null),
  };
}
