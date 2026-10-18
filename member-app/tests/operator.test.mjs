import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore, change} from '../server/store.mjs';
import {blankEntitlement, createService} from '../server/service.mjs';
import {inspectGeneration, reconcileGeneration} from '../server/operator.mjs';
import {main, parseArguments} from '../scripts/reconcile-generation.mjs';
import {processGenerationBatch} from '../server/handler.mjs';

const user = {sub: 'alice', email: 'alice@example.test'};
const id = 'a'.repeat(64);
const now = Date.now();
const old = new Date(now - 300000).toISOString();
const providerLetter = 'Dear hiring team, I am interested in your advertised role. My resume describes software delivery using TypeScript, React and AWS. I would welcome a discussion of how this demonstrated experience relates to your team. Kind regards, Alice.';

async function fixture({paid = false, starter = false, recent = false, uncertain = true} = {}) {
  const store = new MemoryStore();
  const entitlement = blankEntitlement();
  if (paid) {
    entitlement.status = 'active';
    entitlement.subscriptionId = 'sub_alice';
    entitlement.periodEnd = new Date(now + 86400000).toISOString();
    entitlement.paid = {key: 'new-period', used: 7, reserved: 2};
  } else if (starter) entitlement.starter = {key: 'starter-purchase', purchaseId: 'pi_starter', sessionId: 'starter-purchase', status: 'active', everPaid: true, used: 1, reserved: 1};
  else entitlement.free.reserved = 1;
  await store.transact([
    change('USER#alice', 'ENTITLEMENT', null, entitlement),
    change('USER#alice', `GEN#${id}`, null, {
      id, appId: 'job-one', status: 'pending', createdAt: old,
      ...(uncertain ? {lease: recent ? new Date(now).toISOString() : old, pendingSince: old, pendingReason: 'PROVIDER_OUTCOME_UNKNOWN'} : {}),
      bucket: paid ? 'paid' : starter ? 'starter' : 'free', periodKey: paid ? 'old-period' : starter ? 'starter-purchase' : 'lifetime',
      profileSnapshot: {resumeText: 'PRIVATE_RESUME_SENTINEL', name: 'PRIVATE_PROFILE_SENTINEL'},
      jobSnapshot: {description: 'PRIVATE_JOB_SENTINEL'},
    }),
    change('USER#alice', 'APP#job-one', null, {id: 'job-one', status: 'interested'}),
  ]);
  const service = createService({store, feed: {async status() {return {};}, async jobs() {return [];}}});
  return {store, service};
}

const target = {userSub: user.sub, generationId: id, now};
const approval = {apply: true, resolution: 'failed', evidenceReference: 'support-case-123/provider-request-456', operatorReference: 'support-operator'};

test('operator CLI defaults to dry-run and never prints resume/profile/letter contents', async () => {
  const {store} = await fixture();
  const before = JSON.stringify([...store.items]);
  const result = await main(['--table', 'test-only', '--user-sub', 'alice', '--generation-id', id], {store, now});
  assert.equal(result.dryRun, true);
  assert.equal(result.generation.canReconcile, true);
  assert.equal(JSON.stringify([...store.items]), before);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|alice@example|resumeText|profileSnapshot|jobSnapshot/);
  assert.equal(parseArguments(['--user-sub', 'alice']).apply, undefined);
});

test('operator failure resolution releases once and permits account deletion', async () => {
  const {store, service} = await fixture();
  await assert.rejects(() => service.deleteAccount(user, {confirmation: 'DELETE'}), e => e.code === 'GENERATION_PENDING');
  const results = await Promise.all(Array.from({length: 3}, () => reconcileGeneration({store, ...target, ...approval})));
  assert.equal(results.filter(result => result.changed).length, 1);
  const entitlement = (await store.get('USER#alice', 'ENTITLEMENT')).value;
  assert.deepEqual(entitlement.free, {used: 0, reserved: 0});
  assert.equal((await store.list('OPERATOR#reconciliation')).length, 1);
  const generation = (await store.get('USER#alice', `GEN#${id}`)).value;
  assert.equal(generation.status, 'failed');
  assert.equal(generation.profileSnapshot, undefined);
  assert.deepEqual(await service.deleteAccount(user, {confirmation: 'DELETE'}), {deleted: true});
});

test('recovered provider letter finalizes exactly once without touching a new paid period', async () => {
  const {store} = await fixture({paid: true});
  const parameters = {store, ...target, ...approval, resolution: 'succeeded', letterText: providerLetter};
  const first = await reconcileGeneration(parameters);
  const second = await reconcileGeneration(parameters);
  assert.equal(first.changed, true);
  assert.equal(first.currentPeriodAdjusted, false);
  assert.equal(second.alreadyFinalized, true);
  assert.deepEqual((await store.get('USER#alice', 'ENTITLEMENT')).value.paid, {key: 'new-period', used: 7, reserved: 2});
  assert.equal((await store.list('USER#alice', 'LETTER#')).length, 1);
  assert.equal((await store.list('USER#alice', 'LETTER#'))[0].value.text, providerLetter);
  assert.doesNotMatch(JSON.stringify(first), /Dear hiring|PRIVATE_/);
});

test('operator recovery respects the two-generation Starter ceiling', async () => {
  const {store} = await fixture({starter: true});
  const parameters = {store, ...target, ...approval, resolution: 'succeeded', letterText: providerLetter};
  await reconcileGeneration(parameters);
  const starter = (await store.get('USER#alice', 'ENTITLEMENT')).value.starter;
  assert.equal(starter.used, 2);assert.equal(starter.reserved, 0);
});

test('operator requires explicit apply, evidence, existing letter and a quiet worker window', async () => {
  const {store} = await fixture({recent: true});
  await assert.rejects(() => reconcileGeneration({store, ...target, ...approval}), e => e.code === 'TOO_RECENT');
  await assert.rejects(() => reconcileGeneration({store, ...target, ...approval, evidenceReference: ''}), e => e.code === 'REFERENCE_REQUIRED');
  await assert.rejects(() => reconcileGeneration({store, ...target, ...approval, resolution: 'succeeded'}), e => e.code === 'LETTER_REQUIRED');
  const preview = await reconcileGeneration({store, ...target, resolution: 'failed'});
  assert.equal(preview.dryRun, true);
  assert.equal((await store.get('USER#alice', 'ENTITLEMENT')).value.free.reserved, 1);
});

test('uncertain worker outcome is persisted and thrown for DLQ; redelivery never calls provider twice', async () => {
  const {store} = await fixture({uncertain: false});
  let calls = 0;
  const service = createService({store, feed: {}, provider: {async generate() {
    calls++;
    throw Object.assign(new Error('transport failure with PRIVATE_RESUME_SENTINEL'), {uncertain: true});
  }}});
  await assert.rejects(() => service.runGeneration(user.sub, id), e => e.uncertain === true && e.code === 'PROVIDER_OUTCOME_UNKNOWN' && !e.message.includes('PRIVATE_'));
  await assert.rejects(() => service.runGeneration(user.sub, id), e => e.uncertain === true && e.code === 'PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(calls, 1);
  const record = (await store.get('USER#alice', `GEN#${id}`)).value;
  assert.equal(record.status, 'pending');
  assert.equal(record.pendingReason, 'PROVIDER_OUTCOME_UNKNOWN');
  assert.ok(record.providerStartedAt);
  assert.ok(record.leaseExpiresAt);
  const metadata = await inspectGeneration({store, ...target, now: Date.now()});
  assert.equal(metadata.canReconcile, false);
  assert.equal((await store.get('USER#alice', 'ENTITLEMENT')).value.free.reserved, 1);
});

test('uncertain SQS redelivery remains failed for DLQ and emits the reconciliation metric event', async () => {
  const {store} = await fixture({uncertain: false});
  let calls = 0;
  const service = createService({store, feed: {}, provider: {async generate() {
    calls++;
    throw Object.assign(new Error('transport failure'), {uncertain: true});
  }}});
  const record={eventSource:'aws:sqs',messageId:'paid-work-one',body:JSON.stringify({kind:'generate',userSub:user.sub,generationId:id})};
  const logged=[];const previous=console.error;console.error=value=>logged.push(value);
  try {
    assert.deepEqual(await processGenerationBatch(service,{Records:[record]}),{batchItemFailures:[{itemIdentifier:'paid-work-one'}]});
    assert.deepEqual(await processGenerationBatch(service,{Records:[record]}),{batchItemFailures:[{itemIdentifier:'paid-work-one'}]});
  } finally { console.error=previous; }
  assert.equal(calls,1);
  assert.equal(logged.map(value=>JSON.parse(value).event).filter(event=>event==='generation_reconciliation_required').length,2);
  assert.equal((await store.get('USER#alice',`GEN#${id}`)).value.pendingReason,'PROVIDER_OUTCOME_UNKNOWN');
});
