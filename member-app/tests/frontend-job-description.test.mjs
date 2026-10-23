import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

function loadComponent(relativePath) {
  const componentModule = { exports: {} };
  const compiled = buildSync({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    write: false,
  }).outputFiles[0].text;
  runInNewContext(compiled, {
    require: createRequire(import.meta.url),
    module: componentModule,
    exports: componentModule.exports,
  });
  return componentModule.exports;
}

const { default: ProcessedJobDescription } = loadComponent("../src/ProcessedJobDescription.jsx");
const { ApplicationWorkspace, OpportunityDialog } = loadComponent("../src/App.jsx");

const description = `*Software Engineer*

*Build gaming products with an engineering and design team.*

*Key responsibilities will include:*
* Develop TypeScript and React features.
* Review code and maintain existing services.

*What you will bring to the role:*
* 1-3 years of commercial experience.
* Git and pull-request experience.
* Based in Perth and available in the office four days a week.

*About VGW*
VGW builds interactive entertainment products.`;

const job = {
  id: "synthetic-job",
  title: "Software Engineer",
  company: "VGW",
  location: "Perth, Australia",
  workplaceType: "hybrid",
  employmentType: "full-time",
  availability: "available",
  description,
  url: "https://example.test/jobs/synthetic-job",
};

function withSessionStorage(run) {
  const original = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem() { return null; } };
  try {
    return run();
  } finally {
    if (original === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = original;
  }
}

function assertBefore(html, first, second) {
  const firstIndex = html.indexOf(first);
  const secondIndex = html.indexOf(second);
  assert.ok(firstIndex >= 0, `Expected markup to contain ${first}`);
  assert.ok(secondIndex >= 0, `Expected markup to contain ${second}`);
  assert.ok(firstIndex < secondIndex, `Expected ${first} before ${second}`);
}

test("processed description renders semantic overview and key-point groups without source decoration", () => {
  const html = renderToStaticMarkup(React.createElement(ProcessedJobDescription, { job }));
  assert.match(html, /<h3>Role overview<\/h3>/);
  assert.match(html, /<h3>Key points<\/h3>/);
  assert.match(html, /<h4>What you&#x27;ll do<\/h4>/);
  assert.match(html, /<h4>What they&#x27;re looking for<\/h4>/);
  assert.match(html, /<h4>Work setup and eligibility<\/h4>/);
  assert.match(html, /<h4>About the company<\/h4>/);
  assert.match(html, /<ul><li>Develop TypeScript and React features\.<\/li>/);
  assert.doesNotMatch(html, /\*Software Engineer\*|Read the full job description/);
});

test("processed description never creates executable source markup", () => {
  const html = renderToStaticMarkup(React.createElement(ProcessedJobDescription, {
    job: {
      description: `<h2>Responsibilities</h2><p>Build safe interfaces.</p><img src=x onerror=alert(1)><script>alert(2)</script><iframe src="https://evil.test">secret</iframe>`,
    },
  }));
  assert.doesNotMatch(html, /<script|<iframe|<img|onerror|evil\.test|alert\(/i);
  assert.match(html, /Build safe interfaces/);
});

test("processed description omits browser-decoded hidden styles", () => {
  const styles = [
    "display&colon;none",
    "display&Tab;:none",
    "display&NewLine;:none",
    "display&bsol;3a none",
    "display&sol;&ast;&ast;&sol;:none",
    "display&#58:none",
    "display&#x3a:none",
    "d&#105splay:none",
  ];
  const hidden = styles.map((style, index) => `<p style="${style}">Encoded hidden ${index}: Australian citizenship and Python.</p>`);
  const html = renderToStaticMarkup(React.createElement(ProcessedJobDescription, {
    job: { description: [...hidden, "<p>Visible TypeScript delivery work remains available.</p>"].join("\n") },
  }));
  assert.match(html, /Visible TypeScript delivery work remains available/);
  assert.doesNotMatch(html, /Encoded hidden|Australian citizenship|Python|display&/);
});

test("signed-in opportunity and application use the same structured presentation", () => {
  const match = { job, score: 86, matches: [], gaps: [], needsConfirmation: [] };
  const opportunity = renderToStaticMarkup(React.createElement(OpportunityDialog, {
    match,
    onClose() {},
    onDecision() {},
    busy: false,
    error: null,
    ignored: false,
  }));
  const application = withSessionStorage(() => renderToStaticMarkup(
    React.createElement(ApplicationWorkspace, {
      application: { id: "synthetic-application", status: "interested", notes: "", letters: [], job, match },
      api: async () => ({}),
      billing: { plan: "free", remaining: 0, limit: 0 },
      onBilling() {},
      onUpgrade() {},
      onNotice() {},
      onUpdate() {},
      capabilities: { recommendations: true, coverLetters: false, billing: false, jobImport: true },
    }),
  ));
  for (const html of [opportunity, application]) {
    assert.match(html, /Structured job description/);
    assert.match(html, /What you&#x27;ll do/);
    assert.match(html, /What they&#x27;re looking for/);
    assert.doesNotMatch(html, /Read the full job description|\*Key responsibilities/);
  }
  assertBefore(opportunity, 'aria-label="Job fit evidence"', 'aria-label="Structured job description"');
  assertBefore(application, 'aria-label="Job fit summary"', 'aria-label="Structured job description"');
  assert.doesNotMatch(application, /Listing availability needs confirmation|not in your latest saved recommendation shortlist|Check the listing is still open|listing-availability-note/);
  assert.equal(job.description, description);
});

test("an uncertain listing uses a neutral source note after the fit summary", () => {
  const match = { job, score: 86, matches: [], gaps: [], needsConfirmation: [] };
  const application = withSessionStorage(() => renderToStaticMarkup(
    React.createElement(ApplicationWorkspace, {
      application: {
        id: "synthetic-application",
        status: "interested",
        notes: "",
        letters: [],
        job: {
          ...job,
          availability: "unknown",
          availabilityMessage: "RoleClue has not recently confirmed this listing. Check the employer listing before applying.",
          availabilityCheckedAt: "2026-10-22T00:00:00.000Z",
        },
        match,
      },
      api: async () => ({}),
      billing: { plan: "free", remaining: 0, limit: 0 },
      onBilling() {},
      onUpgrade() {},
      onNotice() {},
      onUpdate() {},
      capabilities: { recommendations: true, coverLetters: false, billing: false, jobImport: true },
    }),
  ));
  assertBefore(application, 'aria-label="Job fit summary"', "Check the listing is still open");
  assertBefore(application, "Check the listing is still open", 'aria-label="Structured job description"');
  assert.match(application, /notice neutral listing-availability-note/);
  assert.doesNotMatch(application, /Listing availability needs confirmation|latest saved recommendation shortlist/);
});

test("a closed listing keeps its prominent warning above the application tabs", () => {
  const match = { job, score: 86, matches: [], gaps: [], needsConfirmation: [] };
  const application = withSessionStorage(() => renderToStaticMarkup(
    React.createElement(ApplicationWorkspace, {
      application: {
        id: "synthetic-application",
        status: "interested",
        notes: "",
        letters: [],
        job: {
          ...job,
          availability: "closed",
          availabilityMessage: "The source reports that this opportunity is closed.",
          availabilityCheckedAt: "2026-10-23T00:00:00.000Z",
        },
        match,
      },
      api: async () => ({}),
      billing: { plan: "free", remaining: 0, limit: 0 },
      onBilling() {},
      onUpgrade() {},
      onNotice() {},
      onUpdate() {},
      capabilities: { recommendations: true, coverLetters: false, billing: false, jobImport: true },
    }),
  ));
  assert.match(application, /notice warning/);
  assert.match(application, /This opportunity is closed/);
  assertBefore(application, "This opportunity is closed", 'class="tabs application-tabs"');
  assertBefore(application, "This opportunity is closed", 'aria-label="Job fit summary"');
  assert.doesNotMatch(application, /listing-availability-note/);
});
