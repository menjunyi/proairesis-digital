import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Heart,
  LoaderCircle,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { createGuestApi, fileToBase64, safeExternalUrl } from "./api.js";
import {
  clearGuestState,
  guestStepFrom,
  profileErrors,
  readGuestState,
  saveContinuation,
  saveGuestState,
} from "./guest-state.js";

const ROLE_FAMILIES = [
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

const GUEST_RESUME_MAX_BYTES = 4 * 1024 * 1024;

const blankSituation = {
  situation: "actively-looking",
  location: "",
  remote: false,
};

function formatSourceTime(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Sydney",
    timeZoneName: "short",
  }).format(new Date(time));
}

function Mark() {
  return (
    <svg className="brand-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 6H12a6 6 0 0 0-6 6v18h8V14h10V6Z" fill="currentColor" />
      <path d="M24 42h12a6 6 0 0 0 6-6V18h-8v16H24v8Z" fill="currentColor" />
      <circle cx="24" cy="24" r="5" fill="currentColor" />
    </svg>
  );
}

function GuestBrand() {
  return (
    <a className="brand" href="#start" aria-label="RoleClue start">
      <Mark />
      <span>RoleClue</span>
    </a>
  );
}

function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert" tabIndex={-1}>
      <CircleHelp size={18} />
      <div>
        {error.message || String(error)}
        {error.requestId && <small>Reference: {error.requestId}</small>}
      </div>
    </div>
  );
}

export function guestRestoreRecovery(error) {
  return [404, 410].includes(error?.status) ? "restart" : "retry";
}

export function GuestRestoreFailure({ error, onRetry, onRestart }) {
  return (
    <section
      className="guest-card guest-empty"
      aria-labelledby="guest-restore-title"
    >
      <CircleHelp size={30} aria-hidden="true" />
      <h1 id="guest-restore-title">We could not restore your search.</h1>
      <p>
        Your guest progress is still saved in this browser. Try again when your
        connection is ready, or start a new search to remove that saved
        progress.
      </p>
      <ErrorBox error={error} />
      <div className="guest-recovery-actions">
        <button className="button" type="button" onClick={onRetry}>
          Try again
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={onRestart}
        >
          Start a new search
        </button>
      </div>
    </section>
  );
}

function Field({ label, hint, children }) {
  const id = React.useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children, {
        id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

function Stepper({ step }) {
  const labels = ["Your situation", "Your resume", "Confirm profile", "Your matches"];
  const current = { situation: 1, resume: 2, review: 3, searching: 4, matches: 4 }[step] || 1;
  return (
    <div className="guest-step-progress">
      <ol className="guest-stepper" aria-label={`Step ${current} of 4`}>
        {labels.map((label, index) => (
            <li
              key={label}
              className={index + 1 === current ? "active" : index + 1 < current ? "done" : ""}
              aria-current={index + 1 === current ? "step" : undefined}
            >
              <span>{index + 1 < current ? <Check size={14} /> : index + 1}</span>
              <small>{label}</small>
            </li>
          ))}
      </ol>
      <p className="guest-step-status" aria-hidden="true">
        Step {current} of 4 · {labels[current - 1]}
      </p>
    </div>
  );
}

function GuestShell({ step, onSignIn, children }) {
  return (
    <div className="guest-shell">
      <a className="skip-link" href="#guest-main">Skip to content</a>
      <header className="guest-header">
        <GuestBrand />
        <button className="text-link guest-signin" onClick={onSignIn}>
          Already have an account? Sign in
        </button>
      </header>
      <Stepper step={step} />
      <main id="guest-main" className="guest-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="guest-footer">
        <span>Australian technology roles only</span>
        <nav aria-label="Legal information">
          <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy</a>
          <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a>
        </nav>
      </footer>
    </div>
  );
}

function SituationStep({ value, setValue, busy, error, onSubmit }) {
  return (
    <section className="guest-card guest-situation" aria-labelledby="situation-title">
      <p className="eyebrow">START WITH WHAT YOU NEED</p>
      <h1 id="situation-title">What does your next move look like?</h1>
      <p className="guest-lead">
        Two quick answers give your resume a useful direction. You do not need an account yet.
      </p>
      <form onSubmit={onSubmit}>
        <Field label="Where are you in your search?">
          <select
            value={value.situation}
            onChange={(event) => setValue((current) => ({ ...current, situation: event.target.value }))}
          >
            <option value="actively-looking">Actively looking</option>
            <option value="exploring">Exploring a move</option>
            <option value="graduate">Graduate or first technology role</option>
            <option value="career-change">Changing careers</option>
            <option value="returning">Returning to work</option>
          </select>
        </Field>
        <Field
          label="Where do you want to work?"
          hint="Enter an Australian city, state or region. Choose remote as well if you are open to Australia-wide remote roles."
        >
          <input
            required
            maxLength={200}
            placeholder="For example, Melbourne, VIC"
            value={value.location}
            onChange={(event) => setValue((current) => ({ ...current, location: event.target.value }))}
          />
        </Field>
        <label className="check-line guest-check">
          <input
            type="checkbox"
            checked={value.remote}
            onChange={(event) => setValue((current) => ({ ...current, remote: event.target.checked }))}
          />
          <span>Include remote roles available to people in Australia</span>
        </label>
        <ErrorBox error={error} />
        <button className="button guest-primary" disabled={busy}>
          {busy ? <><LoaderCircle className="spin" size={18} /> Saving</> : <>Continue to my resume <ArrowRight size={18} /></>}
        </button>
      </form>
      <p className="guest-trust"><ShieldCheck size={16} /> We ask only for details that change which roles fit.</p>
    </section>
  );
}

function ResumeStep({ busy, error, onUpload, onBack }) {
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState(null);
  return (
    <section className="guest-card" aria-labelledby="resume-title">
      <button className="guest-back" onClick={onBack}><ArrowLeft size={16} /> Back</button>
      <p className="eyebrow">LET YOUR RESUME DO THE WORK</p>
      <h1 id="resume-title">Bring your experience. We’ll organise the starting point.</h1>
      <p className="guest-lead">
        RoleClue extracts a reviewable summary so you do not need to retype your career history.
      </p>
      <div className="guest-privacy-note">
        <ShieldCheck size={21} />
        <div>
          <strong>Private, short-lived guest session</strong>
          <p>Your uploaded file is used to extract text for this guest session. We do not keep the original guest file. Unclaimed guest data expires within 24 hours.</p>
        </div>
      </div>
      <label className="guest-upload">
        <UploadCloud size={32} />
        <span>
          <strong>{file?.name || "Choose your PDF or DOCX resume"}</strong>
          <small>Text-based file, up to 4 MB</small>
        </span>
        <span className="button secondary">{file ? "Choose another" : "Choose file"}</span>
        <input
          id="guest-resume"
          className="sr-only"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
      </label>
      <label className="check-line guest-check">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>
          I understand RoleClue will process this resume to suggest jobs and prepare application drafts. <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy notice</a>
        </span>
      </label>
      <ErrorBox error={error} />
      <button
        className="button guest-primary"
        disabled={busy || !file || !consent}
        onClick={() => onUpload(file, consent)}
      >
        {busy ? <><LoaderCircle className="spin" size={18} /> Reading your resume</> : <>Extract my profile <ArrowRight size={18} /></>}
      </button>
      <p className="subtle">We do not infer your visa, citizenship or sponsorship situation from your resume.</p>
    </section>
  );
}

function ReviewStep({ initial, busy, error, onBack, onConfirm }) {
  const [draft, setDraft] = useState(initial);
  const [reviewed, setReviewed] = useState(false);
  const [terms, setTerms] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const set = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setReviewed(false);
  };
  const setPreference = (key, value) => {
    setDraft((current) => ({
      ...current,
      preferences: { ...current.preferences, [key]: value },
    }));
    setReviewed(false);
  };
  const setLocation = (value) => {
    setDraft((current) => ({
      ...current,
      location: value,
      preferences: {
        ...current.preferences,
        locations: value.trim() ? [value] : [],
        locationsRequired: Boolean(value.trim()),
      },
    }));
    setReviewed(false);
  };
  const toggleFamily = (family) => {
    const current = draft.roleFamilies || [];
    set("roleFamilies", current.includes(family) ? current.filter((value) => value !== family) : [...current, family]);
  };
  const errors = profileErrors(draft);
  const showVisaLimitations = ["visa-limited", "unknown"].includes(draft.workRights);
  return (
    <section className="guest-card guest-review" aria-labelledby="review-title">
      <button className="guest-back" onClick={onBack}><ArrowLeft size={16} /> Back</button>
      <p className="eyebrow">YOU HAVE THE FINAL SAY</p>
      <h1 id="review-title">Check the profile we found.</h1>
      <p className="guest-lead">Correct anything that does not reflect your experience. We ask only the missing details that affect eligibility.</p>
      <div className="profile-summary-grid">
        <Field label="Name">
          <input required maxLength={120} value={draft.name || ""} onChange={(event) => set("name", event.target.value)} />
        </Field>
        <Field label="Years of relevant experience" hint="Leave blank if you are unsure.">
          <input type="number" min="0" max="70" step="0.5" value={draft.yearsExperience ?? ""} onChange={(event) => set("yearsExperience", event.target.value === "" ? null : Number(event.target.value))} />
        </Field>
        <Field label="Skills found in your resume" hint="Remove anything the document did not support.">
          <input value={(draft.skills || []).join(", ")} onChange={(event) => set("skills", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} />
        </Field>
        <Field label="Target location">
          <input required maxLength={200} value={draft.location || ""} onChange={(event) => setLocation(event.target.value)} />
        </Field>
      </div>
      <fieldset className="chip-field guest-roles">
        <legend>Which role families should we search? <span>Choose one or more</span></legend>
        <div className="choice-chips">
          {ROLE_FAMILIES.map(([value, label]) => (
            <button key={value} type="button" className={`choice-chip ${(draft.roleFamilies || []).includes(value) ? "selected" : ""}`} aria-pressed={(draft.roleFamilies || []).includes(value)} onClick={() => toggleFamily(value)}>
              {(draft.roleFamilies || []).includes(value) && <Check size={14} />} {label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="essential-questions">
        <h2>Two eligibility details we cannot infer</h2>
        <div className="profile-summary-grid">
          <Field label="Australian work rights">
            <select value={draft.workRights || "unknown"} onChange={(event) => set("workRights", event.target.value)}>
              <option value="unknown">I’m not sure</option>
              <option value="citizen">Australian citizen</option>
              <option value="permanent-resident">Permanent resident</option>
              <option value="visa-unrestricted">Visa with unrestricted work rights</option>
              <option value="visa-limited">Visa with work limitations</option>
              <option value="none">No current Australian work rights</option>
            </select>
          </Field>
          <Field label="Do you need employer sponsorship?">
            <select value={draft.needsSponsorship || "unknown"} onChange={(event) => set("needsSponsorship", event.target.value)}>
              <option value="unknown">I’m not sure</option>
              <option value="no">No</option>
              <option value="now">Yes, now</option>
              <option value="later">Not now, but later</option>
            </select>
          </Field>
        </div>
        {showVisaLimitations && (
          <Field label="Visa work limitations (optional)" hint="Only practical limits such as hours, occupation, employer, location or expiry. Do not enter a visa number.">
            <textarea rows={3} maxLength={1000} value={draft.visaLimitations || ""} onChange={(event) => set("visaLimitations", event.target.value)} />
          </Field>
        )}
        <Field label="Other practical limitations (optional)" hint="For example, available from November or no regular overnight travel. Do not share sensitive personal details.">
          <textarea rows={3} maxLength={2000} value={draft.preferences?.limitations || ""} onChange={(event) => setPreference("limitations", event.target.value)} />
        </Field>
      </div>
      <details className="guest-resume-review">
        <summary>Review the full extracted resume text</summary>
        <p>Check roles, dates and achievements. This evidence supports your match reasons and letter drafts.</p>
        <textarea aria-label="Extracted resume text" rows={11} maxLength={80000} value={draft.resumeText || ""} onChange={(event) => set("resumeText", event.target.value)} />
      </details>
      <button type="button" className="optional-toggle" aria-expanded={showOptional} onClick={() => setShowOptional((value) => !value)}>
        {showOptional ? "Hide" : "Add"} optional job preferences
      </button>
      {showOptional && (
        <div className="profile-summary-grid optional-preferences">
          <Field label="Preferred job titles">
            <input value={(draft.preferences?.roleTitles || []).join(", ")} onChange={(event) => setPreference("roleTitles", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} />
          </Field>
          <Field label="Preferred work arrangement">
            <select value={draft.preferences?.workplaceTypes?.[0] || ""} onChange={(event) => setPreference("workplaceTypes", event.target.value ? [event.target.value] : [])}>
              <option value="">No preference</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="on-site">On-site</option>
            </select>
          </Field>
        </div>
      )}
      <label className="check-line guest-check">
        <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} />
        <span>I agree to the <a href="/terms.html" target="_blank" rel="noreferrer">terms</a> and acknowledge the <a href="/privacy.html" target="_blank" rel="noreferrer">privacy notice</a>.</span>
      </label>
      <label className="check-line guest-check">
        <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
        <span>I reviewed this profile and it reflects my experience and situation.</span>
      </label>
      {reviewed && errors.length > 0 && <div className="notice warning" role="alert">{errors[0]}</div>}
      <ErrorBox error={error} />
      <button className="button guest-primary" disabled={busy || !reviewed || !terms || errors.length > 0} onClick={() => onConfirm({ ...draft, confirmed: true })}>
        {busy ? <><LoaderCircle className="spin" size={18} /> Confirming</> : <><Search size={18} /> Find my best matches</>}
      </button>
    </section>
  );
}

function Evidence({ match }) {
  return (
    <div className="guest-evidence">
      {[
        ["matches", "What matches", CheckCircle2],
        ["gaps", "What does not match yet", X],
        ["needsConfirmation", "What to confirm", CircleHelp],
      ].map(([key, title, Icon]) => (
        <section key={key}>
          <h3><Icon size={18} /> {title}</h3>
          {match[key]?.length ? (
            <ul>{match[key].slice(0, 4).map((point, index) => <li key={index}>{typeof point === "string" ? point : point.text}</li>)}</ul>
          ) : <p className="subtle">No specific items recorded.</p>}
        </section>
      ))}
    </div>
  );
}

function MatchesStep({ data, busy, error, onIgnore, onInterested, onRestart }) {
  const [openId, setOpenId] = useState(null);
  const opportunities = (data?.opportunities || []).slice(0, 5);
  const source = data?.source || data?.search?.source;
  return (
    <section className="guest-results" aria-labelledby="matches-title">
      <div className="guest-results-heading">
        <div>
          <p className="eyebrow">YOUR STRONGEST CURRENT MATCHES</p>
          <h1 id="matches-title">A short list, with clear reasons.</h1>
          <p>We show no more than five high-fit Australian technology roles. A fit score is not a hiring probability.</p>
        </div>
        <span><Sparkles size={30} /></span>
      </div>
      {source && (
        <div className="guest-source-note" role="status">
          <ShieldCheck size={17} />
          <span>
            {source.message ||
              (source.status === "demo"
                ? "Synthetic local demonstration listings. These are not real opportunities."
                : `Current listings supplied by ${source.name || "Freehire"} and linked to the original employer source.`)}
          </span>
        </div>
      )}
      <ErrorBox error={error} />
      {opportunities.length === 0 ? (
        <div className="guest-card guest-empty">
          <Search size={30} />
          <h2>No high-fit role is ready to recommend yet.</h2>
          <p>We will not pad your list with weak matches. Review your role family or location, then search again.</p>
          <button className="button secondary" onClick={onRestart}>Review my profile</button>
        </div>
      ) : (
        <div className="guest-match-list">
          {opportunities.map((match, index) => {
            const job = match.job;
            const open = openId === job.id;
            const link = safeExternalUrl(job.url || job.sourceUrl);
            const lastChecked = formatSourceTime(job.lastSeenAt || source?.fetchedAt || job.updatedAt);
            const published = formatSourceTime(job.publishedAt);
            const closing = formatSourceTime(job.expiresAt);
            return (
              <article className="guest-match-card" key={job.id}>
                <div className="guest-match-top">
                  <span className={`company-monogram tone-${index % 4}`}>{job.company?.slice(0, 1).toUpperCase() || "R"}</span>
                  <div>
                    <span className="eyebrow">{job.company}</span>
                    <h2>{job.title}</h2>
                    <p><MapPin size={14} /> {job.location || "Australia"}</p>
                  </div>
                  <span className="guest-fit"><Sparkles size={13} /> {Number.isFinite(match.score) ? `${match.score}% fit` : "High fit"}</span>
                </div>
                <ul className="guest-match-preview">
                  {(match.matches || []).slice(0, 3).map((point, itemIndex) => <li key={itemIndex}><Check size={15} /> {typeof point === "string" ? point : point.text}</li>)}
                </ul>
                {match.needsConfirmation?.length > 0 && <p className="guest-confirm"><CircleHelp size={15} /> {match.needsConfirmation.length} item{match.needsConfirmation.length === 1 ? "" : "s"} to confirm</p>}
                <p className="guest-freshness">
                  <Clock3 size={15} />
                  {published ? `Published ${published}. ` : ""}
                  {lastChecked ? `Last checked ${lastChecked}.` : "Listing freshness is not available."}
                  {closing ? ` Closing date ${closing}.` : " The employer listing is authoritative; availability can change."}
                </p>
                <div className="guest-match-actions">
                  <button className="button secondary" aria-expanded={open} onClick={() => setOpenId(open ? null : job.id)}>{open ? "Hide details" : "View match details"}</button>
                  <button className="button" disabled={busy === job.id} onClick={() => onInterested(match)}>{busy === job.id ? <><LoaderCircle className="spin" size={17} /> Saving</> : <><Heart size={17} /> Interested</>}</button>
                  <button className="text-link" disabled={Boolean(busy)} onClick={() => onIgnore(match)}>Ignore</button>
                </div>
                {open && (
                  <div className="guest-match-details">
                    <Evidence match={match} />
                    <section>
                      <h3>About the opportunity</h3>
                      <p>{job.description || "Open the employer listing for the full description."}</p>
                    </section>
                    <div className="guest-source-row">
                      <span>{job.sourceDisplay || job.source || "Source listing"}</span>
                      {link && <a className="text-link" href={link} target="_blank" rel="noopener noreferrer">Original listing <ArrowUpRight size={15} /></a>}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="guest-results-footnote">Interested saves the role, then asks you to create an account and choose a cover-letter plan. Ignore keeps it out of this list.</p>
    </section>
  );
}

export default function GuestJourney({ config, onContinueAuth, onSignIn }) {
  const guestApi = useMemo(() => createGuestApi(config), [config]);
  const [situation, setSituation] = useState(blankSituation);
  const [session, setSession] = useState(readGuestState);
  const [bundle, setBundle] = useState(null);
  const [step, setStep] = useState(() => readGuestState()?.step || "situation");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const restored = useRef(false);
  const previousStep = useRef(step);

  useLayoutEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    document.getElementById("guest-main")?.focus({ preventScroll: false });
  }, [step]);

  useEffect(() => {
    if (!error) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector("#guest-main .notice.error")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [error]);

  useEffect(() => {
    if (!session?.token || restored.current) return;
    restored.current = true;
    setBusy("restore");
    setRestoreFailed(false);
    setError(null);
    guestApi("/guest/session", { token: session.token })
      .then((result) => {
        setBundle(result.guest || result);
        const next = guestStepFrom(result.guest || result);
        setStep(next === "searching" ? "review" : next);
      })
      .catch((failure) => {
        if (guestRestoreRecovery(failure) === "restart") {
          clearGuestState();
          setSession(null);
          setStep("situation");
        } else {
          setRestoreFailed(true);
          setError(failure);
        }
      })
      .finally(() => setBusy(""));
  }, [guestApi, restoreAttempt, session?.token]);

  function retryRestore() {
    restored.current = false;
    setRestoreFailed(false);
    setError(null);
    setRestoreAttempt((attempt) => attempt + 1);
  }

  function restartAfterRestoreFailure() {
    clearGuestState();
    restored.current = false;
    setSession(null);
    setBundle(null);
    setStep("situation");
    setRestoreFailed(false);
    setError(null);
  }

  function persist(nextStep, result, token = session?.token) {
    const expiresAt = result?.expiresAt || result?.guest?.expiresAt || session?.expiresAt;
    const next = saveGuestState({ token, expiresAt, step: nextStep });
    setSession(next);
    setStep(nextStep);
  }

  async function start(event) {
    event.preventDefault();
    setBusy("start");
    setError(null);
    try {
      const result = await guestApi("/guest/start", situation);
      const token = result.token;
      if (typeof token !== "string" || token.length < 32) throw new Error("The private guest session could not be created.");
      setBundle(result.guest || { situation });
      persist("resume", result, token);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy("");
    }
  }

  async function upload(file, consent) {
    const extension = file?.name?.split(".").pop()?.toLowerCase();
    if (!file || !["pdf", "docx"].includes(extension)) return setError(new Error("Choose a PDF or DOCX resume."));
    if (!file.size || file.size > GUEST_RESUME_MAX_BYTES) return setError(new Error("Choose a non-empty resume no larger than 4 MB."));
    setBusy("upload");
    setError(null);
    try {
      const dataBase64 = await fileToBase64(file);
      const contentType = extension === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const result = await guestApi("/guest/resume", { token: session.token, consent, filename: file.name, contentType, dataBase64 });
      const nextBundle = result.guest || { ...bundle, profile: result.profile };
      setBundle(nextBundle);
      persist("review", result);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy("");
    }
  }

  async function confirm(profile) {
    setBusy("confirm");
    setError(null);
    try {
      const result = await guestApi("/guest/profile", { token: session.token, profile, termsAccepted: true, reviewed: true });
      const nextBundle = result.guest || { ...bundle, profile: result.profile || profile };
      setBundle(nextBundle);
      persist("searching", result);
      setBusy("search");
      const searchResult = await guestApi("/guest/search", { token: session.token });
      setBundle(searchResult.guest || { ...nextBundle, ...searchResult });
      persist("matches", searchResult);
    } catch (failure) {
      setError(failure);
      setStep("review");
      saveGuestState({ ...session, step: "review" });
    } finally {
      setBusy("");
    }
  }

  async function ignore(match) {
    setBusy(match.job.id);
    setError(null);
    try {
      const result = await guestApi("/guest/ignore", { token: session.token, jobId: match.job.id });
      setBundle(result.guest || { ...bundle, opportunities: result.opportunities || [] });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy("");
    }
  }

  function interested(match) {
    saveContinuation({ token: session.token, jobId: match.job.id, awaitingAuth: true, claimed: false });
    onContinueAuth({ token: session.token, jobId: match.job.id });
  }

  if (busy === "restore" && !bundle) {
    return (
      <GuestShell step={step} onSignIn={onSignIn}>
        <div className="guest-loading" role="status"><LoaderCircle className="spin" /> Restoring your private guest session</div>
      </GuestShell>
    );
  }
  if (restoreFailed && !bundle) {
    return (
      <GuestShell step={step} onSignIn={onSignIn}>
        <GuestRestoreFailure
          error={error}
          onRetry={retryRestore}
          onRestart={restartAfterRestoreFailure}
        />
      </GuestShell>
    );
  }
  return (
    <GuestShell step={step} onSignIn={onSignIn}>
      {step === "situation" && <SituationStep value={situation} setValue={setSituation} busy={busy === "start"} error={error} onSubmit={start} />}
      {step === "resume" && <ResumeStep busy={busy === "upload"} error={error} onUpload={upload} onBack={() => { clearGuestState(); setSession(null); setBundle(null); setStep("situation"); setError(null); }} />}
      {step === "review" && bundle?.profile && <ReviewStep key={bundle.profile.resumeText?.length || 0} initial={bundle.profile} busy={busy === "confirm"} error={error} onBack={() => { setStep("resume"); saveGuestState({ ...session, step: "resume" }); setError(null); }} onConfirm={confirm} />}
      {step === "searching" && <div className="guest-searching" role="status" aria-live="polite"><span><Search size={30} /><Sparkles size={20} /></span><h1>Finding the common ground.</h1><p>We are checking current Australian technology roles against the evidence you confirmed.</p><div><LoaderCircle className="spin" size={20} /> Searching and ranking high-fit roles</div></div>}
      {step === "matches" && <MatchesStep data={bundle} busy={busy} error={error} onIgnore={ignore} onInterested={interested} onRestart={() => { setStep("review"); saveGuestState({ ...session, step: "review" }); }} />}
    </GuestShell>
  );
}
