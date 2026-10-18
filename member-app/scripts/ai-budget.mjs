import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {DynamoStore} from '../server/store.mjs';
import {AiBudgetError,createAiBudget,MAX_DAILY_USD_MICROS,ONE_TIME_KAIPAI_EXCEPTIONS,oneTimeExceptionForRequest} from '../server/ai-budget.mjs';

const ACCOUNT = '037169690315';
const REGION = 'ap-southeast-2';
const STACK = 'roleclue-member-app';
const NAMESPACE = 'SYSTEM#EXTERNAL_AI';
const execFileAsync = promisify(execFile);
class BudgetCliError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const requireValue = (condition, code, message) => { if (!condition) throw new BudgetCliError(code, message); };

export function parseArguments(argv) {
  const commands = new Set(['status','status-external','reserve-external','approve-one-time-external','reserve-one-time-external','reconcile-external','release-external']);
  const valueFlags = new Set(['table','profile','request-id','reserved-micros','actual-micros','actual-cny-fen','quoted-cny-fen','service','reference','fx-reference','job-approval-reference']);
  const booleanFlags = new Set(['apply','help','confirmed-zero-charge']);
  const result = {command: 'status'};
  let commandFound = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      requireValue(!commandFound && commands.has(arg), 'INVALID_ARGUMENTS', 'Use one supported command. See --help.');
      result.command = arg; commandFound = true; continue;
    }
    const key = arg.slice(2);
    requireValue(!(key in result), 'INVALID_ARGUMENTS', 'Duplicate options are not allowed.');
    if (booleanFlags.has(key)) result[key] = true;
    else {
      requireValue(valueFlags.has(key) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'INVALID_ARGUMENTS', 'Unknown or incomplete option. See --help.');
      result[key] = argv[++i];
    }
  }
  return result;
}

const usage = `Shared external-AI budget controller. Status and dry-run are read-only.

node scripts/ai-budget.mjs
node scripts/ai-budget.mjs status-external --request-id EXACT_JOB_ID
node scripts/ai-budget.mjs reserve-external --request-id UUID --reserved-micros 10000 --service PROVIDER --reference QUOTE_REFERENCE
node scripts/ai-budget.mjs reserve-external --apply --request-id EXACT_JOB_ID --reserved-micros ALL_IN_USD_UPPER_BOUND --quoted-cny-fen QUOTED_CNY_FEN --fx-reference RATE_AND_TOPUP_EVIDENCE --service kaipai.video --reference FINAL_QUOTE_SHA256
node scripts/ai-budget.mjs reserve-external --apply --request-id UUID --reserved-micros 10000 --service PROVIDER --reference QUOTE_REFERENCE
node scripts/ai-budget.mjs approve-one-time-external --apply --request-id EXACT_JOB_ID --reserved-micros ALL_IN_USD_UPPER_BOUND --quoted-cny-fen EXACT_CHARGE_IN_FEN --service kaipai.video --reference FINAL_QUOTE_SHA256 --fx-reference RATE_EVIDENCE --job-approval-reference EXACT_JOB_CONSENT
node scripts/ai-budget.mjs reserve-one-time-external --apply --request-id EXACT_JOB_ID --reserved-micros SAME_USD_BOUND --quoted-cny-fen SAME_CNY_CHARGE --service kaipai.video --reference SAME_FINAL_QUOTE_SHA256
node scripts/ai-budget.mjs reconcile-external --apply --request-id UUID --actual-micros 8000 --service PROVIDER --reference USAGE_REFERENCE
node scripts/ai-budget.mjs reconcile-external --apply --request-id EXACT_JOB_ID --actual-micros ACTUAL_USD --actual-cny-fen ACTUAL_CREDIT_VALUE --service kaipai.video --reference PROVIDER_USAGE_EVIDENCE
node scripts/ai-budget.mjs release-external --apply --confirmed-zero-charge --request-id UUID --service PROVIDER --reference ZERO_CHARGE_EVIDENCE

Amounts are integer micro-US dollars (1 USD = 1000000); include taxes, fees and conversion in the upper bound.
Reserve before the external call. A reservation alone does not call a provider.
Unknown outcomes must retain their reservation; never release or automatically retry them.
Only an explicitly approved shared POLICY or dated ENVELOPE authorizes spending.
The one-time Kaipai exceptions apply only on 2026-10-14 Sydney time, each to its own exact job and final quote. The first is capped at CNY 30; the second is capped at CNY 10 and requires static binding to the actual boss-IP job ID and final quote hash. Neither raises the ordinary US$5 cap. Obtain exact-job user consent before the approval command; approval and reservation are separate auditable writes. Neither calls the provider.
All writes require --apply. No command can create a policy or daily approval.
Target: account 037169690315, ap-southeast-2, stack roleclue-member-app, namespace SYSTEM#EXTERNAL_AI.
Optional --profile defaults to proairesis-management. --table must exactly match this stack's TableName output.
Do not pass keys, tokens, documents or personal data as references. They are stored as audit metadata.`;

function validateOptions(options, oneTimeExceptions) {
  requireValue(!options.profile || /^[A-Za-z0-9_.-]{1,100}$/.test(options.profile), 'INVALID_PROFILE', 'Use an existing named AWS profile.');
  if (options.command === 'status') {
    requireValue(!['apply','confirmed-zero-charge','request-id','reserved-micros','actual-micros','actual-cny-fen','quoted-cny-fen','service','reference','fx-reference','job-approval-reference'].some(k => options[k] !== undefined), 'INVALID_ARGUMENTS', 'Status does not accept mutation options.');
    return null;
  }
  requireValue(/^[A-Za-z0-9_-]{16,128}$/.test(options['request-id'] ?? ''), 'INVALID_REQUEST', 'Supply a unique request identifier of 16 to 128 letters, digits, underscores or hyphens.');
  if (options.command === 'status-external') {
    requireValue(!['apply','confirmed-zero-charge','reserved-micros','actual-micros','actual-cny-fen','quoted-cny-fen','service','reference','fx-reference','job-approval-reference'].some(k => options[k] !== undefined), 'INVALID_ARGUMENTS', 'External status accepts only an exact request identifier.');
    return null;
  }
  requireValue(/^[A-Za-z0-9_.:-]{1,60}$/.test(options.service ?? ''), 'INVALID_SERVICE', 'Supply the provider or service name.');
  requireValue(typeof options.reference === 'string' && options.reference.trim() && options.reference.length <= 250 && !/[\x00-\x1f\x7f]/.test(options.reference), 'EVIDENCE_REQUIRED', 'Supply a non-sensitive quote, usage or support reference.');
  const amount = flag => {
    const value = options[flag];
    requireValue(typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)), 'INVALID_AMOUNT', `Supply --${flag} as integer micro-US dollars.`);
    return Number(value);
  };
  let oneTimeException = null;
  if (options.command === 'reserve-external') {
    requireValue(amount('reserved-micros') > 0 && amount('reserved-micros') <= MAX_DAILY_USD_MICROS &&
      !options['actual-micros'] && !options['actual-cny-fen'] && !options['job-approval-reference'] && !options['confirmed-zero-charge'] &&
      (options['quoted-cny-fen'] === undefined && options['fx-reference'] === undefined ||
        options['quoted-cny-fen'] !== undefined && amount('quoted-cny-fen') > 0 &&
        typeof options['fx-reference'] === 'string' && options['fx-reference'].trim() && options['fx-reference'].length <= 250 &&
        !/[\x00-\x1f\x7f]/.test(options['fx-reference'])),
    'INVALID_AMOUNT', 'Reserve between 1 and 5000000 micro-US dollars; CNY quotes need a positive fen amount and FX evidence.');
  } else if (['approve-one-time-external','reserve-one-time-external'].includes(options.command)) {
    oneTimeException = oneTimeExceptionForRequest(options['request-id'], oneTimeExceptions);
    requireValue(oneTimeException && options.service === oneTimeException.service && /^[a-f0-9]{64}$/.test(options.reference) &&
      (oneTimeException.quoteHash === undefined || options.reference === oneTimeException.quoteHash) &&
      amount('reserved-micros') > 0 && amount('reserved-micros') <= oneTimeException.maxUsdMicros &&
      amount('quoted-cny-fen') > 0 && amount('quoted-cny-fen') <= oneTimeException.maxCnyFen &&
      !options['actual-micros'] && !options['actual-cny-fen'] && !options['confirmed-zero-charge'],
    'AI_EXCEPTION_INVALID', 'Use a configured exact Kaipai job, quote hash and its bounded CNY/USD cost.');
    if (options.command === 'approve-one-time-external')
      requireValue(typeof options['fx-reference'] === 'string' && options['fx-reference'].trim() && typeof options['job-approval-reference'] === 'string' && options['job-approval-reference'].trim(),
        'EVIDENCE_REQUIRED', 'Approval needs currency-conversion evidence and exact-job user consent.');
    else requireValue(!options['fx-reference'] && !options['job-approval-reference'], 'INVALID_ARGUMENTS', 'Reservation must match the already approved exception without new approval fields.');
  } else if (options.command === 'reconcile-external') {
    const actualMicros = amount('actual-micros');
    requireValue(!options['reserved-micros'] && !options['quoted-cny-fen'] && !options['fx-reference'] && !options['job-approval-reference'], 'INVALID_ARGUMENTS', 'Reconciliation accepts actual usage only.');
    if (options['actual-cny-fen'] !== undefined) amount('actual-cny-fen');
    requireValue(actualMicros !== 0 || options['confirmed-zero-charge'] === true, 'ZERO_CHARGE_CONFIRMATION_REQUIRED', 'A zero-cost reconciliation requires --confirmed-zero-charge and evidence.');
    requireValue(actualMicros === 0 || !options['confirmed-zero-charge'], 'INVALID_ARGUMENTS', 'Zero-charge confirmation cannot accompany a positive charge.');
  } else {
    requireValue(options['confirmed-zero-charge'] === true && !options['reserved-micros'] && !options['actual-micros'] && !options['actual-cny-fen'] && !options['quoted-cny-fen'] && !options['fx-reference'] && !options['job-approval-reference'], 'ZERO_CHARGE_CONFIRMATION_REQUIRED', 'Release requires --confirmed-zero-charge and a non-sensitive evidence reference.');
  }
  return oneTimeException;
}

async function awsRead(profile, service, operation, input = {}) {
  requireValue(['sts:get-caller-identity','cloudformation:describe-stacks'].includes(`${service}:${operation}`), 'UNSUPPORTED_AWS_READ', 'Only identity and target lookup are allowed.');
  try {
    const {stdout} = await execFileAsync('aws', [service, operation, '--profile', profile, '--region', REGION,
      '--output', 'json', '--no-cli-pager', '--cli-connect-timeout', '10', '--cli-read-timeout', '20', '--cli-input-json', JSON.stringify(input)],
    {timeout: 30000, maxBuffer: 256 * 1024, env: {...process.env, AWS_MAX_ATTEMPTS: '2'}});
    return JSON.parse(stdout);
  } catch { throw new BudgetCliError('AWS_TARGET_LOOKUP_FAILED', 'Could not verify the configured AWS identity and stack. Nothing was changed.'); }
}

async function createStore(table, profile) {
  const {DynamoDBClient} = await import('@aws-sdk/client-dynamodb');
  const commands = await import('@aws-sdk/lib-dynamodb');
  const client = commands.DynamoDBDocumentClient.from(new DynamoDBClient({region: REGION, profile, maxAttempts: 2}), {marshallOptions: {removeUndefinedValues: true}});
  const boundedClient = {send: command => client.send(command, {abortSignal: AbortSignal.timeout(20000)})};
  return new DynamoStore(boundedClient, table, commands);
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(argv);
  if (options.help) return {help: usage};
  const oneTimeExceptions = dependencies.oneTimeExceptions ?? ONE_TIME_KAIPAI_EXCEPTIONS;
  const oneTimeException = validateOptions(options, oneTimeExceptions);
  const profile = options.profile || 'proairesis-management';
  const read = dependencies.awsRead ?? ((service, operation, input) => awsRead(profile, service, operation, input));
  const caller = await read('sts', 'get-caller-identity');
  requireValue(caller.Account === ACCOUNT, 'ACCOUNT_MISMATCH', 'AWS account mismatch. Nothing was changed.');
  const result = await read('cloudformation', 'describe-stacks', {StackName: STACK});
  const stack = result.Stacks?.[0];
  requireValue(stack?.StackId?.startsWith(`arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${STACK}/`), 'STACK_MISMATCH', 'Stack account or region mismatch. Nothing was changed.');
  requireValue(['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(stack.StackStatus), 'STACK_NOT_READY', 'The budget stack must be in a completed state.');
  const table = stack.Outputs?.find(output => output.OutputKey === 'TableName')?.OutputValue;
  requireValue(typeof table === 'string' && /^[A-Za-z0-9_.-]{3,255}$/.test(table) && (!options.table || options.table === table), 'TABLE_MISMATCH', 'The table must match the approved RoleClue stack. Nothing was changed.');
  const store = dependencies.store ?? await createStore(table, profile);
  const budget = createAiBudget({store, namespace: NAMESPACE, now: dependencies.now, oneTimeExceptions});
  const base = {account: ACCOUNT, region: REGION, table, namespace: NAMESPACE};
  if (options.command === 'status-external')
    return {...base, command: options.command, ...await budget.externalReservationStatus(options['request-id'])};
  const status = await budget.status();
  if (options.command === 'status') {
    const row = await store.get(NAMESPACE, `DAY#${status.budgetDay}`);
    return {...base, ...status, spentMicros: row?.value.spentMicros ?? 0, reservedMicros: row?.value.reservedMicros ?? 0};
  }
  if (options.command === 'approve-one-time-external') {
    const fields = {requestId: options['request-id'], reservedMicros: Number(options['reserved-micros']),
      quotedCnyFen: Number(options['quoted-cny-fen']), service: options.service, reference: options.reference,
      fxReference: options['fx-reference'], jobApprovalReference: options['job-approval-reference']};
    if (!options.apply) {
      const existing = await store.get(NAMESPACE, `EXCEPTION#${oneTimeException.id}`);
      return {...base, dryRun: true, command: options.command, canApprove: !existing && status.budgetDay === oneTimeException.day &&
        !['AI_BUDGET_UNAPPROVED','AI_BUDGET_INVALID','AI_BUDGET_REVIEW_REQUIRED'].includes(status.reason),
        exceptionId: oneTimeException.id, requestKey: `REQUEST#${createHash('sha256').update(fields.requestId).digest('hex')}`,
        quoteHash: fields.reference, reservedMicros: fields.reservedMicros, quotedCnyFen: fields.quotedCnyFen, expiresAt: oneTimeException.expiresAt};
    }
    const approval = await budget.approveOneTimeExternal(fields);
    return {...base, applied: true, command: options.command, exceptionId: approval.id, requestKey: approval.requestKey,
      quoteHash: approval.quoteHash, reservedMicros: approval.reservedMicros, quotedCnyFen: approval.quotedCnyFen, expiresAt: approval.expiresAt};
  }
  if (options.command === 'reserve-one-time-external') {
    const fields = {requestId: options['request-id'], reservedMicros: Number(options['reserved-micros']),
      quotedCnyFen: Number(options['quoted-cny-fen']), service: options.service, reference: options.reference};
    if (!options.apply) return {...base, dryRun: true, command: options.command, ...await budget.oneTimeExternalStatus(fields)};
    const reservation = await budget.reserveOneTimeExternal(fields);
    return {...base, applied: true, command: options.command, budgetDay: reservation.day, requestKey: reservation.requestKey,
      status: reservation.status, reservedMicros: reservation.reservedMicros, quotedCnyFen: reservation.quotedCnyFen};
  }
  if (options.command === 'reserve-external') {
    const existing = await store.get(NAMESPACE, `REQUEST#${createHash('sha256').update(options['request-id']).digest('hex')}`);
    requireValue(!existing, 'REQUEST_ALREADY_EXISTS', 'This request already has a budget record; do not call the provider again.');
    const reservedMicros = Number(options['reserved-micros']);
    if (!options.apply) return {...base, dryRun: true, command: options.command, canReserve: status.enabled && status.remainingMicros >= reservedMicros, reservedMicros, ...status};
    const reservation = await budget.reserveExternal({requestId: options['request-id'], reservedMicros, service: options.service, reference: options.reference,
      ...(options['quoted-cny-fen'] === undefined ? {} : {quotedCnyFen: Number(options['quoted-cny-fen']), fxReference: options['fx-reference']})});
    return {...base, applied: true, command: options.command, budgetDay: reservation.day, requestKey: reservation.requestKey,
      status: reservation.status, reservedMicros: reservation.reservedMicros,
      ...(reservation.quotedCnyFen === undefined ? {} : {quotedCnyFen: reservation.quotedCnyFen})};
  }
  const row = await store.get(NAMESPACE, `REQUEST#${createHash('sha256').update(options['request-id']).digest('hex')}`);
  requireValue(row?.value.kind === 'external' && row.value.service === options.service, 'REQUEST_MISMATCH', 'No matching external-service reservation exists.');
  requireValue(options.command !== 'reconcile-external' || (row.value.quotedCnyFen !== undefined) === (options['actual-cny-fen'] !== undefined),
    row.value.exceptionId ? 'AI_EXCEPTION_INVALID' : 'AI_USAGE_INVALID',
    'CNY-quoted reconciliation requires the actual CNY credit value; unquoted usage must omit it.');
  if (!options.apply) return {...base, dryRun: true, command: options.command, budgetDay: row.value.day, status: row.value.status, reservedMicros: row.value.reservedMicros, ...(options.command === 'reconcile-external' ? {actualMicros: Number(options['actual-micros']), ...(row.value.exceptionId ? {actualCnyFen: Number(options['actual-cny-fen'])} : {})} : {})};
  const settled = options.command === 'reconcile-external'
    ? await budget.settleExternal(row.value, {actualMicros: Number(options['actual-micros']), ...(row.value.quotedCnyFen !== undefined ? {actualCnyFen: Number(options['actual-cny-fen'])} : {}), reference: options.reference})
    : await budget.release(row.value, {reason: 'CONFIRMED_ZERO_CHARGE', reference: options.reference});
  return {...base, applied: true, command: options.command, budgetDay: settled.day, requestKey: settled.requestKey,
    status: settled.status, actualMicros: settled.actualMicros,
    ...(settled.quotedCnyFen === undefined ? {} : {actualCnyFen: settled.actualCnyFen ?? 0}), boundExceeded: settled.boundExceeded === true};
}

export function safeFailure(error) {
  const expected = error instanceof BudgetCliError || error instanceof AiBudgetError;
  return {error: expected ? error.code : 'BUDGET_OPERATION_FAILED', message: expected ? error.message : 'Budget operation failed. Review the existing reservation before retrying; no provider call was launched.'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const result = await main(); console.log(result.help ?? JSON.stringify(result, null, 2)); }
  catch (error) { console.error(JSON.stringify(safeFailure(error))); process.exitCode = 1; }
}
