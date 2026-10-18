import test from 'node:test';
import assert from 'node:assert/strict';
import {assess, assessWithReasons, normalizeJob} from '../server/matching.mjs';
import {normalizeImportedJob} from '../server/imported-jobs.mjs';
import {MemoryStore, change} from '../server/store.mjs';
import {createService} from '../server/service.mjs';

const description = 'Build TypeScript and React interfaces for our software platform. Deploy reliable services using AWS and document the delivery process with the engineering team. Work with product colleagues to improve accessibility, testing and maintainability across our applications.';
const job = normalizeJob({id: 'one', title: 'Software Engineer', company: 'Example', country: 'AU',
  roleFamily: 'software', location: 'Sydney', url: 'https://example.org/jobs/one',
  workplaceType: 'hybrid', employmentType: 'full-time', seniority: 'mid', description,
}, 'test', '2026-10-12T00:00:00Z');
const profile = {resumeText: 'Built TypeScript and React interfaces. Deployed AWS services.',
  roleFamilies: ['software'], yearsExperience: 5, workRights: 'citizen',
  needsSponsorship: 'no', clearance: 'baseline', preferences: {}};

test('accepted assessments retain the original matching result with additive acceptance fields', () => {
  const expected = assess(profile, job);
  const {highFit, reason, ...actual} = assessWithReasons(profile, job);
  assert.equal(highFit, true);
  assert.equal(reason, null);
  assert.deepEqual(actual, expected);
});

test('hard conflicts return a concrete rejection without inventing a fit score', () => {
  const scenarios = [
    [{...profile, roleFamilies: ['data']}, job, /role family/i],
    [{...profile, workRights: 'visa'}, {...job, requirements: {...job.requirements, citizenship: 'required'}}, /citizenship/],
    [{...profile, needsSponsorship: 'yes'}, {...job, requirements: {...job.requirements, sponsorship: 'unavailable'}}, /sponsorship/],
    [profile, {...job, requirements: {...job.requirements, clearance: 'nv2'}}, /clearance/],
    [{...profile, preferences: {locationsRequired: true, locations: ['Melbourne']}}, job, /location/],
    [{...profile, preferences: {locationsRequired: true, locations: ['Melbourne', '  ']}}, job, /location/],
    [{...profile, preferences: {workplaceRequired: true, workplaceTypes: ['remote']}}, job, /workplace/i],
    [{...profile, preferences: {minimumSalaryRequired: true, minimumSalary: 150000, salaryPeriod: 'year'}}, {...job, salaryMax: 100000, salaryPeriod: 'year'}, /salary/],
    [profile, {...job, requirements: {...job.requirements, minimumYears: 10}}, /experience/],
    [{...profile, yearsExperience: 1}, {...job, seniority: 'senior'}, /matching rule/],
    [profile, {...job, expiresAt: '2000-01-01T00:00:00Z'}, /expired/],
    [profile, {...job, australia: false}, /Australian/],
  ];
  for (const [person, vacancy, reason] of scenarios) {
    assert.equal(assess(person, vacancy), null);
    const result = assessWithReasons(person, vacancy);
    assert.equal(result.highFit, false);
    assert.equal(result.label, 'Not shortlisted');
    assert.equal(result.score, null);
    assert.match(result.reason, reason);
    assert.ok(Array.isArray(result.matches));
    assert.ok(Array.isArray(result.gaps));
    assert.ok(Array.isArray(result.needsConfirmation));
  }
});

test('a required local area can also admit Australia-wide remote roles when the user opts in', () => {
  const person = {
    ...profile,
    preferences: {
      locationsRequired: true,
      locations: ['Melbourne'],
      includeRemote: true,
    },
  };
  const remote = {...job, location: 'Australia', workplaceType: 'remote'};
  const onsite = {...job, location: 'Sydney', workplaceType: 'on-site'};
  assert.ok(assess(person, remote));
  assert.equal(assess(person, onsite), null);
});

test('sparse descriptions and weak resume evidence are distinguished without claiming inability', () => {
  const sparse = {...job, description: 'A team member will work on documentation and communicate with colleagues. '.repeat(4), skills: []};
  assert.equal(assess(profile, sparse), null);
  assert.match(assessWithReasons(profile, sparse).reason, /too little recognized skill evidence/);
  const result = assessWithReasons({...profile, resumeText: 'Experienced in customer service and scheduling.'}, job);
  assert.equal(result.highFit, false);
  assert.equal(result.score, null);
  assert.match(result.reason, /does not mean you lack those skills/);
  assert.equal(result.gaps.length, 3);
  assert.ok(result.gaps.every(gap => /not evidenced/.test(gap.text) && description.includes(gap.jobEvidence)));
});

test('preference-only rejection returns the calculated below-threshold score', () => {
  const vacancy = {...job, skills: ['TypeScript', 'React', 'AWS', 'SQL', 'Python'], description: `${description} Use SQL and Python for data processing.`};
  const person = {...profile, preferences: {locations: ['Perth'], roleTitles: ['Architect'], workplaceTypes: ['remote'], employmentTypes: ['contract'], seniority: ['lead']}};
  assert.equal(assess(person, vacancy), null);
  const result = assessWithReasons(person, vacancy);
  assert.equal(result.highFit, false);
  assert.equal(result.score, 61);
  assert.match(result.reason, /preferences/);
});

test('unknown eligibility remains a question and does not become a confirmed rejection', () => {
  const vacancy = {...job, requirements: {...job.requirements, citizenship: 'required', clearance: 'nv2', minimumYears: 10}};
  const person = {...profile, workRights: 'unknown', clearance: 'unknown', yearsExperience: null};
  const result = assessWithReasons(person, vacancy);
  assert.ok(assess(person, vacancy));
  assert.equal(result.highFit, true);
  assert.equal(result.label, 'Needs confirmation');
  assert.ok(result.needsConfirmation.some(item => /citizenship/.test(item.text)));
  assert.ok(result.needsConfirmation.some(item => /10 years/.test(item.text)));
});

test('imported assessments disclose unverified availability and cite explicit rejection evidence', () => {
  const imported = normalizeImportedJob({title: 'Software Engineer', company: 'Example', url: 'https://www.seek.com.au/job/1234',
    location: 'Sydney', description: `${description}\nYou must be an Australian citizen.`, roleFamily: 'software',
    australiaConfirmed: true, permissionConfirmed: true});
  const rejected = assessWithReasons({...profile, workRights: 'visa'}, imported);
  assert.equal(rejected.highFit, false);
  assert.equal(rejected.gaps[0].jobEvidence, 'You must be an Australian citizen.');
  assert.ok(rejected.needsConfirmation.some(item => /not fetched or verified/.test(item.jobEvidence)));
  const accepted = assessWithReasons(profile, imported);
  assert.equal(accepted.highFit, true);
  assert.equal(accepted.label, 'Needs confirmation');
  assert.equal(accepted.job.availability, 'unknown');
  assert.ok(accepted.needsConfirmation.some(item => /still open/.test(item.text)));
});

test('assessment does not mutate volunteered profile or job facts', () => {
  const person = structuredClone(profile), vacancy = structuredClone(job);
  const before = JSON.stringify({person, vacancy});
  assessWithReasons(person, vacancy);
  assert.equal(JSON.stringify({person, vacancy}), before);
});

test('import and saved shortlist assessments retain the same single unverified-source warning', async () => {
  const user = {sub: 'synthetic-matching', email: 'matching@example.test'}, store = new MemoryStore();
  await store.transact([change(`USER#${user.sub}`, 'PROFILE', null, {
    ...profile, confirmed: true, preferences: {seniority: ['mid']},
  })]);
  const service = createService({store, feed: {status: async () => ({status: 'not-configured'}), jobs: async () => []}});
  const imported = await service.importOpportunity(user, {
    title: 'Software Engineer', company: 'Example', url: 'https://www.seek.com.au/job/1234',
    location: 'Sydney', description, roleFamily: 'software', seniority: 'mid-level',
    australiaConfirmed: true, permissionConfirmed: true,
  });
  assert.equal(imported.accepted, true);
  const saved = (await service.opportunities(user)).opportunities[0];
  assert.deepEqual(saved.needsConfirmation, imported.assessment.needsConfirmation);
  assert.equal(saved.needsConfirmation.filter(item => /still open/.test(item.text)).length, 1);
  assert.equal(saved.label, 'Needs confirmation');
  assert.equal(saved.gaps.some(item => /seniority/.test(item.text)), false);
  assert.equal(saved.score, imported.assessment.score);
  await service.decision(user, saved.job.id, {decision: 'interested'});
  const application = (await service.applications(user)).applications[0];
  assert.deepEqual(application.match.needsConfirmation, saved.needsConfirmation);
});

test('equivalent seniority labels match in either direction without changing supplied evidence', () => {
  for (const [preferred, advertised] of [
    ['mid', 'mid-level'], ['mid-level', 'mid'], ['MID', 'Mid Level'], ['mid', 'mid_level'],
    ['mid', 'mid–level'], ['junior', 'Junior-level'], ['senior-level', 'SENIOR'],
  ]) {
    const person = {...profile, preferences: {seniority: [preferred]}}, vacancy = {...job, seniority: advertised};
    const result = assess(person, vacancy);
    assert.ok(result);
    assert.equal(result.gaps.some(item => /seniority/.test(item.text)), false, `${preferred} equals ${advertised}`);
    assert.equal(result.score, assess({...profile, preferences: {}}, vacancy).score);
    assert.equal(result.job.seniority, advertised);
  }
  const mismatch = assess({...profile, preferences: {seniority: ['mid']}}, {...job, seniority: 'senior'});
  assert.ok(mismatch.gaps.some(item => /seniority/.test(item.text)));
  const unknown = assess({...profile, preferences: {seniority: ['mid']}}, {...job, seniority: ' Unknown '});
  assert.equal(unknown.gaps.some(item => /seniority/.test(item.text)), false);
  assert.equal(assess({...profile, yearsExperience: 1}, {...job, seniority: 'Senior-level'}), null);
});
