import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ref = (name) => ({ Ref: name });
const sub = (value) => ({ 'Fn::Sub': value });
const get = (name, attribute) => ({ 'Fn::GetAtt': [name, attribute] });
const resource = (Type, Properties, extra = {}) => ({ Type, Properties, ...extra });
const retain = { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' };
const privateBucket = {
  PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
  BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
  OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
};
const assumeRole = (service) => ({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: service }, Action: 'sts:AssumeRole' }] });
const statement = (Action, Resource) => ({ Effect: 'Allow', Action, Resource });
const s3TlsDeny = (bucket) => ({ Sid: 'RequireTLS', Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [get(bucket, 'Arn'), sub('${' + bucket + '.Arn}/*')], Condition: { Bool: { 'aws:SecureTransport': false } } });
export const apiOriginRequestPolicyId = 'b689b0a8-53d0-40ab-baf2-68738e2966ac';

export function certificateTemplate() {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'RoleClue member-app certificate. Deploy in us-east-1 for CloudFront.',
    Parameters: { Hostname: { Type: 'String', Default: 'app.proairesis.digital' }, HostedZoneId: { Type: 'AWS::Route53::HostedZone::Id' } },
    Resources: { Certificate: resource('AWS::CertificateManager::Certificate', { DomainName: ref('Hostname'), ValidationMethod: 'DNS', DomainValidationOptions: [{ DomainName: ref('Hostname'), HostedZoneId: ref('HostedZoneId') }] }, retain) },
    Outputs: { CertificateArn: { Value: ref('Certificate') } },
  };
}

export function artifactTemplate() {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Private, bounded RoleClue release artifacts in Sydney.',
    Resources: {
      Artifacts: resource('AWS::S3::Bucket', { ...privateBucket, VersioningConfiguration: { Status: 'Enabled' }, LifecycleConfiguration: { Rules: [{ Id: 'BoundReleaseRetention', Status: 'Enabled', ExpirationInDays: 90, NoncurrentVersionExpiration: { NoncurrentDays: 30 }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }] } }, retain),
      Policy: resource('AWS::S3::BucketPolicy', { Bucket: ref('Artifacts'), PolicyDocument: { Version: '2012-10-17', Statement: [s3TlsDeny('Artifacts')] } }),
    },
    Outputs: { ArtifactBucket: { Value: ref('Artifacts') } },
  };
}

export function appTemplate() {
  const secretPrefix = '/roleclue/member-app/';
  const t = {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'RoleClue member app. Sydney data and API, private S3, CloudFront-only public entry, durable generation and monitored production services.',
    Parameters: {
      Hostname: { Type: 'String', Default: 'app.proairesis.digital' },
      HostedZoneId: { Type: 'AWS::Route53::HostedZone::Id' },
      CertificateArn: { Type: 'String' },
      ArtifactBucket: { Type: 'String' },
      ArtifactKey: { Type: 'String' },
      ArtifactVersion: { Type: 'String' },
      SiteArtifactVersion: { Type: 'String' },
      SiteArtifactVersionToken: { Type: 'String', AllowedPattern: '^[A-Za-z0-9_-]+$' },
      SiteArtifactSha256: { Type: 'String', AllowedPattern: '^[a-f0-9]{64}$' },
      ReleaseId: { Type: 'String', AllowedPattern: '^[a-f0-9]{64}$' },
      FunctionName: { Type: 'String', Default: 'roleclue-member-app' },
      StripePriceId: { Type: 'String', Default: '' },
      StripeStarterPriceId: { Type: 'String', Default: '' },
      OpenAIModel: { Type: 'String', Default: '' },
      OpenAIDailyCallLimit: { Type: 'Number', Default: 0, MinValue: 0 },
      OpenAIDailyTokenLimit: { Type: 'Number', Default: 0, MinValue: 0 },
      JobFeedUrl: { Type: 'String', Default: '', AllowedPattern: '^$|https://[^\\s]+$' },
      JobFeedLicenseApproved: { Type: 'String', Default: 'false', AllowedValues: ['false', 'true'] },
      JobFeedLicenseReference: { Type: 'String', Default: '' },
      JobFeedSourcesJson: { Type: 'String', Default: '' },
      FreehireEnabled: { Type: 'String', Default: 'false', AllowedValues: ['false', 'true'] },
      FreehireLicenseApproved: { Type: 'String', Default: 'false', AllowedValues: ['false', 'true'] },
      FreehireLicenseReference: { Type: 'String', Default: '' },
      FreehireBaseUrl: { Type: 'String', Default: 'https://freehire.me/api/v1/', AllowedPattern: '^https://[^\\s]+/$' },
      GuestRateHashSecretParam: { Type: 'String', Default: '/roleclue/member-app/guest-rate-hash-secret' },
      AlarmEmail: { Type: 'String', Default: 'support@proairesis.digital', AllowedPattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
      ApiOriginGateEnabled: { Type: 'String', Default: 'false', AllowedValues: ['false', 'true'] },
      GoogleSignInEnabled: { Type: 'String', Default: 'false', AllowedValues: ['false', 'true'] },
      GoogleOAuthClientId: { Type: 'String', Default: '' },
      GoogleOAuthClientSecretParam: { Type: 'String', Default: '/roleclue/member-app/google-oauth-client-secret' },
      CognitoDomainPrefix: { Type: 'String', Default: 'roleclue-proairesis-au', AllowedPattern: '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' },
    },
    Conditions: {
      EnforceApiOriginGate: { 'Fn::Equals': [ref('ApiOriginGateEnabled'), 'true'] },
      GoogleSignInEnabled: { 'Fn::Equals': [ref('GoogleSignInEnabled'), 'true'] },
    },
    Resources: {}, Outputs: {},
  };
  const r = t.Resources;
  r.SiteBucket = resource('AWS::S3::Bucket', { ...privateBucket, VersioningConfiguration: { Status: 'Enabled' }, LifecycleConfiguration: { Rules: [{ Id: 'BoundPreviousReleases', Status: 'Enabled', NoncurrentVersionExpiration: { NoncurrentDays: 14 }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }] } }, retain);
  r.ResumeBucket = resource('AWS::S3::Bucket', { ...privateBucket, CorsConfiguration: { CorsRules: [{ AllowedOrigins: [sub('https://${Hostname}')], AllowedMethods: ['PUT'], AllowedHeaders: ['content-type', 'x-amz-*'], ExposedHeaders: ['ETag'], MaxAge: 300 }] }, LifecycleConfiguration: { Rules: [
    { Id: 'AbandonedMultipart', Status: 'Enabled', AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
    { Id: 'AbandonedUploads', Prefix: 'pending/', Status: 'Enabled', ExpirationInDays: 1 },
    { Id: 'OriginalResumeRetention', Prefix: 'users/', Status: 'Enabled', ExpirationInDays: 7 },
  ] } }, retain);
  r.ResumeBucketPolicy = resource('AWS::S3::BucketPolicy', { Bucket: ref('ResumeBucket'), PolicyDocument: { Version: '2012-10-17', Statement: [s3TlsDeny('ResumeBucket')] } });
  r.Table = resource('AWS::DynamoDB::Table', {
    BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
    SSESpecification: { SSEEnabled: true }, DeletionProtectionEnabled: true,
    PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true, RecoveryPeriodInDays: 7 },
    TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
  }, retain);
  r.UserPool = resource('AWS::Cognito::UserPool', {
    UserPoolName: 'roleclue-members', UserPoolTier: 'LITE', UsernameAttributes: ['email'], AutoVerifiedAttributes: ['email'],
    UsernameConfiguration: { CaseSensitive: false },
    Policies: { PasswordPolicy: { MinimumLength: 12, RequireLowercase: true, RequireUppercase: true, RequireNumbers: true, RequireSymbols: false, TemporaryPasswordValidityDays: 1 } },
    AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }] },
    EmailConfiguration: { EmailSendingAccount: 'COGNITO_DEFAULT' },
    VerificationMessageTemplate: { DefaultEmailOption: 'CONFIRM_WITH_CODE' },
    Schema: [{ Name: 'email', Required: true, Mutable: true }, { Name: 'name', Required: false, Mutable: true }],
    UserAttributeUpdateSettings: { AttributesRequireVerificationBeforeUpdate: ['email'] },
    DeletionProtection: 'ACTIVE',
  }, retain);
  r.GoogleIdentityProvider = resource('AWS::Cognito::UserPoolIdentityProvider', {
    UserPoolId: ref('UserPool'), ProviderName: 'Google', ProviderType: 'Google',
    ProviderDetails: {
      client_id: ref('GoogleOAuthClientId'),
      client_secret: sub('{{resolve:ssm-secure:${GoogleOAuthClientSecretParam}}}'),
      authorize_scopes: 'openid email profile',
    },
    AttributeMapping: { email: 'email', name: 'name' },
  }, { Condition: 'GoogleSignInEnabled' });
  r.UserPoolDomain = resource('AWS::Cognito::UserPoolDomain', {
    Domain: ref('CognitoDomainPrefix'), UserPoolId: ref('UserPool'),
  }, { Condition: 'GoogleSignInEnabled' });
  r.UserPoolClient = resource('AWS::Cognito::UserPoolClient', {
    UserPoolId: ref('UserPool'), ClientName: 'RoleClue web', GenerateSecret: false,
    ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
    SupportedIdentityProviders: { 'Fn::If': ['GoogleSignInEnabled', ['COGNITO', ref('GoogleIdentityProvider')], ['COGNITO']] },
    AllowedOAuthFlowsUserPoolClient: true, AllowedOAuthFlows: ['code'], AllowedOAuthScopes: ['openid', 'email', 'profile'],
    CallbackURLs: [sub('https://${Hostname}/')], LogoutURLs: [sub('https://${Hostname}/')],
    PreventUserExistenceErrors: 'ENABLED', EnableTokenRevocation: true,
    AccessTokenValidity: 1, IdTokenValidity: 1, RefreshTokenValidity: 30,
    TokenValidityUnits: { AccessToken: 'hours', IdToken: 'hours', RefreshToken: 'days' },
    ReadAttributes: ['email', 'email_verified', 'name'], WriteAttributes: ['email', 'name'],
  });
  r.LogGroup = resource('AWS::Logs::LogGroup', { LogGroupName: sub('/aws/lambda/${FunctionName}'), RetentionInDays: 30 });
  r.ApiLogs = resource('AWS::Logs::LogGroup', { RetentionInDays: 30 });
  r.FailedWork = resource('AWS::SQS::Queue', { MessageRetentionPeriod: 1209600, SqsManagedSseEnabled: true });
  r.ApiOriginSecret = resource('AWS::SecretsManager::Secret', {
    Description: 'Random RoleClue CloudFront-to-API origin credential',
    GenerateSecretString: {ExcludePunctuation: true, IncludeSpace: false, PasswordLength: 64},
  }, retain);
  r.GenerationQueue = resource('AWS::SQS::Queue', {
    MessageRetentionPeriod: 345600, VisibilityTimeout: 600, SqsManagedSseEnabled: true,
    RedrivePolicy: { deadLetterTargetArn: get('FailedWork', 'Arn'), maxReceiveCount: 3 },
  });
  r.RecommendationQueue = resource('AWS::SQS::Queue', {
    MessageRetentionPeriod: 345600, VisibilityTimeout: 600, SqsManagedSseEnabled: true,
    RedrivePolicy: { deadLetterTargetArn: get('FailedWork', 'Arn'), maxReceiveCount: 3 },
  });
  r.AlarmTopic = resource('AWS::SNS::Topic', { DisplayName: 'RoleClue production alerts' });
  r.AlarmSubscription = resource('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: ref('AlarmEmail'), TopicArn: ref('AlarmTopic') });
  r.LambdaRole = resource('AWS::IAM::Role', {
    AssumeRolePolicyDocument: assumeRole('lambda.amazonaws.com'),
    Policies: [{ PolicyName: 'RoleClueRuntime', PolicyDocument: { Version: '2012-10-17', Statement: [
      statement(['logs:CreateLogStream', 'logs:PutLogEvents'], get('LogGroup', 'Arn')),
      statement(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:ConditionCheckItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:TransactWriteItems', 'dynamodb:BatchGetItem', 'dynamodb:BatchWriteItem'], get('Table', 'Arn')),
      statement(['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], sub('${ResumeBucket.Arn}/*')),
      statement(['s3:ListBucket'], get('ResumeBucket', 'Arn')),
      statement(['cognito-idp:AdminDeleteUser', 'cognito-idp:AdminUserGlobalSignOut'], get('UserPool', 'Arn')),
      statement(['ssm:GetParameter'], [...['stripe-secret-key', 'stripe-webhook-secret', 'openai-api-key'].map(name => sub('arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + secretPrefix + name)), sub('arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter${GuestRateHashSecretParam}')]),
      statement(['sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:ChangeMessageVisibility', 'sqs:GetQueueAttributes'], [get('GenerationQueue', 'Arn'), get('RecommendationQueue', 'Arn')]),
      statement(['sqs:SendMessage'], get('FailedWork', 'Arn')),
    ] } }],
  });
  r.Function = resource('AWS::Lambda::Function', {
    FunctionName: ref('FunctionName'), Runtime: 'nodejs22.x', Architectures: ['x86_64'], Handler: 'handler.handler',
    Role: get('LambdaRole', 'Arn'), Code: { S3Bucket: ref('ArtifactBucket'), S3Key: ref('ArtifactKey'), S3ObjectVersion: ref('ArtifactVersion') },
    MemorySize: 1024, Timeout: 90,
    Environment: { Variables: {
      NODE_ENV: 'production', TABLE_NAME: ref('Table'), RESUME_BUCKET: ref('ResumeBucket'), GENERATION_QUEUE_URL: ref('GenerationQueue'), RECOMMENDATION_QUEUE_URL: ref('RecommendationQueue'),
      COGNITO_USER_POOL_ID: ref('UserPool'), COGNITO_CLIENT_ID: ref('UserPoolClient'),
      ALLOWED_ORIGINS: sub('https://${Hostname}'), SITE_URL: sub('https://${Hostname}'),
      API_ORIGIN_SECRET: { 'Fn::If': ['EnforceApiOriginGate', sub('{{resolve:secretsmanager:${ApiOriginSecret}:SecretString}}'), ''] },
      STRIPE_SECRET_KEY_PARAM: `${secretPrefix}stripe-secret-key`, STRIPE_WEBHOOK_SECRET_PARAM: `${secretPrefix}stripe-webhook-secret`, STRIPE_PRICE_ID: ref('StripePriceId'), STRIPE_STARTER_PRICE_ID: ref('StripeStarterPriceId'),
      OPENAI_API_KEY_PARAM: `${secretPrefix}openai-api-key`, OPENAI_MODEL: ref('OpenAIModel'), OPENAI_DAILY_CALL_LIMIT: ref('OpenAIDailyCallLimit'), OPENAI_DAILY_TOKEN_LIMIT: ref('OpenAIDailyTokenLimit'), OPENAI_MAX_OUTPUT_TOKENS: '1200',
      AI_BUDGET_NAMESPACE: 'SYSTEM#ROLECLUE_AI',
      JOB_FEED_URL: ref('JobFeedUrl'), JOB_FEED_LICENSE_APPROVED: ref('JobFeedLicenseApproved'), JOB_FEED_LICENSE_REFERENCE: ref('JobFeedLicenseReference'), JOB_FEED_SOURCES_JSON: ref('JobFeedSourcesJson'), JOB_FEED_MAX_AGE_HOURS: '48',
      FREEHIRE_ENABLED: ref('FreehireEnabled'), FREEHIRE_LICENSE_APPROVED: ref('FreehireLicenseApproved'), FREEHIRE_LICENSE_REFERENCE: ref('FreehireLicenseReference'), FREEHIRE_BASE_URL: ref('FreehireBaseUrl'), GUEST_RATE_HASH_SECRET_PARAM: ref('GuestRateHashSecretParam'),
    } },
  }, { DependsOn: ['LogGroup'] });
  r.FunctionVersion = resource('AWS::Lambda::Version', { FunctionName: ref('Function'), Description: sub('RoleClue release ${ReleaseId} origin-gate-${ApiOriginGateEnabled} site-v-${SiteArtifactVersionToken} site-sha-${SiteArtifactSha256}') }, retain);
  r.FunctionAlias = resource('AWS::Lambda::Alias', { Name: 'live', FunctionName: ref('Function'), FunctionVersion: get('FunctionVersion', 'Version'), Description: sub('RoleClue production ${ReleaseId}') });
  r.FunctionAsyncFailures = resource('AWS::Lambda::EventInvokeConfig', {
    FunctionName: ref('Function'), Qualifier: 'live', MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 2,
    DestinationConfig: { OnFailure: { Destination: get('FailedWork', 'Arn') } },
  }, { DependsOn: ['FunctionAlias'] });
  r.GenerationQueueMapping = resource('AWS::Lambda::EventSourceMapping', {
    EventSourceArn: get('GenerationQueue', 'Arn'), FunctionName: ref('FunctionAlias'), Enabled: true,
    BatchSize: 1, MaximumBatchingWindowInSeconds: 0, FunctionResponseTypes: ['ReportBatchItemFailures'],
    ScalingConfig: { MaximumConcurrency: 5 },
  });
  r.RecommendationQueueMapping = resource('AWS::Lambda::EventSourceMapping', {
    EventSourceArn: get('RecommendationQueue', 'Arn'), FunctionName: ref('FunctionAlias'), Enabled: true,
    BatchSize: 1, MaximumBatchingWindowInSeconds: 0, FunctionResponseTypes: ['ReportBatchItemFailures'],
    ScalingConfig: { MaximumConcurrency: 2 },
  });
  r.Api = resource('AWS::ApiGatewayV2::Api', { Name: 'roleclue-member-app', ProtocolType: 'HTTP', CorsConfiguration: { AllowOrigins: [sub('https://${Hostname}')], AllowHeaders: ['authorization', 'content-type', 'idempotency-key'], AllowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], MaxAge: 300 } });
  r.Integration = resource('AWS::ApiGatewayV2::Integration', { ApiId: ref('Api'), IntegrationType: 'AWS_PROXY', IntegrationUri: ref('FunctionAlias'), PayloadFormatVersion: '2.0', TimeoutInMillis: 29000 });
  r.Authorizer = resource('AWS::ApiGatewayV2::Authorizer', { ApiId: ref('Api'), AuthorizerType: 'JWT', Name: 'VerifiedCognitoIdentity', IdentitySource: ['$request.header.Authorization'], JwtConfiguration: { Audience: [ref('UserPoolClient')], Issuer: sub('https://cognito-idp.${AWS::Region}.amazonaws.com/${UserPool}') } });
  r.PrivateRoute = resource('AWS::ApiGatewayV2::Route', { ApiId: ref('Api'), RouteKey: 'ANY /api/{proxy+}', Target: sub('integrations/${Integration}'), AuthorizationType: 'JWT', AuthorizerId: ref('Authorizer') });
  r.GuestClaimRoute = resource('AWS::ApiGatewayV2::Route', { ApiId: ref('Api'), RouteKey: 'POST /api/guest/claim', Target: sub('integrations/${Integration}'), AuthorizationType: 'JWT', AuthorizerId: ref('Authorizer') });
  r.ContinuationCompleteRoute = resource('AWS::ApiGatewayV2::Route', { ApiId: ref('Api'), RouteKey: 'POST /api/continuation/complete', Target: sub('integrations/${Integration}'), AuthorizationType: 'JWT', AuthorizerId: ref('Authorizer') });
  r.WebhookRoute = resource('AWS::ApiGatewayV2::Route', { ApiId: ref('Api'), RouteKey: 'POST /api/stripe/webhook', Target: sub('integrations/${Integration}'), AuthorizationType: 'NONE' });
  r.HealthRoute = resource('AWS::ApiGatewayV2::Route', { ApiId: ref('Api'), RouteKey: 'GET /api/health', Target: sub('integrations/${Integration}'), AuthorizationType: 'NONE' });
  for (const [name, routeKey] of Object.entries({GuestStartRoute:'POST /api/guest/start',GuestResumeRoute:'POST /api/guest/resume',GuestProfileRoute:'PUT /api/guest/profile',GuestProfilePostRoute:'POST /api/guest/profile',GuestSearchRoute:'POST /api/guest/search',GuestSessionRoute:'POST /api/guest/session',GuestIgnoreRoute:'POST /api/guest/ignore'})) {
    r[name] = resource('AWS::ApiGatewayV2::Route', { ApiId: ref('Api'), RouteKey: routeKey, Target: sub('integrations/${Integration}'), AuthorizationType: 'NONE' });
  }
  r.Stage = resource('AWS::ApiGatewayV2::Stage', { ApiId: ref('Api'), StageName: '$default', AutoDeploy: true, DefaultRouteSettings: { ThrottlingBurstLimit: 10, ThrottlingRateLimit: 5 }, AccessLogSettings: { DestinationArn: get('ApiLogs', 'Arn'), Format: JSON.stringify({ requestId: '$context.requestId', route: '$context.routeKey', status: '$context.status', latencyMs: '$context.responseLatency' }) } });
  r.InvokePermission = resource('AWS::Lambda::Permission', { FunctionName: ref('FunctionAlias'), Action: 'lambda:InvokeFunction', Principal: 'apigateway.amazonaws.com', SourceArn: sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/*/*') });
  r.ScheduleRole = resource('AWS::IAM::Role', { AssumeRolePolicyDocument: assumeRole('scheduler.amazonaws.com'), Policies: [{ PolicyName: 'InvokeOnlyRoleClueSchedules', PolicyDocument: { Version: '2012-10-17', Statement: [statement(['lambda:InvokeFunction'], ref('FunctionAlias'))] } }] });
  r.DailyRefresh = resource('AWS::Scheduler::Schedule', { Description: 'RoleClue daily authorised job refresh', ScheduleExpression: 'cron(0 6 * * ? *)', ScheduleExpressionTimezone: 'Australia/Sydney', FlexibleTimeWindow: { Mode: 'OFF' }, Target: { Arn: ref('FunctionAlias'), RoleArn: get('ScheduleRole', 'Arn'), Input: JSON.stringify({ kind: 'feed-refresh' }), RetryPolicy: { MaximumRetryAttempts: 1, MaximumEventAgeInSeconds: 3600 } } });
  r.GenerationRepair = resource('AWS::Scheduler::Schedule', { Description: 'Recover paid generation dispatches without browser activity', ScheduleExpression: 'rate(5 minutes)', FlexibleTimeWindow: { Mode: 'OFF' }, Target: { Arn: ref('FunctionAlias'), RoleArn: get('ScheduleRole', 'Arn'), Input: JSON.stringify({ kind: 'generation-repair' }), RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 300 } } });
  r.AiAuthorityReview = resource('AWS::Scheduler::Schedule', { Description: 'Notify operators before the pinned RoleClue AI price authority expires', ScheduleExpression: 'at(2026-11-04T09:00:00)', ScheduleExpressionTimezone: 'Australia/Sydney', FlexibleTimeWindow: { Mode: 'OFF' }, Target: { Arn: ref('FunctionAlias'), RoleArn: get('ScheduleRole', 'Arn'), Input: JSON.stringify({ kind: 'ai-authority-review' }), RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 } } });
  r.OriginAccess = resource('AWS::CloudFront::OriginAccessControl', { OriginAccessControlConfig: { Name: sub('${AWS::StackName}-s3'), OriginAccessControlOriginType: 's3', SigningBehavior: 'always', SigningProtocol: 'sigv4' } });
  r.SecurityHeaders = resource('AWS::CloudFront::ResponseHeadersPolicy', { ResponseHeadersPolicyConfig: {
    Name: sub('${AWS::StackName}-security'), SecurityHeadersConfig: {
      ContentTypeOptions: { Override: true }, FrameOptions: { FrameOption: 'DENY', Override: true },
      ReferrerPolicy: { ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true },
      StrictTransportSecurity: { AccessControlMaxAgeSec: 31536000, IncludeSubdomains: true, Override: true },
      ContentSecurityPolicy: { Override: true, ContentSecurityPolicy: sub("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://cognito-idp.${AWS::Region}.amazonaws.com https://${CognitoDomainPrefix}.auth.${AWS::Region}.amazoncognito.com https://${ResumeBucket}.s3.${AWS::Region}.amazonaws.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com; object-src 'none'") },
    }, CustomHeadersConfig: { Items: [{ Header: 'Permissions-Policy', Value: 'camera=(), microphone=(), geolocation=()', Override: true }] },
  } });
  r.SpaRewrite = resource('AWS::CloudFront::Function', { Name: sub('${AWS::StackName}-routes'), AutoPublish: true, FunctionConfig: { Comment: 'RoleClue client routing only', Runtime: 'cloudfront-js-2.0' }, FunctionCode: "function handler(event) { var request = event.request; if (!request.uri.split('/').pop().includes('.')) request.uri = '/index.html'; return request; }" });
  const noCache = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
  r.Distribution = resource('AWS::CloudFront::Distribution', { DistributionConfig: {
    Enabled: true, IPV6Enabled: true, Comment: 'RoleClue member app', Aliases: [ref('Hostname')], DefaultRootObject: 'index.html', PriceClass: 'PriceClass_All',
    ViewerCertificate: { AcmCertificateArn: ref('CertificateArn'), SslSupportMethod: 'sni-only', MinimumProtocolVersion: 'TLSv1.2_2021' },
    Origins: [{ Id: 'site', DomainName: get('SiteBucket', 'RegionalDomainName'), OriginAccessControlId: get('OriginAccess', 'Id'), S3OriginConfig: { OriginAccessIdentity: '' } }, { Id: 'api', DomainName: sub('${Api}.execute-api.${AWS::Region}.amazonaws.com'), OriginCustomHeaders: [{ HeaderName: 'X-RoleClue-Origin', HeaderValue: sub('{{resolve:secretsmanager:${ApiOriginSecret}:SecretString}}') }], CustomOriginConfig: { HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: 'https-only', OriginSSLProtocols: ['TLSv1.2'] } }],
    DefaultCacheBehavior: { TargetOriginId: 'site', ViewerProtocolPolicy: 'redirect-to-https', AllowedMethods: ['GET', 'HEAD', 'OPTIONS'], CachedMethods: ['GET', 'HEAD'], CachePolicyId: noCache, Compress: true, ResponseHeadersPolicyId: ref('SecurityHeaders'), FunctionAssociations: [{ EventType: 'viewer-request', FunctionARN: get('SpaRewrite', 'FunctionARN') }] },
    CacheBehaviors: [{ PathPattern: '/api/*', TargetOriginId: 'api', ViewerProtocolPolicy: 'https-only', AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'], CachedMethods: ['GET', 'HEAD'], CachePolicyId: noCache, OriginRequestPolicyId: apiOriginRequestPolicyId, Compress: true, ResponseHeadersPolicyId: ref('SecurityHeaders') }],
  } });
  r.SiteBucketPolicy = resource('AWS::S3::BucketPolicy', { Bucket: ref('SiteBucket'), PolicyDocument: { Version: '2012-10-17', Statement: [s3TlsDeny('SiteBucket'), { Effect: 'Allow', Principal: { Service: 'cloudfront.amazonaws.com' }, Action: 's3:GetObject', Resource: sub('${SiteBucket.Arn}/*'), Condition: { StringEquals: { 'AWS:SourceArn': sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}') } } }] } });
  r.Dns = resource('AWS::Route53::RecordSetGroup', { HostedZoneId: ref('HostedZoneId'), RecordSets: ['A', 'AAAA'].map(Type => ({ Name: ref('Hostname'), Type, AliasTarget: { DNSName: get('Distribution', 'DomainName'), HostedZoneId: 'Z2FDTNDATAQYW2', EvaluateTargetHealth: false } })) });
  const alarmActions = [ref('AlarmTopic')];
  r.FailedWorkAlarm = resource('AWS::CloudWatch::Alarm', { AlarmDescription: 'RoleClue async processing needs reconciliation', Namespace: 'AWS/SQS', MetricName: 'ApproximateNumberOfMessagesVisible', Dimensions: [{ Name: 'QueueName', Value: get('FailedWork', 'QueueName') }], Statistic: 'Maximum', Period: 300, EvaluationPeriods: 1, Threshold: 0, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching', AlarmActions: alarmActions });
  r.GenerationQueueAgeAlarm = resource('AWS::CloudWatch::Alarm', { AlarmDescription: 'RoleClue generation work has waited at least 15 minutes', Namespace: 'AWS/SQS', MetricName: 'ApproximateAgeOfOldestMessage', Dimensions: [{ Name: 'QueueName', Value: get('GenerationQueue', 'QueueName') }], Statistic: 'Maximum', Period: 300, EvaluationPeriods: 1, Threshold: 900, ComparisonOperator: 'GreaterThanOrEqualToThreshold', TreatMissingData: 'notBreaching', AlarmActions: alarmActions });
  r.GenerationQueueBacklogAlarm = resource('AWS::CloudWatch::Alarm', { AlarmDescription: 'RoleClue generation queue has a sustained backlog', Namespace: 'AWS/SQS', MetricName: 'ApproximateNumberOfMessagesVisible', Dimensions: [{ Name: 'QueueName', Value: get('GenerationQueue', 'QueueName') }], Statistic: 'Maximum', Period: 300, EvaluationPeriods: 2, Threshold: 100, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching', AlarmActions: alarmActions });
  r.RecommendationQueueAgeAlarm = resource('AWS::CloudWatch::Alarm', { AlarmDescription: 'RoleClue recommendation refresh work has waited at least 30 minutes', Namespace: 'AWS/SQS', MetricName: 'ApproximateAgeOfOldestMessage', Dimensions: [{ Name: 'QueueName', Value: get('RecommendationQueue', 'QueueName') }], Statistic: 'Maximum', Period: 300, EvaluationPeriods: 1, Threshold: 1800, ComparisonOperator: 'GreaterThanOrEqualToThreshold', TreatMissingData: 'notBreaching', AlarmActions: alarmActions });
  r.RecommendationQueueBacklogAlarm = resource('AWS::CloudWatch::Alarm', { AlarmDescription: 'RoleClue recommendation refresh queue has a sustained backlog', Namespace: 'AWS/SQS', MetricName: 'ApproximateNumberOfMessagesVisible', Dimensions: [{ Name: 'QueueName', Value: get('RecommendationQueue', 'QueueName') }], Statistic: 'Maximum', Period: 300, EvaluationPeriods: 2, Threshold: 100, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching', AlarmActions: alarmActions });
  r.LambdaErrorAlarm = resource('AWS::CloudWatch::Alarm', { AlarmDescription: 'RoleClue Lambda returned an error', Namespace: 'AWS/Lambda', MetricName: 'Errors', Dimensions: [{ Name: 'FunctionName', Value: ref('Function') }], Statistic: 'Sum', Period: 300, EvaluationPeriods: 1, Threshold: 0, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching', AlarmActions: alarmActions });
  r.LambdaThrottleAlarm = resource('AWS::CloudWatch::Alarm', { AlarmDescription: 'RoleClue Lambda was throttled', Namespace: 'AWS/Lambda', MetricName: 'Throttles', Dimensions: [{ Name: 'FunctionName', Value: ref('Function') }], Statistic: 'Sum', Period: 300, EvaluationPeriods: 1, Threshold: 0, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching', AlarmActions: alarmActions });
  r.ApiServerErrorAlarm = resource('AWS::CloudWatch::Alarm', { AlarmDescription: 'RoleClue API returned server errors', Namespace: 'AWS/ApiGateway', MetricName: '5xx', Dimensions: [{ Name: 'ApiId', Value: ref('Api') }], Statistic: 'Sum', Period: 300, EvaluationPeriods: 1, Threshold: 0, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching', AlarmActions: alarmActions });
  r.DynamoThrottleAlarm = resource('AWS::CloudWatch::Alarm', { AlarmDescription: 'RoleClue data store was throttled', Namespace: 'AWS/DynamoDB', MetricName: 'ThrottledRequests', Dimensions: [{ Name: 'TableName', Value: ref('Table') }], Statistic: 'Sum', Period: 300, EvaluationPeriods: 1, Threshold: 0, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching', AlarmActions: alarmActions });
  r.ReconciliationMetric = resource('AWS::Logs::MetricFilter', { LogGroupName: ref('LogGroup'), FilterPattern: '"generation_reconciliation_required"', MetricTransformations: [{ MetricNamespace: 'RoleClue', MetricName: 'GenerationReconciliationRequired', MetricValue: '1', DefaultValue: 0 }] });
  r.ReconciliationAlarm = resource('AWS::CloudWatch::Alarm', { AlarmDescription: 'A paid generation needs operator reconciliation', Namespace: 'RoleClue', MetricName: 'GenerationReconciliationRequired', Statistic: 'Sum', Period: 300, EvaluationPeriods: 1, Threshold: 0, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching', AlarmActions: alarmActions });
  r.GenerationRepairFailureMetric = resource('AWS::Logs::MetricFilter', { LogGroupName: ref('LogGroup'), FilterPattern: '"generation_dispatch_repair_failed"', MetricTransformations: [{ MetricNamespace: 'RoleClue', MetricName: 'GenerationDispatchRepairFailed', MetricValue: '1', DefaultValue: 0 }] });
  r.GenerationRepairFailureAlarm = resource('AWS::CloudWatch::Alarm', { AlarmDescription: 'A paid generation dispatch could not be repaired automatically', Namespace: 'RoleClue', MetricName: 'GenerationDispatchRepairFailed', Statistic: 'Sum', Period: 300, EvaluationPeriods: 1, Threshold: 0, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching', AlarmActions: alarmActions });
  r.AiAuthorityReviewMetric = resource('AWS::Logs::MetricFilter', { LogGroupName: ref('LogGroup'), FilterPattern: '"ai_authority_review_required"', MetricTransformations: [{ MetricNamespace: 'RoleClue', MetricName: 'AiAuthorityReviewRequired', MetricValue: '1', DefaultValue: 0 }] });
  r.AiAuthorityReviewAlarm = resource('AWS::CloudWatch::Alarm', { AlarmDescription: 'Review RoleClue AI pricing and renew its bounded authority before expiry', Namespace: 'RoleClue', MetricName: 'AiAuthorityReviewRequired', Statistic: 'Sum', Period: 300, EvaluationPeriods: 1, Threshold: 0, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching', AlarmActions: alarmActions });
  t.Outputs = {
    SiteUrl: { Value: sub('https://${Hostname}') }, SiteBucket: { Value: ref('SiteBucket') }, ResumeBucket: { Value: ref('ResumeBucket') },
    TableName: { Value: ref('Table') }, DistributionId: { Value: ref('Distribution') }, DistributionDomain: { Value: get('Distribution', 'DomainName') }, ApiUrl: { Value: get('Api', 'ApiEndpoint') },
    CognitoUserPoolId: { Value: ref('UserPool') }, CognitoClientId: { Value: ref('UserPoolClient') }, FunctionName: { Value: ref('Function') }, FunctionAliasArn: { Value: ref('FunctionAlias') }, FunctionVersion: { Value: get('FunctionVersion', 'Version') },
    LambdaArtifactVersion: { Value: ref('ArtifactVersion') }, SiteArtifactVersion: { Value: ref('SiteArtifactVersion') }, SiteArtifactSha256: { Value: ref('SiteArtifactSha256') },
    CognitoHostedDomain: { Condition: 'GoogleSignInEnabled', Value: sub('https://${CognitoDomainPrefix}.auth.${AWS::Region}.amazoncognito.com') },
    GenerationQueueUrl: { Value: ref('GenerationQueue') }, RecommendationQueueUrl: { Value: ref('RecommendationQueue') }, FailedWorkQueueUrl: { Value: ref('FailedWork') }, AlarmTopicArn: { Value: ref('AlarmTopic') },
    GenerationQueueArn: { Value: get('GenerationQueue', 'Arn') }, RecommendationQueueArn: { Value: get('RecommendationQueue', 'Arn') }, FailedWorkQueueArn: { Value: get('FailedWork', 'Arn') },
    DailyRefreshScheduleName: { Value: ref('DailyRefresh') }, GenerationRepairScheduleName: { Value: ref('GenerationRepair') }, AiAuthorityReviewScheduleName: { Value: ref('AiAuthorityReview') },
    LogGroupName: { Value: ref('LogGroup') },
  };
  return t;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve('build');
  await mkdir(dir, { recursive: true });
  for (const { name, data } of [
    { name: 'certificate', data: certificateTemplate() },
    { name: 'app', data: appTemplate() },
    { name: 'artifacts', data: artifactTemplate() },
  ]) {
    await writeFile(resolve(dir, `${name}.template.json`), JSON.stringify(data, null, 2));
  }
  console.log('Generated certificate and member-app CloudFormation templates in build/. No cloud changes made.');
}
