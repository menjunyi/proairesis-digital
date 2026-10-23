import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hashDirectory, protectedReleaseVersion } from './release-safety.mjs';
import {
  firstHashedAssetPath,
  isImmutableAssetCacheControl,
  isMutableSiteCacheControl,
  publishSiteWithCachePolicy,
  verifyPublishedSiteFiles,
} from './site-cache-policy.mjs';

const ACCOUNT = '037169690315';
const REGION = 'ap-southeast-2';
const STACK = 'roleclue-member-app';
const PROFILE = process.env.AWS_PROFILE || (process.env.GITHUB_ACTIONS === 'true' ? '' : 'proairesis-management');
const releaseIndex = process.argv.indexOf('--to-release');
const versionIndex = process.argv.indexOf('--to-version');
const releaseId = process.argv[releaseIndex + 1];
const version = process.argv[versionIndex + 1];
const apply = process.argv.includes('--apply');

if (!/^[a-f0-9]{64}$/.test(releaseId || '') || !/^[1-9][0-9]*$/.test(version || '')) {
  throw new Error('Usage: node scripts/rollback-production.mjs --to-release RELEASE_ID --to-version VERSION [--apply]');
}

function run(args, options = {}) {
  const profileArguments = PROFILE ? ['--profile', PROFILE] : [];
  return execFileSync('aws', [...args, ...profileArguments, '--region', REGION, '--no-cli-pager'], {
    encoding: options.encoding ?? 'utf8', stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout ?? 120_000, maxBuffer: 8 * 1024 * 1024,
  });
}
const json = args => JSON.parse(run([...args, '--output', 'json']));
const requireValue = (value, message) => { if (!value) throw new Error(message);return value; };

requireValue(json(['sts', 'get-caller-identity']).Account === ACCOUNT, 'Refusing to roll back an unexpected AWS account.');
const stack = json(['cloudformation', 'describe-stacks', '--stack-name', STACK]).Stacks?.[0];
requireValue(stack?.StackId?.startsWith(`arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${STACK}/`), 'Production stack identity mismatch.');
requireValue(['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'].includes(stack.StackStatus), 'The production stack is not stable.');
const outputs = Object.fromEntries((stack.Outputs ?? []).map(item => [item.OutputKey, item.OutputValue]));
const parameters = Object.fromEntries((stack.Parameters ?? []).map(item => [item.ParameterKey, item.ParameterValue]));
const functionName = requireValue(outputs.FunctionName, 'Function output missing.');
const siteBucket = requireValue(outputs.SiteBucket, 'Site bucket output missing.');
const siteUrl = requireValue(outputs.SiteUrl, 'Site URL output missing.');
const distributionId = requireValue(outputs.DistributionId, 'Distribution output missing.');
const artifactBucket = requireValue(parameters.ArtifactBucket, 'Artifact bucket parameter missing.');
const target = json(['lambda', 'get-function-configuration', '--function-name', functionName, '--qualifier', version]);
const protectedRelease = protectedReleaseVersion(target.Description, releaseId);
requireValue(target.Version === version && protectedRelease,
  'The retained Lambda version does not match a fully pinned gate-on release. Legacy and origin-gate-disabled versions cannot be restored.');
const siteKey = `releases/${releaseId}/site.zip`;
const archivedSite = json(['s3api', 'head-object', '--bucket', artifactBucket, '--key', siteKey, '--version-id', protectedRelease.siteVersion,
  '--expected-bucket-owner', ACCOUNT]);
requireValue(archivedSite.VersionId === protectedRelease.siteVersion && archivedSite.Metadata?.sha256 === protectedRelease.siteSha256 &&
  archivedSite.Metadata?.['release-id'] === releaseId, 'The pinned rollback site artifact metadata does not match the Lambda release.');
const alias = json(['lambda', 'get-alias', '--function-name', functionName, '--name', 'live']);

async function publishVerifiedSite(site, manifest, temporary) {
  publishSiteWithCachePolicy(run, site, siteBucket);
  const downloaded = join(temporary, 'published-site');
  await mkdir(downloaded);
  run(['s3', 'sync', `s3://${siteBucket}/`, downloaded, '--only-show-errors'], { timeout: 600_000 });
  requireValue((await readFile(join(downloaded, 'release.json'))).equals(await readFile(join(site, 'release.json'))) &&
    createHash('sha256').update(await readFile(join(downloaded, 'index.html'))).digest('hex') === manifest.indexSha256,
  'The complete restored site does not match the pinned rollback release.');
  await verifyPublishedSiteFiles(site, downloaded);
}

const plan = {
  mode: apply ? 'apply' : 'dry-run', account: ACCOUNT, region: REGION, stack: STACK,
  releaseId, targetVersion: version, currentVersion: alias.FunctionVersion,
  siteArtifactVersion: protectedRelease.siteVersion, siteArtifactSha256: protectedRelease.siteSha256,
  actions: ['Point the live Lambda alias to the retained version', 'Restore the archived site bundle', 'Invalidate CloudFront'],
  warning: 'This is an emergency service rollback. CloudFormation will report alias drift until the prior release is redeployed through a reviewed change set.',
};
console.log(JSON.stringify(plan, null, 2));
if (!apply) process.exit(0);

const temporary = await mkdtemp(join(tmpdir(), 'roleclue-rollback-'));
const archive = join(temporary, 'site.zip');
const site = join(temporary, 'site');
try {
  run(['s3api', 'get-object', '--bucket', artifactBucket, '--key', siteKey, '--version-id', protectedRelease.siteVersion,
    '--expected-bucket-owner', ACCOUNT, archive], { timeout: 300_000 });
  requireValue(createHash('sha256').update(await readFile(archive)).digest('hex') === protectedRelease.siteSha256,
    'The pinned rollback site bytes do not match the Lambda release.');
  await mkdir(site);
  execFileSync('unzip', ['-q', archive, '-d', site]);
  const restoredManifest = JSON.parse(await readFile(join(site, 'release.json'), 'utf8'));
  requireValue(restoredManifest.version === 3 && restoredManifest.releaseId === releaseId &&
    Buffer.from(target.CodeSha256 ?? '', 'base64').toString('hex') === restoredManifest.lambdaSha256 &&
    createHash('sha256').update(await readFile(join(site, 'index.html'))).digest('hex') === restoredManifest.indexSha256 &&
    await hashDirectory(site, { exclude: ['release.json'] }) === restoredManifest.siteContentSha256,
  'The archived site manifest or complete content does not match the requested release.');

  run(['lambda', 'update-alias', '--function-name', functionName, '--name', 'live', '--function-version', version,
    '--description', `RoleClue production ${releaseId}`]);
  const restoredAlias = json(['lambda', 'get-alias', '--function-name', functionName, '--name', 'live']);
  requireValue(restoredAlias.FunctionVersion === version && restoredAlias.Description === `RoleClue production ${releaseId}`,
    'The live Lambda alias did not move to the requested rollback release.');
  await publishVerifiedSite(site, restoredManifest, temporary);
  const invalidation = json(['cloudfront', 'create-invalidation', '--distribution-id', distributionId, '--paths', '/*']);
  const invalidationId = requireValue(invalidation.Invalidation?.Id, 'CloudFront did not return an invalidation ID.');
  run(['cloudfront', 'wait', 'invalidation-completed', '--distribution-id', distributionId, '--id', invalidationId], { timeout: 900_000 });
  const freshRequest = () => ({cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Cache-Control':'no-cache'}});
  const publicRelease = await fetch(`${siteUrl}/release.json`, freshRequest());
  const publicConfig = await fetch(`${siteUrl}/config.json`, freshRequest());
  const publicIndex = await fetch(`${siteUrl}/index.html`, freshRequest());
  const health = await fetch(`${siteUrl}/api/health`, {cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  const publicIndexBytes = Buffer.from(await publicIndex.arrayBuffer());
  const assetPath = requireValue(firstHashedAssetPath(publicIndexBytes.toString('utf8')),
    'The restored frontend entry point has no hashed asset reference.');
  const publicAsset = await fetch(`${siteUrl}${assetPath}`, freshRequest());
  requireValue(publicRelease.ok && isMutableSiteCacheControl(publicRelease.headers.get('cache-control')) &&
    Buffer.from(await publicRelease.arrayBuffer()).equals(await readFile(join(site, 'release.json'))) &&
    publicConfig.ok && isMutableSiteCacheControl(publicConfig.headers.get('cache-control')) &&
    publicIndex.ok && isMutableSiteCacheControl(publicIndex.headers.get('cache-control')) &&
    createHash('sha256').update(publicIndexBytes).digest('hex') === restoredManifest.indexSha256 &&
    publicAsset.ok && isImmutableAssetCacheControl(publicAsset.headers.get('cache-control')) &&
    health.ok && (await health.json()).ok === true,
  'The public rollback release or health check does not match the pinned release.');
  if (publicConfig.body) await publicConfig.body.cancel();
  if (publicAsset.body) await publicAsset.body.cancel();
  const evidence = {...plan, invalidationId, completedAt: new Date().toISOString()};
  await writeFile(resolve('build/rollback-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
