import {createHash} from 'node:crypto';
import {Conflict,change,retryConflict} from './store.mjs';

export const AI_MODEL = 'gpt-4.1-mini-2025-04-14';
export const AI_PRICING_VERSION = `${AI_MODEL}:2026-10-12`;
export const AI_PRICING_EXPIRES_AT = '2026-11-11T13:00:00.000Z';
export const MAX_DAILY_USD_MICROS = 5_000_000;
const TIME_ZONE = 'Australia/Sydney';
export const ONE_TIME_KAIPAI_EXCEPTION = Object.freeze({
  id: 'northstar-kaipai-product-photo-2026-10-14',
  requestId: '36901f31e73a4899acaa7f4f7b50fe18',
  day: '2026-10-14',
  service: 'kaipai.video',
  maxCnyFen: 3000,
  maxUsdMicros: 6_000_000,
  expiresAt: '2026-10-14T13:00:00.000Z',
  approvalReference: 'junyi-chat-reply-call_1df6323e69f04facb698e0e6dfed3841',
});
export const ONE_TIME_KAIPAI_SERUM_EXCEPTION = Object.freeze({
  id: 'northstar-kaipai-serum-2026-10-14',
  requestId: '4fa0a65bbd7948dd9b6d8b49e7f3d9c3',
  quoteHash: 'c8b46b662979436cd9a6dc6ccec9d4cc1950da3182e1f6c847d62200af740406',
  day: '2026-10-14',
  service: 'kaipai.video',
  maxCnyFen: 1000,
  maxUsdMicros: 2_000_000,
  expiresAt: '2026-10-14T13:00:00.000Z',
  approvalReference: 'junyi-chat-reply-call_6a9f5b940a634874869a98fcf041d771',
});
export const ONE_TIME_KAIPAI_EXCEPTIONS = Object.freeze([ONE_TIME_KAIPAI_EXCEPTION, ONE_TIME_KAIPAI_SERUM_EXCEPTION]);

export class AiBudgetError extends Error {
  constructor(code, message) { super(message); this.code = code; this.status = 503; }
}
const fail = (code, message) => { throw new AiBudgetError(code, message); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const requestKeyFor = requestId => `REQUEST#${createHash('sha256').update(requestId).digest('hex')}`;
const validRequestId = requestId => typeof requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(requestId);
const validQuoteHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function oneTimeExceptionForRequest(requestId, exceptions = ONE_TIME_KAIPAI_EXCEPTIONS) {
  if (!validRequestId(requestId) || !Array.isArray(exceptions)) return null;
  const matches = exceptions.filter(exception => exception?.requestId === requestId);
  return matches.length === 1 ? matches[0] : null;
}

export function sydneyBudgetDay(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);
}

// Standard uncached text rates, plus a 10% tax/fee margin, rounded upwards.
// https://developers.openai.com/api/docs/models/gpt-4.1-mini
export function aiCostMicros(inputTokens, outputTokens) {
  if (!integer(inputTokens) || !integer(outputTokens) || inputTokens > 1_047_576 || outputTokens > 32_768)
    fail('AI_USAGE_INVALID', 'The model usage cannot be bounded safely.');
  return Number(((BigInt(inputTokens) * 4n + BigInt(outputTokens) * 16n) * 110n + 999n) / 1000n);
}

function validEnvelope(value, day, now) {
  return value?.day === day && value.currency === 'USD' &&
    integer(value.approvedMicros) && value.approvedMicros > 0 && value.approvedMicros <= MAX_DAILY_USD_MICROS &&
    typeof value.approvalReference === 'string' && value.approvalReference.trim().length > 0 && value.approvalReference.length <= 250 &&
    Number.isFinite(Date.parse(value.approvedAt)) && Date.parse(value.approvedAt) <= now.getTime() &&
    value.pricingVersion === AI_PRICING_VERSION && now.getTime() < Date.parse(AI_PRICING_EXPIRES_AT) &&
    (!value.expiresAt || Number.isFinite(Date.parse(value.expiresAt)) && now.getTime() < Date.parse(value.expiresAt));
}
function emptyLedger() {
  return {version: 1, spentMicros: 0, reservedMicros: 0, calls: 0, tokens: 0, reservedTokens: 0, blocked: false};
}
function ledgerValue(row) {
  if (!row) return emptyLedger();
  const value = row.value;
  if (value?.version !== 1 || !['spentMicros','reservedMicros','calls','tokens','reservedTokens'].every(k => integer(value[k])) || typeof value.blocked !== 'boolean')
    fail('AI_BUDGET_INVALID', 'The daily AI budget needs operator review.');
  return value;
}
function safeReference(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,150}$/.test(value) ? value : null;
}

export function createAiBudget({store, namespace = 'SYSTEM#EXTERNAL_AI', now = () => new Date(), oneTimeExceptions = ONE_TIME_KAIPAI_EXCEPTIONS, maxDailySpendMicros = MAX_DAILY_USD_MICROS}) {
  if (!store || typeof namespace !== 'string' || !/^SYSTEM#[A-Za-z0-9:_-]{1,100}$/.test(namespace))
    throw new TypeError('A shared budget store and system namespace are required.');
  if (!integer(maxDailySpendMicros) || maxDailySpendMicros < 1 || maxDailySpendMicros > MAX_DAILY_USD_MICROS)
    throw new TypeError('The local daily AI spend cap is invalid.');
  const pk = namespace;
  const clock = () => new Date(now());
  const oneTimeExceptionById = exceptionId => oneTimeExceptions.find(exception => exception.id === exceptionId);
  const exceptionKey = exception => `EXCEPTION#${exception.id}`;

  function policyEnvelope(row, day, date) {
    const value = row?.value;
    if (!value || value.currency !== 'USD' || !integer(value.dailyLimitMicros) || value.dailyLimitMicros < 1 || value.dailyLimitMicros > MAX_DAILY_USD_MICROS ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.effectiveFrom ?? '') || value.effectiveFrom > day ||
        !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) > Date.parse(AI_PRICING_EXPIRES_AT)) return null;
    const envelope = {
      day, currency: 'USD', approvedMicros: value.dailyLimitMicros,
      approvalReference: value.approvalReference, approvedAt: value.approvedAt,
      pricingVersion: value.pricingVersion, expiresAt: value.expiresAt,
      policyDerived: true, policyRevision: row.revision,
    };
    return validEnvelope(envelope, day, date) ? envelope : null;
  }

  async function approvalForDay(day, date) {
    const row = await store.get(pk, `ENVELOPE#${day}`);
    if (row) {
      if (!validEnvelope(row.value, day, date)) return null;
      if (!row.value.policyDerived) return {row, value: row.value};
      const policy = await store.get(pk, 'POLICY'), approved = policyEnvelope(policy, day, date);
      if (!approved || row.value.policyRevision !== policy.revision || row.value.approvedMicros !== approved.approvedMicros) return null;
      return {row, value: row.value, policy};
    }
    const policy = await store.get(pk, 'POLICY'), value = policyEnvelope(policy, day, date);
    return value ? {row: null, value, policy} : null;
  }

  async function status({callLimit = Number.MAX_SAFE_INTEGER, tokenLimit = Number.MAX_SAFE_INTEGER} = {}) {
    const date = clock(), day = sydneyBudgetDay(date);
    const approval = await approvalForDay(day, date);
    if (!approval)
      return {enabled: false, reason: 'AI_BUDGET_UNAPPROVED', budgetDay: day, remainingMicros: 0};
    let ledger;
    try { ledger = ledgerValue(await store.get(pk, `DAY#${day}`)); }
    catch { return {enabled: false, reason: 'AI_BUDGET_INVALID', budgetDay: day, remainingMicros: 0}; }
    const remainingMicros = Math.max(0, Math.min(approval.value.approvedMicros, maxDailySpendMicros) - ledger.spentMicros - ledger.reservedMicros);
    const exhausted = remainingMicros === 0 || ledger.calls >= callLimit || ledger.tokens + ledger.reservedTokens >= tokenLimit;
    return {
      enabled: !ledger.blocked && !exhausted,
      reason: ledger.blocked ? 'AI_BUDGET_REVIEW_REQUIRED' : exhausted ? 'AI_BUDGET_EXHAUSTED' : null,
      budgetDay: day, remainingMicros,
    };
  }

  async function reserve({requestId, inputTokenUpperBound, maxOutputTokens, callLimit, tokenLimit}) {
    if (!integer(inputTokenUpperBound) || inputTokenUpperBound < 1 || !integer(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 1200 ||
        !integer(callLimit) || callLimit < 1 || !integer(tokenLimit) || tokenLimit < 1)
      fail('AI_BUDGET_INVALID', 'The model limits are not configured safely.');
    const reservedMicros = aiCostMicros(inputTokenUpperBound, maxOutputTokens);
    const reservedTokens = inputTokenUpperBound + maxOutputTokens;
    return reserveAmount({requestId, reservedMicros, reservedTokens, callLimit, tokenLimit,
      metadata: {kind: 'model', service: 'openai.responses', inputTokenUpperBound, maxOutputTokens, model: AI_MODEL, pricingVersion: AI_PRICING_VERSION}});
  }

  function auditReference(value) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 250 && !/[\x00-\x1f\x7f]/.test(value);
  }

  async function reserveExternal({requestId, reservedMicros, service, reference, quotedCnyFen, fxReference}) {
    if (!integer(reservedMicros) || reservedMicros < 1 || reservedMicros > MAX_DAILY_USD_MICROS ||
        typeof service !== 'string' || !/^[a-zA-Z0-9_.:-]{1,60}$/.test(service) || !auditReference(reference) ||
        (quotedCnyFen !== undefined || fxReference !== undefined) &&
          (!integer(quotedCnyFen) || quotedCnyFen < 1 || !auditReference(fxReference)))
      fail('AI_EXTERNAL_RESERVATION_INVALID', 'External usage requires a bounded all-in cost, service and evidence reference.');
    return reserveAmount({requestId, reservedMicros, reservedTokens: 0, callLimit: Number.MAX_SAFE_INTEGER, tokenLimit: Number.MAX_SAFE_INTEGER,
      metadata: {kind: 'external', service, reference: reference.trim(),
        ...(quotedCnyFen === undefined ? {} : {quotedCnyFen, fxReference: fxReference.trim()})}});
  }

  async function externalReservationStatus(requestId) {
    if (!validRequestId(requestId)) fail('AI_REQUEST_INVALID', 'A valid external request identifier is required.');
    const requestKey = requestKeyFor(requestId);
    const row = await store.get(pk, requestKey);
    if (!row) return {exists: false, requestKey};
    const value = row.value;
    if (value?.kind !== 'external' || !['reserved', 'uncertain', 'settled', 'released'].includes(value.status) ||
        value.requestKey !== requestKey || !/^\d{4}-\d{2}-\d{2}$/.test(value.day ?? '') ||
        !integer(value.reservedMicros) || value.reservedMicros < 1 ||
        typeof value.service !== 'string' || !auditReference(value.reference))
      fail('AI_REQUEST_MISMATCH', 'The request does not contain a valid external reservation.');
    return {
      exists: true, requestKey, budgetDay: value.day, status: value.status,
      service: value.service, reference: value.reference, reservedMicros: value.reservedMicros,
      ...(integer(value.quotedCnyFen) ? {quotedCnyFen: value.quotedCnyFen} : {}),
      ...(typeof value.fxReference === 'string' ? {fxReference: value.fxReference} : {}),
      ...(integer(value.actualMicros) ? {actualMicros: value.actualMicros} : {}),
      ...(integer(value.actualCnyFen) ? {actualCnyFen: value.actualCnyFen} : {}),
      ...(typeof value.usageReference === 'string' ? {usageReference: value.usageReference} : {}),
      ...(typeof value.releaseReference === 'string' ? {releaseReference: value.releaseReference} : {}),
    };
  }

  function validateOneTimeInput({requestId, reservedMicros, service, reference, quotedCnyFen}) {
    const exception = oneTimeExceptionForRequest(requestId, oneTimeExceptions);
    if (!exception || service !== exception.service || !validQuoteHash(reference) ||
        (exception.quoteHash !== undefined && reference !== exception.quoteHash) ||
        !integer(quotedCnyFen) || quotedCnyFen < 1 || quotedCnyFen > exception.maxCnyFen ||
        !integer(reservedMicros) || reservedMicros < 1 || reservedMicros > exception.maxUsdMicros)
      fail('AI_EXCEPTION_INVALID', 'This one-time exception requires the exact Kaipai job, quote and bounded CNY/USD cost.');
    return {exception, requestKey: requestKeyFor(requestId)};
  }

  async function approveOneTimeExternal({requestId, reservedMicros, service, reference, quotedCnyFen, fxReference, jobApprovalReference}) {
    const {exception, requestKey} = validateOneTimeInput({requestId, reservedMicros, service, reference, quotedCnyFen});
    if (!auditReference(fxReference) || !auditReference(jobApprovalReference))
      fail('AI_EXCEPTION_INVALID', 'Currency conversion and exact-job approval need non-sensitive audit references.');
    const date = clock(), day = sydneyBudgetDay(date);
    if (day !== exception.day || date.getTime() >= Date.parse(exception.expiresAt))
      fail('AI_EXCEPTION_EXPIRED', 'The one-time video authorization has expired.');
    if (!await approvalForDay(day, date))
      fail('AI_BUDGET_UNAPPROVED', 'The shared AI ledger is not approved for this day.');
    if (ledgerValue(await store.get(pk, `DAY#${day}`)).blocked)
      fail('AI_BUDGET_REVIEW_REQUIRED', 'The shared AI ledger needs operator review.');
    const value = {
      id: exception.id, day, status: 'approved', requestKey,
      service, quoteHash: reference, quotedCnyFen, reservedMicros,
      fxReference: fxReference.trim(), jobApprovalReference: jobApprovalReference.trim(),
      approvalReference: exception.approvalReference,
      approvedAt: date.toISOString(), expiresAt: exception.expiresAt,
    };
    try { await store.transact([change(pk, exceptionKey(exception), null, value)]); }
    catch (error) {
      if (error instanceof Conflict) fail('AI_EXCEPTION_ALREADY_APPROVED', 'This one-time exception was already approved and cannot be reassigned.');
      throw error;
    }
    return value;
  }

  async function oneTimeExternalStatus({requestId, reservedMicros, service, reference, quotedCnyFen}) {
    const {exception, requestKey} = validateOneTimeInput({requestId, reservedMicros, service, reference, quotedCnyFen});
    const date = clock(), day = sydneyBudgetDay(date);
    const row = await store.get(pk, exceptionKey(exception)), value = row?.value;
    const matches = value?.id === exception.id && value.day === day && value.status === 'approved' &&
      value.requestKey === requestKey && value.service === service && value.quoteHash === reference &&
      value.quotedCnyFen === quotedCnyFen && value.reservedMicros === reservedMicros &&
      value.approvalReference === exception.approvalReference &&
      value.expiresAt === exception.expiresAt;
    const validTime = day === exception.day && date.getTime() < Date.parse(exception.expiresAt);
    const approvedDay = Boolean(await approvalForDay(day, date));
    const ledger = ledgerValue(await store.get(pk, `DAY#${day}`));
    const duplicate = Boolean(await store.get(pk, requestKey));
    return {canReserve: Boolean(matches && validTime && approvedDay && !ledger.blocked && !duplicate),
      reason: !validTime ? 'AI_EXCEPTION_EXPIRED' : !matches ? 'AI_EXCEPTION_MISMATCH' : !approvedDay ? 'AI_BUDGET_UNAPPROVED' :
        ledger.blocked ? 'AI_BUDGET_REVIEW_REQUIRED' : duplicate ? 'AI_REQUEST_ALREADY_RESERVED' : null};
  }

  async function reserveOneTimeExternal({requestId, reservedMicros, service, reference, quotedCnyFen}) {
    const {exception, requestKey} = validateOneTimeInput({requestId, reservedMicros, service, reference, quotedCnyFen});
    return retryConflict(async () => {
      const date = clock(), day = sydneyBudgetDay(date);
      if (day !== exception.day || date.getTime() >= Date.parse(exception.expiresAt))
        fail('AI_EXCEPTION_EXPIRED', 'The one-time video authorization has expired.');
      const approval = await approvalForDay(day, date);
      if (!approval) fail('AI_BUDGET_UNAPPROVED', 'The shared AI ledger is not approved for this day.');
      const exceptionRow = await store.get(pk, exceptionKey(exception)), approved = exceptionRow?.value;
      if (!approved || approved.id !== exception.id || approved.day !== day || approved.status !== 'approved' ||
          approved.requestKey !== requestKey || approved.service !== service || approved.quoteHash !== reference ||
          approved.quotedCnyFen !== quotedCnyFen || approved.reservedMicros !== reservedMicros ||
          approved.approvalReference !== exception.approvalReference ||
          approved.expiresAt !== exception.expiresAt)
        fail('AI_EXCEPTION_MISMATCH', 'The approved one-time job, quote or cost does not match this reservation.');
      if (await store.get(pk, requestKey))
        fail('AI_REQUEST_ALREADY_RESERVED', 'This job already has a budget reservation and cannot be sent again.');
      const dayKey = `DAY#${day}`, envelopeKey = `ENVELOPE#${day}`;
      const row = await store.get(pk, dayKey), ledger = ledgerValue(row);
      if (ledger.blocked) fail('AI_BUDGET_REVIEW_REQUIRED', 'The shared AI ledger needs operator review.');
      const reservation = {
        day, requestKey, status: 'reserved', reservedMicros, reservedTokens: 0,
        createdAt: date.toISOString(), kind: 'external', service, reference,
        exceptionId: exception.id, quotedCnyFen,
      };
      await store.transact([
        approval.row ? {pk, sk: envelopeKey, expected: approval.row.revision, checkOnly: true} : change(pk, envelopeKey, null, approval.value),
        ...(approval.policy ? [{pk, sk: 'POLICY', expected: approval.policy.revision, checkOnly: true}] : []),
        change(pk, dayKey, row, {...ledger, reservedMicros: ledger.reservedMicros + reservedMicros, calls: ledger.calls + 1}),
        change(pk, requestKey, null, reservation),
        change(pk, exceptionKey(exception), exceptionRow, {...approved, status: 'reserved', reservedAt: date.toISOString()}),
      ]);
      return reservation;
    });
  }

  async function reserveAmount({requestId, reservedMicros, reservedTokens, callLimit, tokenLimit, metadata}) {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId))
      fail('AI_REQUEST_INVALID', 'A valid model request identifier is required.');
    const requestKey = requestKeyFor(requestId);
    const date = clock(), day = sydneyBudgetDay(date), dayKey = `DAY#${day}`, envelopeKey = `ENVELOPE#${day}`;
    return retryConflict(async () => {
      if (sydneyBudgetDay(clock()) !== day) fail('AI_BUDGET_DAY_CHANGED', 'The budget day changed. Please try again.');
      const approval = await approvalForDay(day, clock());
      if (!approval)
        fail('AI_BUDGET_UNAPPROVED', 'Today’s shared AI allowance has not been allocated.');
      if (await store.get(pk, requestKey))
        fail('AI_REQUEST_ALREADY_RESERVED', 'This model request has already been reserved and cannot be sent again.');
      const row = await store.get(pk, dayKey), value = ledgerValue(row);
      if (value.blocked) fail('AI_BUDGET_REVIEW_REQUIRED', 'The daily AI budget needs operator review.');
      if (value.spentMicros + value.reservedMicros + reservedMicros > Math.min(approval.value.approvedMicros, maxDailySpendMicros) ||
          value.calls + 1 > callLimit || value.tokens + value.reservedTokens + reservedTokens > tokenLimit)
        fail('AI_BUDGET_EXHAUSTED', 'The daily AI allowance is exhausted. Generation is paused.');
      const reservation = {
        day, requestKey, status: 'reserved', reservedMicros, reservedTokens,
        createdAt: date.toISOString(), ...metadata,
      };
      await store.transact([
        approval.row ? {pk, sk: envelopeKey, expected: approval.row.revision, checkOnly: true} : change(pk, envelopeKey, null, approval.value),
        ...(approval.policy ? [{pk, sk: 'POLICY', expected: approval.policy.revision, checkOnly: true}] : []),
        change(pk, dayKey, row, {...value, reservedMicros: value.reservedMicros + reservedMicros, reservedTokens: value.reservedTokens + reservedTokens, calls: value.calls + 1}),
        change(pk, requestKey, null, reservation),
      ]);
      return reservation;
    });
  }

  async function finish(reservation, usage, reason, reference) {
    if (!reservation || !/^REQUEST#[a-f0-9]{64}$/.test(reservation.requestKey ?? ''))
      fail('AI_REQUEST_INVALID', 'The model reservation is invalid.');
    return retryConflict(async () => {
      const row = await store.get(pk, reservation.requestKey);
      if (!row) fail('AI_REQUEST_INVALID', 'The model reservation is missing.');
      const value = row.value;
      if (['settled','released'].includes(value.status)) return value;
      const dayRow = await store.get(pk, `DAY#${value.day}`), ledger = ledgerValue(dayRow);
      if (ledger.reservedMicros < value.reservedMicros || ledger.reservedTokens < value.reservedTokens)
        fail('AI_BUDGET_INVALID', 'The model reservation requires operator review.');
      if (usage && (value.kind === 'external') !== Boolean(usage.external))
        fail('AI_USAGE_INVALID', 'Use the matching reconciliation method for this reservation.');
      if (usage?.external && (!integer(usage.actualMicros) || !auditReference(usage.reference)))
        fail('AI_USAGE_INVALID', 'External usage requires a non-negative charge and evidence reference.');
      if (reference !== undefined && !auditReference(reference))
        fail('AI_USAGE_INVALID', 'Use a non-empty evidence reference.');
      const actualMicros = usage ? usage.external ? usage.actualMicros : aiCostMicros(usage.inputTokens, usage.outputTokens) : 0;
      const actualTokens = usage && !usage.external ? usage.inputTokens + usage.outputTokens : 0;
      if (usage?.external && (value.quotedCnyFen !== undefined) !== (usage.actualCnyFen !== undefined))
        fail('AI_USAGE_INVALID', 'CNY-quoted usage requires the actual consumed-credit value in fen.');
      if (usage?.external && usage.actualCnyFen !== undefined && !integer(usage.actualCnyFen))
        fail('AI_USAGE_INVALID', 'The actual CNY credit value must be non-negative integer fen.');
      const cnyException = value.exceptionId ? oneTimeExceptionById(value.exceptionId) : null;
      if (value.exceptionId && !cnyException)
        fail('AI_EXCEPTION_INVALID', 'The reservation exception is not configured for reconciliation.');
      const cnyBoundExceeded = Boolean(usage?.external && value.quotedCnyFen !== undefined &&
        (usage.actualCnyFen > value.quotedCnyFen || cnyException && usage.actualCnyFen > cnyException.maxCnyFen));
      const exceedsBound = usage && (actualMicros > value.reservedMicros || cnyBoundExceeded ||
        !usage.external && (usage.inputTokens > value.inputTokenUpperBound || usage.outputTokens > value.maxOutputTokens));
      const next = {
        ...value, status: usage ? 'settled' : 'released', completedAt: clock().toISOString(), actualMicros,
        ...(usage ? usage.external ? {usageReference: usage.reference.trim(), ...(value.quotedCnyFen !== undefined ? {actualCnyFen: usage.actualCnyFen} : {})} : {inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, providerRequestId: safeReference(usage.providerRequestId)} : {reason: safeReference(reason), ...(reference ? {releaseReference: reference.trim()} : {})}),
        ...(exceedsBound ? {boundExceeded: true} : {}),
        ...(cnyBoundExceeded ? {cnyBoundExceeded: true} : {}),
      };
      await store.transact([
        change(pk, `DAY#${value.day}`, dayRow, {
          ...ledger, spentMicros: ledger.spentMicros + actualMicros,
          reservedMicros: ledger.reservedMicros - value.reservedMicros,
          reservedTokens: ledger.reservedTokens - value.reservedTokens,
          tokens: ledger.tokens + actualTokens,
          blocked: ledger.blocked || Boolean(exceedsBound),
        }),
        change(pk, row.sk, row, next),
      ]);
      return next;
    });
  }

  async function markUncertain(reservation, {reason = 'PROVIDER_OUTCOME_UNKNOWN'} = {}) {
    return retryConflict(async () => {
      const row = await store.get(pk, reservation.requestKey);
      if (!row || ['settled','released'].includes(row.value.status)) return row?.value;
      const next = {...row.value, status: 'uncertain', reason: safeReference(reason), uncertainAt: clock().toISOString()};
      await store.transact([change(pk, row.sk, row, next)]);
      return next;
    });
  }
  return {
    status, reserve, reserveExternal, externalReservationStatus, approveOneTimeExternal, oneTimeExternalStatus, reserveOneTimeExternal, markUncertain,
    reconcile: (reservation, usage) => finish(reservation, usage),
    settleExternal: (reservation, usage) => finish(reservation, {...usage, external: true}),
    release: (reservation, {reason, reference} = {}) => finish(reservation, null, reason, reference),
  };
}
