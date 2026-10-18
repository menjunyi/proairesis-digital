import { execFileSync } from 'node:child_process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AI_PRICING_EXPIRES_AT, AI_PRICING_VERSION, createAiBudget, sydneyBudgetDay } from '../server/ai-budget.mjs';

const ACCOUNT = '037169690315';
const REGION = 'ap-southeast-2';
const STACK = 'roleclue-member-app';
const PROFILE = process.env.AWS_PROFILE || (process.env.GITHUB_ACTIONS === 'true' ? '' : 'proairesis-management');
const NAMESPACE = 'SYSTEM#ROLECLUE_AI';
const DAILY_LIMIT_MICROS = 1_000_000;
const APPROVAL_REFERENCE = 'user-chat:call_c90a88e9ec7c4edb80aba505615ccca0:reserve-usd1-roleclue';
const APPLY = process.argv.includes('--apply');

function aws(...args) {
  const profileArguments = PROFILE ? ['--profile', PROFILE] : [];
  return JSON.parse(execFileSync('aws', [...args, ...profileArguments, '--region', REGION, '--no-cli-pager', '--output', 'json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 45_000, maxBuffer: 2 * 1024 * 1024,
  }));
}
const identity = aws('sts', 'get-caller-identity');
if (identity.Account !== ACCOUNT) throw new Error('Refusing to use an unexpected AWS account.');
const stack = aws('cloudformation', 'describe-stacks', '--stack-name', STACK).Stacks?.[0];
if (!stack?.StackId?.startsWith(`arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${STACK}/`) ||
  !['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus)) throw new Error('The RoleClue production stack is not ready.');
const table = stack.Outputs?.find(output => output.OutputKey === 'TableName')?.OutputValue;
if (!/^[A-Za-z0-9_.-]{3,255}$/.test(table || '')) throw new Error('The RoleClue table output is invalid.');
if (Date.now() >= Date.parse(AI_PRICING_EXPIRES_AT)) throw new Error('The pinned OpenAI price authority has expired. Review pricing before approval.');

if (PROFILE) process.env.AWS_PROFILE = PROFILE;
process.env.AWS_REGION = REGION;
const client = DynamoDBDocumentClient.from(new DynamoDBClient({region: REGION, maxAttempts: 2}), {marshallOptions:{removeUndefinedValues:true}});
const key = {pk: NAMESPACE, sk: 'POLICY'};
const current = (await client.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
const valid = current?.revision === 1 && current.value?.currency === 'USD' &&
  current.value.dailyLimitMicros === DAILY_LIMIT_MICROS && current.value.approvalReference === APPROVAL_REFERENCE &&
  current.value.pricingVersion === AI_PRICING_VERSION && current.value.expiresAt === AI_PRICING_EXPIRES_AT &&
  /^\d{4}-\d{2}-\d{2}$/.test(current.value.effectiveFrom || '') && Number.isFinite(Date.parse(current.value.approvedAt));

let created = false;
if (!current && APPLY) {
  const now = new Date();
  const item = {...key,revision:1,value:{
    currency:'USD', dailyLimitMicros:DAILY_LIMIT_MICROS, effectiveFrom:sydneyBudgetDay(now),
    approvalReference:APPROVAL_REFERENCE, approvedAt:now.toISOString(),
    pricingVersion:AI_PRICING_VERSION, expiresAt:AI_PRICING_EXPIRES_AT,
  }};
  await client.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_not_exists(pk)'}));
  created = true;
} else if (current && !valid) {
  throw new Error('An existing RoleClue AI policy does not match the approved US$1 daily boundary. Nothing was changed.');
}

const store = {
  async get(pk,sk){return (await client.send(new GetCommand({TableName:table,Key:{pk,sk},ConsistentRead:true}))).Item??null;},
  async transact(){throw new Error('Status must not write.');},
};
const status = await createAiBudget({store,namespace:NAMESPACE,maxDailySpendMicros:DAILY_LIMIT_MICROS}).status();
console.log(JSON.stringify({
  account:ACCOUNT, region:REGION, table, namespace:NAMESPACE, mode:APPLY?'apply':'dry-run',
  policy:created?'created':valid?'verified':'missing', dailyLimitUsd:1,
  pricingVersion:AI_PRICING_VERSION, pricingExpiresAt:AI_PRICING_EXPIRES_AT,
  status,
}));
client.destroy();
if (!APPLY && !valid) process.exitCode=2;
