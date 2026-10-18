import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyLiveRelease } from "../scripts/smoke-evidence.mjs";

const releaseId = "a".repeat(64);
const sourceRevision = "b".repeat(40);
const lambdaSha256 = "c".repeat(64);
const functionName = "roleclue-member-app";
const functionVersion = "23";
const functionAliasArn =
  `arn:aws:lambda:ap-southeast-2:037169690315:function:${functionName}:live`;

function fixture(overrides = {}) {
  const manifest = {
    version: 3,
    releaseId,
    sourceRevision,
    createdAt: "2026-10-18T00:00:00.000Z",
    mode: "production",
    lambdaSha256,
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
    Description: `RoleClue release ${releaseId} origin-gate-true site-v-1 site-sha-${"d".repeat(64)}`,
    ...overrides.configuration,
  };
  const calls = [];
  return {
    calls,
    outputs: {
      FunctionName: functionName,
      FunctionVersion: functionVersion,
      FunctionAliasArn: functionAliasArn,
      ...overrides.outputs,
    },
    fetchImpl: async () =>
      new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "x-amz-cf-id": "synthetic-cloudfront-request" },
      }),
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
    }),
    /Live alias does not point/,
  );
  const wrongCode = fixture({ configuration: { CodeSha256: Buffer.alloc(32).toString("base64") } });
  await assert.rejects(
    verifyLiveRelease({
      ...wrongCode,
      siteUrl: "https://app.proairesis.digital",
      check,
    }),
    /Live Lambda code does not match/,
  );
});

test("release smokes keep separate evidence and cloud acceptance gates", () => {
  const cloud = readFileSync(new URL("../scripts/smoke-cloud.mjs", import.meta.url), "utf8");
  const browser = readFileSync(new URL("../scripts/smoke-browser.mjs", import.meta.url), "utf8");
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
});
