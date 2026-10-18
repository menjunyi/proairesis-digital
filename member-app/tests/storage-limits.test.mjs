import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MemoryStore, DynamoStore, RecordSizeError, MAX_ITEM_BYTES, change} from '../server/store.mjs';
import {blankEntitlement,createService} from '../server/service.mjs';
import {createHttpHandler} from '../server/handler.mjs';
import {normalizeJob} from '../server/matching.mjs';

for (const prefix of [undefined, '', 'APP#']) {
  test(`Dynamo list paginates with ${prefix === undefined ? 'default' : prefix === '' ? 'explicit empty' : 'nonempty'} prefix and valid key conditions`, async () => {
    const pk = 'USER#synthetic-list', firstKey = {pk, sk: 'APP#first'}, secondKey = {pk, sk: 'APP#second'};
    const first = {...firstKey, value: {id: 'first'}}, last = {pk, sk: 'APP#third', value: {id: 'third'}};
    const pages = [
      {Items: [first], LastEvaluatedKey: firstKey},
      {Items: [], LastEvaluatedKey: secondKey},
      {Items: [last]},
    ];
    const calls = [];
    class QueryCommand {constructor(input) {this.input = input;}}
    const store = new DynamoStore({async send(command) {calls.push(command.input); return pages[calls.length - 1];}}, 'test-only', {QueryCommand});
    const records = prefix === undefined ? await store.list(pk) : await store.list(pk, prefix);
    assert.deepEqual(records, [first, last]);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map(call => call.ExclusiveStartKey), [undefined, firstKey, secondKey]);
    for (const call of calls) {
      assert.equal(call.TableName, 'test-only');
      assert.equal(call.ConsistentRead, true);
      assert.equal(call.KeyConditionExpression, prefix ? 'pk = :pk AND begins_with(sk, :prefix)' : 'pk = :pk');
      assert.deepEqual(call.ExpressionAttributeValues, prefix ? {':pk': pk, ':prefix': prefix} : {':pk': pk});
    }
  });
}

test('memory and Dynamo adapters reject oversize records before any mutation or send', async () => {
  const store = new MemoryStore();
  const changes = [change('USER#a', 'SMALL', null, {ok: true}), change('USER#a', 'HUGE', null, {text: '字'.repeat(130000)})];
  await assert.rejects(() => store.transact(changes), RecordSizeError);
  assert.equal(await store.get('USER#a', 'SMALL'), null);
  let sends = 0;
  const dynamo = new DynamoStore({async send() {sends++;}}, 'test-only', {});
  await assert.rejects(() => dynamo.transact(changes), RecordSizeError);
  assert.equal(sends, 0);
});

test('item-size errors are actionable HTTP413 instead of generic internal errors', async () => {
  const service = {async assertActive() {}, async saveProfile() {throw new RecordSizeError();}};
  const handler = createHttpHandler(service, {mode: 'demo'});
  const response = await handler({rawPath: '/api/profile', headers: {authorization: 'Bearer demo'}, body: '{}', requestContext: {http: {method: 'PUT'}}});
  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).error.code, 'RECORD_TOO_LARGE');
  assert.match(JSON.parse(response.body).error.message, /too large/);
});

test('maximum multi-byte resume and job create bounded profile, application and pending generation items', async () => {
  const description = 'TypeScript React AWS. ' + '技術'.repeat(9900);
  const raw = {id: 'large', country: 'AU', title: 'Software Engineer', company: 'Example', location: 'Sydney', roleFamily: 'software', description, url: 'https://example.test/large', skills: ['TypeScript', 'React', 'AWS']};
  const job = normalizeJob(raw, 'test');
  assert.ok(job);
  assert.ok(Buffer.byteLength(JSON.stringify(job)) <= 90000);
  assert.equal(normalizeJob({...raw, description: '字'.repeat(20001)}, 'test'), null);
  const store = new MemoryStore(), user = {sub: 'alice', email: 'alice@example.test'};
  const profile = {name: 'Alice', email: user.email, resumeText: 'TypeScript React AWS. ' + '経験'.repeat(29000), skills: ['TypeScript', 'React', 'AWS'], roleFamilies: ['software'], location: 'Sydney', workRights: 'unknown', needsSponsorship: 'unknown', clearance: 'unknown', preferences: {}, confirmed: true, consentAt: new Date().toISOString(), termsAcceptedAt: new Date().toISOString()};
  const entitlement=blankEntitlement();entitlement.starter={key:'cs_starter',purchaseId:'pi_starter',sessionId:'cs_starter',status:'active',everPaid:true,used:0,reserved:0};
  await store.transact([change('USER#alice', 'PROFILE', null, profile),change('USER#alice','ENTITLEMENT',null,entitlement)]);
  const service = createService({store, feed: {async jobs() {return [job];}}, provider: {available: () => true}, dispatch: async () => {}});
  await service.saveProfile(user, {...profile, termsAccepted: true});
  await service.decision(user, job.id, {decision: 'interested'});
  const application = (await store.get('USER#alice', `APP#${job.id}`)).value;
  assert.equal(application.match.job, undefined);
  await service.generate(user, job.id, randomUUID());
  for (const row of await store.list('USER#alice')) assert.ok(Buffer.byteLength(JSON.stringify(row)) <= MAX_ITEM_BYTES, row.sk);
  const hugePreferences = Array.from({length: 20}, () => '字'.repeat(200));
  await assert.rejects(() => service.saveProfile(user, {...profile, preferences: {locations: hugePreferences, workplaceTypes: hugePreferences, employmentTypes: hugePreferences, roleTitles: hugePreferences, seniority: hugePreferences}, termsAccepted: true}), e => e.status === 413 && e.code === 'PROFILE_TOO_LARGE');
});
