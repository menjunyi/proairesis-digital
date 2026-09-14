'use client';
// Also bundled standalone without Next routing.
/* eslint-disable next/no-html-link-for-pages */

import { useState } from 'react';
import { Mail, ArrowUpRight } from 'lucide-react';

export function OpinionForm() {
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    const field = (name: string) => { const value = form.get(name); return typeof value === 'string' ? value.trim() : ''; };
    setSending(true); setFailed(false); setStatus('');
    try {
      const response = await fetch('/api/booking/message', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:field('name'),email:field('email'),message:field('message'),website:field('website'),requestId:crypto.randomUUID()})});
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== 'object' || !('sent' in result) || result.sent !== true) throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'Unable to send. Please try again later.');
      setStatus('testMode' in result && result.testMode === true ? 'Test message accepted. No email was sent.' : 'Thanks! Your message has been sent.');
      element.reset();
    } catch (error) { setFailed(true); setStatus(error instanceof Error ? error.message : 'Unable to send. Please try again later.'); }
    finally { setSending(false); }
  }
  return <section className="opinion-section" id="share-your-thoughts" aria-labelledby="opinion-heading">
    <div className="opinion-intro"><p className="booking-kicker">PREFER TO WRITE?</p><h2 id="opinion-heading">What would make your<br/>job search easier?</h2><p>Share an idea, a missing filter or something that gets in your way. No meeting needed.</p><a href="mailto:hello@proairesis.digital"><Mail size={17} />hello@proairesis.digital</a></div>
    <form className="opinion-form" onSubmit={submit} aria-busy={sending}>
      <div hidden><label>Website<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
      <div className="opinion-fields"><label><span className="opinion-field-label">Your name <small>(optional)</small></span><input name="name" autoComplete="name" maxLength={100}/></label><label>Your email<input name="email" type="email" autoComplete="email" required maxLength={254}/></label></div>
      <label>Your thoughts<textarea name="message" rows={5} required minLength={10} maxLength={3000} placeholder="Which filters would help? What takes too much time in your job search?"/></label>
      <p className="booking-small">We’ll use your details to read and reply to your message. <a href="/privacy">Privacy policy</a></p>
      <p className="booking-small">Your message goes directly to hello@proairesis.digital.</p>
      <button className="booking-primary" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send message'} <ArrowUpRight size={17}/></button>
      {status && <output className={failed ? 'booking-error' : 'booking-small'}>{status}</output>}
    </form>
  </section>;
}
