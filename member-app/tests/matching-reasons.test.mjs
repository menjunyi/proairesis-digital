import test from 'node:test';
import assert from 'node:assert/strict';
import {assess, assessWithReasons, hasSkill, normalizeJob} from '../server/matching.mjs';
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

test('matching evidence removes source presentation markup without changing job facts or technology syntax', () => {
  const raw = [
    '# **Software Engineer**',
    '* Build TypeScript systems with C*',
    '* Build React <Suspense> interfaces with Array<T>; keep 2 * 3 * 4, 2 ** 3 ** 4, 2*3*4, foo*bar*baz, and src/*/index*/file as literal examples.',
    '- Deploy [AWS](https://aws.amazon.com/) services for Australian customers.',
    '<p>Use <strong>Git</strong> and _JavaScript_ in an established engineering workflow.</p>',
    '**Maintain Node.js systems with accessible documentation and reliable automated tests.**',
    '> **Build Azure &amp; Git services.**',
    '<img src=x onerror=alert(1)>',
    '<sCrIpT>alert("x"); const AWS=true;</sCrIpT>',
    '&lt;script&gt;const GCP=true;&lt;/script&gt;',
  ].join('\n');
  const vacancy = normalizeJob({
    id: 'formatted-evidence', title: 'Software Engineer', company: 'Example', country: 'AU',
    roleFamily: 'software', location: 'Perth', url: 'https://example.org/jobs/formatted-evidence',
    workplaceType: 'hybrid', employmentType: 'full-time', seniority: 'mid', description: raw,
  }, 'test', '2026-10-23T00:00:00Z');
  const person = {...profile, resumeText: 'TypeScript React AWS Azure Git JavaScript Node.js'};
  const result = assessWithReasons(person, vacancy);
  const excerpts = result.matches.map(item => item.jobEvidence);
  assert.equal(result.highFit, true);
  assert.equal(result.job.description, raw);
  assert.ok(excerpts.includes('Build TypeScript systems with C*'));
  assert.ok(excerpts.includes('Build React <Suspense> interfaces with Array<T>; keep 2 * 3 * 4, 2 ** 3 ** 4, 2*3*4, foo*bar*baz, and src/*/index*/file as literal examples.'));
  assert.ok(excerpts.includes('Deploy AWS services for Australian customers.'));
  assert.ok(excerpts.includes('Use Git and JavaScript in an established engineering workflow.'));
  assert.ok(excerpts.includes('Maintain Node.js systems with accessible documentation and reliable automated tests.'));
  assert.ok(excerpts.includes('Build Azure & Git services.'));
  assert.ok(excerpts.every(value => !/^(?:#{1,6}|[-+*•]|\d{1,3}[.)])\s/.test(value)));
  assert.ok(excerpts.every(value => !/<\/?(?:p|strong|a|img|script)(?:\s[^>]*)?>/i.test(value)));
  assert.ok(excerpts.every(value => !/onerror|alert\(|const AWS=true|const GCP=true/.test(value)));
});

test('matching preserves ambiguous technical markers instead of treating them as prose formatting', () => {
  const raw = [
    'Use Python *args parameters.',
    'Use AWS with C* tooling.',
    'Use React _private methods with snake_.',
    'Use Node.js __name__ through __dunder__ APIs.',
    'Use JavaScript methods ending with snake_.',
    'Use Ruby exponentiation 2**3**4 in tests.',
    'Use _emphasis_ in prose and *TypeScript and Git* in production systems.',
  ].join('\n');
  const vacancy = normalizeJob({
    id: 'technical-markers', title: 'Software Engineer', company: 'Example', country: 'AU',
    roleFamily: 'software', location: 'Perth', url: 'https://example.org/jobs/technical-markers',
    workplaceType: 'hybrid', employmentType: 'full-time', seniority: 'mid', description: raw,
  }, 'test', '2026-10-23T00:00:00Z');
  const result = assessWithReasons({...profile, resumeText: 'Python JavaScript TypeScript AWS React Git Node.js Ruby'}, vacancy);
  const excerpts = result.matches.map(item => item.jobEvidence);
  assert.ok(excerpts.includes('Use Python *args parameters.'));
  assert.ok(excerpts.includes('Use AWS with C* tooling.'));
  assert.ok(excerpts.includes('Use React _private methods with snake_.'));
  assert.ok(excerpts.includes('Use Node.js __name__ through __dunder__ APIs.'));
  assert.ok(excerpts.includes('Use JavaScript methods ending with snake_.'));
  assert.ok(excerpts.includes('Use Ruby exponentiation 2**3**4 in tests.'));
  assert.ok(excerpts.includes('Use emphasis in prose and TypeScript and Git in production systems.'));
});

test('matching strips copied HTML at any depth while preserving component and generic syntax', () => {
  const raw = [
    '<P><STRONG>Use React</STRONG><script>ignored()</script>AWS.</P>',
    '<p>Build Docker.</p><p>Build Kubernetes systems.</p>',
    '<p title="a > b">Use SQL in production.</p>',
    '<p>Use Terraform for infrastructure.',
    `${'<div>'.repeat(10)}Use Git for delivery.${'</div>'.repeat(10)}`,
    '<table><tbody><tr><td><i>Use Azure</i> &ndash; <code>GCP</code>&hellip;</td></tr></tbody></table>',
    'Use Next.js <Script>, <Svg>, and <Suspense> components with JavaScript in production.',
    'Use TypeScript with <Header>, Array<T>, Array<string>, Promise<void>, Record<string, object>, List<int>, f<T extends React.Component>, Map<string, Array<number>>, Dictionary<string, List<int>>, Promise<Result<User>>, and Foo<T = string> components.',
  ].join('\n');
  const vacancy = normalizeJob({
    id: 'copied-html', title: 'Software Engineer', company: 'Example', country: 'AU',
    roleFamily: 'software', location: 'Perth', url: 'https://example.org/jobs/copied-html',
    workplaceType: 'hybrid', employmentType: 'full-time', seniority: 'mid', description: raw,
  }, 'test', '2026-10-23T00:00:00Z');
  const person = {...profile, resumeText: 'React AWS Docker Kubernetes SQL Terraform Git Azure GCP JavaScript TypeScript'};
  const result = assessWithReasons(person, vacancy);
  const excerpts = result.matches.map(item => item.jobEvidence);
  assert.equal(result.highFit, true);
  assert.ok(excerpts.includes('Use React AWS.'));
  assert.ok(excerpts.includes('Build Docker.'));
  assert.ok(excerpts.includes('Build Kubernetes systems.'));
  assert.ok(excerpts.includes('Use SQL in production.'));
  assert.ok(excerpts.includes('Use Terraform for infrastructure.'));
  assert.ok(excerpts.includes('Use Git for delivery.'));
  assert.ok(excerpts.includes('Use Azure – GCP…'));
  assert.ok(excerpts.includes('Use Next.js <Script>, <Svg>, and <Suspense> components with JavaScript in production.'));
  assert.ok(excerpts.includes('Use TypeScript with <Header>, Array<T>, Array<string>, Promise<void>, Record<string, object>, List<int>, f<T extends React.Component>, Map<string, Array<number>>, Dictionary<string, List<int>>, Promise<Result<User>>, and Foo<T = string> components.'));
  assert.ok(excerpts.every(value=>!/<\/?(?:p|strong|div)(?:\s[^>]*)?>/i.test(value)));
});

test('matching cleans formatted requirement evidence before showing a hard-gate reason', () => {
  const vacancy = {
    ...job,
    requirements: {...job.requirements, citizenship: 'required'},
    requirementEvidence: {citizenship: '**You must be an Australian citizen.**'},
  };
  const result = assessWithReasons({...profile, workRights: 'visa'}, vacancy);
  assert.equal(result.highFit, false);
  assert.equal(result.gaps[0].jobEvidence, 'You must be an Australian citizen.');
  assert.equal(vacancy.requirementEvidence.citizenship, '**You must be an Australian citizen.**');
});

test('conditional clearance and experience evidence cannot become candidate hard gates', () => {
  const clearance = assessWithReasons({...profile,clearance:'baseline'}, {
    ...job,requirements:{...job.requirements,clearance:'nv2'},
    requirementEvidence:{clearance:'You must hold NV2 security clearance if assigned to the government project.'},
  });
  assert.equal(clearance.highFit, true);
  assert.ok(!clearance.gaps.some(item=>/clearance recorded/i.test(item.text)));
  const experience = assessWithReasons({...profile,yearsExperience:2}, {
    ...job,requirements:{...job.requirements,minimumYears:5},
    requirementEvidence:{minimumYears:'At least 5 years of professional experience is required if assigned to the lead project.'},
  });
  assert.equal(experience.highFit, true);
  assert.ok(!experience.gaps.some(item=>/experience requirement exceeds/i.test(item.text)));
});

test('matching formats Markdown tables and ignores fence labels as evidence', () => {
  const tableJob = {
    ...job,
    description: 'Skills\n| Skill | Usage |\n| --- | --- |\n| AWS | Cloud |\n| Node.js | Services |\nTypeScript supports reliable testing, documentation, deployment, and maintainable production delivery.',
    skills: ['AWS','Node.js','TypeScript'],
  };
  const tableResult = assessWithReasons({...profile,resumeText:'AWS Node.js TypeScript'}, tableJob);
  assert.equal(tableResult.highFit, true);
  assert.equal(tableResult.matches.find(item=>item.text.startsWith('AWS ')).jobEvidence, 'AWS — Cloud');
  assert.equal(tableResult.matches.find(item=>item.text.startsWith('Node.js ')).jobEvidence, 'Node.js — Services');

  const fenced = assessWithReasons(profile, {
    ...job,
    description: '```React\nexample only\n```\nTypeScript and AWS support reliable testing, documentation, deployment, and maintainable production delivery for Australian customers.',
    skills: ['React','TypeScript','AWS'],
  });
  assert.equal(fenced.highFit, true);
  assert.ok(!fenced.matches.some(item=>item.text.startsWith('React ')));
  assert.ok(fenced.matches.every(item=>!item.jobEvidence.includes('```')));
});

test('hidden source content cannot supply hard gates or pad a sparse description', () => {
  const hidden = '<sCrIpT>Australian citizenship is required. No visa sponsorship is available. Must have NV2 security clearance.</sCrIpT>';
  const stale = {
    ...job,
    description: `${hidden}\n${description}`,
    requirements: {...job.requirements, citizenship: 'required'},
    requirementEvidence: {citizenship: hidden},
  };
  const result = assessWithReasons({...profile, workRights: 'visa'}, stale);
  assert.equal(result.highFit, true);
  assert.ok(!result.gaps.some(item=>/citizen/i.test(item.text)));
  assert.equal(result.job.description, stale.description);

  for(const sparse of [
    {...job,description:`<script>${'x'.repeat(200)}</script> React AWS`,skills:['React','AWS']},
    {...job,description:`${'<div></div>'.repeat(70)} React AWS`,skills:['React','AWS']},
    {...job,description:`<SCRIPT>React TypeScript AWS ${'x'.repeat(200)}`,skills:['React','TypeScript','AWS']},
    {...job,description:`React AWS [apply](https://example.test/(x)/${'x'.repeat(220)})`,skills:['React','AWS']},
  ]){
    const rejected = assessWithReasons(profile, sparse);
    assert.equal(rejected.highFit, false);
    assert.match(rejected.reason, /too short/);
    assert.equal(rejected.job.description, sparse.description);
  }

  const linkSkills = {
    ...job,
    description: `${'The role involves planning, communication, documentation, stakeholder coordination, and reliable delivery practices. '.repeat(2)}[apply](https://example.test/(x)/React/AWS)`,
    skills: ['React','AWS'],
  };
  const linkRejected = assessWithReasons(profile, linkSkills);
  assert.equal(linkRejected.highFit, false);
  assert.match(linkRejected.reason, /too little recognized skill evidence/);
  assert.equal(linkRejected.job.description, linkSkills.description);

  const visibleSkill = {
    ...job,
    description: '[Apply now](https://example.test/React). Later, engineers use React to build accessible interfaces. TypeScript and AWS support reliable delivery, testing, documentation, and maintainable production systems.',
    skills: ['React','TypeScript','AWS'],
  };
  const accepted = assessWithReasons(profile, visibleSkill);
  assert.equal(accepted.highFit, true);
  assert.equal(accepted.matches.find(item=>item.text.startsWith('React ')).jobEvidence, 'Later, engineers use React to build accessible interfaces.');

  for (const raw of [
    '[Apply](https://example.test/React/AWS) Later, engineers use React and AWS with TypeScript to build accessible, reliable, documented production interfaces.',
    'Learn[more](https://example.test/React/AWS) Later, engineers use React and AWS with TypeScript to build accessible, reliable, documented production interfaces.',
    'See[apply](/React/AWS) Later, engineers use React and AWS with TypeScript to build accessible, reliable, documented production interfaces.',
  ]) {
    const linked = assessWithReasons(profile, {...job,description:raw,skills:['React','AWS','TypeScript']});
    assert.equal(linked.highFit, true);
    assert.ok(linked.matches.every(item=>!item.jobEvidence.includes('example.test')&&!item.jobEvidence.includes('/React/AWS')));
  }

  const concealedSkills = {
    ...job,
    description: `${'The role involves planning, communication, documentation, stakeholder coordination, and reliable delivery practices. '.repeat(2)}\n<Hidden data-a="React" data-b="AWS"></Hidden>\n<template>React AWS</template>\n<div hidden>React AWS</div>\n[candidate]: https://example.test/React/AWS`,
    skills: ['React','AWS'],
  };
  const concealedRejected = assessWithReasons(profile, concealedSkills);
  assert.equal(concealedRejected.highFit, false);
  assert.match(concealedRejected.reason, /too little recognized skill evidence/);

  const componentOnlySkills = {
    ...job,
    description: `${'The role involves planning, communication, documentation, stakeholder coordination, and reliable delivery practices. '.repeat(2)}<React> <AWS>`,
    skills: ['React','AWS'],
  };
  const componentOnlyRejected = assessWithReasons(profile, componentOnlySkills);
  assert.equal(componentOnlyRejected.highFit, false);
  assert.match(componentOnlyRejected.reason, /too little recognized skill evidence/);

  let bareUrlSkills;
  for (const destination of [
    'https://example.test/guides/React/AWS',
    'www.example.test/guides/React/AWS',
    'example.test/guides/React/AWS',
    'ftp://example.test/React/AWS',
    'mailto:React@AWS.test',
  ]) {
    bareUrlSkills = {
      ...job,
      description: `${'The role involves planning, communication, documentation, stakeholder coordination, and reliable delivery practices. '.repeat(2)}Read ${destination} for company information.`,
      skills: ['React','AWS'],
    };
    const bareUrlRejected = assessWithReasons(profile, bareUrlSkills);
    assert.equal(bareUrlRejected.highFit, false, destination);
    assert.match(bareUrlRejected.reason, /too little recognized skill evidence/, destination);
  }

  const normalizedBareUrl = normalizeJob({
    id: 'url-only-skills', title: 'Coordinator', company: 'Example', country: 'AU', roleFamily: 'software',
    location: 'Sydney', url: 'https://example.test/jobs/url-only-skills', description: bareUrlSkills.description,
  }, 'test');
  assert.deepEqual(normalizedBareUrl.skills, []);

  const ambiguousWords = normalizeJob({
    id: 'ambiguous-words', title: 'Coordinator', company: 'Example', country: 'AU', roleFamily: 'software',
    location: 'Sydney', url: 'https://example.test/jobs/ambiguous-words',
    description: 'You will go above and beyond for customers and excel at communication, planning, documentation, stakeholder coordination, and reliable delivery practices.'.repeat(2),
  }, 'test');
  assert.deepEqual(ambiguousWords.skills, []);
  const ambiguousRejected = assessWithReasons({...profile,resumeText:'Go Excel'}, {...ambiguousWords,skills:['Go','Excel']});
  assert.equal(ambiguousRejected.highFit, false);

  for (const prose of [
    'Design angular shapes for reports and work in an agile way with clear communication and reliable delivery practices.',
    'Enjoy java coffee while using scrum to coordinate ordinary office tasks, documentation, and communication.',
    'Use a ruby colour palette and an agile response for customer communication and general planning.',
    'Work with the rest of the team in an agile way through planning, communication, and documentation.',
  ]) {
    const ordinary = normalizeJob({id: prose, title: 'Coordinator', company: 'Example', country: 'AU', roleFamily: 'software', location: 'Sydney', url: `https://example.test/jobs/${Buffer.from(prose).toString('hex').slice(0,40)}`, description: prose.repeat(2)}, 'test');
    assert.ok(ordinary.skills.length < 2, `${prose}: ${ordinary.skills.join(',')}`);
  }

  for (const spelling of ['REACT','SWIFT','RUST','EXCEL','GO','REST','JAVA','RUBY','ANGULAR','AGILE','SCRUM']) {
    assert.equal(hasSkill(`Production experience with ${spelling} services.`, spelling === 'GO' ? 'Go' : spelling[0] + spelling.slice(1).toLowerCase()), true, spelling);
  }

  const encodedCode = {
    ...job,
    description: '<code>&lt;script&gt;</code> Build React interfaces for accessible products. TypeScript and AWS support reliable delivery, testing, documentation, and maintainable production systems.',
    skills: ['React','TypeScript','AWS'],
  };
  assert.equal(assessWithReasons(profile, encodedCode).highFit, true);

  const technicalCode = {
    ...job,
    description: 'Security work includes safely escaping `<script>` strings in JavaScript. Build React interfaces and deploy AWS services with TypeScript using Array<string>, Promise<void>, Record<string, object>, List<int>, f<T extends Foo>, and arr[0](value) in maintainable production systems.',
    skills: ['JavaScript','React','AWS','TypeScript'],
  };
  const technicalResult = assessWithReasons({...profile,resumeText:`${profile.resumeText} JavaScript`}, technicalCode);
  assert.equal(technicalResult.highFit, true);
  assert.ok(technicalResult.matches.some(item=>item.jobEvidence.includes('<script>')));
  assert.ok(technicalResult.matches.some(item=>item.jobEvidence.includes('Array<string>')));

  const formattedMarkers = {
    ...job,
    description: '> > * [x] ***React*** enables accessible interfaces. ___TypeScript___ and AWS support reliable delivery, testing, documentation, and maintainable production systems.',
    skills: ['React','TypeScript','AWS'],
  };
  const markerResult = assessWithReasons(profile, formattedMarkers);
  assert.equal(markerResult.highFit, true);
  assert.ok(markerResult.matches.some(item=>item.jobEvidence === 'React enables accessible interfaces.'));
  assert.ok(markerResult.matches.some(item=>item.jobEvidence.startsWith('TypeScript and AWS')));

  const afterVoid = {
    ...job,
    description: '<img hidden src=x><input hidden><embed src=x> Build React interfaces for accessible products. TypeScript and AWS support reliable delivery, testing, documentation, and maintainable production systems.',
    skills: ['React','TypeScript','AWS'],
  };
  assert.equal(assessWithReasons(profile, afterVoid).highFit, true);

  const resumeWithCode = {
    ...profile,
    resumeText: 'Reviewed a literal <script> example. Built TypeScript and React interfaces. Deployed AWS services.',
  };
  const resumeResult = assessWithReasons(resumeWithCode, job);
  assert.equal(resumeResult.highFit, true);
  assert.equal(resumeResult.matches.length, 3);

  const recognized = ['JavaScript','TypeScript','Python','Java','C#','C++','React','Angular','Vue','Node.js','SQL','PostgreSQL','MySQL','AWS','Azure','GCP','Docker','Kubernetes','Terraform','Linux','Git','CI/CD','REST','GraphQL','HTML','CSS','Figma','Power BI','Tableau','Excel','Agile','Scrum','Selenium','Playwright','Cypress','Jest','Go','Rust','Ruby','PHP'];
  const longMalformed = {...job,description:`${'['.repeat(29000)} ${recognized.join(' ')}`,skills:recognized};
  const started=performance.now();
  assessWithReasons({...profile,resumeText:recognized.join(' ')},longMalformed);
  assert.ok(performance.now()-started<500,'malformed Markdown must remain linear-time');

  const malformedTags = {...job,description:`${'<div title="'.repeat(1580)} ${recognized.join(' ')} ${'reliable engineering delivery documentation '.repeat(5)}`,skills:recognized};
  const tagStarted=performance.now();
  assessWithReasons({...profile,resumeText:recognized.join(' ')},malformedTags);
  assert.ok(performance.now()-tagStarted<500,'malformed quoted tags must remain bounded and sanitize only once per assessment');

  const referenceMalformed = {...job,description:`[id]: https://example.test\n${'['.repeat(28000)} ${recognized.join(' ')}`,skills:recognized};
  const referenceStarted=performance.now();
  assessWithReasons({...profile,resumeText:recognized.join(' ')},referenceMalformed);
  assert.ok(performance.now()-referenceStarted<500,'reference use parsing must remain bounded when a definition exists');
});

test('browser-decoded hidden styles cannot supply skills or eligibility gates', () => {
  const styles = [
    'display&colon;none',
    'display&Tab;:none',
    'display&NewLine;:none',
    'display&bsol;3a none',
    'display&sol;&ast;&ast;&sol;:none',
    'display&#58:none',
    'display&#x3a:none',
    'd&#105splay:none',
  ];
  for (const style of styles) {
    const hidden = `<div style="${style}">You must be an Australian citizen. No visa sponsorship is available. You must hold NV2 security clearance. At least 12 years of professional experience is required. Python is required.</div>`;
    const vacancy = {
      ...job,
      description: `${hidden}\n${description}`,
      skills: [...job.skills, 'Python'],
      requirements: {citizenship: 'required', sponsorship: 'unavailable', clearance: 'nv2', minimumYears: 12},
      requirementEvidence: {citizenship: hidden, sponsorship: hidden, clearance: hidden, minimumYears: hidden},
    };
    const result = assessWithReasons({
      ...profile,
      workRights: 'visa',
      needsSponsorship: 'yes',
      clearance: 'baseline',
      yearsExperience: 5,
    }, vacancy);
    assert.equal(result.highFit, true, style);
    assert.equal(result.reason, null, style);
    assert.ok(!result.matches.some(item => item.text.startsWith('Python ')), style);
    assert.ok(!result.gaps.some(item => /citizen|sponsor|clearance|12 years/i.test(`${item.text} ${item.jobEvidence}`)), style);
  }
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
