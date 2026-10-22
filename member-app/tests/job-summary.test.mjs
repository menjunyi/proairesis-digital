import test from "node:test";
import assert from "node:assert/strict";
import { jobBrief, matchSummary } from "../src/job-summary.js";

test("job overview uses source text and removes markdown decoration", () => {
  const description = "*Software Engineer*\n*Build browser-based games with TypeScript and React.*\nOffice attendance is required four days a week in Perth.";
  const brief = jobBrief({title: "Software Engineer", description});
  assert.equal(brief, "Build browser-based games with TypeScript and React. Office attendance is required four days a week in Perth.");
  assert.ok(jobBrief({description: "word ".repeat(300)}).length <= 480);
});

test("fit summary groups supported skills without asserting missing skills are absent", () => {
  const summary = matchSummary({
    matches: [{text: "Python appears in your resume and the job requirements."}, {text: "AWS appears in your resume and the job requirements."}],
    gaps: [{text: "React is not evidenced in your resume."}, {text: "The advertised location differs from your preference."}],
    needsConfirmation: [{text: "Confirm whether this role has a clearance requirement."}],
  });
  assert.equal(summary.fit, "Your resume shows Python and AWS required by this role.");
  assert.match(summary.gaps, /does not yet evidence React/);
  assert.match(summary.gaps, /location differs/);
  assert.match(summary.gaps, /Confirm security clearance/);
});

test("missing assessment and unresolved requirements do not imply full eligibility", () => {
  assert.match(matchSummary(null).fit, /not available/);
  const summary = matchSummary({needsConfirmation: [{text: "Confirm the required 5 years of experience."}]});
  assert.match(summary.gaps, /Confirm the required 5 years/);
});
