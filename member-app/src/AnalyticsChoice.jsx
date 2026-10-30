import React, { useEffect, useState } from 'react';
import { analytics, observeAnalytics } from './analytics.js';

export default function AnalyticsChoice() {
  const [state, setState] = useState(analytics.state);
  const [open, setOpen] = useState(false);
  useEffect(() => observeAnalytics(setState), []);
  const visible = state.available && (!state.choice || open);
  return <aside className="analytics-choice" aria-label="Optional analytics">
    {visible ? <div className="analytics-choice-panel">
      <strong>Help improve RoleClue?</strong>
      <p>Allow optional journey counts to help us see where the app works and where people get stuck. No CV, profile answers or letter text is recorded. <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy notice</a></p>
      <div className="analytics-choice-actions">
        <button type="button" className="button secondary" onClick={() => { void analytics.choose('decline'); setOpen(false); }}>Decline analytics</button>
        <button type="button" className="button secondary" onClick={() => { void analytics.choose('allow'); setOpen(false); }}>Allow analytics</button>
        {state.choice && <button type="button" className="text-link" onClick={() => setOpen(false)}>Close</button>}
      </div>
    </div> : <button type="button" className="analytics-choice-open" onClick={() => setOpen(true)}>Analytics choices</button>}
    {state.error && <p role="status">{state.error}</p>}
    {state.pending && <p className="analytics-withdrawal" role="status">Analytics is off. Withdrawal is waiting for a connection. <button type="button" onClick={() => void analytics.retryWithdrawal()}>Retry</button></p>}
  </aside>;
}
