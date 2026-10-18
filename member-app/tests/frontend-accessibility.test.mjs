import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const module = { exports: {} };
const compiled = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/App.jsx", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
}).outputFiles[0].text;
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url),
  module,
  module.exports,
);

const { ApplicationWorkspace, AuthScreen, OpportunitiesScreen } = module.exports;
const capabilities = {
  recommendations: false,
  guestDiscovery: false,
  coverLetters: false,
  billing: false,
  jobImport: false,
};

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
    assert.match(workspace, /aria-pressed="true"[^>]*>.*Cover letter/s);
    assert.match(workspace, /aria-pressed="false"[^>]*>Match &amp; notes/);
  } finally {
    if (storage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = storage;
  }
});
