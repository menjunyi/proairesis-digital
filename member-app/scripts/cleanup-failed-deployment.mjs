import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ACCOUNT = '037169690315';
const PROFILE = 'proairesis-management';
const REGION = 'ap-southeast-2';
const STACK_NAME = 'roleclue-member-app';
const STACK_ID = 'arn:aws:cloudformation:ap-southeast-2:037169690315:stack/roleclue-member-app/63949420-c53b-11f1-82e0-02fff21b6883';
const TABLE = 'roleclue-member-app-Table-K7CMMSL4IDRQ';
const POOL = 'ap-southeast-2_Wjcu7gdXx';
const RESUME_BUCKET = 'roleclue-member-app-resumebucket-7fgcsmbpfl7x';
const SITE_BUCKET = 'roleclue-member-app-sitebucket-ahoxuy9vdcns';
const TABLE_ARN = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}`;
const POOL_ARN = `arn:aws:cognito-idp:${REGION}:${ACCOUNT}:userpool/${POOL}`;
const TARGETS = {
  Table: {id: TABLE, type: 'AWS::DynamoDB::Table'},
  UserPool: {id: POOL, type: 'AWS::Cognito::UserPool'},
  ResumeBucket: {id: RESUME_BUCKET, type: 'AWS::S3::Bucket'},
  SiteBucket: {id: SITE_BUCKET, type: 'AWS::S3::Bucket'},
};
// Observed read-only on 2026-10-11. Any new version, marker or key needs a new review.
const SITE_VERSIONS = [
  {Key: 'assets/index-OiNK6zC5.js', VersionId: 'O2PtfCb.LxZopp.lBqy87rdP6QdNI6tV', Size: 295280, ETag: '24cf4ff12d4cf18f0161fcec1bc6045f'},
  {Key: 'assets/index-Uzv9EMEL.css', VersionId: 'aK0aPAc7Otbk86R3nfO.m1dTiywyzOcN', Size: 37046, ETag: '9c9fc9fe2480d8c64716993cb6b618bc'},
  {Key: 'config.json', VersionId: 'ow5Oa5SVeV4vFkjUwKr0xCcDRnCVbCtD', Size: 280, ETag: '97f67d1e284a45a7073591cb82cb6b99'},
  {Key: 'index.html', VersionId: 'D9ZrPBdjvuZa4p0HAacWzAKq6vcjFzPY', Size: 639, ETag: '4347e4fe12012e6c4486d2e4540b545c'},
  {Key: 'privacy.html', VersionId: 'PJTsHlWUwF4yXYBr83qNLY.RcLr84CUV', Size: 11383, ETag: '459ae084dcebb7ef1443453f36e0c8dd'},
  {Key: 'release.json', VersionId: 'iZIfky1dpDaQhFuswkvkOJpVpXhRAz3y', Size: 235, ETag: 'c0bbbf66b621d89ea43542c9f0a4ee1b'},
  {Key: 'terms.html', VersionId: 'qxdUNE_j5MW2AofjQRHUZAYwFrPyz6BW', Size: 8514, ETag: '7b0e49e9d074a8e8117491412cf013c1'},
];

function refuse(message) { throw new Error(`Cleanup refused: ${message}`); }

function awsCli(service, operation, args = []) {
  try {
    const output = execFileSync('aws', [service, operation, ...args, '--profile', PROFILE,
      '--region', REGION, '--output', 'json', '--no-cli-pager', '--cli-connect-timeout', '5', '--cli-read-timeout', '20'],
    {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 25000, maxBuffer: 2 * 1024 * 1024,
      env: {...process.env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off'}});
    return output.trim() ? JSON.parse(output) : {};
  } catch (cause) {
    const code = String(cause.stderr ?? '').match(/An error occurred \(([^)]+)\)/)?.[1] ?? 'COMMAND_FAILED';
    throw Object.assign(new Error(`AWS ${service} ${operation} failed (${code}).`), {awsCode: code});
  }
}

function optionalRead(aws, service, operation, args, missingCodes) {
  try { return aws(service, operation, args); }
  catch (error) { if (missingCodes.includes(error.awsCode)) return null; throw error; }
}

function verifyTags(input, logical, allowEmpty = false) {
  const tags = Array.isArray(input) ? Object.fromEntries(input.map(tag => [tag.Key, tag.Value])) : input ?? {};
  // DynamoDB returned no tags during the observed failure. Its exact ARN and retained
  // CloudFormation membership are still mandatory; any present ownership tag must agree.
  const expected = {'aws:cloudformation:stack-id': STACK_ID, 'aws:cloudformation:stack-name': STACK_NAME,
    'aws:cloudformation:logical-id': logical};
  for (const [key, value] of Object.entries(expected)) {
    if (allowEmpty && tags[key] === undefined) continue;
    if (tags[key] !== value) refuse(`${logical} ownership tags do not match the pinned failed stack.`);
  }
}

function inspectStack(aws) {
  const stack = aws('cloudformation', 'describe-stacks', ['--stack-name', STACK_ID]).Stacks?.[0];
  if (stack?.StackId !== STACK_ID || stack.StackName !== STACK_NAME || stack.StackStatus !== 'ROLLBACK_COMPLETE') {
    refuse(`the pinned stack must be ROLLBACK_COMPLETE (currently ${stack?.StackStatus ?? 'unknown'}).`);
  }
  if (stack.EnableTerminationProtection) refuse('stack termination protection is enabled.');
  const resources = aws('cloudformation', 'list-stack-resources', ['--stack-name', STACK_ID]).StackResourceSummaries ?? [];
  for (const [logical, target] of Object.entries(TARGETS)) {
    const resource = resources.find(row => row.LogicalResourceId === logical);
    if (!resource || resource.PhysicalResourceId !== target.id || resource.ResourceType !== target.type
      || resource.ResourceStatus !== 'DELETE_SKIPPED') refuse(`${logical} is not the exact retained stack resource.`);
  }
  for (const resource of resources) {
    if (!TARGETS[resource.LogicalResourceId] && resource.PhysicalResourceId && resource.ResourceStatus !== 'DELETE_COMPLETE') {
      refuse(`unexpected surviving stack resource ${resource.LogicalResourceId}; review it separately.`);
    }
  }
}

function inspectTable(aws) {
  const result = optionalRead(aws, 'dynamodb', 'describe-table', ['--table-name', TABLE], ['ResourceNotFoundException']);
  if (!result) return null;
  if (result.Table?.TableArn !== TABLE_ARN || result.Table.TableStatus !== 'ACTIVE') refuse('table ARN or state differs.');
  const tags = aws('dynamodb', 'list-tags-of-resource', ['--resource-arn', TABLE_ARN]).Tags;
  verifyTags(tags, 'Table', true);
  const scan = aws('dynamodb', 'scan', ['--table-name', TABLE, '--limit', '1', '--consistent-read', '--select', 'COUNT', '--no-paginate']);
  if (scan.Count !== 0 || scan.ScannedCount !== 0 || scan.LastEvaluatedKey) refuse('the table contains data.');
  return {deletionProtected: result.Table.DeletionProtectionEnabled === true, ownershipTags: tags?.length ?? 0};
}

function inspectPool(aws) {
  const result = optionalRead(aws, 'cognito-idp', 'describe-user-pool', ['--user-pool-id', POOL], ['ResourceNotFoundException']);
  if (!result) return null;
  if (result.UserPool?.Arn !== POOL_ARN || result.UserPool.Id !== POOL) refuse('pool ARN or ID differs.');
  verifyTags(result.UserPool.UserPoolTags, 'UserPool');
  const users = aws('cognito-idp', 'list-users', ['--user-pool-id', POOL, '--limit', '1', '--no-paginate',
    '--query', '{Count:length(Users),Next:PaginationToken}']);
  if (users.Count !== 0 || users.Next) refuse('the Cognito pool contains users.');
  return {deletionProtected: result.UserPool.DeletionProtection === 'ACTIVE'};
}

const bucketArgs = bucket => ['--bucket', bucket, '--expected-bucket-owner', ACCOUNT];

function inspectBucket(aws, bucket, logical, permitStaticVersions) {
  const location = optionalRead(aws, 's3api', 'get-bucket-location', bucketArgs(bucket), ['NoSuchBucket']);
  if (!location) return null;
  if (location.LocationConstraint !== REGION) refuse(`${logical} is outside Sydney.`);
  // Rollback removed the S3 tag sets after their pre-rollback ownership check.
  // The pinned stack membership, bucket ID, expected owner and region remain mandatory.
  const tags = optionalRead(aws, 's3api', 'get-bucket-tagging', bucketArgs(bucket), ['NoSuchTagSet']);
  verifyTags(tags?.TagSet, logical, !tags);
  const multipart = aws('s3api', 'list-multipart-uploads', [...bucketArgs(bucket), '--max-uploads', '1', '--no-paginate']);
  if (multipart.Uploads?.length || multipart.IsTruncated) refuse(`${logical} has pending multipart uploads.`);
  const versions = [];
  let marker, versionMarker;
  const seen = new Set();
  for (let page = 0; page < 10; page++) {
    const args = [...bucketArgs(bucket), '--max-keys', '1000', '--no-paginate'];
    if (marker) args.push('--key-marker', marker);
    if (versionMarker) args.push('--version-id-marker', versionMarker);
    const result = aws('s3api', 'list-object-versions', args);
    if (result.DeleteMarkers?.length) refuse(`${logical} has unexpected delete markers.`);
    for (const version of result.Versions ?? []) {
      const expected = SITE_VERSIONS.find(item => item.Key === version.Key && item.VersionId === version.VersionId);
      if (!permitStaticVersions || !expected || version.Size !== expected.Size
        || String(version.ETag).replaceAll('"', '') !== expected.ETag) refuse(`${logical} contains an unapproved object version.`);
      const identity = `${version.Key}\0${version.VersionId}`;
      if (seen.has(identity)) refuse(`${logical} repeated an object version during listing.`);
      seen.add(identity);
      versions.push({Key: version.Key, VersionId: version.VersionId});
    }
    if (!result.IsTruncated) return {versions};
    if (!result.NextKeyMarker || result.NextKeyMarker === marker && result.NextVersionIdMarker === versionMarker) refuse('incomplete S3 version listing.');
    marker = result.NextKeyMarker;
    versionMarker = result.NextVersionIdMarker;
  }
  refuse('S3 version listing exceeded the inspection limit.');
}

export function inspectRecovery(aws = awsCli) {
  if (aws('sts', 'get-caller-identity').Account !== ACCOUNT) refuse('AWS account differs from the pinned account.');
  inspectStack(aws);
  return {table: inspectTable(aws), pool: inspectPool(aws),
    resume: inspectBucket(aws, RESUME_BUCKET, 'ResumeBucket', false),
    site: inspectBucket(aws, SITE_BUCKET, 'SiteBucket', true)};
}

async function waitUntil(check, name) {
  const deadline = Date.now() + 45000;
  while (!check()) {
    if (Date.now() > deadline) refuse(`${name} is still pending; inspect before retrying.`);
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

export async function cleanupFailedDeployment({apply = false, aws = awsCli, log = console.log} = {}) {
  const state = inspectRecovery(aws);
  log(JSON.stringify({mode: apply ? 'apply' : 'dry-run', account: ACCOUNT, profile: PROFILE, stackId: STACK_ID,
    targets: TARGETS, alreadyMissing: Object.entries(state).filter(([, value]) => !value).map(([key]) => key),
    knownSiteVersions: state.site?.versions ?? [], tableOwnership: 'Exact ARN + retained stack membership; tags checked when present',
    plan: ['Disable protection and delete the empty table', 'Disable protection and delete the empty Cognito pool',
      'Delete only pinned site versions and its empty bucket', 'Delete the empty resume bucket', 'Delete the exact failed stack'],
    recovery: 'No customer data is allowed. Static artifacts can be rebuilt from the local project.'}, null, 2));
  if (!apply) return {dryRun: true};

  // Re-read the complete inspection before the first mutation and each target before deleting it.
  inspectRecovery(aws);
  const table = inspectTable(aws);
  if (table) {
    if (table.deletionProtected) {
      aws('dynamodb', 'update-table', ['--table-name', TABLE, '--no-deletion-protection-enabled']);
      await waitUntil(() => {
        const current = aws('dynamodb', 'describe-table', ['--table-name', TABLE]).Table;
        if (current?.TableArn !== TABLE_ARN) refuse('table ARN changed during protection update.');
        return current.TableStatus === 'ACTIVE' && current.DeletionProtectionEnabled === false;
      }, 'table protection update');
    }
    inspectTable(aws);
    aws('dynamodb', 'delete-table', ['--table-name', TABLE]);
    await waitUntil(() => !optionalRead(aws, 'dynamodb', 'describe-table', ['--table-name', TABLE], ['ResourceNotFoundException']), 'table deletion');
  }
  const pool = inspectPool(aws);
  if (pool) {
    if (pool.deletionProtected) aws('cognito-idp', 'update-user-pool', ['--user-pool-id', POOL, '--deletion-protection', 'INACTIVE', '--auto-verified-attributes', 'email']);
    inspectPool(aws);
    aws('cognito-idp', 'delete-user-pool', ['--user-pool-id', POOL]);
    await waitUntil(() => !optionalRead(aws, 'cognito-idp', 'describe-user-pool', ['--user-pool-id', POOL], ['ResourceNotFoundException']), 'Cognito pool deletion');
  }
  const site = inspectBucket(aws, SITE_BUCKET, 'SiteBucket', true);
  if (site) {
    if (site.versions.length) {
      const result = aws('s3api', 'delete-objects', [...bucketArgs(SITE_BUCKET), '--delete', JSON.stringify({Objects: site.versions, Quiet: false})]);
      if (result.Errors?.length || result.Deleted?.length !== site.versions.length) refuse('site-version deletion was incomplete.');
    }
    if (inspectBucket(aws, SITE_BUCKET, 'SiteBucket', true)?.versions.length) refuse('site bucket is not empty after deletion.');
    aws('s3api', 'delete-bucket', bucketArgs(SITE_BUCKET));
  }
  if (inspectBucket(aws, RESUME_BUCKET, 'ResumeBucket', false)) aws('s3api', 'delete-bucket', bucketArgs(RESUME_BUCKET));
  inspectStack(aws);
  aws('cloudformation', 'delete-stack', ['--stack-name', STACK_ID]);
  log(JSON.stringify({cleanupRequested: true, failedStackDeletionRequested: STACK_ID,
    removed: 'Only the four pinned resources and approved static versions; no customer records or users were present.'}));
  return {cleanupRequested: true};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply') || args.length > 1) {
    console.error('Usage: node scripts/cleanup-failed-deployment.mjs [--apply]');
    process.exitCode = 1;
  } else {
    try { await cleanupFailedDeployment({apply: args.includes('--apply')}); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
