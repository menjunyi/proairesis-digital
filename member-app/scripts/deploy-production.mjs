import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hashDirectory, requireSafeStatefulChanges, rollbackHasSkippedResources, updateReadyStackStatus } from './release-safety.mjs';

const ACCOUNT = '037169690315';
const REGION = 'ap-southeast-2';
const STACK = 'roleclue-member-app';
const PROFILE = process.env.AWS_PROFILE || (process.env.GITHUB_ACTIONS === 'true' ? '' : 'proairesis-management');
const mode = process.argv[2];
const existingChangeSet = process.argv[3];
const apiOriginGateEnabled = process.env.ROLECLUE_API_ORIGIN_GATE_ENABLED;
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
if (!['false', 'true'].includes(apiOriginGateEnabled)) {
  throw new Error('Set ROLECLUE_API_ORIGIN_GATE_ENABLED explicitly to true or false.');
}
if (mode === '--execute-existing' && !/^roleclue-[a-f0-9]{12}-gate-(?:off|on)$/.test(existingChangeSet || '')) {
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
function codeSha256Hex(value) {
  if (typeof value !== 'string') return '';
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === 32 ? bytes.toString('hex') : '';
}
function versionToken(value) {
  const token = Buffer.from(value, 'utf8').toString('base64url');
  requireValue(token && /^[A-Za-z0-9_-]+$/.test(token), 'An artifact version could not be encoded safely.');
  return token;
}
function s3TemplateUrl(bucket, key, versionId) {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `https://s3.${REGION}.amazonaws.com/${encodeURIComponent(bucket)}/${encodedKey}?versionId=${encodeURIComponent(versionId)}`;
}
async function extractVerifiedSiteArchive(archive, expectedManifest) {
  const root = await mkdtemp(join(tmpdir(), 'roleclue-verified-site-'));
  const site = join(root, 'site');
  try {
    const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8', timeout: 120_000 })
      .split(/\r?\n/).filter(Boolean);
    requireValue(entries.length > 0 && entries.every(entry => {
      const trimmed = entry.endsWith('/') ? entry.slice(0, -1) : entry;
      return trimmed && !entry.startsWith('/') && !entry.includes('\\') &&
        trimmed.split('/').every(segment => segment && segment !== '.' && segment !== '..');
    }), 'The site archive contains an unsafe or empty path.');
    await mkdir(site);
    execFileSync('unzip', ['-q', archive, '-d', site], { timeout: 120_000 });
    const archivedManifest = JSON.parse(await readFile(join(site, 'release.json'), 'utf8'));
    requireValue(archivedManifest.version === 3 && archivedManifest.releaseId === expectedManifest.releaseId &&
      archivedManifest.sourceRevision === expectedManifest.sourceRevision &&
      archivedManifest.lambdaSha256 === expectedManifest.lambdaSha256 &&
      archivedManifest.templateSha256 === expectedManifest.templateSha256 &&
      archivedManifest.siteContentSha256 === expectedManifest.siteContentSha256,
    'The site archive manifest does not match the prepared release.');
    requireValue(sha256(await readFile(join(site, 'index.html'))) === archivedManifest.indexSha256,
      'The site archive index does not match its release manifest.');
    requireValue(await hashDirectory(site, { exclude: ['release.json'] }) === archivedManifest.siteContentSha256,
      'The complete site archive content does not match its release manifest.');
    return { root, site, manifest: archivedManifest };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
async function publishVerifiedSite(site, bucket, expectedManifest) {
  run(['s3', 'cp', site, `s3://${bucket}/`, '--recursive', '--only-show-errors'], { timeout: 600_000 });
  run(['s3', 'sync', site, `s3://${bucket}/`, '--delete', '--only-show-errors'], { timeout: 600_000 });
  const root = await mkdtemp(join(tmpdir(), 'roleclue-published-site-'));
  const downloaded = join(root, 'site');
  try {
    await mkdir(downloaded);
    run(['s3', 'sync', `s3://${bucket}/`, downloaded, '--only-show-errors'], { timeout: 600_000 });
    const deployedManifest = JSON.parse(await readFile(join(downloaded, 'release.json'), 'utf8'));
    requireValue(canonicalJson(deployedManifest) === canonicalJson(expectedManifest),
      'The published site manifest does not match the reviewed release.');
    requireValue(sha256(await readFile(join(downloaded, 'index.html'))) === expectedManifest.indexSha256 &&
      await hashDirectory(downloaded, { exclude: ['release.json'] }) === expectedManifest.siteContentSha256,
    'The complete published site does not match the reviewed release.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
requireValue(updateReadyStackStatus(stack.StackStatus), 'The production stack is not ready for an update.');
if (stack.StackStatus === 'UPDATE_ROLLBACK_COMPLETE') {
  const resources = awsJson(['cloudformation', 'describe-stack-resources', '--stack-name', STACK]).StackResources ?? [];
  requireValue(!rollbackHasSkippedResources(stack, resources),
    'The completed rollback skipped resources. Reconcile them and review drift before another production update.');
}

const manifest = JSON.parse(await readFile(resolve('dist/release.json'), 'utf8'));
requireValue(manifest.version === 3 && /^[a-f0-9]{64}$/.test(manifest.releaseId || '') &&
  /^[a-f0-9]{64}$/.test(manifest.lambdaSha256 || '') && /^[a-f0-9]{64}$/.test(manifest.templateSha256 || '') &&
  /^[a-f0-9]{64}$/.test(manifest.siteContentSha256 || '') && /^[a-f0-9]{64}$/.test(manifest.indexSha256 || ''),
'Prepare a complete version 3 release manifest first.');
requireValue(/^[a-f0-9]{40}$/.test(manifest.sourceRevision || ''), 'The release manifest has no source revision.');
requireValue(sha256(JSON.stringify({sourceRevision:manifest.sourceRevision,lambdaSha256:manifest.lambdaSha256,
  siteContentSha256:manifest.siteContentSha256,templateSha256:manifest.templateSha256})) === manifest.releaseId,
'The release ID does not bind the complete prepared release content.');
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
async function fetchVerifiedArtifact(record, expectedKey, label) {
  requireValue(record?.key === expectedKey && typeof record.versionId === 'string' && record.versionId &&
    /^[a-f0-9]{64}$/.test(record.sha256 || ''), `The ${label} artifact evidence is invalid.`);
  const head = awsJson(['s3api', 'head-object', '--bucket', artifactBucket, '--key', record.key,
    '--version-id', record.versionId, '--expected-bucket-owner', ACCOUNT]);
  requireValue(head.VersionId === record.versionId && head.Metadata?.sha256 === record.sha256 &&
    head.Metadata?.['release-id'] === manifest.releaseId && head.Metadata?.['source-revision'] === manifest.sourceRevision,
  `The immutable ${label} artifact metadata does not match the reviewed release.`);
  const root = await mkdtemp(join(tmpdir(), `roleclue-${label}-artifact-`));
  const path = join(root, label);
  try {
    run(['s3api', 'get-object', '--bucket', artifactBucket, '--key', record.key, '--version-id', record.versionId,
      '--expected-bucket-owner', ACCOUNT, path], { timeout: 300_000 });
    requireValue(sha256(await readFile(path)) === record.sha256,
      `The immutable ${label} artifact bytes do not match the reviewed release.`);
    return { root, path };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
const gatePhase = apiOriginGateEnabled === 'true' ? 'gate-on' : 'gate-off';
const changeSetName = `roleclue-${manifest.releaseId.slice(0, 12)}-${gatePhase}`;
const changeSetDescription = `RoleClue ${manifest.releaseId} from ${manifest.sourceRevision} with API origin gate ${apiOriginGateEnabled}`;
if (mode === '--execute-existing') {
  requireValue(existingChangeSet === changeSetName, 'The reviewed change-set name does not match the selected API origin gate phase.');
}
const currentOriginGate = parameters.get('ApiOriginGateEnabled');
requireValue(!(currentOriginGate === 'true' && apiOriginGateEnabled === 'false'),
  'Refusing to disable the API origin gate on a protected production stack.');
if (apiOriginGateEnabled === 'true' && currentOriginGate !== 'true') {
  requireValue(currentOriginGate === 'false',
    'Run and complete a reviewed ROLECLUE_API_ORIGIN_GATE_ENABLED=false phase before enabling the API origin gate.');
  const distributionId = requireValue(outputs.DistributionId, 'The CloudFront distribution output is missing for origin-gate cutover.');
  run(['cloudfront', 'wait', 'distribution-deployed', '--id', distributionId], { timeout: 900_000 });
  const distribution = awsJson(['cloudfront', 'get-distribution', '--id', distributionId]).Distribution;
  const apiOrigin = distribution?.DistributionConfig?.Origins?.Items?.find(origin => origin.Id === 'api');
  // CloudFormation calls this property OriginCustomHeaders, while the
  // CloudFront GetDistribution API returns it as CustomHeaders.
  const originHeaders = apiOrigin?.CustomHeaders?.Items ?? [];
  requireValue(distribution?.Status === 'Deployed' && originHeaders.some(header =>
    header.HeaderName?.toLowerCase() === 'x-roleclue-origin' && typeof header.HeaderValue === 'string' && header.HeaderValue.length >= 32),
  'Run and complete the origin-gate-disabled phase so deployed CloudFront sends the origin credential before enforcement.');
}

if (mode === '--plan') {
  const lambdaSha = (await readFile(resolve('build/lambda.sha256'), 'utf8')).trim();
  const lambdaArtifact = await readFile(resolve('build/lambda.zip'));
  const siteArtifact = await readFile(resolve('build/site.zip'));
  const templateText = await readFile(resolve('build/app.template.json'), 'utf8');
  const template = JSON.parse(templateText);
  requireValue(lambdaSha === manifest.lambdaSha256 && sha256(lambdaArtifact) === lambdaSha, 'The Lambda artifact does not match the release manifest.');
  requireValue(sha256(templateText) === manifest.templateSha256, 'The infrastructure template does not match the release manifest.');
  const verifiedSite = await extractVerifiedSiteArchive(resolve('build/site.zip'), manifest);
  await rm(verifiedSite.root, { recursive: true, force: true });
  const bucketVersioning = awsJson(['s3api', 'get-bucket-versioning', '--bucket', artifactBucket, '--expected-bucket-owner', ACCOUNT]);
  requireValue(bucketVersioning.Status === 'Enabled',
    'The release artifact bucket must have versioning enabled before a production plan can be created.');
  const upload = (file, key, contentType, digest) => {
    const uploaded = awsJson(['s3api', 'put-object', '--bucket', artifactBucket, '--key', key, '--body', resolve(file),
      '--content-type', contentType, '--server-side-encryption', 'AES256', '--expected-bucket-owner', ACCOUNT,
      '--metadata', `sha256=${digest},release-id=${manifest.releaseId},source-revision=${manifest.sourceRevision}`]);
    requireValue(typeof uploaded.VersionId === 'string' && uploaded.VersionId && uploaded.VersionId !== 'null',
      `The versioned upload for ${key} did not return an immutable version ID.`);
    return { key, versionId: uploaded.VersionId, sha256: digest };
  };
  const releaseArtifacts = {
    lambda: upload('build/lambda.zip', `${prefix}/lambda.zip`, 'application/zip', lambdaSha),
    site: upload('build/site.zip', `${prefix}/site.zip`, 'application/zip', sha256(siteArtifact)),
    template: upload('build/app.template.json', `${prefix}/app.template.json`, 'application/json', sha256(templateText)),
  };

  const overrides = new Map([
    ['ArtifactKey', releaseArtifacts.lambda.key],
    ['ArtifactVersion', releaseArtifacts.lambda.versionId],
    ['SiteArtifactVersion', releaseArtifacts.site.versionId],
    ['SiteArtifactVersionToken', versionToken(releaseArtifacts.site.versionId)],
    ['SiteArtifactSha256', releaseArtifacts.site.sha256],
    ['ReleaseId', manifest.releaseId],
    ['FreehireEnabled', 'true'],
    ['FreehireLicenseApproved', 'true'],
    ['FreehireLicenseReference', 'https://freehire.me/docs/api'],
    ['AlarmEmail', 'support@proairesis.digital'],
    ['ApiOriginGateEnabled', apiOriginGateEnabled],
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
  const templateUrl = s3TemplateUrl(artifactBucket, releaseArtifacts.template.key, releaseArtifacts.template.versionId);

  try {
    run([
      'cloudformation', 'create-change-set', '--stack-name', STACK, '--change-set-name', changeSetName,
      '--change-set-type', 'UPDATE', '--description', changeSetDescription,
      '--template-url', templateUrl,
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
  const changes = summarizedChanges(planned);
  requireSafeStatefulChanges(changes);
  const plannedParameters = new Map((planned.Parameters ?? []).map(item => [item.ParameterKey, item.ParameterValue]));
  requireValue(plannedParameters.get('ApiOriginGateEnabled') === apiOriginGateEnabled &&
    plannedParameters.get('ArtifactKey') === releaseArtifacts.lambda.key &&
    plannedParameters.get('ArtifactVersion') === releaseArtifacts.lambda.versionId &&
    plannedParameters.get('SiteArtifactVersion') === releaseArtifacts.site.versionId &&
    plannedParameters.get('SiteArtifactVersionToken') === versionToken(releaseArtifacts.site.versionId) &&
    plannedParameters.get('SiteArtifactSha256') === releaseArtifacts.site.sha256,
  'The planned release parameters do not identify the exact immutable artifacts and origin-gate phase.');
  const evidence = {
    account: ACCOUNT, region: REGION, stack: STACK, stackId: stack.StackId,
    changeSetName, changeSetId: planned.ChangeSetId, createdAt: planned.CreationTime,
    releaseId: manifest.releaseId, sourceRevision: manifest.sourceRevision, apiOriginGateEnabled,
    status: planned.Status, executionStatus: planned.ExecutionStatus,
    artifacts: releaseArtifacts,
    changes,
  };
  await writeFile(resolve('build/deployment-plan.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  process.exit(0);
}

const planEvidence = JSON.parse(await readFile(resolve('build/deployment-plan.json'), 'utf8'));
const planned = awsJson(['cloudformation', 'describe-change-set', '--stack-name', STACK, '--change-set-name', existingChangeSet]);
const changeSetReady = planned.Status === 'CREATE_COMPLETE' &&
  ['AVAILABLE', 'EXECUTE_COMPLETE'].includes(planned.ExecutionStatus);
requireValue(changeSetReady,
  'The reviewed change set is neither available for execution nor complete for a verified post-deployment resume.');
requireValue(planned.Description === changeSetDescription, 'The change set does not match this release manifest and origin-gate phase.');
requireValue(planEvidence.account === ACCOUNT && planEvidence.region === REGION && planEvidence.stackId === stack.StackId &&
  planEvidence.changeSetName === existingChangeSet && planEvidence.changeSetId === planned.ChangeSetId &&
  planEvidence.releaseId === manifest.releaseId && planEvidence.sourceRevision === manifest.sourceRevision &&
  planEvidence.apiOriginGateEnabled === apiOriginGateEnabled,
'The deployment plan evidence does not identify this exact stack, change set and release.');
const reviewedChanges = summarizedChanges(planned);
requireSafeStatefulChanges(reviewedChanges);
requireValue(canonicalJson(planEvidence.changes) === canonicalJson(reviewedChanges), 'The reviewed resource changes no longer match the available change set.');
const lambdaArtifact = await readFile(resolve('build/lambda.zip'));
const siteArtifact = await readFile(resolve('build/site.zip'));
const templateText = await readFile(resolve('build/app.template.json'), 'utf8');
requireValue(planEvidence.artifacts?.lambda?.sha256 === sha256(lambdaArtifact) &&
  planEvidence.artifacts?.site?.sha256 === sha256(siteArtifact) &&
  planEvidence.artifacts?.template?.sha256 === sha256(templateText),
'A reviewed production artifact changed after the plan was created.');
const reviewedTemplate = awsJson(['cloudformation', 'get-template', '--stack-name', STACK, '--change-set-name', existingChangeSet, '--template-stage', 'Processed']);
const reviewedTemplateBody = typeof reviewedTemplate.TemplateBody === 'string'
  ? JSON.parse(reviewedTemplate.TemplateBody) : reviewedTemplate.TemplateBody;
requireValue(canonicalJson(reviewedTemplateBody) === canonicalJson(JSON.parse(templateText)), 'The reviewed CloudFormation template does not match the local release artifact.');
const plannedParameters = new Map((planned.Parameters ?? []).map(item => [item.ParameterKey, item.ParameterValue]));
requireValue(plannedParameters.get('ReleaseId') === manifest.releaseId &&
  plannedParameters.get('ArtifactKey') === planEvidence.artifacts.lambda.key &&
  plannedParameters.get('ArtifactVersion') === planEvidence.artifacts.lambda.versionId &&
  plannedParameters.get('SiteArtifactVersion') === planEvidence.artifacts.site.versionId &&
  plannedParameters.get('SiteArtifactVersionToken') === versionToken(planEvidence.artifacts.site.versionId) &&
  plannedParameters.get('SiteArtifactSha256') === planEvidence.artifacts.site.sha256 &&
  plannedParameters.get('FreehireEnabled') === 'true' && plannedParameters.get('FreehireLicenseApproved') === 'true' &&
  plannedParameters.get('ApiOriginGateEnabled') === apiOriginGateEnabled,
'The reviewed change set has unexpected production release parameters.');
const remoteLambda = await fetchVerifiedArtifact(planEvidence.artifacts.lambda, `${prefix}/lambda.zip`, 'lambda.zip');
await rm(remoteLambda.root, { recursive: true, force: true });
const remoteTemplate = await fetchVerifiedArtifact(planEvidence.artifacts.template, `${prefix}/app.template.json`, 'app.template.json');
await rm(remoteTemplate.root, { recursive: true, force: true });
const remoteSite = await fetchVerifiedArtifact(planEvidence.artifacts.site, `${prefix}/site.zip`, 'site.zip');
const reviewedSite = await extractVerifiedSiteArchive(remoteSite.path, manifest);
await rm(remoteSite.root, { recursive: true, force: true });
run(['cloudformation', 'update-termination-protection', '--enable-termination-protection', '--stack-name', STACK]);
const protectedStack = awsJson(['cloudformation', 'describe-stacks', '--stack-name', STACK]).Stacks?.[0];
requireValue(protectedStack?.StackId === stack.StackId && updateReadyStackStatus(protectedStack.StackStatus),
  'The production stack changed state before the reviewed change set could execute.');
requireValue(protectedStack.EnableTerminationProtection === true, 'Production stack termination protection was not enabled.');
if (planned.ExecutionStatus === 'AVAILABLE') {
  run(['cloudformation', 'execute-change-set', '--stack-name', STACK, '--change-set-name', existingChangeSet]);
  run(['cloudformation', 'wait', 'stack-update-complete', '--stack-name', STACK], { timeout: 2_700_000 });
}

const deployedStack = awsJson(['cloudformation', 'describe-stacks', '--stack-name', STACK]).Stacks?.[0];
requireValue(deployedStack?.StackStatus === 'UPDATE_COMPLETE', 'The production stack update did not complete.');
const deployedParameters = new Map((deployedStack.Parameters ?? []).map(item => [item.ParameterKey, item.ParameterValue]));
for (const key of ['ReleaseId', 'ArtifactKey', 'ArtifactVersion', 'SiteArtifactVersion', 'SiteArtifactVersionToken', 'SiteArtifactSha256', 'ApiOriginGateEnabled']) {
  requireValue(deployedParameters.get(key) === plannedParameters.get(key),
    `The deployed stack parameter ${key} does not match the reviewed release.`);
}
const deployedOutputs = Object.fromEntries((deployedStack.Outputs ?? []).map(item => [item.OutputKey, item.OutputValue]));
const functionName = requireValue(deployedOutputs.FunctionName, 'The Lambda function output is missing.');
const functionVersion = requireValue(deployedOutputs.FunctionVersion, 'The Lambda version output is missing.');
const functionAliasArn = requireValue(deployedOutputs.FunctionAliasArn, 'The Lambda alias output is missing.');
const liveAlias = awsJson(['lambda', 'get-alias', '--function-name', functionName, '--name', 'live']);
requireValue(liveAlias.AliasArn === functionAliasArn && liveAlias.FunctionVersion === functionVersion &&
  liveAlias.Description === `RoleClue production ${manifest.releaseId}`,
'The live Lambda alias does not identify the reviewed release; do not overwrite the frontend after a rollback.');
const liveConfiguration = awsJson(['lambda', 'get-function-configuration', '--function-name', functionName, '--qualifier', functionVersion]);
const expectedVersionDescription = `RoleClue release ${manifest.releaseId} origin-gate-${apiOriginGateEnabled} ` +
  `site-v-${versionToken(planEvidence.artifacts.site.versionId)} site-sha-${planEvidence.artifacts.site.sha256}`;
requireValue(liveConfiguration.Version === functionVersion &&
  codeSha256Hex(liveConfiguration.CodeSha256) === manifest.lambdaSha256 &&
  liveConfiguration.Description === expectedVersionDescription,
'The live Lambda version does not match the reviewed code and pinned frontend artifact.');
const siteBucket = requireValue(deployedOutputs.SiteBucket, 'The site bucket output is missing.');
const distributionId = requireValue(deployedOutputs.DistributionId, 'The CloudFront distribution output is missing.');
run(['cloudfront', 'wait', 'distribution-deployed', '--id', distributionId], { timeout: 900_000 });
try {
  await publishVerifiedSite(reviewedSite.site, siteBucket, manifest);
} finally {
  await rm(reviewedSite.root, { recursive: true, force: true });
}
const invalidation = awsJson(['cloudfront', 'create-invalidation', '--distribution-id', distributionId, '--paths', '/*']);
const invalidationId = requireValue(invalidation.Invalidation?.Id, 'CloudFront did not return an invalidation ID.');
run(['cloudfront', 'wait', 'invalidation-completed', '--distribution-id', distributionId, '--id', invalidationId], { timeout: 900_000 });

const siteUrl = requireValue(deployedOutputs.SiteUrl, 'The site URL output is missing.');
const health = await fetch(`${siteUrl}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
requireValue(health.ok && (await health.json()).ok === true, 'The deployed health check failed.');
const deployedRelease = await fetch(`${siteUrl}/release.json`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
requireValue(deployedRelease.ok && canonicalJson(await deployedRelease.json()) === canonicalJson(manifest),
  'The deployed frontend release does not match the manifest.');
const deployedIndex = await fetch(`${siteUrl}/index.html`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
requireValue(deployedIndex.ok && sha256(Buffer.from(await deployedIndex.arrayBuffer())) === manifest.indexSha256,
  'The deployed frontend entry point does not match the reviewed release.');

const evidence = {
  account: ACCOUNT, region: REGION, stackId: deployedStack.StackId,
  stackStatus: deployedStack.StackStatus, changeSetName: existingChangeSet,
  releaseId: manifest.releaseId, sourceRevision: manifest.sourceRevision,
  apiOriginGateEnabled, terminationProtection: protectedStack.EnableTerminationProtection,
  resumedPostDeployment: planned.ExecutionStatus === 'EXECUTE_COMPLETE',
  functionVersion, functionAliasArn, lambdaCodeSha256: codeSha256Hex(liveConfiguration.CodeSha256),
  artifacts: planEvidence.artifacts, siteUrl, invalidationId, completedAt: new Date().toISOString(),
};
await writeFile(resolve('build/deployment-evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
