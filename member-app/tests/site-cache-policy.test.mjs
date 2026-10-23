import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  firstHashedAssetPath,
  IMMUTABLE_ASSET_CACHE_CONTROL,
  isImmutableAssetCacheControl,
  isMutableSiteCacheControl,
  isRetainedHashedAssetPath,
  MUTABLE_SITE_CACHE_CONTROL,
  publishSiteWithCachePolicy,
  sitePublishCommands,
  verifyPublishedSiteFiles,
} from "../scripts/site-cache-policy.mjs";

test("mutable release files cannot remain in a browser cache", () => {
  assert.equal(isMutableSiteCacheControl(MUTABLE_SITE_CACHE_CONTROL), true);
  assert.equal(isMutableSiteCacheControl("max-age=0, NO-STORE"), true);
  assert.equal(isMutableSiteCacheControl("no-cache, max-age=0"), false);
  assert.equal(isMutableSiteCacheControl("public, max-age=3600"), false);
});

test("content-hashed assets require a one-year immutable browser policy", () => {
  assert.equal(
    isImmutableAssetCacheControl(IMMUTABLE_ASSET_CACHE_CONTROL),
    true,
  );
  assert.equal(
    isImmutableAssetCacheControl("immutable, max-age=31536000, PUBLIC"),
    true,
  );
  assert.equal(
    isImmutableAssetCacheControl("public, max-age=31535999, immutable"),
    false,
  );
  assert.equal(
    isImmutableAssetCacheControl("public, max-age=31536000"),
    false,
  );
});

test("the release gate resolves only a content-hashed asset from the entry point", () => {
  const html = [
    '<link rel="icon" href="/favicon.svg">',
    '<script type="module" src="/assets/index-CFxhzibM.js"></script>',
  ].join("");
  assert.equal(firstHashedAssetPath(html), "/assets/index-CFxhzibM.js");
  assert.equal(
    firstHashedAssetPath('<script src="/assets/index.js"></script>'),
    "",
  );
  assert.equal(isRetainedHashedAssetPath("assets/index-CFxhzibM.js"), true);
  assert.equal(isRetainedHashedAssetPath("assets/chunk-CFxhzibM.js.map"), true);
  assert.equal(isRetainedHashedAssetPath("assets/index.js"), false);
  assert.equal(isRetainedHashedAssetPath("assets/page-CFxhzibM.html"), false);
  assert.equal(isRetainedHashedAssetPath("old-index-CFxhzibM.js"), false);
});

test("site publishing assigns cache policies and cleans only mutable files", () => {
  const source = resolve("/private/tmp/roleclue-site-cache-test");
  const bucket = "roleclue-site-example";
  const commands = sitePublishCommands(source, bucket);
  assert.deepEqual(commands, [
    [
      "s3",
      "cp",
      resolve(source, "assets"),
      `s3://${bucket}/assets/`,
      "--recursive",
      "--cache-control",
      IMMUTABLE_ASSET_CACHE_CONTROL,
      "--only-show-errors",
    ],
    [
      "s3",
      "cp",
      source,
      `s3://${bucket}/`,
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
      resolve(source, "release.json"),
      `s3://${bucket}/release.json`,
      "--cache-control",
      MUTABLE_SITE_CACHE_CONTROL,
      "--only-show-errors",
    ],
    [
      "s3",
      "sync",
      source,
      `s3://${bucket}/`,
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
      resolve(source, "index.html"),
      `s3://${bucket}/index.html`,
      "--cache-control",
      MUTABLE_SITE_CACHE_CONTROL,
      "--only-show-errors",
    ],
  ]);
  assert.equal(commands.at(-3)[3], `s3://${bucket}/release.json`);
  assert.deepEqual(
    commands.at(-2).filter((argument) => argument === "index.html" || argument === "release.json"),
    ["index.html", "release.json"],
  );
  assert.equal(commands.at(-1)[3], `s3://${bucket}/index.html`);
  const calls = [];
  publishSiteWithCachePolicy((args, options) => calls.push({ args, options }), source, bucket);
  assert.deepEqual(
    calls,
    commands.map((args) => ({ args, options: { timeout: 600_000 } })),
  );
  assert.throws(
    () => sitePublishCommands(source, "INVALID BUCKET"),
    /bucket name is invalid/,
  );
});

test("deployment verification keeps an old hashed asset but rejects other stale files", async () => {
  const root = await mkdtemp(join(tmpdir(), "roleclue-site-cache-policy-"));
  const source = join(root, "source");
  const published = join(root, "published");
  try {
    await mkdir(join(source, "assets"), { recursive: true });
    await mkdir(join(published, "assets"), { recursive: true });
    await writeFile(join(source, "index.html"), "current");
    await writeFile(join(source, "release.json"), "current-release");
    await writeFile(join(source, "assets", "index-ABCDEFGH.js"), "current-js");
    await writeFile(join(published, "index.html"), "current");
    await writeFile(join(published, "release.json"), "current-release");
    await writeFile(join(published, "assets", "index-ABCDEFGH.js"), "current-js");
    await writeFile(join(published, "assets", "index-OLDHASH1.js"), "old-js");
    assert.deepEqual(await verifyPublishedSiteFiles(source, published), {
      expectedFiles: 3,
      retainedAssets: ["assets/index-OLDHASH1.js"],
    });

    await writeFile(join(published, "obsolete.html"), "stale-root");
    await assert.rejects(
      verifyPublishedSiteFiles(source, published),
      /unexpected non-release file/,
    );
    await rm(join(published, "obsolete.html"));
    await writeFile(join(published, "index.html"), "wrong");
    await assert.rejects(
      verifyPublishedSiteFiles(source, published),
      /does not match the release/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
