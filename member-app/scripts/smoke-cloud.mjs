import {spawn} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CognitoIdentityProviderClient, DescribeUserPoolCommand, AdminCreateUserCommand, AdminGetUserCommand, AdminSetUserPasswordCommand} from '@aws-sdk/client-cognito-identity-provider';
import {InvokeCommand, LambdaClient} from '@aws-sdk/client-lambda';
import {aiAuthorityReviewMessage, stripePortalConfigurationId} from '../infra/template.mjs';
import {HEARTBEAT_BOOTSTRAPS, alarmsOutsideOk, heartbeatBootstrapPlan, resolveAlarmNames, verifyAlarmContracts, verifyHeartbeatInvocation, waitForAlarmsOk} from './smoke-alarms.mjs';
import {verifyLiveRelease, writeSmokeEvidence} from './smoke-evidence.mjs';

// Deliberately not part of npm test or deployment. It creates exactly two
// synthetic, suppressed-email identities, then deletes both via the app API.
// Usage (only after reviewing the target deployment):
// ROLECLUE_RUN_CLOUD_SMOKE=1 ROLECLUE_EXPECTED_SOURCE_REVISION=<40-hex>
// node scripts/smoke-cloud.mjs
// Optional AWS_PROFILE (default proairesis-management), ROLECLUE_STACK_NAME
// (default roleclue-member-app), ROLECLUE_TEST_SIGNED_UPLOAD=1 (adds an HTTP/S3
// CORS check and waits up to seven minutes for its grant before cleanup), or
// API checks always use the public same-origin CloudFront path. Direct API
// Gateway access is intentionally rejected in production.
// This script never reads SSM secrets, sends email, creates a checkout, or
// invokes an AI provider. If a fresh heartbeat alarm is not OK, the separate
// ROLECLUE_BOOTSTRAP_HEARTBEATS=1 opt-in runs the affected live daily job; that
// can refresh the shared job catalog and enqueue registered-user work.
// Signed-upload checks are not browser acceptance.
const ACCOUNT = '037169690315';
const REGION = 'ap-southeast-2';
const METRIC_FILTERS = [
  ['"generation_reconciliation_required"', 'GenerationReconciliationRequired'],
  ['"generation_dispatch_repair_failed"', 'GenerationDispatchRepairFailed'],
  ['"daily_refresh_completed"', 'DailyRefreshCompleted'],
  ['"daily_billing_reconciliation_completed"', 'DailyBillingReconciliationCompleted'],
  ['"generation_repair_completed"', 'GenerationRepairCompleted'],
];
class SmokeCheckError extends Error {}

function requireCheck(condition, label) {
  if (!condition) throw new SmokeCheckError(label);
}

function report(check, result = 'passed') {
  console.log(JSON.stringify({check, result}));
}

// Cognito request bodies, including passwords, stay in SDK memory. Only the
// allowlisted, non-sensitive read checks pass JSON through CLI argv. No shell
// is used, and every AWS call resolves the explicitly selected profile.
function createAws(profile) {
  const cognito = new CognitoIdentityProviderClient({region: REGION, maxAttempts: 2});
  const lambda = new LambdaClient({region: REGION, maxAttempts: 2});
  const cognitoCommands = {
    'describe-user-pool': DescribeUserPoolCommand,
    'admin-create-user': AdminCreateUserCommand,
    'admin-get-user': AdminGetUserCommand,
    'admin-set-user-password': AdminSetUserPasswordCommand,
  };
  const cliReads = new Set([
    'sts:get-caller-identity', 'cloudformation:describe-stacks', 'cloudformation:describe-stack-resources',
    'lambda:get-alias', 'lambda:get-function-configuration', 'lambda:list-event-source-mappings',
    'scheduler:get-schedule', 'cloudwatch:describe-alarms', 'logs:describe-metric-filters',
    'sqs:get-queue-attributes', 'dynamodb:query',
    'dynamodb:get-item', 's3api:list-objects-v2', 'sns:list-subscriptions-by-topic',
  ]);
  return async (service, operation, input = {}) => {
    if (service === 'cognito-idp') {
      const Command = Object.hasOwn(cognitoCommands, operation) ? cognitoCommands[operation] : null;
      requireCheck(Command, 'Cognito smoke operation is not allowlisted');
      try {
        return await cognito.send(new Command(input), {abortSignal: AbortSignal.timeout(45000)});
      } catch (cause) {
        const error = new SmokeCheckError(`AWS ${service} ${operation} failed`);
        if (cause.name === 'UserNotFoundException') error.code = 'UserNotFoundException';
        throw error;
      }
    }
    if (service === 'lambda' && operation === 'invoke') {
      try {
        return await lambda.send(new InvokeCommand(input), {abortSignal: AbortSignal.timeout(45000)});
      } catch {
        throw new SmokeCheckError('AWS lambda invoke failed');
      }
    }
    requireCheck(cliReads.has(`${service}:${operation}`), 'CLI smoke operation is not an allowlisted read');
    const jsonInput = JSON.stringify(input);
    requireCheck(!/"[^"\\]*(?:password|token|secret|authorization|credential)[^"\\]*"\s*:/i.test(jsonInput),
      'Sensitive fields must not be passed through CLI arguments');
    const output = await new Promise((resolveOutput, reject) => {
      const profileArguments = profile ? ['--profile', profile] : [];
      const child = spawn('aws', [service, operation, ...profileArguments, '--region', REGION,
        '--no-cli-pager', '--output', 'json', '--cli-connect-timeout', '10',
        '--cli-read-timeout', '30', '--cli-input-json', jsonInput],
      {stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, AWS_MAX_ATTEMPTS: '2'}});
      let stdout = '', stderr = '', finished = false;
      const finish = (error, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolveOutput(value);
      };
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        finish(new SmokeCheckError(`AWS ${service} ${operation} timed out`));
      }, 45000);
      child.on('error', () => finish(new SmokeCheckError('AWS CLI could not start')));
      child.stdout.on('data', chunk => {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > 2 * 1024 * 1024) {
          child.kill('SIGTERM');
          finish(new SmokeCheckError(`AWS ${service} ${operation} response exceeded its limit`));
        }
      });
      child.stderr.on('data', chunk => {if (stderr.length < 16384) stderr += chunk;});
      child.on('close', code => {
        if (code !== 0) {
          const error = new SmokeCheckError(`AWS ${service} ${operation} failed`);
          // This classification is only used to verify exact test identities
          // were deleted. Never copy the potentially sensitive CLI stderr.
          if (stderr.includes('(UserNotFoundException)')) error.code = 'UserNotFoundException';
          finish(error);
        } else finish(null, stdout);
      });
    });
    try {return output.trim() ? JSON.parse(output) : {};} catch {throw new SmokeCheckError(`AWS ${service} ${operation} returned invalid JSON`);}
  };
}

export function syntheticResumePdf(marker = 'ROLECLUE SYNTHETIC ACCEPTANCE RESUME') {
  requireCheck(/^[A-Z0-9 -]{1,100}$/.test(marker), 'Invalid synthetic fixture marker');
  const lines = [marker, 'Alex Example - this is not a real person.',
    'Software engineer with four years of relevant experience.',
    'Built TypeScript and React interfaces for internal software tools.',
    'Deployed services on AWS and documented release processes.',
    'Worked with SQL databases, Git and collaborative Agile teams.',
    'Sydney, Australia. Synthetic deployment acceptance data only.'];
  const stream = 'BT /F1 12 Tf 50 730 Td 20 TL ' + lines.map((line, i) => `${i ? 'T* ' : ''}(${line}) Tj`).join('\n') + ' ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`;});
  const start = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(text);
}

async function jsonResponse(response) {
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    requireCheck(length <= 512 * 1024, 'HTTP response exceeded its limit');
    chunks.push(chunk);
  }
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new SmokeCheckError(`HTTP ${response.status} response was not JSON`);}
}

export async function runCloudSmoke(env = process.env) {
  requireCheck(env.ROLECLUE_RUN_CLOUD_SMOKE === '1', 'Refusing cloud writes: set ROLECLUE_RUN_CLOUD_SMOKE=1 explicitly');
  requireCheck(!env.AWS_REGION || env.AWS_REGION === REGION, `Smoke region must be ${REGION}`);
  const startedAt = new Date().toISOString();
  const checks = [];
  const record = (label, result = 'passed') => {
    checks.push({label, result});
    report(label, result);
  };
  const profile = env.AWS_PROFILE || (env.GITHUB_ACTIONS === 'true' ? '' : 'proairesis-management');
  if (profile) process.env.AWS_PROFILE = profile;
  const stackName = env.ROLECLUE_STACK_NAME || 'roleclue-member-app';
  requireCheck(/^roleclue-member-app(?:-[a-z0-9-]+)?$/.test(stackName), 'Only the RoleClue member-app stack is in scope');
  const expectedSourceRevision=String(env.ROLECLUE_EXPECTED_SOURCE_REVISION??'').trim();
  requireCheck(/^[a-f0-9]{40}$/.test(expectedSourceRevision), 'Set ROLECLUE_EXPECTED_SOURCE_REVISION to the exact deployed Git revision');
  const aws = createAws(profile);
  const caller = await aws('sts', 'get-caller-identity');
  requireCheck(caller.Account === ACCOUNT, 'AWS account mismatch; nothing was changed');
  const described = await aws('cloudformation', 'describe-stacks', {StackName: stackName});
  const stack = described.Stacks?.[0];
  requireCheck(stack?.StackId?.startsWith(`arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${stackName}/`), 'Stack account or region mismatch');
  requireCheck(['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus), 'Stack is not in a completed state');
  const outputs = Object.fromEntries((stack.Outputs ?? []).map(item => [item.OutputKey, item.OutputValue]));
  for (const key of ['SiteUrl', 'ApiUrl', 'DistributionDomain', 'CognitoUserPoolId', 'CognitoClientId', 'FunctionName', 'FunctionVersion', 'FunctionAliasArn', 'TableName', 'ResumeBucket', 'GenerationQueueUrl', 'RecommendationQueueUrl', 'FailedWorkQueueUrl', 'GenerationQueueArn', 'RecommendationQueueArn', 'FailedWorkQueueArn', 'DailyRefreshScheduleName', 'GenerationRepairScheduleName', 'BillingReconciliationScheduleName', 'AiAuthorityReviewScheduleName', 'LogGroupName', 'AlarmTopicArn']) requireCheck(outputs[key], `Stack output ${key} is missing`);
  const testSignedUpload = env.ROLECLUE_TEST_SIGNED_UPLOAD === '1';
  const uploadOrigin = 'https://app.proairesis.digital';
  requireCheck(outputs.SiteUrl === uploadOrigin, 'Smoke checks require the approved app origin');
  if (testSignedUpload) requireCheck(outputs.SiteUrl === uploadOrigin, 'Signed-upload CORS check requires the approved app origin');
  const api = new URL(outputs.ApiUrl);
  requireCheck(api.protocol === 'https:' && !api.username && !api.password && !api.port &&
    /^[a-z0-9]+\.execute-api\.ap-southeast-2\.amazonaws\.com$/.test(api.hostname) &&
    api.pathname === '/' && !api.search && !api.hash, 'Unexpected API origin');
  requireCheck(typeof outputs.DistributionDomain === 'string' && /^[a-z0-9]+\.cloudfront\.net$/.test(outputs.DistributionDomain),
    'CloudFront distribution output is missing or invalid');
  const requestBase = new URL(outputs.SiteUrl);
  const expectedReleaseId=stack.Parameters?.find(item=>item.ParameterKey==='ReleaseId')?.ParameterValue;
  const liveRelease = await verifyLiveRelease({aws, outputs, siteUrl: outputs.SiteUrl, expectedReleaseId, expectedSourceRevision, check: requireCheck});
  const functionConfig = liveRelease.configuration;
  requireCheck(functionConfig.FunctionArn?.startsWith(`arn:aws:lambda:${REGION}:${ACCOUNT}:function:`), 'Lambda account mismatch');
  const variables = functionConfig.Environment?.Variables ?? {};
  requireCheck(variables.TABLE_NAME === outputs.TableName && variables.RESUME_BUCKET === outputs.ResumeBucket && variables.COGNITO_USER_POOL_ID === outputs.CognitoUserPoolId, 'Lambda storage or identity outputs mismatch');
  requireCheck(Boolean(variables.STRIPE_PRICE_ID) && Boolean(variables.STRIPE_STARTER_PRICE_ID) &&
    variables.STRIPE_PORTAL_CONFIGURATION_ID === stripePortalConfigurationId &&
    Number(variables.OPENAI_DAILY_CALL_LIMIT) > 0 && Number(variables.OPENAI_DAILY_TOKEN_LIMIT) > 0 &&
    variables.FREEHIRE_ENABLED === 'true' && variables.FREEHIRE_LICENSE_APPROVED === 'true' &&
    variables.GENERATION_QUEUE_URL === outputs.GenerationQueueUrl &&
    variables.RECOMMENDATION_QUEUE_URL === outputs.RecommendationQueueUrl && variables.ROLECLUE_LOCAL_DEMO !== '1',
  'Billing, AI, job search and durable generation must be configured for production');
  const pool = (await aws('cognito-idp', 'describe-user-pool', {UserPoolId: outputs.CognitoUserPoolId})).UserPool;
  requireCheck(pool?.Arn === `arn:aws:cognito-idp:${REGION}:${ACCOUNT}:userpool/${outputs.CognitoUserPoolId}`, 'Cognito account mismatch');
  requireCheck(pool.EmailConfiguration?.EmailSendingAccount==='DEVELOPER'&&pool.EmailConfiguration?.SourceArn===`arn:aws:ses:${REGION}:${ACCOUNT}:identity/proairesis.digital`
    &&pool.EmailConfiguration?.From==='RoleClue <hello@proairesis.digital>'&&pool.EmailConfiguration?.ReplyToEmailAddress==='support@proairesis.digital',
  'Cognito is not using the verified RoleClue SES sender');
  requireCheck(Object.keys(pool.LambdaConfig ?? {}).length === 0, 'Unexpected Cognito triggers; refusing synthetic user creation');
  const alertSubscriptions=(await aws('sns','list-subscriptions-by-topic',{TopicArn:outputs.AlarmTopicArn})).Subscriptions??[];
  requireCheck(alertSubscriptions.some(item=>item.Protocol==='email'&&item.Endpoint==='support@proairesis.digital'&&
    typeof item.SubscriptionArn==='string'&&item.SubscriptionArn.startsWith(`arn:aws:sns:${REGION}:${ACCOUNT}:`)),
  'The production alert email subscription is not confirmed');
  record('deployed frontend manifest matches the protected live Lambda alias and code hash');

  const mappings=(await aws('lambda','list-event-source-mappings',{FunctionName:outputs.FunctionAliasArn})).EventSourceMappings??[];
  for (const queueArn of [outputs.GenerationQueueArn,outputs.RecommendationQueueArn]) {
    const matching=mappings.filter(item=>item.EventSourceArn===queueArn&&item.FunctionArn===outputs.FunctionAliasArn);
    requireCheck(matching.length===1&&matching[0].State==='Enabled',`The live Lambda event-source mapping for ${queueArn.split(':').at(-1)} is not enabled`);
  }
  const schedules = [
    [outputs.DailyRefreshScheduleName, 'feed-refresh'],
    [outputs.GenerationRepairScheduleName, 'generation-repair'],
    [outputs.BillingReconciliationScheduleName, 'billing-reconciliation'],
  ];
  let scheduleRoleArn;
  for (const [name,kind] of schedules) {
    const schedule=await aws('scheduler','get-schedule',{Name:name});
    let input;
    try {input=JSON.parse(schedule.Target?.Input??'');} catch {input=null;}
    requireCheck(schedule.State==='ENABLED'&&schedule.Target?.Arn===outputs.FunctionAliasArn&&input?.kind===kind
      &&schedule.Target?.DeadLetterConfig?.Arn===outputs.FailedWorkQueueArn&&schedule.Target?.RoleArn,
      `The ${kind} schedule is not enabled on the live alias`);
    scheduleRoleArn??=schedule.Target.RoleArn;
    requireCheck(schedule.Target.RoleArn===scheduleRoleArn,`The ${kind} schedule uses an unexpected execution role`);
  }
  const authoritySchedule=await aws('scheduler','get-schedule',{Name:outputs.AiAuthorityReviewScheduleName});
  const authorityInput=JSON.stringify({event:'roleclue_ai_authority_review',message:aiAuthorityReviewMessage,pricingExpiresAt:'2026-11-11T13:00:00.000Z'});
  requireCheck(authoritySchedule.State==='ENABLED'&&authoritySchedule.Target?.Arn===outputs.AlarmTopicArn
    &&authoritySchedule.Target?.Input===authorityInput&&authoritySchedule.Target?.RoleArn===scheduleRoleArn
    &&authoritySchedule.Target?.DeadLetterConfig?.Arn===outputs.FailedWorkQueueArn
    &&authoritySchedule.Target?.RetryPolicy?.MaximumRetryAttempts===2
    &&authoritySchedule.Target?.RetryPolicy?.MaximumEventAgeInSeconds===3600,
  'The one-time AI authority review is not configured as a direct production alert');
  const stackResources=(await aws('cloudformation','describe-stack-resources',{StackName:stackName})).StackResources??[];
  const alarmNamesByLogicalId=resolveAlarmNames(stackResources,requireCheck);
  const alarmNames=[...alarmNamesByLogicalId.values()];
  const readAlarms=async (names=alarmNames)=>(await aws('cloudwatch','describe-alarms',{AlarmNames:names})).MetricAlarms??[];
  let alarms=await readAlarms();
  verifyAlarmContracts({alarms,namesByLogicalId:alarmNamesByLogicalId,alarmTopicArn:outputs.AlarmTopicArn,check:requireCheck});
  const heartbeatNames=new Set(HEARTBEAT_BOOTSTRAPS.map(item=>alarmNamesByLogicalId.get(item.logicalId)));
  requireCheck(alarmsOutsideOk(alarms,alarmNames.filter(name=>!heartbeatNames.has(name))).length===0,
    'A non-heartbeat production alarm is not OK; heartbeat bootstrap was not attempted');
  const bootstrapPlan=heartbeatBootstrapPlan(alarms,alarmNamesByLogicalId);
  if (bootstrapPlan.length) {
    requireCheck(env.ROLECLUE_BOOTSTRAP_HEARTBEATS==='1',
      'Heartbeat alarms need bootstrap; review the source-pinned release, then set ROLECLUE_BOOTSTRAP_HEARTBEATS=1');
    for (const {kind} of bootstrapPlan) {
      const invoked=await aws('lambda','invoke',{FunctionName:outputs.FunctionAliasArn,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({kind}))});
      verifyHeartbeatInvocation(invoked,outputs.FunctionVersion,kind,requireCheck);
    }
    record('source-pinned heartbeat jobs invoked on the protected live Lambda version');
    const heartbeatAlarmNames=[...heartbeatNames];
    const settled=await waitForAlarmsOk({
      alarmNames:heartbeatAlarmNames,
      readAlarms:()=>readAlarms(heartbeatAlarmNames),
      onPoll:({pendingCount})=>report(`waiting for ${pendingCount} heartbeat alarm state updates`,'pending'),
    });
    requireCheck(!settled.timedOut,`Heartbeat alarms did not become OK within the bounded wait: ${settled.pending.join(', ')}`);
    alarms=await readAlarms();
  }
  requireCheck(alarmsOutsideOk(alarms,alarmNames).length===0,'One or more production alarms are not OK');
  const filters=(await aws('logs','describe-metric-filters',{logGroupName:outputs.LogGroupName,limit:50})).metricFilters??[];
  for (const [pattern,metricName] of METRIC_FILTERS) {
    requireCheck(filters.some(filter=>filter.filterPattern===pattern&&filter.metricTransformations?.some(transform=>
      transform.metricNamespace==='RoleClue'&&transform.metricName===metricName&&transform.metricValue==='1')),
    `Metric filter ${metricName} is missing or invalid`);
  }
  requireCheck(!filters.some(filter=>filter.metricTransformations?.some(transform=>transform.metricName==='AiAuthorityReviewRequired')),
    'The retired AI authority-review metric filter still exists');
  record('event mappings, daily refresh, billing reconciliation, generation repair, alarms, log metrics, direct AI authority notice and confirmed alert email verified');
  record('target account, stack, storage, Cognito and production providers verified');

  const queueStates = async () => {
    const attributes=['ApproximateNumberOfMessages','ApproximateNumberOfMessagesNotVisible','ApproximateNumberOfMessagesDelayed'];
    const pending=[];
    for (const [label,queueUrl] of [['generation queue',outputs.GenerationQueueUrl],['recommendation queue',outputs.RecommendationQueueUrl],['shared dead-letter queue',outputs.FailedWorkQueueUrl]]) {
      const state=await aws('sqs','get-queue-attributes',{QueueUrl:queueUrl,AttributeNames:attributes});
      requireCheck(attributes.every(name=>Number.isSafeInteger(Number(state.Attributes?.[name]))),`${label} returned invalid queue attributes`);
      if (!attributes.every(name=>Number(state.Attributes?.[name])===0)) pending.push(label);
    }
    return pending;
  };
  const waitForEmptyQueues = async () => {
    const deadline=Date.now()+8*60*1000;
    while (true) {
      const pending=await queueStates();
      if (!pending.length) return;
      requireCheck(Date.now()<deadline,`Queues did not drain within the bounded wait: ${pending.join(', ')}`);
      report(`waiting for ${pending.length} production queues to drain`,'pending');
      await new Promise(resolveWait=>setTimeout(resolveWait,15000));
    }
  };

  const request = async (method, path, body, token, extraHeaders = {}) => {
    const response = await fetch(new URL(path, requestBase), {method, redirect: 'error', signal: AbortSignal.timeout(35000),
      headers: {'Content-Type': 'application/json', Origin: outputs.SiteUrl,
        ...(token ? {Authorization: `Bearer ${token}`} : {}), ...extraHeaders},
      ...(body === undefined ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)})});
    requireCheck(response.headers.get('x-amz-cf-id'), 'API response did not include CloudFront forwarding evidence');
    return {status: response.status, body: await jsonResponse(response)};
  };
  const expect = (response, status, label) => {
    requireCheck(response.status === status, `${label}: expected HTTP ${status}, received ${response.status}`);
    return response.body;
  };
  const signIn = async identity => {
    const response = await fetch(`https://cognito-idp.${REGION}.amazonaws.com/`, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: {'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'},
      body: JSON.stringify({AuthFlow: 'USER_PASSWORD_AUTH', ClientId: outputs.CognitoClientId, AuthParameters: {USERNAME: identity.email, PASSWORD: identity.password}})});
    const result = await jsonResponse(response);
    requireCheck(response.ok && result.AuthenticationResult?.IdToken, 'Synthetic Cognito password sign-in failed');
    identity.token = result.AuthenticationResult.IdToken;
    const claims = JSON.parse(Buffer.from(identity.token.split('.')[1], 'base64url').toString('utf8'));
    // This is a sanity check, not JWT verification. API Gateway performs actual
    // signature, issuer and audience verification on every authenticated call.
    requireCheck(claims.sub === identity.sub && claims.email === identity.email && claims.email_verified === true, 'Synthetic ID-token claims mismatch');
  };
  const identify = async identity => {
    const result = await aws('cognito-idp', 'admin-get-user', {UserPoolId: outputs.CognitoUserPoolId, Username: identity.email});
    const attributes = Object.fromEntries((result.UserAttributes ?? []).map(item => [item.Name, item.Value]));
    requireCheck(attributes.email === identity.email && /^[a-f0-9-]{36}$/i.test(attributes.sub ?? ''), 'Synthetic identity attributes mismatch');
    identity.sub = attributes.sub;
    identity.username = result.Username;
  };
  const setPassword = identity => aws('cognito-idp', 'admin-set-user-password', {UserPoolId: outputs.CognitoUserPoolId, Username: identity.email, Password: identity.password, Permanent: true});
  const waitForUploadGrant = async identity => {
    if (!identity.signedUploadAttempted) return;
    const state = await aws('dynamodb', 'get-item', {
      TableName: outputs.TableName,
      Key: {pk: {S: `USER#${identity.sub}`}, sk: {S: 'UPLOAD_STATE'}},
      ConsistentRead: true,
      ProjectionExpression: '#value.#until',
      ExpressionAttributeNames: {'#value': 'value', '#until': 'activeGrantUntil'},
    });
    if (!state.Item) return;
    const activeGrantUntil = Number(state.Item.value?.M?.activeGrantUntil?.N);
    requireCheck(Number.isSafeInteger(activeGrantUntil) && activeGrantUntil > 0, 'Upload grant expiry is invalid; cleanup needs operator review');
    const deadline = activeGrantUntil + 1000;
    requireCheck(deadline - Date.now() <= 7 * 60000 + 1000, 'Upload grant exceeds the seven-minute cleanup wait bound');
    if (Date.now() < deadline) {
      report(`signed upload grant active; cleanup waits until ${new Date(deadline).toISOString()}`, 'pending');
      // Only the expiry metadata was read. Short wait slices keep the process
      // responsive; the deletion API checks the grant again before any delete.
      while (Date.now() < deadline) {
        await new Promise(resolveWait => setTimeout(resolveWait, Math.min(30000, deadline - Date.now())));
      }
    }
  };
  const identities = [];
  const cleanupFailures = [];
  const cleanupErrors = [];
  let testError, recommendationEvidence;
  try {
    const health = expect(await request('GET', '/api/health'), 200, 'health');
    requireCheck(health.ok === true && health.mode === 'production', 'Health did not identify production mode');
    const direct = await fetch(new URL('/api/health', api), {redirect:'error',signal:AbortSignal.timeout(20000)});
    requireCheck(direct.status === 403 && (await jsonResponse(direct)).error?.code === 'INVALID_ORIGIN',
      'Direct API Gateway access was not rejected');
    expect(await request('GET', '/api/me'), 401, 'unauthenticated profile');
    record('public health, CloudFront origin gate and unauthenticated API boundary');
    for (const ordinal of [1, 2]) {
      const identity = {ordinal, email: `roleclue-smoke-${randomUUID()}@invalid.example`, password: `Rc9${randomBytes(27).toString('base64url')}`};
      // Record the exact attempted identity BEFORE creation so a transport
      // failure after Cognito commits still reaches the cleanup path.
      identities.push(identity);
      await aws('cognito-idp', 'admin-create-user', {UserPoolId: outputs.CognitoUserPoolId, Username: identity.email,
        TemporaryPassword: identity.password, MessageAction: 'SUPPRESS',
        UserAttributes: [{Name: 'email', Value: identity.email}, {Name: 'email_verified', Value: 'true'}, {Name: 'name', Value: `RoleClue Synthetic ${ordinal}`} ]});
      await identify(identity);
      await setPassword(identity);
      await signIn(identity);
    }
    const [first, second] = identities;
    record('two isolated synthetic accounts signed in without sending email');
    const marker = `ROLECLUE SYNTHETIC ${randomUUID().toUpperCase()}`;
    const uploaded = expect(await request('POST', '/api/resume', {filename: 'synthetic-acceptance.pdf', contentType: 'application/pdf', consent: true,
      dataBase64: syntheticResumePdf(marker).toString('base64')}, first.token), 200, 'inline PDF upload');
    requireCheck(uploaded.profile?.resumeText?.includes(marker) && uploaded.profile.skills?.includes('TypeScript') && uploaded.profile.confirmed === false, 'Synthetic PDF extraction failed');
    const confirmed = expect(await request('PUT', '/api/profile', {name: 'RoleClue Synthetic One', situation: 'actively-looking', location: 'Sydney',
      roleFamilies: ['software'], yearsExperience: 4, workRights: 'unknown', needsSponsorship: 'unknown', clearance: 'unknown',
      preferences: {roleTitles: ['Software Engineer'], limitations: 'Synthetic acceptance fixture only.'}, termsAccepted: true,
      marketingConsent: false, confirmed: true}, first.token), 200, 'profile confirmation');
    requireCheck(confirmed.profile?.confirmed && confirmed.profile.termsAcceptedAt && confirmed.profile.email === first.email, 'Confirmed profile or consent missing');
    const secondAccount = expect(await request('GET', '/api/me', undefined, second.token), 200, 'other user profile');
    requireCheck(secondAccount.profile?.email === second.email && secondAccount.profile.resumeText === '' && secondAccount.profile.confirmed === false, 'Other user can see first user data');
    expect(await request('PUT', '/api/profile', {name: 'RoleClue Synthetic Two', confirmed: false}, second.token), 200, 'other user profile write');
    const firstAgain = expect(await request('GET', '/api/me', undefined, first.token), 200, 'first user isolation recheck');
    requireCheck(firstAgain.profile?.name === 'RoleClue Synthetic One' && firstAgain.profile.resumeText.includes(marker), 'Other user changed first user profile');
    record('PDF upload, durable consent, profile confirmation and two-user isolation');
    record('CloudFront forwarded authenticated API requests and preserved two-user isolation');
    // The implemented handler/contract route is /api/export, not /api/account/export.
    const firstExport = expect(await request('GET', '/api/export', undefined, first.token), 200, 'first user account export');
    const secondExport = expect(await request('GET', '/api/export', undefined, second.token), 200, 'second user account export');
    const exportedFirstProfile = firstExport.records?.find(record => record.type === 'PROFILE')?.value;
    const exportedSecondProfile = secondExport.records?.find(record => record.type === 'PROFILE')?.value;
    requireCheck(exportedFirstProfile?.email === first.email && exportedFirstProfile.resumeText?.includes(marker),
      'First account export did not include its own confirmed resume profile');
    requireCheck(exportedSecondProfile?.email === second.email && exportedSecondProfile.resumeText === '',
      'Second account export did not include its own isolated profile');
    requireCheck(!JSON.stringify(firstExport).includes(second.email) && !JSON.stringify(secondExport).includes(first.email) &&
      !JSON.stringify(secondExport).includes(marker), 'Account export exposed another test user data');
    record('account exports contain only their own synthetic profile and resume');
    requireCheck(firstAgain.capabilities?.recommendations === true && firstAgain.capabilities?.coverLetters === true &&
      firstAgain.capabilities?.billing === true, 'Production account capabilities are not enabled');
    const jobs = expect(await request('POST', '/api/opportunities/refresh', {}, first.token), 200, 'approved-source recommendation refresh');
    requireCheck(Array.isArray(jobs.opportunities) && jobs.opportunities.length >= 1 && jobs.opportunities.length <= 30 &&
      jobs.feed?.status === 'ready' && jobs.feed.source?.status === 'ready' &&
      typeof jobs.feed.source?.name === 'string' && jobs.feed.source.name.length > 0 &&
      typeof jobs.feed.message === 'string' && jobs.feed.message.length > 0,
    'Recommendation refresh did not return a non-empty result from a ready source');
    requireCheck(jobs.opportunities.every(item => item.highFit === true && item.score >= 75 && item.job?.australia === true) &&
      jobs.opportunities.some(item => typeof item.job?.source === 'string' && item.job.source.startsWith('freehire:')),
      'Recommendation refresh returned a low-fit or non-Australian role');
    recommendationEvidence={source:jobs.feed.source.name,status:jobs.feed.status,count:jobs.opportunities.length,
      refreshedAt:jobs.feed.lastUpdatedAt??null};
    const webhook = expect(await request('POST', '/api/stripe/webhook', '{}', undefined, {'stripe-signature': 'invalid-synthetic-signature'}), 400, 'signed webhook boundary');
    requireCheck(webhook.error?.code === 'INVALID_SIGNATURE', 'Webhook signature rejection returned the wrong error');
    record('non-empty high-fit Australian recommendations from a ready source and signed billing boundary verified; no checkout or paid AI request created');
    if (testSignedUpload) {
      const signedMarker = `ROLECLUE SIGNED UPLOAD ${randomUUID().toUpperCase()}`;
      const signedPdf = syntheticResumePdf(signedMarker);
      // Record the attempt before the API call so a lost response still waits
      // for any committed grant before cleanup.
      first.signedUploadAttempted = true;
      const grant = expect(await request('POST', '/api/resume/upload', {
        filename: 'synthetic-signed-acceptance.pdf', contentType: 'application/pdf',
        size: signedPdf.length, consent: true,
      }, first.token), 200, 'signed upload creation');
      requireCheck(/^[a-f0-9-]{36}$/i.test(grant.uploadId ?? ''), 'Signed upload ID is invalid');
      const uploadUrl = new URL(grant.uploadUrl);
      requireCheck(uploadUrl.protocol === 'https:' && !uploadUrl.username && !uploadUrl.password && !uploadUrl.port &&
        uploadUrl.hostname === `${outputs.ResumeBucket}.s3.${REGION}.amazonaws.com` &&
        uploadUrl.pathname === `/pending/${encodeURIComponent(first.sub)}/${grant.uploadId}`,
      'Signed upload does not target this test user in the deployment resume bucket');
      requireCheck(grant.headers && Object.keys(grant.headers).length === 1 &&
        new Headers(grant.headers).get('content-type') === 'application/pdf', 'Signed upload headers are unexpected');
      const preflight = await fetch(uploadUrl, {
        method: 'OPTIONS', redirect: 'error', signal: AbortSignal.timeout(25000),
        headers: {Origin: uploadOrigin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type'},
      });
      await preflight.body?.cancel();
      requireCheck(preflight.ok && preflight.headers.get('access-control-allow-origin') === uploadOrigin,
        'S3 preflight did not allow the exact app origin');
      requireCheck((preflight.headers.get('access-control-allow-methods') ?? '').split(',').map(value => value.trim()).includes('PUT'),
        'S3 preflight did not allow PUT');
      const allowedHeaders = (preflight.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(',').map(value => value.trim());
      requireCheck(allowedHeaders.includes('content-type') || allowedHeaders.includes('*'), 'S3 preflight did not allow content-type');
      const put = await fetch(uploadUrl, {
        method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(25000),
        headers: {...grant.headers, Origin: uploadOrigin}, body: signedPdf,
      });
      await put.body?.cancel();
      requireCheck(put.ok && put.headers.get('access-control-allow-origin') === uploadOrigin,
        'Signed PDF PUT failed or did not expose the exact app origin');
      const finalized = expect(await request('POST', '/api/resume/finalize', {uploadId: grant.uploadId}, first.token),
        200, 'signed upload finalization');
      requireCheck(finalized.profile?.resumeText?.includes(signedMarker) && finalized.profile.resumeUploadId === grant.uploadId &&
        finalized.profile.confirmed === false, 'Signed upload did not become this account reviewed-profile input');
      const saved = expect(await request('GET', '/api/me', undefined, first.token), 200, 'signed upload profile persistence');
      requireCheck(saved.profile?.resumeText?.includes(signedMarker) && !saved.profile.resumeText.includes(marker),
        'Signed PDF did not replace the previous synthetic resume');
      const blocked = expect(await request('DELETE', '/api/account', {confirmation: 'DELETE'}, first.token),
        409, 'live upload grant deletion fence');
      requireCheck(blocked.error?.code === 'UPLOAD_GRANT_ACTIVE', 'Account deletion was not blocked by the live upload grant');
      record('signed PDF upload, S3 CORS, finalization and deletion fence verified via HTTP; browser acceptance not tested');
    }
  } catch (error) {
    testError = error;
  }
  // No direct DynamoDB/S3 deletes or broad Cognito cleanup. Each deletion is
  // the same app operation users receive, scoped by that exact user's token.
  // Read-only checks then prove the identity, partition and both prefixes are
  // empty. Only the permanent, non-PII deletion hash is intentionally retained.
  for (const identity of identities) {
    try {
      let exists = true;
      if (!identity.sub) {
        try {await identify(identity);} catch (error) {
          if (error.code === 'UserNotFoundException') exists = false;
          else throw error;
        }
      }
      if (exists) {
        if (!identity.token) {await setPassword(identity); await signIn(identity);}
        await waitForUploadGrant(identity);
        let deleted = false;
        for (let attempt = 0; attempt < 2 && !deleted; attempt++) {
          try {
            const result = expect(await request('DELETE', '/api/account', {confirmation: 'DELETE'}, identity.token), 200, 'synthetic account deletion');
            requireCheck(result.deleted === true, 'Deletion was not acknowledged');
            deleted = true;
          } catch (error) {if (attempt === 1) throw error;}
        }
        expect(await request('GET', '/api/me', undefined, identity.token), 401, 'deleted account old-token rejection');
        let missing = false;
        try {await aws('cognito-idp', 'admin-get-user', {UserPoolId: outputs.CognitoUserPoolId, Username: identity.username});}
        catch (error) {if (error.code === 'UserNotFoundException') missing = true; else throw error;}
        requireCheck(missing, 'Synthetic Cognito identity remains after deletion');
        const records = await aws('dynamodb', 'query', {TableName: outputs.TableName, ConsistentRead: true, Select: 'COUNT',
          KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: {':pk': {S: `USER#${identity.sub}`}}});
        requireCheck(records.Count === 0 && !records.LastEvaluatedKey, 'Synthetic user records remain after deletion');
        for (const prefix of [`users/${encodeURIComponent(identity.sub)}/`, `pending/${encodeURIComponent(identity.sub)}/`]) {
          const objects = await aws('s3api', 'list-objects-v2', {Bucket: outputs.ResumeBucket, Prefix: prefix, MaxKeys: 1});
          requireCheck((objects.KeyCount ?? 0) === 0 && !objects.Contents?.length, 'Synthetic resume bytes remain after deletion');
        }
        record(`synthetic account ${identity.ordinal} deleted, old token rejected, identity/data/objects absent`);
      } else record(`synthetic account ${identity.ordinal} was not created`);
    } catch (error) {
      // Identifiers here are random synthetic test data, never tokens or raw
      // resumes. Retain actionable exact targets if an outage blocks cleanup;
      // do not bypass the API or claim cleanup succeeded.
      cleanupErrors.push(error);
      cleanupFailures.push({ordinal: identity.ordinal, email: identity.email, sub: identity.sub ?? null});
      try {
        record(`synthetic account ${identity.ordinal} cleanup`, 'FAILED: app/API or read-only verification requires operator follow-up');
      } catch (reportError) {
        cleanupErrors.push(reportError);
      }
    } finally {
      identity.password = undefined;
      identity.token = undefined;
    }
  }
  let cleanupError;
  if (cleanupFailures.length) {
    try {
      console.error(JSON.stringify({cleanupRequired: cleanupFailures, stack: stackName, account: ACCOUNT}));
    } catch (error) {
      cleanupErrors.push(error);
    }
    cleanupError = new SmokeCheckError('Synthetic cleanup is incomplete; do not mark deployment acceptance passed', {
      cause: new AggregateError(cleanupErrors, 'One or more synthetic account cleanups failed'),
    });
  }
  if (testError && cleanupError) {
    throw new AggregateError([testError, cleanupError], 'Cloud smoke failed and synthetic cleanup was incomplete');
  }
  if (testError) throw testError;
  if (cleanupError) throw cleanupError;
  await waitForEmptyQueues();
  record('generation, recommendation and shared dead-letter queues are empty');
  record('cloud acceptance complete; all synthetic user data removed, only non-PII deletion hashes retained');
  const evidencePath=await writeSmokeEvidence('cloud-smoke',{
    startedAt,completedAt:new Date().toISOString(),account:ACCOUNT,region:REGION,
    stackId:stack.StackId,siteUrl:outputs.SiteUrl,sourceRevision:liveRelease.manifest.sourceRevision,
    releaseId:liveRelease.manifest.releaseId,releaseCreatedAt:liveRelease.manifest.createdAt,
    lambdaSha256:liveRelease.manifest.lambdaSha256,
    liveFunctionVersion:liveRelease.alias.FunctionVersion,liveAliasArn:liveRelease.alias.AliasArn,
    recommendations:recommendationEvidence,checks,
  });
  report('cloud smoke evidence saved to build/evidence/cloud-smoke.json', 'passed');
  return {evidencePath,releaseId:liveRelease.manifest.releaseId,sourceRevision:liveRelease.manifest.sourceRevision};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCloudSmoke().catch(error => {
    // Unexpected transport/SDK errors may contain request details; keep the
    // final report generic. Individual checks print only fixed safe labels.
    const message = error instanceof SmokeCheckError
      ? error.message : 'Cloud acceptance failed; check the last completed safe check and cleanup report. No credentials or request bodies were logged.';
    console.error(JSON.stringify({result: 'FAILED', message}));
    process.exitCode = 1;
  });
}
