import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyLiveRelease, writeSmokeEvidence } from "./smoke-evidence.mjs";

const ACCOUNT = "037169690315";
const REGION = "ap-southeast-2";
const SITE_URL = "https://app.proairesis.digital";
const HEALTH_PATH = "/api/health";
const P95_LIMIT_MS = 2_000;
const FAILURE_RATE_LIMIT = 0.01;
const MAX_REQUESTS = 12_000;
const MAX_RESPONSE_BYTES = 4 * 1024;

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
    "Health response exceeded its size limit");
  const chunks = [];
  let size = 0;
  if (!response.body) return Buffer.alloc(0);
  for await (const chunk of response.body) {
    size += chunk.length;
    check(size <= MAX_RESPONSE_BYTES, "Health response exceeded its size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function executeHealthProbe({
  url,
  requestTimeoutMs,
  fetchImpl = fetch,
  now = () => performance.now(),
}) {
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
    const success = status === 200 && body?.ok === true && body?.mode === "production" && fromCloudFront;
    return {
      latencyMs: Math.max(0, now() - startedAt),
      status,
      success,
      rateLimited: status === 429,
      failureKind: success ? null : status === 429 ? "rate-limited" : status === 200 ? "invalid-health" : "http-error",
    };
  } catch {
    return {
      latencyMs: Math.max(0, now() - startedAt),
      status,
      success: false,
      rateLimited: status === 429,
      failureKind: status === null ? "transport" : status === 429 ? "rate-limited" : "invalid-response",
    };
  }
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
    invalidHealthResponses: results.filter((result) =>
      result.failureKind === "invalid-health" || result.failureKind === "invalid-response").length,
    httpErrorResponses: results.filter((result) => result.failureKind === "http-error").length,
    schedulerDrops: results.filter((result) => result.failureKind === "scheduler").length,
    failureRate: Math.round(failureRate * 1_000_000) / 1_000_000,
    p50Ms,
    p95Ms,
    p99Ms,
    maxMs,
    circuitBreakerTriggered,
    interrupted,
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
  check(summary.passed === true, "Load-smoke thresholds were not met");
}

const defaultClock = {
  now: () => performance.now(),
  sleep: (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
};

export async function runHealthLoad({
  url,
  config,
  fetchImpl = fetch,
  clock = defaultClock,
  probeImpl = executeHealthProbe,
  shouldStop = () => false,
  onProgress = () => {},
}) {
  check(url instanceof URL && url.origin === SITE_URL && url.pathname === HEALTH_PATH &&
    !url.search && !url.hash && !url.username && !url.password,
  "Load smoke may call only the approved RoleClue health endpoint");
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
        latencyMs: 0,
        status: null,
        success: false,
        rateLimited: false,
        failureKind: "scheduler",
      });
    } else {
      let request;
      request = Promise.resolve()
        .then(() => probeImpl({
          url,
          requestTimeoutMs: config.requestTimeoutMs,
          fetchImpl,
          now: clock.now,
        }))
        .then(recordResult, () => recordResult({
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
  await Promise.allSettled([...active]);
  return summarizeLoad(results, {
    plannedRequests: config.plannedRequests,
    circuitBreakerTriggered,
    interrupted,
  });
}

function report(checkName, result = "passed", details = {}) {
  console.log(JSON.stringify({ check: checkName, result, ...details }));
}

export async function runLoadSmoke(env = process.env) {
  const config = loadSmokeConfig(env);
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
  for (const key of ["SiteUrl", "FunctionName", "FunctionVersion", "FunctionAliasArn"])
    check(outputs[key], `Stack output ${key} is missing`);
  check(outputs.SiteUrl === SITE_URL, "Load smoke requires the approved RoleClue production origin");
  const sourceCheck = (condition, message) => check(condition, message);
  const before = await verifyLiveRelease({ aws, outputs, siteUrl: outputs.SiteUrl, check: sourceCheck });
  check(before.manifest.sourceRevision === config.expectedSourceRevision,
    "The deployed release does not match ROLECLUE_EXPECTED_SOURCE_REVISION");
  report("source-pinned live release verified before load");

  const startedAt = new Date().toISOString();
  let interrupted = false;
  const requestStop = () => { interrupted = true; };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  let summary;
  try {
    summary = await runHealthLoad({
      url: new URL(HEALTH_PATH, outputs.SiteUrl),
      config,
      shouldStop: () => interrupted,
      onProgress: ({ scheduledRequests, plannedRequests }) =>
        report("load-smoke progress", "running", { scheduledRequests, plannedRequests }),
    });
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
  }

  const after = await verifyLiveRelease({ aws, outputs, siteUrl: outputs.SiteUrl, check: sourceCheck });
  check(after.manifest.sourceRevision === config.expectedSourceRevision &&
    after.manifest.releaseId === before.manifest.releaseId &&
    after.alias.FunctionVersion === before.alias.FunctionVersion &&
    after.configuration.CodeSha256 === before.configuration.CodeSha256,
  "The live release changed during the load smoke");
  requirePassingLoad(summary);
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
    request: { method: "GET", path: HEALTH_PATH },
    plan: {
      requestsPerSecond: config.requestsPerSecond,
      durationSeconds: config.durationSeconds,
      requestTimeoutMs: config.requestTimeoutMs,
    },
    summary,
    checks: [
      { label: "exact expected source revision and protected live Lambda alias verified before load", result: "passed" },
      { label: "only the public GET /api/health endpoint received bounded traffic", result: "passed" },
      { label: "p95 latency remained below 2 seconds and combined errors plus HTTP 429 remained below 1%", result: "passed" },
      { label: "the source-pinned release remained unchanged through the test", result: "passed" },
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
