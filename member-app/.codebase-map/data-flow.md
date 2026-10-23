# Verified runtime flows

## Guest discovery to paid application

Confidence: **Confirmed**

1. Guided job-search interview
2. Editable understanding summary
3. Guest session
4. Resume-shortcut explanation and consent
5. Resume extraction
6. Merge interview answers with resume evidence
7. Human profile confirmation
8. Authorised job search
9. High-fit ranking
10. Five visible matches
11. Interested
12. Cognito or Google sign-in
13. Guest claim transaction
14. Stripe plan gate
15. Verified entitlement
16. Application workspace

Evidence: `src/GuestJourney.jsx:557-631`, `src/App.jsx:480-552`, `server/service.mjs:238-349`, `server/service.mjs:104-127`

## Signed-in resume upload

Confidence: **Confirmed**

1. Complete the guided job-search interview
2. Save the incomplete profile with `interviewCompleted=true`
3. Select PDF or DOCX
4. Request upload grant
5. Direct bounded S3 PUT
6. Finalize upload
7. Validate bytes and archive
8. Extract text and suggestions without replacing interview constraints
9. User review
10. Confirm profile

Evidence: `src/api.js:370-467`, `src/App.jsx:1773-1824`, `server/service.mjs:164-199`, `server/adapters.mjs:155-167`

## Opportunity to application

Confidence: **Confirmed**

1. Ranked opportunities
2. Match evidence
3. Interested decision
4. Server revalidation
5. APP# snapshot
6. Applications route
7. Selected workspace

Evidence: `src/App.jsx:2381-2447`, `server/service.mjs:373-410`, `src/App.jsx:3181-3324`

## Cover-letter generation

Confidence: **Confirmed**

1. Consent and availability checks
2. Idempotency lookup
3. Reserve product allowance
4. Create pending GEN#
5. Async Lambda event
6. Reserve shared AI budget
7. OpenAI Responses API
8. Reconcile cost
9. Store LETTER# or restore allowance
10. Browser polling result

Evidence: `src/App.jsx:3399-3517`, `server/service.mjs:459-508`, `server/adapters.mjs:13-105`, `server/ai-budget.mjs:82-367`

## Stripe entitlement

Confidence: **Confirmed**

1. Plan and terms
2. Checkout lock
3. Canonical reconcile
4. Fixed server price
5. Stripe Checkout
6. Signed webhook or manual refresh
7. ENTITLEMENT update
8. 2 Starter or 50 Plus letters

Evidence: `src/App.jsx:1119-1291`, `server/service.mjs:511-550`, `server/adapters.mjs:170-342`

## Daily job refresh

Confidence: **Confirmed**

1. 06:00 Australia/Sydney schedule
2. feed-refresh Lambda event
3. DynamoDB refresh lock
4. Fetch authorised feeds
5. Write immutable snapshot
6. Switch FEED#catalog STATUS
7. Remove previous snapshot

Evidence: `infra/template.mjs:171-172`, `server/handler.mjs:86`, `server/adapters.mjs:109-150`
