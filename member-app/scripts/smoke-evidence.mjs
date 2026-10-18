import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;

function codeSha256Hex(value) {
  if (typeof value !== "string") return "";
  const bytes = Buffer.from(value, "base64");
  return bytes.length === 32 ? bytes.toString("hex") : "";
}

async function boundedJson(response, check) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    check(size <= 64 * 1024, "Release manifest exceeded its size limit");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    check(false, "Release manifest was not valid JSON");
  }
}

export async function verifyLiveRelease({
  aws,
  outputs,
  siteUrl,
  check,
  fetchImpl = fetch,
}) {
  for (const key of ["FunctionVersion", "FunctionAliasArn"])
    check(outputs[key], `Stack output ${key} is missing`);
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
  const manifest = await boundedJson(releaseResponse, check);
  check(manifest?.version === 3, "Deployed release manifest version is invalid");
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
  check(
    typeof configuration.Description === "string" &&
      configuration.Description.includes(`RoleClue release ${manifest.releaseId}`) &&
      configuration.Description.includes("origin-gate-true"),
    "Live Lambda version is not the protected release described by the manifest",
  );
  return { manifest, alias, configuration };
}

export async function writeSmokeEvidence(name, evidence) {
  if (!new Set(["cloud-smoke", "browser-smoke"]).has(name))
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
