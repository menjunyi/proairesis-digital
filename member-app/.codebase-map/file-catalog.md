# File catalog

67 analysed files, ordered by architectural importance. Paths are repository-relative; excluded private and generated content is not listed.

| File | Language | Role | Purpose | Incoming | Outgoing |
|---|---|---|---|---:|---:|
| `server/service.mjs` | JavaScript | Service / business logic | Coordinates RoleClue profiles, matching, applications, generation, billing and account lifecycle. Located at `server/service.mjs`. | 45 | 7 |
| `server/handler.mjs` | JavaScript | API entry point / route | Dispatches public and JWT-protected HTTP routes plus worker and feed-refresh events. Located at `server/handler.mjs`. | 7 | 38 |
| `server/store.mjs` | JavaScript | Data access | Implements DynamoDB reads, prefix queries, optimistic transactions and size limits. Located at `server/store.mjs`. | 22 | 3 |
| `src/App.jsx` | JavaScript | Frontend application | Owns authentication, continuation, payment gating, navigation and member screens. Located at `src/App.jsx`. | 2 | 27 |
| `server/matching.mjs` | JavaScript | Domain logic | Calculates evidence-backed job fit and match explanations. Located at `server/matching.mjs`. | 13 | 0 |
| `server/adapters.mjs` | JavaScript | Integration adapter | Connects OpenAI, Stripe, S3, SSM, job feeds and runtime services. Located at `server/adapters.mjs`. | 6 | 16 |
| `infra/template.mjs` | JavaScript | Infrastructure | Generates the production AWS CloudFormation templates. Located at `infra/template.mjs`. | 2 | 12 |
| `scripts/prepare-release.mjs` | JavaScript | Build pipeline | Creates browser configuration and a hash-based release manifest. Located at `scripts/prepare-release.mjs`. | 2 | 8 |
| `server/resume.mjs` | JavaScript | Document processing | Validates and extracts bounded PDF and DOCX resume text. Located at `server/resume.mjs`. | 6 | 4 |
| `src/auth.js` | JavaScript | Authentication | Implements Cognito password flows, Google PKCE and session refresh fencing. Located at `src/auth.js`. | 6 | 2 |
| `server/imported-jobs.mjs` | JavaScript | Domain logic | Validates and normalises user-pasted job opportunities. Located at `server/imported-jobs.mjs`. | 5 | 3 |
| `scripts/build-lambda.mjs` | JavaScript | Build pipeline | Bundles the Node.js Lambda with esbuild and creates the deployment ZIP. Located at `scripts/build-lambda.mjs`. | 1 | 6 |
| `src/api.js` | JavaScript | Frontend API client | Sends authenticated and guest requests, paginates collections and manages resume uploads. Located at `src/api.js`. | 5 | 2 |
| `server/ai-budget.mjs` | JavaScript | Budget control | Reserves and reconciles the shared external-AI daily budget. Located at `server/ai-budget.mjs`. | 4 | 3 |
| `src/GuestJourney.jsx` | JavaScript | Frontend journey | Runs the unauthenticated interview, resume shortcut, combined confirmation and match flow. Located at `src/GuestJourney.jsx`. | 4 | 8 |
| `src/CareerInterview.jsx` | JavaScript | Frontend onboarding | Shared guided interview and editable understanding summary. Located at `src/CareerInterview.jsx`. | 2 | 0 |
| `src/intake.js` | JavaScript | Frontend domain logic | Normalizes interview answers, validates required fields and merges explicit constraints into profiles. Located at `src/intake.js`. | 0 | 2 |
| `scripts/validate-stripe-sandbox.mjs` | JavaScript | Other | Contains other code or project material. Located at `scripts/validate-stripe-sandbox.mjs`. | 1 | 10 |
| `server/freehire.mjs` | JavaScript | Job source adapter | Normalises authorised direct-ATS Australian job search results. Located at `server/freehire.mjs`. | 2 | 6 |
| `scripts/ai-budget.mjs` | JavaScript | Other | Contains other code or project material. Located at `scripts/ai-budget.mjs`. | 1 | 8 |
| `server/feed-sources.mjs` | JavaScript | Job source adapter | Fetches and normalises configured licensed ATS feeds. Located at `server/feed-sources.mjs`. | 2 | 5 |
| `scripts/smoke-cloud.mjs` | JavaScript | Other | Contains other code or project material. Located at `scripts/smoke-cloud.mjs`. | 1 | 7 |
| `tests/frontend-billing.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/frontend-billing.test.mjs`. | 0 | 10 |
| `scripts/cleanup-smoke-orphans.mjs` | JavaScript | Other | Contains other code or project material. Located at `scripts/cleanup-smoke-orphans.mjs`. | 0 | 9 |
| `scripts/smoke-browser.mjs` | JavaScript | Other | Contains other code or project material. Located at `scripts/smoke-browser.mjs`. | 0 | 9 |
| `server/local.mjs` | JavaScript | Other | Contains other code or project material. Located at `server/local.mjs`. | 1 | 6 |
| `src/guest-state.js` | JavaScript | Frontend state policy | Persists only opaque guest and continuation identifiers and validates guest profile input. Located at `src/guest-state.js`. | 3 | 0 |
| `tests/core.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/core.test.mjs`. | 0 | 9 |
| `scripts/reconcile-generation.mjs` | JavaScript | Other | Contains other code or project material. Located at `scripts/reconcile-generation.mjs`. | 1 | 5 |
| `server/operator.mjs` | JavaScript | Other | Contains other code or project material. Located at `server/operator.mjs`. | 2 | 2 |
| `tests/extraction-billing.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/extraction-billing.test.mjs`. | 0 | 8 |
| `tests/guest-onboarding.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/guest-onboarding.test.mjs`. | 0 | 8 |
| `server/profile-extraction.mjs` | JavaScript | Domain logic | Derives editable profile suggestions from extracted resume text. Located at `server/profile-extraction.mjs`. | 2 | 1 |
| `tests/storage-limits.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/storage-limits.test.mjs`. | 0 | 7 |
| `tests/upload-availability.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/upload-availability.test.mjs`. | 0 | 7 |
| `src/billing-state.js` | JavaScript | Frontend state policy | Maps verified billing state to plan and checkout-return presentation. Located at `src/billing-state.js`. | 2 | 0 |
| `src/ui-state.js` | JavaScript | Frontend state policy | Centralises route gates, recovery choices and merge rules. Located at `src/ui-state.js`. | 2 | 0 |
| `tests/billing-lifecycle.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/billing-lifecycle.test.mjs`. | 0 | 6 |
| `tests/frontend-pagination.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/frontend-pagination.test.mjs`. | 0 | 6 |
| `tests/matching-reasons.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/matching-reasons.test.mjs`. | 0 | 6 |
| `tests/operator.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/operator.test.mjs`. | 0 | 6 |
| `tests/pagination.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/pagination.test.mjs`. | 0 | 6 |
| `src/main.jsx` | JavaScript | Entry point | Starts or wires a runtime. Located at `src/main.jsx`. | 0 | 5 |
| `tests/ai-budget-cli.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/ai-budget-cli.test.mjs`. | 0 | 5 |
| `tests/ai-budget.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/ai-budget.test.mjs`. | 0 | 5 |
| `tests/import-service.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/import-service.test.mjs`. | 0 | 5 |
| `package.json` | JSON | Configuration | Controls build, runtime, or tool behavior. Located at `package.json`. | 0 | 4 |
| `scripts/smoke-signup.mjs` | JavaScript | Other | Contains other code or project material. Located at `scripts/smoke-signup.mjs`. | 0 | 4 |
| `server/guest-onboarding.mjs` | JavaScript | Domain logic | Defines guest tokens, TTLs, hashing and rate limits. Located at `server/guest-onboarding.mjs`. | 1 | 1 |
| `tests/frontend-decisions.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/frontend-decisions.test.mjs`. | 0 | 4 |
| `tests/frontend-state.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/frontend-state.test.mjs`. | 0 | 4 |
| `tests/release-billing-copy.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/release-billing-copy.test.mjs`. | 0 | 4 |
| `tests/resume-security.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/resume-security.test.mjs`. | 0 | 4 |
| `scripts/cleanup-failed-deployment.mjs` | JavaScript | Other | Contains other code or project material. Located at `scripts/cleanup-failed-deployment.mjs`. | 0 | 3 |
| `src/availability.js` | JavaScript | Frontend state policy | Controls closed-listing display and idempotent generation replay. Located at `src/availability.js`. | 1 | 0 |
| `src/styles.css` | CSS | Other | Contains other code or project material. Located at `src/styles.css`. | 1 | 0 |
| `tests/error-logging.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/error-logging.test.mjs`. | 0 | 3 |
| `tests/feed-sources.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/feed-sources.test.mjs`. | 0 | 3 |
| `tests/freehire.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/freehire.test.mjs`. | 0 | 3 |
| `tests/frontend-onboarding.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/frontend-onboarding.test.mjs`. | 0 | 3 |
| `tests/imported-jobs.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/imported-jobs.test.mjs`. | 0 | 3 |
| `tests/infra.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/infra.test.mjs`. | 0 | 3 |
| `tests/stripe-sandbox-cli.test.mjs` | JavaScript | Test | Checks expected behavior. Located at `tests/stripe-sandbox-cli.test.mjs`. | 0 | 3 |
| `vite.config.mjs` | JavaScript | Configuration | Controls build, runtime, or tool behavior. Located at `vite.config.mjs`. | 0 | 2 |
| `contract.json` | JSON | Other | Contains other code or project material. Located at `contract.json`. | 0 | 1 |
| `public/privacy.html` | HTML | Other | Contains other code or project material. Located at `public/privacy.html`. | 0 | 1 |
| `scripts/create-demo-resume.mjs` | JavaScript | Other | Contains other code or project material. Located at `scripts/create-demo-resume.mjs`. | 0 | 1 |
| `index.html` | HTML | Other | Contains other code or project material. Located at `index.html`. | 0 | 0 |
| `public/terms.html` | HTML | Other | Contains other code or project material. Located at `public/terms.html`. | 0 | 0 |
