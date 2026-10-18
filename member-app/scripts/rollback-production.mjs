import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
const distributionId = requireValue(outputs.DistributionId, 'Distribution output missing.');
const artifactBucket = requireValue(parameters.ArtifactBucket, 'Artifact bucket parameter missing.');
const target = json(['lambda', 'get-function-configuration', '--function-name', functionName, '--qualifier', version]);
requireValue(target.Version === version && target.Description === `RoleClue release ${releaseId}`, 'The retained Lambda version does not match the requested release.');
const siteKey = `releases/${releaseId}/site.zip`;
json(['s3api', 'head-object', '--bucket', artifactBucket, '--key', siteKey]);
const alias = json(['lambda', 'get-alias', '--function-name', functionName, '--name', 'live']);

const plan = {
  mode: apply ? 'apply' : 'dry-run', account: ACCOUNT, region: REGION, stack: STACK,
  releaseId, targetVersion: version, currentVersion: alias.FunctionVersion,
  actions: ['Point the live Lambda alias to the retained version', 'Restore the archived site bundle', 'Invalidate CloudFront'],
  warning: 'This is an emergency service rollback. CloudFormation will report alias drift until the prior release is redeployed through a reviewed change set.',
};
console.log(JSON.stringify(plan, null, 2));
if (!apply) process.exit(0);

const temporary = await mkdtemp(join(tmpdir(), 'roleclue-rollback-'));
const archive = join(temporary, 'site.zip');
const site = join(temporary, 'site');
run(['s3api', 'get-object', '--bucket', artifactBucket, '--key', siteKey, archive], { timeout: 300_000 });
execFileSync('mkdir', ['-p', site]);
execFileSync('unzip', ['-q', archive, '-d', site]);
const restoredManifest = JSON.parse(await readFile(join(site, 'release.json'), 'utf8'));
requireValue(restoredManifest.releaseId === releaseId, 'The archived site manifest does not match the requested release.');

run(['lambda', 'update-alias', '--function-name', functionName, '--name', 'live', '--function-version', version,
  '--description', `Emergency rollback to ${releaseId}`]);
run(['s3', 'sync', site, `s3://${siteBucket}/`, '--delete', '--only-show-errors'], { timeout: 600_000 });
const invalidation = json(['cloudfront', 'create-invalidation', '--distribution-id', distributionId, '--paths', '/*']);
const invalidationId = requireValue(invalidation.Invalidation?.Id, 'CloudFront did not return an invalidation ID.');
run(['cloudfront', 'wait', 'invalidation-completed', '--distribution-id', distributionId, '--id', invalidationId], { timeout: 900_000 });
const evidence = {...plan, invalidationId, completedAt: new Date().toISOString()};
await writeFile(resolve('build/rollback-evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
