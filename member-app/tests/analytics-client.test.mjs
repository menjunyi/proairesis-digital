import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAnalytics } from '../src/analytics.js';
const memory = () => { const map = new Map(); return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }; };
function fixture(options = {}) {
  const calls = [], replacements = [];
  const { storage = memory(), sessionStorage = memory(),
    location = { search: '?rc_campaign=launch-test&rc_test=1', pathname: '/', hash: '' },
    history = { state: null, replaceState(_state, _title, url) { replacements.push(url); } },
    fetcher: suppliedFetcher, ...analyticsOptions } = options;
  let time = Date.parse('2026-10-30T01:00:00Z'), failure = false;
  const analytics = createAnalytics({ storage, sessionStorage, crypto: { randomUUID }, now: () => time,
    location, history,
    fetcher: suppliedFetcher || (async (url, init) => { const body = JSON.parse(init.body); calls.push({ url, body }); if (failure) throw Error('Offline'); return { ok: true, json: async () => url.endsWith('/session') ? { token: `signed-${calls.length}`, expiresAt: new Date(time + 1800000).toISOString() } : { accepted: 1 } }; }), ...analyticsOptions });
  return { analytics, calls, replacements, storage, sessionStorage, advance: ms => { time += ms; }, offline: value => { failure = value; } };
}
test('first-party analytics starts by default and records the current visit and future events', async () => {
  const f = fixture(); f.analytics.configure({ mode: 'production' });
  await f.analytics.track('profile_confirmed');
  assert.equal(f.analytics.state().choice, 'allow'); assert.equal(f.calls[0].body.enabled, true); assert.equal(f.calls[0].body.consent, undefined);
  assert.equal(f.calls[0].body.test, true); assert.equal(f.calls[0].body.campaign, 'launch-test');
  assert.deepEqual(f.calls.filter(c => c.url.endsWith('/events')).flatMap(c => c.body.events.map(e => e.kind)), ['app_visit', 'profile_confirmed']);
  assert.ok(f.analytics.headers()['X-RoleClue-Analytics']);
});
test('a stored decline remains off and creates no identifier, session, header, or event', async () => {
  const storage = memory(); storage.setItem('roleclue.analytics.choice.v1', JSON.stringify('decline'));
  const f = fixture({ storage }); f.analytics.configure({ mode: 'production' }); await f.analytics.track('role_selected');
  assert.equal(f.analytics.state().choice, 'decline'); assert.equal(f.calls.length, 0); assert.deepEqual(f.analytics.headers(), {});
  assert.equal(storage.getItem('roleclue.analytics.visitor.v1'), null); assert.equal(f.sessionStorage.getItem('roleclue.analytics.session.v1'), null);
});
test('decline revokes, clears IDs, stops headers/events, and retries offline withdrawal', async () => {
  const f = fixture(); f.analytics.configure({ mode: 'production' }); await f.analytics.track('onboarding_started');
  f.offline(true); await f.analytics.choose('decline');
  assert.equal(f.analytics.state().pending, true); assert.deepEqual(f.analytics.headers(), {});
  assert.equal(f.storage.getItem('roleclue.analytics.visitor.v1'), null); assert.equal(f.sessionStorage.getItem('roleclue.analytics.session.v1'), null);
  const count = f.calls.length; await f.analytics.track('role_selected'); assert.equal(f.calls.length, count);
  f.offline(false); await f.analytics.retryWithdrawal(); assert.equal(f.analytics.state().pending, false);
});
test('fixed sessions expire; product headers never wait for measurement and expired contexts are not reused', async () => {
  const f = fixture(); f.analytics.configure({ mode: 'production' }); await f.analytics.track('onboarding_started');
  const first = f.analytics.headers()['X-RoleClue-Analytics']; f.advance(1800001); assert.deepEqual(f.analytics.headers(), {});
  await f.analytics.track('role_selected'); assert.notEqual(f.analytics.headers()['X-RoleClue-Analytics'], first);
  assert.equal(f.calls.filter(c => c.url.endsWith('/session')).length, 2);
});
test('storage failure disables measurement instead of breaking normal app use', async () => {
  const bad = { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); }, removeItem() {} };
  const f = fixture({ storage: bad }); f.analytics.configure({}); await f.analytics.track('role_selected');
  assert.deepEqual(f.analytics.headers(), {}); assert.equal(f.calls.length, 0);
});
test('withdrawal also revokes earlier sessions with delayed outcomes', async () => {
  const f = fixture(); f.analytics.configure({ mode: 'production' }); await f.analytics.track('onboarding_started');
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
  const f = fixture({ storage: guarded }); f.analytics.configure({ mode: 'production' }); await f.analytics.track('onboarding_started');
  blocked = true; f.offline(true); await f.analytics.choose('decline');
  assert.equal(f.analytics.state().pending, true); assert.deepEqual(f.analytics.headers(), {});
  f.offline(false); await f.analytics.retryWithdrawal(); assert.equal(f.analytics.state().pending, false);
});
test('withdrawal during initial visit delivery cannot restore the revoked session', async () => {
  let finishVisit, entered, finished;
  const visitEntered = new Promise(resolve => { entered = resolve; });
  const visitFinished = new Promise(resolve => { finished = resolve; });
  const f = fixture({ fetcher: async (url) => {
    if (url.endsWith('/session')) return {ok:true,json:async()=>({token:'in-flight-token',expiresAt:'2026-10-30T02:00:00Z'})};
    if (url.endsWith('/events')) { entered(); await new Promise(resolve => { finishVisit = resolve; }); finished(); }
    return {ok:true,json:async()=>({accepted:1})};
  } });
  f.analytics.configure({}); await visitEntered;
  await f.analytics.choose('decline'); finishVisit(); await visitFinished;
  assert.equal(f.sessionStorage.getItem('roleclue.analytics.session.v1'), null);
  assert.deepEqual(f.analytics.headers(), {});
});
test('the privacy opt-out URL revokes saved contexts, persists decline, and removes control parameters', async () => {
  const storage = memory(), sessionStorage = memory(), active = 'signed-active', prior = 'signed-prior';
  storage.setItem('roleclue.analytics.choice.v1', JSON.stringify('allow'));
  storage.setItem('roleclue.analytics.visitor.v1', JSON.stringify({ id: randomUUID(), expiresAt: Date.parse('2026-11-01T01:00:00Z') }));
  storage.setItem('roleclue.analytics.contexts.v1', JSON.stringify([{ token: prior, until: Date.parse('2027-01-01T00:00:00Z') }]));
  sessionStorage.setItem('roleclue.analytics.session.v1', JSON.stringify({ token: active, campaign: 'launch-test', test: true, expiresAt: '2026-10-30T02:00:00Z' }));
  const f = fixture({ storage, sessionStorage, location: { search: '?rc_analytics=off&rc_campaign=launch-test&rc_test=1&utm_source=privacy&keep=1', pathname: '/', hash: '#privacy' } });
  assert.equal(f.analytics.state().choice, 'decline'); assert.equal(storage.getItem('roleclue.analytics.choice.v1'), JSON.stringify('decline'));
  assert.equal(storage.getItem('roleclue.analytics.visitor.v1'), null); assert.equal(storage.getItem('roleclue.analytics.contexts.v1'), null); assert.equal(sessionStorage.getItem('roleclue.analytics.session.v1'), null);
  assert.equal(f.calls.length, 0); assert.equal(f.replacements.at(-1), '/?rc_campaign=launch-test&rc_test=1&utm_source=privacy&keep=1#privacy');
  f.analytics.configure({ mode: 'production' }); await new Promise(resolve => setImmediate(resolve)); await f.analytics.retryWithdrawal();
  assert.deepEqual(new Set(f.calls.filter(c => c.url.endsWith('/revoke')).map(c => c.body.token)), new Set([active, prior]));
  assert.equal(f.calls.some(c => c.url.endsWith('/session')), false); assert.deepEqual(f.analytics.headers(), {});
  assert.equal(f.replacements.at(-1), '/?keep=1#privacy');
});
test('an inbound enable query cannot override a stored decline', async () => {
  const storage = memory(); storage.setItem('roleclue.analytics.choice.v1', JSON.stringify('decline'));
  const f = fixture({ storage, location: { search: '?rc_analytics=on&keep=1', pathname: '/', hash: '' } });
  assert.equal(f.analytics.state().choice, 'decline'); assert.equal(storage.getItem('roleclue.analytics.choice.v1'), JSON.stringify('decline'));
  assert.equal(f.replacements.at(-1), '/?keep=1');
  f.analytics.configure({ mode: 'production' }); await f.analytics.track('role_selected');
  assert.equal(f.calls.length, 0); assert.deepEqual(f.analytics.headers(), {});
});
