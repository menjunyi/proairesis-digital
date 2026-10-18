import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ACCOUNT = '037169690315';
const REGION = 'ap-southeast-2';
const STACK = 'roleclue-member-app';
const PROFILE = process.env.AWS_PROFILE || (process.env.GITHUB_ACTIONS === 'true' ? '' : 'proairesis-management');
const mode = process.argv[2];
const existingChangeSet = process.argv[3];
const releasePathspecs = [
  ':/.github/workflows/member-app-release.yml',
  ':/member-app/.env.example', ':/member-app/.gitignore', ':/member-app/README.md',
  ':/member-app/contract.json', ':/member-app/index.html', ':/member-app/package-lock.json',
  ':/member-app/package.json', ':/member-app/vite.config.mjs',
  ':/member-app/infra', ':/member-app/public', ':/member-app/scripts',
  ':/member-app/server', ':/member-app/src', ':/member-app/tests',
];

if (!['--plan', '--execute-existing'].includes(mode)) {
  throw new Error('Usage: node scripts/deploy-production.mjs --plan | --execute-existing CHANGE_SET_NAME');
}
if (mode === '--execute-existing' && !/^roleclue-[a-f0-9]{12}$/.test(existingChangeSet || '')) {
  throw new Error('Use the exact RoleClue change-set name printed by --plan.');
}

function run(args, options = {}) {
  const profileArguments = PROFILE ? ['--profile', PROFILE] : [];
  return execFileSync('aws', [...args, ...profileArguments, '--region', REGION, '--no-cli-pager'], {
    encoding: options.encoding ?? 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout ?? 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}
function awsJson(args) {
  return JSON.parse(run([...args, '--output', 'json']));
}
function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}
function requireValue(value, message) {
  if (!value) throw new Error(message);
  return value;
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function summarizedChanges(changeSet) {
  return (changeSet.Changes ?? []).map(item => ({
    action: item.ResourceChange?.Action,
    logicalResourceId: item.ResourceChange?.LogicalResourceId,
    resourceType: item.ResourceChange?.ResourceType,
    replacement: item.ResourceChange?.Replacement,
  }));
}

const identity = awsJson(['sts', 'get-caller-identity']);
requireValue(identity.Account === ACCOUNT, 'Refusing to deploy to an unexpected AWS account.');
const stack = awsJson(['cloudformation', 'describe-stacks', '--stack-name', STACK]).Stacks?.[0];
requireValue(stack?.StackId?.startsWith(`arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${STACK}/`), 'The production stack identity does not match.');
requireValue(['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus), 'The production stack is not ready for an update.');

const manifest = JSON.parse(await readFile(resolve('dist/release.json'), 'utf8'));
requireValue(/^[a-f0-9]{64}$/.test(manifest.releaseId || ''), 'Prepare a release with a valid release ID first.');
requireValue(/^[a-f0-9]{40}$/.test(manifest.sourceRevision || ''), 'The release manifest has no source revision.');
const repository = git(['rev-parse', '--show-toplevel']);
const localRevision = git(['rev-parse', 'HEAD'], repository);
requireValue(!git(['status', '--porcelain', '--', ...releasePathspecs], repository), 'Commit the member-app release source before deployment.');
const remoteMain = git(['ls-remote', '--exit-code', 'origin', 'refs/heads/main'], repository).split(/\s+/)[0];
requireValue(remoteMain === manifest.sourceRevision, 'Deploy only the exact revision currently published on origin/main.');
try {
  git(['cat-file', '-e', `${manifest.sourceRevision}^{commit}`], repository);
  execFileSync('git', ['diff', '--quiet', manifest.sourceRevision, localRevision, '--', ...releasePathspecs], {cwd: repository, stdio: 'ignore', timeout: 30_000});
} catch {
  throw new Error('The local release source does not match the published manifest revision.');
}
if (process.env.GITHUB_ACTIONS === 'true') {
  requireValue(process.env.GITHUB_REF === 'refs/heads/main' && process.env.GITHUB_SHA === manifest.sourceRevision,
    'The production workflow must run from the exact main-branch release revision.');
}

const outputs = Object.fromEntries((stack.Outputs ?? []).map(item => [item.OutputKey, item.OutputValue]));
const parameters = new Map((stack.Parameters ?? []).map(item => [item.ParameterKey, item.ParameterValue]));
const artifactBucket = requireValue(parameters.get('ArtifactBucket'), 'The stack artifact bucket is missing.');
requireValue(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(artifactBucket), 'The artifact bucket name is invalid.');
const prefix = `releases/${manifest.releaseId}`;
const changeSetName = `roleclue-${manifest.releaseId.slice(0, 12)}`;

if (mode === '--plan') {
  const lambdaSha = (await readFile(resolve('build/lambda.sha256'), 'utf8')).trim();
  const lambdaArtifact = await readFile(resolve('build/lambda.zip'));
  const siteArtifact = await readFile(resolve('build/site.zip'));
  const templateText = await readFile(resolve('build/app.template.json'), 'utf8');
  const template = JSON.parse(templateText);
  requireValue(lambdaSha === manifest.lambdaSha256 && sha256(lambdaArtifact) === lambdaSha, 'The Lambda artifact does not match the release manifest.');
  requireValue(sha256(templateText) === manifest.templateSha256, 'The infrastructure template does not match the release manifest.');

  for (const [file, key, contentType] of [
    ['build/lambda.zip', `${prefix}/lambda.zip`, 'application/zip'],
    ['build/site.zip', `${prefix}/site.zip`, 'application/zip'],
    ['build/app.template.json', `${prefix}/app.template.json`, 'application/json'],
  ]) {
    run(['s3api', 'put-object', '--bucket', artifactBucket, '--key', key, '--body', resolve(file), '--content-type', contentType, '--server-side-encryption', 'AES256'], { timeout: 180_000 });
  }

  const overrides = new Map([
    ['ArtifactKey', `${prefix}/lambda.zip`],
    ['ReleaseId', manifest.releaseId],
    ['FreehireEnabled', 'true'],
    ['FreehireLicenseApproved', 'true'],
    ['FreehireLicenseReference', 'https://freehire.me/docs/api'],
    ['AlarmEmail', 'support@proairesis.digital'],
  ]);
  const templateParameters = new Map(Object.entries(template.Parameters ?? {}));
  for (const key of overrides.keys()) requireValue(templateParameters.has(key), `Release override ${key} is not a template parameter.`);
  const changeParameters = [...templateParameters.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([ParameterKey, definition]) => {
    if (overrides.has(ParameterKey)) return [{ ParameterKey, ParameterValue: overrides.get(ParameterKey) }];
    if (parameters.has(ParameterKey)) return [{ ParameterKey, UsePreviousValue: true }];
    requireValue(Object.hasOwn(definition, 'Default'), `Required template parameter ${ParameterKey} has no release value.`);
    return [];
  });
  const parameterFile = resolve('build/change-set-parameters.json');
  await writeFile(parameterFile, JSON.stringify(changeParameters, null, 2));
  const requiredTags = new Map([['Environment', 'production'], ['Application', 'roleclue'], ['Owner', 'proairesis']]);
  const tags = new Map((stack.Tags ?? []).map(item => [item.Key, item.Value]));
  for (const [key, value] of requiredTags) tags.set(key, value);
  const tagFile = resolve('build/change-set-tags.json');
  await writeFile(tagFile, JSON.stringify([...tags].sort(([left], [right]) => left.localeCompare(right)).map(([Key, Value]) => ({ Key, Value })), null, 2));

  try {
    run([
      'cloudformation', 'create-change-set', '--stack-name', STACK, '--change-set-name', changeSetName,
      '--change-set-type', 'UPDATE', '--description', `RoleClue ${manifest.releaseId} from ${manifest.sourceRevision}`,
      '--template-body', `file://${resolve('build/app.template.json')}`,
      '--parameters', `file://${parameterFile}`,
      '--capabilities', 'CAPABILITY_NAMED_IAM',
      '--tags', `file://${tagFile}`,
    ]);
  } catch (error) {
    const current = awsJson(['cloudformation', 'describe-change-set', '--stack-name', STACK, '--change-set-name', changeSetName]);
    if (current.Status !== 'CREATE_COMPLETE') throw error;
  }
  try {
    run(['cloudformation', 'wait', 'change-set-create-complete', '--stack-name', STACK, '--change-set-name', changeSetName], { timeout: 900_000 });
  } catch {
    const failed = awsJson(['cloudformation', 'describe-change-set', '--stack-name', STACK, '--change-set-name', changeSetName]);
    throw new Error(`Change-set creation failed: ${failed.StatusReason || failed.Status}`);
  }
  const planned = awsJson(['cloudformation', 'describe-change-set', '--stack-name', STACK, '--change-set-name', changeSetName]);
  requireValue(planned.Status === 'CREATE_COMPLETE' && planned.ExecutionStatus === 'AVAILABLE', 'The production change set is not available for review.');
  const evidence = {
    account: ACCOUNT, region: REGION, stack: STACK, stackId: stack.StackId,
    changeSetName, changeSetId: planned.ChangeSetId, createdAt: planned.CreationTime,
    releaseId: manifest.releaseId, sourceRevision: manifest.sourceRevision,
    status: planned.Status, executionStatus: planned.ExecutionStatus,
    artifacts: { lambdaSha256: sha256(lambdaArtifact), siteSha256: sha256(siteArtifact), templateSha256: sha256(templateText) },
    changes: summarizedChanges(planned),
  };
  await writeFile(resolve('build/deployment-plan.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  process.exit(0);
}

const planEvidence = JSON.parse(await readFile(resolve('build/deployment-plan.json'), 'utf8'));
const planned = awsJson(['cloudformation', 'describe-change-set', '--stack-name', STACK, '--change-set-name', existingChangeSet]);
requireValue(planned.Status === 'CREATE_COMPLETE' && planned.ExecutionStatus === 'AVAILABLE', 'The reviewed change set is not available for execution.');
requireValue(planned.Description === `RoleClue ${manifest.releaseId} from ${manifest.sourceRevision}`, 'The change set does not match this release manifest.');
requireValue(planEvidence.account === ACCOUNT && planEvidence.region === REGION && planEvidence.stackId === stack.StackId &&
  planEvidence.changeSetName === existingChangeSet && planEvidence.changeSetId === planned.ChangeSetId &&
  planEvidence.releaseId === manifest.releaseId && planEvidence.sourceRevision === manifest.sourceRevision,
'The deployment plan evidence does not identify this exact stack, change set and release.');
requireValue(canonicalJson(planEvidence.changes) === canonicalJson(summarizedChanges(planned)), 'The reviewed resource changes no longer match the available change set.');
const lambdaArtifact = await readFile(resolve('build/lambda.zip'));
const siteArtifact = await readFile(resolve('build/site.zip'));
const templateText = await readFile(resolve('build/app.template.json'), 'utf8');
requireValue(planEvidence.artifacts?.lambdaSha256 === sha256(lambdaArtifact) &&
  planEvidence.artifacts?.siteSha256 === sha256(siteArtifact) &&
  planEvidence.artifacts?.templateSha256 === sha256(templateText),
'A reviewed production artifact changed after the plan was created.');
const reviewedTemplate = awsJson(['cloudformation', 'get-template', '--stack-name', STACK, '--change-set-name', existingChangeSet, '--template-stage', 'Processed']);
const reviewedTemplateBody = typeof reviewedTemplate.TemplateBody === 'string'
  ? JSON.parse(reviewedTemplate.TemplateBody) : reviewedTemplate.TemplateBody;
requireValue(canonicalJson(reviewedTemplateBody) === canonicalJson(JSON.parse(templateText)), 'The reviewed CloudFormation template does not match the local release artifact.');
const plannedParameters = new Map((planned.Parameters ?? []).map(item => [item.ParameterKey, item.ParameterValue]));
requireValue(plannedParameters.get('ReleaseId') === manifest.releaseId &&
  plannedParameters.get('ArtifactKey') === `${prefix}/lambda.zip` &&
  plannedParameters.get('FreehireEnabled') === 'true' && plannedParameters.get('FreehireLicenseApproved') === 'true',
'The reviewed change set has unexpected production release parameters.');
run(['cloudformation', 'execute-change-set', '--stack-name', STACK, '--change-set-name', existingChangeSet]);
run(['cloudformation', 'wait', 'stack-update-complete', '--stack-name', STACK], { timeout: 2_700_000 });

const deployedStack = awsJson(['cloudformation', 'describe-stacks', '--stack-name', STACK]).Stacks?.[0];
requireValue(deployedStack?.StackStatus === 'UPDATE_COMPLETE', 'The production stack update did not complete.');
const deployedOutputs = Object.fromEntries((deployedStack.Outputs ?? []).map(item => [item.OutputKey, item.OutputValue]));
const siteBucket = requireValue(deployedOutputs.SiteBucket, 'The site bucket output is missing.');
const distributionId = requireValue(deployedOutputs.DistributionId, 'The CloudFront distribution output is missing.');
run(['s3', 'sync', resolve('dist'), `s3://${siteBucket}/`, '--delete', '--only-show-errors'], { timeout: 600_000 });
const invalidation = awsJson(['cloudfront', 'create-invalidation', '--distribution-id', distributionId, '--paths', '/*']);
const invalidationId = requireValue(invalidation.Invalidation?.Id, 'CloudFront did not return an invalidation ID.');
run(['cloudfront', 'wait', 'invalidation-completed', '--distribution-id', distributionId, '--id', invalidationId], { timeout: 900_000 });

const siteUrl = requireValue(deployedOutputs.SiteUrl, 'The site URL output is missing.');
const health = await fetch(`${siteUrl}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
requireValue(health.ok && (await health.json()).ok === true, 'The deployed health check failed.');
const deployedRelease = await fetch(`${siteUrl}/release.json`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
requireValue(deployedRelease.ok && (await deployedRelease.json()).releaseId === manifest.releaseId, 'The deployed frontend release does not match the manifest.');

const evidence = {
  account: ACCOUNT, region: REGION, stackId: deployedStack.StackId,
  stackStatus: deployedStack.StackStatus, changeSetName: existingChangeSet,
  releaseId: manifest.releaseId, sourceRevision: manifest.sourceRevision,
  functionVersion: deployedOutputs.FunctionVersion, functionAliasArn: deployedOutputs.FunctionAliasArn,
  siteUrl, invalidationId, completedAt: new Date().toISOString(),
};
await writeFile(resolve('build/deployment-evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
