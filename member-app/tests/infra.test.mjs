import test from 'node:test';
import assert from 'node:assert/strict';
import { appTemplate, artifactTemplate } from '../infra/template.mjs';

test('production is authenticated by default, with only bounded guest intake, health and signed Stripe callbacks public', () => {
  const routes = Object.values(appTemplate().Resources).filter(r => r.Type === 'AWS::ApiGatewayV2::Route');
  assert.equal(routes.find(r => r.Properties.RouteKey === 'ANY /api/{proxy+}').Properties.AuthorizationType, 'JWT');
  assert.deepEqual(routes.filter(r => r.Properties.AuthorizationType === 'NONE').map(r => r.Properties.RouteKey).sort(), ['GET /api/health','POST /api/guest/ignore','POST /api/guest/profile','POST /api/guest/resume','POST /api/guest/search','POST /api/guest/session','POST /api/guest/start','POST /api/stripe/webhook','PUT /api/guest/profile'].sort());
  assert.equal(routes.find(r => r.Properties.RouteKey === 'POST /api/guest/claim').Properties.AuthorizationType,'JWT');
  assert.equal(routes.find(r => r.Properties.RouteKey === 'POST /api/continuation/complete').Properties.AuthorizationType,'JWT');
});

test('production never defaults to demo, paid models or unapproved feeds', () => {
  const template = appTemplate();
  assert.equal(template.Parameters.OpenAIDailyCallLimit.Default, 0);
  assert.equal(template.Parameters.OpenAIDailyTokenLimit.Default, 0);
  assert.equal(template.Parameters.JobFeedLicenseApproved.Default, 'false');
  assert.equal(template.Parameters.FreehireEnabled.Default, 'false');
  assert.equal(template.Parameters.FreehireLicenseApproved.Default, 'false');
  assert.equal(template.Parameters.GoogleSignInEnabled.Default, 'false');
  assert.equal(template.Parameters.StripePriceId.Default, '');
  assert.equal(template.Parameters.StripeStarterPriceId.Default, '');
  assert.equal(template.Resources.Function.Properties.Environment.Variables.NODE_ENV, 'production');
  assert.equal(template.Resources.Function.Properties.Environment.Variables.ROLECLUE_LOCAL_DEMO, undefined);
  assert.equal(template.Resources.Function.Properties.Environment.Variables.AI_BUDGET_NAMESPACE, 'SYSTEM#ROLECLUE_AI');
  assert.deepEqual(template.Resources.Function.Properties.Environment.Variables.STRIPE_PRICE_ID, {Ref: 'StripePriceId'});
  assert.deepEqual(template.Resources.Function.Properties.Environment.Variables.STRIPE_STARTER_PRICE_ID, {Ref: 'StripeStarterPriceId'});
  assert.equal(template.Resources.UserPoolClient.Properties.GenerateSecret, false);
  assert.deepEqual(template.Resources.UserPoolClient.Properties.AllowedOAuthFlows, ['code']);
  assert.equal(template.Resources.UserPoolClient.Properties.RefreshTokenValidity, 30);
  assert.equal(template.Resources.GoogleIdentityProvider.Condition, 'GoogleSignInEnabled');
  assert.match(template.Resources.GoogleIdentityProvider.Properties.ProviderDetails.client_secret['Fn::Sub'], /ssm-secure/);
  assert.equal(template.Resources.Function.Properties.ReservedConcurrentExecutions, undefined);
  assert.equal(template.Resources.Stage.Properties.DefaultRouteSettings.ThrottlingRateLimit, 5);
});

test('private records are retained, encrypted and isolated from public-site permissions', () => {
  const resources = appTemplate().Resources;
  assert.equal(resources.ResumeBucket.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy, true);
  assert.equal(resources.Table.Properties.DeletionProtectionEnabled, true);
  assert.equal(resources.UserPool.DeletionPolicy, 'Retain');
  assert.equal(resources.ResumeBucket.DeletionPolicy, 'Retain');
  assert.ok(resources.ResumeBucketPolicy.Properties.PolicyDocument.Statement.every(s => s.Effect === 'Deny'));
  assert.equal(artifactTemplate().Resources.Artifacts.Properties.LifecycleConfiguration.Rules[0].ExpirationInDays, 90);
});

test('daily refresh is timezone-aware and background failures have a bounded queue', () => {
  const r = appTemplate().Resources;
  assert.equal(r.DailyRefresh.Properties.ScheduleExpressionTimezone, 'Australia/Sydney');
  assert.equal(r.DailyRefresh.Properties.ScheduleExpression, 'cron(0 6 * * ? *)');
  assert.equal(r.AiAuthorityReview.Properties.ScheduleExpression, 'at(2026-11-04T09:00:00)');
  assert.equal(r.AiAuthorityReview.Properties.ScheduleExpressionTimezone, 'Australia/Sydney');
  assert.equal(r.GenerationQueue.Type, 'AWS::SQS::Queue');
  assert.equal(r.GenerationQueue.Properties.RedrivePolicy.maxReceiveCount, 3);
  assert.equal(r.GenerationQueue.Properties.VisibilityTimeout, 600);
  assert.equal(r.GenerationQueue.Properties.VisibilityTimeout, 600);
  assert.deepEqual(r.GenerationQueue.Properties.RedrivePolicy.deadLetterTargetArn, { 'Fn::GetAtt': ['FailedWork', 'Arn'] });
  assert.equal(r.GenerationQueueMapping.Properties.BatchSize, 1);
  assert.deepEqual(r.GenerationQueueMapping.Properties.FunctionResponseTypes, ['ReportBatchItemFailures']);
  assert.deepEqual(r.GenerationQueueMapping.Properties.FunctionName, { 'Fn::GetAtt': ['FunctionAlias', 'Arn'] });
  assert.equal(r.FailedWork.Properties.MessageRetentionPeriod, 1209600);
  assert.equal(r.LogGroup.Properties.RetentionInDays, 30);
  assert.equal(r.ApiLogs.Properties.RetentionInDays, 30);
  assert.equal(r.FailedWork.Properties.SqsManagedSseEnabled, true);
});

test('production deployment is immutable and alarms have an operator destination', () => {
  const template = appTemplate();
  const r = template.Resources;
  assert.equal(template.Parameters.ReleaseId.AllowedPattern, '^[a-f0-9]{64}$');
  assert.equal(r.FunctionVersion.Type, 'AWS::Lambda::Version');
  assert.equal(r.FunctionVersion.UpdateReplacePolicy, 'Retain');
  assert.equal(r.FunctionAlias.Properties.Name, 'live');
  assert.deepEqual(r.Integration.Properties.IntegrationUri, { 'Fn::GetAtt': ['FunctionAlias', 'Arn'] });
  assert.deepEqual(r.DailyRefresh.Properties.Target.Arn, { 'Fn::GetAtt': ['FunctionAlias', 'Arn'] });
  for (const name of ['FailedWorkAlarm', 'LambdaErrorAlarm', 'LambdaThrottleAlarm', 'ApiServerErrorAlarm', 'DynamoThrottleAlarm', 'ReconciliationAlarm', 'AiAuthorityReviewAlarm']) {
    assert.deepEqual(r[name].Properties.AlarmActions, [{ Ref: 'AlarmTopic' }]);
  }
  assert.equal(r.AlarmSubscription.Properties.Protocol, 'email');
});

test('CloudFront authenticates requests to the public API origin', () => {
  const r = appTemplate().Resources;
  const apiOrigin = r.Distribution.Properties.DistributionConfig.Origins.find(origin => origin.Id === 'api');
  assert.deepEqual(apiOrigin.OriginCustomHeaders, [{
    HeaderName: 'X-RoleClue-Origin',
    HeaderValue: { 'Fn::Sub': '{{resolve:secretsmanager:${ApiOriginSecret}:SecretString}}' },
  }]);
  assert.deepEqual(r.Function.Properties.Environment.Variables.API_ORIGIN_SECRET, { 'Fn::Sub': '{{resolve:secretsmanager:${ApiOriginSecret}:SecretString}}' });
  assert.equal(r.ApiOriginSecret.Properties.GenerateSecretString.PasswordLength, 64);
  assert.equal(r.ApiOriginSecret.DeletionPolicy, 'Retain');
});

test('runtime can authorize transactional condition checks and expires raw resume uploads', () => {
  const r = appTemplate().Resources;
  const statements = r.LambdaRole.Properties.Policies[0].PolicyDocument.Statement;
  const data = statements.find(s => s.Action.includes('dynamodb:TransactWriteItems'));
  assert.ok(data.Action.includes('dynamodb:ConditionCheckItem'));
  assert.deepEqual(data.Resource, { 'Fn::GetAtt': ['Table', 'Arn'] });
  const parameters=statements.find(s=>s.Action.includes('ssm:GetParameter')).Resource;
  assert.ok(parameters.some(value=>value['Fn::Sub']==='arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter${GuestRateHashSecretParam}'));
  const queue=statements.find(s=>s.Action.includes('sqs:SendMessage'));
  assert.ok(queue.Action.includes('sqs:ReceiveMessage'));
  assert.deepEqual(queue.Resource, { 'Fn::GetAtt': ['GenerationQueue', 'Arn'] });
  assert.equal(r.Table.Properties.TimeToLiveSpecification.AttributeName, 'ttl');
  const rules = r.ResumeBucket.Properties.LifecycleConfiguration.Rules;
  assert.equal(rules.find(x => x.Prefix === 'pending/').ExpirationInDays, 1);
  assert.equal(rules.find(x => x.Prefix === 'users/').ExpirationInDays, 7);
});
