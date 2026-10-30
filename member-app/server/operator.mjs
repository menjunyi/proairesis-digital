import {createHash} from 'node:crypto';
import {change, retryConflict} from './store.mjs';

const MINIMUM_AGE_MS = 120000;
const accountHash = sub => createHash('sha256').update(sub).digest('hex');
const hash = text => createHash('sha256').update(text).digest('hex');

export class OperatorError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function validateTarget(userSub, generationId) {
  if (typeof userSub !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(userSub)) {
    throw new OperatorError('INVALID_TARGET', 'A valid user subject is required.');
  }
  if (typeof generationId !== 'string' || !/^[a-f0-9]{64}$/.test(generationId)) {
    throw new OperatorError('INVALID_TARGET', 'A valid generation ID is required.');
  }
}

function safeMetadata(row, userSub, now) {
  const g = row.value;
  const timestamps = [g.createdAt, g.dispatchAttemptedAt, g.lease, g.providerStartedAt, g.pendingSince]
    .filter(Boolean).map(Date.parse);
  const latestActivity = timestamps.length && timestamps.every(Number.isFinite)
    ? Math.max(...timestamps) : NaN;
  const ageMs = Number.isFinite(latestActivity) ? Math.max(0, now - latestActivity) : null;
  return {
    accountHash: accountHash(userSub),
    generationId: g.id,
    status: g.status,
    createdAt: g.createdAt,
    lastWorkerActivityAt: Number.isFinite(latestActivity)
      ? new Date(latestActivity).toISOString() : null,
    ageSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
    minimumAgeSeconds: MINIMUM_AGE_MS / 1000,
    bucket: g.bucket,
    periodKey: g.periodKey,
    pendingReason: g.pendingReason ?? null,
    canReconcile: g.status === 'pending' && ageMs !== null && ageMs >= MINIMUM_AGE_MS,
    reconciledAt: g.operatorReconciledAt ?? null,
  };
}

export async function inspectGeneration({store, userSub, generationId, now = Date.now()}) {
  validateTarget(userSub, generationId);
  const row = await store.get(`USER#${userSub}`, `GEN#${generationId}`);
  if (!row) throw new OperatorError('NOT_FOUND', 'Generation not found.');
  return safeMetadata(row, userSub, now);
}

/** This function is intentionally not registered in the public HTTP handler. */
export async function reconcileGeneration({
  store, userSub, generationId, apply = false, resolution,
  evidenceReference, operatorReference, letterText, now = Date.now(),
}) {
  validateTarget(userSub, generationId);
  if (!apply) {
    return {
      dryRun: true,
      generation: await inspectGeneration({store, userSub, generationId, now}),
      proposedResolution: resolution ?? null,
      evidenceReferenceProvided: Boolean(evidenceReference?.trim()),
      recoveredLetterProvided: typeof letterText === 'string' && letterText.trim().length > 0,
    };
  }
  if (!['failed', 'succeeded'].includes(resolution)) {
    throw new OperatorError('INVALID_RESOLUTION', 'Choose failed or succeeded.');
  }
  for (const [label, value] of [['evidence', evidenceReference], ['operator', operatorReference]]) {
    if (typeof value !== 'string' || !value.trim() || value.length > 1000 || /[\r\n\u0000]/.test(value)) {
      throw new OperatorError('REFERENCE_REQUIRED', `A non-empty, single-line ${label} reference is required.`);
    }
  }
  const text = resolution === 'succeeded' && typeof letterText === 'string' ? letterText.trim() : null;
  if (resolution === 'succeeded' && (!text || text.length < 100 || text.length > 16000)) {
    throw new OperatorError('LETTER_REQUIRED', 'Recovery requires an existing provider letter of 100–16,000 characters.');
  }
  if (resolution === 'failed' && letterText) {
    throw new OperatorError('INVALID_RESOLUTION', 'Do not supply a letter when marking the request failed.');
  }

  const pk = `USER#${userSub}`, sk = `GEN#${generationId}`;
  return retryConflict(async () => {
    const row = await store.get(pk, sk);
    if (!row) throw new OperatorError('NOT_FOUND', 'Generation not found.');
    const g = row.value;
    const metadata = safeMetadata(row, userSub, now);
    if (g.status !== 'pending') {
      return {dryRun: false, changed: false, alreadyFinalized: true, generation: metadata};
    }
    if (!metadata.canReconcile) {
      throw new OperatorError('TOO_RECENT', 'Wait at least 120 seconds after the latest worker activity.');
    }
    if (await store.get(pk, 'DELETING') || await store.get('ACCOUNT#deleted', accountHash(userSub))) {
      throw new OperatorError('ACCOUNT_DELETED', 'This account is being deleted or has been deleted.');
    }
    const entitlementRow = await store.get(pk, 'ENTITLEMENT');
    if (!entitlementRow || !['free', 'starter', 'paid'].includes(g.bucket)) {
      throw new OperatorError('LEDGER_INVALID', 'The reservation ledger requires manual investigation.');
    }
    const e = entitlementRow.value;
    const bucket = e[g.bucket];
    if (!bucket || !Number.isInteger(bucket.used) || bucket.used < 0
      || !Number.isInteger(bucket.reserved) || bucket.reserved < 0) {
      throw new OperatorError('LEDGER_INVALID', 'The allowance ledger requires manual investigation.');
    }
    const matchesCurrentPeriod = g.bucket === 'free' || bucket?.key === g.periodKey;
    if (matchesCurrentPeriod && (!Number.isInteger(bucket?.reserved) || bucket.reserved < 1)) {
      throw new OperatorError('LEDGER_INVALID', 'No matching reservation exists; do not invent or reset credits.');
    }
    const limit = g.bucket === 'free' ? 1 : g.bucket === 'starter' ? 2 : 50;
    const accessRevoked = g.bucket === 'starter' && ['refunded', 'disputed'].includes(bucket.status)
      || g.bucket === 'paid' && ['refunded', 'disputed'].includes(e.status);
    if (matchesCurrentPeriod && resolution === 'succeeded' && accessRevoked) {
      throw new OperatorError('LEDGER_INVALID', 'The paid allowance was revoked; recover this request only as failed.');
    }
    if (matchesCurrentPeriod && resolution === 'succeeded' && bucket.used >= limit) {
      throw new OperatorError('LEDGER_INVALID', 'The allowance is already consumed; investigate before recovering another letter.');
    }
    if (matchesCurrentPeriod) {
      bucket.reserved -= 1;
      if (resolution === 'succeeded') bucket.used += 1;
    }
    const letterRow = await store.get(pk, `LETTER#${g.appId}#${generationId}`);
    if (letterRow) {
      throw new OperatorError('LETTER_ALREADY_STORED', 'A stored letter already exists; investigate the inconsistent pending record.');
    }
    if (resolution === 'succeeded' && !(await store.get(pk, `APP#${g.appId}`))) {
      throw new OperatorError('APPLICATION_MISSING', 'The application is missing; a recovered letter cannot be attached safely.');
    }
    const timestamp = new Date(now).toISOString();
    const {
      profileSnapshot: _profileSnapshot,
      jobSnapshot: _jobSnapshot,
      lease: _lease,
      leaseId: _leaseId,
      leaseExpiresAt: _leaseExpiresAt,
      dispatchAttemptId: _dispatchAttemptId,
      dispatchAttemptedAt: _dispatchAttemptedAt,
      dispatchLeaseUntil: _dispatchLeaseUntil,
      dispatchAttempts: _dispatchAttempts,
      dispatchedAt: _dispatchedAt,
      providerStartedAt: _providerStartedAt,
      ...safeGeneration
    } = g;
    const letter = text ? {id: generationId, text, createdAt: timestamp, editedAt: null} : null;
    const updated = {
      ...safeGeneration,
      ...(g.analyticsContext ? { analyticsContext: g.analyticsContext, analyticsPending: true } : {}),
      status: resolution,
      completedAt: timestamp,
      operatorReconciledAt: timestamp,
      pendingReason: null,
      ...(letter ? {letter} : {error: 'This request was resolved as failed. Its applicable reservation was released.'}),
    };
    const auditKey = `${accountHash(userSub)}#${generationId}`;
    const changes = [
      change(pk, sk, row, updated),
      change(pk, 'ENTITLEMENT', entitlementRow, e),
      change('OPERATOR#reconciliation', auditKey, null, {
        generationId,
        accountHash: accountHash(userSub),
        resolution,
        evidenceReference: evidenceReference.trim(),
        operatorReference: operatorReference.trim(),
        resolvedAt: timestamp,
        originalBucket: g.bucket,
        originalPeriodKey: g.periodKey,
        currentPeriodAdjusted: matchesCurrentPeriod,
        letterSha256: text ? hash(text) : null,
      }),
      {pk, sk: 'DELETING', expected: 0, checkOnly: true},
      {pk: 'ACCOUNT#deleted', sk: accountHash(userSub), expected: 0, checkOnly: true},
    ];
    if (letter) changes.push(change(pk, `LETTER#${g.appId}#${generationId}`, null, letter));
    await store.transact(changes);
    return {
      dryRun: false,
      changed: true,
      generation: safeMetadata({value: updated}, userSub, now),
      currentPeriodAdjusted: matchesCurrentPeriod,
      letterSha256: text ? hash(text) : null,
    };
  });
}
