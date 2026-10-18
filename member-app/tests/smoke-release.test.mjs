import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalReleaseId, verifyLiveRelease } from "../scripts/smoke-evidence.mjs";
import { awsCliOption } from "../scripts/smoke-signup.mjs";

const sourceRevision = "b".repeat(40);
const lambdaSha256 = "c".repeat(64);
const siteContentSha256 = "d".repeat(64);
const templateSha256 = "e".repeat(64);
const siteArtifactSha256 = "f".repeat(64);
const siteArtifactVersion = "synthetic-site-version";
const siteArtifactVersionToken = Buffer.from(siteArtifactVersion, "utf8").toString("base64url");
const indexBytes = Buffer.from("<!doctype html><title>RoleClue</title>");
const indexSha256 = createHash("sha256").update(indexBytes).digest("hex");
const releaseId = canonicalReleaseId({ sourceRevision, lambdaSha256, siteContentSha256, templateSha256 });
const functionName = "roleclue-member-app";
const functionVersion = "23";
const functionAliasArn =
  `arn:aws:lambda:ap-southeast-2:037169690315:function:${functionName}:live`;

test("signup smoke maps release-verification inputs to valid AWS CLI options", () => {
  assert.equal(awsCliOption("FunctionName"), "--function-name");
  assert.equal(awsCliOption("Qualifier"), "--qualifier");
  assert.equal(awsCliOption("StackName"), "--stack-name");
  assert.doesNotMatch(awsCliOption("FunctionName"), /^---/);
});

function fixture(overrides = {}) {
  const manifest = {
    version: 3,
    releaseId,
    sourceRevision,
    createdAt: "2026-10-18T00:00:00.000Z",
    mode: "production",
    lambdaSha256,
    indexSha256,
    siteContentSha256,
    templateSha256,
    ...overrides.manifest,
  };
  const alias = {
    Name: "live",
    AliasArn: functionAliasArn,
    FunctionVersion: functionVersion,
    Description: `RoleClue production ${releaseId}`,
    ...overrides.alias,
  };
  const configuration = {
    Version: functionVersion,
    CodeSha256: Buffer.from(lambdaSha256, "hex").toString("base64"),
    Description: `RoleClue release ${releaseId} origin-gate-true site-v-${siteArtifactVersionToken} site-sha-${siteArtifactSha256}`,
    ...overrides.configuration,
  };
  const calls = [];
  return {
    calls,
    outputs: {
      FunctionName: functionName,
      FunctionVersion: functionVersion,
      FunctionAliasArn: functionAliasArn,
      SiteArtifactVersion: siteArtifactVersion,
      SiteArtifactSha256: siteArtifactSha256,
      ...overrides.outputs,
    },
    fetchImpl: async (url) => {
      const body = String(url).endsWith("/release.json")
        ? JSON.stringify(manifest)
        : overrides.indexBytes ?? indexBytes;
      return new Response(body, {
          status: 200,
          headers: { "x-amz-cf-id": "synthetic-cloudfront-request" },
        });
    },
    aws: async (service, operation, input) => {
      calls.push({ service, operation, input });
      if (operation === "get-alias") return alias;
      if (operation === "get-function-configuration") return configuration;
      throw new Error("Unexpected AWS operation");
    },
  };
}

const check = (condition, label) => {
  if (!condition) throw new Error(label);
};

test("live release verification resolves the alias and matches the deployed artifact", async () => {
  const context = fixture();
  const result = await verifyLiveRelease({
    ...context,
    siteUrl: "https://app.proairesis.digital",
    check,
    expectedReleaseId: releaseId,
    expectedSourceRevision: sourceRevision,
  });
  assert.equal(result.manifest.sourceRevision, sourceRevision);
  assert.deepEqual(context.calls, [
    {
      service: "lambda",
      operation: "get-alias",
      input: { FunctionName: functionName, Name: "live" },
    },
    {
      service: "lambda",
      operation: "get-function-configuration",
      input: { FunctionName: functionName, Qualifier: "live" },
    },
  ]);
});

test("live release verification rejects invalid source provenance", async () => {
  const context = fixture({ manifest: { sourceRevision: "not-a-commit" } });
  await assert.rejects(
    verifyLiveRelease({
      ...context,
      siteUrl: "https://app.proairesis.digital",
      check,
      expectedReleaseId: releaseId,
    }),
    /source revision is invalid/,
  );
});

test("live release verification rejects an alias or code hash mismatch", async () => {
  const wrongAlias = fixture({ alias: { FunctionVersion: "24" } });
  await assert.rejects(
    verifyLiveRelease({
      ...wrongAlias,
      siteUrl: "https://app.proairesis.digital",
      check,
      expectedReleaseId: releaseId,
    }),
    /Live alias does not point/,
  );
  const wrongCode = fixture({ configuration: { CodeSha256: Buffer.alloc(32).toString("base64") } });
  await assert.rejects(
    verifyLiveRelease({
      ...wrongCode,
      siteUrl: "https://app.proairesis.digital",
      check,
      expectedReleaseId: releaseId,
    }),
    /Live Lambda code does not match/,
  );
});

test("live release verification rejects every mismatched provenance binding", async () => {
  const cases = [
    {
      context: fixture({ manifest: { releaseId: "0".repeat(64) } }),
      options: { expectedReleaseId: releaseId },
      message: /canonical manifest digest/,
    },
    {
      context: fixture(),
      options: { expectedReleaseId: "0".repeat(64) },
      message: /stack release parameter/,
    },
    {
      context: fixture(),
      options: { expectedReleaseId: releaseId, expectedSourceRevision: "0".repeat(40) },
      message: /expected revision/,
    },
    {
      context: fixture({ indexBytes: Buffer.from("wrong index") }),
      options: { expectedReleaseId: releaseId },
      message: /entry point does not match/,
    },
    {
      context: fixture({ outputs: { SiteArtifactVersion: "wrong-version" } }),
      options: { expectedReleaseId: releaseId },
      message: /protected release described by the manifest/,
    },
    {
      context: fixture({ outputs: { SiteArtifactSha256: "1".repeat(64) } }),
      options: { expectedReleaseId: releaseId },
      message: /protected release described by the manifest/,
    },
    {
      context: fixture({ configuration: {
        Description: `RoleClue release ${releaseId} origin-gate-true site-v-${siteArtifactVersionToken} site-sha-${siteArtifactSha256} extra`,
      } }),
      options: { expectedReleaseId: releaseId },
      message: /protected release described by the manifest/,
    },
  ];
  for (const { context, options, message } of cases) {
    await assert.rejects(verifyLiveRelease({
      ...context,
      siteUrl: "https://app.proairesis.digital",
      check,
      ...options,
    }), message);
  }
});

test("release smokes keep separate evidence and cloud acceptance gates", () => {
  const cloud = readFileSync(new URL("../scripts/smoke-cloud.mjs", import.meta.url), "utf8");
  const browser = readFileSync(new URL("../scripts/smoke-browser.mjs", import.meta.url), "utf8");
  const signup = readFileSync(new URL("../scripts/smoke-signup.mjs", import.meta.url), "utf8");
  const load = readFileSync(new URL("../scripts/smoke-load.mjs", import.meta.url), "utf8");
  assert.match(cloud, /list-event-source-mappings/);
  assert.match(cloud, /scheduler','get-schedule/);
  assert.match(cloud, /cloudwatch','describe-alarms/);
  assert.match(cloud, /logs','describe-metric-filters/);
  assert.match(cloud, /sqs','get-queue-attributes/);
  assert.match(cloud, /jobs\.opportunities\.length >= 1/);
  assert.match(cloud, /jobs\.feed\?\.status === 'ready'/);
  assert.match(cloud, /writeSmokeEvidence\('cloud-smoke'/);
  assert.match(browser, /resolve\("build\/evidence"\)/);
  assert.match(browser, /writeSmokeEvidence\("browser-smoke"/);
  assert.match(browser, /verifyLiveRelease/);
  assert.match(signup, /writeSmokeEvidence\('signup-smoke'/);
  assert.match(signup, /verifyLiveRelease/);
  assert.doesNotMatch(signup, /mailbox:email/);
  assert.match(load, /verifyLiveRelease/);
  assert.match(load, /ROLECLUE_EXPECTED_SOURCE_REVISION/);
  assert.match(load, /runRepresentativeLoad/);
  assert.match(load, /ACCOUNT_PATH = "\/api\/me"/);
  assert.match(load, /APPLICATIONS_PATH = "\/api\/applications"/);
  assert.match(load, /describe-alarm-history/);
  assert.match(load, /postLoadAlarmCheckAt/);
  assert.match(load, /writeSmokeEvidence\("load-smoke"/);
  assert.match(load, /combined errors plus HTTP 429 remained below 1%/);
});
