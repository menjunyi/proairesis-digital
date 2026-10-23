import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isMutableSiteCacheControl } from "./site-cache-policy.mjs";

const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const MANIFEST_KEYS = [
  "createdAt",
  "indexSha256",
  "lambdaSha256",
  "mode",
  "releaseId",
  "siteContentSha256",
  "sourceRevision",
  "templateSha256",
  "version",
];

function codeSha256Hex(value) {
  if (typeof value !== "string") return "";
  const bytes = Buffer.from(value, "base64");
  return bytes.length === 32 ? bytes.toString("hex") : "";
}

async function boundedBody(response, check, maximumBytes, label) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    check(size <= maximumBytes, `${label} exceeded its size limit`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function boundedJson(response, check) {
  const bytes = await boundedBody(response, check, 64 * 1024, "Release manifest");
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    check(false, "Release manifest was not valid JSON");
  }
}

export function canonicalReleaseId(manifest) {
  return createHash("sha256").update(JSON.stringify({
    sourceRevision: manifest.sourceRevision,
    lambdaSha256: manifest.lambdaSha256,
    siteContentSha256: manifest.siteContentSha256,
    templateSha256: manifest.templateSha256,
  })).digest("hex");
}

export async function verifyLiveRelease({
  aws,
  outputs,
  siteUrl,
  check,
  expectedReleaseId,
  expectedSourceRevision,
  fetchImpl = fetch,
}) {
  for (const key of ["FunctionName", "FunctionVersion", "FunctionAliasArn", "SiteArtifactVersion", "SiteArtifactSha256"])
    check(outputs[key], `Stack output ${key} is missing`);
  check(HEX_64.test(expectedReleaseId ?? ""), "Stack release parameter is invalid");
  if (expectedSourceRevision !== undefined)
    check(HEX_40.test(expectedSourceRevision), "Expected source revision is invalid");
  check(/^\d+$/.test(outputs.FunctionVersion), "Stack function version is invalid");
  check(
    outputs.FunctionAliasArn ===
      `arn:aws:lambda:ap-southeast-2:037169690315:function:${outputs.FunctionName}:live`,
    "Stack live alias ARN is invalid",
  );

  const releaseResponse = await fetchImpl(`${siteUrl}/release.json`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { "Cache-Control": "no-cache" },
  });
  check(releaseResponse.ok, "Deployed release manifest could not be read");
  check(
    releaseResponse.headers.get("x-amz-cf-id"),
    "Release manifest did not come through CloudFront",
  );
  check(
    isMutableSiteCacheControl(releaseResponse.headers.get("cache-control")),
    "Release manifest can remain stale in a browser",
  );
  const manifest = await boundedJson(releaseResponse, check);
  check(manifest?.version === 3, "Deployed release manifest version is invalid");
  check(
    Object.keys(manifest).sort().join(",") === MANIFEST_KEYS.slice().sort().join(","),
    "Deployed release manifest fields are not canonical",
  );
  check(manifest.mode === "production", "Deployed release is not production");
  check(HEX_64.test(manifest.releaseId ?? ""), "Deployed release ID is invalid");
  check(
    typeof manifest.createdAt === "string" &&
      Number.isFinite(Date.parse(manifest.createdAt)) &&
      new Date(manifest.createdAt).toISOString() === manifest.createdAt,
    "Deployed release timestamp is invalid",
  );
  check(
    HEX_40.test(manifest.sourceRevision ?? ""),
    "Deployed source revision is invalid",
  );
  check(
    HEX_64.test(manifest.lambdaSha256 ?? ""),
    "Deployed Lambda artifact hash is invalid",
  );
  for (const key of ["indexSha256", "siteContentSha256", "templateSha256"])
    check(HEX_64.test(manifest[key] ?? ""), `Deployed ${key} is invalid`);
  check(
    canonicalReleaseId(manifest) === manifest.releaseId,
    "Deployed release ID is not the canonical manifest digest",
  );
  check(
    manifest.releaseId === expectedReleaseId,
    "Deployed release manifest does not match the stack release parameter",
  );
  if (expectedSourceRevision !== undefined)
    check(
      manifest.sourceRevision === expectedSourceRevision,
      "Deployed source revision does not match the expected revision",
    );
  check(
    HEX_64.test(outputs.SiteArtifactSha256),
    "Stack site artifact hash is invalid",
  );
  const siteArtifactVersionToken = Buffer.from(outputs.SiteArtifactVersion, "utf8").toString("base64url");
  check(siteArtifactVersionToken && /^[A-Za-z0-9_-]+$/.test(siteArtifactVersionToken),
    "Stack site artifact version is invalid");

  const indexResponse = await fetchImpl(`${siteUrl}/index.html`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { "Cache-Control": "no-cache" },
  });
  check(indexResponse.ok, "Deployed frontend entry point could not be read");
  check(
    indexResponse.headers.get("x-amz-cf-id"),
    "Frontend entry point did not come through CloudFront",
  );
  check(
    isMutableSiteCacheControl(indexResponse.headers.get("cache-control")),
    "Frontend entry point can remain stale in a browser",
  );
  const indexBytes = await boundedBody(indexResponse, check, 2 * 1024 * 1024, "Frontend entry point");
  check(
    createHash("sha256").update(indexBytes).digest("hex") === manifest.indexSha256,
    "Deployed frontend entry point does not match the release manifest",
  );

  const configResponse = await fetchImpl(`${siteUrl}/config.json`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { "Cache-Control": "no-cache" },
  });
  check(configResponse.ok, "Deployed frontend configuration could not be read");
  check(
    configResponse.headers.get("x-amz-cf-id"),
    "Frontend configuration did not come through CloudFront",
  );
  check(
    isMutableSiteCacheControl(configResponse.headers.get("cache-control")),
    "Frontend configuration can remain stale in a browser",
  );
  if (configResponse.body) await configResponse.body.cancel();

  const alias = await aws("lambda", "get-alias", {
    FunctionName: outputs.FunctionName,
    Name: "live",
  });
  check(alias.Name === "live", "Resolved Lambda alias is not live");
  check(
    alias.AliasArn === outputs.FunctionAliasArn,
    "Resolved live alias does not match the stack output",
  );
  check(
    alias.FunctionVersion === outputs.FunctionVersion &&
      alias.FunctionVersion !== "$LATEST",
    "Live alias does not point to the stack release version",
  );
  check(
    alias.Description === `RoleClue production ${manifest.releaseId}`,
    "Live alias does not identify the deployed frontend release",
  );

  const configuration = await aws("lambda", "get-function-configuration", {
    FunctionName: outputs.FunctionName,
    Qualifier: "live",
  });
  check(
    configuration.Version === alias.FunctionVersion &&
      configuration.Version !== "$LATEST",
    "Lambda configuration was not read through the live alias",
  );
  check(
    codeSha256Hex(configuration.CodeSha256) === manifest.lambdaSha256,
    "Live Lambda code does not match the deployed release manifest",
  );
  const expectedDescription = `RoleClue release ${manifest.releaseId} origin-gate-true ` +
    `site-v-${siteArtifactVersionToken} site-sha-${outputs.SiteArtifactSha256}`;
  check(
    configuration.Description === expectedDescription,
    "Live Lambda version is not the protected release described by the manifest",
  );
  return { manifest, alias, configuration };
}

export async function writeSmokeEvidence(name, evidence) {
  if (!new Set(["cloud-smoke", "browser-smoke", "signup-smoke", "load-smoke"]).has(name))
    throw new Error("Unsupported smoke evidence name");
  const directory = resolve("build/evidence");
  await mkdir(directory, { recursive: true });
  const target = resolve(directory, `${name}.json`);
  const temporary = resolve(directory, `.${name}-${process.pid}-${randomUUID()}.json`);
  await writeFile(
    temporary,
    `${JSON.stringify({ version: 1, ...evidence }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  await rename(temporary, target);
  return target;
}
