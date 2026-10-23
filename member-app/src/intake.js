export const ROLE_FAMILY_OPTIONS = [
  ["software", "Software engineering"],
  ["data", "Data and analytics"],
  ["cloud", "Cloud and infrastructure"],
  ["security", "Cybersecurity"],
  ["quality", "Quality and testing"],
  ["product", "Product"],
  ["design", "Design"],
  ["it-support", "IT support"],
  ["business-analysis", "Business analysis"],
];

export const SITUATION_OPTIONS = [
  ["actively-looking", "I’m actively looking"],
  ["exploring", "I’m exploring a move"],
  ["graduate", "I’m looking for my first role"],
  ["career-change", "I’m changing careers"],
  ["returning", "I’m returning to work"],
];

export const WORK_RIGHTS_OPTIONS = [
  ["citizen", "Australian citizen"],
  ["permanent-resident", "Permanent resident"],
  ["visa-unrestricted", "Visa with unrestricted work rights"],
  ["visa-limited", "Visa with work restrictions"],
  ["none", "I do not currently have work rights"],
  ["unknown", "I’m not sure"],
];

export const SPONSORSHIP_OPTIONS = [
  ["no", "No"],
  ["now", "Yes, I need sponsorship now"],
  ["later", "Not now, but I may need it later"],
  ["unknown", "I’m not sure"],
];

const roleFamilies = new Set(ROLE_FAMILY_OPTIONS.map(([value]) => value));
const situations = new Set(SITUATION_OPTIONS.map(([value]) => value));
const workRights = new Set(WORK_RIGHTS_OPTIONS.map(([value]) => value));
const sponsorship = new Set(SPONSORSHIP_OPTIONS.map(([value]) => value));

const clean = (value, limit) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

const valid = (set, value) => (set.has(value) ? value : "");

const optionLabel = (options, value) =>
  options.find(([candidate]) => candidate === value)?.[1] || "Not answered";

export function createIntake(value = {}) {
  const preferences = value.preferences || {};
  const completed = value.interviewCompleted === true;
  const selectedFamilies = Array.isArray(value.roleFamilies)
    ? [...new Set(value.roleFamilies.filter((family) => roleFamilies.has(family)))].slice(0, 3)
    : [];
  const selectedWorkRights = valid(workRights, value.workRights);
  const selectedSponsorship = ["citizen", "permanent-resident"].includes(
    selectedWorkRights,
  )
    ? "no"
    : valid(sponsorship, value.needsSponsorship);

  return {
    roleFamilies: selectedFamilies,
    situation: valid(situations, value.situation),
    location: clean(value.location, 200),
    remote:
      value.remote === true ||
      value.includeRemote === true ||
      preferences.includeRemote === true,
    workRights: selectedWorkRights,
    needsSponsorship: selectedSponsorship,
    visaLimitations: clean(value.visaLimitations, 1000),
    limitations: clean(value.limitations ?? preferences.limitations, 2000),
    interviewCompleted: completed,
  };
}

export function intakeFromProfile(profile = {}) {
  const intake = createIntake(profile);
  if (intake.interviewCompleted) return intake;
  return {
    ...intake,
    situation: intake.situation === "actively-looking" ? "" : intake.situation,
    workRights: intake.workRights === "unknown" ? "" : intake.workRights,
    needsSponsorship:
      intake.needsSponsorship === "unknown" ? "" : intake.needsSponsorship,
  };
}

export function applyIntakeToProfile(profile = {}, value = {}) {
  const intake = createIntake({ ...value, interviewCompleted: true });
  const preferences = profile.preferences || {};
  return {
    ...profile,
    situation: intake.situation,
    location: intake.location,
    roleFamilies: intake.roleFamilies,
    workRights: intake.workRights,
    needsSponsorship: intake.needsSponsorship,
    visaLimitations: intake.visaLimitations,
    preferences: {
      ...preferences,
      locations: intake.location ? [intake.location] : [],
      locationsRequired: Boolean(intake.location),
      includeRemote: intake.remote,
      limitations: intake.limitations,
    },
    interviewCompleted: true,
  };
}

export function eligibilityAfterWorkRights(current = {}, workRights) {
  const previouslyDerived = ["citizen", "permanent-resident"].includes(
    current.workRights,
  );
  const noSponsorshipRequired = ["citizen", "permanent-resident"].includes(
    workRights,
  );
  return {
    workRights,
    needsSponsorship: noSponsorshipRequired
      ? "no"
      : previouslyDerived && current.needsSponsorship === "no"
        ? ""
        : current.needsSponsorship,
    visaLimitations: [
      "citizen",
      "permanent-resident",
      "visa-unrestricted",
    ].includes(workRights)
      ? ""
      : current.visaLimitations,
  };
}

export function intakeErrors(value, screen = 4) {
  const intake = createIntake(value);
  const errors = [];
  if ((screen === 0 || screen === 4) && !intake.roleFamilies.length) {
    errors.push("Choose at least one kind of work.");
  }
  if ((screen === 1 || screen === 4) && !intake.situation) {
    errors.push("Tell us where you are in your search.");
  }
  if ((screen === 1 || screen === 4) && !intake.location) {
    errors.push("Enter an Australian city, state or region.");
  }
  if ((screen === 2 || screen === 4) && !intake.workRights) {
    errors.push("Choose the work-rights answer that is closest to your situation.");
  }
  if ((screen === 2 || screen === 4) && !intake.needsSponsorship) {
    errors.push("Tell us whether employer sponsorship is needed.");
  }
  return errors;
}

export function intakeSummary(value) {
  const intake = createIntake(value);
  const familyLabels = intake.roleFamilies.map((family) =>
    optionLabel(ROLE_FAMILY_OPTIONS, family),
  );
  const location = intake.location
    ? `${intake.location}${intake.remote ? ", including Australia-wide remote roles" : ""}`
    : "Not answered";
  const limits = [intake.visaLimitations, intake.limitations].filter(Boolean).join(" · ");
  return [
    {
      key: "roles",
      label: "Work to focus on",
      value: familyLabels.join(", ") || "Not answered",
      screen: 0,
    },
    {
      key: "search",
      label: "Your search",
      value: `${optionLabel(SITUATION_OPTIONS, intake.situation)} · ${location}`,
      screen: 1,
    },
    {
      key: "eligibility",
      label: "Work rights and sponsorship",
      value: `${optionLabel(WORK_RIGHTS_OPTIONS, intake.workRights)} · ${optionLabel(
        SPONSORSHIP_OPTIONS,
        intake.needsSponsorship,
      )}`,
      screen: 2,
    },
    {
      key: "limits",
      label: "Limits to respect",
      value: limits || "No additional limits supplied",
      screen: 3,
    },
  ];
}
