import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  FileText,
  Globe2,
  Heart,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  MapPin,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";
import {
  captureSessionGuard,
  clearSession,
  completeHostedSignIn,
  confirmSignUp,
  forgotPassword,
  readSession,
  resendCode,
  resetPassword,
  signIn,
  signOut,
  signUp,
  startDemo,
  startHostedSignIn,
} from "./auth";
import {
  createApi,
  downloadText,
  loadAccountExport,
  loadAllApplications,
  loadConfig,
  refreshBillingStatus,
  safeExternalUrl,
  saveOpportunityDecision,
  uploadResume,
} from "./api";
import { canRequestLetter, listingAvailability } from "./availability";
import {
  capabilitiesFor,
  continuationRecovery,
  generationFailureMessage,
  guestJourneyAvailable,
  memberRoute,
  mergeApplicationUpdate,
  mergeResumeUpload,
  opportunityLoadRequest,
  selectedApplicationId,
} from "./ui-state";
import {
  billingCheckoutBody,
  billingPresentation,
  billingReturnKind,
  billingReturnOutcome,
  billingReturnPlan,
} from "./billing-state";
import GuestJourney from "./GuestJourney.jsx";
import {
  clearAccountBrowserState,
  clearContinuation,
  clearGuestState,
  completedContinuationApplicationId,
  readContinuation,
  reconcileClaimedContinuation,
  rememberApplication,
  saveContinuation,
  takeRememberedApplication,
} from "./guest-state.js";

const families = [
  ["software", "Software engineering"],
  ["data", "Data & analytics"],
  ["cloud", "Cloud & infrastructure"],
  ["security", "Cybersecurity"],
  ["quality", "Quality & testing"],
  ["product", "Product"],
  ["design", "Design"],
  ["it-support", "IT support"],
  ["business-analysis", "Business analysis"],
];
const statuses = [
  "interested",
  "preparing",
  "applied",
  "interview",
  "offer",
  "closed",
];
const blankProfile = {
  name: "",
  email: "",
  resumeText: "",
  skills: [],
  roleFamilies: [],
  yearsExperience: null,
  situation: "actively-looking",
  location: "",
  workRights: "unknown",
  needsSponsorship: "unknown",
  visaLimitations: "",
  clearance: "unknown",
  preferences: {
    locations: [],
    workplaceTypes: [],
    employmentTypes: [],
    roleTitles: [],
    minimumSalary: null,
    salaryPeriod: "year",
    seniority: [],
    relocation: false,
    limitations: "",
  },
  confirmed: false,
  consentAt: null,
};
const label = (value) =>
  String(value || "Not specified")
    .replace(/[-_]/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
const date = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Not available";
const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not available";
const split = (value) =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const cx = (...values) => values.filter(Boolean).join(" ");

function Mark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <path d="M24 6H12a6 6 0 0 0-6 6v18h8V14h10V6Z" fill="currentColor" />
      <path d="M24 42h12a6 6 0 0 0 6-6V18h-8v16H24v8Z" fill="currentColor" />
      <circle cx="24" cy="24" r="5" fill="currentColor" />
    </svg>
  );
}
function Brand({ light = false }) {
  return (
    <a
      className={cx("brand", light && "light")}
      href="#opportunities"
      aria-label="RoleClue home"
    >
      <Mark />
      <span>RoleClue</span>
    </a>
  );
}
function Spinner({ children = "Loading…" }) {
  return (
    <span className="loading-inline" role="status">
      <LoaderCircle size={17} className="spin" />
      {children}
    </span>
  );
}
function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      <CircleHelp size={18} />
      <div>
        {error.message || String(error)}
        {error.requestId && <small>Reference: {error.requestId}</small>}
      </div>
    </div>
  );
}
function Empty({ icon: Icon = Search, title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={26} />
      </span>
      <h2>{title}</h2>
      <div className="empty-description">{children}</div>
      {action}
    </div>
  );
}
function Pill({ children, tone = "mint" }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
function BetaNotice({ config, banner = false }) {
  if (
    config.mode === "demo" ||
    typeof config.betaNotice !== "string" ||
    !config.betaNotice.trim()
  )
    return null;
  return (
    <div className={cx("beta-notice", banner && "beta-banner")} role="status">
      <CircleHelp size={17} />
      <span>{config.betaNotice}</span>
    </div>
  );
}
function Field({ label: text, hint, children, className = "" }) {
  const id = React.useId();
  let bound = false;
  const bindControl = (nodes) =>
    React.Children.map(nodes, (node) => {
      if (!React.isValidElement(node)) return node;
      if (!bound && ["input", "select", "textarea"].includes(node.type)) {
        bound = true;
        return React.cloneElement(node, {
          id,
          "aria-describedby": hint ? `${id}-hint` : undefined,
        });
      }
      return node.props.children
        ? React.cloneElement(node, {}, bindControl(node.props.children))
        : node;
    });
  return (
    <div className={cx("field", className)}>
      <label htmlFor={id}>{text}</label>
      {bindControl(children)}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
function ExternalLink({ href, children, className = "text-link" }) {
  const url = safeExternalUrl(href);
  return url ? (
    <a
      className={className}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ArrowUpRight size={15} />
    </a>
  ) : null;
}

export default function App() {
  const [config, setConfig] = useState(null),
    [configError, setConfigError] = useState(null);
  const [authCompleting, setAuthCompleting] = useState(false),
    [authError, setAuthError] = useState(null);
  const [session, setSession] = useState(readSession),
    [me, setMe] = useState(null),
    [error, setError] = useState(null);
  const [loading, setLoading] = useState(false),
    [route, setRoute] = useState(
      window.location.hash.slice(1) || "opportunities",
    );
  const [menu, setMenu] = useState(false),
    [notice, setNotice] = useState(""),
    [paywall, setPaywall] = useState(false),
    [showGateAccount, setShowGateAccount] = useState(false);
  const [showAuth, setShowAuth] = useState(
      () => readContinuation()?.awaitingAuth === true,
    ),
    [continuation, setContinuation] = useState(readContinuation),
    [continuationStatus, setContinuationStatus] = useState(""),
    [continuationError, setContinuationError] = useState(null),
    [continuationGateMessage, setContinuationGateMessage] = useState(""),
    [continuationAttempt, setContinuationAttempt] = useState(0),
    [applicationTarget, setApplicationTarget] = useState(
      takeRememberedApplication,
    );
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 800px)").matches,
  );
  const sessionVersion = useRef(0);
  const renderedSessionVersion = sessionVersion.current;
  const menuButton = useRef(null);
  const sidebar = useRef(null);
  const claimPending = useRef(false);
  const completionPending = useRef(false);
  const capabilities = capabilitiesFor(config, me?.capabilities);
  const guestSearchAvailable = guestJourneyAvailable(config);
  const api = useMemo(() => (config ? createApi(config) : null), [config]);
  useEffect(() => {
    loadConfig().then(setConfig).catch(setConfigError);
  }, []);
  useEffect(() => {
    const authQuery = new URLSearchParams(window.location.search);
    if (!config || session || (!authQuery.has("code") && !authQuery.has("error")))
      return;
    let active = true;
    setAuthCompleting(true);
    setAuthError(null);
    completeHostedSignIn(config)
      .then((next) => {
        if (active && next) acceptSession(next);
      })
      .catch((failure) => {
        if (active) {
          setAuthError(failure);
          setShowAuth(true);
        }
      })
      .finally(() => {
        if (active) setAuthCompleting(false);
      });
    return () => {
      active = false;
    };
  }, [config, session]);
  useEffect(() => {
    const handler = () => {
      const next = window.location.hash.slice(1);
      if (next !== "main") setRoute(next || "opportunities");
      setMenu(false);
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const update = () => {
      setMobile(media.matches);
      if (!media.matches) setMenu(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!menu || !mobile) return;
    const panel = sidebar.current;
    const opener = menuButton.current;
    const focusable = [
      ...(panel?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || []),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    first?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setMenu(false);
        return;
      }
      if (event.key !== "Tab" || !first || !last) return;
      const outside = !panel?.contains(document.activeElement);
      if (event.shiftKey && (outside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [menu, mobile]);
  function acceptSession(next) {
    sessionVersion.current += 1;
    setMe(null);
    setError(null);
    const pending = readContinuation();
    if (pending) {
      const updated = saveContinuation({ awaitingAuth: false });
      setContinuation(updated);
    }
    setSession(next);
  }
  function acceptAccount(result) {
    const nextContinuation = reconcileClaimedContinuation(
      readContinuation(),
      result?.continuation,
    );
    setContinuation(nextContinuation);
    setMe(result);
    return result;
  }
  async function refreshMe() {
    const version = sessionVersion.current;
    const result = await api("/me");
    if (version !== sessionVersion.current || !readSession())
      throw new Error("Your session changed. Please sign in again.");
    return acceptAccount(result);
  }
  async function openContinuationApplication(applicationId) {
    if (!api || !applicationId || completionPending.current) return;
    completionPending.current = true;
    setContinuationStatus("completing");
    setContinuationError(null);
    try {
      const result = await api("/continuation/complete", {
        method: "POST",
        body: { applicationId },
      });
      const completedId = completedContinuationApplicationId(result);
      if (completedId) rememberApplication(completedId);
      setApplicationTarget(completedId);
      setMe((current) =>
        current ? { ...current, continuation: null } : current,
      );
      clearContinuation();
      setContinuation(null);
      setContinuationGateMessage("");
      setContinuationStatus("");
      window.location.hash = "applications";
    } catch (failure) {
      if (failure.status === 402) {
        setMe((current) =>
          current
            ? {
                ...current,
                billing: {
                  ...current.billing,
                  canGenerate: false,
                  remaining: 0,
                  reason: failure.code || "PAYMENT_REQUIRED",
                },
              }
            : current,
        );
        setContinuationGateMessage(
          "Paid access could not be verified. Your application remains saved. Choose an available plan or check payment again.",
        );
        setContinuationStatus("");
        try {
          await refreshMe();
        } catch {
          // Keep the conservative no-access view until the account can refresh.
        }
        return;
      }
      setContinuationError(failure);
      setContinuationStatus("completion-error");
    } finally {
      completionPending.current = false;
    }
  }
  async function openExistingWorkspace() {
    if (!api || !continuation?.token || claimPending.current) return;
    claimPending.current = true;
    setContinuationStatus("resolving");
    setContinuationError(null);
    try {
      const result = await api("/guest/abandon", {
        method: "POST",
        body: { token: continuation.token },
      });
      clearGuestState();
      clearContinuation();
      setContinuation(null);
      setContinuationStatus("");
      setShowAuth(false);
      setMe(result.account || (await refreshMe()));
      window.location.hash = "opportunities";
    } catch (failure) {
      setContinuationError(failure);
      setContinuationStatus("error");
    } finally {
      claimPending.current = false;
    }
  }
  useEffect(() => {
    if (!api || !session) return;
    let active = true;
    const version = sessionVersion.current;
    setLoading(true);
    setError(null);
    api("/me")
      .then((result) => {
        if (active && version === sessionVersion.current && readSession())
          acceptAccount(result);
      })
      .catch((err) => {
        if (active && version === sessionVersion.current) {
          setError(err);
          if (!readSession()) setSession(null);
        }
      })
      .finally(() => {
        if (active && version === sessionVersion.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, session]);
  useEffect(() => {
    if (
      !api ||
      !session ||
      !me ||
      !continuation?.token ||
      !continuation?.jobId ||
      continuation.claimed ||
      claimPending.current
    )
      return;
    let active = true;
    claimPending.current = true;
    setContinuationStatus("claiming");
    setContinuationError(null);
    api("/guest/claim", {
      method: "POST",
      body: {
        token: continuation.token,
        interestedJobId: continuation.jobId,
      },
    })
      .then(async (result) => {
        if (!active) return;
        const applicationId = result.application?.id || result.applicationId;
        if (!applicationId)
          throw new Error("Your selected opportunity could not be linked to the account.");
        const next = saveContinuation({
          applicationId,
          claimed: true,
          awaitingAuth: false,
        });
        clearGuestState();
        setContinuationStatus("");
        setMe((current) => ({
          ...current,
          ...(result.profile ? { profile: result.profile } : {}),
          ...(result.billing ? { billing: result.billing } : {}),
          ...(result.continuation
            ? { continuation: result.continuation }
            : {}),
        }));
        setContinuation(next);
        await refreshMe();
      })
      .catch((failure) => {
        if (active) {
          setContinuationError(failure);
          setContinuationStatus("error");
        }
      })
      .finally(() => {
        claimPending.current = false;
      });
    return () => {
      active = false;
    };
  }, [api, session, me, continuation?.token, continuation?.jobId, continuation?.claimed, continuationAttempt]);
  useEffect(() => {
    if (!continuation?.applicationId || !me?.billing?.canGenerate) return;
    void openContinuationApplication(continuation.applicationId);
  }, [continuation?.applicationId, me?.billing?.canGenerate]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5500);
    return () => clearTimeout(timer);
  }, [notice]);
  function logout() {
    void signOut(config);
    sessionVersion.current += 1;
    setSession(null);
    setMe(null);
    setContinuation(null);
    setContinuationStatus("");
    setContinuationError(null);
    setContinuationGateMessage("");
    setApplicationTarget(null);
    setNotice("");
    setPaywall(false);
    setShowGateAccount(false);
    setMenu(false);
    setShowAuth(true);
  }
  function openWorkspaceAfterClaimFailure() {
    clearGuestState();
    clearContinuation();
    setContinuation(null);
    setApplicationTarget(null);
    setContinuationError(null);
    setContinuationStatus("");
    setShowAuth(false);
    window.location.hash = me?.profile?.confirmed ? "opportunities" : "profile";
  }
  function returnToGuestSearch(restart = false) {
    if (restart) clearGuestState();
    clearContinuation();
    setContinuation(null);
    setApplicationTarget(null);
    setContinuationError(null);
    setContinuationStatus("");
    setShowAuth(false);
    setPaywall(false);
    setShowGateAccount(false);
    sessionVersion.current += 1;
    void signOut(config, { preserveGuestState: !restart });
    setSession(null);
    setMe(null);
    window.location.hash = "";
  }
  const onProfileSaved = async (profile) => {
    if (
      renderedSessionVersion !== sessionVersion.current ||
      readSession()?.email !== session?.email
    )
      throw new Error("Your session changed. Please sign in again.");
    setMe((current) => ({ ...current, profile }));
    await refreshMe();
    window.location.hash = "opportunities";
    setNotice("Your profile is saved. Your shortlist now reflects these details.");
  };
  if (configError)
    return (
      <div className="standalone">
        <Brand />
        <Empty title="We couldn’t open RoleClue">
          <ErrorBox error={configError} />
          <button className="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </Empty>
      </div>
    );
  if (!config || authCompleting)
    return (
      <div className="full-loading">
        <Brand />
        <Spinner>Opening your workspace</Spinner>
      </div>
    );
  if (!session) {
    if (showAuth || continuation?.awaitingAuth || !guestSearchAvailable)
      return (
        <AuthScreen
          config={config}
          onSession={acceptSession}
          continuation={Boolean(continuation?.jobId)}
          initialError={authError}
          onBack={
            guestSearchAvailable
              ? continuation?.jobId
                ? () => {
                    const next = saveContinuation({ awaitingAuth: false });
                    setContinuation(next);
                    setShowAuth(false);
                  }
                : () => setShowAuth(false)
              : undefined
          }
        />
      );
    return (
      <GuestJourney
        config={config}
        onSignIn={() => setShowAuth(true)}
        onContinueAuth={(value) => {
          const next = saveContinuation({ ...value, awaitingAuth: true });
          setContinuation(next);
          setShowAuth(true);
        }}
      />
    );
  }
  if (
    ["claiming", "completing", "resolving"].includes(continuationStatus) ||
    (continuation && !me) ||
    (me?.continuation?.pendingApplicationId && !continuation?.applicationId)
  )
    return (
      <div className="full-loading">
        <Brand />
        <Spinner>
          {continuationStatus === "completing"
            ? "Opening your selected application"
            : continuationStatus === "resolving"
              ? "Opening your existing workspace"
            : me?.continuation?.pendingApplicationId && !continuation?.applicationId
              ? "Restoring your selected application"
            : "Saving your profile and selected opportunity"}
        </Spinner>
      </div>
    );
  if (continuationStatus === "error") {
    const recovery = continuationRecovery(continuationError);
    const profileConflict = recovery === "existing-profile";
    const reviewMatches = recovery === "review-matches";
    const restartSearch = recovery === "restart";
    return (
      <div className="standalone continuation-error">
        <Brand />
        <Empty
          title={
            profileConflict
              ? "This account already has a confirmed profile."
              : reviewMatches
                ? "This role needs a fresh match check."
                : restartSearch
                  ? "This guest match can no longer continue."
                  : recovery === "retry"
                    ? "Your selected role is still safe."
                    : "We couldn’t continue this guest match."
          }
        >
          <ErrorBox error={continuationError} />
          {profileConflict ? (
            <>
              <p>RoleClue will not replace your saved profile. Open your existing workspace, or use another account for this guest profile.</p>
              <button className="button" onClick={() => void openExistingWorkspace()}>
                Open my existing workspace
              </button>
            </>
          ) : reviewMatches ? (
            <>
              <p>The selected role is no longer a current high-fit choice. Return to the latest guest results and choose again.</p>
              <button className="button" onClick={() => returnToGuestSearch(false)}>
                Review current matches
              </button>
              <button className="button secondary" onClick={openWorkspaceAfterClaimFailure}>
                Open my workspace
              </button>
            </>
          ) : restartSearch ? (
            <>
              <p>The old guest session cannot be restored. Start a new private search, or continue in your signed-in workspace.</p>
              <button className="button" onClick={() => returnToGuestSearch(true)}>
                Start a new search
              </button>
              <button className="button secondary" onClick={openWorkspaceAfterClaimFailure}>
                Open my workspace
              </button>
            </>
          ) : recovery === "retry" ? (
            <button
              className="button"
              onClick={() => {
                setContinuationStatus("");
                setContinuationError(null);
                claimPending.current = false;
                setContinuationAttempt((value) => value + 1);
              }}
            >
              Try again
            </button>
          ) : (
            <>
              <p>This request cannot be repeated safely. Open your workspace or start a new search.</p>
              <button className="button" onClick={openWorkspaceAfterClaimFailure}>Open my workspace</button>
              <button className="button secondary" onClick={() => returnToGuestSearch(true)}>Start a new search</button>
            </>
          )}
          {(profileConflict || recovery === "retry") && (
            <button className="button secondary" onClick={logout}>Sign in with another account</button>
          )}
        </Empty>
      </div>
    );
  }
  if (continuationStatus === "completion-error")
    return (
      <div className="standalone continuation-error">
        <Brand />
        <Empty title="We couldn’t verify access yet. Your application is still saved.">
          <ErrorBox error={continuationError} />
          <button
            className="button"
            onClick={() =>
              void openContinuationApplication(continuation?.applicationId)
            }
          >
            Check access again
          </button>
          <button className="button secondary" onClick={logout}>
            Sign out
          </button>
        </Empty>
      </div>
    );
  const continuationNeedsPayment =
    me &&
    continuation?.claimed &&
    continuation?.applicationId &&
    !me.billing?.canGenerate;
  if (continuationNeedsPayment && showGateAccount)
    return (
      <div className="plan-gate gated-account-access">
        <header className="plan-gate-header">
          <Brand />
          <div className="gated-account-actions">
            <button className="text-link" onClick={() => setShowGateAccount(false)}>Back to plans</button>
            <button className="text-link" onClick={logout}>Sign out</button>
          </div>
        </header>
        <main className="plan-gate-main gated-account-main">
          <div className="notice neutral" role="status">
            Your application workspace stays locked until payment is verified. You can still export or delete your account data.
          </div>
          <AccountScreen
            api={api}
            config={config}
            me={me}
            dataOnly
            onBilling={(billing) => setMe((value) => ({ ...value, billing }))}
            onUpgrade={() => setShowGateAccount(false)}
            onNotice={setNotice}
            onDeleted={() => {
              clearSession();
              clearAccountBrowserState();
              sessionVersion.current += 1;
              setSession(null);
              setMe(null);
              setContinuation(null);
              setApplicationTarget(null);
              setShowGateAccount(false);
            }}
          />
        </main>
        {notice && (
          <div className="toast" role="status">
            <CheckCircle2 size={19} />
            {notice}
            <button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={15} /></button>
          </div>
        )}
      </div>
    );
  if (continuationNeedsPayment)
    return (
      <PlanGate
        api={api}
        billing={me.billing}
        applicationId={continuation.applicationId}
        initialMessage={continuationGateMessage}
        onBilling={(billing) => setMe((value) => ({ ...value, billing }))}
        onReady={() =>
          void openContinuationApplication(continuation.applicationId)
        }
        onManageAccount={() => setShowGateAccount(true)}
        onSignOut={logout}
      />
    );
  const onboarding = me && !me.profile?.confirmed;
  const currentRoute = memberRoute(route, onboarding);
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
          document.getElementById("main")?.scrollIntoView({ block: "start" });
        }}
      >
        Skip to content
      </a>
      {config.mode === "demo" && (
        <div className="demo-banner">
          <span>LOCAL DEMO</span> Synthetic opportunities and sample letters. No
          live account, payment or application.
        </div>
      )}
      <BetaNotice config={config} banner />
      <div className="app-shell">
        <aside
          ref={sidebar}
          id="member-navigation"
          className={cx("sidebar", menu && "open")}
          inert={mobile && !menu}
          aria-hidden={mobile && !menu ? true : undefined}
          role={mobile && menu ? "dialog" : undefined}
          aria-modal={mobile && menu ? true : undefined}
          aria-label={mobile && menu ? "Main navigation" : undefined}
        >
          <Brand light />
          <div className="sidebar-caption">
            A little clarity.
            <br />
            Your next move.
          </div>
          <nav aria-label="Main navigation">
            {[
              [LayoutGrid, "opportunities", "Opportunities"],
              [BriefcaseBusiness, "applications", "Applications"],
              [UserRound, "profile", "My profile"],
              [CreditCard, "account", "Account"],
            ].map(([Icon, id, text]) => (
              <a
                key={id}
                href={`#${id}`}
                aria-current={currentRoute === id ? "page" : undefined}
                className={cx(currentRoute === id && "active")}
              >
                <Icon size={19} />
                {text}
                {id === "opportunities" && <span className="nav-dot" />}
              </a>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-plan">
              <Sparkles size={17} />
              <div>
                <strong>
                  {!capabilities.coverLetters
                    ? "Your profile and applications"
                    : me?.billing?.plan === "free"
                      ? "Choose your letter plan"
                      : "Your writing allowance"}
                </strong>
                <p>
                  {!capabilities.coverLetters
                    ? "AI cover letters are currently unavailable"
                    : me?.billing
                      ? me.billing.plan === "free"
                        ? "No cover-letter credits"
                        : `${me.billing.remaining ?? 0} cover ${me.billing.remaining === 1 ? "letter" : "letters"} available`
                      : "Your workspace, your pace"}
                </p>
              </div>
            </div>
            <button
              className="sidebar-user"
              onClick={() => {
                window.location.hash = "account";
              }}
            >
              <span className="avatar">
                {(me?.profile?.name || session.email || "You")
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <span>
                <strong>{me?.profile?.name || "Your account"}</strong>
                <small>
                  {me?.billing?.plan === "monthly"
                    ? "RoleClue Plus"
                    : me?.billing?.hasSubscription
                      ? "Subscription needs attention"
                      : capabilities.billing
                        ? me?.billing?.plan === "starter"
                          ? "RoleClue Starter"
                          : "Free workspace"
                        : "Free workspace"}
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
          </div>
        </aside>
        {menu && (
          <button
            className="mobile-backdrop"
            onClick={() => setMenu(false)}
            aria-label="Close menu"
          />
        )}
        <div
          className="workspace"
          inert={mobile && menu}
          aria-hidden={mobile && menu ? true : undefined}
        >
          <header className="topbar">
            <button
              ref={menuButton}
              className="icon-button mobile-menu"
              onClick={() => setMenu(!menu)}
              aria-label="Open navigation"
              aria-expanded={menu}
              aria-controls="member-navigation"
            >
              <Menu />
            </button>
            <span className="topbar-context">
              YOUR JOB SEARCH, WITH DIRECTION
            </span>
            <div>
              <span className="australia">
                <Globe2 size={14} /> Australia · Technology
              </span>
              <button
                className="icon-button"
                onClick={logout}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut size={18} />
              </button>
            </div>
          </header>
          <main id="main" tabIndex="-1">
            {loading ? (
              <div className="section-loading">
                <Spinner>Getting your workspace ready</Spinner>
              </div>
            ) : error && !me ? (
              <Empty title="Your workspace is taking a moment">
                <ErrorBox error={error} />
                <button
                  className="button"
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    refreshMe()
                      .catch(setError)
                      .finally(() => setLoading(false));
                  }}
                >
                  Try again
                </button>
              </Empty>
            ) : me ? (
              <>
                <CheckoutReturn
                  api={api}
                  enabled={capabilities.billing}
                  onBilling={(billing) => {
                    if (
                      renderedSessionVersion === sessionVersion.current &&
                      readSession()
                    )
                      setMe((value) => ({ ...value, billing }));
                  }}
                />
                {onboarding && currentRoute === "profile" && (
                  <div className="onboarding-note">
                    <span>01 / YOUR PROFILE</span> A few details now. A more
                    useful shortlist next.
                  </div>
                )}
                {currentRoute === "profile" && (
                  <ProfileScreen
                    config={config}
                    api={api}
                    profile={me.profile}
                    onboarding={onboarding}
                    onSaved={onProfileSaved}
                  />
                )}
                {!onboarding && currentRoute === "opportunities" && (
                  <OpportunitiesScreen
                    api={api}
                    profile={me.profile}
                    onNotice={setNotice}
                    capabilities={capabilities}
                    onOpenApplication={(id) => {
                      rememberApplication(id);
                      setApplicationTarget(id);
                      window.location.hash = "applications";
                    }}
                  />
                )}
                {!onboarding && currentRoute === "applications" && (
                  <ApplicationsScreen
                    api={api}
                    billing={me.billing}
                    onBilling={(billing) => {
                      if (
                        renderedSessionVersion === sessionVersion.current &&
                        readSession()
                      )
                        setMe((value) => ({ ...value, billing }));
                    }}
                    onUpgrade={() => setPaywall(true)}
                    onNotice={setNotice}
                    capabilities={capabilities}
                    initialSelectedId={applicationTarget}
                  />
                )}
                {currentRoute === "account" && (
                  <AccountScreen
                    api={api}
                    config={config}
                    me={me}
                    onBilling={(billing) => {
                      if (
                        renderedSessionVersion === sessionVersion.current &&
                        readSession()
                      )
                        setMe((value) => ({ ...value, billing }));
                    }}
                    onUpgrade={() => setPaywall(true)}
                    onNotice={setNotice}
                    onDeleted={() => {
                      if (renderedSessionVersion !== sessionVersion.current)
                        return;
                      clearSession();
                      clearAccountBrowserState();
                      sessionVersion.current += 1;
                      setSession(null);
                      setMe(null);
                      setContinuation(null);
                      setApplicationTarget(null);
                    }}
                  />
                )}
              </>
            ) : null}
          </main>
          <footer className="app-footer">
            <span>RoleClue by Proairesis Digital</span>
            <nav aria-label="Member app legal information">
              <a href="/privacy.html" target="_blank" rel="noreferrer">
                Privacy
              </a>
              <a href="/terms.html" target="_blank" rel="noreferrer">
                Terms
              </a>
            </nav>
          </footer>
        </div>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {notice}
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {paywall && capabilities.billing && (
        <UpgradeDialog
          api={api}
          billing={me?.billing}
          onClose={() => setPaywall(false)}
        />
      )}
    </>
  );
}

function PlanGate({
  api,
  billing,
  applicationId,
  initialMessage = "",
  onBilling,
  onReady,
  onManageAccount,
  onSignOut,
}) {
  const presentation = billingPresentation(billing, date);
  const returnKind = billingReturnKind(window.location.search);
  const returnPlan = billingReturnPlan(window.location.search);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(returnKind === "success" ? "verify" : "");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(
    returnKind === "cancelled"
      ? "Checkout closed. Your profile and selected opportunity are still saved."
      : initialMessage,
  );
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (billing?.canGenerate) onReady();
  }, [billing?.canGenerate]);
  useEffect(() => {
    if (returnKind !== "success" || billing?.canGenerate) return;
    let cancelled = false;
    let timer;
    let attempts = 0;
    const verify = async () => {
      try {
        const next = await refreshBillingStatus(api, {
          assertCurrent() {
            if (cancelled) throw new Error("Payment verification was cancelled.");
          },
          onBilling,
        });
        if (cancelled) return;
        const outcome = billingReturnOutcome("success", next, returnPlan);
        if (outcome === "verified") {
          setBusy("");
          setMessage("Payment confirmed. Opening your selected application.");
          onReady();
          return;
        }
        attempts += 1;
        if (attempts < 4) {
          setMessage("Stripe is still confirming your payment. Your selected role is safe.");
          timer = setTimeout(verify, 8000);
        } else {
          setBusy("");
          setMessage("Payment is still processing. Check again in a moment; access unlocks only after Stripe confirms it.");
        }
      } catch (failure) {
        if (!cancelled) {
          setBusy("");
          setError(failure);
        }
      }
    };
    verify();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, returnKind, returnPlan, billing?.canGenerate]);

  async function checkout() {
    if (!selectedPlan || !accepted || busy) return;
    setBusy("checkout");
    setError(null);
    setMessage("");
    try {
      const result = await api("/billing/checkout", {
        method: "POST",
        body: billingCheckoutBody(selectedPlan),
      });
      const url = safeExternalUrl(result.url);
      if (!url) throw new Error("Stripe Checkout is unavailable. Please try again.");
      window.location.assign(url);
    } catch (failure) {
      if (mounted.current) {
        setError(failure);
        setBusy("");
      }
    }
  }

  async function verifyAgain() {
    setBusy("verify");
    setError(null);
    try {
      const next = await refreshBillingStatus(api, { onBilling });
      if (next.canGenerate) onReady();
      else setMessage("Stripe has not confirmed paid access yet. Your current allowance is unchanged.");
    } catch (failure) {
      setError(failure);
    } finally {
      if (mounted.current) setBusy("");
    }
  }

  return (
    <div className="plan-gate">
      <header className="plan-gate-header">
        <Brand />
        <button className="text-link" onClick={onSignOut}>Sign out</button>
      </header>
      <main className="plan-gate-main">
        <div className="plan-gate-heading">
          <p className="eyebrow">YOUR MATCH IS SAVED</p>
          <h1>Choose your cover-letter plan.</h1>
          <p>
            Your confirmed profile and selected role are ready. Payment unlocks the application workspace and letter generation.
          </p>
        </div>
        <div className="ready-strip" aria-label="Application preparation status">
          <span><CheckCircle2 size={18} /> Resume ready</span>
          <span><CheckCircle2 size={18} /> Job description ready</span>
          <span><CheckCircle2 size={18} /> Match reviewed</span>
        </div>
        {message && <div className="notice warning plan-message" role="status">{busy === "verify" && <LoaderCircle className="spin" size={17} />} {message}</div>}
        <ErrorBox error={error} />
        <fieldset className="plan-gate-options">
          <legend>Choose one plan. Nothing is preselected.</legend>
          {presentation.canBuyStarter && (
            <label className={cx("plan-gate-option", selectedPlan === "starter" && "selected")}>
              <input type="radio" name="continuation-plan" value="starter" checked={selectedPlan === "starter"} onChange={() => { setSelectedPlan("starter"); setAccepted(false); }} />
              <span className="plan-name"><span className="eyebrow">STARTER</span><strong>A$1</strong><small>one time</small></span>
              <span className="plan-description"><strong>2 successful cover letters</strong><small>One purchase per account. Credits do not expire. This is not a subscription or a free trial.</small></span>
            </label>
          )}
          <label className={cx("plan-gate-option", selectedPlan === "monthly" && "selected")}>
            <input type="radio" name="continuation-plan" value="monthly" checked={selectedPlan === "monthly"} onChange={() => { setSelectedPlan("monthly"); setAccepted(false); }} />
            <span className="plan-name"><span className="eyebrow">PLUS</span><strong>A$20</strong><small>per month</small></span>
            <span className="plan-description"><strong>50 successful cover letters each paid period</strong><small>Renews monthly until cancelled. No rollover and no free trial.</small></span>
          </label>
        </fieldset>
        <label className="check-line plan-terms">
          <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={!selectedPlan || Boolean(busy)} />
          <span>
            {selectedPlan === "starter"
              ? <>I agree to the <a href="/terms.html" target="_blank" rel="noreferrer">membership and refund terms</a>. I authorise one A$1 payment for two cover letters. Starter does not renew.</>
              : selectedPlan === "monthly"
                ? <>I agree to the <a href="/terms.html" target="_blank" rel="noreferrer">membership and refund terms</a>. I understand that Plus costs A$20 monthly and renews until cancelled.</>
                : "Choose a plan to review its payment terms."}
          </span>
        </label>
        <button className="button plan-continue" disabled={!selectedPlan || !accepted || Boolean(busy)} onClick={checkout}>
          {busy === "checkout"
            ? <Spinner>Opening secure checkout</Spinner>
            : <>{selectedPlan === "starter" ? "Buy Starter for A$1" : selectedPlan === "monthly" ? "Subscribe for A$20/month" : "Choose a plan"} <ArrowRight size={18} /></>}
        </button>
        {(returnKind === "success" || message.includes("processing")) && (
          <button className="text-link verify-payment" disabled={Boolean(busy)} onClick={verifyAgain}>Check payment again</button>
        )}
        <p className="plan-fine">
          <ShieldCheck size={15} /> Stripe processes payment details. RoleClue does not store your card number. Access is granted only after server verification.
        </p>
        <button className="text-link manage-gated-account" onClick={onManageAccount}>Manage account and data</button>
      </main>
    </div>
  );
}

function CheckoutReturn({ api, enabled, onBilling }) {
  const [returnState] = useState(() => billingReturnKind(window.location.search));
  const [returnPlan] = useState(() => billingReturnPlan(window.location.search));
  const [status, setStatus] = useState("checking");
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!returnState || !enabled) return;
    let active = true,
      timer,
      checks = 0;
    setStatus("checking");
    setError(null);
    const check = async () => {
      try {
        const billing = await refreshBillingStatus(api, {
          onBilling,
          assertCurrent() {
            if (!active) throw new Error("The payment check was cancelled.");
          },
        });
        const next = billingReturnOutcome(returnState, billing, returnPlan);
        setStatus(next);
        checks += 1;
        if (next === "waiting" && checks < 3)
          timer = setTimeout(check, 11000);
      } catch (err) {
        if (active) {
          setError(err);
          setStatus("error");
        }
      }
    };
    check();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, enabled, returnState, returnPlan, attempt]);
  if (!returnState) return null;
  return (
    <div className={cx("checkout-return notice", ["waiting", "error"].includes(status) || !enabled ? "warning" : "success")} role="status">
      {!enabled ? (
        <span>Payment checks are currently unavailable. Your saved account allowance remains in effect. Contact support if you completed a payment.</span>
      ) : status === "checking" ? (
        <Spinner>
          Welcome back. Checking your payment with Stripe…
        </Spinner>
      ) : status === "verified" ? (
        <>
          <CheckCircle2 size={18} />
          <span>
            Your payment is confirmed. Your current allowance is shown in your account.
          </span>
        </>
      ) : status === "cancelled" ? (
        <span>Checkout closed. Your current account allowance has been checked.</span>
      ) : status === "refreshed" ? (
        <span>Your billing status and account allowance are up to date.</span>
      ) : status === "error" ? (
        <>
          <span>We could not refresh your billing status. Your previous allowance is unchanged. {error?.message}</span>
          <button className="text-link" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
        </>
      ) : (
        <>
          <span>
            Paid access is not confirmed yet. Payment may still be processing; your current account allowance remains in effect. Check again or review the billing status in Account.
          </span>
          <button
            className="text-link"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Check again
          </button>
        </>
      )}
    </div>
  );
}

export function AuthScreen({
  config,
  onSession,
  continuation = false,
  onBack,
  initialError = null,
}) {
  const capabilities = capabilitiesFor(config);
  const [mode, setMode] = useState(continuation ? "signup" : "signin"),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError),
    [message, setMessage] = useState("");
  const marketing = config.marketingUrl || "https://proairesis.digital";
  const titles = {
    signin: "Welcome back.",
    signup: "Your next chapter starts here.",
    confirm: "Check your inbox.",
    forgot: "Let’s get you back in.",
    reset: "A fresh start.",
  };
  function changeMode(value) {
    setMode(value);
    setError(null);
    setMessage("");
    setPassword("");
  }
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      const address = email.trim().toLowerCase();
      if (mode === "signin") onSession(await signIn(config, address, password));
      if (mode === "signup") {
        if (!continuation && !terms)
          throw new Error(
            "Please accept the terms and privacy notice to create your account.",
          );
        const result = await signUp(config, address, password, name.trim());
        setMode(result.UserConfirmed ? "signin" : "confirm");
        setPassword("");
        setMessage(
          result.UserConfirmed
            ? "Account created. Sign in to continue."
            : `Enter the verification code sent to ${address}.`,
        );
      }
      if (mode === "confirm") {
        await confirmSignUp(config, address, code.trim());
        setMode("signin");
        setMessage("Email verified. Sign in to get started.");
      }
      if (mode === "forgot") {
        await forgotPassword(config, address);
        setMode("reset");
        setMessage("If this email has an account, a reset code is on its way.");
      }
      if (mode === "reset") {
        await resetPassword(config, address, code.trim(), password);
        setMode("signin");
        setPassword("");
        setMessage("Password updated. You can now sign in.");
      }
    } catch (err) {
      setError(err);
      if (err.code === "UserNotConfirmedException") {
        setMode("confirm");
        setMessage(
          "Verify your email to continue. You can request another code below.",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <aside className="auth-story" aria-label="RoleClue introduction">
        <Brand light />
        <div>
          <p className="eyebrow mint-text">LESS SEARCHING. MORE DIRECTION.</p>
          <p className="auth-story-heading">
            A focused shortlist.
            <br />
            <em>A clearer next move.</em>
          </p>
          <p>
            Find technology roles that fit your experience and your situation.
            Understand the match before you put yourself forward.
          </p>
          <div className="auth-preview">
            <span className="preview-icon">
              <Check size={21} />
            </span>
            <div>
              <strong>Start with what fits you.</strong>
              <small>
                Your experience. Your priorities. Your next chapter.
              </small>
            </div>
          </div>
        </div>
        <span className="auth-story-footer">
          Built for Australian technology careers.
        </span>
      </aside>
      <section className="auth-form-wrap" aria-labelledby="auth-title">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-form">
          {onBack && (
            <button className="guest-back auth-back" onClick={onBack}>
              <ArrowLeft size={16} /> Back to my matches
            </button>
          )}
          <p className="eyebrow">YOUR ROLECLUE WORKSPACE</p>
          <h1 id="auth-title">
            {continuation && ["signin", "signup"].includes(mode)
              ? "Save this match."
              : titles[mode]}
          </h1>
          <p className="intro">
            {continuation && ["signin", "signup"].includes(mode)
              ? "Create an account or sign in. Your confirmed profile and selected opportunity will continue with you."
              : mode === "signup"
                ? capabilities.coverLetters
                  ? "Review relevant roles for free. Cover-letter generation starts with a one-time A$1 Starter purchase."
                  : "Create your profile and organise the roles you want to explore."
                : mode === "signin"
                  ? "Your shortlist and applications are right where you left them."
                  : "Use the email address you registered with."}
          </p>
          <BetaNotice config={config} />
          {config.mode === "demo" ? (
            <div className="demo-auth">
              <Pill tone="amber">Synthetic local demo</Pill>
              <p>
                Explore the complete flow with a sample account. This does not
                create a real account or process a payment. Use a synthetic
                resume for testing.
              </p>
              <button
                className="button"
                onClick={() => onSession(startDemo(config))}
              >
                Explore demo workspace
                <ArrowRight size={18} />
              </button>
            </div>
          ) : (
            <>
              {mode === "signup" && continuation && (
                <div className="notice neutral" role="status">
                  You accepted the current terms and privacy notice when you confirmed your guest profile. This applies to Google and email registration.
                </div>
              )}
              {config.googleSignInEnabled && ["signin", "signup"].includes(mode) && (
                <>
                  <button
                    type="button"
                    className="button google-button full"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await startHostedSignIn(config, "Google");
                      } catch (failure) {
                        setError(failure);
                        setBusy(false);
                      }
                    }}
                  >
                    <span className="google-g" aria-hidden="true">G</span>
                    Continue with Google
                  </button>
                  <div className="auth-divider"><span>or continue with email</span></div>
                </>
              )}
              <form onSubmit={submit}>
              {mode === "signup" && !continuation && (
                <Field label="Your name">
                  <input
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={120}
                  />
                </Field>
              )}
              <Field label="Email address">
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                />
              </Field>
              {["signin", "signup", "reset"].includes(mode) && (
                <Field
                  label={mode === "reset" ? "New password" : "Password"}
                  hint={
                    mode === "signup" || mode === "reset"
                      ? "Use at least 12 characters with uppercase, lowercase and a number."
                      : undefined
                  }
                >
                  <input
                    type="password"
                    autoComplete={
                      mode === "signin" ? "current-password" : "new-password"
                    }
                    minLength={mode === "signin" ? undefined : 12}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </Field>
              )}
              {["confirm", "reset"].includes(mode) && (
                <Field label="Email verification code">
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </Field>
              )}
              {mode === "signup" && !continuation && (
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                    required
                  />
                  <span>
                    I agree to the{" "}
                    <a href="/terms.html" target="_blank" rel="noreferrer">
                      terms
                    </a>{" "}
                    and acknowledge the{" "}
                    <a href="/privacy.html" target="_blank" rel="noreferrer">
                      privacy notice
                    </a>
                    .
                  </span>
                </label>
              )}
              {message && (
                <div className="notice success" role="status">
                  {message}
                </div>
              )}
              <ErrorBox error={error} />
              <button className="button full" disabled={busy}>
                {busy ? (
                  <Spinner>One moment</Spinner>
                ) : (
                  {
                    signin: "Sign in",
                    signup: "Create account",
                    confirm: "Verify email",
                    forgot: "Send reset code",
                    reset: "Update password",
                  }[mode]
                )}
                {!busy && <ArrowRight size={17} />}
              </button>
              </form>
            </>
          )}
          {config.mode !== "demo" && (
            <div className="auth-links">
              {mode === "signin" ? (
                <>
                  <button onClick={() => changeMode("forgot")}>
                    Forgot password?
                  </button>
                  <p>
                    {continuation ? "Need a new account?" : "New to RoleClue?"}{" "}
                    <button onClick={() => changeMode("signup")}>
                      Create an account
                    </button>
                  </p>
                </>
              ) : (
                <>
                  <button onClick={() => changeMode("signin")}>
                    Back to sign in
                  </button>
                  {mode === "confirm" && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          await resendCode(config, email);
                          setMessage("A new verification code has been sent.");
                        } catch (err) {
                          setError(err);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Resend verification code
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          <p className="auth-fine">
            <ShieldCheck size={15} /> Your resume stays private in your account.
          </p>
        </div>
        <div className="auth-bottom">
          <a href={marketing}>
            Visit RoleClue
            <ArrowUpRight size={14} />
          </a>
          <nav aria-label="Member app legal information">
            <a href="/privacy.html" target="_blank" rel="noreferrer">
              Privacy
            </a>
            <a href="/terms.html" target="_blank" rel="noreferrer">
              Terms
            </a>
          </nav>
        </div>
      </section>
    </main>
  );
}

function ProfileScreen({ config, api, profile, onboarding, onSaved }) {
  const [draft, setDraft] = useState(() => ({
    ...blankProfile,
    ...profile,
    preferences: { ...blankProfile.preferences, ...profile?.preferences },
  }));
  const [processingConsent, setProcessingConsent] = useState(
      Boolean(profile?.consentAt),
    ),
    [reviewed, setReviewed] = useState(Boolean(profile?.confirmed));
  const [termsAccepted, setTermsAccepted] = useState(
    Boolean(profile?.termsAcceptedAt),
  );
  const [marketingConsent, setMarketingConsent] = useState(
    Boolean(profile?.marketingConsent),
  );
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(null),
    [uploadError, setUploadError] = useState(null),
    [warnings, setWarnings] = useState([]),
    [filename, setFilename] = useState("");
  const fileInput = useRef(null);
  const uploadErrorRef = useRef(null);
  const skillsEdited = useRef(false);
  useEffect(() => {
    if (uploadError) uploadErrorRef.current?.focus();
  }, [uploadError]);
  const set = (key, value) => {
    if (key === "skills") skillsEdited.current = true;
    setDraft((d) => ({ ...d, [key]: value }));
    setReviewed(false);
  };
  const pref = (key, value) => {
    setDraft((d) => ({
      ...d,
      preferences: { ...d.preferences, [key]: value },
    }));
    setReviewed(false);
  };
  const toggle = (key, value, preferences = false) => {
    const values = (preferences ? draft.preferences : draft)[key] || [];
    (preferences ? pref : set)(
      key,
      values.includes(value)
        ? values.filter((v) => v !== value)
        : [...values, value],
    );
  };
  async function upload(file) {
    if (!file) return;
    setError(null);
    setUploadError(null);
    if (!processingConsent) {
      setUploadError(
        new Error("Please acknowledge resume processing before uploading."),
      );
      return;
    }
    setBusy("upload");
    try {
      const result = await uploadResume(api, config, file);
      setDraft((d) => mergeResumeUpload(d, result, skillsEdited.current));
      setFilename(file.name);
      setWarnings(result.warnings || []);
      setReviewed(false);
    } catch (err) {
      setUploadError(err);
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function save(event) {
    event.preventDefault();
    setError(null);
    if (!draft.resumeText.trim())
      return setError(
        new Error("Upload a readable resume and review the extracted text."),
      );
    if (!draft.roleFamilies.length)
      return setError(new Error("Choose at least one technology role family."));
    if (!processingConsent || !reviewed || !termsAccepted)
      return setError(
        new Error(
          "Confirm your profile, processing acknowledgement and agreement to the terms.",
        ),
      );
    setBusy("save");
    try {
      const result = await api("/profile", {
        method: "PUT",
        body: {
          ...draft,
          confirmed: true,
          consentAt: draft.consentAt || new Date().toISOString(),
          termsAccepted: true,
          marketingConsent,
        },
      });
      await onSaved(result.profile);
    } catch (err) {
      setError(err);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="page profile-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {onboarding
              ? "LET’S START WITH YOU"
              : "THE DETAILS BEHIND YOUR MATCHES"}
          </p>
          <h1>{onboarding ? "A shortlist that knows you." : "My profile"}</h1>
          <p>
            {onboarding
              ? "Bring your experience. Tell us what matters. We’ll find the common ground."
              : "Keep your experience and priorities up to date. Your saved applications stay with you."}
          </p>
        </div>
        <span className="heading-art">
          <UserRound size={38} />
        </span>
      </div>
      <form onSubmit={save}>
        <BetaNotice config={config} />
        <section className="panel profile-section">
          <div className="section-heading">
            <span className="step-number">01</span>
            <div>
              <h2>Your experience</h2>
              <p>
                A resume gives us the starting point. You have the final say.
              </p>
            </div>
          </div>
          <label className="check-line consent">
            <input
              type="checkbox"
              checked={processingConsent}
              onChange={(e) => setProcessingConsent(e.target.checked)}
            />
            <span>
              I understand RoleClue will process my resume and use the details I
              confirm to suggest jobs and generate application drafts.{" "}
              <a href="/privacy.html" target="_blank" rel="noreferrer">
                Privacy notice
              </a>
            </span>
          </label>
          <div className="upload-zone">
            <span className="upload-icon">
              <UploadCloud size={29} />
            </span>
            <div>
              <strong>
                {filename ||
                  (draft.resumeText
                    ? "Your resume text is ready to review"
                    : "Bring your experience with you")}
              </strong>
              <p>PDF or DOCX · Up to 5 MB · Text-based documents</p>
            </div>
            <input
              ref={fileInput}
              id="resume-file"
              className="sr-only"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => upload(e.target.files?.[0])}
            />
            <button
              type="button"
              className="button secondary"
              disabled={Boolean(busy) || !processingConsent}
              onClick={() => fileInput.current?.click()}
            >
              {busy === "upload" ? (
                <Spinner>Reading resume</Spinner>
              ) : (
                <>
                  {draft.resumeText ? "Replace resume" : "Upload resume"}
                  <Plus size={16} />
                </>
              )}
            </button>
          </div>
          {uploadError && (
            <div className="upload-feedback" ref={uploadErrorRef} tabIndex={-1}>
              <ErrorBox error={uploadError} />
            </div>
          )}
          {warnings.length > 0 && (
            <div className="notice warning">
              {warnings.map((w, i) => (
                <p key={i}>{typeof w === "string" ? w : w.message}</p>
              ))}
            </div>
          )}
          <div className="form-grid">
            <Field label="Name">
              <input
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                required
                maxLength={120}
              />
            </Field>
            <Field
              label="Years of relevant experience"
              hint="You can leave this blank if you’re unsure."
            >
              <input
                type="number"
                min="0"
                max="70"
                step="0.5"
                value={draft.yearsExperience ?? ""}
                onChange={(e) =>
                  set(
                    "yearsExperience",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </Field>
            <Field
              label="Skills and technologies"
              className="span-two"
              hint="Separate with commas. Add only experience you can support."
            >
              <input
                value={(draft.skills || []).join(", ")}
                onChange={(e) =>
                  set(
                    "skills",
                    e.target.value.split(",").map((s) => s.trimStart()),
                  )
                }
                onBlur={() =>
                  setDraft((d) => ({
                    ...d,
                    skills: d.skills.map((s) => s.trim()).filter(Boolean),
                  }))
                }
                placeholder="React, Python, stakeholder management…"
              />
            </Field>
          </div>
          {draft.resumeText && (
            <details className="resume-details" open={onboarding}>
              <summary>
                Review and correct your resume text
                <ChevronDown size={17} />
              </summary>
              <p>
                Check that roles, dates and achievements were read correctly. We
                use this evidence in your matches and letters.
              </p>
              <textarea
                aria-label="Resume text"
                className="resume-text"
                rows="10"
                maxLength={80000}
                value={draft.resumeText}
                onChange={(e) => set("resumeText", e.target.value)}
              />
            </details>
          )}
        </section>
        <section className="panel profile-section">
          <div className="section-heading">
            <span className="step-number">02</span>
            <div>
              <h2>Your situation</h2>
              <p>
                There’s no default job seeker. These details shape what fits.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <Field label="Where are you in your search?">
              <select
                value={draft.situation}
                onChange={(e) => set("situation", e.target.value)}
              >
                <option value="actively-looking">Actively looking</option>
                <option value="exploring">Exploring a move</option>
                <option value="graduate">
                  Graduate / first technology role
                </option>
                <option value="career-change">Changing careers</option>
                <option value="returning">Returning to work</option>
              </select>
            </Field>
            <Field label="Current location">
              <input
                value={draft.location}
                required
                placeholder="e.g. Melbourne, VIC"
                onChange={(e) => set("location", e.target.value)}
                maxLength={200}
              />
            </Field>
            <Field label="Australian work rights">
              <select
                value={draft.workRights}
                onChange={(e) => set("workRights", e.target.value)}
              >
                <option value="unknown">Prefer to confirm</option>
                <option value="citizen">Australian citizen</option>
                <option value="permanent-resident">Permanent resident</option>
                <option value="visa-unrestricted">
                  Visa with unrestricted work rights
                </option>
                <option value="visa-limited">Visa with work limitations</option>
                {draft.workRights === "visa" && (
                  <option value="visa">Current visa (review this answer)</option>
                )}
                <option value="none">No current Australian work rights</option>
              </select>
            </Field>
            <Field label="Do you need employer sponsorship?">
              <select
                value={draft.needsSponsorship}
                onChange={(e) => set("needsSponsorship", e.target.value)}
              >
                <option value="unknown">Not sure / prefer to confirm</option>
                <option value="no">No</option>
                <option value="now">Yes, now</option>
                <option value="later">Not now, but later</option>
                {draft.needsSponsorship === "yes" && (
                  <option value="yes">Yes (review this answer)</option>
                )}
              </select>
            </Field>
            {["visa-limited", "unknown", "visa"].includes(
              draft.workRights,
            ) && (
              <Field
                label="Visa work limitations"
                hint="Optional. Add only practical limits such as hours, occupation, employer, location or expiry. Do not enter a visa number."
              >
                <textarea
                  rows="3"
                  maxLength={1000}
                  value={draft.visaLimitations || ""}
                  onChange={(e) => set("visaLimitations", e.target.value)}
                />
              </Field>
            )}
            <Field label="Security clearance">
              <select
                value={draft.clearance}
                onChange={(e) => set("clearance", e.target.value)}
              >
                <option value="unknown">Prefer to confirm</option>
                <option value="none">None</option>
                <option value="baseline">Baseline</option>
                <option value="nv1">NV1</option>
                <option value="nv2">NV2</option>
                <option value="pv">Positive Vetting</option>
              </select>
            </Field>
          </div>
          <fieldset className="chip-field">
            <legend>
              Which technology roles interest you?{" "}
              <span>Choose one or more</span>
            </legend>
            <div className="choice-chips">
              {families.map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={draft.roleFamilies.includes(value)}
                  className={cx(
                    "choice-chip",
                    draft.roleFamilies.includes(value) && "selected",
                  )}
                  onClick={() => toggle("roleFamilies", value)}
                >
                  {draft.roleFamilies.includes(value) && <Check size={14} />}{" "}
                  {text}
                </button>
              ))}
            </div>
          </fieldset>
        </section>
        <section className="panel profile-section">
          <div className="section-heading">
            <span className="step-number">03</span>
            <div>
              <h2>
                What matters to you <span className="optional">Optional</span>
              </h2>
              <p>
                Preferences help prioritise roles. Mark a requirement when it’s
                non-negotiable.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <Field
              label="Preferred locations"
              hint="Comma-separated Australian cities or regions."
            >
              <input
                placeholder="Sydney, Melbourne"
                value={(draft.preferences.locations || []).join(", ")}
                onChange={(e) =>
                  pref(
                    "locations",
                    e.target.value.split(",").map((s) => s.trimStart()),
                  )
                }
              />
            </Field>
            <label className="check-line aligned">
              <input
                type="checkbox"
                checked={Boolean(draft.preferences.locationsRequired)}
                onChange={(e) => pref("locationsRequired", e.target.checked)}
              />
              <span>Only these locations</span>
            </label>
            <Field label="Preferred job titles">
              <input
                placeholder="Full Stack Developer, Data Engineer"
                value={(draft.preferences.roleTitles || []).join(", ")}
                onChange={(e) =>
                  pref(
                    "roleTitles",
                    e.target.value.split(",").map((s) => s.trimStart()),
                  )
                }
              />
            </Field>
            <Field label="Minimum salary (AUD)">
              <div className="input-pair">
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Optional"
                  value={draft.preferences.minimumSalary ?? ""}
                  onChange={(e) =>
                    pref(
                      "minimumSalary",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
                <select
                  aria-label="Salary period"
                  value={draft.preferences.salaryPeriod}
                  onChange={(e) => pref("salaryPeriod", e.target.value)}
                >
                  <option value="year">per year</option>
                  <option value="hour">per hour</option>
                  <option value="day">per day</option>
                </select>
              </div>
            </Field>
            <label className="check-line">
              <input
                type="checkbox"
                checked={Boolean(draft.preferences.relocation)}
                onChange={(e) => pref("relocation", e.target.checked)}
              />
              <span>I’m open to relocation</span>
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={Boolean(draft.preferences.minimumSalaryRequired)}
                onChange={(e) =>
                  pref("minimumSalaryRequired", e.target.checked)
                }
              />
              <span>Salary minimum is a requirement when disclosed</span>
            </label>
          </div>
          {[
            [
              "workplaceTypes",
              "Work arrangement",
              [
                ["remote", "Remote"],
                ["hybrid", "Hybrid"],
                ["on-site", "On-site"],
              ],
            ],
            [
              "employmentTypes",
              "Employment type",
              [
                ["full-time", "Full-time"],
                ["part-time", "Part-time"],
                ["contract", "Contract"],
                ["casual", "Casual"],
              ],
            ],
            [
              "seniority",
              "Career level",
              [
                ["graduate", "Graduate"],
                ["junior", "Junior"],
                ["mid", "Mid-level"],
                ["senior", "Senior"],
                ["lead", "Lead"],
              ],
            ],
          ].map(([key, text, options]) => (
            <fieldset className="chip-field" key={key}>
              <legend>{text}</legend>
              <div className="choice-chips">
                {options.map(([value, title]) => (
                  <button
                    type="button"
                    key={value}
                    className={cx(
                      "choice-chip",
                      (draft.preferences[key] || []).includes(value) &&
                        "selected",
                    )}
                    aria-pressed={(draft.preferences[key] || []).includes(
                      value,
                    )}
                    onClick={() => toggle(key, value, true)}
                  >
                    {title}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <label className="check-line">
            <input
              type="checkbox"
              checked={Boolean(draft.preferences.workplaceRequired)}
              onChange={(e) => pref("workplaceRequired", e.target.checked)}
            />
            <span>My selected work arrangements are required</span>
          </label>
          <Field
            label="Personal preferences or limitations"
            hint="Share only what you want considered. Describe practical requirements such as availability or travel, rather than sensitive personal details."
          >
            <textarea
              rows="3"
              maxLength={2000}
              placeholder="For example: available from November; no regular overnight travel."
              value={draft.preferences.limitations || ""}
              onChange={(e) => pref("limitations", e.target.value)}
            />
          </Field>
        </section>
        <div className="profile-save">
          <label className="check-line">
            <input
              type="checkbox"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
            />
            <span>
              Send me occasional RoleClue product updates. Optional; you can
              change this choice here.
            </span>
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              required
            />
            <span>
              I agree to the{" "}
              <a href="/terms.html" target="_blank" rel="noreferrer">
                terms
              </a>{" "}
              and acknowledge the{" "}
              <a href="/privacy.html" target="_blank" rel="noreferrer">
                privacy notice
              </a>
              .
            </span>
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
              required
            />
            <span>
              I have reviewed these details and they accurately reflect my
              experience and situation.
            </span>
          </label>
          <ErrorBox error={error} />
          <button className="button" disabled={Boolean(busy)}>
            {busy === "save" ? (
              <Spinner>Saving your profile</Spinner>
            ) : (
              <>
                {onboarding
                  ? "Find my opportunities"
                  : "Save profile & update matches"}
                <ArrowRight size={18} />
              </>
            )}
          </button>
          <p className="subtle">
            Your shortlist contains up to 30 suitable roles. We never add poor
            matches to fill it.
          </p>
        </div>
      </form>
    </div>
  );
}

export function OpportunitiesScreen({
  api,
  profile,
  onNotice,
  capabilities,
  onOpenApplication,
}) {
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(null),
    [view, setView] = useState("selected"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState(null),
    [busy, setBusy] = useState(""),
    [undo, setUndo] = useState(null),
    [importOpen, setImportOpen] = useState(false);
  const loadSerial = useRef(0);
  const currentView = useRef(view);
  const mounted = useRef(true);
  const decisionPending = useRef(false);
  const initialSelectedRequest = useRef(null);
  const selectedLoaded = useRef(false);
  currentView.current = view;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function load({ refresh = false, initial = false } = {}) {
    if (!mounted.current) return;
    const serial = ++loadSerial.current;
    const requestedView = currentView.current;
    const request = opportunityLoadRequest(requestedView, {
      recommendations: capabilities.recommendations,
      refresh,
      initial,
      selectedLoaded: selectedLoaded.current,
    });
    const refreshSelected = request.options?.method === "POST";
    const assertSession = captureSessionGuard();
    const isCurrent = () =>
      mounted.current &&
      serial === loadSerial.current &&
      requestedView === currentView.current;
    setLoading(true);
    setError(null);
    try {
      assertSession();
      let pending;
      if (refreshSelected && initial && !refresh) {
        if (!initialSelectedRequest.current) {
          const firstRequest = api(request.path, request.options);
          initialSelectedRequest.current = firstRequest;
          firstRequest.catch(() => {
            if (initialSelectedRequest.current === firstRequest)
              initialSelectedRequest.current = null;
          });
        }
        pending = initialSelectedRequest.current;
      } else {
        pending = api(request.path, request.options);
      }
      const result = await pending;
      assertSession();
      if (isCurrent()) {
        setData(result);
        if (requestedView === "selected" && capabilities.recommendations)
          selectedLoaded.current = true;
      }
    } catch (err) {
      if (isCurrent()) setError(err);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }
  useEffect(() => {
    setData(null);
    load({ initial: view === "selected" });
    return () => {
      loadSerial.current += 1;
    };
  }, [view, capabilities.recommendations]);
  async function decision(match, value) {
    if (decisionPending.current) return;
    decisionPending.current = true;
    setBusy(match.job.id);
    setError(null);
    try {
      await saveOpportunityDecision(api, match.job.id, value, {
        assertCurrent() {
          if (!mounted.current)
            throw new Error("This opportunity view was closed.");
        },
        onSaved(result) {
          setSelected((current) =>
            current?.job.id === match.job.id ? null : current,
          );
          if (value === "ignored") setUndo(match);
          if (value === "undecided") setUndo(null);
          onNotice(
            value === "interested"
              ? "Added to Applications. Your next step is up to you."
              : value === "ignored"
                ? "Opportunity ignored. You can restore it anytime."
                : "Opportunity restored. It will appear if it still fits your profile.",
          );
          if (value === "interested" && result?.application?.id)
            onOpenApplication(result.application.id);
        },
        reload: load,
      });
    } catch (err) {
      if (mounted.current) setError(err);
    } finally {
      decisionPending.current = false;
      if (mounted.current) setBusy("");
    }
  }
  const opportunities = (data?.opportunities || []).slice(
    0,
    view === "selected" ? 30 : undefined,
  );
  const filtered = opportunities.filter((m) =>
    `${m.job.title} ${m.job.company} ${m.job.location}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const feed = data?.feed;
  const refreshLabel =
    view === "selected" && capabilities.recommendations
      ? "Refresh daily recommendations"
      : view === "ignored"
        ? "Reload ignored opportunities"
        : "Reload shortlist";
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">GOOD OPPORTUNITIES. CLEAR REASONS.</p>
          <h1>
            Your next move, <em>in focus.</em>
          </h1>
          <p>
            A considered shortlist for {profile.name?.split(" ")[0] || "you"}.
            Built around your experience and what matters to you.
          </p>
        </div>
        <span className="heading-art">
          <Sparkles size={38} />
        </span>
      </div>
      <div className="shortlist-intro">
        <div>
          <span className="tiny-spark">
            <Sparkles size={16} />
          </span>
          <strong>Quality over quantity.</strong>
          <span>
            {capabilities.recommendations
              ? "Up to 30 high-fit roles, refreshed daily."
              : "Up to 30 high-fit roles you choose to assess."}
          </span>
        </div>
        <a href="#profile">
          Fine-tune your profile
          <SlidersHorizontal size={15} />
        </a>
      </div>
      {capabilities.jobImport && (
        <section
          className="job-import-intro panel"
          aria-label="Find and assess an opportunity"
        >
          <div>
            <h2>Bring a role you’re considering.</h2>
            <p>
              Search on SEEK or LinkedIn, then paste a job description you have
              permission to use. RoleClue assesses it against your reviewed
              profile. We do not fetch or scrape the listing.
            </p>
            {!capabilities.recommendations && (
              <p className="subtle">
                Automatic daily job recommendations are currently unavailable.
                These are your own selected opportunities.
              </p>
            )}
            <div className="job-search-links">
              <ExternalLink href="https://www.seek.com.au/jobs-in-information-communication-technology">
                Search SEEK
              </ExternalLink>
              <ExternalLink href="https://www.linkedin.com/jobs/search/?keywords=technology&location=Australia">
                Search LinkedIn
              </ExternalLink>
            </div>
          </div>
          <button className="button" onClick={() => setImportOpen(true)}>
            <Plus size={17} />
            Add opportunity
          </button>
        </section>
      )}
      <div className="list-toolbar">
        <div className="tabs" aria-label="Opportunity view">
          <button
            className={cx(view === "selected" && "active")}
            aria-pressed={view === "selected"}
            onClick={() => setView("selected")}
          >
            Selected for you
            {view === "selected" && data && <span>{opportunities.length}</span>}
          </button>
          <button
            className={cx(view === "ignored" && "active")}
            aria-pressed={view === "ignored"}
            onClick={() => setView("ignored")}
          >
            Ignored
          </button>
        </div>
        <div className="toolbar-actions">
          <label className="search-input">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search your shortlist"
              placeholder="Search your shortlist"
            />
          </label>
          <button
            className="icon-button bordered"
            disabled={loading}
            onClick={() =>
              load({
                refresh:
                  view === "selected" && capabilities.recommendations,
              })
            }
            title={refreshLabel}
            aria-label={refreshLabel}
          >
            <RefreshCw size={17} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>
      {feed && capabilities.recommendations && (
        <div
          className={cx(
            "feed-status",
            !["ready", "active", "ok", "fresh", "demo"].includes(feed.status) &&
              "feed-warning",
          )}
          role="status"
          aria-live="polite"
        >
          <Clock3 size={14} />
          <span>
            <strong>
              Approved-source recommendations: {label(feed.status)}.
            </strong>{" "}
            {feed.lastUpdatedAt
              ? `Last successful refresh ${dateTime(feed.lastUpdatedAt)}.`
              : "The first source refresh is pending."}
            {feed.message ? ` ${feed.message}` : ""}
          </span>
        </div>
      )}
      <ErrorBox error={error} />
      {undo && (
        <div className="undo-banner">
          <span>“{undo.job.title}” moved to Ignored.</span>
          <button
            disabled={Boolean(busy)}
            onClick={() => decision(undo, "undecided")}
          >
            Undo
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss undo"
            onClick={() => setUndo(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {loading && !data ? (
        <div className="panel section-loading">
          <Spinner>Finding your common ground</Spinner>
        </div>
      ) : filtered.length ? (
        <section
          className="opportunity-list panel"
          aria-label="Your opportunities"
        >
          <div className="opportunity-table-heading">
            <span>THE OPPORTUNITY</span>
            <span>YOUR FIT</span>
            <span>LOCATION & WORK</span>
            <span />
          </div>
          {filtered.map((match, index) => (
            <button
              className="opportunity-row"
              key={match.job.id}
              onClick={() => setSelected(match)}
            >
              <span className={`company-monogram tone-${index % 4}`}>
                {match.job.company?.slice(0, 1).toUpperCase() || "R"}
              </span>
              <span className="role-info">
                <strong>{match.job.title}</strong>
                <span>{match.job.company}</span>
                <small>
                  {match.job.source || "Source listing"} ·{" "}
                  {match.job.updatedAt
                    ? `Updated ${date(match.job.updatedAt)}`
                    : "Source date unavailable"}
                </small>
              </span>
              <span className="fit-info">
                <Pill>
                  <Sparkles size={12} />
                  {Number.isFinite(match.score)
                    ? `${match.score}% fit`
                    : "High fit"}
                </Pill>
                {match.needsConfirmation?.length > 0 ? (
                  <small className="confirmation">
                    <CircleHelp size={12} /> Needs confirmation
                  </small>
                ) : (
                  <small>
                    <Check size={12} /> No known hard conflicts
                  </small>
                )}
              </span>
              <span className="location-info">
                <span>
                  <MapPin size={14} />
                  {match.job.location || "Location not specified"}
                </span>
                <small>
                  {label(match.job.workplaceType)} ·{" "}
                  {label(match.job.employmentType)}
                </small>
              </span>
              <ChevronRight className="row-chevron" size={19} />
            </button>
          ))}
        </section>
      ) : (
        !loading && (
          <section className="panel">
            <Empty
              title={
                query
                  ? "No roles match that search."
                  : view === "ignored"
                    ? "Nothing set aside yet."
                    : "Your shortlist has room for the right fit."
              }
              icon={view === "ignored" ? Heart : Search}
            >
              {query
                ? "Try a different title, company or location."
                : view === "ignored"
                  ? "Opportunities you ignore will stay here until you choose to restore them."
                  : capabilities.jobImport
                    ? "Find a role on SEEK or LinkedIn, then add its description to check the fit. Only high-fit roles join your shortlist."
                    : feed?.message ||
                      "There are no qualifying roles available right now. We’ll show suitable opportunities when the source updates. You can also review your preferences."}
              {view === "selected" &&
                !query &&
                (capabilities.jobImport ? (
                  <button
                    className="button"
                    onClick={() => setImportOpen(true)}
                  >
                    <Plus size={16} />
                    Add opportunity
                  </button>
                ) : (
                  <a href="#profile" className="button secondary">
                    Review my preferences
                    <ArrowRight size={16} />
                  </a>
                ))}
            </Empty>
          </section>
        )
      )}
      <p className="shortlist-footnote">
        <ShieldCheck size={15} /> Fit estimates describe alignment with your
        profile, not your chance of being hired. You decide where to apply.
      </p>
      {selected && (
        <OpportunityDialog
          match={selected}
          onClose={() => setSelected(null)}
          busy={Boolean(busy)}
          error={error}
          ignored={view === "ignored"}
          onDecision={(value) => decision(selected, value)}
        />
      )}
      {importOpen && (
        <ImportOpportunityDialog
          api={api}
          onClose={() => setImportOpen(false)}
          onAccepted={async () => {
            setView("selected");
            if (view === "selected") await load();
            onNotice(
              "Opportunity assessed and added to your shortlist. Review the reasons before choosing Interested.",
            );
          }}
        />
      )}
    </div>
  );
}

function ImportOpportunityDialog({ api, onClose, onAccepted }) {
  const [draft, setDraft] = useState({
    title: "",
    company: "",
    url: "",
    location: "",
    description: "",
    roleFamily: "",
    workplace: "unknown",
    employmentType: "unknown",
    seniority: "unknown",
    permissionConfirmed: false,
    australiaConfirmed: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const feedback = useRef(null);
  useEffect(() => {
    if (error || result) feedback.current?.focus();
  }, [error, result]);
  const set = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const assessment = await api("/opportunities/import", {
        method: "POST",
        body: draft,
      });
      setResult(assessment);
      if (assessment.accepted) await onAccepted();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="ASSESS AN OPPORTUNITY"
      onClose={onClose}
      className="opportunity-dialog"
    >
      <div className="detail-title">
        <h2>A role, with clearer reasons.</h2>
        <p className="subtle">
          Paste the job details yourself. RoleClue does not open or scrape the
          link, verify the employer, or submit an application.
        </p>
      </div>
      {!result?.accepted && (
        <form className="import-opportunity-form" onSubmit={submit}>
          <div className="form-grid">
            <Field label="Job title">
              <input
                required
                maxLength={200}
                value={draft.title}
                onChange={(event) => set("title", event.target.value)}
              />
            </Field>
            <Field label="Company">
              <input
                required
                maxLength={200}
                value={draft.company}
                onChange={(event) => set("company", event.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Original job link"
            hint="Use the individual HTTPS job listing, not a search-results page."
          >
            <input
              type="url"
              required
              maxLength={2000}
              pattern="https://.*"
              placeholder="https://…"
              value={draft.url}
              onChange={(event) => set("url", event.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field label="Location">
              <input
                required
                maxLength={200}
                placeholder="e.g. Sydney, NSW"
                value={draft.location}
                onChange={(event) => set("location", event.target.value)}
              />
            </Field>
            <Field label="Role family">
              <select
                required
                value={draft.roleFamily}
                onChange={(event) => set("roleFamily", event.target.value)}
              >
                <option value="">Choose a role family</option>
                {families.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Work arrangement">
              <select
                value={draft.workplace}
                onChange={(event) => set("workplace", event.target.value)}
              >
                {["unknown", "remote", "hybrid", "on-site"].map((value) => (
                  <option key={value} value={value}>
                    {value === "unknown" ? "Not stated" : label(value)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Employment type">
              <select
                value={draft.employmentType}
                onChange={(event) => set("employmentType", event.target.value)}
              >
                {[
                  "unknown",
                  "full-time",
                  "part-time",
                  "contract",
                  "casual",
                  "internship",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value === "unknown" ? "Not stated" : label(value)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Seniority">
            <select
              value={draft.seniority}
              onChange={(event) => set("seniority", event.target.value)}
            >
              {[
                "unknown",
                "graduate",
                "junior",
                "mid-level",
                "senior",
                "lead",
                "manager",
              ].map((value) => (
                <option key={value} value={value}>
                  {value === "unknown" ? "Not stated" : label(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Job description"
            hint={`${draft.description.length.toLocaleString()} / 20,000 characters. Include responsibilities and requirements; at least 200 characters.`}
          >
            <textarea
              required
              minLength={200}
              maxLength={20000}
              rows={9}
              value={draft.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </Field>
          <label className="check-line">
            <input
              type="checkbox"
              required
              checked={draft.permissionConfirmed}
              onChange={(event) =>
                set("permissionConfirmed", event.target.checked)
              }
            />
            <span>
              I have permission to provide this description to RoleClue for
              assessment and application preparation.
            </span>
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              required
              checked={draft.australiaConfirmed}
              onChange={(event) =>
                set("australiaConfirmed", event.target.checked)
              }
            />
            <span>I confirm this role can be performed in Australia.</span>
          </label>
          <button className="button" disabled={busy} type="submit">
            {busy ? (
              <Spinner>Assessing opportunity</Spinner>
            ) : (
              <>
                <Sparkles size={17} />
                Assess opportunity
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
      )}
      {(error || result) && (
        <div ref={feedback} tabIndex={-1} className="import-assessment">
          <ErrorBox error={error} />
          {result && (
            <>
              <h3>
                {result.accepted
                  ? "Added to your considered opportunities"
                  : "Not added to your shortlist"}
              </h3>
              <Pill tone={result.accepted ? "mint" : "amber"}>
                {Number.isFinite(result.assessment.score)
                  ? `${result.assessment.score}% fit`
                  : "Not scored"}
              </Pill>
              <p>
                {result.accepted
                  ? "This role meets the shortlist threshold based on the supplied evidence. Review the uncertainties below and confirm the details with the employer before applying."
                  : result.assessment.reason ||
                    "This role does not meet your shortlist requirements based on the supplied evidence."}
              </p>
              <p>
                Only qualifying roles enter your shortlist, which shows at most
                30 at a time. A match estimate is not a hiring probability.
              </p>
              <MatchEvidence match={result.assessment} />
              {result.accepted && (
                <button className="button" onClick={onClose}>
                  Review my shortlist
                  <ArrowRight size={16} />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Dialog({ title, children, onClose, className = "", footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const cancel = (e) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={cx("dialog", className)}
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-shell">
        <div className="dialog-top">
          <span>{title}</span>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={21} />
          </button>
        </div>
        <div className="dialog-content">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </dialog>
  );
}

function MatchEvidence({ match }) {
  return (
    <div className="evidence-groups">
      {[
        ["matches", "What matches", CheckCircle2, "positive"],
        ["gaps", "Gaps to consider", SlidersHorizontal, "gap"],
        ["needsConfirmation", "Needs confirmation", CircleHelp, "unknown"],
      ].map(([key, title, Icon, tone]) => (
        <section key={key} className={`evidence-section ${tone}`}>
          <h3>
            <Icon size={19} />
            {title}
            <span>{match[key]?.length || 0}</span>
          </h3>
          {match[key]?.length ? (
            <ul>
              {match[key].map((point, i) => (
                <li key={i}>
                  <strong>
                    {typeof point === "string" ? point : point.text}
                  </strong>
                  {point.resumeEvidence && (
                    <p>
                      <span>Your resume</span>
                      {point.resumeEvidence}
                    </p>
                  )}
                  {point.jobEvidence && (
                    <p>
                      <span>The role asks for</span>
                      {point.jobEvidence}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="subtle">
              {key === "matches"
                ? "No supporting evidence recorded."
                : key === "gaps"
                  ? "No specific gaps recorded in this assessment."
                  : "No unresolved requirements recorded. Check the original listing before applying."}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function OpportunityDialog({
  match,
  onClose,
  onDecision,
  busy,
  error,
  ignored,
}) {
  const job = match.job;
  return (
    <Dialog
      title="A CLOSER LOOK"
      onClose={onClose}
      className="opportunity-dialog"
      footer={
        <>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => onDecision(ignored ? "undecided" : "ignored")}
          >
            {ignored ? "Restore opportunity" : "Ignore"}
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => onDecision("interested")}
          >
            {busy ? (
              <Spinner>Saving</Spinner>
            ) : (
              <>
                <Heart size={17} /> I’m interested
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </>
      }
    >
      <div className="detail-title">
        <span className="eyebrow">{job.company}</span>
        <h2>{job.title}</h2>
        <div className="job-meta">
          <span>
            <MapPin size={15} />
            {job.location}
          </span>
          <span>{label(job.workplaceType)}</span>
          <span>{label(job.employmentType)}</span>
        </div>
        <div className="detail-pills">
          <Pill>
            <Sparkles size={13} />
            {Number.isFinite(match.score)
              ? `${match.score}% fit`
              : "Not scored"}
          </Pill>
          {match.needsConfirmation?.length > 0 && (
            <Pill tone="amber">Needs confirmation</Pill>
          )}
        </div>
        <p className="subtle">
          A fit estimate based on the evidence below, not a hiring probability.
        </p>
      </div>
      <ErrorBox error={error} />
      <MatchEvidence match={match} />
      <section className="job-description">
        <h3>About the opportunity</h3>
        <p>
          {job.description ||
            "A full description is not available. Check the original listing for details."}
        </p>
      </section>
      <div className="source-detail">
        <div>
          <strong>{job.source || "Original listing"}</strong>
          <small>
            Updated {date(job.updatedAt)}
            {job.expiresAt ? ` · Closes ${date(job.expiresAt)}` : ""}
          </small>
        </div>
        <ExternalLink href={job.url || job.sourceUrl}>
          View original
        </ExternalLink>
      </div>
      <p className="subtle">
        Interested saves this role to Applications. You submit your application
        yourself on the employer’s website.
      </p>
    </Dialog>
  );
}

function ApplicationsScreen({
  api,
  billing,
  onBilling,
  onUpgrade,
  onNotice,
  capabilities,
  initialSelectedId,
}) {
  const [applications, setApplications] = useState(null),
    [selectedId, setSelectedId] = useState(null),
    [error, setError] = useState(null),
    [loading, setLoading] = useState(true);
  const loadSerial = useRef(0);
  async function load() {
    const serial = ++loadSerial.current;
    const assertSession = captureSessionGuard();
    const assertCurrent = () => {
      assertSession();
      if (serial !== loadSerial.current)
        throw new Error("Application loading was cancelled.");
    };
    setLoading(true);
    setError(null);
    try {
      const result = await loadAllApplications(api, { assertCurrent });
      assertCurrent();
      setApplications(result.applications || []);
      setSelectedId((id) =>
        selectedApplicationId(result.applications, id, initialSelectedId),
      );
    } catch (err) {
      if (serial === loadSerial.current) setError(err);
    } finally {
      if (serial === loadSerial.current) setLoading(false);
    }
  }
  useEffect(() => {
    load();
    return () => {
      loadSerial.current += 1;
    };
  }, [initialSelectedId]);
  const application = applications?.find((a) => a.id === selectedId);
  const update = (next) =>
    setApplications((list) =>
      list.map((a) => (a.id === next.id ? mergeApplicationUpdate(a, next) : a)),
    );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">FROM INTEREST TO YOUR NEXT CHAPTER</p>
          <h1>Your applications.</h1>
          <p>
            A place for the roles you care about, and the words that put you
            forward.
          </p>
        </div>
        <Pill tone="neutral">
          <BriefcaseBusiness size={14} />
          {applications
            ? `${applications.length} saved`
            : loading
              ? "Loading saved roles"
              : "Not loaded"}
        </Pill>
      </div>
      <ErrorBox error={error} />
      {error && (
        <button className="button secondary" disabled={loading} onClick={load}>
          {loading ? <Spinner>Retrying</Spinner> : "Retry loading applications"}
        </button>
      )}
      {loading && !applications ? (
        <div className="section-loading">
          <Spinner>Loading applications</Spinner>
        </div>
      ) : applications?.length ? (
        <div className="applications-layout">
          <aside
            className="application-list panel"
            aria-label="Saved applications"
          >
            <div className="application-list-heading">YOUR SAVED ROLES</div>
            {applications.map((app) => (
              <button
                key={app.id}
                aria-current={app.id === selectedId ? "true" : undefined}
                className={cx(
                  "application-list-item",
                  selectedId === app.id && "active",
                )}
                onClick={() => setSelectedId(app.id)}
              >
                <span>{app.job.company}</span>
                <strong>{app.job.title}</strong>
                <Pill tone={app.status === "offer" ? "mint" : "neutral"}>
                  {label(app.status)}
                </Pill>
                {listingAvailability(app.job).status !== "available" && (
                  <Pill tone="amber">
                    {listingAvailability(app.job).status === "closed"
                      ? "Listing closed"
                      : "Check availability"}
                  </Pill>
                )}
              </button>
            ))}
          </aside>
          {application && (
            <ApplicationWorkspace
              key={application.id}
              application={application}
              api={api}
              billing={billing}
              onBilling={onBilling}
              onUpgrade={onUpgrade}
              onNotice={onNotice}
              onUpdate={update}
              capabilities={capabilities}
            />
          )}
        </div>
      ) : !error && !loading ? (
        <section className="panel">
          <Empty
            icon={BriefcaseBusiness}
            title="Every application starts with an interest."
          >
            Save a role from your shortlist to track it here and create your{" "}
            {capabilities.coverLetters
              ? "first cover letter."
              : "application notes."}
            <a className="button" href="#opportunities">
              Explore my opportunities
              <ArrowRight size={17} />
            </a>
          </Empty>
        </section>
      ) : null}
    </div>
  );
}

export function ApplicationWorkspace({
  application,
  api,
  billing,
  onBilling,
  onUpgrade,
  onNotice,
  onUpdate,
  capabilities,
}) {
  const [notes, setNotes] = useState(application.notes || ""),
    [text, setText] = useState(""),
    [letterId, setLetterId] = useState(application.letters?.at(-1)?.id || ""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(null),
    [generation, setGeneration] = useState(null),
    [aiProcessingConfirmed, setAiProcessingConfirmed] = useState(false),
    [tab, setTab] = useState("letter");
  const generationKey = `roleclue.generation.${application.id}`;
  const currentLetter = (application.letters || []).find(
    (l) => l.id === letterId,
  );
  const job = application.job;
  useEffect(() => {
    setText(currentLetter?.text || "");
  }, [letterId, currentLetter?.text]);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(generationKey) || "null");
      if (saved?.generationId)
        setGeneration({ id: saved.generationId, status: "pending" });
    } catch {
      /* Corrupt request state can be replaced by a new explicit request. */
    }
  }, []);
  function generationResult(result) {
    if (result.billing) onBilling(result.billing);
    const value = result.generation;
    setGeneration(value);
    if (value.status === "succeeded" && value.letter) {
      sessionStorage.removeItem(generationKey);
      const letters = [
        ...(application.letters || []).filter((l) => l.id !== value.letter.id),
        value.letter,
      ];
      onUpdate({ ...application, letters });
      setLetterId(value.letter.id);
      setText(value.letter.text);
      setBusy("");
      onNotice("Your cover-letter draft is ready. Review it before using it.");
    } else if (value.status === "failed") {
      sessionStorage.removeItem(generationKey);
      setBusy("");
      setError(new Error(generationFailureMessage(value)));
    } else if (value.status === "pending") {
      let saved;
      try {
        saved = JSON.parse(sessionStorage.getItem(generationKey) || "{}");
      } catch {
        saved = {};
      }
      sessionStorage.setItem(
        generationKey,
        JSON.stringify({ ...saved, generationId: value.id }),
      );
    }
  }
  useEffect(() => {
    if (generation?.status !== "pending") return;
    let cancelled = false,
      timer;
    const poll = async () => {
      try {
        const result = await api(
          `/generations/${encodeURIComponent(generation.id)}`,
        );
        if (cancelled) return;
        generationResult(result);
        if (result.generation.status === "pending")
          timer = setTimeout(poll, 3000);
      } catch (err) {
        if (!cancelled) {
          setError(err);
          setBusy("");
        }
      }
    };
    timer = setTimeout(poll, 1800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [generation?.id, generation?.status]);
  async function generate() {
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(generationKey) || "null");
    } catch {
      saved = null;
    }
    if (!capabilities.coverLetters && !saved?.generationId) {
      setError(
        new Error(
          "AI cover-letter generation is currently unavailable. Your saved drafts remain available.",
        ),
      );
      return;
    }
    if (!saved?.generationId && !aiProcessingConfirmed) {
      setError(
        new Error("Confirm AI processing below before generating a draft."),
      );
      return;
    }
    if (
      !canRequestLetter(
        job,
        Boolean(saved?.idempotencyKey || saved?.generationId),
      )
    ) {
      setError(
        new Error(
          "This listing is closed. You can still edit, copy and download your existing letters.",
        ),
      );
      return;
    }
    if (
      billing &&
      !billing.canGenerate &&
      generation?.status !== "pending" &&
      !saved?.idempotencyKey
    ) {
      if (capabilities.billing) onUpgrade();
      else
        setError(
          new Error(
            "Your available generation allowance has been used. Subscriptions are not enabled yet.",
          ),
        );
      return;
    }
    setBusy("generate");
    setError(null);
    const idempotencyKey = saved?.idempotencyKey || crypto.randomUUID();
    sessionStorage.setItem(
      generationKey,
      JSON.stringify({ ...saved, idempotencyKey }),
    );
    try {
      const result = saved?.generationId
        ? await api(`/generations/${encodeURIComponent(saved.generationId)}`)
        : await api(
            `/applications/${encodeURIComponent(application.id)}/letters`,
            {
              method: "POST",
              idempotencyKey,
              body: { aiProcessingConfirmed: true },
            },
          );
      generationResult(result);
    } catch (err) {
      setBusy("");
      if (err.status === 402) {
        sessionStorage.removeItem(generationKey);
        if (capabilities.billing) onUpgrade();
        else
          setError(
            new Error(
              "Your available generation allowance has been used. Subscriptions are not enabled yet.",
            ),
          );
      } else if (err.code === "OPPORTUNITY_CLOSED") {
        sessionStorage.removeItem(generationKey);
        onUpdate({
          ...application,
          job: {
            ...job,
            availability: "closed",
            availabilityMessage: err.message,
          },
        });
        setError(err);
      } else setError(err);
    }
  }
  async function save(values) {
    setBusy("save");
    setError(null);
    try {
      const result = await api(
        `/applications/${encodeURIComponent(application.id)}`,
        { method: "PATCH", body: values },
      );
      onUpdate(result.application);
      onNotice("Application updated.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy("");
    }
  }
  async function saveLetter() {
    setBusy("letter");
    setError(null);
    try {
      const result = await api(
        `/applications/${encodeURIComponent(application.id)}/letters/${encodeURIComponent(letterId)}`,
        { method: "PATCH", body: { text } },
      );
      onUpdate({
        ...application,
        letters: application.letters.map((l) =>
          l.id === letterId ? result.letter : l,
        ),
      });
      onNotice("Your changes are saved. No generation credit used.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy("");
    }
  }
  const pending = generation?.status === "pending";
  const availability = listingAvailability(job);
  let hasExistingRequest = pending;
  try {
    const saved = JSON.parse(sessionStorage.getItem(generationKey) || "null");
    hasExistingRequest ||= Boolean(
      saved?.idempotencyKey || saved?.generationId,
    );
  } catch {
    /* A malformed local request does not change the source availability. */
  }
  const canGenerateForJob = canRequestLetter(job, hasExistingRequest);
  return (
    <section className="application-workspace panel">
      <div className="application-heading">
        <p className="eyebrow">{job.company}</p>
        <h2>{job.title}</h2>
        <div className="job-meta">
          <span>
            <MapPin size={14} />
            {job.location}
          </span>
          <span>{label(job.workplaceType)}</span>
        </div>
        <div className="application-controls">
          <Field label="Application status">
            <select
              value={application.status}
              disabled={Boolean(busy)}
              onChange={(e) => save({ status: e.target.value })}
            >
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {label(status)}
                </option>
              ))}
            </select>
          </Field>
          <ExternalLink
            href={job.url || job.sourceUrl}
            className="button secondary small"
          >
            Open job listing
          </ExternalLink>
        </div>
        {availability.status !== "available" && (
          <div className="notice warning">
            <strong>{availability.title}</strong>
            <p>{availability.message}</p>
            {availability.status === "closed" && (
              <p>
                You can still edit, copy or download existing letters and update
                your application. New letter generation is unavailable for
                closed listings.
              </p>
            )}
            {availability.checkedAt && (
              <small>Availability checked {date(availability.checkedAt)}</small>
            )}
          </div>
        )}
      </div>
      <div className="tabs application-tabs">
        <button
          className={cx(tab === "letter" && "active")}
          aria-pressed={tab === "letter"}
          onClick={() => setTab("letter")}
        >
          <FileText size={15} />
          Cover letter
        </button>
        <button
          className={cx(tab === "details" && "active")}
          aria-pressed={tab === "details"}
          onClick={() => setTab("details")}
        >
          Match & notes
        </button>
      </div>
      <ErrorBox error={error} />
      {tab === "details" ? (
        <div className="application-body">
          <Field label="Your notes">
            <textarea
              rows="5"
              value={notes}
              maxLength={5000}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contact details, next steps, interview notes…"
            />
          </Field>
          <button
            className="button secondary small"
            disabled={Boolean(busy) || notes === (application.notes || "")}
            onClick={() => save({ notes })}
          >
            Save notes
          </button>
          {application.match && <MatchEvidence match={application.match} />}
          <section className="job-description">
            <h3>Saved job description</h3>
            <p>{job.description}</p>
          </section>
        </div>
      ) : (
        <div className="application-body">
          <div className="letter-allowance">
            <span>
              <Sparkles size={16} />
              {!capabilities.coverLetters
                ? "AI cover letters are currently unavailable"
                : billing?.plan === "free"
                  ? "No cover-letter credits yet"
                  : `${billing?.remaining ?? 0} of ${billing?.limit ?? (billing?.plan === "monthly" ? 50 : 2)} generations left`}
            </span>
            {capabilities.billing && (
              <button onClick={onUpgrade}>
                {!billing?.hasSubscription && billing?.plan !== "monthly"
                  ? "View plans"
                  : "Plan details"}
                <ArrowUpRight size={13} />
              </button>
            )}
          </div>
          {!currentLetter ? (
            <div className="letter-empty">
              <span className="letter-empty-icon">
                <FileText size={31} />
                <Sparkles size={15} />
              </span>
              <h3>
                Your experience.
                <br />
                Written for this opportunity.
              </h3>
              <p>
                {capabilities.coverLetters
                  ? "Create a first draft using your reviewed resume and this role. Make it sound like you before you send it."
                  : "You can track this application and keep notes now. AI draft generation is currently unavailable."}
              </p>
            </div>
          ) : (
            <>
              <div className="letter-version">
                <Field label="Draft version">
                  <select
                    value={letterId}
                    onChange={(e) => setLetterId(e.target.value)}
                  >
                    {application.letters.map((letter, i) => (
                      <option key={letter.id} value={letter.id}>
                        Version {i + 1} · {date(letter.createdAt)}
                      </option>
                    ))}
                  </select>
                </Field>
                <span>Editing is always free</span>
              </div>
              <textarea
                className="letter-editor"
                aria-label="Cover letter draft"
                rows="18"
                value={text}
                maxLength={16000}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="letter-edit-actions">
                <button
                  className="button secondary small"
                  disabled={Boolean(busy) || text === currentLetter.text}
                  onClick={saveLetter}
                >
                  {busy === "letter" ? <Spinner>Saving</Spinner> : "Save edits"}
                </button>
                <button
                  className="text-link"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(text);
                      onNotice("Cover letter copied.");
                    } catch {
                      setError(
                        new Error(
                          "Clipboard access is unavailable. Select the draft text and copy it.",
                        ),
                      );
                    }
                  }}
                >
                  Copy
                </button>
                <button
                  className="text-link"
                  onClick={() =>
                    downloadText(
                      text,
                      `RoleClue-${job.company.replace(/[^a-z0-9]/gi, "-")}-cover-letter.txt`,
                    )
                  }
                >
                  <ArrowDownToLine size={15} />
                  Download
                </button>
              </div>
            </>
          )}
          {pending && (
            <div className="notice success">
              <Spinner>
                Your draft is being prepared. You can leave this page and
                return.
              </Spinner>
            </div>
          )}
          {capabilities.coverLetters && !pending && (
            <label className="check-line ai-processing-consent">
              <input
                type="checkbox"
                checked={aiProcessingConfirmed}
                onChange={(event) =>
                  setAiProcessingConfirmed(event.target.checked)
                }
              />
              <span>
                I agree to send my reviewed resume, profile and this job
                description to OpenAI to generate a draft. Processing may occur
                outside Australia. Only share details you want processed.{" "}
                <a
                  href="/privacy.html"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read the app privacy notice
                </a>
                .
              </span>
            </label>
          )}
          <div className="generate-row">
            <button
              className="button"
              disabled={
                Boolean(busy) ||
                (pending && !error) ||
                !canGenerateForJob ||
                (!capabilities.coverLetters && !pending) ||
                (!pending &&
                  capabilities.coverLetters &&
                  !aiProcessingConfirmed)
              }
              onClick={generate}
            >
              {busy === "generate" || (pending && !error) ? (
                <Spinner>Preparing your draft</Spinner>
              ) : (
                <>
                  <Sparkles size={17} />
                  {!capabilities.coverLetters && !pending
                    ? "AI letters unavailable"
                    : !canGenerateForJob
                      ? "Listing closed"
                      : pending
                        ? "Check generation status"
                        : currentLetter
                          ? "Generate another version"
                          : "Generate cover letter"}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
            <small>
              {!capabilities.coverLetters
                ? "Existing drafts can still be edited, copied and downloaded."
                : !canGenerateForJob
                  ? "Your existing drafts remain available."
                  : !billing?.canGenerate
                    ? capabilities.billing
                      ? billing?.plan === "monthly"
                        ? "Your monthly allowance is used."
                        : billing?.plan === "starter"
                          ? "Starter credits used · Plus is A$20/month for 50."
                          : "Starter is A$1 once for 2 cover letters."
                      : "Paid generation plans are not enabled yet."
                    : "One successful draft uses one generation."}
            </small>
          </div>
          <p className="draft-note">
            <ShieldCheck size={15} />
            Review every claim and personalise your draft. RoleClue does not
            send or submit applications.
          </p>
        </div>
      )}
    </section>
  );
}

export function UpgradeDialog({ api, billing, onClose }) {
  const plan = billingPresentation(billing, date);
  const [accepted, setAccepted] = useState(false),
    [selectedPlan, setSelectedPlan] = useState(() =>
      plan.canBuyStarter ? "starter" : "monthly",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const exhausted = plan.paid && billing?.remaining === 0;
  const manageExisting = plan.hasSubscription || plan.paid;
  const checkoutPlan = plan.canBuyStarter ? selectedPlan : "monthly";
  const checkoutIsStarter = checkoutPlan === "starter";
  function choosePlan(value) {
    setSelectedPlan(value);
    setAccepted(false);
    setError(null);
  }
  async function checkout() {
    if (!accepted || !plan.canSubscribe || busy) return;
    const assertSession = captureSessionGuard();
    setBusy(true);
    setError(null);
    try {
      const result = await api("/billing/checkout", {
        method: "POST",
        body: billingCheckoutBody(checkoutPlan),
      });
      assertSession();
      if (!mounted.current) return;
      const url = safeExternalUrl(result.url);
      if (!url)
        throw new Error("Checkout is unavailable. Please try again later.");
      window.location.assign(url);
    } catch (err) {
      if (mounted.current) {
        setError(err);
        setBusy(false);
      }
    }
  }
  async function portal() {
    if (busy) return;
    const assertSession = captureSessionGuard();
    setBusy(true);
    setError(null);
    try {
      const result = await api("/billing/portal", { method: "POST" });
      assertSession();
      if (!mounted.current) return;
      const url = safeExternalUrl(result.url);
      if (!url) throw new Error("The billing portal is unavailable. Please try again later.");
      window.location.assign(url);
    } catch (err) {
      if (mounted.current) {
        setError(err);
        setBusy(false);
      }
    }
  }
  return (
    <Dialog title="COVER LETTER PLANS" onClose={onClose} className="upgrade-dialog">
      <span className="upgrade-icon">
        <Sparkles size={30} />
      </span>
      <h2>
        {manageExisting
          ? exhausted ? "Your allowance has been used." : "Your RoleClue Plus plan."
          : plan.starter
            ? "Keep your search moving."
            : "Choose how you want to start."}
      </h2>
      <p>
        {manageExisting
          ? plan.message || (exhausted
            ? `You’ve used this period’s cover-letter allowance. ${plan.periodLabel}. A new allowance starts after a successful renewal. Your saved letters remain available.`
            : `You have ${billing.remaining} generations available. ${plan.periodLabel}.`)
          : plan.starter
            ? `You have ${billing?.remaining ?? 0} of ${billing?.limit ?? 2} Starter generations available. If you subscribe, Plus generations are used first and these unused Starter generations remain for later.`
            : "There is no free generation trial. Buy two Starter generations once, or choose a monthly allowance."}
      </p>
      {manageExisting && (
        <>
          <ErrorBox error={error} />
          {plan.canManageBilling && (
            <button className="button full" disabled={busy} onClick={portal}>
              {busy ? <Spinner>Opening Stripe</Spinner> : <>Manage subscription <ArrowUpRight size={17} /></>}
            </button>
          )}
        </>
      )}
      {!manageExisting && (
        <>
          {plan.message && (
            <div className="notice warning billing-status" role="status">
              {plan.message}
            </div>
          )}
          {plan.starter && (
            <div className="current-plan-summary" role="status">
              <CheckCircle2 size={18} />
              <span>
                <strong>Starter purchased</strong>
                {billing?.remaining ?? 0} of {billing?.limit ?? 2} generations remain.
              </span>
            </div>
          )}
          {!plan.canBuyStarter && !plan.starter && (
            <div className="current-plan-summary" role="status">
              <CheckCircle2 size={18} />
              <span>
                <strong>Starter is unavailable</strong>
                The one-time offer is available only before your first successful Starter or Plus payment.
              </span>
            </div>
          )}
          <fieldset className="pricing-options">
            <legend>Choose a cover-letter plan</legend>
            {plan.canBuyStarter && (
              <label className={cx("pricing-option", checkoutIsStarter && "selected")}>
                <input
                  type="radio"
                  name="cover-letter-plan"
                  value="starter"
                  checked={checkoutIsStarter}
                  disabled={busy}
                  onChange={() => choosePlan("starter")}
                />
                <span className="pricing-option-header">
                  <span className="eyebrow">STARTER</span>
                  <span className="pricing-tag">START SMALL</span>
                </span>
                <span className="pricing-amount">
                  <strong>A$1</strong>
                  <small>one time</small>
                </span>
                <span className="pricing-allowance">2 successful cover letters</span>
                <span className="pricing-detail">
                  One purchase per account. Credits do not expire.
                </span>
              </label>
            )}
            <label className={cx("pricing-option", !checkoutIsStarter && "selected")}>
              <input
                type="radio"
                name="cover-letter-plan"
                value="monthly"
                checked={!checkoutIsStarter}
                disabled={busy}
                onChange={() => choosePlan("monthly")}
              />
              <span className="pricing-option-header">
                <span className="eyebrow">PLUS</span>
                <span className="pricing-tag monthly">FOR AN ACTIVE SEARCH</span>
              </span>
              <span className="pricing-amount">
                <strong>A$20</strong>
                <small>per month</small>
              </span>
              <span className="pricing-allowance">50 successful cover letters each month</span>
              <span className="pricing-detail">
                Renews monthly until cancelled. Unused monthly generations do not roll over.
              </span>
            </label>
          </fieldset>
          <ul className="plan-benefits">
            <li>
              <Check size={17} />
              Manual edits, copies and downloads do not use a generation
            </li>
            <li>
              <Check size={17} />
              Your shortlist and saved applications remain free
            </li>
          </ul>
          <div className="billing-explanation">
            {checkoutIsStarter
              ? "One A$1 payment. This is not a subscription. Each successful draft uses one of the two Starter generations; failed drafts do not."
              : "A$20 is charged now, then monthly until cancelled. Each successful draft uses one of the 50 monthly generations; failed drafts do not."}
          </div>
          <label className="check-line">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              {checkoutIsStarter
                ? "I understand this is a one-time A$1 payment for 2 successful cover-letter generations and is not a subscription."
                : "I understand this is an A$20 monthly subscription with 50 successful cover-letter generations per billing period."}{" "}
              I accept the <a href="/terms.html" target="_blank" rel="noopener noreferrer">RoleClue terms</a>.
            </span>
          </label>
          <ErrorBox error={error} />
          <button
            className="button full"
            disabled={!accepted || busy}
            onClick={checkout}
          >
            {busy ? (
              <Spinner>Opening secure checkout</Spinner>
            ) : (
              <>
                {checkoutIsStarter
                  ? "Buy Starter for A$1"
                  : "Subscribe for A$20 per month"}
                <ArrowUpRight size={17} />
              </>
            )}
          </button>
          {plan.canManageBilling && (
            <button className="text-link billing-history-link" disabled={busy} onClick={portal}>
              View billing history in Stripe
              <ArrowUpRight size={14} />
            </button>
          )}
        </>
      )}
      <button className="text-link upgrade-later" onClick={onClose}>
        {manageExisting ? "Back to my applications" : "Not now"}
      </button>
    </Dialog>
  );
}

export function AccountScreen({ api, config, me, onBilling, onUpgrade, onNotice, onDeleted, dataOnly = false }) {
  const capabilities = capabilitiesFor(config, me.capabilities);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(null),
    [deleteOpen, setDeleteOpen] = useState(false),
    [confirmation, setConfirmation] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const billing = me.billing;
  const plan = billingPresentation(billing, date);
  async function portal() {
    if (busy) return;
    const assertSession = captureSessionGuard();
    setBusy("portal");
    setError(null);
    try {
      const result = await api("/billing/portal", { method: "POST" });
      assertSession();
      if (!mounted.current) return;
      const url = safeExternalUrl(result.url);
      if (!url)
        throw new Error(
          "The billing portal is unavailable. Please try again later.",
        );
      window.location.assign(url);
    } catch (err) {
      if (mounted.current) {
        setError(err);
        setBusy("");
      }
    }
  }
  async function refreshBilling() {
    if (busy || !capabilities.billing) return;
    setBusy("billing");
    setError(null);
    try {
      await refreshBillingStatus(api, {
        onBilling,
        assertCurrent() {
          if (!mounted.current) throw new Error("This account page was closed.");
        },
      });
      onNotice("Your billing status and allowance have been refreshed.");
    } catch (err) {
      if (mounted.current) setError(err);
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  async function exportData() {
    const assertSession = captureSessionGuard();
    const assertCurrent = () => {
      assertSession();
      if (!mounted.current)
        throw new Error(
          "The export was cancelled because this page was closed.",
        );
    };
    setBusy("export");
    setError(null);
    try {
      const result = await loadAccountExport(api, { assertCurrent });
      assertCurrent();
      downloadText(
        JSON.stringify(result, null, 2),
        `roleclue-account-${new Date().toISOString().slice(0, 10)}.json`,
        "application/json",
      );
      onNotice("Your account export is ready. Keep this file private.");
    } catch (err) {
      if (mounted.current) setError(err);
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  async function deleteAccount() {
    setBusy("delete");
    setError(null);
    try {
      const result = await api("/account", {
        method: "DELETE",
        body: { confirmation },
      });
      if (!result.deleted)
        throw new Error("Deletion was not confirmed. Please try again.");
      onDeleted();
    } catch (err) {
      setError(err);
      setBusy("");
    }
  }
  return (
    <div className="page account-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE, YOUR CONTROL</p>
          <h1>{dataOnly ? "Account & data." : "Account & plan."}</h1>
          <p>{dataOnly ? "Export or delete your account before you continue." : "Manage your allowance, billing and data."}</p>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className={cx("account-grid", dataOnly && "data-only")}>
        {!dataOnly && <section className="panel account-card">
          <span className="eyebrow">YOUR PLAN</span>
          <h2>
            {plan.paid || plan.hasSubscription
              ? "RoleClue Plus"
              : plan.starter
                ? "RoleClue Starter"
                : "Free workspace"}
          </h2>
          <div className="plan-price">
            {plan.paid || plan.hasSubscription
              ? "A$20"
              : plan.starter
                ? "A$1"
                : "A$0"}
            <span>
              {plan.paid || plan.hasSubscription
                ? "per month"
                : plan.starter
                  ? "one-time purchase"
                  : "no cover-letter credits"}
            </span>
          </div>
          {capabilities.coverLetters && billing.limit > 0 ? (
            <div className="usage-meter">
              <span>
                <strong>{billing.used}</strong> / {billing.limit} successful
                generations
              </span>
              <progress
                aria-label="Cover-letter generation allowance used"
                value={billing.used}
                max={billing.limit}
              />
              <small>
                {billing.reserved
                  ? `${billing.reserved} currently processing · `
                  : ""}
                {billing.remaining} available
                {` · ${plan.periodLabel}`}
              </small>
            </div>
          ) : capabilities.coverLetters ? (
            <div className="no-credit-summary">
              <Sparkles size={18} />
              <span>
                <strong>No cover-letter credits are active.</strong>
                Choose Starter for two generations or Plus for 50 each month.
              </span>
            </div>
          ) : (
            <div className="notice warning">
              <p>
                AI cover-letter generation is currently unavailable. You can
                manage your profile, applications and any saved drafts.
              </p>
            </div>
          )}
          {plan.message && <div className="notice warning billing-status" role="status">{plan.message}</div>}
          {capabilities.billing && (
            <div className="billing-actions">
            {plan.canSubscribe && (
              <button className="button" disabled={Boolean(busy)} onClick={onUpgrade}>
                View cover-letter plans
                <ArrowRight size={17} />
              </button>
            )}
            {plan.canManageBilling && (
              <button
                className="button secondary"
                disabled={Boolean(busy)}
                onClick={portal}
              >
                {busy === "portal" ? (
                  <Spinner>Opening Stripe</Spinner>
                ) : (
                  <>
                    {plan.hasSubscription || plan.paid
                      ? "Manage subscription"
                      : "View billing history"}
                    <ArrowUpRight size={17} />
                  </>
                )}
              </button>
            )}
            <button className="text-link" disabled={Boolean(busy)} onClick={refreshBilling}>
              {busy === "billing" ? <Spinner>Refreshing billing</Spinner> : <><RefreshCw size={15} />Refresh billing status</>}
            </button>
            </div>
          )}
          {!capabilities.billing && (
            <p className="subtle">
              Paid generation plans are currently unavailable.
              {!plan.hasSubscription && !plan.paid
                ? " No payment is required for the features currently available."
                : " Contact support if you need help managing your existing subscription."}
            </p>
          )}
          <p className="subtle">
            Matching, tracking and access to your existing drafts remain free.
          </p>
          {billing.subscriptionStatus && billing.subscriptionStatus !== "none" && (
            <Pill tone="neutral">Subscription: {label(billing.subscriptionStatus)}</Pill>
          )}
        </section>}
        <section className="panel account-card">
          <span className="eyebrow">YOUR DETAILS</span>
          <h2>{me.profile.name || "Your account"}</h2>
          <p>{me.profile.email || readSession()?.email}</p>
          <div className="account-detail">
            <ShieldCheck size={19} />
            <div>
              <strong>Your resume is private</strong>
              <p>
                Your details are used for your matches and application drafts.
              </p>
            </div>
          </div>
          {!dataOnly && (
            <a href="#profile" className="button secondary">
              Edit profile
              <UserRound size={16} />
            </a>
          )}
          <div className="account-legal">
            <a href="/privacy.html" target="_blank" rel="noreferrer">
              Privacy notice
              <ArrowUpRight size={13} />
            </a>
            <a href="/terms.html" target="_blank" rel="noreferrer">
              Terms
              <ArrowUpRight size={13} />
            </a>
          </div>
        </section>
      </div>
      <section className="panel data-card">
        <div>
          <h2>Your data belongs to you.</h2>
          <p>
            Download your profile, applications and drafts, or permanently
            delete your account.
          </p>
        </div>
        <div>
          <button
            className="button secondary"
            disabled={Boolean(busy)}
            onClick={exportData}
          >
            {busy === "export" ? (
              <Spinner>Preparing export</Spinner>
            ) : (
              <>
                Export my data
                <ArrowDownToLine size={16} />
              </>
            )}
          </button>
          <button
            className="text-link danger-text"
            disabled={Boolean(busy)}
            onClick={() => {
              setConfirmation("");
              setError(null);
              setDeleteOpen(true);
            }}
          >
            Delete account
          </button>
        </div>
      </section>
      {deleteOpen && (
        <Dialog title="DELETE ACCOUNT" onClose={() => setDeleteOpen(false)}>
          <h2>Delete your RoleClue account?</h2>
          <p>
            This permanently removes your profile, resume, saved applications
            and letters. Export anything you need first. Cancel an active
            subscription in Stripe before deleting your account. Billing records
            may be retained as required by law.
          </p>
          <Field label="Type DELETE to confirm">
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <ErrorBox error={error} />
          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => setDeleteOpen(false)}
            >
              Keep account
            </button>
            <button
              className="button danger"
              disabled={confirmation !== "DELETE" || Boolean(busy)}
              onClick={deleteAccount}
            >
              {busy === "delete" ? (
                <Spinner>Deleting</Spinner>
              ) : (
                "Delete permanently"
              )}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
