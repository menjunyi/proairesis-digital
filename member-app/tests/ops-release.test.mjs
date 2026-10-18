import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserAwsProfile, browserTarget, browserProgram } from '../scripts/smoke-browser.mjs';
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
  assert.match(source, /'s3', 'cp', site, `s3:\/\/\$\{siteBucket\}\/`, '--recursive'/);
  assert.match(source, /hashDirectory\(downloaded, \{ exclude: \['release\.json'\] \}\)/);
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
  assert.match(source, /gate-\(\?:off\|on\)/);
  assert.match(source, /update-termination-protection', '--enable-termination-protection/);
  assert.ok(source.indexOf('update-termination-protection') < source.indexOf("'execute-change-set'"));
  assert.match(source, /'--template-url', templateUrl/);
  assert.doesNotMatch(source, /'--template-body'/);
  assert.match(source, /requireSafeStatefulChanges\(changes\)/);
  assert.match(source, /requireSafeStatefulChanges\(reviewedChanges\)/);
  assert.match(source, /extractVerifiedSiteArchive\(remoteSite\.path, manifest\)[\s\S]*?publishVerifiedSite\(reviewedSite\.site, siteBucket, manifest\)/);
  assert.match(source, /'s3', 'cp', site, `s3:\/\/\$\{bucket\}\/`, '--recursive'/);
  assert.match(source, /hashDirectory\(downloaded, \{ exclude: \['release\.json'\] \}\)/);
  assert.doesNotMatch(source, /'s3', 'sync', resolve\('dist'\)/);
  assert.match(source, /get-bucket-versioning/);
  assert.match(source, /ArtifactVersion/);
  assert.match(source, /SiteArtifactVersion/);
  assert.match(source, /fetchVerifiedArtifact/);
  assert.match(source, /siteContentSha256/);
  assert.match(source, /Set ROLECLUE_API_ORIGIN_GATE_ENABLED explicitly/);
  assert.match(source, /updateReadyStackStatus\(stack\.StackStatus\)/);
  assert.match(source, /rollbackHasSkippedResources\(stack, resources\)/);
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
  const program = browserProgram({ taskSpaceId: 417, pageLabel: 'acceptance-1', phase: 'preflight', siteUrl: 'https://app.proairesis.digital' });
  assert.match(program, /taskSpace\(parameters\.taskSpaceId\)/);
  assert.doesNotMatch(program, /taskSpace\(82\)/);
});

test('paid generations and recommendation refreshes select separate queues', () => {
  const env = { GENERATION_QUEUE_URL: 'https://sqs.example/generation', RECOMMENDATION_QUEUE_URL: 'https://sqs.example/recommendation' };
  assert.equal(workQueueUrl({ kind: 'generate' }, env), env.GENERATION_QUEUE_URL);
  assert.equal(workQueueUrl({ kind: 'generation-repair-fanout' }, env), env.GENERATION_QUEUE_URL);
  assert.equal(workQueueUrl({ kind: 'recommendation-refresh' }, env), env.RECOMMENDATION_QUEUE_URL);
  assert.equal(workQueueUrl({ kind: 'recommendation-fanout' }, env), env.RECOMMENDATION_QUEUE_URL);
  assert.throws(() => workQueueUrl({ kind: 'unknown' }, env), /Unsupported async work kind/);
});

test('pull requests build validation artifacts without main-branch release provenance checks', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/member-app-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /Build pull-request validation artifacts[\s\S]*?if: github\.event_name == 'pull_request'[\s\S]*?npm run build && npm run build:lambda && npm run infra:template/);
  assert.match(workflow, /Prepare releasable main-branch artifacts[\s\S]*?if: github\.event_name != 'pull_request'[\s\S]*?npm run release:prepare/);
});
