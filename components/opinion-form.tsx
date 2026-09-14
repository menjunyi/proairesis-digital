'use client';
// Also bundled standalone without Next routing.
/* eslint-disable next/no-html-link-for-pages */

import { useState } from 'react';
import { Mail, ArrowUpRight } from 'lucide-react';

export function OpinionForm() {
  const [status, setStatus] = useState('');
  function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => { const value = form.get(name); return typeof value === 'string' ? value.trim() : ''; };
    const body = `Name: ${field('name')}\nReply email: ${field('email')}\n\n${field('message')}`;
    window.location.href = `mailto:hello@proairesis.digital?subject=${encodeURIComponent('An idea for RoleClue')}&body=${encodeURIComponent(body)}`;
    setStatus('Finish sending in your email app. If it didn’t open, copy your message and email hello@proairesis.digital.');
  }
  return <section className="opinion-section" id="share-your-thoughts" aria-labelledby="opinion-heading">
    <div className="opinion-intro"><p className="booking-kicker">PREFER TO WRITE?</p><h2 id="opinion-heading">What would make your<br/>job search easier?</h2><p>Share an idea, a missing filter or something that gets in your way. No meeting needed.</p><a href="mailto:hello@proairesis.digital"><Mail size={17} />hello@proairesis.digital</a></div>
    <form className="opinion-form" onSubmit={submit}>
      <div className="opinion-fields"><label><span className="opinion-field-label">Your name <small>(optional)</small></span><input name="name" autoComplete="name" maxLength={100}/></label><label>Your email<input name="email" type="email" autoComplete="email" required maxLength={254}/></label></div>
      <label>Your thoughts<textarea name="message" rows={5} required minLength={10} maxLength={3000} placeholder="Which filters would help? What takes too much time in your job search?"/></label>
      <p className="booking-small">We’ll use your details to read and reply to your message. <a href="/privacy">Privacy policy</a></p>
      <p className="booking-small">Opens your email app with your message filled in. You review and send it there.</p>
      <button className="booking-primary" type="submit">Open email app <ArrowUpRight size={17}/></button>
      {status && <output className="booking-small">{status}</output>}
    </form>
  </section>;
}
