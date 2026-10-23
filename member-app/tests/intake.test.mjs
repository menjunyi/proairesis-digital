import test from "node:test";
import assert from "node:assert/strict";
import {
  applyIntakeToProfile,
  createIntake,
  eligibilityAfterWorkRights,
  intakeFromProfile,
  intakeErrors,
  intakeSummary,
} from "../src/intake.js";

const complete = {
  roleFamilies: ["software", "data"],
  situation: "career-change",
  location: "Melbourne, VIC",
  remote: true,
  workRights: "visa-limited",
  needsSponsorship: "later",
  visaLimitations: "Maximum 40 hours each week",
  limitations: "No overnight travel",
  interviewCompleted: true,
};

test("a completed interview keeps explicit uncertain eligibility answers", () => {
  assert.equal(
    createIntake({
      ...complete,
      workRights: "unknown",
      needsSponsorship: "unknown",
    }).workRights,
    "unknown",
  );
  assert.equal(
    intakeFromProfile({
      ...complete,
      workRights: "unknown",
      needsSponsorship: "unknown",
    }).needsSponsorship,
    "unknown",
  );
});

test("legacy defaults are not presented as interview answers", () => {
  assert.deepEqual(
    intakeFromProfile({
      situation: "actively-looking",
      workRights: "unknown",
      needsSponsorship: "unknown",
      interviewCompleted: false,
    }),
    {
      roleFamilies: [],
      situation: "",
      location: "",
      remote: false,
      workRights: "",
      needsSponsorship: "",
      visaLimitations: "",
      limitations: "",
      interviewCompleted: false,
    },
  );
});

test("citizens and permanent residents never retain a contradictory sponsorship answer", () => {
  const intake = createIntake({
    ...complete,
    workRights: "citizen",
    needsSponsorship: "now",
  });
  assert.equal(intake.needsSponsorship, "no");
  assert.deepEqual(intakeErrors(intake), []);
});

test("leaving citizen or resident status requires a fresh sponsorship answer", () => {
  assert.deepEqual(
    eligibilityAfterWorkRights(
      { workRights: "citizen", needsSponsorship: "no", visaLimitations: "" },
      "visa-limited",
    ),
    {
      workRights: "visa-limited",
      needsSponsorship: "",
      visaLimitations: "",
    },
  );
  assert.equal(
    eligibilityAfterWorkRights(
      { workRights: "permanent-resident", needsSponsorship: "no" },
      "unknown",
    ).needsSponsorship,
    "",
  );
  assert.equal(
    eligibilityAfterWorkRights(
      { workRights: "visa-limited", needsSponsorship: "later" },
      "unknown",
    ).needsSponsorship,
    "later",
  );
});

test("interview answers control constraints while resume evidence remains intact", () => {
  const merged = applyIntakeToProfile(
    {
      name: "Alex Example",
      resumeText: "Built accessible React products.",
      skills: ["React", "TypeScript"],
      yearsExperience: 4,
      location: "Sydney",
      roleFamilies: ["design"],
      workRights: "unknown",
      needsSponsorship: "unknown",
      preferences: {
        roleTitles: ["Frontend Engineer"],
        seniority: ["mid"],
      },
    },
    complete,
  );

  assert.equal(merged.name, "Alex Example");
  assert.equal(merged.resumeText, "Built accessible React products.");
  assert.deepEqual(merged.skills, ["React", "TypeScript"]);
  assert.equal(merged.yearsExperience, 4);
  assert.equal(merged.location, "Melbourne, VIC");
  assert.deepEqual(merged.roleFamilies, ["software", "data"]);
  assert.equal(merged.workRights, "visa-limited");
  assert.equal(merged.needsSponsorship, "later");
  assert.equal(merged.visaLimitations, "Maximum 40 hours each week");
  assert.deepEqual(merged.preferences.locations, ["Melbourne, VIC"]);
  assert.equal(merged.preferences.includeRemote, true);
  assert.equal(merged.preferences.limitations, "No overnight travel");
  assert.deepEqual(merged.preferences.roleTitles, ["Frontend Engineer"]);
  assert.equal(merged.interviewCompleted, true);
});

test("the summary reflects supplied answers without adding a claim", () => {
  const summary = intakeSummary(complete);
  assert.deepEqual(summary.map(({ key }) => key), [
    "roles",
    "search",
    "eligibility",
    "limits",
  ]);
  assert.match(summary[0].value, /Software engineering/);
  assert.match(summary[1].value, /Melbourne, VIC/);
  assert.match(summary[2].value, /work restrictions/);
  assert.match(summary[3].value, /Maximum 40 hours/);
  assert.doesNotMatch(JSON.stringify(summary), /citizen|permanent resident/i);
});

test("required interview questions report one clear correction each", () => {
  const errors = intakeErrors(createIntake());
  assert.equal(errors.length, 5);
  assert.match(errors[0], /kind of work/i);
  assert.match(errors.at(-1), /sponsorship/i);
});
