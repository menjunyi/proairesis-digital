import test from "node:test";
import assert from "node:assert/strict";
import {
  clearAccountBrowserState,
  clearContinuation,
  completedContinuationApplicationId,
  guestStepFrom,
  profileErrors,
  readContinuation,
  readGuestState,
  reconcileClaimedContinuation,
  rememberApplication,
  reviewAcknowledgements,
  saveContinuation,
  saveGuestState,
} from "../src/guest-state.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    dump: () => [...values.values()].join("\n"),
  };
}

test.beforeEach(() => {
  global.sessionStorage = storage();
});

test("guest browser state stores only the opaque token and navigation state", () => {
  const token = "g".repeat(48);
  saveGuestState({
    token,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    step: "review",
    resumeText: "must not be stored",
    profile: { name: "Private name" },
  });
  assert.deepEqual(readGuestState(), {
    token,
    expiresAt: readGuestState().expiresAt,
    step: "review",
  });
  assert.doesNotMatch(sessionStorage.dump(), /must not be stored|Private name/);
});

test("expired guest state is removed", () => {
  saveGuestState({
    token: "x".repeat(48),
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    step: "matches",
  });
  assert.equal(readGuestState(), null);
  assert.equal(sessionStorage.length, 0);
});

test("profile validation requires essential eligibility answers only", () => {
  const profile = {
    name: "Alex Example",
    location: "Melbourne, VIC",
    resumeText: "Experienced TypeScript and AWS engineer.",
    roleFamilies: ["software"],
    workRights: "visa-limited",
    needsSponsorship: "later",
    visaLimitations: "Work rights expire next year.",
  };
  assert.deepEqual(profileErrors(profile), []);
  assert.match(
    profileErrors({ ...profile, workRights: "citizen" })[0],
    /work-rights and sponsorship/i,
  );
  assert.match(
    profileErrors({ ...profile, roleFamilies: [] })[0],
    /target role/i,
  );
});

test("a confirmed guest profile keeps its acknowledgements after a search retry", () => {
  const acceptedAt = new Date().toISOString();
  assert.deepEqual(
    reviewAcknowledgements({ confirmed: true, termsAcceptedAt: acceptedAt }),
    { reviewed: true, termsAccepted: true },
  );
  assert.deepEqual(reviewAcknowledgements({ confirmed: false }), {
    reviewed: false,
    termsAccepted: false,
  });
  assert.deepEqual(
    reviewAcknowledgements({ confirmed: true, termsAcceptedAt: "invalid" }),
    { reviewed: true, termsAccepted: false },
  );
});

test("guest progress derives from server-owned content", () => {
  assert.equal(guestStepFrom({}), "resume");
  assert.equal(guestStepFrom({ profile: { resumeText: "resume" } }), "review");
  assert.equal(
    guestStepFrom({ profile: { resumeText: "resume", confirmed: true } }),
    "searching",
  );
  assert.equal(guestStepFrom({ opportunities: [] }), "matches");
});

test("continuation stores opaque identifiers, not resume or job text", () => {
  saveContinuation({
    token: "t".repeat(48),
    jobId: "freehire:job-1",
    awaitingAuth: true,
    resumeText: "private resume",
    description: "private job description",
  });
  assert.deepEqual(readContinuation(), {
    token: "t".repeat(48),
    jobId: "freehire:job-1",
    applicationId: "",
    claimed: false,
    awaitingAuth: true,
  });
  assert.doesNotMatch(sessionStorage.dump(), /private resume|private job description/);
  clearContinuation();
  assert.equal(readContinuation(), null);
});

test("a claimed continuation from account A is not trusted after account B loads", () => {
  const accountA = "application-account-a";
  const accountB = "application-account-b";
  saveContinuation({
    token: "a".repeat(48),
    jobId: "job-account-a",
    applicationId: accountA,
    claimed: true,
    awaitingAuth: false,
  });
  assert.equal(
    reconcileClaimedContinuation(readContinuation(), {
      pendingApplicationId: accountA,
    }).applicationId,
    accountA,
  );

  assert.equal(
    reconcileClaimedContinuation(readContinuation(), null),
    null,
  );
  assert.equal(readContinuation(), null);

  saveContinuation({
    token: "a".repeat(48),
    jobId: "job-account-a",
    applicationId: accountA,
    claimed: true,
    awaitingAuth: false,
  });
  const reconciled = reconcileClaimedContinuation(readContinuation(), {
    pendingApplicationId: accountB,
  });
  assert.equal(reconciled.applicationId, accountB);
  assert.equal(readContinuation().applicationId, accountB);
  assert.notEqual(readContinuation().applicationId, accountA);
});

test("continuation completion uses only the server-confirmed application", () => {
  assert.equal(
    completedContinuationApplicationId({
      completed: true,
      continuation: null,
    }),
    null,
  );
  assert.equal(
    completedContinuationApplicationId({
      completed: true,
      applicationId: "server-application",
    }),
    "server-application",
  );
});

test("account browser cleanup removes bearer and continuation state but can preserve an intentional guest return", () => {
  const token = "g".repeat(48);
  const seed = () => {
    saveGuestState({ token, expiresAt: new Date(Date.now() + 60_000).toISOString(), step: "matches" });
    saveContinuation({ token, jobId: "freehire:job-1", applicationId: "freehire:job-1", claimed: true });
    rememberApplication("freehire:job-1");
  };
  seed();
  clearAccountBrowserState();
  assert.equal(readGuestState(), null);
  assert.equal(readContinuation(), null);
  assert.equal(sessionStorage.length, 0);

  seed();
  clearAccountBrowserState({ preserveGuestState: true });
  assert.equal(readGuestState().token, token);
  assert.equal(readContinuation(), null);
  assert.equal(sessionStorage.length, 1);
});
