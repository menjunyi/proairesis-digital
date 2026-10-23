import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  FileText,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  ROLE_FAMILY_OPTIONS,
  SITUATION_OPTIONS,
  SPONSORSHIP_OPTIONS,
  WORK_RIGHTS_OPTIONS,
  createIntake,
  eligibilityAfterWorkRights,
  intakeErrors,
  intakeSummary,
} from "./intake.js";

const screens = ["Your goal", "Your search", "Your limits", "Anything else", "Review"];

function AnswerButtons({ legend, value, options, onChange }) {
  return (
    <fieldset className="interview-answer-group">
      <legend>{legend}</legend>
      <div className="interview-answer-list">
        {options.map(([option, label]) => (
          <button
            className={value === option ? "selected" : ""}
            type="button"
            key={option}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            <span>{value === option && <Check size={16} />}</span>
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function InterviewError({ error }) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      <CircleHelp size={18} />
      <div>{error.message || String(error)}</div>
    </div>
  );
}

function ResumePromise({ compact = false }) {
  return (
    <div className={`interview-resume-promise${compact ? " compact" : ""}`}>
      <span><FileText size={22} /></span>
      <div>
        <strong>Your resume is the shortcut, not the starting question.</strong>
        <p>
          Upload it after this chat. RoleClue will pull out supported skills and
          experience so you do not type them again. You review the combined
          profile before we search.
        </p>
      </div>
    </div>
  );
}

export default function CareerInterview({
  initialValue,
  onComplete,
  busy = false,
  error = null,
  guestMode = false,
}) {
  const initial = useMemo(() => createIntake(initialValue), [initialValue]);
  const [draft, setDraft] = useState(initial);
  const [screen, setScreen] = useState(initial.interviewCompleted ? 4 : 0);
  const [localError, setLocalError] = useState("");
  const headingRef = useRef(null);
  const summary = intakeSummary(draft);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [screen]);

  const set = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value, interviewCompleted: false }));
    setLocalError("");
  };

  const chooseWorkRights = (value) => {
    setDraft((current) => ({
      ...current,
      ...eligibilityAfterWorkRights(current, value),
      interviewCompleted: false,
    }));
    setLocalError("");
  };

  const toggleRole = (role) => {
    const selected = draft.roleFamilies.includes(role);
    if (!selected && draft.roleFamilies.length >= 3) {
      setLocalError("Choose up to three areas so the first search stays focused.");
      return;
    }
    set(
      "roleFamilies",
      selected
        ? draft.roleFamilies.filter((candidate) => candidate !== role)
        : [...draft.roleFamilies, role],
    );
  };

  const continueFrom = (event) => {
    event.preventDefault();
    const errors = intakeErrors(draft, screen);
    if (errors.length) {
      setLocalError(errors[0]);
      return;
    }
    setLocalError("");
    setScreen((current) => Math.min(4, current + 1));
  };

  const submit = () => {
    const errors = intakeErrors(draft);
    if (errors.length) {
      setLocalError(errors[0]);
      return;
    }
    onComplete?.({ ...createIntake(draft), interviewCompleted: true });
  };

  const understood = summary
    .filter(
      (item) =>
        item.value &&
        !item.value.includes("Not answered") &&
        item.value !== "No additional limits supplied",
    )
    .slice(0, 3);

  return (
    <section className="guest-card career-interview" aria-labelledby="interview-title">
      <div className="interview-progress" aria-label={`Interview question ${screen + 1} of 5`}>
        <span>{screen === 4 ? "Review" : `Question ${screen + 1} of 4`}</span>
        <div aria-hidden="true">
          {screens.map((item, index) => (
            <i key={item} className={index <= screen ? "active" : ""} />
          ))}
        </div>
      </div>

      <div className="career-interview-layout">
        <div className="interview-question">
          {screen > 0 && screen < 4 && (
            <button
              className="guest-back"
              type="button"
              onClick={() => {
                setLocalError("");
                setScreen((current) => current - 1);
              }}
            >
              <ArrowLeft size={16} /> Back
            </button>
          )}

          {screen === 0 && (
            <form onSubmit={continueFrom}>
              <p className="eyebrow">A QUICK CONVERSATION ABOUT YOUR SEARCH</p>
              <h1 id="interview-title" ref={headingRef} tabIndex={-1}>
                What kind of work would feel like the right next move?
              </h1>
              <p className="guest-lead">
                Choose up to three areas. We’ll use them as the focus, then learn
                what a suitable role needs to respect.
              </p>
              <fieldset className="interview-role-field">
                <legend className="sr-only">Target areas</legend>
                <div className="choice-chips interview-role-chips">
                  {ROLE_FAMILY_OPTIONS.map(([value, label]) => {
                    const selected = draft.roleFamilies.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        className={`choice-chip${selected ? " selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => toggleRole(value)}
                      >
                        {selected && <Check size={14} />} {label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <ResumePromise compact />
              {localError && <p className="interview-error" role="alert">{localError}</p>}
              <button className="button guest-primary" type="submit">
                Continue the conversation <ArrowRight size={18} />
              </button>
            </form>
          )}

          {screen === 1 && (
            <form onSubmit={continueFrom}>
              <p className="eyebrow">NOW, THE SEARCH ITSELF</p>
              <h1 id="interview-title" ref={headingRef} tabIndex={-1}>
                Where are you now, and where should the job be?
              </h1>
              <AnswerButtons
                legend="Where are you in your search?"
                value={draft.situation}
                options={SITUATION_OPTIONS}
                onChange={(value) => set("situation", value)}
              />
              <div className="field interview-location">
                <label htmlFor="interview-location">Where do you want to work?</label>
                <input
                  id="interview-location"
                  maxLength={200}
                  placeholder="For example, Melbourne, VIC"
                  value={draft.location}
                  onChange={(event) => set("location", event.target.value)}
                />
                <small>Enter an Australian city, state or region.</small>
              </div>
              <label className="check-line guest-check">
                <input
                  type="checkbox"
                  checked={draft.remote}
                  onChange={(event) => set("remote", event.target.checked)}
                />
                <span>Also include remote roles available to people in Australia</span>
              </label>
              {localError && <p className="interview-error" role="alert">{localError}</p>}
              <button className="button guest-primary" type="submit">
                Continue <ArrowRight size={18} />
              </button>
            </form>
          )}

          {screen === 2 && (
            <form onSubmit={continueFrom}>
              <p className="eyebrow">ONLY WHAT CHANGES YOUR ELIGIBILITY</p>
              <h1 id="interview-title" ref={headingRef} tabIndex={-1}>
                What must an employer know about your right to work?
              </h1>
              <p className="guest-lead">
                This keeps unsuitable roles out. “I’m not sure” is a valid answer.
              </p>
              <AnswerButtons
                legend="Your current right to work in Australia"
                value={draft.workRights}
                options={WORK_RIGHTS_OPTIONS}
                onChange={chooseWorkRights}
              />
              {!(["citizen", "permanent-resident"].includes(draft.workRights)) && (
                <AnswerButtons
                  legend="Do you need an employer to sponsor your visa?"
                  value={draft.needsSponsorship}
                  options={SPONSORSHIP_OPTIONS}
                  onChange={(value) => set("needsSponsorship", value)}
                />
              )}
              {localError && <p className="interview-error" role="alert">{localError}</p>}
              <button className="button guest-primary" type="submit">
                Continue <ArrowRight size={18} />
              </button>
            </form>
          )}

          {screen === 3 && (
            <form onSubmit={continueFrom}>
              <p className="eyebrow">MAKE THE SEARCH FIT REAL LIFE</p>
              <h1 id="interview-title" ref={headingRef} tabIndex={-1}>
                Is there anything a suitable job must work around?
              </h1>
              <p className="guest-lead">
                These answers are optional. Add only what should affect which jobs
                we show you.
              </p>
              {["visa-limited", "unknown", "none"].includes(draft.workRights) && (
                <div className="field">
                  <label htmlFor="interview-visa-limits">Visa or work-right limits</label>
                  <textarea
                    id="interview-visa-limits"
                    rows={3}
                    maxLength={1000}
                    placeholder="For example, limited hours, occupation, employer, location or expiry. Do not enter a visa number."
                    value={draft.visaLimitations}
                    onChange={(event) => set("visaLimitations", event.target.value)}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor="interview-other-limits">Other practical limits</label>
                <textarea
                  id="interview-other-limits"
                  rows={4}
                  maxLength={2000}
                  placeholder="For example, start date, hours, office attendance or travel you cannot accept."
                  value={draft.limitations}
                  onChange={(event) => set("limitations", event.target.value)}
                />
              </div>
              {localError && <p className="interview-error" role="alert">{localError}</p>}
              <button className="button guest-primary" type="submit">
                Show what you understood <ArrowRight size={18} />
              </button>
            </form>
          )}

          {screen === 4 && (
            <div>
              <p className="eyebrow">HERE’S WHAT I HEARD</p>
              <h1 id="interview-title" ref={headingRef} tabIndex={-1}>
                Does this describe the search you want?
              </h1>
              <p className="guest-lead">
                Edit anything that is not right. Your answers remain in control
                when we add resume evidence.
              </p>
              <dl className="interview-review-list">
                {summary.map((item) => (
                  <div key={item.key}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                    <button type="button" onClick={() => setScreen(item.screen)}>
                      Edit<span className="sr-only"> {item.label}</span>
                    </button>
                  </div>
                ))}
              </dl>
              <ResumePromise />
              <div className="interview-resume-details">
                <strong>The upload can add:</strong>
                <ul>
                  <li>skills and technologies supported by your resume</li>
                  <li>experience length and likely role direction</li>
                  <li>evidence for match explanations and cover-letter drafts</li>
                </ul>
                <p><ShieldCheck size={16} /> It never decides your visa, citizenship or sponsorship situation.</p>
              </div>
              {localError && <p className="interview-error" role="alert">{localError}</p>}
              <InterviewError error={error} />
              {guestMode && (
                <div className="guest-privacy-note interview-retention-note">
                  <ShieldCheck size={18} />
                  <div>
                    <strong>Private, short-lived guest session</strong>
                    <p>When you continue, we save these answers for this search. Unclaimed guest data expires within 24 hours.</p>
                  </div>
                </div>
              )}
              <button className="button guest-primary" type="button" disabled={busy} onClick={submit}>
                {busy ? (
                  <><LoaderCircle className="spin" size={18} /> Saving my answers</>
                ) : (
                  <>Use my resume as a shortcut <ArrowRight size={18} /></>
                )}
              </button>
              <p className="guest-trust"><ShieldCheck size={16} /> {guestMode ? "No account is needed until you choose a job you’re interested in." : "You can review and correct the combined profile before we search."}</p>
            </div>
          )}
        </div>

        {screen < 4 && (
          <aside className="interview-understanding" aria-live="polite">
            <span><Sparkles size={19} /></span>
            <p className="eyebrow">WHAT I UNDERSTAND SO FAR</p>
            {understood.length ? (
              <ul>
                {understood.map((item) => (
                  <li key={item.key}><strong>{item.label}</strong>{item.value}</li>
                ))}
              </ul>
            ) : (
              <p>Your answers will appear here as we build the search together.</p>
            )}
            <small>We use only what you tell us. You can edit every answer before the search.</small>
          </aside>
        )}
      </div>
    </section>
  );
}
