import {createHash, createHmac, randomBytes} from 'node:crypto';

export const GUEST_TTL_SECONDS = 24 * 60 * 60;
export const GUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newGuestToken() {
  return randomBytes(32).toString('base64url');
}

export function guestPartition(token) {
  if (typeof token !== 'string' || !GUEST_TOKEN_PATTERN.test(token)) return null;
  return `GUEST#${createHash('sha256').update(token).digest('hex')}`;
}

export function guestTokenHash(token) {
  const pk = guestPartition(token);
  return pk?.slice(6) ?? null;
}

export function sourceIpHash(secret, sourceIp) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof sourceIp !== 'string' || !sourceIp || sourceIp.length > 100) return null;
  return createHmac('sha256', secret).update(`roleclue-guest-ip-v1\0${sourceIp}`).digest('hex');
}

export function guestExpiry(now = Date.now()) {
  return {
    expiresAt: new Date(now + GUEST_TTL_SECONDS * 1000).toISOString(),
    ttl: Math.floor(now / 1000) + GUEST_TTL_SECONDS,
  };
}

export function publicGuest(session) {
  return {
    stage: session.stage,
    situation: session.situation,
    location: session.location,
    remote: session.remote,
    suggestions: session.suggestions ?? null,
    resumeWarnings: session.resumeWarnings ?? [],
    ignoredJobIds: session.ignoredJobIds ?? [],
    selectedJobId: session.selectedJobId ?? null,
    search: session.search ?? null,
    claimedApplicationId: session.claimedApplicationId ?? null,
  };
}

export const GUEST_RATE_LIMITS = Object.freeze({
  start: {guest: null, ip: 10},
  session: {guest: 120, ip: 300},
  resume: {guest: 3, ip: 12},
  profile: {guest: 20, ip: 60},
  search: {guest: 6, ip: 30},
  ignore: {guest: 60, ip: 180},
  claim: {guest: 10, ip: 30},
  abandon: {guest: 10, ip: 30},
});
