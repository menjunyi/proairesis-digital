import test from "node:test";
import assert from "node:assert/strict";
import {
  capabilitiesFor,
  continuationRecovery,
  guestJourneyAvailable,
  memberRoute,
  mergeApplicationUpdate,
  mergeResumeUpload,
  opportunityLoadRequest,
  selectedApplicationId,
} from "../src/ui-state.js";
import {
  clearSession,
  getToken,
  readSession,
  signIn,
  signOut,
} from "../src/auth.js";

test("guest claim recovery retries only transient failures", () => {
  assert.equal(
    continuationRecovery({ code: "ACCOUNT_PROFILE_EXISTS", status: 409 }),
    "existing-profile",
  );
  for (const code of ["GUEST_SELECTION_INVALID", "PROFILE_OR_JOB_CHANGED"])
    assert.equal(continuationRecovery({ code, status: 409 }), "review-matches");
  for (const code of [
    "GUEST_SESSION_EXPIRED",
    "GUEST_ALREADY_RESOLVED",
    "GUEST_ALREADY_CLAIMED",
    "GUEST_CLAIM_INCOMPLETE",
  ])
    assert.equal(continuationRecovery({ code, status: 409 }), "restart");
  assert.equal(continuationRecovery({ code: "REQUEST_TIMEOUT" }), "retry");
  assert.equal(continuationRecovery({ status: 503 }), "retry");
  assert.equal(
    continuationRecovery({ code: "UNKNOWN_4XX", status: 400 }),
    "workspace",
  );
});

test("production capabilities are opt-in booleans and runtime outages override static flags", () => {
  assert.deepEqual(capabilitiesFor({ mode: "production" }), {
    recommendations: false,
    guestDiscovery: false,
    coverLetters: false,
    billing: false,
    jobImport: false,
  });
  assert.equal(
    capabilitiesFor({ mode: "production", capabilities: { billing: "true" } })
      .billing,
    false,
  );
  assert.deepEqual(
    capabilitiesFor(
      { mode: "production", capabilities: { coverLetters: true } },
      {
        coverLetters: false,
        jobImport: true,
      },
    ),
    {
      recommendations: false,
      guestDiscovery: false,
      coverLetters: false,
      billing: false,
      jobImport: true,
    },
  );
  assert.equal(
    capabilitiesFor({ mode: "production" }, { coverLetters: true })
      .coverLetters,
    true,
  );
  assert.equal(capabilitiesFor({ mode: "demo" }).coverLetters, true);
  assert.equal(
    capabilitiesFor({ mode: "demo" }, { coverLetters: false }).coverLetters,
    false,
  );
});

test("guest onboarding opens only when recommendations and guest discovery are public", () => {
  assert.equal(
    guestJourneyAvailable({
      mode: "production",
      capabilities: { recommendations: true, guestDiscovery: true },
    }),
    true,
  );
  assert.equal(
    guestJourneyAvailable({
      mode: "production",
      capabilities: { recommendations: true, guestDiscovery: false },
    }),
    false,
  );
  assert.equal(
    guestJourneyAvailable({
      mode: "production",
      capabilities: { recommendations: false, guestDiscovery: true },
    }),
    false,
  );
  assert.equal(guestJourneyAvailable({ mode: "demo" }), true);
});

test("opportunity refresh planning uses POST for the initial and explicit selected refreshes", () => {
  assert.deepEqual(
    opportunityLoadRequest("selected", {
      recommendations: true,
      initial: true,
      selectedLoaded: false,
    }),
    {
      path: "/opportunities/refresh",
      options: { method: "POST" },
    },
  );
  assert.deepEqual(
    opportunityLoadRequest("selected", {
      recommendations: true,
      initial: true,
      selectedLoaded: true,
    }),
    { path: "/opportunities" },
  );
  assert.deepEqual(
    opportunityLoadRequest("selected", {
      recommendations: true,
      refresh: true,
      selectedLoaded: true,
    }),
    {
      path: "/opportunities/refresh",
      options: { method: "POST" },
    },
  );
  assert.deepEqual(
    opportunityLoadRequest("selected", {
      recommendations: false,
      refresh: true,
    }),
    { path: "/opportunities" },
  );
  assert.deepEqual(
    opportunityLoadRequest("ignored", {
      recommendations: true,
      refresh: true,
    }),
    { path: "/ignored" },
  );
});

test("account remains accessible before onboarding while job workflows require a reviewed profile", () => {
  assert.equal(memberRoute("account", true), "account");
  assert.equal(memberRoute("opportunities", true), "profile");
  assert.equal(memberRoute("applications", true), "profile");
  assert.equal(memberRoute("applications", false), "applications");
  assert.equal(memberRoute("unknown", false), "opportunities");
});

test("metadata-only application updates preserve the selected letter and editor evidence", () => {
  const selectedLetterId = "synthetic-draft";
  const letter = { id: selectedLetterId, text: "Saved synthetic draft" };
  const application = {
    id: "synthetic-role",
    status: "interested",
    notes: "",
    letters: [letter],
    job: {
      title: "Synthetic role",
      availability: "unknown",
      availabilityMessage: "Check the source",
    },
  };
  const statusUpdate = mergeApplicationUpdate(application, {
    id: application.id,
    status: "preparing",
    job: { title: application.job.title },
  });
  const notesUpdate = mergeApplicationUpdate(statusUpdate, {
    id: application.id,
    notes: "Synthetic notes",
  });
  assert.equal(notesUpdate.id, application.id);
  assert.equal(notesUpdate.letters, application.letters);
  assert.equal(
    notesUpdate.letters.find((value) => value.id === selectedLetterId),
    letter,
  );
  assert.equal(
    notesUpdate.letters.find((value) => value.id === selectedLetterId).text,
    letter.text,
  );
  assert.equal(notesUpdate.status, "preparing");
  assert.equal(notesUpdate.notes, "Synthetic notes");
  assert.equal(notesUpdate.job.availability, "unknown");
  assert.equal(notesUpdate.job.availabilityMessage, "Check the source");
  assert.equal(application.status, "interested");
});

test("resume upload preserves draft profile edits and server evidence provenance", () => {
  const draft = {
    name: "Synthetic QA",
    location: "Sydney",
    situation: "exploring",
    resumeText: "old text",
    skills: ["React"],
    confirmed: true,
    roleFamilies: ["software"],
    preferences: { locations: ["Sydney"], limitations: "Synthetic constraint" },
  };
  const uploaded = {
    extractedText: "new resume evidence",
    profile: {
      name: "",
      location: "",
      skills: ["React", "TypeScript"],
      preferences: {},
      resumeObjectKey: "synthetic-key",
      consentAt: "2026-10-12T00:00:00Z",
      confirmed: false,
    },
  };
  const result = mergeResumeUpload(draft, uploaded);
  assert.equal(result.name, draft.name);
  assert.equal(result.location, draft.location);
  assert.equal(result.situation, draft.situation);
  assert.deepEqual(result.preferences, draft.preferences);
  assert.deepEqual(result.roleFamilies, ["software"]);
  assert.equal(result.resumeText, "new resume evidence");
  assert.deepEqual(result.skills, ["React", "TypeScript"]);
  assert.equal(result.resumeObjectKey, "synthetic-key");
  assert.equal(result.consentAt, "2026-10-12T00:00:00Z");
  assert.equal(result.confirmed, false);
  assert.deepEqual(mergeResumeUpload(draft, uploaded, true).skills, ["React"]);
  assert.equal(draft.resumeText, "old text");
});

test("an Interested continuation opens the exact application", () => {
  const applications = [{ id: "older" }, { id: "selected" }, { id: "newer" }];
  assert.equal(
    selectedApplicationId(applications, "older", "selected"),
    "selected",
  );
  assert.equal(
    selectedApplicationId(applications, "older", "missing"),
    "older",
  );
  assert.equal(selectedApplicationId(applications, null, null), "older");
});

function memoryStorage() {
  const storage = Object.create(null);
  Object.defineProperties(storage, {
    getItem: {
      value(key) {
        return Object.hasOwn(storage, key) ? storage[key] : null;
      },
    },
    setItem: {
      value(key, value) {
        storage[key] = String(value);
      },
    },
    removeItem: {
      value(key) {
        delete storage[key];
      },
    },
  });
  return storage;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const response = (id = "synthetic-new-id") => ({
  ok: true,
  async json() {
    return {
      AuthenticationResult: {
        IdToken: id,
        AccessToken: "synthetic-access",
        RefreshToken: "synthetic-refresh",
        ExpiresIn: 3600,
      },
    };
  },
});
const config = {
  mode: "production",
  cognitoRegion: "ap-southeast-2",
  cognitoClientId: "synthetic-test-client",
};

test("auth refresh and immediate sign-out cannot restore a stale session", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "sessionStorage", {
    value: storage,
    configurable: true,
  });
  const seed = () => {
    clearSession();
    storage.setItem(
      "roleclue.session.v1",
      JSON.stringify({
        email: "old@example.test",
        idToken: "synthetic-old-id",
        accessToken: "synthetic-old-access",
        refreshToken: "synthetic-old-refresh",
        expiresAt: 0,
      }),
    );
  };
  try {
    await t.test("concurrent expiry refreshes share one request", async () => {
      seed();
      const request = deferred();
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return request.promise;
      };
      const first = getToken(config),
        second = getToken(config);
      assert.equal(calls, 1);
      request.resolve(response());
      assert.deepEqual(await Promise.all([first, second]), [
        "synthetic-new-id",
        "synthetic-new-id",
      ]);
      assert.equal(readSession().idToken, "synthetic-new-id");
    });
    await t.test(
      "a refresh that completes after local logout cannot recreate credentials",
      async () => {
        seed();
        const request = deferred();
        globalThis.fetch = async () => request.promise;
        const refresh = getToken(config);
        clearSession();
        request.resolve(response());
        await assert.rejects(refresh, { code: "SESSION_CHANGED" });
        assert.equal(readSession(), null);
      },
    );
    await t.test(
      "late refresh failure cannot erase a newer sign-in",
      async () => {
        seed();
        const oldRefresh = deferred();
        globalThis.fetch = async (_url, options) =>
          JSON.parse(options.body).AuthFlow === "REFRESH_TOKEN_AUTH"
            ? oldRefresh.promise
            : response("synthetic-second-account");
        const refresh = getToken(config);
        const oldFailure = assert.rejects(
          refresh,
          /Synthetic network interruption/,
        );
        await signIn(config, "new@example.test", "SyntheticPassword123");
        oldRefresh.reject(new Error("Synthetic network interruption"));
        await oldFailure;
        assert.equal(readSession().email, "new@example.test");
        assert.equal(readSession().idToken, "synthetic-second-account");
      },
    );
    await t.test(
      "global sign-out clears local credentials and pending keys before network completion",
      async () => {
        seed();
        storage.setItem("roleclue.generation.synthetic-job", "{}");
        const request = deferred();
        globalThis.fetch = async () => request.promise;
        const logout = signOut(config);
        assert.equal(readSession(), null);
        assert.equal(
          storage.getItem("roleclue.generation.synthetic-job"),
          null,
        );
        request.reject(new Error("Synthetic sign-out interruption"));
        await logout;
        assert.equal(readSession(), null);
      },
    );
    await t.test(
      "late successful refresh cannot overwrite a newer account",
      async () => {
        seed();
        const oldRefresh = deferred();
        globalThis.fetch = async (_url, options) =>
          JSON.parse(options.body).AuthFlow === "REFRESH_TOKEN_AUTH"
            ? oldRefresh.promise
            : response("synthetic-current-account");
        const refresh = getToken(config);
        await signIn(config, "current@example.test", "SyntheticPassword123");
        oldRefresh.resolve(response("synthetic-stale-account"));
        await assert.rejects(refresh, { code: "SESSION_CHANGED" });
        assert.equal(readSession().idToken, "synthetic-current-account");
      },
    );
  } finally {
    clearSession();
    globalThis.fetch = originalFetch;
    if (originalStorage)
      Object.defineProperty(globalThis, "sessionStorage", originalStorage);
    else delete globalThis.sessionStorage;
  }
});
