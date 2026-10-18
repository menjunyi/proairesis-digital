import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

// One incident, five exact synthetic rows. Default is read-only. Review before:
// node scripts/cleanup-smoke-orphans.mjs --apply
// No target overrides, scans, Cognito writes, S3 writes or tombstone deletion.
const ACCOUNT = "037169690315";
const REGION = "ap-southeast-2";
const STACK = "roleclue-member-app";
const TABLE = "roleclue-member-app-Table-D5G6DQC7OBM0";
const POOL = "ap-southeast-2_ufjYdI2VS";
const BUCKET = "roleclue-member-app-resumebucket-ytqtfcwg4ldv";
const TARGETS = [
  {
    sub: "f9ae5428-f0e1-70db-6fcd-3a798255594b",
    email:
      "roleclue-smoke-6a1b7db4-3b55-418b-85c3-63274f34ed1e@invalid.example",
    name: "RoleClue Synthetic One",
    keys: ["DELETING", "PROFILE", "UPLOAD_RATE#2026-10-11"],
  },
  {
    sub: "791e6418-00f1-70d7-aa91-6d7a7f1e9db1",
    email:
      "roleclue-smoke-9f7e6b0f-c033-4a70-b186-4f1431549c5e@invalid.example",
    name: "RoleClue Synthetic Two",
    keys: ["DELETING", "PROFILE"],
  },
];
class CleanupError extends Error {}
const check = (condition, message) => {
  if (!condition) throw new CleanupError(message);
};
const report = (checkName, result = "passed") =>
  console.log(JSON.stringify({ check: checkName, result }));
const hash = (sub) => createHash("sha256").update(sub).digest("hex");

function readAws(profile, service, operation, input = {}) {
  check(
    new Set([
      "sts:get-caller-identity",
      "cloudformation:describe-stacks",
      "cloudformation:describe-stack-resources",
    ]).has(`${service}:${operation}`),
    "CLI operation is not an approved read",
  );
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      "aws",
      [
        service,
        operation,
        "--profile",
        profile,
        "--region",
        REGION,
        "--no-cli-pager",
        "--output",
        "json",
        "--cli-connect-timeout",
        "10",
        "--cli-read-timeout",
        "30",
        "--cli-input-json",
        JSON.stringify(input),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, AWS_MAX_ATTEMPTS: "2" },
      },
    );
    let stdout = "",
      settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolveResult(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new CleanupError("AWS read timed out"));
    }, 45_000);
    child.on("error", () =>
      finish(new CleanupError("AWS CLI could not start")),
    );
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 2 * 1024 * 1024) {
        child.kill("SIGTERM");
        finish(new CleanupError("AWS read exceeded its response limit"));
      }
    });
    child.stderr.on("data", () => {});
    child.on("close", (code) => {
      if (code !== 0) return finish(new CleanupError("AWS read failed"));
      try {
        finish(null, JSON.parse(stdout));
      } catch {
        finish(new CleanupError("AWS read returned invalid JSON"));
      }
    });
  });
}

async function send(client, command) {
  let timer;
  try {
    return await Promise.race([
      client.send(command, { abortSignal: AbortSignal.timeout(45_000) }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new CleanupError("AWS request timed out")),
          45_000,
        );
      }),
    ]);
  } catch (cause) {
    const error = new CleanupError(
      "AWS request failed; no raw response was logged",
    );
    if (cause?.name === "UserNotFoundException")
      error.code = "UserNotFoundException";
    if (cause?.name === "TransactionCanceledException")
      error.code = "TransactionCanceledException";
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function validateOrphanRows(sub, rows) {
  const target = TARGETS.find((item) => item.sub === sub);
  check(target, "Partition is not one of the two approved synthetic targets");
  check(
    Array.isArray(rows) && rows.length === target.keys.length,
    "Unexpected synthetic partition row count",
  );
  check(
    new Set(rows.map((row) => row.sk)).size === target.keys.length,
    "Duplicate synthetic row keys",
  );
  for (const row of rows) {
    check(
      row.pk === `USER#${target.sub}` && target.keys.includes(row.sk),
      "Unexpected row outside approved synthetic keys",
    );
    check(
      Number.isSafeInteger(row.revision) && row.revision > 0,
      "Synthetic row revision is invalid",
    );
  }
  const profile = rows.find((row) => row.sk === "PROFILE");
  check(
    profile?.value?.email === target.email &&
      profile.value.name === target.name,
    "Profile identity does not match the exact synthetic fixture",
  );
  check(
    typeof rows.find((row) => row.sk === "DELETING")?.value?.startedAt ===
      "string",
    "Expected interrupted-deletion marker is absent",
  );
  return rows;
}

export async function cleanupSmokeOrphans(
  argv = process.argv.slice(2),
  env = process.env,
) {
  check(
    argv.length === 0 ||
      (argv.length === 1 && ["--apply", "--help"].includes(argv[0])),
    "Only --apply or --help is accepted; default mode is read-only",
  );
  if (argv[0] === "--help") {
    console.log(
      "Default: verify the two fixed synthetic targets without writes. --apply: conditionally delete exactly five approved DynamoDB rows, retaining deletion hashes.",
    );
    return;
  }
  check(
    !env.AWS_REGION || env.AWS_REGION === REGION,
    "Cleanup is restricted to ap-southeast-2",
  );
  const apply = argv[0] === "--apply";
  const profile = env.AWS_PROFILE || "proairesis-management";
  const caller = await readAws(profile, "sts", "get-caller-identity");
  check(
    caller.Account === ACCOUNT,
    "Company AWS account mismatch; no changes made",
  );
  const stack = (
    await readAws(profile, "cloudformation", "describe-stacks", {
      StackName: STACK,
    })
  ).Stacks?.[0];
  check(
    stack?.StackId?.startsWith(
      `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${STACK}/`,
    ),
    "Exact stack account/region mismatch",
  );
  check(
    ["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.StackStatus),
    "Wait until the exact stack is complete",
  );
  const outputs = Object.fromEntries(
    (stack.Outputs ?? []).map((item) => [item.OutputKey, item.OutputValue]),
  );
  check(
    outputs.TableName === TABLE &&
      outputs.CognitoUserPoolId === POOL &&
      outputs.ResumeBucket === BUCKET,
    "Exact stack resource outputs mismatch",
  );
  const resources = (
    await readAws(profile, "cloudformation", "describe-stack-resources", {
      StackName: STACK,
    })
  ).StackResources;
  for (const [logical, physical, type] of [
    ["Table", TABLE, "AWS::DynamoDB::Table"],
    ["UserPool", POOL, "AWS::Cognito::UserPool"],
    ["ResumeBucket", BUCKET, "AWS::S3::Bucket"],
  ]) {
    check(
      resources?.some(
        (item) =>
          item.LogicalResourceId === logical &&
          item.PhysicalResourceId === physical &&
          item.ResourceType === type &&
          item.StackId === stack.StackId,
      ),
      "Exact stack resource membership mismatch",
    );
  }
  const options = { region: REGION, profile, maxAttempts: 2 };
  const cognito = new CognitoIdentityProviderClient(options);
  const s3 = new S3Client(options);
  const baseDynamo = new DynamoDBClient(options);
  const dynamo = DynamoDBDocumentClient.from(baseDynamo);
  const query = async (target) => {
    const result = await send(
      dynamo,
      new QueryCommand({
        TableName: TABLE,
        ConsistentRead: true,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": `USER#${target.sub}` },
        Limit: 10,
      }),
    );
    check(
      !result.LastEvaluatedKey,
      "Synthetic partition exceeded the expected bounded query",
    );
    return result.Items ?? [];
  };
  const tombstone = async (target) => {
    const row = (
      await send(
        dynamo,
        new GetCommand({
          TableName: TABLE,
          ConsistentRead: true,
          Key: { pk: "ACCOUNT#deleted", sk: hash(target.sub) },
        }),
      )
    ).Item;
    check(
      row?.value?.deleted === true &&
        Number.isSafeInteger(row.revision) &&
        row.revision > 0,
      "Required hashed deletion tombstone is missing or invalid",
    );
    return row;
  };
  try {
    const snapshots = [];
    for (const target of TARGETS) {
      for (const username of [target.email, target.sub]) {
        let absent = false;
        try {
          await send(
            cognito,
            new AdminGetUserCommand({ UserPoolId: POOL, Username: username }),
          );
        } catch (error) {
          if (error.code === "UserNotFoundException") absent = true;
          else throw error;
        }
        check(
          absent,
          "Synthetic Cognito identity still exists; refusing direct data cleanup",
        );
      }
      for (const prefix of [
        `users/${encodeURIComponent(target.sub)}/`,
        `pending/${encodeURIComponent(target.sub)}/`,
      ]) {
        const objects = await send(
          s3,
          new ListObjectsV2Command({
            Bucket: BUCKET,
            ExpectedBucketOwner: ACCOUNT,
            Prefix: prefix,
            MaxKeys: 1,
          }),
        );
        check(
          (objects.KeyCount ?? 0) === 0 &&
            !objects.Contents?.length &&
            !objects.IsTruncated,
          "Synthetic S3 prefix is not empty; refusing direct data cleanup",
        );
      }
      const marker = await tombstone(target);
      const rows = validateOrphanRows(target.sub, await query(target));
      snapshots.push({ target, marker, rows });
    }
    check(
      snapshots.reduce((total, item) => total + item.rows.length, 0) === 5,
      "Expected exactly five approved rows",
    );
    report(
      "exact company stack, absent identities, empty S3 prefixes, deletion hashes and five synthetic rows verified",
    );
    if (!apply) {
      report(
        "dry run complete; no writes performed; --apply is required to remove the five rows",
      );
      return;
    }
    const transaction = snapshots.flatMap(({ marker, rows }) => [
      {
        ConditionCheck: {
          TableName: TABLE,
          Key: { pk: marker.pk, sk: marker.sk },
          ConditionExpression:
            "#revision = :revision AND #value.#deleted = :deleted",
          ExpressionAttributeNames: {
            "#revision": "revision",
            "#value": "value",
            "#deleted": "deleted",
          },
          ExpressionAttributeValues: {
            ":revision": marker.revision,
            ":deleted": true,
          },
        },
      },
      ...rows.map((row) => ({
        Delete: {
          TableName: TABLE,
          Key: { pk: row.pk, sk: row.sk },
          ConditionExpression: "#revision = :revision",
          ExpressionAttributeNames: { "#revision": "revision" },
          ExpressionAttributeValues: { ":revision": row.revision },
        },
      })),
    ]);
    // One all-or-nothing CAS transaction: five exact rows, plus both permanent
    // tombstone guards. Any concurrent revision change cancels every deletion.
    await send(
      dynamo,
      new TransactWriteCommand({ TransactItems: transaction }),
    );
    for (const { target, marker } of snapshots) {
      check(
        (await query(target)).length === 0,
        "Post-cleanup partition is not empty",
      );
      const retained = await tombstone(target);
      check(
        retained.revision === marker.revision,
        "Hashed deletion tombstone changed during cleanup",
      );
    }
    report(
      "five synthetic rows removed; both user partitions empty; hashed deletion tombstones retained",
    );
  } finally {
    cognito.destroy();
    s3.destroy();
    baseDynamo.destroy();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  cleanupSmokeOrphans().catch((error) => {
    console.error(
      JSON.stringify({
        result: "FAILED",
        message:
          error instanceof CleanupError
            ? error.message
            : "Cleanup failed; no raw identity, data or SDK response was logged. Verify before any retry.",
      }),
    );
    process.exitCode = 1;
  });
}
