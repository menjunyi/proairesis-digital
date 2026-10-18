import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const STATEFUL_LOGICAL_RESOURCE_IDS = Object.freeze([
  'Table',
  'UserPool',
  'SiteBucket',
  'ResumeBucket',
  'GenerationQueue',
  'RecommendationQueue',
  'FailedWork',
  'ApiOriginSecret',
]);

const statefulIds = new Set(STATEFUL_LOGICAL_RESOURCE_IDS);

export function unsafeStatefulChanges(changes = []) {
  return changes.filter(change => {
    if (!statefulIds.has(change.logicalResourceId)) return false;
    if (change.action === 'Remove') return true;
    return change.action === 'Modify' && change.replacement !== 'False';
  });
}

export function requireSafeStatefulChanges(changes = []) {
  const unsafe = unsafeStatefulChanges(changes);
  if (!unsafe.length) return;
  const details = unsafe
    .map(change => `${change.logicalResourceId}:${change.action}:${change.replacement ?? 'unknown'}`)
    .join(', ');
  throw new Error(`Refusing a change set that removes or may replace retained production state: ${details}`);
}

export async function hashDirectory(directory, { exclude = [] } = {}) {
  const excluded = new Set(exclude);
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current)) {
      const absolute = join(current, entry);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new Error(`Release content must not contain symbolic links: ${entry}`);
      if (metadata.isDirectory()) await walk(absolute);
      else if (metadata.isFile()) {
        const name = relative(directory, absolute).split(sep).join('/');
        if (!excluded.has(name)) files.push({ absolute, name });
      } else throw new Error(`Release content contains an unsupported entry: ${entry}`);
    }
  }
  await walk(directory);
  files.sort((left, right) => left.name.localeCompare(right.name));
  const hash = createHash('sha256');
  for (const file of files) {
    const bytes = await readFile(file.absolute);
    hash.update(file.name, 'utf8');
    hash.update('\0');
    hash.update(String(bytes.length), 'utf8');
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function protectedReleaseVersion(description, releaseId) {
  if (typeof releaseId !== 'string' || !/^[a-f0-9]{64}$/.test(releaseId)) return false;
  const match = String(description ?? '').match(new RegExp(
    `^RoleClue release ${releaseId} origin-gate-true site-v-([A-Za-z0-9_-]+) site-sha-([a-f0-9]{64})$`,
  ));
  if (!match) return null;
  let siteVersion;
  try { siteVersion = Buffer.from(match[1], 'base64url').toString('utf8'); } catch { return null; }
  if (!siteVersion || Buffer.from(siteVersion).toString('base64url') !== match[1]) return null;
  return { siteVersion, siteSha256: match[2] };
}

export function isProtectedReleaseVersion(description, releaseId) {
  return Boolean(protectedReleaseVersion(description, releaseId));
}
