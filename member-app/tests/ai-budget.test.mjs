import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,change} from '../server/store.mjs';
import {AI_MODEL,AI_PRICING_VERSION,AI_PRICING_EXPIRES_AT,ONE_TIME_KAIPAI_EXCEPTION,ONE_TIME_KAIPAI_SERUM_EXCEPTION,oneTimeExceptionForRequest,aiCostMicros,createAiBudget,sydneyBudgetDay} from '../server/ai-budget.mjs';
import {createProvider} from '../server/adapters.mjs';

const date = new Date('2026-10-12T03:00:00Z');
const namespace = 'SYSTEM#EXTERNAL_AI';
const request = (id = 'synthetic-request-0001', extra = {}) => ({
  requestId: id, inputTokenUpperBound: 1000, maxOutputTokens: 100, callLimit: 100, tokenLimit: 1_000_000, ...extra,
});
async function approve(store, {day = sydneyBudgetDay(date), micros = 1_000_000, pk = namespace, ...extra} = {}) {
  const sk = `ENVELOPE#${day}`, old = await store.get(pk, sk);
  await store.transact([change(pk, sk, old, {
    day, currency: 'USD', approvedMicros: micros, approvalReference: 'synthetic-local-allocation',
    approvedAt: date.toISOString(), pricingVersion: AI_PRICING_VERSION, ...extra,
  })]);
}
async function fixture(options = {}) {
  const store = new MemoryStore();
  await approve(store, options);
  const budget = createAiBudget({store, now: () => date});
  return {store, budget};
}
const ledger = (store, day = sydneyBudgetDay(date), pk = namespace) => store.get(pk, `DAY#${day}`).then(row => row?.value);

test('prices uncached input/output in micro-USD with a rounded-up 10% margin', () => {
  assert.equal(aiCostMicros(1000, 100), 616);
  assert.equal(aiCostMicros(1, 0), 1);
  assert.equal(aiCostMicros(0, 1), 2);
  assert.throws(() => aiCostMicros(-1, 1), /bounded/);
  assert.throws(() => aiCostMicros(1.5, 1), /bounded/);
});

test('Sydney budget days use local midnight and daylight saving', () => {
  assert.equal(sydneyBudgetDay(new Date('2026-10-11T12:59:59Z')), '2026-10-11');
  assert.equal(sydneyBudgetDay(new Date('2026-10-11T13:00:00Z')), '2026-10-12');
  assert.equal(sydneyBudgetDay(new Date('2026-07-11T13:59:59Z')), '2026-07-11');
  assert.equal(sydneyBudgetDay(new Date('2026-07-11T14:00:00Z')), '2026-07-12');
});

test('missing, excessive, unpriced or unaudited envelopes fail closed', async () => {
  for (const invalid of [null, {micros: 5_000_001}, {approvalReference: ''}, {pricingVersion: 'old'}, {currency: 'AUD'}]) {
    const store = new MemoryStore();
    if (invalid) await approve(store, invalid);
    const budget = createAiBudget({store, now: () => date});
    assert.equal((await budget.status()).enabled, false);
    await assert.rejects(budget.reserve(request()), error => error.code === 'AI_BUDGET_UNAPPROVED');
    assert.equal(await ledger(store), undefined);
  }
});

test('legacy token-only accounting cannot silently become a zero-cost ledger', async () => {
  const {store,budget} = await fixture();
  await store.transact([change(namespace, `DAY#${sydneyBudgetDay(date)}`, null, {calls: 1, tokens: 1000})]);
  assert.equal((await budget.status()).reason, 'AI_BUDGET_INVALID');
  await assert.rejects(budget.reserve(request()), error => error.code === 'AI_BUDGET_INVALID');
});

test('concurrent instances share one monetary cap and cannot overspend it', async () => {
  const {store,budget} = await fixture({micros: 1232});
  const other = createAiBudget({store, now: () => date});
  const results = await Promise.allSettled(Array.from({length: 8}, (_, i) => (i % 2 ? other : budget).reserve(request(`synthetic-request-${1000 + i}`))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
  assert.equal((await ledger(store)).reservedMicros, 1232);
  assert.equal((await budget.status()).remainingMicros, 0);
});

test('a product-specific daily cap can be lower than the shared approval', async () => {
  const store = new MemoryStore();
  await approve(store, {micros: 5_000_000});
  const budget = createAiBudget({store, now: () => date, maxDailySpendMicros: 1000});
  await budget.reserve(request('synthetic-product-cap-0001'));
  assert.equal((await budget.status()).remainingMicros, 384);
  await assert.rejects(
    budget.reserve(request('synthetic-product-cap-0002')),
    error => error.code === 'AI_BUDGET_EXHAUSTED',
  );
  assert.throws(() => createAiBudget({store, maxDailySpendMicros: 5_000_001}), /local daily AI spend cap/);
});

test('call and token limits remain independent hard ceilings', async () => {
  for (const limits of [{callLimit: 1}, {tokenLimit: 1100}]) {
    const {store,budget} = await fixture();
    await budget.reserve(request('synthetic-request-0001', limits));
    await assert.rejects(budget.reserve(request('synthetic-request-0002', limits)), error => error.code === 'AI_BUDGET_EXHAUSTED');
    assert.equal((await ledger(store)).calls, 1);
  }
});

test('usage reconciliation refunds the excess once and duplicate requests never reserve twice', async () => {
  const {store,budget} = await fixture();
  const reservation = await budget.reserve(request());
  const usage = {inputTokens: 100, outputTokens: 10, providerRequestId: 'resp_synthetic'};
  await Promise.all([budget.reconcile(reservation, usage), budget.reconcile(reservation, usage)]);
  const value = await ledger(store);
  assert.equal(value.reservedMicros, 0);
  assert.equal(value.spentMicros, 62);
  assert.equal(value.tokens, 110);
  await assert.rejects(budget.reserve(request()), error => error.code === 'AI_REQUEST_ALREADY_RESERVED');
  await budget.release(reservation, {reason: 'REQUEST_NOT_SENT'});
  assert.deepEqual(await ledger(store), value);
});

test('known non-billable failures release money/tokens but retain the attempt count', async () => {
  const {store,budget} = await fixture();
  const reservation = await budget.reserve(request());
  await Promise.all([budget.release(reservation, {reason: 'HTTP_400'}), budget.release(reservation, {reason: 'HTTP_400'})]);
  assert.deepEqual(await ledger(store), {version: 1, spentMicros: 0, reservedMicros: 0, calls: 1, tokens: 0, reservedTokens: 0, blocked: false});
});

test('uncertain charges retain their full reservation and block duplicate sends', async () => {
  const {store,budget} = await fixture({micros: 616});
  const reservation = await budget.reserve(request());
  await budget.markUncertain(reservation, {reason: 'TRANSPORT_FAILURE'});
  assert.equal((await ledger(store)).reservedMicros, 616);
  assert.equal((await store.get(namespace, reservation.requestKey)).value.status, 'uncertain');
  await assert.rejects(budget.reserve(request()), error => error.code === 'AI_REQUEST_ALREADY_RESERVED');
  await assert.rejects(budget.reserve(request('synthetic-request-0002')), error => error.code === 'AI_BUDGET_EXHAUSTED');
});

test('midnight does not automatically approve tomorrow or move settlement to a new day', async () => {
  const {store} = await fixture();
  let clock = date;
  const budget = createAiBudget({store, now: () => clock});
  const reservation = await budget.reserve(request());
  clock = new Date('2026-10-12T13:00:00Z');
  assert.equal((await budget.status()).reason, 'AI_BUDGET_UNAPPROVED');
  await assert.rejects(budget.reserve(request('synthetic-request-0002')), error => error.code === 'AI_BUDGET_UNAPPROVED');
  await budget.reconcile(reservation, {inputTokens: 100, outputTokens: 10});
  assert.equal((await ledger(store)).spentMicros, 62);
  assert.equal(await ledger(store, '2026-10-13'), undefined);
});

test('an exceeded usage bound records the charge and blocks subsequent calls', async () => {
  const {store,budget} = await fixture();
  const reservation = await budget.reserve(request());
  assert.equal((await budget.reconcile(reservation, {inputTokens: 1001, outputTokens: 100})).boundExceeded, true);
  assert.equal((await ledger(store)).blocked, true);
  assert.equal((await budget.status()).reason, 'AI_BUDGET_REVIEW_REQUIRED');
});

async function approvePolicy(store, extra = {}) {
  const row = await store.get(namespace, 'POLICY');
  await store.transact([change(namespace, 'POLICY', row, {
    currency: 'USD', dailyLimitMicros: 1_000_000, effectiveFrom: '2026-10-12',
    approvalReference: 'synthetic-shared-daily-authorization', approvedAt: date.toISOString(),
    pricingVersion: AI_PRICING_VERSION, expiresAt: AI_PRICING_EXPIRES_AT, ...extra,
  })]);
}

test('explicit shared policy atomically creates daily envelopes without an environment default', async () => {
  const store = new MemoryStore();
  await approvePolicy(store);
  let clock = date;
  const budget = createAiBudget({store, now: () => clock});
  assert.equal((await budget.status()).enabled, true);
  assert.equal(await store.get(namespace, 'ENVELOPE#2026-10-12'), null);
  const first = await budget.reserve(request());
  assert.equal((await store.get(namespace, 'ENVELOPE#2026-10-12')).value.policyDerived, true);
  clock = new Date('2026-10-12T13:00:00Z');
  await budget.reserve(request('synthetic-request-0002'));
  assert.equal((await store.get(namespace, 'ENVELOPE#2026-10-13')).value.approvedMicros, 1_000_000);
  await budget.reconcile(first, {inputTokens: 100, outputTokens: 10});
  assert.equal((await ledger(store)).spentMicros, 62);
  assert.equal((await ledger(store, '2026-10-13')).spentMicros, 0);
});

test('policy revocation invalidates an already-created policy envelope', async () => {
  const store = new MemoryStore();
  await approvePolicy(store);
  const budget = createAiBudget({store, now: () => date});
  await budget.reserve(request());
  await approvePolicy(store, {dailyLimitMicros: 0});
  assert.equal((await budget.status()).enabled, false);
  await assert.rejects(budget.reserve(request('synthetic-request-0002')), error => error.code === 'AI_BUDGET_UNAPPROVED');
});

test('policy and price review expiration cannot silently renew authorization', async () => {
  for (const extra of [{expiresAt: '2027-01-01T00:00:00Z'}, {effectiveFrom: '2026-10-13'}, {pricingVersion: 'stale'}]) {
    const store = new MemoryStore();
    await approvePolicy(store, extra);
    assert.equal((await createAiBudget({store, now: () => date}).status()).enabled, false);
  }
  const store = new MemoryStore();
  await approvePolicy(store);
  const budget = createAiBudget({store, now: () => new Date(AI_PRICING_EXPIRES_AT)});
  assert.equal((await budget.status()).enabled, false);
  await assert.rejects(budget.reserve(request()), error => error.code === 'AI_BUDGET_UNAPPROVED');
});

test('external providers and OpenAI reservations compete for the same aggregate money', async () => {
  const {store,budget} = await fixture({micros: 1000});
  const external = await budget.reserveExternal({requestId: 'synthetic-external-0001', reservedMicros: 700, service: 'synthetic.tts', reference: 'local-fixture/all-in-tax-included'});
  await assert.rejects(budget.reserve(request()), error => error.code === 'AI_BUDGET_EXHAUSTED');
  await budget.settleExternal(external, {actualMicros: 300, reference: 'synthetic-provider-usage'});
  await budget.reserve(request());
  assert.equal((await ledger(store)).spentMicros, 300);
  assert.equal((await ledger(store)).reservedMicros, 616);
  await budget.settleExternal(external, {actualMicros: 300, reference: 'synthetic-provider-usage'});
  assert.equal((await ledger(store)).spentMicros, 300);
});

test('external reservations require bounded costs and cannot use model reconciliation', async () => {
  const {budget} = await fixture();
  await assert.rejects(budget.reserveExternal({requestId: 'synthetic-external-0001', reservedMicros: 1_000_001, service: 'tts', reference: 'quote'}));
  await assert.rejects(budget.reserveExternal({requestId: 'synthetic-external-0001', reservedMicros: 100, service: 'tts', reference: ''}));
  const external = await budget.reserveExternal({requestId: 'synthetic-external-0001', reservedMicros: 100, service: 'tts', reference: 'quote'});
  await assert.rejects(budget.reconcile(external, {inputTokens: 0, outputTokens: 0}), error => error.code === 'AI_USAGE_INVALID');
  await assert.rejects(budget.settleExternal(external, {actualMicros: -1, reference: 'invoice'}), error => error.code === 'AI_USAGE_INVALID');
  await assert.rejects(budget.settleExternal(external, {actualMicros: 1, reference: ''}), error => error.code === 'AI_USAGE_INVALID');
});

test('ordinary external CNY quote is queryable and blocks an over-quote bean charge', async () => {
  const {store,budget} = await fixture();
  const requestId = 'synthetic-video-job-0001';
  assert.equal((await budget.externalReservationStatus(requestId)).exists, false);
  const reservation = await budget.reserveExternal({requestId, reservedMicros: 800000,
    service: 'kaipai.video', reference: 'f'.repeat(64), quotedCnyFen: 500,
    fxReference: 'CFETS-2026-10-13-floor-6.0'});
  const count = store.items.size;
  const status = await budget.externalReservationStatus(requestId);
  assert.equal(status.status, 'reserved');
  assert.equal(status.quotedCnyFen, 500);
  assert.equal(status.fxReference, 'CFETS-2026-10-13-floor-6.0');
  assert.equal(store.items.size, count);
  await assert.rejects(budget.settleExternal(reservation, {actualMicros: 700000, reference: 'provider-evidence'}),
    error => error.code === 'AI_USAGE_INVALID');
  const settled = await budget.settleExternal(reservation, {actualMicros: 900000,
    actualCnyFen: 600, reference: 'provider-evidence'});
  assert.equal(settled.cnyBoundExceeded, true);
  assert.equal((await budget.status()).reason, 'AI_BUDGET_REVIEW_REQUIRED');
});

const videoDate = new Date('2026-10-14T03:00:00Z');
const videoQuote = 'a'.repeat(64);
const videoFields = {
  requestId: ONE_TIME_KAIPAI_EXCEPTION.requestId, service: ONE_TIME_KAIPAI_EXCEPTION.service,
  reference: videoQuote, quotedCnyFen: 1500, reservedMicros: 2_500_000,
};
const videoApprovalFields = {...videoFields, fxReference: 'synthetic-bank-rate-2026-10-14', jobApprovalReference: 'synthetic-exact-job-consent'};
const serumException = Object.freeze({...ONE_TIME_KAIPAI_SERUM_EXCEPTION, requestId: 'synthetic-serum-job-0001', quoteHash: 'c'.repeat(64)});
const serumFields = {
  requestId: serumException.requestId, service: serumException.service,
  reference: 'c'.repeat(64), quotedCnyFen: 1000, reservedMicros: 1_750_000,
};
const serumApprovalFields = {...serumFields, fxReference: 'synthetic-bank-rate-2026-10-14', jobApprovalReference: 'synthetic-serum-consent'};

test('serum exception requires the exact boss-IP request and live quote', async () => {
  assert.equal(ONE_TIME_KAIPAI_SERUM_EXCEPTION.requestId, '4fa0a65bbd7948dd9b6d8b49e7f3d9c3');
  assert.equal(ONE_TIME_KAIPAI_SERUM_EXCEPTION.quoteHash, 'c8b46b662979436cd9a6dc6ccec9d4cc1950da3182e1f6c847d62200af740406');
  assert.equal(oneTimeExceptionForRequest(serumFields.requestId), null);
  assert.equal(oneTimeExceptionForRequest(ONE_TIME_KAIPAI_SERUM_EXCEPTION.requestId)?.id, ONE_TIME_KAIPAI_SERUM_EXCEPTION.id);
  const store = new MemoryStore();
  await approvePolicy(store);
  const budget = createAiBudget({store, now: () => videoDate});
  await assert.rejects(budget.approveOneTimeExternal(serumApprovalFields), error => error.code === 'AI_EXCEPTION_INVALID');
  await assert.rejects(budget.approveOneTimeExternal({...serumApprovalFields, requestId: ONE_TIME_KAIPAI_SERUM_EXCEPTION.requestId}), error => error.code === 'AI_EXCEPTION_INVALID');
  assert.equal(await store.get(namespace, `EXCEPTION#${ONE_TIME_KAIPAI_SERUM_EXCEPTION.id}`), null);
});

test('exact serum request and quote can reserve once in a memory ledger only', async () => {
  const store = new MemoryStore();
  await approvePolicy(store);
  const budget = createAiBudget({store, now: () => videoDate});
  const fields = {...serumFields, requestId: ONE_TIME_KAIPAI_SERUM_EXCEPTION.requestId,
    reference: ONE_TIME_KAIPAI_SERUM_EXCEPTION.quoteHash};
  await budget.approveOneTimeExternal({...fields, fxReference: 'synthetic-bank-rate-2026-10-14',
    jobApprovalReference: 'synthetic-exact-job-consent'});
  assert.equal((await budget.oneTimeExternalStatus(fields)).canReserve, true);
  const reservation = await budget.reserveOneTimeExternal(fields);
  assert.equal(reservation.exceptionId, ONE_TIME_KAIPAI_SERUM_EXCEPTION.id);
  await assert.rejects(budget.reserveOneTimeExternal(fields), error => error.code === 'AI_EXCEPTION_MISMATCH');
});

test('serum and honey exceptions have separate one-use records and preserve the ordinary cap', async () => {
  const store = new MemoryStore();
  await approvePolicy(store);
  const budget = createAiBudget({store, now: () => videoDate, oneTimeExceptions: [ONE_TIME_KAIPAI_EXCEPTION, serumException]});
  await budget.reserveExternal({requestId: 'synthetic-ordinary-0001', reservedMicros: 1_000_000, service: 'synthetic.tts', reference: 'ordinary-quote'});
  assert.equal((await budget.status()).remainingMicros, 0);
  await budget.approveOneTimeExternal(videoApprovalFields);
  await budget.approveOneTimeExternal(serumApprovalFields);
  const honey = await budget.reserveOneTimeExternal(videoFields);
  const serum = await budget.reserveOneTimeExternal(serumFields);
  assert.equal(honey.exceptionId, ONE_TIME_KAIPAI_EXCEPTION.id);
  assert.equal(serum.exceptionId, serumException.id);
  assert.equal((await store.get(namespace, `EXCEPTION#${serumException.id}`)).value.status, 'reserved');
  assert.equal((await store.get(namespace, `EXCEPTION#${ONE_TIME_KAIPAI_EXCEPTION.id}`)).value.status, 'reserved');
  assert.equal((await ledger(store, '2026-10-14')).reservedMicros, 5_250_000);
  assert.equal((await budget.status()).remainingMicros, 0);
  await assert.rejects(budget.reserveOneTimeExternal(serumFields), error => error.code === 'AI_EXCEPTION_MISMATCH');
  await assert.rejects(budget.reserveExternal({requestId: 'synthetic-ordinary-0002', reservedMicros: 1, service: 'synthetic.tts', reference: 'another-quote'}), error => error.code === 'AI_BUDGET_EXHAUSTED');
  const settled = await budget.settleExternal(serum, {actualMicros: 1_600_000, actualCnyFen: 1000, reference: 'synthetic-serum-beans'});
  assert.equal(settled.boundExceeded, undefined);
  assert.equal((await ledger(store, '2026-10-14')).spentMicros, 1_600_000);
});

test('serum exception rejects cost or quote changes and expires at Sydney midnight', async () => {
  const store = new MemoryStore();
  await approvePolicy(store);
  let clock = videoDate;
  const budget = createAiBudget({store, now: () => clock, oneTimeExceptions: [ONE_TIME_KAIPAI_EXCEPTION, serumException]});
  await assert.rejects(budget.approveOneTimeExternal({...serumApprovalFields, quotedCnyFen: 1001}), error => error.code === 'AI_EXCEPTION_INVALID');
  await assert.rejects(budget.approveOneTimeExternal({...serumApprovalFields, reservedMicros: 2_000_001}), error => error.code === 'AI_EXCEPTION_INVALID');
  await assert.rejects(budget.approveOneTimeExternal({...serumApprovalFields, reference: 'd'.repeat(64)}), error => error.code === 'AI_EXCEPTION_INVALID');
  await budget.approveOneTimeExternal(serumApprovalFields);
  for (const changes of [{requestId: ONE_TIME_KAIPAI_EXCEPTION.requestId}, {reference: 'd'.repeat(64)}, {quotedCnyFen: 999}, {reservedMicros: 1_700_000}]) {
    await assert.rejects(budget.reserveOneTimeExternal({...serumFields, ...changes}));
  }
  assert.equal(await ledger(store, '2026-10-14'), undefined);
  clock = new Date(serumException.expiresAt);
  await assert.rejects(budget.reserveOneTimeExternal(serumFields), error => error.code === 'AI_EXCEPTION_EXPIRED');
});

test('one-time Kaipai video reserves beyond the exhausted ordinary cap without raising that cap', async () => {
  const store = new MemoryStore();
  await approvePolicy(store);
  const budget = createAiBudget({store, now: () => videoDate});
  await budget.reserveExternal({requestId: 'synthetic-ordinary-0001', reservedMicros: 1_000_000, service: 'synthetic.tts', reference: 'ordinary-quote'});
  assert.equal((await budget.status()).remainingMicros, 0);
  const approval = await budget.approveOneTimeExternal(videoApprovalFields);
  assert.equal(approval.approvalReference, ONE_TIME_KAIPAI_EXCEPTION.approvalReference);
  assert.equal((await budget.oneTimeExternalStatus(videoFields)).canReserve, true);
  const outcomes = await Promise.allSettled([budget.reserveOneTimeExternal(videoFields), budget.reserveOneTimeExternal(videoFields)]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const reservation = outcomes.find(result => result.status === 'fulfilled').value;
  assert.equal(reservation.exceptionId, ONE_TIME_KAIPAI_EXCEPTION.id);
  assert.equal((await ledger(store, '2026-10-14')).reservedMicros, 3_500_000);
  assert.equal((await budget.status()).remainingMicros, 0);
  await assert.rejects(budget.reserveExternal({requestId: 'synthetic-ordinary-0002', reservedMicros: 1, service: 'synthetic.tts', reference: 'another-quote'}), error => error.code === 'AI_BUDGET_EXHAUSTED');
  const settled = await budget.settleExternal(reservation, {actualMicros: 2_230_000, actualCnyFen: 1500, reference: 'synthetic-credit-consumption'});
  assert.equal(settled.actualCnyFen, 1500);
  assert.equal(settled.boundExceeded, undefined);
  assert.equal((await ledger(store, '2026-10-14')).spentMicros, 2_230_000);
  assert.equal((await ledger(store, '2026-10-14')).reservedMicros, 1_000_000);
  await assert.rejects(budget.approveOneTimeExternal(videoApprovalFields), error => error.code === 'AI_EXCEPTION_ALREADY_APPROVED');
});

test('one-time video approval binds job, quote, CNY/USD bounds and expires at Sydney midnight', async () => {
  const store = new MemoryStore();
  await approvePolicy(store);
  let clock = videoDate;
  const budget = createAiBudget({store, now: () => clock});
  await assert.rejects(budget.approveOneTimeExternal({...videoApprovalFields, quotedCnyFen: 3001}), error => error.code === 'AI_EXCEPTION_INVALID');
  await assert.rejects(budget.approveOneTimeExternal({...videoApprovalFields, reservedMicros: 6_000_001}), error => error.code === 'AI_EXCEPTION_INVALID');
  await budget.approveOneTimeExternal(videoApprovalFields);
  for (const changes of [{requestId: 'synthetic-kaipai-job-0002'}, {reference: 'b'.repeat(64)}, {quotedCnyFen: 1400}, {reservedMicros: 2_400_000}, {service: 'another.provider'}]) {
    await assert.rejects(budget.reserveOneTimeExternal({...videoFields, ...changes}));
  }
  assert.equal((await ledger(store, '2026-10-14')), undefined);
  clock = new Date(ONE_TIME_KAIPAI_EXCEPTION.expiresAt);
  await assert.rejects(budget.reserveOneTimeExternal(videoFields), error => error.code === 'AI_EXCEPTION_EXPIRED');
  assert.equal((await budget.oneTimeExternalStatus(videoFields)).canReserve, false);
});

test('one-time video reconciliation requires CNY evidence and blocks any over-quote charge', async () => {
  const store = new MemoryStore();
  await approvePolicy(store);
  const budget = createAiBudget({store, now: () => videoDate});
  await budget.approveOneTimeExternal(videoApprovalFields);
  const reservation = await budget.reserveOneTimeExternal(videoFields);
  await assert.rejects(budget.settleExternal(reservation, {actualMicros: 2_230_000, reference: 'missing-cny'}), error => error.code === 'AI_USAGE_INVALID');
  assert.equal((await ledger(store, '2026-10-14')).reservedMicros, 2_500_000);
  const result = await budget.settleExternal(reservation, {actualMicros: 2_400_000, actualCnyFen: 1600, reference: 'synthetic-over-quote'});
  assert.equal(result.cnyBoundExceeded, true);
  assert.equal((await ledger(store, '2026-10-14')).blocked, true);
});

test('confirmed zero-charge release does not reset the one-time slot', async () => {
  const store = new MemoryStore();
  await approvePolicy(store);
  const budget = createAiBudget({store, now: () => videoDate});
  await budget.approveOneTimeExternal(videoApprovalFields);
  const reservation = await budget.reserveOneTimeExternal(videoFields);
  await budget.release(reservation, {reason: 'CONFIRMED_ZERO_CHARGE', reference: 'synthetic-provider-no-charge'});
  assert.equal((await budget.oneTimeExternalStatus(videoFields)).canReserve, false);
  await assert.rejects(budget.reserveOneTimeExternal(videoFields), error => error.code === 'AI_EXCEPTION_MISMATCH');
  assert.equal((await ledger(store, '2026-10-14')).reservedMicros, 0);
});

const profile = {name: 'Synthetic only', resumeText: 'Built React and TypeScript applications. 任意 Unicode text.', skills: ['React'], workRights: 'unknown', needsSponsorship: 'unknown', clearance: 'unknown'};
const job = {title: 'Software Engineer', company: 'Synthetic only', description: 'Build React applications.'};
const env = {OPENAI_API_KEY_PARAM: 'synthetic-local', OPENAI_MODEL: 'gpt-4.1-mini', OPENAI_DAILY_CALL_LIMIT: '20', OPENAI_DAILY_TOKEN_LIMIT: '1000000', OPENAI_MAX_OUTPUT_TOKENS: '1200'};
const letter = 'Dear Hiring Team, I am interested in your Software Engineer position. My resume describes building React and TypeScript applications. I would welcome a discussion of the role. Kind regards, Synthetic only';
const response = (extra = {}) => new Response(JSON.stringify({id: 'resp_synthetic', model: AI_MODEL, status: 'completed', usage: {input_tokens: 200, output_tokens: 70}, output: [{type: 'message', content: [{type: 'output_text', text: letter}]}], ...extra}), {status: 200});

async function providerFixture(fetchImpl, options = {}) {
  const {store} = await fixture();
  let secretCalls = 0;
  const provider = createProvider(store, {...env, ...options.env}, {
    now: () => date, fetchImpl,
    secretImpl: async () => { secretCalls++; return 'SYNTHETIC_NOT_A_CREDENTIAL'; },
    ...options.dependencies,
  });
  return {store,provider,secretCalls: () => secretCalls};
}

test('provider pins the snapshot, bounds bytes/output, disables storage/tools and reconciles actual usage', async () => {
  let calls = 0;
  const {store,provider} = await providerFixture(async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.model, AI_MODEL);
    assert.equal(body.max_output_tokens, 1200);
    assert.equal(body.temperature, 0);
    assert.equal(body.top_p, undefined);
    assert.equal(body.store, false);
    assert.equal(body.service_tier, 'default');
    assert.equal(body.tools, undefined);
    const reservation = (await store.list(namespace, 'REQUEST#'))[0].value;
    assert.equal(reservation.inputTokenUpperBound, Buffer.byteLength(options.body, 'utf8') + 2048);
    return response();
  });
  assert.equal(await provider.available(), true);
  assert.equal(await provider.generate(profile, job, 'synthetic-request-0001'), letter);
  assert.equal(calls, 1);
  assert.equal((await ledger(store)).spentMicros, aiCostMicros(200, 70));
  assert.equal((await ledger(store)).reservedMicros, 0);
  await assert.rejects(provider.generate(profile, job, 'synthetic-request-0001'), error => error.code === 'AI_REQUEST_ALREADY_RESERVED');
  assert.equal(calls, 1);
});

test('letter request separates candidate evidence from requirements and forbids invented availability or resume-gap commentary', async () => {
  let calls = 0;
  const candidate = {...profile, resumeText: 'Built React and TypeScript applications. Availability and start date unspecified.',
    location: 'Sydney', preferences: {locations: ['Sydney'], workplaceTypes: ['hybrid'], employmentTypes: ['full-time'], relocation: true}};
  const target = {...job, description: 'Hybrid full-time position in Sydney. Immediate start required. Docker experience required.'};
  const {provider} = await providerFixture(async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body), input = JSON.parse(body.input);
    assert.equal(body.temperature, 0);
    assert.equal(input.resume, candidate.resumeText);
    assert.equal(input.job.description, target.description);
    assert.equal(input.reviewedProfile.availability, undefined);
    assert.equal(input.reviewedProfile.preferences, undefined);
    assert.equal(input.preferences, undefined);
    assert.match(body.instructions, /CANDIDATE EVIDENCE is only resume and reviewedProfile/);
    assert.match(body.instructions, /JOB DATA describes the employer, never the candidate/);
    assert.match(body.instructions, /Never turn a job requirement into claimed candidate experience/);
    assert.match(body.instructions, /availability, a start date, notice period, relocation, commuting, working hours/);
    assert.match(body.instructions, /only when explicit affirmative candidate evidence confirms that exact claim/);
    assert.match(body.instructions, /A preference, current location, job-search situation or job requirement is not availability evidence/);
    assert.match(body.instructions, /If availability is unspecified, unknown, conditional or absent, omit availability and work-arrangement assertions entirely/);
    assert.match(body.instructions, /Do not include resume-gap commentary/);
    assert.match(body.instructions, /Leave unsupported requirements out of the letter without explanation/);
    assert.match(body.instructions, /do not append availability promises/);
    return response();
  });
  await provider.generate(candidate, target, 'synthetic-prompt-0001');
  assert.equal(calls, 1);
});

test('provider with missing approval, unpriced model or unsafe caps never retrieves a key or calls out', async () => {
  for (const badEnv of [{OPENAI_MODEL: 'gpt-4.1'}, {OPENAI_DAILY_CALL_LIMIT: '0'}, {OPENAI_MAX_OUTPUT_TOKENS: '1201'}, {}]) {
    let touched = false;
    const store = new MemoryStore();
    if (Object.keys(badEnv).length) await approve(store);
    const provider = createProvider(store, {...env, ...badEnv}, {
      now: () => date, secretImpl: async () => { touched = true; }, fetchImpl: async () => { touched = true; },
    });
    assert.equal(await provider.available(), false);
    await assert.rejects(provider.generate(profile, job, 'synthetic-request-0001'));
    assert.equal(touched, false);
  }
});

test('provider can use a separately injected shared store and namespace', async () => {
  const appStore = new MemoryStore(), shared = new MemoryStore(), pk = 'SYSTEM#GLOBAL_AI';
  await approve(shared, {pk});
  const provider = createProvider(appStore, env, {budgetStore: shared, budgetNamespace: pk, now: () => date, secretImpl: async () => 'SYNTHETIC', fetchImpl: async () => response()});
  await provider.generate(profile, job, 'synthetic-request-0001');
  assert.equal((await ledger(shared, sydneyBudgetDay(date), pk)).spentMicros, aiCostMicros(200, 70));
  assert.equal(appStore.items.size, 0);
});

test('credential lookup failure releases the reservation without a network request', async () => {
  let calls = 0;
  const {store,provider} = await providerFixture(async () => { calls++; }, {dependencies: {secretImpl: async () => { throw new Error('synthetic'); }}});
  await assert.rejects(provider.generate(profile, job, 'synthetic-request-0001'), /not configured/);
  assert.equal(calls, 0);
  assert.equal((await ledger(store)).reservedMicros, 0);
});

test('known rejection refunds, while transport failures and ambiguous HTTP errors retain reserves', async () => {
  for (const scenario of [400,401,429,408,500,'network']) {
    let calls = 0;
    const {store,provider} = await providerFixture(async () => {
      calls++;
      if (scenario === 'network') throw new Error('synthetic network failure');
      return new Response('do not log this body', {status: scenario});
    });
    await assert.rejects(provider.generate(profile, job, 'synthetic-request-0001'), error => {
      assert.equal(error.message.includes('do not log'), false);
      assert.equal(error.uncertain, [408,500,'network'].includes(scenario));
      return true;
    });
    assert.equal(calls, 1, 'a failed provider call must never be automatically retried');
    await assert.rejects(provider.generate(profile, job, 'synthetic-request-0001'), error => error.code === 'AI_REQUEST_ALREADY_RESERVED');
    assert.equal(calls, 1, 'replaying a request must not launch another provider call');
    assert.equal((await ledger(store)).reservedMicros > 0, [408,500,'network'].includes(scenario));
  }
});

test('missing usage, invalid JSON, oversized body and unexpected models retain full reserves', async () => {
  for (const makeResponse of [() => response({usage: null}), () => new Response('invalid'), () => new Response('x'.repeat(256 * 1024 + 1)), () => response({model: 'unpriced-model'})]) {
    const {store,provider} = await providerFixture(async () => makeResponse());
    await assert.rejects(provider.generate(profile, job, 'synthetic-request-0001'), error => error.uncertain === true);
    assert.ok((await ledger(store)).reservedMicros > 0);
    assert.equal((await ledger(store)).spentMicros, 0);
  }
});

test('incomplete or unusable letters still record charged usage without consuming a second provider call', async () => {
  for (const extra of [{status: 'incomplete'}, {output: []}]) {
    const {store,provider} = await providerFixture(async () => response(extra));
    await assert.rejects(provider.generate(profile, job, 'synthetic-request-0001'), error => error.uncertain === false);
    assert.equal((await ledger(store)).spentMicros, aiCostMicros(200, 70));
    assert.equal((await ledger(store)).reservedMicros, 0);
  }
});


test('authorized five-dollar policy remains atomic across concurrent external providers', async () => {
  const store = new MemoryStore();
  await approvePolicy(store, {dailyLimitMicros: 5_000_000});
  const budget = createAiBudget({store, now: () => date});
  assert.equal((await budget.status()).remainingMicros, 5_000_000);
  const results = await Promise.allSettled([1,2,3].map(index => budget.reserveExternal({
    requestId: `synthetic-five-dollar-${index}`, reservedMicros: 2_000_000,
    service: 'atlas.video.mini', reference: `synthetic-quote-${index}`,
  })));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 2);
  assert.equal((await budget.status()).remainingMicros, 1_000_000);
  assert.equal((await ledger(store)).reservedMicros, 4_000_000);
});
