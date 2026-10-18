import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const ACCOUNT = '037169690315';
const REGION = 'ap-southeast-2';
const PROFILE = process.env.AWS_PROFILE || (process.env.GITHUB_ACTIONS === 'true' ? '' : 'proairesis-management');
const APPLY = process.argv.includes('--apply');
const NAMES = Object.freeze([
  '/roleclue/member-app/guest-rate-hash-secret',
]);

function identity() {
  const profileArguments = PROFILE ? ['--profile', PROFILE] : [];
  return JSON.parse(execFileSync('aws', [
    'sts', 'get-caller-identity', ...profileArguments, '--region', REGION,
    '--no-cli-pager', '--output', 'json',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }));
}

const caller = identity();
if (caller.Account !== ACCOUNT) throw new Error('Refusing to use an unexpected AWS account.');
if (PROFILE) process.env.AWS_PROFILE = PROFILE;
process.env.AWS_REGION = REGION;
const ssm = new SSMClient({ region: REGION, maxAttempts: 2 });
const existing = [];
const missing = [];

for (const name of NAMES) {
  try {
    const result = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: false }));
    if (result.Parameter?.Name !== name || result.Parameter.Type !== 'SecureString') {
      throw new Error(`${name} exists but is not an SSM SecureString.`);
    }
    existing.push(name);
  } catch (error) {
    if (error.name !== 'ParameterNotFound') throw error;
    missing.push(name);
  }
}

const created = [];
if (APPLY) {
  for (const name of missing) {
    await ssm.send(new PutParameterCommand({
      Name: name,
      Type: 'SecureString',
      Tier: 'Standard',
      Value: randomBytes(48).toString('base64url'),
      Description: 'RoleClue production runtime secret. Managed by the member-app release process.',
      Overwrite: false,
    }));
    created.push(name);
  }
}

console.log(JSON.stringify({
  account: caller.Account,
  region: REGION,
  mode: APPLY ? 'apply' : 'dry-run',
  existing,
  missing: APPLY ? missing.filter(name => !created.includes(name)) : missing,
  created,
}));
ssm.destroy();
if (!APPLY && missing.length) process.exitCode = 2;
