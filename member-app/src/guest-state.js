const GUEST_KEY = "roleclue.guest.v1";
const CONTINUATION_KEY = "roleclue.continuation.v1";
const APPLICATION_KEY = "roleclue.application.v1";

function read(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

function write(key, value) {
  sessionStorage.setItem(key, JSON.stringify(value));
  return value;
}

export function readGuestState() {
  const value = read(GUEST_KEY);
  if (
    !value ||
    typeof value.token !== "string" ||
    value.token.length < 32 ||
    (value.expiresAt && Date.parse(value.expiresAt) <= Date.now())
  ) {
    sessionStorage.removeItem(GUEST_KEY);
    return null;
  }
  return {
    token: value.token,
    expiresAt: value.expiresAt || null,
    step: ["resume", "review", "searching", "matches"].includes(value.step)
      ? value.step
      : "resume",
  };
}

export function saveGuestState(value) {
  return write(GUEST_KEY, {
    token: value.token,
    expiresAt: value.expiresAt || null,
    step: value.step || "resume",
  });
}

export function clearGuestState() {
  sessionStorage.removeItem(GUEST_KEY);
}

export function readContinuation() {
  const value = read(CONTINUATION_KEY);
  if (!value || typeof value !== "object") return null;
  return {
    token: typeof value.token === "string" ? value.token : "",
    jobId: typeof value.jobId === "string" ? value.jobId : "",
    applicationId:
      typeof value.applicationId === "string" ? value.applicationId : "",
    claimed: value.claimed === true,
    awaitingAuth: value.awaitingAuth === true,
  };
}

export function saveContinuation(value) {
  const current = readContinuation() || {};
  const merged = { ...current, ...value };
  return write(CONTINUATION_KEY, {
    token: typeof merged.token === "string" ? merged.token : "",
    jobId: typeof merged.jobId === "string" ? merged.jobId : "",
    applicationId:
      typeof merged.applicationId === "string" ? merged.applicationId : "",
    claimed: merged.claimed === true,
    awaitingAuth: merged.awaitingAuth === true,
  });
}

export function clearContinuation() {
  sessionStorage.removeItem(CONTINUATION_KEY);
}

export function rememberApplication(id) {
  if (typeof id !== "string" || !id) return;
  write(APPLICATION_KEY, { id });
}

export function takeRememberedApplication() {
  const value = read(APPLICATION_KEY);
  sessionStorage.removeItem(APPLICATION_KEY);
  return typeof value?.id === "string" ? value.id : null;
}

export function profileErrors(profile) {
  const errors = [];
  if (!profile?.resumeText?.trim()) errors.push("Resume text is required.");
  if (!profile?.name?.trim()) errors.push("Confirm your name.");
  if (!profile?.location?.trim()) errors.push("Confirm your target location.");
  if (!Array.isArray(profile?.roleFamilies) || !profile.roleFamilies.length)
    errors.push("Choose at least one target role.");
  if (
    ![
      "citizen",
      "permanent-resident",
      "visa-unrestricted",
      "visa-limited",
      "none",
      "unknown",
    ].includes(profile?.workRights)
  )
    errors.push("Confirm your Australian work-rights situation.");
  if (!["no", "now", "later", "unknown"].includes(profile?.needsSponsorship))
    errors.push("Confirm whether you need employer sponsorship.");
  if (
    ["citizen", "permanent-resident"].includes(profile?.workRights) &&
    ["now", "later"].includes(profile?.needsSponsorship)
  )
    errors.push("Check the work-rights and sponsorship answers together.");
  return errors;
}

export function guestStepFrom(bundle) {
  if (Array.isArray(bundle?.opportunities)) return "matches";
  if (bundle?.profile?.confirmed) return "searching";
  if (bundle?.profile?.resumeText) return "review";
  return "resume";
}
