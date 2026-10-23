import test from "node:test";
import assert from "node:assert/strict";
import {
  executeApiProbe,
  executeHealthProbe,
  loadSmokeConfig,
  percentile,
  requirePassingLoad,
  runRepresentativeLoad,
  summarizeLoad,
} from "../scripts/smoke-load.mjs";

const revision = "a".repeat(40);
const token = "t".repeat(200);

function configuredEnv(overrides = {}) {
  return {
    ROLECLUE_RUN_LOAD_SMOKE: "1",
    ROLECLUE_EXPECTED_SOURCE_REVISION: revision,
    ...overrides,
  };
}

function success(latencyMs = 100, path = "/api/health") {
  return {
    path,
    latencyMs,
    status: 200,
    success: true,
    rateLimited: false,
    failureKind: null,
  };
}

function representativeSuccesses(count, latencyMs = 100) {
  const paths = ["/api/health", "/api/me", "/api/applications"];
  return Array.from({ length: count }, (_, index) => success(latencyMs, paths[index % paths.length]));
}

test("load smoke defaults to 10 requests per second for five minutes with hard bounds", () => {
  const config = loadSmokeConfig(configuredEnv());
  assert.equal(config.requestsPerSecond, 10);
  assert.equal(config.durationSeconds, 300);
  assert.equal(config.plannedRequests, 3_000);
  assert.equal(config.requestTimeoutMs, 5_000);
  assert.equal(config.stackName, "roleclue-member-app");
  assert.equal(config.profile, "proairesis-management");

  assert.throws(() => loadSmokeConfig({
    ROLECLUE_EXPECTED_SOURCE_REVISION: revision,
  }), /Refusing load traffic/);
  assert.throws(() => loadSmokeConfig({
    ROLECLUE_RUN_LOAD_SMOKE: "1",
  }), /ROLECLUE_EXPECTED_SOURCE_REVISION/);
  assert.throws(() => loadSmokeConfig(configuredEnv({
    ROLECLUE_LOAD_REQUESTS_PER_SECOND: "21",
  })), /between 1 and 20/);
  assert.throws(() => loadSmokeConfig(configuredEnv({
    ROLECLUE_LOAD_DURATION_SECONDS: "601",
  })), /between 10 and 600/);
  assert.throws(() => loadSmokeConfig(configuredEnv({
    ROLECLUE_STACK_NAME: "another-product",
  })), /Only a RoleClue member-app stack/);

  const largest = loadSmokeConfig(configuredEnv({
    ROLECLUE_LOAD_REQUESTS_PER_SECOND: "20",
    ROLECLUE_LOAD_DURATION_SECONDS: "600",
    ROLECLUE_LOAD_REQUEST_TIMEOUT_MS: "10000",
  }));
  assert.equal(largest.plannedRequests, 12_000);
  assert.ok(largest.maximumInFlight <= 250);
});

test("health probes accept only the production health payload delivered through CloudFront", async () => {
  let now = 10;
  const calls = [];
  const passed = await executeHealthProbe({
    url: new URL("https://app.proairesis.digital/api/health"),
    requestTimeoutMs: 5_000,
    now: () => {
      now += 25;
      return now;
    },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ ok: true, mode: "production" }), {
        status: 200,
        headers: { "content-type": "application/json", "x-amz-cf-id": "redacted-request-id" },
      });
    },
  });
  assert.equal(passed.success, true);
  assert.equal(passed.status, 200);
  assert.equal(passed.latencyMs, 25);
  assert.equal(calls[0].url, "https://app.proairesis.digital/api/health");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Accept, "application/json");

  const notFromCloudFront = await executeHealthProbe({
    url: new URL("https://app.proairesis.digital/api/health"),
    requestTimeoutMs: 5_000,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, mode: "production" }), { status: 200 }),
  });
  assert.equal(notFromCloudFront.success, false);
  assert.equal(notFromCloudFront.failureKind, "invalid-response");

  const throttled = await executeHealthProbe({
    url: new URL("https://app.proairesis.digital/api/health"),
    requestTimeoutMs: 5_000,
    fetchImpl: async () => new Response("throttled", { status: 429 }),
  });
  assert.equal(throttled.success, false);
  assert.equal(throttled.rateLimited, true);
  assert.equal(throttled.failureKind, "rate-limited");

  const transport = await executeHealthProbe({
    url: new URL("https://app.proairesis.digital/api/health"),
    requestTimeoutMs: 5_000,
    fetchImpl: async () => { throw new Error("private transport detail"); },
  });
  assert.equal(transport.status, null);
  assert.equal(transport.failureKind, "transport");

  const authenticatedCalls = [];
  const account = await executeApiProbe({
    url: new URL("https://app.proairesis.digital/api/me"),
    token,
    requestTimeoutMs: 5_000,
    fetchImpl: async (url, options) => {
      authenticatedCalls.push({ url: url.href, options });
      return new Response(JSON.stringify({
        mode: "production",
        profile: {},
        billing: {},
        capabilities: {},
      }), { status: 200, headers: { "x-amz-cf-id": "request-id" } });
    },
  });
  assert.equal(account.success, true);
  assert.equal(authenticatedCalls[0].options.headers.Authorization, `Bearer ${token}`);

  const applications = await executeApiProbe({
    url: new URL("https://app.proairesis.digital/api/applications"),
    token,
    requestTimeoutMs: 5_000,
    fetchImpl: async () => new Response(JSON.stringify({ applications: [], nextCursor: null }), {
      status: 200,
      headers: { "x-amz-cf-id": "request-id" },
    }),
  });
  assert.equal(applications.success, true);
  await assert.rejects(executeApiProbe({
    url: new URL("https://app.proairesis.digital/api/export"),
    token,
    requestTimeoutMs: 5_000,
  }), /not an approved RoleClue read endpoint/);
});

test("load summaries enforce strict p95 and combined error plus 429 thresholds", () => {
  assert.equal(percentile([5, 1, 4, 3, 2], 0.95), 5);
  const passing = summarizeLoad(representativeSuccesses(99, 1_999), {
    plannedRequests: 99,
  });
  assert.equal(passing.p95Ms, 1_999);
  assert.equal(passing.failureRate, 0);
  assert.equal(passing.passed, true);
  assert.doesNotThrow(() => requirePassingLoad(passing));

  const latencyBoundary = summarizeLoad([
    ...representativeSuccesses(94, 1_999),
    ...representativeSuccesses(6, 2_000),
  ].map((result, index) => ({ ...result, path: ["/api/health", "/api/me", "/api/applications"][index % 3] })), { plannedRequests: 100 });
  assert.equal(latencyBoundary.p95Ms, 2_000);
  assert.equal(latencyBoundary.passed, false);
  assert.throws(() => requirePassingLoad(latencyBoundary), /p95 must be below 2000 ms/);

  const failureBoundaryResults = representativeSuccesses(99, 100);
  failureBoundaryResults.push({
    path: "/api/health",
    latencyMs: 100,
    status: 429,
    success: false,
    rateLimited: true,
    failureKind: "rate-limited",
  });
  const failureBoundary = summarizeLoad(failureBoundaryResults, { plannedRequests: 100 });
  assert.equal(failureBoundary.rateLimitedResponses, 1);
  assert.equal(failureBoundary.failedRequests, 1);
  assert.equal(failureBoundary.failureRate, 0.01);
  assert.equal(failureBoundary.passed, false);
  assert.throws(() => requirePassingLoad(failureBoundary), /below 1%/);

  const incomplete = summarizeLoad(representativeSuccesses(90, 100), {
    plannedRequests: 100,
    circuitBreakerTriggered: true,
  });
  assert.equal(incomplete.missingRequests, 10);
  assert.equal(incomplete.failedRequests, 10);
  assert.equal(incomplete.passed, false);
  assert.throws(() => requirePassingLoad(incomplete), /did not complete/);
});

test("the scheduler paces an exact representative mix of public and authenticated reads", async () => {
  let time = 0;
  const clock = {
    now: () => time,
    sleep: async (milliseconds) => {
      time += milliseconds;
      await Promise.resolve();
    },
  };
  const probes = [];
  const config = {
    requestsPerSecond: 2,
    plannedRequests: 6,
    requestTimeoutMs: 5_000,
    maximumInFlight: 10,
    circuitBreakerMinimum: 50,
    circuitBreakerFailureRate: 0.1,
  };
  const summary = await runRepresentativeLoad({
    siteUrl: new URL("https://app.proairesis.digital"),
    token,
    config,
    clock,
    probeImpl: async ({ url, token: probeToken }) => {
      probes.push({ url: String(url), authenticated: Boolean(probeToken) });
      return success(50, url.pathname);
    },
  });
  assert.equal(summary.completedRequests, 6);
  assert.equal(summary.passed, true);
  assert.deepEqual(probes, [
    { url: "https://app.proairesis.digital/api/health", authenticated: false },
    { url: "https://app.proairesis.digital/api/me", authenticated: true },
    { url: "https://app.proairesis.digital/api/applications", authenticated: true },
    { url: "https://app.proairesis.digital/api/health", authenticated: false },
    { url: "https://app.proairesis.digital/api/me", authenticated: true },
    { url: "https://app.proairesis.digital/api/applications", authenticated: true },
  ]);
  assert.equal(time, 2_500);

  await assert.rejects(runRepresentativeLoad({
    siteUrl: new URL("https://example.com"),
    token,
    config,
    clock,
    probeImpl: async () => success(),
  }), /approved RoleClue production origin/);
  await assert.rejects(runRepresentativeLoad({
    siteUrl: new URL("https://app.proairesis.digital/?extra=true"),
    token,
    config,
    clock,
    probeImpl: async () => success(),
  }), /approved RoleClue production origin/);
  await assert.rejects(runRepresentativeLoad({
    siteUrl: new URL("https://app.proairesis.digital"),
    token: "short",
    config,
    clock,
    probeImpl: async () => success(),
  }), /in-memory synthetic ID token/);
});

test("the scheduler opens its circuit after a sustained failure rate", async () => {
  let time = 0;
  const clock = {
    now: () => time,
    sleep: async (milliseconds) => {
      time += milliseconds;
      await Promise.resolve();
    },
  };
  const config = {
    requestsPerSecond: 10,
    plannedRequests: 100,
    requestTimeoutMs: 5_000,
    maximumInFlight: 20,
    circuitBreakerMinimum: 5,
    circuitBreakerFailureRate: 0.1,
  };
  const summary = await runRepresentativeLoad({
    siteUrl: new URL("https://app.proairesis.digital"),
    token,
    config,
    clock,
    probeImpl: async ({ url }) => ({
      path: url.pathname,
      latencyMs: 10,
      status: 503,
      success: false,
      rateLimited: false,
      failureKind: "http-error",
    }),
  });
  assert.equal(summary.circuitBreakerTriggered, true);
  assert.ok(summary.completedRequests >= 5);
  assert.ok(summary.completedRequests < 100);
  assert.equal(summary.passed, false);
});
