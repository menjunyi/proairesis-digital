import test from 'node:test';
import assert from 'node:assert/strict';
import { apiOriginRequestPolicyId, appTemplate, artifactTemplate, stripePortalConfigurationId } from '../infra/template.mjs';

test('production is authenticated by default, with only bounded guest intake, health and signed Stripe callbacks public', () => {
  const routes = Object.values(appTemplate().Resources).filter(r => r.Type === 'AWS::ApiGatewayV2::Route');
  assert.equal(routes.find(r => r.Properties.RouteKey === 'ANY /api/{proxy+}').Properties.AuthorizationType, 'JWT');
  const compareRouteKeys = (left, right) => left.localeCompare(right);
  assert.deepEqual(routes.filter(r => r.Properties.AuthorizationType === 'NONE').map(r => r.Properties.RouteKey).sort(compareRouteKeys), ['GET /api/health','POST /api/guest/ignore','POST /api/guest/profile','POST /api/guest/resume','POST /api/guest/search','POST /api/guest/session','POST /api/guest/start','POST /api/stripe/webhook','PUT /api/guest/profile'].sort(compareRouteKeys));
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
  assert.equal(template.Parameters.ApiOriginGateEnabled.Default, 'false');
  assert.equal(template.Parameters.GoogleSignInEnabled.Default, 'false');
  assert.equal(template.Parameters.StripePriceId.Default, '');
  assert.equal(template.Parameters.StripeStarterPriceId.Default, '');
  assert.equal(template.Parameters.StripePortalConfigurationId.Default, stripePortalConfigurationId);
  assert.equal(stripePortalConfigurationId, 'bpc_1UPYkS2M7eo9K7BomH1dfiZp');
  assert.equal(template.Resources.Function.Properties.Environment.Variables.NODE_ENV, 'production');
  assert.equal(template.Resources.Function.Properties.Environment.Variables.ROLECLUE_LOCAL_DEMO, undefined);
  assert.equal(template.Resources.Function.Properties.Environment.Variables.AI_BUDGET_NAMESPACE, 'SYSTEM#ROLECLUE_AI');
  assert.deepEqual(template.Resources.Function.Properties.Environment.Variables.STRIPE_PRICE_ID, {Ref: 'StripePriceId'});
  assert.deepEqual(template.Resources.Function.Properties.Environment.Variables.STRIPE_STARTER_PRICE_ID, {Ref: 'StripeStarterPriceId'});
  assert.deepEqual(template.Resources.Function.Properties.Environment.Variables.STRIPE_PORTAL_CONFIGURATION_ID, {Ref: 'StripePortalConfigurationId'});
  assert.equal(template.Resources.UserPoolClient.Properties.GenerateSecret, false);
  assert.deepEqual(template.Resources.UserPoolClient.Properties.AllowedOAuthFlows, ['code']);
  assert.equal(template.Resources.UserPoolClient.Properties.RefreshTokenValidity, 30);
  assert.deepEqual(template.Resources.UserPool.Properties.EmailConfiguration, {
    EmailSendingAccount: 'DEVELOPER',
    SourceArn: { 'Fn::Sub': 'arn:${AWS::Partition}:ses:${AWS::Region}:${AWS::AccountId}:identity/proairesis.digital' },
    From: 'RoleClue <hello@proairesis.digital>',
    ReplyToEmailAddress: 'support@proairesis.digital',
  });
  assert.equal(template.Resources.GoogleIdentityProvider.Condition, 'GoogleSignInEnabled');
  assert.match(template.Resources.GoogleIdentityProvider.Properties.ProviderDetails.client_secret['Fn::Sub'], /ssm-secure/);
  assert.equal(template.Resources.Function.Properties.ReservedConcurrentExecutions, undefined);
  assert.equal(template.Resources.Stage.Properties.DefaultRouteSettings.ThrottlingRateLimit, 25);
  assert.equal(template.Resources.Stage.Properties.DefaultRouteSettings.ThrottlingBurstLimit, 50);
  assert.deepEqual(template.Resources.Stage.Properties.AccessLogSettings.DestinationArn, {
    'Fn::Sub': 'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:${ApiLogs}',
  });
});

test('private records are retained, encrypted and isolated from public-site permissions', () => {
  const resources = appTemplate().Resources;
  assert.equal(resources.ResumeBucket.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy, true);
  assert.equal(resources.Table.Properties.DeletionProtectionEnabled, true);
  for (const name of ['Table', 'UserPool', 'SiteBucket', 'ResumeBucket']) {
    assert.equal(resources[name].DeletionPolicy, 'Retain');
    assert.equal(resources[name].UpdateReplacePolicy, 'Retain');
  }
  assert.ok(resources.ResumeBucketPolicy.Properties.PolicyDocument.Statement.every(s => s.Effect === 'Deny'));
  assert.equal(artifactTemplate().Resources.Artifacts.Properties.LifecycleConfiguration.Rules[0].ExpirationInDays, 90);
});

test('daily refresh is timezone-aware and async work has isolated bounded queues', () => {
  const r = appTemplate().Resources;
  assert.equal(r.DailyRefresh.Properties.ScheduleExpressionTimezone, 'Australia/Sydney');
  assert.equal(r.DailyRefresh.Properties.ScheduleExpression, 'cron(0 6 * * ? *)');
  assert.equal(r.GenerationRepair.Properties.ScheduleExpression, 'rate(5 minutes)');
  assert.equal(r.GenerationRepair.Properties.Target.Input, JSON.stringify({kind:'generation-repair'}));
  assert.deepEqual(r.GenerationRepair.Properties.Target.Arn, { Ref: 'FunctionAlias' });
  assert.deepEqual(r.GenerationRepair.Properties.Target.RetryPolicy, { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 300 });
  assert.deepEqual(r.DailyRefresh.Properties.Target.DeadLetterConfig, { Arn: { 'Fn::GetAtt': ['FailedWork', 'Arn'] } });
  assert.deepEqual(r.GenerationRepair.Properties.Target.DeadLetterConfig, { Arn: { 'Fn::GetAtt': ['FailedWork', 'Arn'] } });
  assert.equal(r.BillingReconciliation.Properties.ScheduleExpression, 'cron(15 4 * * ? *)');
  assert.equal(r.BillingReconciliation.Properties.ScheduleExpressionTimezone, 'Australia/Sydney');
  assert.equal(r.BillingReconciliation.Properties.Target.Input, JSON.stringify({kind:'billing-reconciliation'}));
  assert.deepEqual(r.BillingReconciliation.Properties.Target.RetryPolicy, { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 });
  assert.deepEqual(r.BillingReconciliation.Properties.Target.DeadLetterConfig, { Arn: { 'Fn::GetAtt': ['FailedWork', 'Arn'] } });
  assert.equal(r.AiAuthorityReview.Properties.ScheduleExpression, 'at(2026-11-04T09:00:00)');
  assert.equal(r.AiAuthorityReview.Properties.ScheduleExpressionTimezone, 'Australia/Sydney');
  assert.equal(r.GenerationQueue.Type, 'AWS::SQS::Queue');
  assert.equal(r.GenerationQueue.Properties.RedrivePolicy.maxReceiveCount, 3);
  assert.equal(r.GenerationQueue.Properties.VisibilityTimeout, 600);
  assert.deepEqual(r.GenerationQueue.Properties.RedrivePolicy.deadLetterTargetArn, { 'Fn::GetAtt': ['FailedWork', 'Arn'] });
  assert.equal(r.GenerationQueue.Properties.SqsManagedSseEnabled, true);
  assert.equal(r.RecommendationQueue.Type, 'AWS::SQS::Queue');
  assert.equal(r.RecommendationQueue.Properties.RedrivePolicy.maxReceiveCount, 3);
  assert.equal(r.RecommendationQueue.Properties.VisibilityTimeout, 600);
  assert.equal(r.RecommendationQueue.Properties.SqsManagedSseEnabled, true);
  assert.deepEqual(r.RecommendationQueue.Properties.RedrivePolicy.deadLetterTargetArn, { 'Fn::GetAtt': ['FailedWork', 'Arn'] });
  assert.equal(r.GenerationQueueMapping.Properties.BatchSize, 1);
  assert.deepEqual(r.GenerationQueueMapping.Properties.FunctionResponseTypes, ['ReportBatchItemFailures']);
  assert.deepEqual(r.GenerationQueueMapping.Properties.FunctionName, { Ref: 'FunctionAlias' });
  assert.deepEqual(r.GenerationQueueMapping.Properties.ScalingConfig, { MaximumConcurrency: 5 });
  assert.equal(r.RecommendationQueueMapping.Properties.BatchSize, 1);
  assert.deepEqual(r.RecommendationQueueMapping.Properties.FunctionResponseTypes, ['ReportBatchItemFailures']);
  assert.deepEqual(r.RecommendationQueueMapping.Properties.EventSourceArn, { 'Fn::GetAtt': ['RecommendationQueue', 'Arn'] });
  assert.deepEqual(r.RecommendationQueueMapping.Properties.ScalingConfig, { MaximumConcurrency: 2 });
  assert.deepEqual(r.FunctionAsyncFailures.Properties, {
    FunctionName: { Ref: 'Function' },
    Qualifier: 'live',
    MaximumEventAgeInSeconds: 3600,
    MaximumRetryAttempts: 2,
    DestinationConfig: { OnFailure: { Destination: { 'Fn::GetAtt': ['FailedWork', 'Arn'] } } },
  });
  assert.deepEqual(r.FunctionAsyncFailures.DependsOn, ['FunctionAlias']);
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
  const aliasArn = { Ref: 'FunctionAlias' };
  assert.deepEqual(r.Integration.Properties.IntegrationUri, aliasArn);
  assert.deepEqual(r.InvokePermission.Properties.FunctionName, aliasArn);
  assert.deepEqual(r.ScheduleRole.Properties.Policies[0].PolicyDocument.Statement[0].Resource, aliasArn);
  assert.deepEqual(r.DailyRefresh.Properties.Target.Arn, aliasArn);
  assert.deepEqual(r.GenerationRepair.Properties.Target.Arn, aliasArn);
  assert.deepEqual(r.BillingReconciliation.Properties.Target.Arn, aliasArn);
  assert.deepEqual(r.AiAuthorityReview.Properties.Target.Arn, aliasArn);
  assert.deepEqual(r.GenerationQueueMapping.Properties.FunctionName, aliasArn);
  assert.deepEqual(r.RecommendationQueueMapping.Properties.FunctionName, aliasArn);
  assert.deepEqual(template.Outputs.FunctionAliasArn.Value, aliasArn);
  const invalidAliasArnReferences = [];
  const visit = (value, path = []) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, index]));
      return;
    }
    if (Array.isArray(value['Fn::GetAtt']) && value['Fn::GetAtt'][0] === 'FunctionAlias' && value['Fn::GetAtt'][1] === 'Arn') {
      invalidAliasArnReferences.push(path.join('.'));
    }
    for (const [key, item] of Object.entries(value)) visit(item, [...path, key]);
  };
  visit(template);
  assert.deepEqual(invalidAliasArnReferences, []);
  for (const name of ['FailedWorkAlarm', 'GenerationQueueAgeAlarm', 'GenerationQueueBacklogAlarm', 'RecommendationQueueAgeAlarm', 'RecommendationQueueBacklogAlarm', 'LambdaErrorAlarm', 'LambdaThrottleAlarm', 'ApiServerErrorAlarm', 'DynamoThrottleAlarm', 'ReconciliationAlarm', 'GenerationRepairFailureAlarm', 'AiAuthorityReviewAlarm', 'DailyRefreshHeartbeatAlarm', 'BillingReconciliationHeartbeatAlarm', 'GenerationRepairHeartbeatAlarm']) {
    assert.deepEqual(r[name].Properties.AlarmActions, [{ Ref: 'AlarmTopic' }]);
  }
  assert.equal(r.ReconciliationMetric.Properties.FilterPattern, '"generation_reconciliation_required"');
  assert.equal(r.GenerationRepairFailureMetric.Properties.FilterPattern, '"generation_dispatch_repair_failed"');
  assert.equal(r.AiAuthorityReviewMetric.Properties.FilterPattern, '"ai_authority_review_required"');
  assert.equal(r.GenerationRepairFailureAlarm.Properties.MetricName, 'GenerationDispatchRepairFailed');
  assert.equal(r.DailyRefreshHeartbeatAlarm.Properties.MetricName, 'DailyRefreshCompleted');
  assert.equal(r.DailyRefreshHeartbeatAlarm.Properties.DatapointsToAlarm, 6);
  assert.equal(r.BillingReconciliationHeartbeatAlarm.Properties.MetricName, 'DailyBillingReconciliationCompleted');
  assert.equal(r.GenerationRepairHeartbeatAlarm.Properties.MetricName, 'GenerationRepairCompleted');
  assert.equal(r.GenerationRepairHeartbeatAlarm.Properties.Period, 300);
  assert.equal(r.GenerationRepairHeartbeatAlarm.Properties.DatapointsToAlarm, 6);
  assert.equal(r.GenerationQueueAgeAlarm.Properties.MetricName, 'ApproximateAgeOfOldestMessage');
  assert.equal(r.GenerationQueueBacklogAlarm.Properties.MetricName, 'ApproximateNumberOfMessagesVisible');
  assert.deepEqual(r.GenerationQueueAgeAlarm.Properties.Dimensions, [{ Name: 'QueueName', Value: { 'Fn::GetAtt': ['GenerationQueue', 'QueueName'] } }]);
  assert.deepEqual(r.RecommendationQueueAgeAlarm.Properties.Dimensions, [{ Name: 'QueueName', Value: { 'Fn::GetAtt': ['RecommendationQueue', 'QueueName'] } }]);
  assert.equal(r.AlarmSubscription.Properties.Protocol, 'email');
});

test('CloudFront authenticates requests to the public API origin', () => {
  const r = appTemplate().Resources;
  const apiOrigin = r.Distribution.Properties.DistributionConfig.Origins.find(origin => origin.Id === 'api');
  assert.deepEqual(apiOrigin.OriginCustomHeaders, [{
    HeaderName: 'X-RoleClue-Origin',
    HeaderValue: { 'Fn::Sub': '{{resolve:secretsmanager:${ApiOriginSecret}:SecretString}}' },
  }]);
  assert.deepEqual(r.Function.Properties.Environment.Variables.API_ORIGIN_SECRET, {
    'Fn::If': ['EnforceApiOriginGate', { 'Fn::Sub': '{{resolve:secretsmanager:${ApiOriginSecret}:SecretString}}' }, ''],
  });
  assert.equal(r.ApiOriginSecret.Properties.GenerateSecretString.PasswordLength, 64);
  assert.equal(r.ApiOriginSecret.DeletionPolicy, 'Retain');
  const apiBehavior = r.Distribution.Properties.DistributionConfig.CacheBehaviors.find(behavior => behavior.PathPattern === '/api/*');
  assert.equal(apiOriginRequestPolicyId,'b689b0a8-53d0-40ab-baf2-68738e2966ac');
  assert.equal(apiBehavior.OriginRequestPolicyId,apiOriginRequestPolicyId);
});

test('runtime can authorize transactional condition checks and expires raw resume uploads', () => {
  const r = appTemplate().Resources;
  const statements = r.LambdaRole.Properties.Policies[0].PolicyDocument.Statement;
  const data = statements.find(s => s.Action.includes('dynamodb:TransactWriteItems'));
  assert.ok(data.Action.includes('dynamodb:ConditionCheckItem'));
  assert.deepEqual(data.Resource, { 'Fn::GetAtt': ['Table', 'Arn'] });
  const parameters=statements.find(s=>s.Action.includes('ssm:GetParameter')).Resource;
  assert.ok(parameters.some(value=>value['Fn::Sub']==='arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter${GuestRateHashSecretParam}'));
  const queue=statements.find(s=>s.Action.includes('sqs:ReceiveMessage'));
  assert.ok(queue.Action.includes('sqs:ReceiveMessage'));
  assert.deepEqual(queue.Resource, [{ 'Fn::GetAtt': ['GenerationQueue', 'Arn'] }, { 'Fn::GetAtt': ['RecommendationQueue', 'Arn'] }]);
  const asyncFailure=statements.find(s=>s.Action.length===1&&s.Action[0]==='sqs:SendMessage');
  assert.deepEqual(asyncFailure.Resource, { 'Fn::GetAtt': ['FailedWork', 'Arn'] });
  const schedulerStatements=r.ScheduleRole.Properties.Policies[0].PolicyDocument.Statement;
  assert.deepEqual(schedulerStatements[1],{Effect:'Allow',Action:['sqs:SendMessage'],Resource:{'Fn::GetAtt':['FailedWork','Arn']}});
  assert.deepEqual(r.Function.Properties.Environment.Variables.RECOMMENDATION_QUEUE_URL, { Ref: 'RecommendationQueue' });
  assert.deepEqual(appTemplate().Outputs.RecommendationQueueUrl.Value, { Ref: 'RecommendationQueue' });
  assert.equal(r.Table.Properties.TimeToLiveSpecification.AttributeName, 'ttl');
  const rules = r.ResumeBucket.Properties.LifecycleConfiguration.Rules;
  assert.equal(rules.find(x => x.Prefix === 'pending/').ExpirationInDays, 1);
  assert.equal(rules.find(x => x.Prefix === 'users/').ExpirationInDays, 7);
});
