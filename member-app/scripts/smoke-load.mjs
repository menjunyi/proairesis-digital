import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  alarmHistoryTransitionsToAlarm,
  alarmsOutsideOk,
  postLoadAlarmCheckAt,
  resolveAlarmNames,
  verifyAlarmContracts,
  waitUntil,
} from "./smoke-alarms.mjs";
import { verifyLiveRelease, writeSmokeEvidence } from "./smoke-evidence.mjs";

// Explicit production acceptance only. The script creates one suppressed-email
// synthetic account, sends a bounded mix of public health and authenticated
// profile/application reads, and deletes that account through the app API.
// It waits through the final CloudWatch period and rejects both current and
// transient alarm failures before writing evidence. SIGKILL or machine loss can
// still require cleanup of the exact synthetic identity.
const ACCOUNT = "037169690315";
const REGION = "ap-southeast-2";
const SITE_URL = "https://app.proairesis.digital";
const HEALTH_PATH = "/api/health";
const ACCOUNT_PATH = "/api/me";
const APPLICATIONS_PATH = "/api/applications";
const LOAD_PATHS = [HEALTH_PATH, ACCOUNT_PATH, APPLICATIONS_PATH];
const P95_LIMIT_MS = 2_000;
const FAILURE_RATE_LIMIT = 0.01;
const MAX_REQUESTS = 12_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

class LoadSmokeError extends Error {}

function check(condition, message) {
  if (!condition) throw new LoadSmokeError(message);
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const text = value === undefined || value === "" ? String(fallback) : String(value);
  check(/^\d+$/.test(text), `${label} must be an integer`);
  const number = Number(text);
  check(Number.isSafeInteger(number) && number >= minimum && number <= maximum,
    `${label} must be between ${minimum} and ${maximum}`);
  return number;
}

export function loadSmokeConfig(env = {}) {
  check(env.ROLECLUE_RUN_LOAD_SMOKE === "1",
    "Refusing load traffic: set ROLECLUE_RUN_LOAD_SMOKE=1 explicitly");
  const expectedSourceRevision = String(env.ROLECLUE_EXPECTED_SOURCE_REVISION ?? "").trim();
  check(/^[a-f0-9]{40}$/.test(expectedSourceRevision),
    "Set ROLECLUE_EXPECTED_SOURCE_REVISION to the exact deployed Git revision");
  const requestsPerSecond = boundedInteger(
    env.ROLECLUE_LOAD_REQUESTS_PER_SECOND, 10, 1, 20,
    "ROLECLUE_LOAD_REQUESTS_PER_SECOND",
  );
  const durationSeconds = boundedInteger(
    env.ROLECLUE_LOAD_DURATION_SECONDS, 300, 10, 600,
    "ROLECLUE_LOAD_DURATION_SECONDS",
  );
  const requestTimeoutMs = boundedInteger(
    env.ROLECLUE_LOAD_REQUEST_TIMEOUT_MS, 5_000, 2_000, 10_000,
    "ROLECLUE_LOAD_REQUEST_TIMEOUT_MS",
  );
  const plannedRequests = requestsPerSecond * durationSeconds;
  check(plannedRequests <= MAX_REQUESTS, `Load plan exceeds ${MAX_REQUESTS} requests`);
  const stackName = String(env.ROLECLUE_STACK_NAME || "roleclue-member-app");
  check(/^roleclue-member-app(?:-[a-z0-9-]+)?$/.test(stackName),
    "Only a RoleClue member-app stack is in scope");
  const profile = env.AWS_PROFILE || (env.GITHUB_ACTIONS === "true" ? "" : "proairesis-management");
  check(!profile || /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(profile), "AWS profile name is invalid");
  return {
    expectedSourceRevision,
    requestsPerSecond,
    durationSeconds,
    requestTimeoutMs,
    plannedRequests,
    maximumInFlight: Math.min(
      250,
      Math.max(10, Math.ceil(requestsPerSecond * requestTimeoutMs / 1_000) + requestsPerSecond),
    ),
    circuitBreakerMinimum: Math.max(50, requestsPerSecond * 5),
    circuitBreakerFailureRate: 0.1,
    stackName,
    profile,
  };
}

function createAws(profile) {
  const allowed = new Set([
    "sts:get-caller-identity",
    "cloudformation:describe-stacks",
    "cloudformation:describe-stack-resources",
    "cloudwatch:describe-alarms",
    "cloudwatch:describe-alarm-history",
    "lambda:get-alias",
    "lambda:get-function-configuration",
  ]);
  return async (service, operation, input = {}) => {
    check(allowed.has(`${service}:${operation}`), "AWS load-smoke operation is not allowlisted");
    const jsonInput = JSON.stringify(input);
    check(!/"[^"\\]*(?:password|token|secret|authorization|credential)[^"\\]*"\s*:/i.test(jsonInput),
      "Sensitive fields must not be passed through CLI arguments");
    const output = await new Promise((resolveOutput, reject) => {
      const child = spawn("aws", [
        service,
        operation,
        ...(profile ? ["--profile", profile] : []),
        "--region", REGION,
        "--no-cli-pager",
        "--output", "json",
        "--cli-connect-timeout", "10",
        "--cli-read-timeout", "30",
        "--cli-input-json", jsonInput,
      ], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, AWS_MAX_ATTEMPTS: "2" },
      });
      let stdout = "";
      let finished = false;
      const finish = (error, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolveOutput(value);
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new LoadSmokeError(`AWS ${service} ${operation} timed out`));
      }, 45_000);
      child.on("error", () => finish(new LoadSmokeError("AWS CLI could not start")));
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > 2 * 1024 * 1024) {
          child.kill("SIGTERM");
          finish(new LoadSmokeError(`AWS ${service} ${operation} response exceeded its limit`));
        }
      });
      child.stderr.on("data", () => {});
      child.on("close", (code) => {
        if (code === 0) finish(null, stdout);
        else finish(new LoadSmokeError(`AWS ${service} ${operation} failed`));
      });
    });
    try {
      return output.trim() ? JSON.parse(output) : {};
    } catch {
      throw new LoadSmokeError(`AWS ${service} ${operation} returned invalid JSON`);
    }
  };
}

async function boundedBody(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  check(!Number.isFinite(declaredLength) || declaredLength <= MAX_RESPONSE_BYTES,
    "Load response exceeded its size limit");
  const chunks = [];
  let size = 0;
  if (!response.body) return Buffer.alloc(0);
  for await (const chunk of response.body) {
    size += chunk.length;
    check(size <= MAX_RESPONSE_BYTES, "Load response exceeded its size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function executeApiProbe({
  url,
  token,
  requestTimeoutMs,
  fetchImpl = fetch,
  now = () => performance.now(),
}) {
  check(url instanceof URL && url.origin === SITE_URL && LOAD_PATHS.includes(url.pathname) &&
    !url.search && !url.hash && !url.username && !url.password,
  "Load probe target is not an approved RoleClue read endpoint");
  const authenticated = url.pathname !== HEALTH_PATH;
  check(!authenticated || typeof token === "string" && token.length >= 100 && token.length <= 16_384,
    "Authenticated load probes require an in-memory ID token");
  const startedAt = now();
  let status = null;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        "User-Agent": "RoleClue-Release-Load-Smoke/1.0",
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    status = response.status;
    const bodyBytes = await boundedBody(response);
    let body = null;
    if (status === 200) {
      try {
        body = JSON.parse(bodyBytes.toString("utf8"));
      } catch {
        body = null;
      }
    }
    const fromCloudFront = Boolean(response.headers.get("x-amz-cf-id"));
    const validBody = url.pathname === HEALTH_PATH
      ? body?.ok === true && body?.mode === "production"
      : url.pathname === ACCOUNT_PATH
        ? body?.mode === "production" && body.profile && body.billing && body.capabilities
        : Array.isArray(body?.applications) && Object.hasOwn(body, "nextCursor");
    const success = status === 200 && validBody && fromCloudFront;
    return {
      path: url.pathname,
      latencyMs: Math.max(0, now() - startedAt),
      status,
      success,
      rateLimited: status === 429,
      failureKind: success ? null : status === 429 ? "rate-limited" : status === 200 ? "invalid-response" : "http-error",
    };
  } catch {
    return {
      path: url.pathname,
      latencyMs: Math.max(0, now() - startedAt),
      status,
      success: false,
      rateLimited: status === 429,
      failureKind: status === null ? "transport" : status === 429 ? "rate-limited" : "invalid-response",
    };
  }
}

export async function executeHealthProbe(options) {
  return executeApiProbe(options);
}

export function percentile(values, fraction) {
  check(Array.isArray(values) && values.length > 0, "A percentile requires at least one value");
  check(Number.isFinite(fraction) && fraction > 0 && fraction <= 1, "Percentile fraction is invalid");
  const sorted = values.map(Number).sort((left, right) => left - right);
  check(sorted.every(Number.isFinite), "Percentile values must be finite numbers");
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

export function summarizeLoad(results, {
  plannedRequests,
  circuitBreakerTriggered = false,
  interrupted = false,
}) {
  check(Array.isArray(results), "Load results must be an array");
  check(Number.isSafeInteger(plannedRequests) && plannedRequests > 0, "Planned request count is invalid");
  check(results.length <= plannedRequests, "Completed requests exceed the load plan");
  const successfulRequests = results.filter((result) => result.success === true).length;
  const observedFailures = results.length - successfulRequests;
  const missingRequests = plannedRequests - results.length;
  const failedRequests = observedFailures + missingRequests;
  const failureRate = failedRequests / plannedRequests;
  const latencies = results.map((result) => Number(result.latencyMs)).filter(Number.isFinite);
  const p50Ms = latencies.length ? rounded(percentile(latencies, 0.5)) : null;
  const p95Ms = latencies.length ? rounded(percentile(latencies, 0.95)) : null;
  const p99Ms = latencies.length ? rounded(percentile(latencies, 0.99)) : null;
  const maxMs = latencies.length ? rounded(Math.max(...latencies)) : null;
  const summary = {
    plannedRequests,
    completedRequests: results.length,
    successfulRequests,
    failedRequests,
    missingRequests,
    rateLimitedResponses: results.filter((result) => result.rateLimited === true).length,
    transportErrors: results.filter((result) => result.failureKind === "transport").length,
    invalidResponses: results.filter((result) => result.failureKind === "invalid-response").length,
    httpErrorResponses: results.filter((result) => result.failureKind === "http-error").length,
    schedulerDrops: results.filter((result) => result.failureKind === "scheduler").length,
    failureRate: Math.round(failureRate * 1_000_000) / 1_000_000,
    p50Ms,
    p95Ms,
    p99Ms,
    maxMs,
    circuitBreakerTriggered,
    interrupted,
    routes: Object.fromEntries(LOAD_PATHS.map((path) => {
      const routeResults = results.filter((result) => result.path === path);
      return [path, {
        completedRequests: routeResults.length,
        successfulRequests: routeResults.filter((result) => result.success === true).length,
        failedRequests: routeResults.filter((result) => result.success !== true).length,
      }];
    })),
    thresholds: {
      p95LatencyMsExclusive: P95_LIMIT_MS,
      combinedFailureRateExclusive: FAILURE_RATE_LIMIT,
    },
  };
  summary.passed = summary.completedRequests === plannedRequests &&
    !circuitBreakerTriggered && !interrupted && p95Ms !== null &&
    p95Ms < P95_LIMIT_MS && failureRate < FAILURE_RATE_LIMIT;
  return summary;
}

export function requirePassingLoad(summary) {
  check(summary.completedRequests === summary.plannedRequests &&
    !summary.circuitBreakerTriggered && !summary.interrupted,
  "Load smoke did not complete its planned requests");
  check(summary.p95Ms !== null && summary.p95Ms < P95_LIMIT_MS,
    `Load-smoke p95 must be below ${P95_LIMIT_MS} ms`);
  check(summary.failureRate < FAILURE_RATE_LIMIT,
    "Combined errors and HTTP 429 responses must stay below 1%");
  for (const path of LOAD_PATHS)
    check(summary.routes?.[path]?.completedRequests > 0,
      `Load smoke did not exercise ${path}`);
  check(summary.passed === true, "Load-smoke thresholds were not met");
}

const defaultClock = {
  now: () => performance.now(),
  sleep: (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
};

export async function runRepresentativeLoad({
  siteUrl,
  token,
  config,
  fetchImpl = fetch,
  clock = defaultClock,
  probeImpl = executeApiProbe,
  shouldStop = () => false,
  onProgress = () => {},
}) {
  check(siteUrl instanceof URL && siteUrl.origin === SITE_URL && siteUrl.pathname === "/" &&
    !siteUrl.search && !siteUrl.hash && !siteUrl.username && !siteUrl.password,
  "Load smoke requires the approved RoleClue production origin");
  check(typeof token === "string" && token.length >= 100 && token.length <= 16_384,
    "Load smoke requires an in-memory synthetic ID token");
  const intervalMs = 1_000 / config.requestsPerSecond;
  const results = [];
  const active = new Set();
  let nextRequestAt = clock.now();
  let circuitBreakerTriggered = false;
  let interrupted = false;
  const recordResult = (result) => {
    results.push(result);
    if (results.length >= config.circuitBreakerMinimum) {
      const failures = results.filter((item) => item.success !== true).length;
      if (failures / results.length >= config.circuitBreakerFailureRate)
        circuitBreakerTriggered = true;
    }
  };
  for (let index = 0; index < config.plannedRequests; index += 1) {
    const path = LOAD_PATHS[index % LOAD_PATHS.length];
    const url = new URL(path, siteUrl);
    if (shouldStop()) {
      interrupted = true;
      break;
    }
    if (circuitBreakerTriggered) break;
    const delayMs = nextRequestAt - clock.now();
    if (delayMs > 0) await clock.sleep(delayMs);
    if (shouldStop()) {
      interrupted = true;
      break;
    }
    if (circuitBreakerTriggered) break;
    const launchedAt = clock.now();
    nextRequestAt = Math.max(nextRequestAt + intervalMs, launchedAt + intervalMs);
    if (active.size >= config.maximumInFlight) {
      recordResult({
        path,
        latencyMs: 0,
        status: null,
        success: false,
        rateLimited: false,
        failureKind: "scheduler",
      });
    } else {
      const request = Promise.resolve()
        .then(() => probeImpl({
          url,
          ...(path === HEALTH_PATH ? {} : { token }),
          requestTimeoutMs: config.requestTimeoutMs,
          fetchImpl,
          now: clock.now,
        }))
        .then(recordResult, () => recordResult({
          path,
          latencyMs: config.requestTimeoutMs,
          status: null,
          success: false,
          rateLimited: false,
          failureKind: "transport",
        }))
        .finally(() => active.delete(request));
      active.add(request);
    }
    if ((index + 1) % (config.requestsPerSecond * 60) === 0)
      onProgress({ scheduledRequests: index + 1, plannedRequests: config.plannedRequests });
  }
  await Promise.allSettled(active);
  return summarizeLoad(results, {
    plannedRequests: config.plannedRequests,
    circuitBreakerTriggered,
    interrupted,
  });
}

function report(checkName, result = "passed", details = {}) {
  console.log(JSON.stringify({ check: checkName, result, ...details }));
}

async function createSyntheticLoadIdentity(outputs) {
  const client = new CognitoIdentityProviderClient({ region: REGION, maxAttempts: 2 });
  const send = (command) => client.send(command, { abortSignal: AbortSignal.timeout(30_000) });
  const email = `roleclue-load-${randomUUID()}@invalid.example`;
  const password = `Rc9${randomBytes(27).toString("base64url")}`;
  let created = false;
  let username = email;
  try {
    const createdUser = await send(new AdminCreateUserCommand({
      UserPoolId: outputs.CognitoUserPoolId,
      Username: email,
      TemporaryPassword: password,
      MessageAction: "SUPPRESS",
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: "RoleClue Synthetic Load" },
      ],
    }));
    created = true;
    username = createdUser.User?.Username ?? email;
    const resolved = await send(new AdminGetUserCommand({
      UserPoolId: outputs.CognitoUserPoolId,
      Username: email,
    }));
    const attributes = Object.fromEntries((resolved.UserAttributes ?? []).map((item) => [item.Name, item.Value]));
    check(attributes.email === email && /^[a-f0-9-]{36}$/i.test(attributes.sub ?? ""),
      "Synthetic load identity attributes are invalid");
    await send(new AdminSetUserPasswordCommand({
      UserPoolId: outputs.CognitoUserPoolId,
      Username: resolved.Username,
      Password: password,
      Permanent: true,
    }));
    const signed = await send(new InitiateAuthCommand({
      ClientId: outputs.CognitoClientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }));
    const token = signed.AuthenticationResult?.IdToken;
    check(typeof token === "string" && token.length >= 100, "Synthetic load sign-in did not return an ID token");
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    check(claims.sub === attributes.sub && claims.email === email && claims.email_verified === true,
      "Synthetic load ID-token claims are invalid");
    return { client, send, email, username: resolved.Username, sub: attributes.sub, token };
  } catch (cause) {
    if (created) {
      try {
        await send(new AdminDeleteUserCommand({ UserPoolId: outputs.CognitoUserPoolId, Username: username }));
      } catch {}
    }
    client.destroy();
    if (cause instanceof LoadSmokeError) throw cause;
    throw new LoadSmokeError("Synthetic load identity setup failed");
  }
}

async function deleteSyntheticLoadIdentity(identity, outputs, fetchImpl = fetch) {
  let publicDeletePassed = false;
  try {
    const response = await fetchImpl(new URL("/api/account", outputs.SiteUrl), {
      method: "DELETE",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${identity.token}`,
        Origin: outputs.SiteUrl,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confirmation: "DELETE" }),
    });
    const bytes = await boundedBody(response);
    let body;
    try { body = JSON.parse(bytes.toString("utf8")); } catch {}
    publicDeletePassed = response.status === 200 && body?.deleted === true &&
      Boolean(response.headers.get("x-amz-cf-id"));
  } catch {}

  let missing = false;
  try {
    await identity.send(new AdminGetUserCommand({
      UserPoolId: outputs.CognitoUserPoolId,
      Username: identity.username,
    }));
  } catch (error) {
    if (error?.name === "UserNotFoundException") missing = true;
  }
  if (!missing) {
    try {
      await identity.send(new AdminDeleteUserCommand({
        UserPoolId: outputs.CognitoUserPoolId,
        Username: identity.username,
      }));
      missing = true;
    } catch {}
  }
  identity.token = undefined;
  identity.client.destroy();
  check(publicDeletePassed && missing,
    "Synthetic load account cleanup was not confirmed through the public account-deletion flow");
}

export async function runLoadSmoke(env = process.env) {
  const config = loadSmokeConfig(env);
  if (config.profile) process.env.AWS_PROFILE = config.profile;
  const aws = createAws(config.profile);
  const caller = await aws("sts", "get-caller-identity");
  check(caller.Account === ACCOUNT, "AWS account mismatch; no load traffic was sent");
  const described = await aws("cloudformation", "describe-stacks", { StackName: config.stackName });
  const stack = described.Stacks?.[0];
  check(stack?.StackId?.startsWith(`arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${config.stackName}/`),
    "Stack account or region mismatch; no load traffic was sent");
  check(["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.StackStatus),
    "Stack is not in a completed state; no load traffic was sent");
  const outputs = Object.fromEntries((stack.Outputs ?? []).map((item) => [item.OutputKey, item.OutputValue]));
  for (const key of ["SiteUrl", "FunctionName", "FunctionVersion", "FunctionAliasArn", "CognitoUserPoolId",
    "CognitoClientId", "SiteArtifactSha256", "AlarmTopicArn"])
    check(outputs[key], `Stack output ${key} is missing`);
  check(outputs.SiteUrl === SITE_URL, "Load smoke requires the approved RoleClue production origin");
  const sourceCheck = (condition, message) => check(condition, message);
  const expectedReleaseId = stack.Parameters?.find((item) => item.ParameterKey === "ReleaseId")?.ParameterValue;
  const before = await verifyLiveRelease({ aws, outputs, siteUrl: outputs.SiteUrl, check: sourceCheck,
    expectedReleaseId, expectedSourceRevision: config.expectedSourceRevision });
  check(before.manifest.sourceRevision === config.expectedSourceRevision,
    "The deployed release does not match ROLECLUE_EXPECTED_SOURCE_REVISION");
  report("source-pinned live release verified before load");

  const stackResources = (await aws("cloudformation", "describe-stack-resources", {
    StackName: config.stackName,
  })).StackResources ?? [];
  const alarmNamesByLogicalId = resolveAlarmNames(stackResources, check);
  const alarmNames = [...alarmNamesByLogicalId.values()];
  const readAlarms = async () => (await aws("cloudwatch", "describe-alarms", {
    AlarmNames: alarmNames,
  })).MetricAlarms ?? [];
  const startingAlarms = await readAlarms();
  verifyAlarmContracts({
    alarms: startingAlarms,
    namesByLogicalId: alarmNamesByLogicalId,
    alarmTopicArn: outputs.AlarmTopicArn,
    check,
  });
  check(alarmsOutsideOk(startingAlarms, alarmNames).length === 0,
    "Production alarms must be OK before load traffic starts");
  report("all production alarms verified OK before load");

  const identity = await createSyntheticLoadIdentity(outputs);
  report("suppressed synthetic account signed in for read-only authenticated load");

  const startedAt = new Date().toISOString();
  let interrupted = false;
  const requestStop = () => { interrupted = true; };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  let summary, loadError, cleanupError;
  try {
    summary = await runRepresentativeLoad({
      siteUrl: new URL(outputs.SiteUrl),
      token: identity.token,
      config,
      shouldStop: () => interrupted,
      onProgress: ({ scheduledRequests, plannedRequests }) =>
        report("load-smoke progress", "running", { scheduledRequests, plannedRequests }),
    });
  } catch (error) {
    loadError = error;
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
    try {
      await deleteSyntheticLoadIdentity(identity, outputs);
      report("synthetic load account removed through the public account-deletion flow");
    } catch (error) {
      cleanupError = error;
    }
  }
  if (loadError && cleanupError)
    throw new LoadSmokeError("Load smoke failed and synthetic account cleanup was not confirmed", {
      cause: new AggregateError([loadError, cleanupError]),
    });
  if (loadError) throw loadError;
  if (cleanupError) throw cleanupError;
  const loadCompletedAt = new Date().toISOString();

  const after = await verifyLiveRelease({ aws, outputs, siteUrl: outputs.SiteUrl, check: sourceCheck,
    expectedReleaseId, expectedSourceRevision: config.expectedSourceRevision });
  check(after.manifest.sourceRevision === config.expectedSourceRevision &&
    after.manifest.releaseId === before.manifest.releaseId &&
    after.alias.FunctionVersion === before.alias.FunctionVersion &&
    after.configuration.CodeSha256 === before.configuration.CodeSha256,
  "The live release changed during the load smoke");
  requirePassingLoad(summary);
  const alarmCheckAt = postLoadAlarmCheckAt(loadCompletedAt);
  report("waiting through the final CloudWatch alarm period and ingestion grace", "pending", { alarmCheckAt });
  await waitUntil({
    deadline: alarmCheckAt,
    onPoll: ({ remainingMs }) => report("post-load alarm evaluation wait", "pending", {
      remainingSeconds: Math.ceil(remainingMs / 1_000),
    }),
  });
  const finalAlarms = await readAlarms();
  verifyAlarmContracts({
    alarms: finalAlarms,
    namesByLogicalId: alarmNamesByLogicalId,
    alarmTopicArn: outputs.AlarmTopicArn,
    check,
  });
  check(alarmsOutsideOk(finalAlarms, alarmNames).length === 0,
    "A production alarm is not OK after load traffic");
  const alarmVerifiedAt = new Date().toISOString();
  const alarmTransitions = [];
  for (const alarmName of alarmNames) {
    const history = await aws("cloudwatch", "describe-alarm-history", {
      AlarmName: alarmName,
      HistoryItemType: "StateUpdate",
      StartDate: startedAt,
      EndDate: alarmVerifiedAt,
      MaxRecords: 100,
    });
    check(!history.NextToken, `Alarm history for ${alarmName} exceeded the bounded result`);
    for (const item of alarmHistoryTransitionsToAlarm(history.AlarmHistoryItems, startedAt))
      alarmTransitions.push({ alarmName, timestamp: new Date(item.Timestamp).toISOString() });
  }
  check(alarmTransitions.length === 0,
    "A production alarm entered ALARM during or after the load smoke");
  report("all production alarms remained OK through post-load evaluation");
  const completedAt = new Date().toISOString();
  const evidencePath = await writeSmokeEvidence("load-smoke", {
    startedAt,
    completedAt,
    account: ACCOUNT,
    region: REGION,
    stackId: stack.StackId,
    siteUrl: outputs.SiteUrl,
    sourceRevision: before.manifest.sourceRevision,
    releaseId: before.manifest.releaseId,
    releaseCreatedAt: before.manifest.createdAt,
    lambdaSha256: before.manifest.lambdaSha256,
    liveFunctionVersion: before.alias.FunctionVersion,
    liveAliasArn: before.alias.AliasArn,
    requests: LOAD_PATHS.map((path) => ({ method: "GET", path, authenticated: path !== HEALTH_PATH })),
    plan: {
      requestsPerSecond: config.requestsPerSecond,
      durationSeconds: config.durationSeconds,
      requestTimeoutMs: config.requestTimeoutMs,
    },
    summary,
    alarms: {
      checkedAt: alarmVerifiedAt,
      evaluationNotBefore: alarmCheckAt,
      transitionToAlarmCount: alarmTransitions.length,
      current: finalAlarms.map((alarm) => ({ name: alarm.AlarmName, state: alarm.StateValue })),
    },
    checks: [
      { label: "exact expected source revision and protected live Lambda alias verified before load", result: "passed" },
      { label: "bounded public health and authenticated profile/application reads completed through CloudFront", result: "passed" },
      { label: "p95 latency remained below 2 seconds and combined errors plus HTTP 429 remained below 1%", result: "passed" },
      { label: "the source-pinned release remained unchanged through the test", result: "passed" },
      { label: "all production alarms were OK before load and had no ALARM transition through post-load evaluation", result: "passed" },
      { label: "the synthetic load account was removed through the public account-deletion flow", result: "passed" },
    ],
  });
  report("load smoke evidence saved", "passed", { path: "build/evidence/load-smoke.json" });
  return {
    evidencePath,
    releaseId: before.manifest.releaseId,
    sourceRevision: before.manifest.sourceRevision,
    summary,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLoadSmoke().catch((error) => {
    const message = error instanceof LoadSmokeError
      ? error.message
      : "Load smoke failed during its guarded production check";
    console.error(JSON.stringify({ result: "FAILED", message }));
    process.exitCode = 1;
  });
}
