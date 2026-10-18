import { captureSessionGuard, getToken } from "./auth.js";

const MAX_COLLECTION_PAGES = 1000;
const MAX_COLLECTION_BYTES = 128 * 1024 * 1024;

export async function refreshBillingStatus(
  api,
  { assertCurrent = () => {}, onBilling = () => {} } = {},
) {
  const assertSession = captureSessionGuard();
  const check = () => {
    assertSession();
    assertCurrent();
  };
  check();
  const result = await api("/billing/refresh", { method: "POST" });
  check();
  const billing = result?.billing;
  if (
    !["free", "starter", "monthly"].includes(billing?.plan) ||
    ![billing.used, billing.limit, billing.remaining].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    typeof billing.canGenerate !== "boolean"
  ) {
    throw new Error(
      "The billing status could not be verified. Your previous allowance is unchanged. Please try again.",
    );
  }
  onBilling(billing);
  return billing;
}

export async function saveOpportunityDecision(
  api,
  id,
  decision,
  { onSaved = () => {}, reload, assertCurrent = () => {} },
) {
  const assertSession = captureSessionGuard();
  const check = () => {
    assertSession();
    assertCurrent();
  };
  check();
  const result = await api(`/opportunities/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: { decision },
  });
  check();
  onSaved(result);
  await reload();
  check();
  return result;
}

function incompleteCollection(message) {
  const error = new Error(message);
  error.code = "INCOMPLETE_COLLECTION";
  return error;
}

async function readCollectionPages(
  api,
  path,
  consume,
  assertCurrent = () => {},
) {
  const assertSession = captureSessionGuard();
  const check = () => {
    assertSession();
    assertCurrent();
  };
  const cursors = new Set();
  let cursor = null,
    bytes = 0;
  for (let pageNumber = 0; pageNumber < MAX_COLLECTION_PAGES; pageNumber++) {
    check();
    const page = await api(
      cursor === null ? path : `${path}?cursor=${encodeURIComponent(cursor)}`,
    );
    check();
    if (
      !page ||
      typeof page !== "object" ||
      Array.isArray(page) ||
      !(
        page.nextCursor === null ||
        (typeof page.nextCursor === "string" &&
          page.nextCursor.length > 0 &&
          page.nextCursor.length <= 16384)
      )
    ) {
      throw incompleteCollection(
        "The complete result could not be verified. Reload and try again.",
      );
    }
    bytes += new TextEncoder().encode(JSON.stringify(page)).byteLength;
    if (bytes > MAX_COLLECTION_BYTES) {
      throw incompleteCollection(
        "This account is too large to load safely in one browser request. No partial result was used. Contact support for help.",
      );
    }
    consume(page);
    if (page.nextCursor === null) {
      check();
      return;
    }
    if (cursors.has(page.nextCursor)) {
      throw incompleteCollection(
        "The complete result could not be loaded because a page repeated. Try again.",
      );
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw incompleteCollection(
    "The account exceeded the safe page limit. No partial result was used. Contact support for help.",
  );
}

export async function loadAllApplications(api, { assertCurrent } = {}) {
  const applications = new Map();
  const letterIndexes = new Map();
  await readCollectionPages(
    api,
    "/applications",
    (page) => {
      if (!Array.isArray(page.applications))
        throw incompleteCollection(
          "An application page was incomplete. Please retry loading applications.",
        );
      for (const application of page.applications) {
        if (
          !application ||
          typeof application.id !== "string" ||
          !application.id ||
          !Array.isArray(application.letters)
        ) {
          throw incompleteCollection(
            "An application page was incomplete. Please retry loading applications.",
          );
        }
        const letters = letterIndexes.get(application.id) || new Map();
        for (const letter of application.letters) {
          if (!letter || typeof letter.id !== "string" || !letter.id)
            throw incompleteCollection(
              "A saved draft could not be read completely. Please retry loading applications.",
            );
          letters.set(letter.id, letter);
        }
        letterIndexes.set(application.id, letters);
        applications.set(application.id, {
          ...application,
          letters: [...letters.values()],
        });
      }
    },
    assertCurrent,
  );
  return { applications: [...applications.values()] };
}

export async function loadAccountExport(api, { assertCurrent } = {}) {
  const records = [];
  let exportedAt;
  await readCollectionPages(
    api,
    "/export",
    (page) => {
      if (
        page.schemaVersion !== 1 ||
        typeof page.exportedAt !== "string" ||
        !Number.isFinite(Date.parse(page.exportedAt)) ||
        !Array.isArray(page.records)
      ) {
        throw incompleteCollection(
          "An export page was incomplete. No file was downloaded. Please try again.",
        );
      }
      if (exportedAt && exportedAt !== page.exportedAt)
        throw incompleteCollection(
          "The export changed while it was loading. No file was downloaded. Please try again.",
        );
      exportedAt = page.exportedAt;
      for (const record of page.records) {
        if (
          !record ||
          typeof record.type !== "string" ||
          !Object.hasOwn(record, "value")
        )
          throw incompleteCollection(
            "An export record was incomplete. No file was downloaded. Please try again.",
          );
        records.push(record);
      }
    },
    assertCurrent,
  );
  return { schemaVersion: 1, exportedAt, records };
}

export async function loadConfig() {
  const response = await fetch("/config.json", {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      "RoleClue configuration is unavailable. Please reload in a moment.",
    );
  const config = await response.json();
  if (!["demo", "production", "staging", "live"].includes(config.mode))
    throw new Error("RoleClue is not configured for this environment.");
  if (
    config.mode === "demo" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
  )
    throw new Error("Synthetic demo mode is available only on this computer.");
  return config;
}

export function createApi(config) {
  return async function api(
    path,
    { method = "GET", body, idempotencyKey } = {},
  ) {
    const token = await getToken(config);
    let response, result;
    try {
      response = await fetch(
        `${(config.apiBaseUrl || "").replace(/\/$/, "")}/api${path}`,
        {
          method,
          signal: AbortSignal.timeout(45000),
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            ...(body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        },
      );
      result = await response.json();
    } catch (cause) {
      const timedOut =
        cause.name === "TimeoutError" || cause.name === "AbortError";
      const error = new Error(
        timedOut
          ? "This request took too long. Please try again. A cover-letter retry will check the same request without using an extra credit."
          : "Could not connect. Check your connection and try again.",
      );
      error.code = timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR";
      throw error;
    }
    if (!response.ok) {
      const error = new Error(
        result.error?.message ||
          "We could not complete this request. Please try again.",
      );
      error.code = result.error?.code;
      error.requestId = result.error?.requestId;
      error.status = response.status;
      throw error;
    }
    return { ...result, httpStatus: response.status };
  };
}

export function createGuestApi(config) {
  return async function guestApi(path, body = {}) {
    let response, result;
    try {
      response = await fetch(
        `${(config.apiBaseUrl || "").replace(/\/$/, "")}/api${path}`,
        {
          method: "POST",
          signal: AbortSignal.timeout(path === "/guest/search" ? 60000 : 45000),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      result = await response.json();
    } catch (cause) {
      const timedOut =
        cause.name === "TimeoutError" || cause.name === "AbortError";
      const error = new Error(
        timedOut
          ? "This step took too long. Your progress is safe; please try again."
          : "Could not connect. Check your connection and try again.",
      );
      error.code = timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR";
      throw error;
    }
    if (!response.ok) {
      const error = new Error(
        result?.error?.message ||
          "We could not complete this step. Please try again.",
      );
      error.code = result?.error?.code;
      error.requestId = result?.error?.requestId;
      error.status = response.status;
      throw error;
    }
    return { ...result, httpStatus: response.status };
  };
}

export async function fileToBase64(file, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader.onload = reader.onerror = reader.onabort = null;
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      finish(new Error("Your browser took too long to read that file. Try again."));
      if (reader.readyState === FileReader.LOADING) reader.abort();
    }, timeoutMs);
    reader.onload = () => {
      const encoded = String(reader.result).split(",")[1];
      finish(
        encoded ? null : new Error("Could not read that file. Choose another resume."),
        encoded,
      );
    };
    reader.onerror = () =>
      finish(new Error("Your browser could not read that file. Try another resume."));
    reader.onabort = () =>
      finish(new Error("Reading the file was interrupted. Choose it again."));
    try {
      reader.readAsDataURL(file);
    } catch {
      finish(new Error("Your browser could not open that file."));
    }
  });
}

export function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function downloadText(text, filename, contentType = "text/plain") {
  const url = URL.createObjectURL(
    new Blob([text], { type: `${contentType};charset=utf-8` }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function uploadResume(api, config, file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["pdf", "docx"].includes(extension))
    throw new Error("Choose a PDF or DOCX resume.");
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Your resume must be 5 MB or smaller.");
  if (!file.size) throw new Error("That file is empty. Choose another resume.");
  const contentType =
    extension === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (config.mode === "demo") {
    const dataBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reader.onload = reader.onerror = reader.onabort = null;
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        finish(
          new Error(
            "Your browser could not read this file within 15 seconds. Check that the file is downloaded to this computer, then choose it again or try another PDF or DOCX.",
          ),
        );
        if (reader.readyState === FileReader.LOADING) reader.abort();
      }, 15000);
      reader.onload = () => {
        const encoded = String(reader.result).split(",")[1];
        if (!encoded)
          finish(
            new Error(
              "Could not read that file. Please choose another resume.",
            ),
          );
        else finish(null, encoded);
      };
      reader.onerror = () =>
        finish(
          new Error(
            "Your browser could not read this file. Check that it is available on this computer, then choose it again.",
          ),
        );
      reader.onabort = () =>
        finish(
          new Error(
            "Reading the file was interrupted. Please choose your resume again.",
          ),
        );
      try {
        reader.readAsDataURL(file);
      } catch {
        finish(
          new Error(
            "Your browser could not open this file. Please choose it again or try another resume.",
          ),
        );
      }
    });
    return api("/resume", {
      method: "POST",
      body: { filename: file.name, contentType, dataBase64, consent: true },
    });
  }
  const upload = await api("/resume/upload", {
    method: "POST",
    body: { filename: file.name, contentType, size: file.size, consent: true },
  });
  const url = safeExternalUrl(upload.uploadUrl);
  if (!url)
    throw new Error(
      "The secure upload could not be prepared. Please try again.",
    );
  let response;
  try {
    response = await fetch(url, {
      method: "PUT",
      body: file,
      signal: AbortSignal.timeout(60000),
      headers: upload.headers || { "Content-Type": contentType },
    });
  } catch (cause) {
    throw new Error(
      cause.name === "TimeoutError" || cause.name === "AbortError"
        ? "The secure upload took too long. Check your connection and that the file is downloaded to this computer, then choose your resume again."
        : "The secure upload could not finish. Check your connection and choose your resume again.",
    );
  }
  if (!response.ok)
    throw new Error("Your resume could not be uploaded. Please try again.");
  return api("/resume/finalize", {
    method: "POST",
    body: { uploadId: upload.uploadId },
  });
}
