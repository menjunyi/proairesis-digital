export function capabilitiesFor(config, runtime) {
  const demo = config?.mode === "demo";
  return Object.fromEntries(
    [
      "recommendations",
      "guestDiscovery",
      "coverLetters",
      "billing",
      "jobImport",
    ].map((key) => [
      key,
      typeof runtime?.[key] === "boolean"
        ? runtime[key]
        : demo || config?.capabilities?.[key] === true,
    ]),
  );
}

export function guestJourneyAvailable(config) {
  const capabilities = capabilitiesFor(config);
  return capabilities.recommendations && capabilities.guestDiscovery;
}

export function opportunityLoadRequest(
  view,
  {
    recommendations = false,
    refresh = false,
    initial = false,
    selectedLoaded = false,
  } = {},
) {
  if (view === "ignored") return { path: "/ignored" };
  if (recommendations && (refresh || (initial && !selectedLoaded)))
    return {
      path: "/opportunities/refresh",
      options: { method: "POST" },
    };
  return { path: "/opportunities" };
}

export function memberRoute(route, onboarding) {
  if (route === "account") return "account";
  if (onboarding) return "profile";
  return ["opportunities", "applications", "profile"].includes(route)
    ? route
    : "opportunities";
}

export function continuationRecovery(error) {
  const code = error?.code;
  if (code === "ACCOUNT_PROFILE_EXISTS") return "existing-profile";
  if (["GUEST_SELECTION_INVALID", "PROFILE_OR_JOB_CHANGED"].includes(code))
    return "review-matches";
  if (
    [
      "GUEST_SESSION_EXPIRED",
      "GUEST_ALREADY_RESOLVED",
      "GUEST_ALREADY_CLAIMED",
      "GUEST_CLAIM_INCOMPLETE",
    ].includes(code)
  )
    return "restart";
  if (
    ["NETWORK_ERROR", "REQUEST_TIMEOUT", "GUEST_SESSION_CHANGED"].includes(
      code,
    ) ||
    error?.status === 429 ||
    error?.status >= 500
  )
    return "retry";
  return "workspace";
}

export function mergeApplicationUpdate(previous, next) {
  return {
    ...previous,
    ...next,
    letters: next.letters ?? previous.letters,
    job: {
      ...previous.job,
      ...next.job,
      availability: next.job?.availability ?? previous.job?.availability,
      availabilityMessage:
        next.job?.availabilityMessage ?? previous.job?.availabilityMessage,
      availabilityCheckedAt:
        next.job?.availabilityCheckedAt ?? previous.job?.availabilityCheckedAt,
    },
  };
}

export function mergeResumeUpload(draft, result, skillsEdited = false) {
  const uploaded = result.profile || {};
  const draftPreferences = draft.preferences || {};
  const uploadedPreferences = uploaded.preferences || {};
  const preferText = (current, suggested) =>
    typeof current === "string" && current.trim() ? current : suggested || current;
  const preferList = (current, suggested) =>
    Array.isArray(current) && current.length ? current : suggested || current;
  const preferences = {
    ...uploadedPreferences,
    ...draftPreferences,
  };
  const locations = preferList(
    draftPreferences.locations,
    uploadedPreferences.locations,
  );
  const roleTitles = preferList(
    draftPreferences.roleTitles,
    uploadedPreferences.roleTitles,
  );
  if (locations !== undefined) preferences.locations = locations;
  if (roleTitles !== undefined) preferences.roleTitles = roleTitles;
  const next = {
    ...draft,
    name: preferText(draft.name, uploaded.name),
    location: preferText(draft.location, uploaded.location),
    yearsExperience: Number.isFinite(draft.yearsExperience)
      ? draft.yearsExperience
      : uploaded.yearsExperience ?? draft.yearsExperience,
    roleFamilies: preferList(draft.roleFamilies, uploaded.roleFamilies),
    preferences,
    resumeText: result.extractedText || uploaded.resumeText || draft.resumeText,
    skills: skillsEdited ? draft.skills : uploaded.skills || draft.skills,
    confirmed: false,
  };
  for (const key of [
    "consentAt",
    "resumeObjectKey",
    "resumeUploadId",
    "resumeOriginalExpiresAt",
  ]) {
    if (Object.hasOwn(uploaded, key)) next[key] = uploaded[key];
  }
  return next;
}

export function selectedApplicationId(applications, currentId, preferredId) {
  if (!Array.isArray(applications) || !applications.length) return null;
  if (
    typeof preferredId === "string" &&
    applications.some((application) => application.id === preferredId)
  )
    return preferredId;
  if (
    typeof currentId === "string" &&
    applications.some((application) => application.id === currentId)
  )
    return currentId;
  return applications[0]?.id || null;
}

export function generationFailureMessage(generation) {
  const failure = generation?.error;
  if (typeof failure === "string" && failure.trim()) return failure.trim();
  if (typeof failure?.message === "string" && failure.message.trim())
    return failure.message.trim();
  if (typeof generation?.message === "string" && generation.message.trim())
    return generation.message.trim();
  return "The letter could not be generated. No generation credit was used. Please try again.";
}
