import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MemoryStore, change} from '../server/store.mjs';
import {blankEntitlement,createService} from '../server/service.mjs';
import {ResumeError} from '../server/resume.mjs';
import {normalizeJob} from '../server/matching.mjs';

const user = {sub: 'alice', email: 'alice@example.test'};
const bytes = Buffer.from('%PDF-valid-synthetic-input');
const body = {filename: 'resume.pdf', contentType: 'application/pdf', consent: true, size: bytes.length};
const extracted = {text: 'Built TypeScript and React applications and deployed AWS infrastructure. Collaborated with software delivery teams.', skills: ['TypeScript', 'React', 'AWS'], warnings: []};

function uploadFixture(resumeExtraction = extracted) {
  const store = new MemoryStore(), objects = new Map(), calls = [];
  let reject = false;
  const files = {
    async presign(key) {calls.push(['presign', key]); return `https://upload.example.test/${key}`;},
    async put(sub, name, type, data) {const key = `users/${sub}/resumes/${randomUUID()}`; calls.push(['put', key]); objects.set(key, Buffer.from(data)); return key;},
    async get(key) {calls.push(['get', key]); if(!objects.has(key))throw Error('not uploaded'); return objects.get(key);},
    async remove(key) {calls.push(['remove', key]); objects.delete(key);},
    async removeUser(sub) {for(const key of objects.keys())if(key.startsWith(`users/${sub}/`)||key.startsWith(`pending/${sub}/`))objects.delete(key);},
  };
  const service = createService({store, files, feed: {async status() {return {status: 'not-configured'};}}, async extract() {calls.push(['extract']);if(reject)throw new ResumeError('Malformed resume.');return resumeExtraction;}});
  return {store, objects, calls, service, reject: value => reject = value};
}

test('inline files are validated before storage and successful replacement removes the old original', async () => {
  const f = uploadFixture();
  f.reject(true);
  await assert.rejects(() => f.service.uploadResume(user, {...body, dataBase64: bytes.toString('base64')}), ResumeError);
  assert.equal(f.calls.some(([call]) => call === 'put'), false);
  f.reject(false);
  const first = await f.service.uploadResume(user, {...body, dataBase64: bytes.toString('base64')});
  const second = await f.service.uploadResume(user, {...body, dataBase64: bytes.toString('base64')});
  assert.equal(f.objects.has(first.profile.resumeObjectKey), false);
  assert.equal(f.objects.has(second.profile.resumeObjectKey), true);
  assert.equal(f.objects.size, 1);
  assert.ok(Date.parse(second.profile.resumeOriginalExpiresAt) > Date.now());
});

test('signed-in resume evidence fills blank profile fields without replacing reviewed facts', async () => {
  const evidence={text:'Alice Example\nSydney NSW\nSoftware Engineer\nMore than 5 years of professional experience building TypeScript and React applications.',skills:['TypeScript','React'],warnings:[]};
  const f=uploadFixture(evidence),first=await f.service.uploadResume(user,{...body,dataBase64:bytes.toString('base64')});
  assert.equal(first.profile.name,'Alice Example');assert.equal(first.profile.location,'Sydney');assert.equal(first.profile.yearsExperience,5);
  assert.deepEqual(first.profile.roleFamilies,['software']);assert.deepEqual(first.profile.preferences.locations,['Sydney']);
  assert.ok(first.profile.preferences.roleTitles.includes('Software Engineer'));
  assert.equal(first.profile.workRights,'unknown');assert.equal(first.profile.needsSponsorship,'unknown');
  await f.service.saveProfile(user,{name:'Reviewed Name',location:'Melbourne',yearsExperience:9,roleFamilies:['data'],preferences:{locations:['Melbourne'],roleTitles:['Data Engineer']}});
  const second=await f.service.uploadResume(user,{...body,dataBase64:bytes.toString('base64')});
  assert.equal(second.profile.name,'Reviewed Name');assert.equal(second.profile.location,'Melbourne');assert.equal(second.profile.yearsExperience,9);
  assert.deepEqual(second.profile.roleFamilies,['data']);assert.deepEqual(second.profile.preferences.locations,['Melbourne']);assert.deepEqual(second.profile.preferences.roleTitles,['Data Engineer']);
  assert.equal(second.profile.workRights,'unknown');assert.equal(second.profile.needsSponsorship,'unknown');
});

test('five daily upload starts are atomic and pending records have top-level TTL', async () => {
  const f = uploadFixture();
  const result = await Promise.allSettled(Array.from({length: 9}, () => f.service.startUpload(user, body)));
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 5);
  assert.ok(result.filter(r => r.status === 'rejected').every(r => r.reason.code === 'UPLOAD_LIMIT'));
  const uploads = await f.store.list('USER#alice', 'UPLOAD#');
  assert.equal(uploads.length, 5);
  assert.ok(uploads.every(row => row.value.key.startsWith('pending/alice/') && Number.isInteger(row.ttl)));
  assert.equal((await f.store.list('USER#alice', 'UPLOAD_RATE#'))[0].value.count, 5);
});

test('malformed finalization deletes pending bytes, marks invalid and requires a new upload', async () => {
  const f = uploadFixture(), started = await f.service.startUpload(user, body);
  const row = await f.store.get('USER#alice', `UPLOAD#${started.uploadId}`);
  f.objects.set(row.value.key, bytes);
  f.reject(true);
  await assert.rejects(() => f.service.finalizeUpload(user, {uploadId: started.uploadId}), ResumeError);
  assert.equal(f.objects.has(row.value.key), false);
  const invalid = await f.store.get('USER#alice', row.sk);
  assert.equal(invalid.value.status, 'invalid');
  assert.equal(invalid.ttl, row.ttl);
  const extractCount = f.calls.filter(([call]) => call === 'extract').length;
  await assert.rejects(() => f.service.finalizeUpload(user, {uploadId: started.uploadId}), e => e.code === 'INVALID_RESUME');
  assert.equal(f.calls.filter(([call]) => call === 'extract').length, extractCount);
});

test('valid pending bytes become a private validated original; retry is idempotent and live grants fence deletion', async () => {
  const f = uploadFixture(), started = await f.service.startUpload(user, body);
  const row = await f.store.get('USER#alice', `UPLOAD#${started.uploadId}`);
  f.objects.set(row.value.key, bytes);
  const result = await f.service.finalizeUpload(user, {uploadId: started.uploadId});
  const processed = await f.store.get('USER#alice', row.sk);
  assert.equal(processed.value.status, 'processed');
  assert.equal(processed.ttl, row.ttl, 'successful finalization must retain the original top-level expiry');
  assert.equal(f.objects.has(row.value.key), false);
  assert.ok(result.profile.resumeObjectKey.startsWith('users/alice/resumes/'));
  assert.deepEqual(f.objects.get(result.profile.resumeObjectKey), bytes);
  const repeated = await f.service.finalizeUpload(user, {uploadId: started.uploadId});
  assert.equal((await f.store.get('USER#alice', row.sk)).ttl, row.ttl, 'idempotent finalization must retain expiry');
  assert.equal(repeated.profile.resumeObjectKey, result.profile.resumeObjectKey);
  assert.equal(f.calls.filter(([call]) => call === 'put').length, 1);
  await assert.rejects(() => f.service.deleteAccount(user, {confirmation: 'DELETE'}), e => e.code === 'UPLOAD_GRANT_ACTIVE');
  const state = await f.store.get('USER#alice', 'UPLOAD_STATE');
  await f.store.transact([change('USER#alice', 'UPLOAD_STATE', state, {activeGrantUntil: Date.now() - 1})]);
  await f.service.deleteAccount(user, {confirmation: 'DELETE'});
  assert.equal(f.objects.size, 0);
});

async function applicationFixture() {
  const store = new MemoryStore();
  const job = normalizeJob({id: 'one', country: 'AU', title: 'Software Engineer', company: 'Example', location: 'Sydney', roleFamily: 'software', url: 'https://example.test/one', description: 'Build TypeScript and React interfaces and deploy reliable AWS software services. Our Australian technology team documents its delivery and values relevant demonstrated project experience.', skills: ['TypeScript', 'React', 'AWS']}, 'test');
  const profile = {email: user.email, name: 'Alice', resumeText: extracted.text, skills: extracted.skills, roleFamilies: ['software'], location: 'Sydney', workRights: 'unknown', needsSponsorship: 'unknown', clearance: 'unknown', preferences: {}, confirmed: true, consentAt: new Date().toISOString()};
  const entitlement=blankEntitlement();entitlement.starter={key:'cs_starter',purchaseId:'pi_starter',sessionId:'cs_starter',status:'active',everPaid:true,used:0,reserved:0};
  await store.transact([change('USER#alice', 'PROFILE', null, profile),change('USER#alice','ENTITLEMENT',null,entitlement)]);
  let jobs = [job], status = 'ready', calls = 0;
  const service = createService({store, feed: {async status() {return {status};}, async jobs() {return jobs;}}, provider: {available: () => true, async generate() {calls++;return 'Dear hiring team, I am interested in the Software Engineer opportunity. My resume describes TypeScript, React and AWS delivery work. I would welcome a discussion of this relevant demonstrated experience. Kind regards, Alice.';}}});
  await service.decision(user, job.id, {decision: 'interested'});
  return {store, service, job, calls: () => calls, source: (nextStatus, nextJobs) => {status = nextStatus;jobs = nextJobs;}};
}

test('closed source roles remain in Applications with letters, block new generation and preserve idempotent replay', async () => {
  const f = await applicationFixture(), requestKey = randomUUID();
  const generated = await f.service.generate(user, f.job.id, requestKey);
  f.source('ready', []);
  const app = (await f.service.applications(user)).applications[0];
  assert.equal(app.job.availability, 'closed');
  assert.equal(app.letters.length, 1);
  assert.equal(app.job.description, f.job.description);
  assert.equal((await f.store.get('USER#alice', `APP#${f.job.id}`)).value.job.availability, undefined);
  await assert.rejects(() => f.service.generate(user, f.job.id, randomUUID()), e => e.code === 'OPPORTUNITY_CLOSED');
  assert.equal((await f.service.generate(user, f.job.id, requestKey)).generation.id, generated.generation.id);
  assert.equal(f.calls(), 1);
  const changed = await f.service.updateApplication(user, f.job.id, {notes: 'Employer contacted separately.'});
  assert.equal(changed.application.job.availability, 'closed');
  await f.service.editLetter(user, f.job.id, generated.generation.id, {text: generated.generation.letter.text + ' Edited.'});
});

test('source outage makes availability unknown rather than falsely closed', async () => {
  const f = await applicationFixture();
  f.source('stale', []);
  assert.equal((await f.service.applications(user)).applications[0].job.availability, 'unknown');
  const result = await f.service.generate(user, f.job.id, randomUUID());
  assert.equal(result.generation.status, 'succeeded');
  f.source('ready', [f.job]);
  assert.equal((await f.service.applications(user)).applications[0].job.availability, 'available');
});
