import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const appModule = { exports: {} };
const compiled = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/App.jsx", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
}).outputFiles[0].text;
runInNewContext(compiled, {
  require: createRequire(import.meta.url),
  module: appModule,
  exports: appModule.exports,
});

const {
  ApplicationWorkspace,
  AuthScreen,
  OpportunitiesScreen,
  ProfileScreen,
} = appModule.exports;
const guestModule = { exports: {} };
const guestCompiled = buildSync({
  entryPoints: [
    fileURLToPath(new URL("../src/GuestJourney.jsx", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
}).outputFiles[0].text;
runInNewContext(guestCompiled, {
  require: createRequire(import.meta.url),
  module: guestModule,
  exports: guestModule.exports,
});
const {
  GuestRestoreFailure,
  guestInterviewSubmissionMode,
  guestRestoreRecovery,
} = guestModule.exports;
const capabilities = {
  recommendations: false,
  guestDiscovery: false,
  coverLetters: false,
  billing: false,
  jobImport: false,
};

test("returning from resume reuses the existing private guest session", () => {
  assert.equal(guestInterviewSubmissionMode(null), "start");
  assert.equal(guestInterviewSubmissionMode({ token: "short" }), "start");
  assert.equal(
    guestInterviewSubmissionMode({ token: "g".repeat(48) }),
    "resume",
  );
});

test("authentication has one page heading and a main landmark", () => {
  const html = renderToStaticMarkup(
    React.createElement(AuthScreen, {
      config: { mode: "production", capabilities },
      onSession() {},
    }),
  );
  assert.match(html, /^<main class="auth-layout">/);
  assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1);
  assert.match(html, /<h1 id="auth-title">Welcome back\.<\/h1>/);
});

test("signed-in onboarding interviews the user before showing resume upload", () => {
  const onboarding = renderToStaticMarkup(
    React.createElement(ProfileScreen, {
      config: { mode: "production", capabilities },
      api: async () => ({}),
      profile: { confirmed: false },
      onboarding: true,
      onDraftSaved() {},
      onSaved() {},
    }),
  );
  assert.match(onboarding, /What kind of work would feel like the right next move\?/);
  assert.doesNotMatch(onboarding, /id="resume-file"/);

  const existingMember = renderToStaticMarkup(
    React.createElement(ProfileScreen, {
      config: { mode: "production", capabilities },
      api: async () => ({}),
      profile: { confirmed: true },
      onboarding: false,
      onDraftSaved() {},
      onSaved() {},
    }),
  );
  assert.match(existingMember, /<h1>My profile<\/h1>/);
  assert.match(existingMember, /id="resume-file"/);
});

test("opportunity and application visual tabs expose their selected state", () => {
  const opportunities = renderToStaticMarkup(
    React.createElement(OpportunitiesScreen, {
      api: async () => ({ opportunities: [] }),
      profile: { name: "Synthetic QA" },
      onNotice() {},
      capabilities,
      onOpenApplication() {},
    }),
  );
  assert.match(
    opportunities,
    /aria-pressed="true"[^>]*>Selected for you/,
  );
  assert.match(opportunities, /aria-pressed="false"[^>]*>Ignored/);

  const storage = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem() {
      return null;
    },
  };
  try {
    const workspace = renderToStaticMarkup(
      React.createElement(ApplicationWorkspace, {
        application: {
          id: "synthetic-application",
          status: "interested",
          notes: "",
          letters: [],
          job: {
            company: "Synthetic Employer",
            title: "Synthetic Engineer",
            location: "Sydney",
            workplaceType: "hybrid",
            availability: "available",
          },
        },
        api: async () => ({}),
        billing: { plan: "free", remaining: 0, limit: 0 },
        onBilling() {},
        onUpgrade() {},
        onNotice() {},
        onUpdate() {},
        capabilities,
      }),
    );
    assert.match(workspace, /aria-pressed="false"[^>]*>.*Cover letter/s);
    assert.match(workspace, /aria-pressed="true"[^>]*>Match &amp; notes/);
  } finally {
    if (storage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = storage;
  }
});

test("guest restore failures offer retry and explicit restart without implying lost progress", () => {
  assert.equal(guestRestoreRecovery({ status: 503 }), "retry");
  assert.equal(guestRestoreRecovery(new Error("Network unavailable")), "retry");
  assert.equal(guestRestoreRecovery({ status: 404 }), "restart");
  assert.equal(guestRestoreRecovery({ status: 410 }), "restart");
  const html = renderToStaticMarkup(
    React.createElement(GuestRestoreFailure, {
      error: new Error("Synthetic temporary interruption"),
      onRetry() {},
      onRestart() {},
    }),
  );
  assert.match(html, /Your guest progress is still saved in this browser/);
  assert.match(html, /role="alert"/);
  assert.match(html, />Try again<\/button>/);
  assert.match(html, />Start a new search<\/button>/);
});
