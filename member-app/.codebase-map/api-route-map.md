# API route map

| Method | Route | Access | Service | Logic | Evidence |
|---|---|---|---|---|---|
| `OPTIONS` | `*` | Public | `CORS preflight` | Returns allowed methods and headers without invoking business logic. | `server/handler.mjs:18`; `inline` |
| `GET` | `/api/health` | Public | `Inline health response` | Returns the runtime mode and health flag. | `server/handler.mjs:19`; `inline` |
| `POST` | `/api/stripe/webhook` | Public, signed by Stripe | `webhook` | Verifies the Stripe signature and reconciles canonical billing state. | `server/handler.mjs:22`; `server/service.mjs:601; server/adapters.mjs:332-340` |
| `POST` | `/api/guest/start` | Public guest | `startGuest` | Creates a rate-limited 24-hour guest session with an opaque token. | `server/handler.mjs:26`; `server/service.mjs:238-250` |
| `POST` | `/api/guest/resume` | Public guest | `guestResume` | Validates and extracts a PDF or DOCX, then creates editable profile suggestions. | `server/handler.mjs:27`; `server/service.mjs:252-265` |
| `PUT` | `/api/guest/profile` | Public guest | `saveGuestProfile` | Validates the reviewed profile, visa constraints, sponsorship need and terms acceptance. | `server/handler.mjs:28`; `server/service.mjs:267-279` |
| `POST` | `/api/guest/profile` | Public guest | `saveGuestProfile` | Compatibility alias for guest profile confirmation. | `server/handler.mjs:28`; `server/service.mjs:267-279` |
| `POST` | `/api/guest/search` | Public guest | `searchGuest` | Searches authorised ATS jobs, ranks high-fit results, stores at most 30 and returns five. | `server/handler.mjs:29`; `server/service.mjs:281-297` |
| `POST` | `/api/guest/session` | Public guest | `readGuest` | Restores a guest session and its current visible opportunity set. | `server/handler.mjs:30`; `server/service.mjs:251` |
| `POST` | `/api/guest/ignore` | Public guest | `ignoreGuest` | Marks a guest result ignored and replenishes the visible five from the ranked set. | `server/handler.mjs:31`; `server/service.mjs:299-308` |
| `GET` | `/api/me` | Cognito JWT | `account` | Returns profile, billing, continuation, feed and capability state. | `server/handler.mjs:42`; `server/service.mjs:128` |
| `POST` | `/api/guest/claim` | Cognito JWT | `claimGuest` | Copies the confirmed guest profile and shortlist, creates the selected application and continuation state in one transaction. | `server/handler.mjs:43`; `server/service.mjs:310-349` |
| `POST` | `/api/guest/abandon` | Cognito JWT | `abandonGuest` | Abandons a guest continuation when the signed-in account keeps its existing profile. | `server/handler.mjs:44`; `server/service.mjs:351-371` |
| `POST` | `/api/continuation/complete` | Cognito JWT | `completeContinuation` | Verifies paid generation access, clears continuation state and opens the selected application. | `server/handler.mjs:45`; `server/service.mjs:116-127` |
| `PUT` | `/api/profile` | Cognito JWT | `saveProfile` | Sanitises and stores the confirmed member profile with optimistic concurrency. | `server/handler.mjs:46`; `server/service.mjs:129` |
| `POST` | `/api/resume` | Cognito JWT | `uploadResume` | Processes an inline base64 resume, stores the validated original and clears profile confirmation. | `server/handler.mjs:47`; `server/service.mjs:154-163` |
| `POST` | `/api/resume/upload` | Cognito JWT | `startUpload` | Creates a bounded five-minute S3 upload grant for a larger resume. | `server/handler.mjs:48`; `server/service.mjs:164-173` |
| `POST` | `/api/resume/finalize` | Cognito JWT | `finalizeUpload` | Claims, verifies, parses and promotes the pending S3 object into a validated profile source. | `server/handler.mjs:49`; `server/service.mjs:174-199` |
| `GET` | `/api/opportunities` | Cognito JWT | `opportunities` | Reassesses feed and imported jobs, then returns at most 30 undecided high-fit roles. | `server/handler.mjs:50`; `server/service.mjs:373-380` |
| `POST` | `/api/opportunities/import` | Cognito JWT | `importOpportunity` | Validates a pasted listing and stores it only when the evidence-based match passes. | `server/handler.mjs:51`; `server/service.mjs:381-399` |
| `GET` | `/api/ignored` | Cognito JWT | `opportunities` | Returns currently ignored opportunities using the same current-match pipeline. | `server/handler.mjs:52`; `server/service.mjs:373-380` |
| `POST` | `/api/opportunities/{id}/decision` | Cognito JWT | `decision` | Stores Interested, Ignore or Undo. Interested creates an application after revalidation. | `server/handler.mjs:53`; `server/service.mjs:400-410` |
| `GET` | `/api/applications` | Cognito JWT | `applications` | Returns byte-bounded pages of applications, saved letters and current availability. | `server/handler.mjs:54`; `server/service.mjs:424-457` |
| `PATCH` | `/api/applications/{id}` | Cognito JWT | `updateApplication` | Updates application status and notes. | `server/handler.mjs:55`; `server/service.mjs:458` |
| `POST` | `/api/applications/{id}/letters` | Cognito JWT | `generate` | Reserves allowance and creates or replays an idempotent asynchronous generation. | `server/handler.mjs:56`; `server/service.mjs:459-483` |
| `GET` | `/api/generations/{id}` | Cognito JWT | `generationResult` | Returns safe generation state and the current allowance for polling. | `server/handler.mjs:57`; `server/service.mjs:484` |
| `PATCH` | `/api/applications/{id}/letters/{letterId}` | Cognito JWT | `editLetter` | Stores a manual cover-letter edit without consuming another generation. | `server/handler.mjs:58`; `server/service.mjs:510` |
| `POST` | `/api/billing/checkout` | Cognito JWT | `checkout` | Reconciles Stripe, checks plan eligibility and creates or reuses a fixed-price checkout. | `server/handler.mjs:59`; `server/service.mjs:511-543` |
| `POST` | `/api/billing/portal` | Cognito JWT | `portal` | Creates a Stripe Billing Portal session for the stored customer. | `server/handler.mjs:60`; `server/service.mjs:544` |
| `POST` | `/api/billing/refresh` | Cognito JWT | `refreshBilling` | Rate-limits and reconciles canonical Stripe entitlement state. | `server/handler.mjs:61`; `server/service.mjs:545-550` |
| `GET` | `/api/export` | Cognito JWT | `exportAccount` | Returns a paginated privacy-safe account export. | `server/handler.mjs:62`; `server/service.mjs:551-572` |
| `DELETE` | `/api/account` | Cognito JWT | `deleteAccount` | Fences deletion, checks billing and pending work, removes S3/Cognito data and deletes the user partition. | `server/handler.mjs:63`; `server/service.mjs:573-599` |
