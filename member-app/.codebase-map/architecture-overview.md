# RoleClue architecture overview

Snapshot: 17 October 2026 (Australia/Sydney). Scope: `landing-page/member-app` working tree. The member app is untracked in the parent repository, so the parent commit is not source provenance for these files.

## Runtime shape

RoleClue is a React 19 and Vite 8 single-page application. CloudFront serves the private-S3 browser build and forwards `/api/*` to API Gateway. API Gateway validates Cognito JWTs before invoking one Node.js 22 Lambda. The Lambda also handles asynchronous generation and scheduled feed-refresh events. DynamoDB is the product source of truth. A separate private S3 bucket holds validated resume originals for seven days.

## Main modules

| File | Role | Logic | Evidence |
|---|---|---|---|
| `src/App.jsx` | Frontend application controller | Selects guest/auth/payment/member states and owns the four member screens. | `src/App.jsx:265-1117` |
| `src/GuestJourney.jsx` | Guest journey | Runs interview, resume shortcut, combined review and five-match discovery before registration. | `src/GuestJourney.jsx` |
| `src/CareerInterview.jsx` | Shared onboarding UI | Guides guest and signed-in users through goals, eligibility and practical constraints before resume upload. | `src/CareerInterview.jsx` |
| `src/intake.js` | Interview state | Validates interview answers, builds the editable summary and applies user-supplied constraints to a profile without replacing resume evidence. | `src/intake.js` |
| `src/api.js` | Browser transport | Adds Cognito tokens, request timeouts, idempotency headers, pagination and direct upload handling. | `src/api.js:6-467` |
| `src/auth.js` | Authentication | Implements Cognito password flows, Google PKCE, refresh and stale-session fencing. | `src/auth.js:1-316` |
| `src/ui-state.js` | Frontend policy/state | Centralises route gating, continuation recovery and safe merge decisions. | `src/ui-state.js:1-95` |
| `server/handler.mjs` | Lambda/API dispatcher | Validates HTTP boundaries, authenticates JWT claims and dispatches worker or scheduler events. | `server/handler.mjs:8-86` |
| `server/service.mjs` | Business service | Owns profiles, guest search, decisions, applications, generation, billing, export and deletion. | `server/service.mjs:97-601` |
| `server/store.mjs` | DynamoDB access | Provides consistent reads, prefix queries, transactions, revisions and size enforcement. | `server/store.mjs:1-50` |
| `server/matching.mjs` | Evidence matcher | Scores high-fit roles and returns matched, missing and confirmation evidence. | `server/matching.mjs:1-136` |
| `server/resume.mjs` | Resume parser | Validates PDF/DOCX size and structure, then extracts bounded text. | `server/resume.mjs:3-116` |
| `server/adapters.mjs` | External adapters | Connects SSM, OpenAI, S3, feeds, Stripe and Cognito-facing operations. | `server/adapters.mjs:10-342` |
| `server/ai-budget.mjs` | Shared AI budget | Reserves and reconciles daily external-AI cost with uncertain-outcome handling. | `server/ai-budget.mjs:82-367` |
| `server/freehire.mjs` | Live job search adapter | Reads authorised direct-ATS Australian jobs and rejects aggregator destinations. | `server/freehire.mjs:59-146` |
| `infra/template.mjs` | AWS infrastructure | Generates S3, CloudFront, API Gateway, Lambda, Cognito, DynamoDB, EventBridge, SQS and alarms. | `infra/template.mjs:78-210` |

## Verified boundaries

- Browser: React screens, local continuation state, Cognito/Google authentication, API client and direct resume upload.
- AWS application: API Gateway, Lambda business service, DynamoDB, private S3, SSM, scheduler, SQS failure destination and CloudWatch.
- External providers: Stripe, OpenAI, Freehire and configured authorised ATS feeds.
- User-provided SEEK and LinkedIn links can be imported; they are not live search feeds in the current implementation.

## Reading order

1. `src/App.jsx:265-1117` for application states and page selection.
2. `src/CareerInterview.jsx`, `src/intake.js` and `src/GuestJourney.jsx` for interview-first pre-registration discovery.
3. `server/handler.mjs:8-86` for request and event dispatch.
4. `server/service.mjs:97-601` for product rules.
5. `server/adapters.mjs:10-342` and `server/store.mjs:1-50` for external and storage boundaries.
6. `infra/template.mjs:78-210` for the deployed topology.
