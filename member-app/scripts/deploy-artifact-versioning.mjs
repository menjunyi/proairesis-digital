import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ACCOUNT = '037169690315';
const REGION = 'ap-southeast-2';
const STACK = 'roleclue-member-artifacts';
const PROFILE = process.env.AWS_PROFILE || (process.env.GITHUB_ACTIONS === 'true' ? '' : 'proairesis-management');
const mode = process.argv[2];
const requestedChangeSet = process.argv[3];

if (!['--plan', '--execute-existing'].includes(mode)) {
  throw new Error('Usage: node scripts/deploy-artifact-versioning.mjs --plan | --execute-existing CHANGE_SET_NAME');
}

function run(args, options = {}) {
  const profileArguments = PROFILE ? ['--profile', PROFILE] : [];
  return execFileSync('aws', [...args, ...profileArguments, '--region', REGION, '--no-cli-pager'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: options.timeout ?? 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}
const json = args => JSON.parse(run([...args, '--output', 'json']));
const optionalJson = args => {
  const output = run([...args, '--output', 'json']).trim();
  return output ? JSON.parse(output) : {};
};
const requireValue = (value, message) => { if (!value) throw new Error(message);return value; };
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const summarizedChanges = changeSet => (changeSet.Changes ?? []).map(item => ({
  action:item.ResourceChange?.Action, logicalResourceId:item.ResourceChange?.LogicalResourceId,
  resourceType:item.ResourceChange?.ResourceType, replacement:item.ResourceChange?.Replacement,
}));
const requireSafeChanges = changes => requireValue(changes.length > 0 && changes.every(change =>
  ['Artifacts', 'Policy'].includes(change.logicalResourceId) && change.action === 'Modify' && change.replacement === 'False'),
'Refusing an artifact-stack change set that does more than update the retained bucket or its policy in place.');

requireValue(json(['sts', 'get-caller-identity']).Account === ACCOUNT, 'Refusing to update an unexpected AWS account.');
const stack = json(['cloudformation', 'describe-stacks', '--stack-name', STACK]).Stacks?.[0];
requireValue(stack?.StackId?.startsWith(`arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${STACK}/`) &&
  ['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(stack.StackStatus), 'The RoleClue artifact stack is not stable in the expected account.');
const resources = json(['cloudformation', 'list-stack-resources', '--stack-name', STACK]).StackResourceSummaries ?? [];
const bucket = resources.find(resource => resource.LogicalResourceId === 'Artifacts' && resource.ResourceType === 'AWS::S3::Bucket')?.PhysicalResourceId;
requireValue(bucket && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket), 'The retained RoleClue artifact bucket could not be identified.');
const versioning = optionalJson(['s3api', 'get-bucket-versioning', '--bucket', bucket, '--expected-bucket-owner', ACCOUNT]);
const templateText = await readFile(resolve('build/artifacts.template.json'), 'utf8');
const template = JSON.parse(templateText);
requireValue(template.Resources?.Artifacts?.Properties?.VersioningConfiguration?.Status === 'Enabled',
  'Generate the current artifact template with bucket versioning enabled before planning.');
const templateSha256 = createHash('sha256').update(templateText).digest('hex');
const changeSetName = `roleclue-artifacts-versioning-${templateSha256.slice(0,12)}`;

if (mode === '--plan') {
  requireValue(versioning.Status !== 'Enabled', 'Artifact bucket versioning is already enabled; no bootstrap update is needed.');
  const tags = (stack.Tags ?? []).map(({Key,Value}) => ({Key,Value}));
  const tagFile = resolve('build/artifact-versioning-tags.json');
  await writeFile(tagFile, JSON.stringify(tags, null, 2));
  run(['cloudformation','create-change-set','--stack-name',STACK,'--change-set-name',changeSetName,
    '--change-set-type','UPDATE','--description',`Enable immutable RoleClue artifact versions from ${templateSha256}`,
    '--template-body',`file://${resolve('build/artifacts.template.json')}`,'--tags',`file://${tagFile}`]);
  try { run(['cloudformation','wait','change-set-create-complete','--stack-name',STACK,'--change-set-name',changeSetName], {timeout:900_000}); }
  catch {
    const failed=json(['cloudformation','describe-change-set','--stack-name',STACK,'--change-set-name',changeSetName]);
    throw new Error(`Artifact versioning change-set creation failed: ${failed.StatusReason ?? failed.Status}`);
  }
  const planned=json(['cloudformation','describe-change-set','--stack-name',STACK,'--change-set-name',changeSetName]);
  requireValue(planned.Status==='CREATE_COMPLETE'&&planned.ExecutionStatus==='AVAILABLE','The artifact versioning change set is not available.');
  const changes=summarizedChanges(planned);requireSafeChanges(changes);
  const evidence={account:ACCOUNT,region:REGION,stack:STACK,stackId:stack.StackId,bucket,changeSetName,
    changeSetId:planned.ChangeSetId,templateSha256,changes,createdAt:planned.CreationTime};
  await writeFile(resolve('build/artifact-versioning-plan.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
  process.exit(0);
}

requireValue(requestedChangeSet===changeSetName,'Use the exact artifact versioning change-set name printed by --plan.');
const evidence=JSON.parse(await readFile(resolve('build/artifact-versioning-plan.json'),'utf8'));
const planned=json(['cloudformation','describe-change-set','--stack-name',STACK,'--change-set-name',requestedChangeSet]);
requireValue(planned.Status==='CREATE_COMPLETE'&&['AVAILABLE','EXECUTE_COMPLETE'].includes(planned.ExecutionStatus)&&planned.ChangeSetId===evidence.changeSetId&&
  evidence.account===ACCOUNT&&evidence.stackId===stack.StackId&&evidence.bucket===bucket&&evidence.templateSha256===templateSha256,
'The artifact versioning plan does not match this exact stack, template and reviewed change set.');
const changes=summarizedChanges(planned);requireSafeChanges(changes);
requireValue(canonicalJson(changes)===canonicalJson(evidence.changes),'The artifact versioning changes differ from the reviewed plan.');
const reviewed=json(['cloudformation','get-template','--stack-name',STACK,'--change-set-name',requestedChangeSet,'--template-stage','Processed']);
const reviewedBody=typeof reviewed.TemplateBody==='string'?JSON.parse(reviewed.TemplateBody):reviewed.TemplateBody;
requireValue(canonicalJson(reviewedBody)===canonicalJson(template),'The reviewed artifact template differs from the local template.');
run(['cloudformation','update-termination-protection','--enable-termination-protection','--stack-name',STACK]);
if(planned.ExecutionStatus==='AVAILABLE'){
  run(['cloudformation','execute-change-set','--stack-name',STACK,'--change-set-name',requestedChangeSet]);
  run(['cloudformation','wait','stack-update-complete','--stack-name',STACK],{timeout:1800_000});
}
const deployed=optionalJson(['s3api','get-bucket-versioning','--bucket',bucket,'--expected-bucket-owner',ACCOUNT]);
requireValue(deployed.Status==='Enabled','Artifact bucket versioning was not enabled after the stack update.');
const result={...evidence,status:'UPDATE_COMPLETE',versioning:deployed.Status,
  resumedPostDeployment:planned.ExecutionStatus==='EXECUTE_COMPLETE',completedAt:new Date().toISOString()};
await writeFile(resolve('build/artifact-versioning-evidence.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
