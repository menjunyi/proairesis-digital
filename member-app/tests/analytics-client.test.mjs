import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAnalytics } from '../src/analytics.js';
const memory = () => { const map = new Map(); return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }; };
function fixture(options = {}) {
  const calls = [], storage = memory(), sessionStorage = memory();
  let time = Date.parse('2026-10-30T01:00:00Z'), failure = false;
  const analytics = createAnalytics({ storage, sessionStorage, crypto: { randomUUID }, now: () => time,
    location: { search: '?rc_campaign=launch-test&rc_test=1', pathname: '/', hash: '' }, history: { replaceState() {} },
    fetcher: async (url, init) => { const body = JSON.parse(init.body); calls.push({ url, body }); if (failure) throw Error('Offline'); return { ok: true, json: async () => url.endsWith('/session') ? { token: `signed-${calls.length}`, expiresAt: new Date(time + 1800000).toISOString() } : { accepted: 1 } }; }, ...options });
  return { analytics, calls, storage, sessionStorage, advance: ms => { time += ms; }, offline: value => { failure = value; } };
}
test('no identities or events before consent; acceptance records only current visit and future events', async () => {
  const f = fixture(); f.analytics.configure({ mode: 'production' });
  await f.analytics.track('role_selected'); assert.equal(f.calls.length, 0); assert.deepEqual(f.analytics.headers(), {});
  await f.analytics.choose('allow');
  assert.equal(f.calls[0].body.test, true); assert.equal(f.calls[0].body.campaign, 'launch-test');
  assert.deepEqual(f.calls.filter(c => c.url.endsWith('/events')).flatMap(c => c.body.events.map(e => e.kind)), ['app_visit']);
  await f.analytics.track('profile_confirmed'); assert.equal(f.calls.at(-1).body.events[0].kind, 'profile_confirmed');
});
test('decline revokes, clears IDs, stops headers/events, and retries offline withdrawal', async () => {
  const f = fixture(); f.analytics.configure({ mode: 'production' }); await f.analytics.choose('allow');
  f.offline(true); await f.analytics.choose('decline');
  assert.equal(f.analytics.state().pending, true); assert.deepEqual(f.analytics.headers(), {});
  assert.equal(f.storage.getItem('roleclue.analytics.visitor.v1'), null); assert.equal(f.sessionStorage.getItem('roleclue.analytics.session.v1'), null);
  const count = f.calls.length; await f.analytics.track('role_selected'); assert.equal(f.calls.length, count);
  f.offline(false); await f.analytics.retryWithdrawal(); assert.equal(f.analytics.state().pending, false);
});
test('fixed sessions expire; product headers never wait for measurement and expired contexts are not reused', async () => {
  const f = fixture(); f.analytics.configure({ mode: 'production' }); await f.analytics.choose('allow');
  const first = f.analytics.headers()['X-RoleClue-Analytics']; f.advance(1800001); assert.deepEqual(f.analytics.headers(), {});
  await f.analytics.track('role_selected'); assert.notEqual(f.analytics.headers()['X-RoleClue-Analytics'], first);
  assert.equal(f.calls.filter(c => c.url.endsWith('/session')).length, 2);
});
test('storage failure disables measurement instead of breaking normal app use', async () => {
  const bad = { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); }, removeItem() {} };
  const f = fixture({ storage: bad }); f.analytics.configure({}); await f.analytics.choose('allow');
  assert.equal(f.analytics.state().choice, null); assert.deepEqual(f.analytics.headers(), {}); assert.equal(f.calls.length, 0);
});
test('withdrawal also revokes earlier sessions with delayed outcomes', async () => {
  const f = fixture(); f.analytics.configure({ mode: 'production' }); await f.analytics.choose('allow');
  const first = f.analytics.headers()['X-RoleClue-Analytics']; f.advance(1800001);
  await f.analytics.track('checkout_started'); const second = f.analytics.headers()['X-RoleClue-Analytics'];
  await f.analytics.choose('decline');
  const revoked = f.calls.filter(c => c.url.endsWith('/revoke')).map(c => c.body.token);
  assert.ok(revoked.includes(first)); assert.ok(revoked.includes(second));
});
test('a test link cannot reuse a cached normal session', async () => {
  const storage = memory(), sessionStorage = memory(); storage.setItem('roleclue.analytics.choice.v1', JSON.stringify('allow'));
  sessionStorage.setItem('roleclue.analytics.session.v1', JSON.stringify({ token: 'real-token', campaign: 'launch-test', test: false, expiresAt: '2026-10-30T02:00:00Z' }));
  const f = fixture({ storage, sessionStorage }); f.analytics.configure({ mode: 'production' });
  await f.analytics.track('role_selected');
  assert.equal(f.calls[0].body.test, true); assert.notEqual(f.analytics.headers()['X-RoleClue-Analytics'], 'real-token');
});
test('offline withdrawal remains pending when storage becomes unwritable and retries in memory', async () => {
  const storage = memory(); let blocked = false;
  const guarded = { ...storage, setItem(key, value) { if (blocked) throw Error('Quota'); storage.setItem(key, value); } };
  const f = fixture({ storage: guarded }); f.analytics.configure({ mode: 'production' }); await f.analytics.choose('allow');
  blocked = true; f.offline(true); await f.analytics.choose('decline');
  assert.equal(f.analytics.state().pending, true); assert.deepEqual(f.analytics.headers(), {});
  f.offline(false); await f.analytics.retryWithdrawal(); assert.equal(f.analytics.state().pending, false);
});
test('withdrawal during initial visit delivery cannot restore the revoked session', async () => {
  let finishVisit, entered;
  const visitEntered = new Promise(resolve => { entered = resolve; });
  const f = fixture({ fetcher: async (url) => {
    if (url.endsWith('/session')) return {ok:true,json:async()=>({token:'in-flight-token',expiresAt:'2026-10-30T02:00:00Z'})};
    if (url.endsWith('/events')) { entered(); await new Promise(resolve => { finishVisit = resolve; }); }
    return {ok:true,json:async()=>({accepted:1})};
  } });
  f.analytics.configure({}); const accepting = f.analytics.choose('allow'); await visitEntered;
  await f.analytics.choose('decline'); finishVisit(); await accepting;
  assert.equal(f.sessionStorage.getItem('roleclue.analytics.session.v1'), null);
  assert.deepEqual(f.analytics.headers(), {});
});
