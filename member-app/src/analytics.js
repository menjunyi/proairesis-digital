const CHOICE = 'roleclue.analytics.choice.v1';
const VISITOR = 'roleclue.analytics.visitor.v1';
const SESSION = 'roleclue.analytics.session.v1';
const HISTORY = 'roleclue.analytics.contexts.v1';
const REVOKE = 'roleclue.analytics.revoke.v1';
const DAYS30 = 30 * 86400000;

export function createAnalytics({ storage, sessionStorage, fetcher, crypto, now = Date.now, location, history, notify = () => {} }) {
  let config, choice = preference(read(storage, CHOICE)), current = null, serial = Promise.resolve(), epoch = 0;
  const pendingMemory = new Set();
  const issuedMemory = new Set();
  const observed = new Set();
  const query = new URLSearchParams(location.search);
  const control = query.get('rc_analytics');
  const cachedAtStart = read(sessionStorage, SESSION);
  const candidate = query.get('rc_campaign') || (Date.parse(cachedAtStart?.expiresAt) > now() ? cachedAtStart.campaign : null);
  const campaign = /^[a-z0-9][a-z0-9-]{2,59}$/.test(candidate || '') ? candidate : 'direct';
  const test = query.get('rc_test') === '1' || (!query.has('rc_campaign') && cachedAtStart?.test === true);
  function read(store, key) { try { return JSON.parse(store.getItem(key)); } catch { return null; } }
  function preference(value) { return value === 'decline' ? 'decline' : 'allow'; }
  function write(store, key, value) { store.setItem(key, JSON.stringify(value)); }
  function clear(store, key) { try { store.removeItem(key); } catch { /* Optional storage. */ } }
  function replaceUrl() {
    try { history.replaceState(history.state, '', `${location.pathname}${query.size ? `?${query}` : ''}${location.hash}`); } catch { /* Optional URL cleanup must not prevent app startup. */ }
  }
  function state() { return { choice, pending: pendingMemory.size > 0 || Boolean(read(storage, REVOKE)), available: Boolean(config) }; }
  async function post(path, body) {
    const response = await fetcher(`${(config?.apiBaseUrl || '').replace(/\/$/, '')}/api/analytics/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000), credentials: 'omit',
    });
    if (!response.ok) throw Error('Measurement unavailable');
    return response.json();
  }
  function pendingToken(token) {
    if (!token) return;
    pendingMemory.add(token);
    const old = read(storage, REVOKE) || [];
    const tokens = Array.isArray(old) ? old : [old];
    if (!tokens.includes(token)) write(storage, REVOKE, [...tokens, token]);
  }
  async function retryWithdrawal() {
    const persisted = read(storage, REVOKE) || [];
    const pending = [...new Set([...pendingMemory, ...(Array.isArray(persisted) ? persisted : [persisted])])];
    if (!pending.length || !config) return;
    try {
      const tokens = Array.isArray(pending) ? pending : [pending];
      for (const token of tokens) { await post('revoke', { token }); pendingMemory.delete(token); }
      // Keep withdrawals added by another tab while this request was in flight.
      const latest = read(storage, REVOKE) || [];
      const remaining = (Array.isArray(latest) ? latest : [latest]).filter(token => !tokens.includes(token));
      if (remaining.length) write(storage, REVOKE, remaining); else clear(storage, REVOKE);
      notify(state());
    } catch { notify(state()); }
  }
  async function ensureVisit(active) {
    if (active.visitRecorded) return active;
    const version = epoch;
    active.visitId ||= crypto.randomUUID();
    await post('events', { token: active.token, events: [{ id: active.visitId, kind: 'app_visit' }] });
    if (version !== epoch || choice !== 'allow' || pendingMemory.size || read(storage, REVOKE)) return null;
    active.visitRecorded = true;
    try { write(sessionStorage, SESSION, active); } catch {}
    return active;
  }
  async function session() {
    if (choice !== 'allow' || !config || pendingMemory.size || read(storage, REVOKE)) return null;
    if (current && Date.parse(current.expiresAt) > now() + 1000) return ensureVisit(current);
    const version = epoch;
    let visitor = read(storage, VISITOR);
    if (!visitor?.id || visitor.expiresAt <= now()) {
      visitor = { id: crypto.randomUUID(), expiresAt: now() + DAYS30 };
      write(storage, VISITOR, visitor);
    }
    const cached = read(sessionStorage, SESSION);
    if (cached?.token && cached.campaign === campaign && cached.test === test && Date.parse(cached.expiresAt) > now() + 1000) {
      issuedMemory.add(cached.token);
      current = cached;
      return ensureVisit(current);
    }
    const result = await post('session', { enabled: true, campaign, visitor: visitor.id, session: crypto.randomUUID(), test: test || config.mode === 'demo' });
    issuedMemory.add(result.token);
    if (version !== epoch || choice !== 'allow') {
      // A withdrawal during issuance must revoke the newly issued context too.
      try { pendingToken(result.token); } catch {}
      await retryWithdrawal();
      return null;
    }
    const contexts = (read(storage, HISTORY) || []).filter(item => item.until > now());
    if (contexts.length >= 4320) { pendingToken(result.token); await retryWithdrawal(); return null; }
    try {
      write(storage, HISTORY, [...contexts, { token: result.token, until: now() + 90 * 86400000 }]);
      current = { ...result, campaign, test };
      write(sessionStorage, SESSION, current);
    } catch {
      current = null;
      try { pendingToken(result.token); } catch {}
      await retryWithdrawal();
      notify({ ...state(), error: 'Analytics could not save a session and is off.' });
      return null;
    }
    return ensureVisit(current);
  }
  function enqueue(work) {
    serial = serial.then(work, work).catch(() => null);
    return serial;
  }
  function track(kind, detail = {}) {
    // Do not retain actions while analytics is disabled for later backfill.
    if (choice !== 'allow') return Promise.resolve(null);
    const version = epoch;
    return enqueue(async () => {
      const active = await session();
      if (!active || version !== epoch || choice !== 'allow') return;
      const seenKey = `${active.token}:${kind}:${detail.step || ''}`;
      if (observed.has(seenKey)) return;
      await post('events', { token: active.token, events: [{ id: crypto.randomUUID(), kind, ...detail }] });
      observed.add(seenKey);
    });
  }
  function headers() {
    return choice === 'allow' && current && Date.parse(current.expiresAt) > now() && !pendingMemory.size && !read(storage, REVOKE)
      ? { 'X-RoleClue-Analytics': current.token } : {};
  }
  async function choose(value) {
    if (!['allow', 'decline'].includes(value)) return;
    epoch++;
    const old = current || read(sessionStorage, SESSION);
    const allTokens = [...issuedMemory, ...(read(storage, HISTORY) || []).map(item => item.token), ...(old?.token ? [old.token] : [])];
    choice = value;
    try {
      write(storage, CHOICE, value);
      if (value === 'decline') {
        for (const token of allTokens) pendingToken(token);
        clear(storage, HISTORY);
        current = null;
        clear(storage, VISITOR);
        clear(sessionStorage, SESSION);
      }
    } catch {
      choice = 'decline';
      current = null;
      clear(storage, VISITOR);
      clear(sessionStorage, SESSION);
      for (const token of allTokens) { try { pendingToken(token); } catch {} }
      await retryWithdrawal();
      notify({ ...state(), error: 'Your browser could not save this choice. Analytics is off.' });
      return;
    }
    notify(state());
    await retryWithdrawal();
    if (value === 'allow') await enqueue(session);
  }
  function externalChoice() {
    const old = current || read(sessionStorage, SESSION);
    choice = preference(read(storage, CHOICE));
    epoch++;
    current = null;
    if (choice !== 'allow') { try { pendingToken(old?.token); } catch {} void retryWithdrawal(); }
    if (choice !== 'allow') clear(sessionStorage, SESSION);
    notify(state());
    if (choice === 'allow') void enqueue(session);
  }
  function configure(value) {
    config = value;
    if (query.has('rc_campaign') || query.has('rc_test')) {
      for (const key of ['rc_campaign', 'rc_test', 'utm_source', 'utm_medium', 'utm_campaign']) query.delete(key);
      replaceUrl();
    }
    notify(state());
    void retryWithdrawal();
    if (choice === 'allow') void enqueue(session);
  }
  if (query.has('rc_analytics')) {
    query.delete('rc_analytics');
    replaceUrl();
  }
  if (control === 'off') void choose('decline');
  return { state, track, headers, choose, configure, retryWithdrawal, externalChoice };
}

function browserStorage(name) {
  try { return window[name]; } catch { return { getItem: () => null, removeItem: () => {}, setItem: () => { throw Error('Storage unavailable'); } }; }
}
export const analytics = typeof window === 'undefined' ? null : createAnalytics({
  storage: browserStorage('localStorage'), sessionStorage: browserStorage('sessionStorage'),
  fetcher: window.fetch.bind(window), crypto: window.crypto, location: window.location,
  history: window.history,
});
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if ([CHOICE, REVOKE].includes(event.key)) analytics.externalChoice();
  });
  window.addEventListener('online', () => void analytics.retryWithdrawal());
}
export const track = (kind, detail) => analytics?.track(kind, detail);
