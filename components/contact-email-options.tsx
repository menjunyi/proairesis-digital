'use client';
/* eslint-disable jsx-a11y/prefer-tag-over-role -- status container includes interactive controls */

import { useState } from 'react';
import { ArrowUpRight, Copy } from 'lucide-react';

export function ContactEmailOptions({ email }: { email: string }) {
  const [message, setMessage] = useState('');
  const subject = 'RoleClue conversation';
  const body = 'Hi,\n\nI would like to talk about my job search.\n\nTarget roles:\nPreferred dates and times:\nMy time zone:\n\nThank you.';
  const mailto = `mailto:${email}?${new URLSearchParams({ subject, body }).toString()}`;
  const gmail = `https://mail.google.com/mail/?${new URLSearchParams({ view: 'cm', fs: '1', to: email, su: subject, body }).toString()}`;

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(email);
      setMessage('Email address copied. Paste it into a new message in your email service.');
    } catch {
      setMessage('Copy is unavailable in this browser. Select and copy the email address below.');
    }
  }

  return <div className="mt-7 w-full">
    <a href={gmail} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-3 rounded-full bg-primary px-6 py-4 font-semibold text-primary-foreground">Write in Gmail<ArrowUpRight size={18} /></a>
    <div className="mt-4 flex flex-wrap items-center gap-5">
      <a href={mailto} onClick={() => setMessage('Your device may open your email app. If nothing happens, use Gmail or copy the address below. No email has been sent by this website.')} className="text-sm underline underline-offset-4">Open my email app</a>
      <button type="button" onClick={copyAddress} className="inline-flex items-center gap-2 text-sm underline underline-offset-4"><Copy size={15} />Copy email address</button>
    </div>
    <p className="mt-5 select-all break-all font-medium">{email}</p>
    <p role="status" aria-live="polite" className="mt-3 text-sm leading-6 text-[#526d70]">{message || 'Gmail opens a draft in a new tab. Review it and press Send there. You can also use any email service with the address above.'}</p>
  </div>;
}
