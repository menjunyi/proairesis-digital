import test from 'node:test';
import assert from 'node:assert/strict';
import {main,parseArguments,safeFailure} from '../scripts/ai-budget.mjs';
import {MemoryStore,change} from '../server/store.mjs';
import {AI_PRICING_VERSION,AI_PRICING_EXPIRES_AT,ONE_TIME_KAIPAI_EXCEPTION,ONE_TIME_KAIPAI_SERUM_EXCEPTION} from '../server/ai-budget.mjs';

const now = () => new Date('2026-10-12T03:00:00Z');
const read = async (service, _operation) => service === 'sts' ? {Account: '037169690315'} : {Stacks: [{
  StackId: 'arn:aws:cloudformation:ap-southeast-2:037169690315:stack/roleclue-member-app/synthetic',
  StackStatus: 'CREATE_COMPLETE', Outputs: [{OutputKey: 'TableName', OutputValue: 'roleclue-synthetic-budget-table'}],
}]};
async function fixture() {
  const store = new MemoryStore();
  await store.transact([change('SYSTEM#EXTERNAL_AI', 'POLICY', null, {
    currency: 'USD', dailyLimitMicros: 1_000_000, effectiveFrom: '2026-10-12', approvedAt: now().toISOString(),
    approvalReference: 'synthetic-only', pricingVersion: AI_PRICING_VERSION, expiresAt: AI_PRICING_EXPIRES_AT,
  })]);
  return {store, awsRead: read, now};
}
const reserve = ['reserve-external','--request-id','synthetic-external-0001','--reserved-micros','10000','--service','synthetic.tts','--reference','all-in-quote'];

test('budget CLI defaults to read-only status and help never accesses AWS', async () => {
  assert.deepEqual(parseArguments([]), {command: 'status'});
  assert.match((await main(['--help'], {awsRead: () => { throw new Error('must not run'); }})).help, /Unknown outcomes must retain/);
  const deps = await fixture(), before = deps.store.items.size;
  assert.equal((await main([], deps)).remainingMicros, 1_000_000);
  assert.equal(deps.store.items.size, before);
  assert.equal((await main(reserve, deps)).dryRun, true);
  assert.equal(deps.store.items.size, before);
});

test('budget CLI verifies the exact account and table before any write', async () => {
  const deps = await fixture(), before = deps.store.items.size;
  await assert.rejects(main([...reserve,'--apply'], {...deps, awsRead: async () => ({Account: 'wrong'})}), error => error.code === 'ACCOUNT_MISMATCH');
  await assert.rejects(main([...reserve,'--apply','--table','another-table'], deps), error => error.code === 'TABLE_MISMATCH');
  assert.equal(deps.store.items.size, before);
});

test('budget CLI reserves and reconciles only with apply and requires explicit zero-charge evidence for release', async () => {
  const deps = await fixture();
  const saved = await main([...reserve,'--apply'], deps);
  assert.equal(saved.status, 'reserved');
  const reconcile = ['reconcile-external','--request-id','synthetic-external-0001','--actual-micros','7000','--service','synthetic.tts','--reference','usage-fixture'];
  await assert.rejects(main(reconcile.map(value => value === '7000' ? '0' : value), deps), error => error.code === 'ZERO_CHARGE_CONFIRMATION_REQUIRED');
  assert.equal((await main(reconcile, deps)).dryRun, true);
  assert.equal((await main([], deps)).reservedMicros, 10000);
  assert.equal((await main([...reconcile,'--apply'], deps)).actualMicros, 7000);
  assert.equal((await main([], deps)).spentMicros, 7000);
  const release = ['release-external','--request-id','synthetic-external-0001','--service','synthetic.tts','--reference','confirmed-zero-fixture','--apply'];
  await assert.rejects(main(release, deps), error => error.code === 'ZERO_CHARGE_CONFIRMATION_REQUIRED');
  assert.equal((await main([...release,'--confirmed-zero-charge'], deps)).status, 'settled');
  assert.equal((await main([], deps)).spentMicros, 7000);
  const second = reserve.map(value => value === 'synthetic-external-0001' ? 'synthetic-external-0002' : value);
  await main([...second,'--apply'], deps);
  const result = await main([...release.map(value => value === 'synthetic-external-0001' ? 'synthetic-external-0002' : value),'--confirmed-zero-charge'], deps);
  assert.equal(result.status, 'released');
  assert.equal((await deps.store.get('SYSTEM#EXTERNAL_AI', result.requestKey)).value.releaseReference, 'confirmed-zero-fixture');
});

test('budget CLI rejects duplicate options and redacts unexpected failures', () => {
  assert.throws(() => parseArguments(['--apply','--apply']), /Duplicate/);
  assert.throws(() => parseArguments(['--unknown','x']), /Unknown/);
  assert.equal(JSON.stringify(safeFailure(new Error('synthetic secret body'))).includes('synthetic secret body'), false);
});

test('exact external status is read-only and works without a current-day approval', async () => {
  const deps = {store: new MemoryStore(), awsRead: read, now};
  const lookup = ['status-external','--request-id','synthetic-video-job-0001'];
  const before = deps.store.items.size;
  const missing = await main(lookup, deps);
  assert.equal(missing.exists, false);
  assert.match(missing.requestKey, /^REQUEST#[a-f0-9]{64}$/);
  assert.equal(deps.store.items.size, before);
  await assert.rejects(main([...lookup,'--apply'], deps), error => error.code === 'INVALID_ARGUMENTS');
});

test('ordinary external CNY quote keeps exact FX evidence and reconciles verified beans', async () => {
  const deps = await fixture();
  const requestId = 'synthetic-video-job-0002';
  const quoteHash = 'e'.repeat(64);
  const reserveQuoted = ['reserve-external','--apply','--request-id',requestId,'--reserved-micros','900000',
    '--quoted-cny-fen','500','--fx-reference','CFETS-2026-10-13-USD-CNY-6.7298-floor-6.0',
    '--service','kaipai.video','--reference',quoteHash];
  const status = ['status-external','--request-id',requestId];
  assert.equal((await main(status, deps)).exists, false);
  await main(reserveQuoted, deps);
  const count = deps.store.items.size;
  const saved = await main(status, deps);
  assert.equal(saved.status, 'reserved');
  assert.equal(saved.reference, quoteHash);
  assert.equal(saved.quotedCnyFen, 500);
  assert.match(saved.fxReference, /CFETS/);
  assert.equal(deps.store.items.size, count);
  await assert.rejects(main(reserveQuoted, deps), error => error.code === 'REQUEST_ALREADY_EXISTS');
  await assert.rejects(main(['reconcile-external','--apply','--request-id',requestId,'--actual-micros','450000',
    '--service','kaipai.video','--reference','verified-beans'], deps), error => error.code === 'AI_USAGE_INVALID');
  await main(['reconcile-external','--apply','--request-id',requestId,'--actual-micros','450000',
    '--actual-cny-fen','250','--service','kaipai.video','--reference','verified-beans'], deps);
  const settled = await main(status, deps);
  assert.equal(settled.status, 'settled');
  assert.equal(settled.actualCnyFen, 250);
  assert.equal(settled.actualMicros, 450000);
  assert.equal(settled.usageReference, 'verified-beans');
});

test('one-time Kaipai CLI approval and reservation are separate writes bound to one final quote', async () => {
  const deps = {...await fixture(), now: () => new Date('2026-10-14T03:00:00Z')};
  const quoteHash = 'a'.repeat(64);
  const approval = ['approve-one-time-external','--request-id',ONE_TIME_KAIPAI_EXCEPTION.requestId,'--reserved-micros','2500000',
    '--quoted-cny-fen','1500','--service',ONE_TIME_KAIPAI_EXCEPTION.service,'--reference',quoteHash,
    '--fx-reference','synthetic-bank-rate','--job-approval-reference','synthetic-exact-job-consent'];
  const reservation = ['reserve-one-time-external','--request-id',ONE_TIME_KAIPAI_EXCEPTION.requestId,'--reserved-micros','2500000',
    '--quoted-cny-fen','1500','--service',ONE_TIME_KAIPAI_EXCEPTION.service,'--reference',quoteHash];
  const before = deps.store.items.size;
  assert.equal((await main(approval, deps)).canApprove, true);
  assert.equal(deps.store.items.size, before);
  assert.equal((await main(reservation, deps)).canReserve, false);
  assert.equal((await main([...approval,'--apply'], deps)).applied, true);
  assert.equal((await main(reservation, deps)).canReserve, true);
  assert.equal((await main([...reservation,'--apply'], deps)).reservedMicros, 2_500_000);
  assert.equal((await main(reservation, deps)).canReserve, false);
  await assert.rejects(main([...approval,'--apply'], deps), error => error.code === 'AI_EXCEPTION_ALREADY_APPROVED');
  const reconcile = ['reconcile-external','--request-id',ONE_TIME_KAIPAI_EXCEPTION.requestId,'--actual-micros','2230000',
    '--service',ONE_TIME_KAIPAI_EXCEPTION.service,'--reference','synthetic-usage'];
  await assert.rejects(main([...reconcile,'--apply'], deps), error => error.code === 'AI_EXCEPTION_INVALID');
  assert.equal((await main([...reconcile,'--actual-cny-fen','1500','--apply'], deps)).actualCnyFen, 1500);
  assert.equal((await main([], deps)).spentMicros, 2_230_000);
});

test('one-time CLI rejects over-CNY approvals and never changes the ordinary policy', async () => {
  const deps = {...await fixture(), now: () => new Date('2026-10-14T03:00:00Z')};
  const quoteHash = 'b'.repeat(64);
  const approval = ['approve-one-time-external','--request-id',ONE_TIME_KAIPAI_EXCEPTION.requestId,'--reserved-micros','2500000',
    '--quoted-cny-fen','3001','--service',ONE_TIME_KAIPAI_EXCEPTION.service,'--reference',quoteHash,
    '--fx-reference','synthetic-bank-rate','--job-approval-reference','synthetic-exact-job-consent'];
  await assert.rejects(main([...approval,'--apply'], deps), error => error.code === 'AI_EXCEPTION_INVALID');
  assert.equal(await deps.store.get('SYSTEM#EXTERNAL_AI', `EXCEPTION#${ONE_TIME_KAIPAI_EXCEPTION.id}`), null);
  assert.equal((await deps.store.get('SYSTEM#EXTERNAL_AI', 'POLICY')).value.dailyLimitMicros, 1_000_000);
});

test('serum CLI exception rejects a wrong job or quote before any AWS write', async () => {
  const deps = {...await fixture(), now: () => new Date('2026-10-14T03:00:00Z')};
  const args = ['approve-one-time-external','--request-id','synthetic-serum-job-0001','--reserved-micros','1750000',
    '--quoted-cny-fen','1000','--service','kaipai.video','--reference','c'.repeat(64),
    '--fx-reference','synthetic-bank-rate','--job-approval-reference','synthetic-serum-consent','--apply'];
  await assert.rejects(main(args, deps), error => error.code === 'AI_EXCEPTION_INVALID');
  await assert.rejects(main(args.map(value => value === 'synthetic-serum-job-0001' ? ONE_TIME_KAIPAI_SERUM_EXCEPTION.requestId : value), deps),
    error => error.code === 'AI_EXCEPTION_INVALID');
  assert.equal(await deps.store.get('SYSTEM#EXTERNAL_AI', `EXCEPTION#${ONE_TIME_KAIPAI_SERUM_EXCEPTION.id}`), null);
});

test('serum CLI exact-job dry-run is read-only and reports its own exception', async () => {
  const deps = {...await fixture(), now: () => new Date('2026-10-14T03:00:00Z')};
  const args = ['approve-one-time-external','--request-id',ONE_TIME_KAIPAI_SERUM_EXCEPTION.requestId,
    '--reserved-micros','1750000','--quoted-cny-fen','1000','--service','kaipai.video',
    '--reference',ONE_TIME_KAIPAI_SERUM_EXCEPTION.quoteHash,'--fx-reference','synthetic-bank-rate',
    '--job-approval-reference','synthetic-exact-job-consent'];
  const before = deps.store.items.size;
  const result = await main(args, deps);
  assert.equal(result.dryRun, true);
  assert.equal(result.canApprove, true);
  assert.equal(result.exceptionId, ONE_TIME_KAIPAI_SERUM_EXCEPTION.id);
  assert.equal(deps.store.items.size, before);
});

test('serum CLI approval and reservation bind only its own CNY 10 quote and do not reuse honey approval', async () => {
  const serumException = {...ONE_TIME_KAIPAI_SERUM_EXCEPTION, requestId: 'synthetic-serum-job-0001', quoteHash: 'c'.repeat(64)};
  const deps = {...await fixture(), now: () => new Date('2026-10-14T03:00:00Z'),
    oneTimeExceptions: [ONE_TIME_KAIPAI_EXCEPTION, serumException]};
  const quoteHash = 'c'.repeat(64);
  const approval = ['approve-one-time-external','--request-id',serumException.requestId,'--reserved-micros','1750000',
    '--quoted-cny-fen','1000','--service',serumException.service,'--reference',quoteHash,
    '--fx-reference','synthetic-bank-rate','--job-approval-reference','synthetic-serum-consent'];
  const reservation = ['reserve-one-time-external','--request-id',serumException.requestId,'--reserved-micros','1750000',
    '--quoted-cny-fen','1000','--service',serumException.service,'--reference',quoteHash];
  assert.equal((await main(approval, deps)).exceptionId, serumException.id);
  assert.equal((await main([...approval,'--apply'], deps)).exceptionId, serumException.id);
  assert.equal((await main(reservation, deps)).canReserve, true);
  assert.equal((await main([...reservation,'--apply'], deps)).reservedMicros, 1_750_000);
  assert.equal((await main(reservation, deps)).canReserve, false);
  const overCap = approval.map(value => value === '1000' ? '1001' : value);
  await assert.rejects(main(overCap, deps), error => error.code === 'AI_EXCEPTION_INVALID');
  const wrongQuote = approval.map(value => value === quoteHash ? 'd'.repeat(64) : value);
  await assert.rejects(main(wrongQuote, deps), error => error.code === 'AI_EXCEPTION_INVALID');
  assert.equal((await deps.store.get('SYSTEM#EXTERNAL_AI', 'POLICY')).value.dailyLimitMicros, 1_000_000);
  assert.equal(await deps.store.get('SYSTEM#EXTERNAL_AI', `EXCEPTION#${ONE_TIME_KAIPAI_EXCEPTION.id}`), null);
});
