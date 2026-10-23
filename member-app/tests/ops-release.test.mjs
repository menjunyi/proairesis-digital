import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { browserAwsProfile, browserTarget, browserProgram, completeSignedInInterview } from '../scripts/smoke-browser.mjs';
import { releaseSourceRevision } from '../scripts/prepare-release.mjs';
import { hashDirectory, isProtectedReleaseVersion, protectedReleaseVersion, requireSafeStatefulChanges, rollbackHasSkippedResources, unsafeStatefulChanges, updateReadyStackStatus } from '../scripts/release-safety.mjs';
import { workQueueUrl } from '../server/handler.mjs';

test('production change-set safety rejects removal or possible replacement of retained state', () => {
  const unsafe = [
    { logicalResourceId: 'Table', action: 'Remove' },
    { logicalResourceId: 'UserPool', action: 'Modify', replacement: 'True' },
    { logicalResourceId: 'SiteBucket', action: 'Modify', replacement: 'Conditional' },
    { logicalResourceId: 'ResumeBucket', action: 'Modify' },
    { logicalResourceId: 'GenerationQueue', action: 'Remove', replacement: 'False' },
    { logicalResourceId: 'RecommendationQueue', action: 'Modify', replacement: 'True' },
    { logicalResourceId: 'FailedWork', action: 'Modify', replacement: 'Conditional' },
    { logicalResourceId: 'ApiOriginSecret', action: 'Modify' },
  ];
  assert.deepEqual(unsafeStatefulChanges(unsafe), unsafe);
  assert.throws(() => requireSafeStatefulChanges(unsafe), /removes or may replace retained production state/);
  assert.doesNotThrow(() => requireSafeStatefulChanges([
    { logicalResourceId: 'Table', action: 'Modify', replacement: 'False' },
    { logicalResourceId: 'Table', action: 'Add' },
    { logicalResourceId: 'Function', action: 'Modify', replacement: 'True' },
  ]));
});

test('a completed update rollback is reusable only when no resources were skipped', () => {
  assert.equal(updateReadyStackStatus('CREATE_COMPLETE'), true);
  assert.equal(updateReadyStackStatus('UPDATE_COMPLETE'), true);
  assert.equal(updateReadyStackStatus('UPDATE_ROLLBACK_COMPLETE'), true);
  assert.equal(updateReadyStackStatus('UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS'), false);
  assert.equal(updateReadyStackStatus('UPDATE_ROLLBACK_FAILED'), false);
  assert.equal(rollbackHasSkippedResources({StackStatus:'UPDATE_ROLLBACK_COMPLETE'}, [
    {LogicalResourceId:'FunctionAlias',ResourceStatus:'UPDATE_COMPLETE'},
  ]), false);
  assert.equal(rollbackHasSkippedResources({
    StackStatus:'UPDATE_ROLLBACK_COMPLETE',
    StackStatusReason:'One or more resources were skipped during UpdateRollback.',
  }), true);
  assert.equal(rollbackHasSkippedResources({StackStatus:'UPDATE_ROLLBACK_COMPLETE'}, [
    {LogicalResourceId:'Table',ResourceStatus:'UPDATE_COMPLETE',ResourceStatusReason:'Resource skipped during UpdateRollback'},
  ]), true);
});

test('emergency rollback accepts only fully pinned gate-on releases', () => {
  const releaseId = 'a'.repeat(64);
  const siteVersion = '3HL4kqtJlcpXroDTDmJ+rmspXd3dIbrHY+MTRCxf3vj', token = Buffer.from(siteVersion).toString('base64url');
  const description = `RoleClue release ${releaseId} origin-gate-true site-v-${token} site-sha-${'b'.repeat(64)}`;
  assert.equal(isProtectedReleaseVersion(description, releaseId), true);
  assert.deepEqual(protectedReleaseVersion(description, releaseId), {siteVersion, siteSha256:'b'.repeat(64)});
  assert.equal(isProtectedReleaseVersion(`RoleClue release ${releaseId}`, releaseId), false);
  assert.equal(isProtectedReleaseVersion(`RoleClue release ${releaseId} origin-gate-true`, releaseId), false);
  assert.equal(isProtectedReleaseVersion(`RoleClue release ${releaseId} origin-gate-false`, releaseId), false);
  assert.equal(isProtectedReleaseVersion(description.replace(releaseId, 'c'.repeat(64)), releaseId), false);
  const source = readFileSync(new URL('../scripts/rollback-production.mjs', import.meta.url), 'utf8');
  assert.match(source, /protectedReleaseVersion\(target\.Description, releaseId\)/);
  assert.match(source, /--version-id', protectedRelease\.siteVersion/);
  assert.match(source, /protectedRelease\.siteSha256/);
  assert.match(source, /publishSiteWithCachePolicy\(run, site, siteBucket\)/);
  assert.match(source, /verifyPublishedSiteFiles\(site, downloaded\)/);
  assert.match(source, /restoredAlias\.FunctionVersion === version/);
  assert.match(source, /publicRelease\.ok/);
});

test('the canonical site digest covers every release file except its self-referential manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roleclue-site-hash-'));
  try {
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<main>RoleClue</main>');
    await writeFile(join(root, 'assets', 'app.js'), 'one');
    await writeFile(join(root, 'release.json'), '{"ignored":1}');
    const first = await hashDirectory(root, {exclude:['release.json']});
    await writeFile(join(root, 'release.json'), '{"ignored":2}');
    assert.equal(await hashDirectory(root, {exclude:['release.json']}), first);
    await writeFile(join(root, 'assets', 'app.js'), 'two');
    assert.notEqual(await hashDirectory(root, {exclude:['release.json']}), first);
  } finally { await rm(root, {recursive:true,force:true}); }
});

test('deployment binds an origin-gate phase and enables stack termination protection before execution', () => {
  const source = readFileSync(new URL('../scripts/deploy-production.mjs', import.meta.url), 'utf8');
  assert.match(source, /ROLECLUE_API_ORIGIN_GATE_ENABLED/);
  assert.match(source, /\['StripePortalConfigurationId', stripePortalConfigurationId\]/);
  assert.match(source, /plannedParameters\.get\('StripePortalConfigurationId'\) === stripePortalConfigurationId/);
  assert.match(source, /gate-\(\?:off\|on\)/);
  assert.match(source, /update-termination-protection', '--enable-termination-protection/);
  assert.ok(source.indexOf('update-termination-protection') < source.indexOf("'execute-change-set'"));
  assert.match(source, /'--template-url', templateUrl/);
  assert.doesNotMatch(source, /'--template-body'/);
  assert.match(source, /requireSafeStatefulChanges\(changes\)/);
  assert.match(source, /requireSafeStatefulChanges\(reviewedChanges\)/);
  assert.match(source, /extractVerifiedSiteArchive\(remoteSite\.path, manifest\)[\s\S]*?publishVerifiedSite\(reviewedSite\.site, siteBucket, manifest\)/);
  assert.match(source, /publishSiteWithCachePolicy\(run, site, bucket\)/);
  assert.match(source, /verifyPublishedSiteFiles\(site, downloaded\)/);
  assert.doesNotMatch(source, /'s3', 'sync', resolve\('dist'\)/);
  assert.match(source, /get-bucket-versioning/);
  assert.match(source, /ArtifactVersion/);
  assert.match(source, /SiteArtifactVersion/);
  assert.match(source, /fetchVerifiedArtifact/);
  assert.match(source, /siteContentSha256/);
  assert.match(source, /Set ROLECLUE_API_ORIGIN_GATE_ENABLED explicitly/);
  assert.match(source, /updateReadyStackStatus\(stack\.StackStatus\)/);
  assert.match(source, /rollbackHasSkippedResources\(stack, resources\)/);
  assert.match(source, /apiOrigin\?\.CustomHeaders\?\.Items/);
  assert.doesNotMatch(source, /apiOrigin\?\.OriginCustomHeaders\?\.Items/);
  assert.match(source, /protectedStack\?\.StackId === stack\.StackId && updateReadyStackStatus\(protectedStack\.StackStatus\)/);
  assert.match(source, /\['AVAILABLE', 'EXECUTE_COMPLETE'\]\.includes\(planned\.ExecutionStatus\)/);
  assert.match(source, /if \(planned\.ExecutionStatus === 'AVAILABLE'\)/);
  assert.match(source, /deployedParameters\.get\(key\) === plannedParameters\.get\(key\)/);
  assert.match(source, /liveAlias\.FunctionVersion === functionVersion/);
  assert.match(source, /liveAlias\.Description === `RoleClue production \$\{manifest\.releaseId\}`/);
  assert.match(source, /origin-gate-\$\{apiOriginGateEnabled\}/);
  assert.match(source, /liveConfiguration\.Description === expectedVersionDescription/);
  assert.match(source, /codeSha256Hex\(liveConfiguration\.CodeSha256\) === manifest\.lambdaSha256/);
  const templateSource = readFileSync(new URL('../infra/template.mjs', import.meta.url), 'utf8');
  assert.match(templateSource, /VersioningConfiguration: \{ Status: 'Enabled' \}/);
  assert.match(templateSource, /S3ObjectVersion: ref\('ArtifactVersion'\)/);
});

test('artifact versioning bootstrap is review-gated and limited to in-place retained resources', () => {
  const source = readFileSync(new URL('../scripts/deploy-artifact-versioning.mjs', import.meta.url), 'utf8');
  assert.match(source, /roleclue-member-artifacts/);
  assert.match(source, /change-set-create-complete/);
  assert.match(source, /artifact-versioning-plan\.json/);
  assert.match(source, /change\.replacement === 'False'/);
  assert.match(source, /update-termination-protection/);
  assert.match(source, /get-bucket-versioning/);
  assert.match(source, /output = run\(\[\.\.\.args, '--output', 'json'\]\)\.trim\(\)/);
  assert.match(source, /output \? JSON\.parse\(output\) : \{\}/);
  assert.match(source, /\['AVAILABLE','EXECUTE_COMPLETE'\]\.includes\(planned\.ExecutionStatus\)/);
  assert.match(source, /if\(planned\.ExecutionStatus==='AVAILABLE'\)/);
  assert.match(source, /deployed\.Status==='Enabled'/);
});

test('browser smoke requires a portable task target and uses the normal AWS profile chain', () => {
  assert.throws(() => browserTarget({}), /ROLECLUE_BROWSER_TASKSPACE_ID/);
  assert.throws(() => browserTarget({ ROLECLUE_BROWSER_TASKSPACE_ID: '0' }), /ROLECLUE_BROWSER_TASKSPACE_ID/);
  assert.deepEqual(browserTarget({ ROLECLUE_BROWSER_TASKSPACE_ID: '417', ROLECLUE_BROWSER_PAGE_LABEL: 'acceptance-1' }), {
    taskSpaceId: 417,
    pageLabel: 'acceptance-1',
  });
  assert.deepEqual(browserTarget({ ROLECLUE_BROWSER_TASKSPACE_ID: '417' }), { taskSpaceId: 417, pageLabel: 'p1' });
  assert.equal(browserAwsProfile({ GITHUB_ACTIONS: 'true' }), '');
  assert.equal(browserAwsProfile({ AWS_PROFILE: 'release-review' }), 'release-review');
  const program = browserProgram({
    taskSpaceId: 417,
    pageLabel: 'acceptance-1',
    phase: 'preflight',
    siteUrl: 'https://app.proairesis.digital',
    releaseId: 'a'.repeat(64),
  });
  assert.match(program, /^\(async \(\) => \{ const completeSignedInInterview = async function/);
  assert.match(program, /taskSpace\(parameters\.taskSpaceId\)/);
  assert.doesNotMatch(program, /taskSpace\(82\)/);
  assert.match(program, /roleclue\.session\.v1/);
  assert.match(program, /roleclue\.guest\.v1/);
  assert.match(program, /roleclue\.continuation\.v1/);
  assert.match(program, /Already have an account\? Sign in/);
  assert.match(program, /guestJourneyIsOpen/);
  assert.match(program, /Network\.setCacheDisabled/);
  assert.match(program, /roleclue_release/);
  assert.doesNotMatch(program, /Network\.clearBrowserCache/);
  assert.ok(program.indexOf('cacheDisabled: true') < program.indexOf('page.goto'));
  assert.ok(program.lastIndexOf('cacheDisabled: false') > program.indexOf('page.goto'));
  assert.ok(program.indexOf('roleclue.guest.v1') < program.indexOf('guestJourneyIsOpen'));
  assert.ok(program.indexOf('roleclue.continuation.v1') < program.indexOf('guestJourneyIsOpen'));
  const smokeSource = readFileSync(new URL('../scripts/smoke-browser.mjs', import.meta.url), 'utf8');
  assert.match(smokeSource, /retainPrivateOutput\("stderr", chunk\)/);
  assert.match(smokeSource, /`\$\{stdout\}\\n\$\{stderr\}`/);
  assert.doesNotMatch(smokeSource, /console\.log\(stderr\)/);
});

test('the generated browser program binds and executes the interview helper', async () => {
  const clicks=[];
  const cdp=[];
  const logs=[];
  const page={
    cdp:async(method,parameters)=>cdp.push([method,parameters]),
    goto:async()=>{},
    url:async()=> 'https://app.proairesis.digital/?roleclue_release=' + 'a'.repeat(64),
    evaluate:async(callback)=>{
      const source=callback.toString();
      if(source.includes('/release.json')) return true;
      if(source.includes('roleclue.guest.v1')) return false;
      if(source.includes('!document.querySelector')) return false;
      if(source.includes('document.querySelector("#interview-title")')) return true;
      if(source.includes('ownSession:')) return {ownSession:false,ownForm:false};
      if(source.includes('session?.email !== email')) return true;
      return false;
    },
    waitForFunction:async()=>{},
    waitForSelector:async(selector)=>{
      if(selector==='#resume-file') throw new Error('synthetic stop after interview');
    },
    snapshot:async()=>{},
    click:async(selector)=>clicks.push(selector),
    fill:async()=>{},
  };
  const taskSpace=async()=>({
    spaceId:417,
    ownership:'agent',
    pages:async()=>[{label:'p1'}],
    page:()=>page,
  });
  const receiptPrefix='ROLECLUE_TEST_RECEIPT:';
  const program=browserProgram({
    taskSpaceId:417,
    pageLabel:'p1',
    phase:'upload',
    siteUrl:'https://app.proairesis.digital',
    releaseId:'a'.repeat(64),
    receiptPrefix,
  });
  await runInNewContext(program,{taskSpace,URL,console:{log:value=>logs.push(value)}});
  assert.ok(clicks.some(selector=>selector.includes('Software engineering')));
  assert.ok(clicks.some(selector=>selector.includes('Use my resume as a shortcut')));
  assert.equal(cdp.at(0)[0],'Network.enable');
  assert.equal(cdp.at(0)[1],undefined);
  assert.equal(cdp.at(1)[0],'Network.setCacheDisabled');
  assert.equal(cdp.at(1)[1].cacheDisabled,true);
  assert.equal(cdp.at(-1)[0],'Network.setCacheDisabled');
  assert.equal(cdp.at(-1)[1].cacheDisabled,false);
  assert.equal(logs.length,1);
  const receipt=JSON.parse(logs[0].slice(receiptPrefix.length));
  assert.equal(receipt.passed,false);
  assert.equal(receipt.stage,'resume shortcut destination wait');
});

test('paid generations and recommendation refreshes select separate queues', () => {
  const env = { GENERATION_QUEUE_URL: 'https://sqs.example/generation', RECOMMENDATION_QUEUE_URL: 'https://sqs.example/recommendation' };
  assert.equal(workQueueUrl({ kind: 'generate' }, env), env.GENERATION_QUEUE_URL);
  assert.equal(workQueueUrl({ kind: 'generation-repair-fanout' }, env), env.GENERATION_QUEUE_URL);
  assert.equal(workQueueUrl({ kind: 'recommendation-refresh' }, env), env.RECOMMENDATION_QUEUE_URL);
  assert.equal(workQueueUrl({ kind: 'recommendation-fanout' }, env), env.RECOMMENDATION_QUEUE_URL);
  assert.equal(workQueueUrl({ kind: 'billing-reconcile' }, env), env.RECOMMENDATION_QUEUE_URL);
  assert.equal(workQueueUrl({ kind: 'billing-fanout' }, env), env.RECOMMENDATION_QUEUE_URL);
  assert.throws(() => workQueueUrl({ kind: 'unknown' }, env), /Unsupported async work kind/);
});

test('release preparation binds the manifest to the immutable checked-out revision', () => {
  const revision = 'a'.repeat(40);
  assert.equal(releaseSourceRevision(revision, {}), revision);
  const mainEnvironment = {GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',GITHUB_SHA:revision};
  assert.equal(releaseSourceRevision(revision, mainEnvironment), revision);
  assert.throws(() => releaseSourceRevision('not-a-revision', {}), /valid Git revision/);
  assert.throws(() => releaseSourceRevision(revision, {...mainEnvironment,GITHUB_SHA:'b'.repeat(40)}),
    /does not match the immutable GitHub Actions revision/);
  assert.throws(() => releaseSourceRevision(revision, {...mainEnvironment,GITHUB_REF:'refs/heads/feature'}),
    /only from the main branch/);
  const source = readFileSync(new URL('../scripts/prepare-release.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /ls-remote/);
});

test('pull requests and non-main manual runs build validation-only artifacts', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/member-app-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /- run: npm ci\s+- run: npm run lint\s+- run: npm test/);
  assert.match(workflow, /Build validation artifacts[\s\S]*?if: github\.event_name == 'pull_request' \|\| github\.ref != 'refs\/heads\/main'[\s\S]*?npm run build && npm run build:lambda && npm run infra:template/);
  assert.match(workflow, /Prepare releasable main-branch artifacts[\s\S]*?if: github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main'[\s\S]*?npm run release:prepare/);
});

test('the broad staging workflow ignores member-app-only changes', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  const ignoredMemberPaths = /paths-ignore:\s*\n\s*- 'member-app\/\*\*'\s*\n\s*- '\.github\/workflows\/member-app-release\.yml'/g;
  assert.equal([...workflow.matchAll(ignoredMemberPaths)].length, 2);
});

test('the deployed browser smoke completes interview-first onboarding before resume upload', async () => {
  const actions=[];
  const stages=[];
  const page={
    evaluate:async()=>true,
    click:async selector=>actions.push(['click',selector]),
    fill:async(selector,value)=>actions.push(['fill',selector,value]),
    waitForFunction:async()=>actions.push(['wait']),
  };
  assert.equal(await completeSignedInInterview(page, stage => stages.push(stage)),true);
  assert.deepEqual(actions.filter(([action])=>action==='fill'),[['fill','#interview-location','Sydney, NSW']]);
  assert.ok(actions.some(([,selector])=>selector?.includes('Software engineering')));
  assert.ok(actions.some(([,selector])=>selector?.includes('Use my resume as a shortcut')));
  assert.deepEqual(stages, [
    'interview entry check',
    'interview role selection',
    'interview situation screen wait',
    'interview situation and location',
    'interview work-rights screen wait',
    'interview work-rights selection',
    'interview constraints screen wait',
    'interview constraints confirmation',
    'interview profile summary wait',
    'interview resume shortcut selection',
    'interview complete',
  ]);
  assert.equal(await completeSignedInInterview({evaluate:async()=>false}),false);
});
