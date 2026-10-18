import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  DescribeUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { syntheticResumePdf } from "./smoke-cloud.mjs";

// Deliberately excluded from npm test and deployment. Review the deployment,
// then opt in: ROLECLUE_RUN_BROWSER_SMOKE=1 node scripts/smoke-browser.mjs
// Uses only the existing agent-owned TaskSpace 82 / p1; never creates, claims,
// closes or finishes a space. Allow roughly 10 minutes, including upload-link
// expiry. SIGINT/SIGTERM requests stop new tests but preserve finally cleanup.
// SIGKILL, machine shutdown or a prolonged outage can still require cleanup.
// No emails, provider calls, payments, real resumes or saved passwords are used.
const ACCOUNT = "037169690315";
const REGION = "ap-southeast-2";
const HOSTNAME = "app.proairesis.digital";
const UPLOAD_EXPIRY_AND_GRACE_MS = 7 * 60 * 1000;
const MAX_POLL_MS = 30_000;
class SmokeCheckError extends Error {}

function check(condition, label) {
  if (!condition) throw new SmokeCheckError(label);
}

function report(checkName, result = "passed", screenshot) {
  console.log(
    JSON.stringify({
      check: checkName,
      result,
      ...(screenshot ? { screenshot } : {}),
    }),
  );
}

const sleep = (milliseconds) =>
  new Promise((resolveWait) =>
    setTimeout(resolveWait, Math.min(MAX_POLL_MS, milliseconds)),
  );

function createAws(profile) {
  const cognito = new CognitoIdentityProviderClient({
    region: REGION,
    profile,
    maxAttempts: 2,
  });
  const cognitoCommands = {
    "admin-create-user": AdminCreateUserCommand,
    "admin-get-user": AdminGetUserCommand,
    "admin-set-user-password": AdminSetUserPasswordCommand,
    "describe-user-pool": DescribeUserPoolCommand,
    "describe-user-pool-client": DescribeUserPoolClientCommand,
  };
  const readOnlyCli = new Set([
    "sts:get-caller-identity",
    "cloudformation:describe-stacks",
    "lambda:get-function-configuration",
    "cloudfront:get-distribution",
    "dynamodb:describe-table",
    "dynamodb:get-item",
    "dynamodb:query",
    "s3api:head-bucket",
    "s3api:list-objects-v2",
  ]);
  return async (service, operation, input = {}) => {
    if (service === "cognito-idp") {
      const Command = cognitoCommands[operation];
      check(Command, "Unsupported Cognito smoke operation");
      let timer;
      try {
        // Password-bearing inputs never reach argv, files or process output.
        // Explicit client profile uses the installed SDK's profile credential
        // chain rather than unrelated static environment credentials.
        return await Promise.race([
          cognito.send(new Command(input), {
            abortSignal: AbortSignal.timeout(45_000),
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new SmokeCheckError("Cognito request timed out")),
              45_000,
            );
          }),
        ]);
      } catch (cause) {
        const error = new SmokeCheckError(
          `AWS cognito-idp ${operation} failed`,
        );
        if (cause?.name === "UserNotFoundException")
          error.code = "UserNotFoundException";
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    check(
      readOnlyCli.has(`${service}:${operation}`),
      "Only approved read-only AWS operations may use CLI arguments",
    );
    // macOS cannot reliably reopen a child-process pipe via /dev/stdin. These
    // allowlisted read-only inputs contain resource IDs, never credentials.
    // Raw stdout/stderr and unexpected errors still remain private.
    const output = await new Promise((resolveOutput, reject) => {
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
        finished = false;
      const finish = (error, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        error ? reject(error) : resolveOutput(value);
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new SmokeCheckError(`AWS ${service} ${operation} timed out`));
      }, 45_000);
      child.on("error", () =>
        finish(new SmokeCheckError("AWS CLI could not start")),
      );
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > 2 * 1024 * 1024) {
          child.kill("SIGTERM");
          finish(new SmokeCheckError("AWS response exceeded its limit"));
        }
      });
      child.stderr.on("data", () => {});
      child.on("close", (code) => {
        if (code === 0) return finish(null, stdout);
        const error = new SmokeCheckError(`AWS ${service} ${operation} failed`);
        finish(error);
      });
    });
    try {
      return output.trim() ? JSON.parse(output) : {};
    } catch {
      throw new SmokeCheckError("AWS returned invalid JSON");
    }
  };
}

async function boundedJson(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    check(size <= 512 * 1024, "HTTP response exceeded its limit");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SmokeCheckError("HTTP response was not JSON");
  }
}

// Serialized into ego-browser's stdin. Arguments live in child-process memory;
// do not print them, page snapshots, receipts, requests or caught errors.
async function browserRound(parameters) {
  let stage = "existing browser space",
    page,
    observerInstalled = false;
  let outcome = { passed: false, stage };
  try {
    const task = await taskSpace(82);
    if (Number(task.spaceId) !== 82 || task.ownership !== "agent")
      throw new Error("Unavailable");
    const pages = await task.pages();
    if (!pages.some((item) => item.label === "p1"))
      throw new Error("Missing page");
    page = task.page("p1");
    stage = "deployed signed-out page";
    await page.goto(parameters.siteUrl, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
    if (new URL(await page.url()).origin !== parameters.siteUrl)
      throw new Error("Wrong origin");
    const occupied = await page.evaluate(() =>
      Boolean(sessionStorage.getItem("roleclue.session.v1")),
    );
    if (occupied) throw new Error("Existing session; do not change it");
    await page.waitForSelector('input[type="email"]', {
      state: "visible",
      timeout: 30_000,
    });
    await page.snapshot(); // Observe privately before using source-verified selectors.
    if (parameters.phase === "preflight") {
      outcome = {
        passed: true,
        stage: "existing signed-out browser page verified",
      };
    } else {
      stage = "normal UI sign-in";
      await page.fill('input[type="email"]', parameters.email);
      await page.fill('input[type="password"]', parameters.password);
      await page.click("loc=role:button[name='Sign in']");
      await page.waitForSelector("#resume-file", {
        state: "attached",
        timeout: 60_000,
      });
      const ownSession = await page.evaluate((email) => {
        try {
          const session = JSON.parse(
            sessionStorage.getItem("roleclue.session.v1"),
          );
          return (
            session?.email === email &&
            Boolean(session.idToken) &&
            !session.demo
          );
        } catch {
          return false;
        }
      }, parameters.email);
      if (!ownSession) throw new Error("Wrong session");
      await page.snapshot();
      stage = "resume processing consent";
      await page.click('.check-line.consent input[type="checkbox"]');
      const consent = await page.evaluate(
        () =>
          document.querySelector(".check-line.consent input")?.checked === true,
      );
      if (!consent) throw new Error("Consent missing");
      stage = "browser signed-S3 upload and extraction";
      await page.evaluate(
        ({ pdfBase64, marker, bucketHost }) => {
          const input = document.querySelector("#resume-file");
          if (
            !(input instanceof HTMLInputElement) ||
            window.__roleclueBrowserSmoke
          )
            throw new Error("Invalid page state");
          const originalFetch = window.fetch;
          const state = {
            presign: 0,
            s3Put: 0,
            finalize: 0,
            inline: 0,
            failed: false,
            restore: null,
          };
          // Transparent observation only: the unmodified application still sends
          // every request and receives the real fetch response, including CORS.
          window.fetch = async function (...args) {
            const request = args[0],
              options = args[1];
            const url = new URL(
              request instanceof Request ? request.url : String(request),
              location.href,
            );
            const method = (
              options?.method ||
              (request instanceof Request ? request.method : "GET")
            ).toUpperCase();
            let category;
            if (url.origin === location.origin && method === "POST") {
              if (url.pathname === "/api/resume/upload") category = "presign";
              if (url.pathname === "/api/resume/finalize")
                category = "finalize";
              if (url.pathname === "/api/resume") category = "inline";
            }
            if (
              url.protocol === "https:" &&
              url.hostname === bucketHost &&
              method === "PUT"
            )
              category = "s3Put";
            try {
              const response = await originalFetch.apply(this, args);
              if (category) {
                if (
                  response.ok &&
                  (category !== "s3Put" || response.type === "cors")
                )
                  state[category]++;
                else state.failed = true;
              }
              return response;
            } catch (error) {
              if (category) state.failed = true;
              throw error;
            }
          };
          state.restore = () => {
            window.fetch = originalFetch;
            delete window.__roleclueBrowserSmoke;
          };
          window.__roleclueBrowserSmoke = state;
          const bytes = Uint8Array.from(atob(pdfBase64), (character) =>
            character.charCodeAt(0),
          );
          const file = new File(
            [bytes],
            "roleclue-synthetic-browser-smoke.pdf",
            { type: "application/pdf" },
          );
          const transfer = new DataTransfer();
          transfer.items.add(file);
          input.files = transfer.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          // The marker is never used as a replacement for extraction.
          if (!marker.startsWith("ROLECLUE SYNTHETIC"))
            throw new Error("Invalid fixture");
        },
        {
          pdfBase64: parameters.pdfBase64,
          marker: parameters.marker,
          bucketHost: parameters.bucketHost,
        },
      );
      observerInstalled = true;
      await page.waitForFunction(
        (marker) => {
          const textarea = document.querySelector(
            'textarea[aria-label="Resume text"]',
          );
          return (
            Boolean(textarea?.value.includes(marker)) ||
            Boolean(document.querySelector(".notice.error"))
          );
        },
        parameters.marker,
        { timeout: 150_000 },
      );
      const evidence = await page.evaluate((marker) => {
        const state = window.__roleclueBrowserSmoke;
        return {
          extracted: Boolean(
            document
              .querySelector('textarea[aria-label="Resume text"]')
              ?.value.includes(marker),
          ),
          presign: state?.presign,
          s3Put: state?.s3Put,
          finalize: state?.finalize,
          inline: state?.inline,
          failed: state?.failed,
        };
      }, parameters.marker);
      if (
        !evidence.extracted ||
        evidence.presign !== 1 ||
        evidence.s3Put !== 1 ||
        evidence.finalize !== 1 ||
        evidence.inline !== 0 ||
        evidence.failed
      )
        throw new Error("Incomplete browser upload evidence");
      stage = "synthetic extraction screenshot";
      await page.screenshot({ path: parameters.screenshot, fullPage: true });
      outcome = {
        passed: true,
        stage:
          "normal UI sign-in, consent, real browser S3 PUT/CORS and extracted text",
        screenshot: parameters.screenshot,
      };
    }
  } catch {
    outcome = { passed: false, stage };
  } finally {
    if (page && parameters.phase !== "preflight") {
      try {
        if (new URL(await page.url()).origin === parameters.siteUrl) {
          if (observerInstalled)
            await page.evaluate(() => window.__roleclueBrowserSmoke?.restore());
          const state = await page.evaluate((email) => {
            const session = JSON.parse(
              sessionStorage.getItem("roleclue.session.v1") || "null",
            );
            return {
              ownSession: session?.email === email,
              ownForm:
                document.querySelector('input[type="email"]')?.value === email,
            };
          }, parameters.email);
          if (state.ownSession) {
            await page.click('button[aria-label="Sign out"]');
            await page.waitForSelector('input[type="password"]', {
              state: "visible",
              timeout: 30_000,
            });
          } else if (state.ownForm) {
            await page.fill('input[type="password"]', "");
            await page.fill('input[type="email"]', "");
          }
          const sessionGone = await page.evaluate((email) => {
            const session = JSON.parse(
              sessionStorage.getItem("roleclue.session.v1") || "null",
            );
            return session?.email !== email;
          }, parameters.email);
          if (!sessionGone) throw new Error("Sign-out incomplete");
        }
      } catch {
        outcome = { passed: false, stage: "synthetic browser session cleanup" };
      }
    }
  }
  // This is the only child output consumed by the parent. No credentials,
  // tokens, URLs with signatures, request bodies, snapshots or errors escape.
  console.log(parameters.receiptPrefix + JSON.stringify(outcome));
}

export function browserProgram(parameters) {
  return `await (${browserRound.toString()})(${JSON.stringify(parameters)});\n`;
}

async function runBrowser(parameters, control) {
  const receiptPrefix = `ROLECLUE_SAFE_RECEIPT_${randomUUID()}:`;
  const program = browserProgram({ ...parameters, receiptPrefix });
  return new Promise((resolveResult, reject) => {
    const child = spawn("ego-browser", ["nodejs"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      finished = false;
    control.browserChild = child;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      control.browserChild = null;
      error ? reject(error) : resolveResult(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        new SmokeCheckError(
          "Browser round timed out; no raw browser output was logged",
        ),
      );
    }, 270_000);
    child.on("error", () =>
      finish(new SmokeCheckError("ego-browser could not start")),
    );
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 2 * 1024 * 1024) {
        child.kill("SIGTERM");
        finish(new SmokeCheckError("Browser output exceeded its safe limit"));
      }
    });
    child.stderr.on("data", () => {}); // Never echo CLI diagnostics or source.
    child.on("close", (code) => {
      if (code !== 0)
        return finish(
          new SmokeCheckError(
            "Browser round stopped; no raw browser output was logged",
          ),
        );
      try {
        const lines = stdout
          .split(/\r?\n/)
          .filter((line) => line.startsWith(receiptPrefix));
        check(lines.length === 1, "Browser receipt was missing or ambiguous");
        const receipt = JSON.parse(lines[0].slice(receiptPrefix.length));
        check(
          typeof receipt.passed === "boolean" &&
            typeof receipt.stage === "string",
          "Invalid browser receipt",
        );
        finish(null, receipt);
      } catch {
        finish(
          new SmokeCheckError(
            "Browser did not return a safe acceptance receipt",
          ),
        );
      }
    });
    child.stdin.end(program);
  });
}

export async function runBrowserSmoke(env = process.env) {
  check(
    env.ROLECLUE_RUN_BROWSER_SMOKE === "1",
    "Refusing cloud/browser writes: set ROLECLUE_RUN_BROWSER_SMOKE=1 explicitly",
  );
  check(
    !env.AWS_REGION || env.AWS_REGION === REGION,
    "Browser smoke region must be ap-southeast-2",
  );
  const stackName = env.ROLECLUE_STACK_NAME || "roleclue-member-app";
  check(
    /^roleclue-member-app(?:-[a-z0-9-]+)?$/.test(stackName),
    "Only the RoleClue member-app stack is in scope",
  );
  const aws = createAws(env.AWS_PROFILE || "proairesis-management");
  const caller = await aws("sts", "get-caller-identity");
  check(
    caller.Account === ACCOUNT,
    "AWS company account mismatch; nothing was changed",
  );
  const stack = (
    await aws("cloudformation", "describe-stacks", { StackName: stackName })
  ).Stacks?.[0];
  check(
    stack?.StackId?.startsWith(
      `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${stackName}/`,
    ),
    "Stack account or region mismatch",
  );
  check(
    ["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.StackStatus),
    "Stack is not in a completed state",
  );
  const outputs = Object.fromEntries(
    (stack.Outputs ?? []).map((item) => [item.OutputKey, item.OutputValue]),
  );
  for (const key of [
    "SiteUrl",
    "ApiUrl",
    "CognitoUserPoolId",
    "CognitoClientId",
    "FunctionName",
    "TableName",
    "ResumeBucket",
    "DistributionId",
  ]) {
    check(outputs[key], `Stack output ${key} is missing`);
  }
  check(
    outputs.SiteUrl === `https://${HOSTNAME}`,
    "Unexpected production website; browser was not touched",
  );
  const siteUrl = outputs.SiteUrl;
  const api = new URL(outputs.ApiUrl);
  check(
    api.protocol === "https:" &&
      !api.username &&
      !api.password &&
      !api.port &&
      /^[a-z0-9]+\.execute-api\.ap-southeast-2\.amazonaws\.com$/.test(
        api.hostname,
      ) &&
      api.pathname === "/" &&
      !api.search &&
      !api.hash,
    "Unexpected API origin",
  );
  const config = await aws("lambda", "get-function-configuration", {
    FunctionName: outputs.FunctionName,
  });
  check(
    config.FunctionArn?.startsWith(
      `arn:aws:lambda:${REGION}:${ACCOUNT}:function:`,
    ),
    "Lambda account mismatch",
  );
  const variables = config.Environment?.Variables ?? {};
  check(
    variables.TABLE_NAME === outputs.TableName &&
      variables.RESUME_BUCKET === outputs.ResumeBucket &&
      variables.COGNITO_USER_POOL_ID === outputs.CognitoUserPoolId &&
      variables.SITE_URL === siteUrl,
    "Lambda resource outputs mismatch",
  );
  check(
    Boolean(variables.STRIPE_PRICE_ID) &&
      Boolean(variables.STRIPE_STARTER_PRICE_ID) &&
      Number(variables.OPENAI_DAILY_CALL_LIMIT) > 0 &&
      Number(variables.OPENAI_DAILY_TOKEN_LIMIT) > 0 &&
      variables.FREEHIRE_ENABLED === "true" &&
      variables.FREEHIRE_LICENSE_APPROVED === "true" &&
      Boolean(variables.GENERATION_QUEUE_URL) &&
      variables.ROLECLUE_LOCAL_DEMO !== "1",
    "Production billing, AI, job search and generation queue must be configured",
  );
  const pool = (
    await aws("cognito-idp", "describe-user-pool", {
      UserPoolId: outputs.CognitoUserPoolId,
    })
  ).UserPool;
  check(
    pool?.Arn ===
      `arn:aws:cognito-idp:${REGION}:${ACCOUNT}:userpool/${outputs.CognitoUserPoolId}`,
    "Cognito account mismatch",
  );
  check(
    Object.keys(pool.LambdaConfig ?? {}).length === 0,
    "Unexpected Cognito triggers; no account created",
  );
  const client = (
    await aws("cognito-idp", "describe-user-pool-client", {
      UserPoolId: outputs.CognitoUserPoolId,
      ClientId: outputs.CognitoClientId,
    })
  ).UserPoolClient;
  check(
    client?.UserPoolId === outputs.CognitoUserPoolId &&
      !client.ClientSecret &&
      client.ExplicitAuthFlows?.includes("ALLOW_USER_PASSWORD_AUTH"),
    "Unexpected Cognito app client",
  );
  const distribution = (
    await aws("cloudfront", "get-distribution", { Id: outputs.DistributionId })
  ).Distribution;
  check(
    distribution?.ARN ===
      `arn:aws:cloudfront::${ACCOUNT}:distribution/${outputs.DistributionId}` &&
      distribution.Status === "Deployed" &&
      distribution.DistributionConfig?.Enabled === true &&
      distribution.DistributionConfig.Aliases?.Items?.includes(HOSTNAME),
    "Production CloudFront target is not deployed",
  );
  check(
    /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(outputs.ResumeBucket),
    "Unexpected resume bucket",
  );
  const table = (
    await aws("dynamodb", "describe-table", { TableName: outputs.TableName })
  ).Table;
  check(
    table?.TableArn ===
      `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${outputs.TableName}`,
    "DynamoDB account mismatch",
  );
  await aws("s3api", "head-bucket", {
    Bucket: outputs.ResumeBucket,
    ExpectedBucketOwner: ACCOUNT,
  });
  const publicConfigResponse = await fetch(`${siteUrl}/config.json`, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const publicConfig = await boundedJson(publicConfigResponse);
  check(
    publicConfigResponse.ok &&
      publicConfig.mode === "production" &&
      publicConfig.cognitoRegion === REGION &&
      publicConfig.cognitoClientId === outputs.CognitoClientId &&
      !publicConfig.apiBaseUrl &&
      publicConfig.capabilities?.recommendations === true &&
      publicConfig.capabilities?.guestDiscovery === true &&
      publicConfig.capabilities?.coverLetters === true &&
      publicConfig.capabilities?.billing === true &&
      publicConfig.betaNotice,
    "Deployed browser configuration does not match this stack",
  );
  report(
    "company account, completed stack, production browser target and enabled production capabilities verified",
  );

  // Use the application's public same-origin API, not direct database writes.
  const request = async (method, path, body, token) => {
    const response = await fetch(new URL(path, siteUrl), {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(35_000),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await boundedJson(response) };
  };
  const control = { stopped: false, browserChild: null };
  const stop = () => {
    control.stopped = true;
    control.browserChild?.kill("SIGTERM");
  };
  const checkContinue = () =>
    check(
      !control.stopped,
      "Smoke interrupted; synthetic cleanup still required",
    );
  const identity = {
    email: `roleclue-browser-smoke-${randomUUID()}@invalid.example`,
    password: `Rc9${randomBytes(27).toString("base64url")}`,
  };
  let attemptedIdentity = false,
    browserAttempted = false,
    testError,
    cleanupError;
  const identify = async () => {
    const user = await aws("cognito-idp", "admin-get-user", {
      UserPoolId: outputs.CognitoUserPoolId,
      Username: identity.email,
    });
    const attributes = Object.fromEntries(
      (user.UserAttributes ?? []).map((item) => [item.Name, item.Value]),
    );
    check(
      attributes.email === identity.email &&
        /^[a-f0-9-]{36}$/i.test(attributes.sub ?? ""),
      "Synthetic identity attributes mismatch",
    );
    identity.sub = attributes.sub;
    identity.username = user.Username;
  };
  const setPassword = () =>
    aws("cognito-idp", "admin-set-user-password", {
      UserPoolId: outputs.CognitoUserPoolId,
      Username: identity.email,
      Password: identity.password,
      Permanent: true,
    });
  const authenticateForCleanup = async () => {
    const response = await fetch(
      `https://cognito-idp.${REGION}.amazonaws.com/`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
        },
        body: JSON.stringify({
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: outputs.CognitoClientId,
          AuthParameters: {
            USERNAME: identity.email,
            PASSWORD: identity.password,
          },
        }),
      },
    );
    const result = await boundedJson(response);
    check(
      response.ok && result.AuthenticationResult?.IdToken,
      "Synthetic cleanup sign-in failed",
    );
    identity.token = result.AuthenticationResult.IdToken;
    const claims = JSON.parse(
      Buffer.from(identity.token.split(".")[1], "base64url").toString("utf8"),
    );
    check(
      claims.sub === identity.sub &&
        claims.email === identity.email &&
        claims.email_verified === true &&
        claims.exp * 1000 > Date.now() + 20 * 60 * 1000,
      "Synthetic cleanup token claims mismatch or lifetime too short",
    );
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    checkContinue();
    const preflight = await runBrowser(
      { phase: "preflight", siteUrl },
      control,
    );
    check(
      preflight.passed,
      "Existing TaskSpace 82/p1 must be agent-owned and signed out; nothing was created",
    );
    const health = await request("GET", "/api/health");
    check(
      health.status === 200 &&
        health.body.ok &&
        health.body.mode === "production",
      "Production API health failed",
    );
    checkContinue();
    // Record before create so a lost response after Cognito commits still reaches cleanup.
    attemptedIdentity = true;
    await aws("cognito-idp", "admin-create-user", {
      UserPoolId: outputs.CognitoUserPoolId,
      Username: identity.email,
      TemporaryPassword: identity.password,
      MessageAction: "SUPPRESS",
      UserAttributes: [
        { Name: "email", Value: identity.email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: "RoleClue Synthetic Browser Smoke" },
      ],
    });
    await identify();
    await setPassword();
    // This token is exclusively for cleanup and durable API assertions. The
    // browser must independently authenticate through the ordinary UI.
    await authenticateForCleanup();
    checkContinue();
    const marker = `ROLECLUE SYNTHETIC BROWSER ${randomUUID().toUpperCase()}`;
    const screenshot = resolve(
      tmpdir(),
      `roleclue-browser-smoke-${randomUUID()}.png`,
    );
    browserAttempted = true;
    const browser = await runBrowser(
      {
        phase: "upload",
        siteUrl,
        email: identity.email,
        password: identity.password,
        marker,
        pdfBase64: syntheticResumePdf(marker).toString("base64"),
        bucketHost: `${outputs.ResumeBucket}.s3.${REGION}.amazonaws.com`,
        screenshot,
      },
      control,
    );
    if (!browser.passed) report(browser.stage, "FAILED");
    check(
      browser.passed && browser.screenshot === screenshot,
      "Browser sign-in/upload/extraction or scoped sign-out failed",
    );
    report(
      "normal UI sign-in, consent, actual S3 PUT/CORS and visible extracted text",
      "passed",
      screenshot,
    );
    const saved = await request("GET", "/api/me", undefined, identity.token);
    check(
      saved.status === 200 &&
        saved.body.profile?.email === identity.email &&
        saved.body.profile.resumeText?.includes(marker) &&
        saved.body.profile.confirmed === false,
      "Browser-extracted resume was not durably saved to the synthetic profile",
    );
    report("browser extraction persisted in the correct synthetic account");
    checkContinue();
  } catch (error) {
    testError = error;
  } finally {
    if (attemptedIdentity) {
      try {
        let exists = true;
        if (!identity.sub) {
          try {
            await identify();
          } catch (error) {
            if (error.code === "UserNotFoundException") exists = false;
            else throw error;
          }
        }
        if (exists) {
          if (!identity.token) {
            await setPassword();
            await authenticateForCleanup();
          }
          // Conservative lower bound after the browser round, including a failed
          // round. The server's exact activeGrantUntil is also re-read; late
          // requests cannot shorten the signed-link + two-minute grace period.
          let notBefore = browserAttempted
            ? Date.now() + UPLOAD_EXPIRY_AND_GRACE_MS
            : Date.now();
          const deadline = Date.now() + 15 * 60 * 1000;
          if (browserAttempted)
            report(
              "waiting for five-minute signed upload expiry plus two-minute grace",
              "pending",
            );
          for (;;) {
            check(
              Date.now() < deadline,
              "Synthetic cleanup wait exceeded its deadline",
            );
            const uploadState = await aws("dynamodb", "get-item", {
              TableName: outputs.TableName,
              ConsistentRead: true,
              Key: {
                pk: { S: `USER#${identity.sub}` },
                sk: { S: "UPLOAD_STATE" },
              },
              ProjectionExpression: "#v.activeGrantUntil",
              ExpressionAttributeNames: { "#v": "value" },
            });
            const activeUntil = Number(
              uploadState.Item?.value?.M?.activeGrantUntil?.N || 0,
            );
            check(
              Number.isFinite(activeUntil),
              "Upload grant expiry was invalid",
            );
            notBefore = Math.max(
              notBefore,
              activeUntil + (activeUntil ? 1000 : 0),
            );
            if (Date.now() >= notBefore) break;
            await sleep(Math.min(MAX_POLL_MS, notBefore - Date.now()));
          }
          let acknowledged = false;
          for (let attempt = 0; attempt < 6 && !acknowledged; attempt++) {
            try {
              const deletion = await request(
                "DELETE",
                "/api/account",
                { confirmation: "DELETE" },
                identity.token,
              );
              if (
                deletion.status === 409 &&
                deletion.body.error?.code === "UPLOAD_GRANT_ACTIVE"
              ) {
                await sleep(MAX_POLL_MS);
                continue;
              }
              check(
                deletion.status === 200 && deletion.body.deleted === true,
                "Synthetic account deletion was not acknowledged",
              );
              acknowledged = true;
            } catch (error) {
              if (attempt === 5) throw error;
              await sleep(MAX_POLL_MS);
            }
          }
          check(acknowledged, "Synthetic account deletion did not complete");
          const oldToken = await request(
            "GET",
            "/api/me",
            undefined,
            identity.token,
          );
          check(
            oldToken.status === 401 &&
              oldToken.body.error?.code === "ACCOUNT_DELETED",
            "Deleted-account token was not rejected by the tombstone guard",
          );
          let missing = false;
          try {
            await aws("cognito-idp", "admin-get-user", {
              UserPoolId: outputs.CognitoUserPoolId,
              Username: identity.username,
            });
          } catch (error) {
            if (error.code === "UserNotFoundException") missing = true;
            else throw error;
          }
          check(missing, "Synthetic Cognito identity remains after deletion");
          const records = await aws("dynamodb", "query", {
            TableName: outputs.TableName,
            ConsistentRead: true,
            Select: "COUNT",
            KeyConditionExpression: "pk = :pk",
            ExpressionAttributeValues: { ":pk": { S: `USER#${identity.sub}` } },
          });
          check(
            records.Count === 0 && !records.LastEvaluatedKey,
            "Synthetic user records remain after deletion",
          );
          for (const prefix of [
            `users/${encodeURIComponent(identity.sub)}/`,
            `pending/${encodeURIComponent(identity.sub)}/`,
          ]) {
            const objects = await aws("s3api", "list-objects-v2", {
              Bucket: outputs.ResumeBucket,
              ExpectedBucketOwner: ACCOUNT,
              Prefix: prefix,
              MaxKeys: 1,
            });
            check(
              (objects.KeyCount ?? 0) === 0 &&
                !objects.Contents?.length &&
                !objects.IsTruncated,
              "Synthetic resume objects remain after deletion",
            );
          }
          report(
            "synthetic account deleted; old token rejected; Cognito identity, user records and resume objects absent",
          );
        } else report("failed creation left no synthetic Cognito identity");
      } catch (error) {
        cleanupError = error;
        report(
          "synthetic cleanup",
          "FAILED: operator follow-up required; deployment acceptance must not pass",
        );
      }
    }
    identity.password = undefined;
    identity.token = undefined;
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  if (cleanupError)
    throw new SmokeCheckError(
      "Synthetic cleanup incomplete. Inspect the suppressed roleclue-browser-smoke account in this verified stack; no direct-delete fallback was used.",
    );
  if (testError) throw testError;
  check(
    !control.stopped,
    "Smoke interrupted; synthetic cleanup completed, acceptance was not marked passed",
  );
  report(
    "browser signed-upload acceptance complete; existing browser space left open; only synthetic screenshot and non-PII deletion hash retained",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runBrowserSmoke().catch((error) => {
    console.error(
      JSON.stringify({
        result: "FAILED",
        message:
          error instanceof SmokeCheckError
            ? error.message
            : "Browser acceptance failed; inspect safe stage reports. No credentials or request bodies were logged.",
      }),
    );
    process.exitCode = 1;
  });
}
