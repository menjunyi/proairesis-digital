import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const MUTABLE_SITE_CACHE_CONTROL =
  "no-store, max-age=0, must-revalidate";
export const IMMUTABLE_ASSET_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

const HASHED_ASSET_REFERENCE =
  /(?:src|href)=["'](\/assets\/[^"'?#]+-[A-Za-z0-9_-]{8,}\.[^"'?#]+)["']/;
const HASHED_ASSET_PATH =
  /^assets\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:(?:js|mjs|css)(?:\.map)?|svg|png|webp|avif|gif|jpe?g|woff2?|ttf|otf|wasm|ico)$/i;

function directives(value) {
  return new Set(
    String(value ?? "")
      .toLowerCase()
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function isMutableSiteCacheControl(value) {
  const values = directives(value);
  return values.has("no-store") && values.has("max-age=0");
}

export function isImmutableAssetCacheControl(value) {
  const values = directives(value);
  const maximumAge = [...values]
    .map((item) => /^max-age=(\d+)$/.exec(item)?.[1])
    .find(Boolean);
  return (
    values.has("public") &&
    values.has("immutable") &&
    Number(maximumAge) >= 31_536_000
  );
}

export function firstHashedAssetPath(indexHtml) {
  return HASHED_ASSET_REFERENCE.exec(String(indexHtml))?.[1] ?? "";
}

export function isRetainedHashedAssetPath(path) {
  return HASHED_ASSET_PATH.test(String(path));
}

async function fileKeys(root, prefix = "") {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const keys = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) keys.push(...await fileKeys(root, key));
    else if (entry.isFile()) keys.push(key);
    else throw new Error(`Unsupported published site entry: ${key}`);
  }
  return keys;
}

export async function verifyPublishedSiteFiles(source, published) {
  const expectedKeys = await fileKeys(resolve(source));
  const publishedKeys = await fileKeys(resolve(published));
  const expected = new Set(expectedKeys);
  for (const key of expectedKeys) {
    const [sourceBytes, publishedBytes] = await Promise.all([
      readFile(join(source, key)),
      readFile(join(published, key)),
    ]);
    if (!sourceBytes.equals(publishedBytes))
      throw new Error(`Published site file does not match the release: ${key}`);
  }
  const retainedAssets = publishedKeys.filter((key) => !expected.has(key));
  if (!retainedAssets.every(isRetainedHashedAssetPath))
    throw new Error("The published site contains an unexpected non-release file.");
  return { expectedFiles: expectedKeys.length, retainedAssets };
}

export function sitePublishCommands(site, bucket) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket ?? ""))
    throw new Error("The site bucket name is invalid.");
  const source = resolve(site);
  const target = `s3://${bucket}/`;
  return [
    [
      "s3",
      "cp",
      join(source, "assets"),
      `${target}assets/`,
      "--recursive",
      "--cache-control",
      IMMUTABLE_ASSET_CACHE_CONTROL,
      "--only-show-errors",
    ],
    [
      "s3",
      "cp",
      source,
      target,
      "--recursive",
      "--exclude",
      "assets/*",
      "--exclude",
      "index.html",
      "--exclude",
      "release.json",
      "--cache-control",
      MUTABLE_SITE_CACHE_CONTROL,
      "--only-show-errors",
    ],
    [
      "s3",
      "cp",
      join(source, "release.json"),
      `${target}release.json`,
      "--cache-control",
      MUTABLE_SITE_CACHE_CONTROL,
      "--only-show-errors",
    ],
    [
      "s3",
      "sync",
      source,
      target,
      "--delete",
      "--exclude",
      "assets/*",
      "--exclude",
      "index.html",
      "--exclude",
      "release.json",
      "--size-only",
      "--only-show-errors",
    ],
    [
      "s3",
      "cp",
      join(source, "index.html"),
      `${target}index.html`,
      "--cache-control",
      MUTABLE_SITE_CACHE_CONTROL,
      "--only-show-errors",
    ],
  ];
}

export function publishSiteWithCachePolicy(run, site, bucket) {
  for (const args of sitePublishCommands(site, bucket))
    run(args, { timeout: 600_000 });
}
