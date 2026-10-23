import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchApprovedJobs, plainText} from '../server/feed-sources.mjs';

const now = '2026-10-11T00:00:00.000Z';
const description = 'Build software with TypeScript and React. Maintain Python APIs and deploy AWS services. You will document the application architecture, review code and work with our product team.';
const approved = (provider = 'greenhouse', board = 'example') => ({
  provider, board, company: 'Example Pty Ltd', licenseApproved: true, licenseReference: 'test-only-written-permission',
});
const config = (...sources) => ({sources});
const response = value => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}});
const greenhouse = (extra = {}) => ({id: 1, title: 'Software Engineer', location: {name: 'Sydney, Australia'}, content: description,
  absolute_url: `https://job-boards.greenhouse.io/example/jobs/${extra.id ?? 1}`, ...extra});
const lever = (extra = {}) => ({id: 'one', text: 'Software Engineer', country: 'AU', categories: {location: 'Sydney', commitment: 'Full Time'}, descriptionPlain: description,
  hostedUrl: `https://jobs.lever.co/example/${extra.id ?? 'one'}`, ...extra});
const ashby = (extra = {}) => ({title: 'Software Engineer', isListed: true, location: 'Sydney', descriptionPlain: description,
  jobUrl: 'https://jobs.ashbyhq.com/example/one', workplaceType: 'OnSite', ...extra});
const fetchRows = (source, value, extra = {}) => fetchApprovedJobs(config(source), {fetchImpl: async () => response(value), now, ...extra});

test('licences and registry are validated before any source request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response({jobs: []}); };
  for (const entry of [
    {...approved(), licenseApproved: false}, {...approved(), licenseApproved: 'true'},
    {...approved(), licenseReference: ''}, {...approved(), provider: 'custom'},
    {...approved(), url: 'https://untrusted.test'}, {...approved(), board: '../private'},
    {...approved(), board: 'https://untrusted.test'},
  ]) {
    await assert.rejects(fetchApprovedJobs(config(approved('lever'), entry), {fetchImpl, now}), /Job feed:/);
  }
  assert.equal(calls, 0);
  await assert.rejects(fetchApprovedJobs(config(approved(), approved()), {fetchImpl}), /duplicate source/);
});

test('Greenhouse creates normalized source-specific jobs and leaves unstated eligibility unknown', async () => {
  const {jobs, metadata} = await fetchRows(approved(), {jobs: [greenhouse()], meta: {total: 1}});
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].source, 'greenhouse:example');
  assert.equal(jobs[0].australia, true);
  assert.equal(jobs[0].roleFamily, 'software');
  assert.equal(jobs[0].lastSeenAt, now);
  assert.equal(jobs[0].requirements.citizenship, 'unknown');
  assert.equal(jobs[0].requirements.sponsorship, 'unknown');
  assert.equal(jobs[0].requirements.clearance, 'unknown');
  assert.equal(jobs[0].descriptionComplete, true);
  assert.equal(metadata.complete, true);
  assert.equal(metadata.sources[0].acceptedCount, 1);
});

test('AU locations include secondary locations but never infer AU from remote alone', async () => {
  const rows = [
    ashby({jobUrl: 'https://jobs.ashbyhq.com/example/foreign', location: 'Sydney, Nova Scotia', address: {postalAddress: {addressCountry: 'CAN'}}}),
    ashby({jobUrl: 'https://jobs.ashbyhq.com/example/remote', location: 'Remote', isRemote: true}),
    ashby({jobUrl: 'https://jobs.ashbyhq.com/example/secondary', location: 'London', address: {postalAddress: {addressCountry: 'GBR'}},
      secondaryLocations: [{location: 'Melbourne', address: {addressCountry: 'AUS'}}]}),
    ashby({jobUrl: 'https://jobs.ashbyhq.com/example/unlisted', isListed: false}),
  ];
  const {jobs} = await fetchRows(approved('ashby'), {jobs: rows});
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].location, 'Melbourne');
  assert.equal(jobs[0].workplaceType, 'on-site');
});

test('bare AU cities or Australian qualifiers are accepted without treating foreign namesakes as AU', async () => {
  const accepted = ['Sydney', 'Melbourne, VIC', 'Melbourne, Victoria 3000', 'Perth WA', 'NSW, Sydney',
    'Remote, Australia', 'Sydney, AU', 'AU - Brisbane'];
  const rejected = ['Melbourne, Florida', 'Melbourne Florida', 'Perth, Scotland', 'Perth Scotland',
    'Sydney, Nova Scotia', 'Melbourne, FL', 'Perth, Ontario', 'Remote', 'Worldwide', 'Sydney, unknown region'];
  const {jobs, metadata} = await fetchRows(approved(), {jobs: [...accepted, ...rejected].map((name, index) =>
    greenhouse({id: index + 1, location: {name}}))});
  assert.deepEqual(jobs.map(job => job.location), accepted);
  assert.equal(metadata.excludedCount, rejected.length);
});

test('classifies technical work by title and duties, not employer or department', async () => {
  const rows = [greenhouse({id: 1, title: 'Senior Web Engineer', departments: [{name: 'Marketing'}]}),
    greenhouse({id: 2, title: 'Marketing Manager'}),
    greenhouse({id: 3, title: 'Technical Consultant', content: description}),
    greenhouse({id: 4, title: 'Consultant', content: 'We supply enterprise technology. Manage client contracts and procurement requirements. Coordinate workshops and deliver presentations to business leaders.'})];
  const {jobs} = await fetchRows(approved(), {jobs: rows});
  assert.deepEqual(jobs.map(job => job.title), ['Senior Web Engineer', 'Technical Consultant']);
});

test('extracts only explicit hard constraints with evidence; alternatives and negations remain unknown', async () => {
  const positive = `${description} Australian citizenship is required. We cannot provide visa sponsorship. You must hold an active NV1 security clearance.`;
  const negative = `${description} You do not need Australian citizenship. Australian citizens or permanent residents may apply. No visa sponsorship is required. You must be eligible to obtain NV1 clearance.`;
  const {jobs} = await fetchRows(approved(), {jobs: [greenhouse({content: positive}), greenhouse({id: 2, content: negative})]});
  assert.deepEqual(jobs[0].requirements, {citizenship: 'required', sponsorship: 'unavailable', clearance: 'nv1', minimumYears: null});
  assert.match(jobs[0].requirementEvidence.clearance, /must hold/);
  assert.deepEqual(jobs[1].requirements, {citizenship: 'unknown', sponsorship: 'unknown', clearance: 'unknown', minimumYears: null});
});

test('HTML is converted to plain text and executable/style content is discarded', async () => {
  const content = `&lt;p&gt;${description}&lt;/p&gt;<script>alert('secret')</script><style>hidden {display:none}</style><p title="a > b">AWS &amp; React &#x1f4bb;</p>`;
  const {jobs} = await fetchRows(approved(), {jobs: [greenhouse({content})]});
  assert.doesNotMatch(jobs[0].description, /<|>|alert|secret|display/);
  assert.match(jobs[0].description, /AWS & React/);
  assert.equal(plainText('<script>unclosed malicious text'), '');
  assert.equal(plainText('Use React <Suspense>, Array<T>, C*, and 2 * 3 workers.'),
    'Use React <Suspense>, Array<T>, C*, and 2 * 3 workers.');
});

test('hidden provider HTML cannot create eligibility requirements', async () => {
  const hidden = 'Australian citizenship is required. No visa sponsorship is available. You must hold NV2 security clearance.';
  const concealed = [
    `<div hidden>${hidden}</div>`,
    `<section aria-hidden="true">${hidden}</section>`,
    `<div style="display: none">${hidden}</div>`,
    `<div style="visibility: hidden">${hidden}</div>`,
    ...[
      'display&colon;none', 'display&Tab;:none', 'display&NewLine;:none', 'display&bsol;3a none',
      'display&sol;&ast;&ast;&sol;:none', 'display&#58:none', 'display&#x3a:none', 'd&#105splay:none',
    ].map(style => `<div style="${style}">${hidden}</div>`),
  ];
  const {jobs} = await fetchRows(approved(), {jobs: concealed.map((content, index) =>
    greenhouse({id: index + 1, content: `${description}${content}`}))});
  assert.equal(jobs.length, concealed.length);
  for (const job of jobs) {
    assert.deepEqual(job.requirements, {citizenship: 'unknown', sponsorship: 'unknown', clearance: 'unknown', minimumYears: null});
    assert.deepEqual(job.requirementEvidence, {});
    assert.doesNotMatch(job.description, /citizenship|sponsorship|NV2/i);
  }
});

test('Lever fetches every page, includes lists and rejects incomplete pagination', async () => {
  const calls = [];
  const first = Array.from({length: 100}, (_, id) => lever({id: `job-${id}`}));
  const fetchImpl = async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'error');
    assert.equal(new URL(url).hostname, 'api.lever.co');
    return response(calls.length === 1 ? first : [lever({id: 'last', lists: [{text: 'Requirements', content: '<li>Must be an Australian citizen.</li>'}]})]);
  };
  const {jobs, metadata} = await fetchApprovedJobs(config(approved('lever')), {fetchImpl, now});
  assert.equal(jobs.length, 101);
  assert.match(calls[1], /skip=100/);
  assert.equal(metadata.sources[0].pages, 2);
  assert.equal(jobs[100].requirements.citizenship, 'required');
  await assert.rejects(fetchApprovedJobs({...config(approved('lever')), limits: {pages: 1}}, {fetchImpl: async () => response(first), now}), /pagination limit/);
  await assert.rejects(fetchApprovedJobs(config(approved('lever')), {fetchImpl: async () => response(first), now}), /repeated source job/);
});

test('complete empty and nonmatching boards are legitimate; partial boards fail', async () => {
  for (const provider of ['greenhouse', 'lever', 'ashby']) {
    const result = await fetchRows(approved(provider), provider === 'lever' ? [] : {jobs: []});
    assert.deepEqual(result.jobs, []);
    assert.equal(result.metadata.complete, true);
  }
  const nonmatching = await fetchRows(approved(), {jobs: [greenhouse({title: 'Sales Director'})]});
  assert.equal(nonmatching.jobs.length, 0);
  await assert.rejects(fetchRows(approved(), {jobs: [greenhouse()], meta: {total: 2}}), /incomplete/);
  await assert.rejects(fetchRows(approved('ashby'), {jobs: [], hasMore: true}), /incomplete/);
  await assert.rejects(fetchRows(approved(), {error: 'failed'}), /invalid source response/);
});

test('source IDs remain disjoint across boards and punctuation normalization', async () => {
  const {jobs} = await fetchApprovedJobs(config(approved('greenhouse', 'example.one'), approved('greenhouse', 'example_one')),
    {fetchImpl: async url => response({jobs: [greenhouse({absolute_url:
      `https://job-boards.greenhouse.io/${new URL(url).pathname.split('/')[3]}/jobs/1`})]}), now});
  assert.equal(jobs.length, 2);
  assert.notEqual(jobs[0].id, jobs[1].id);
});

test('original provider URLs including European domains and application queries are preserved', async () => {
  const absolute_url = 'https://job-boards.eu.greenhouse.io/example/jobs/1?gh_src=original';
  const greenhouseResult = await fetchRows(approved(), {jobs: [greenhouse({absolute_url})]});
  assert.equal(greenhouseResult.jobs[0].url, absolute_url);
  const applyUrl = 'https://jobs.eu.lever.co/example/one/apply?source=original';
  const leverResult = await fetchRows(approved('lever'), [lever({hostedUrl: undefined, applyUrl})]);
  assert.equal(leverResult.jobs[0].url, applyUrl);
});

test('custom, mismatched, port or credential-bearing URLs fail instead of inventing links', async () => {
  for (const provider of ['greenhouse', 'lever', 'ashby']) {
    const fixture = provider === 'greenhouse' ? greenhouse : provider === 'lever' ? lever : ashby;
    const field = provider === 'greenhouse' ? 'absolute_url' : provider === 'lever' ? 'hostedUrl' : 'jobUrl';
    const valid = fixture()[field];
    for (const url of [undefined, valid.replace('https:', 'http:'), valid.replace(/https:\/\/[^/]+/, 'https://attacker.test'),
      valid.replace('/example/', '/another/'), valid.replace('https://', 'https://user@'),
      valid.replace('/example/', ':443/example/'), `${valid}/unexpected`]) {
      const row = fixture({[field]: url});
      await assert.rejects(fetchRows(approved(provider), provider === 'lever' ? [row] : {jobs: [row]}), /job URL|missing.*source job/);
    }
  }
});

test('experience hard gates require explicit mandatory minimums and retain supporting text', async () => {
  const cases = [
    ['At least 5 years of professional experience required.', 5],
    ['You must have 3 years of software development experience.', 3],
    ['7+ years of relevant experience is mandatory.', 7],
    ['A minimum of 4 years experience.', 4],
    ['5 years of experience preferred.', null],
    ['Ideally at least 5 years of experience.', null],
    ['A degree or at least 5 years experience is required.', null],
    ['No minimum years of experience is required.', null],
    ['We have 20 years of industry experience.', null],
    ['3-5 years experience is required.', null],
    ['5 years experience and Python certification is required.', null],
    ['At least 2 years experience and at least 5 years professional experience.', 5],
  ];
  const {jobs} = await fetchRows(approved(), {jobs: cases.map(([text], index) =>
    greenhouse({id: index + 1, content: `${description} ${text}`}))});
  assert.deepEqual(jobs.map(job => job.requirements.minimumYears), cases.map(([, years]) => years));
  assert.equal(jobs[0].requirementEvidence.minimumYears, cases[0][0]);
  assert.equal(jobs[4].requirementEvidence.minimumYears, undefined);
});

test('multibyte descriptions and repeated evidence cannot create oversized catalog items', async () => {
  const conditions = 'You must be an Australian citizen and we cannot provide visa sponsorship and you must hold an active NV1 security clearance and at least 5 years of professional experience';
  const accepted = `${'界'.repeat(9000)}${'😀'.repeat(200)} ${conditions} ${'界'.repeat(9000)} TypeScript React`;
  const oversized = `${conditions} ${'界'.repeat(29000)}`;
  const {jobs, metadata} = await fetchRows(approved(), {jobs: [greenhouse({content: accepted}), greenhouse({id: 2, content: oversized})]});
  assert.equal(jobs.length, 1);
  assert.equal(metadata.complete, true);
  assert.equal(metadata.excludedCount, 1);
  assert.equal(metadata.sources[0].excludedCount, 1);
  assert.equal(jobs[0].description, accepted);
  assert.ok(Buffer.byteLength(jobs[0].description) <= 60000);
  assert.ok(Buffer.byteLength(JSON.stringify(jobs[0])) <= 90000);
  const evidence = jobs[0].requirementEvidence;
  assert.equal(Object.keys(evidence).length, 4);
  for (const snippet of Object.values(evidence)) {
    assert.ok(Buffer.byteLength(snippet) <= 1200);
    assert.ok(accepted.includes(snippet));
    assert.ok(snippet.isWellFormed());
    assert.doesNotMatch(snippet, /\uFFFD/);
  }
  assert.match(evidence.citizenship, /must be an Australian citizen/);
  assert.match(evidence.sponsorship, /cannot provide visa sponsorship/);
  assert.match(evidence.clearance, /must hold an active NV1 security clearance/);
  assert.match(evidence.minimumYears, /at least 5 years of professional experience/);
});

test('bounds bytes, record count, format and timeout; any failure rejects the complete refresh', async () => {
  await assert.rejects(fetchApprovedJobs({...config(approved()), limits: {responseBytes: 20}},
    {fetchImpl: async () => response({jobs: [greenhouse()]}), now}), /too large/);
  await assert.rejects(fetchApprovedJobs({...config(approved()), limits: {records: 1}},
    {fetchImpl: async () => response({jobs: [greenhouse(), greenhouse({id: 2})]}), now}), /record limit/);
  await assert.rejects(fetchApprovedJobs(config(approved()), {fetchImpl: async () => new Response('<html>blocked</html>'), now}), /JSON/);
  await assert.rejects(fetchApprovedJobs({...config(approved()), limits: {requestTimeoutMs: 5}},
    {fetchImpl: async () => new Promise(() => {}), now}), /timed out/);
  let count = 0;
  await assert.rejects(fetchApprovedJobs(config(approved(), approved('ashby')), {fetchImpl: async () =>
    ++count === 1 ? response({jobs: [greenhouse()]}) : new Response('unavailable', {status: 503}), now}), /source request failed/);
});
