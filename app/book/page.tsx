import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, CalendarDays, Mail, ShieldCheck } from 'lucide-react';
import { RoleClueMark } from '@/components/roleclue-mark';
import { getContactDetails } from '@/lib/contact';
import { getBookingSchedule } from '@/lib/booking';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Book a conversation — RoleClue',
  description: 'Choose a time to talk about your Australian job search with RoleClue.',
  robots: { index: false, follow: true },
};

export default function BookingPage() {
  const { email } = getContactDetails();
  const schedule = getBookingSchedule();
  return <main className="min-h-screen bg-background text-foreground">
    <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-5 px-6 py-7">
      <Link href="/" className="flex items-center gap-3 text-2xl font-extrabold tracking-tight text-[#c34527]"><RoleClueMark className="size-9" />RoleClue</Link>
      <Link href="/" className="flex items-center gap-2 text-sm"><ArrowLeft size={16} />Back to the website</Link>
    </header>
    <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 lg:grid-cols-[0.7fr_1.3fr] lg:py-20">
      <aside>
        <p className="mb-5 text-xs font-bold uppercase tracking-[.15em] text-[#526d70]">LET’S TALK ABOUT YOUR NEXT MOVE</p>
        <h1 className="text-5xl font-bold leading-[1.05] lg:text-6xl">A conversation.<br />A clearer next step.</h1>
        <p className="mt-6 max-w-md text-base leading-7 text-[#526d70]">Tell us about the roles you’re looking for and the requirements getting in your way. We’ll explore whether RoleClue could help.</p>
        <ol className="mt-9 space-y-5 text-base">
          <li className="flex gap-3"><CalendarDays className="mt-1 size-5 shrink-0" />Choose an available date and time.</li>
          <li className="flex gap-3"><Mail className="mt-1 size-5 shrink-0" />Enter your name and email to receive the invitation.</li>
          <li className="flex gap-3"><ShieldCheck className="mt-1 size-5 shrink-0" />Review the details and confirm your booking.</li>
        </ol>
        <p className="mt-9 max-w-md text-sm leading-6 text-[#526d70]">An introductory product conversation, not migration advice or a promise of employment or sponsorship. Please don’t include identity documents or visa numbers.</p>
        <Link href="/privacy" className="mt-4 inline-block text-sm underline underline-offset-4">How we handle your information</Link>
      </aside>
      <section aria-label="Book your conversation" className="overflow-hidden rounded-[2rem] border border-border bg-[#fffaf1] shadow-sm">
        {schedule ? <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-5">
            <h2 className="font-sans text-xl font-bold">Choose a date and time</h2>
            <a href={schedule.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm underline underline-offset-4">Open booking page<ArrowUpRight size={15} /></a>
          </div>
          {schedule.embedUrl ? <iframe src={schedule.embedUrl} title="RoleClue appointment booking: choose a date and time" className="h-[850px] w-full border-0" referrerPolicy="strict-origin-when-cross-origin" /> : <div className="p-10"><p className="mb-6 leading-7">The booking calendar opens in a new tab. Choose your time, enter your details and confirm there.</p><a className="inline-flex items-center gap-3 rounded-full bg-primary px-6 py-4 font-semibold text-primary-foreground" href={schedule.url} target="_blank" rel="noopener noreferrer">Choose a time<ArrowUpRight size={18} /></a></div>}
        </> : <div className="flex min-h-[480px] flex-col items-start justify-center p-8 lg:p-12">
          <CalendarDays className="mb-6 size-10 text-[#236451]" />
          <h2 className="text-3xl font-bold">Online booking is being connected.</h2>
          <p className="mt-5 max-w-md leading-7 text-[#526d70]">Available dates will appear here once the calendar is ready. For now, email us to arrange a conversation.</p>
          {email && <a href={`mailto:${email}?subject=RoleClue%20conversation`} className="mt-7 inline-flex items-center gap-3 rounded-full bg-primary px-6 py-4 font-semibold text-primary-foreground">Email {email}<ArrowUpRight size={18} /></a>}
          <p className="mt-5 text-sm text-[#526d70]">An email enquiry does not reserve a time.</p>
        </div>}
      </section>
    </div>
  </main>;
}
