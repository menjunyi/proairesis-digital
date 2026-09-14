'use client';
/* oxlint-disable next/no-html-link-for-pages -- Also bundled as a standalone client on the static AWS site. */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
const key = 'roleclue-campaign-consent';
const identityKey = 'roleclue-campaign-browser';
export function CampaignTracker() {
  const [visible, setVisible] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
    if (!['/', '/book', '/cookies'].includes(window.location.pathname)) return;
    const campaign = new URLSearchParams(location.search).get('rc_campaign');
    try {
      const saved = localStorage.getItem(key);
      setChoice(saved);
      setVisible(Boolean(campaign && !saved));
      if (saved === 'accepted' && campaign) sendVisit(campaign);
    } catch { setStorageError(true); }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  function choose(value: string) {
    try {
      localStorage.setItem(key, value);
      if (value !== 'accepted') localStorage.removeItem(identityKey);
      setChoice(value); setVisible(false);
      const campaign = new URLSearchParams(location.search).get('rc_campaign');
      if (value === 'accepted' && campaign) sendVisit(campaign);
    } catch { setStorageError(true); setVisible(false); }
  }
  if (storageError) return null;
  if (!visible) return choice ? <button className="fixed bottom-3 left-3 z-40 rounded border bg-white px-3 py-2 text-sm text-slate-700 shadow" onClick={() => setVisible(true)}>Cookie choices</button> : null;
  return <aside aria-label="Cookie choices" className="fixed bottom-4 left-4 right-4 z-50 max-w-lg rounded-2xl border bg-white p-5 text-slate-900 shadow-xl">
    <p className="font-semibold">Cookies</p>
    <p className="my-3 text-sm leading-6">We use cookies to improve your browsing experience. <a className="underline" href="/cookies">Cookie Policy</a></p>
    <div className="flex gap-3"><Button variant="outline" onClick={() => choose('rejected')}>No thanks</Button><Button onClick={() => choose('accepted')}>Allow cookies</Button></div>
  </aside>;
}
function sendVisit(campaign: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(campaign) || new URLSearchParams(location.search).get('rc_test') === '1') return;
  try {
    const now = Date.now();
    let identity: {id: string; expires: number} | null = null;
    try { identity = JSON.parse(localStorage.getItem(identityKey) || 'null'); } catch { /* Replace invalid storage. */ }
    if (!identity || typeof identity.id !== 'string' || !(identity.expires > now)) {
      identity = {id: crypto.randomUUID(), expires: now + 30 * 86400000};
      localStorage.setItem(identityKey, JSON.stringify(identity));
    }
    const eventKey = `roleclue-campaign-event:${campaign}`;
    let event: {id: string; at: number} | null = null;
    try { event = JSON.parse(sessionStorage.getItem(eventKey) || 'null'); } catch { /* Replace invalid storage. */ }
    if (!event || !(event.at > now - 1800000)) event = {id: crypto.randomUUID(), at: now};
    sessionStorage.setItem(eventKey, JSON.stringify(event));
    void fetch('/api/campaigns/visit', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({consent: true, campaign, visitor: identity.id, event: event.id}), keepalive: true}).catch(() => {});
  } catch { /* Storage and analytics are optional. */ }
}
