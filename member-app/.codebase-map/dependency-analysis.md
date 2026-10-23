# Dependency analysis

360 relationships from the enriched Codebase Visualizer model. The route, page and runtime-flow documentation adds manually verified behavior that generic import analysis cannot infer.

| Source | Relationship | Target | Confidence | Evidence |
|---|---|---|---|---|
| `contract.json` | uses external service | `external:proairesis.digital` | Confirmed | `contract.json:5` |
| `infra/template.mjs` | imports | `package:node:fs` | Confirmed | `infra/template.mjs:1` |
| `infra/template.mjs` | imports | `package:node:path` | Confirmed | `infra/template.mjs:2` |
| `infra/template.mjs` | imports | `package:node:url` | Confirmed | `infra/template.mjs:3` |
| `infra/template.mjs` | uses external service | `external:freehire.me` | Confirmed | `infra/template.mjs:65` |
| `infra/template.mjs` | uses external service | `external:checkout.stripe.com` | Confirmed | `infra/template.mjs:179` |
| `package.json` | configures | `infra/template.mjs` | Strongly inferred | `package.json:1` |
| `package.json` | configures | `server/local.mjs` | Strongly inferred | `package.json:1` |
| `package.json` | configures | `scripts/build-lambda.mjs` | Strongly inferred | `package.json:1` |
| `package.json` | configures | `scripts/prepare-release.mjs` | Strongly inferred | `package.json:1` |
| `public/privacy.html` | uses external service | `external:stripe.com` | Confirmed | `public/privacy.html:312` |
| `scripts/ai-budget.mjs` | imports | `package:node:crypto` | Confirmed | `scripts/ai-budget.mjs:1` |
| `scripts/ai-budget.mjs` | imports | `package:node:child_process` | Confirmed | `scripts/ai-budget.mjs:2` |
| `scripts/ai-budget.mjs` | imports | `package:node:util` | Confirmed | `scripts/ai-budget.mjs:3` |
| `scripts/ai-budget.mjs` | imports | `package:node:url` | Confirmed | `scripts/ai-budget.mjs:4` |
| `scripts/ai-budget.mjs` | imports | `server/store.mjs` | Confirmed | `scripts/ai-budget.mjs:5` |
| `scripts/ai-budget.mjs` | imports | `server/ai-budget.mjs` | Confirmed | `scripts/ai-budget.mjs:6` |
| `scripts/ai-budget.mjs` | dynamic imports | `package:@aws-sdk` | Confirmed | `scripts/ai-budget.mjs:126` |
| `scripts/ai-budget.mjs` | dynamic imports | `package:@aws-sdk` | Confirmed | `scripts/ai-budget.mjs:127` |
| `scripts/build-lambda.mjs` | imports | `package:esbuild` | Confirmed | `scripts/build-lambda.mjs:1` |
| `scripts/build-lambda.mjs` | imports | `package:node:fs` | Confirmed | `scripts/build-lambda.mjs:2` |
| `scripts/build-lambda.mjs` | imports | `package:node:child_process` | Confirmed | `scripts/build-lambda.mjs:3` |
| `scripts/build-lambda.mjs` | imports | `package:node:crypto` | Confirmed | `scripts/build-lambda.mjs:4` |
| `scripts/build-lambda.mjs` | imports | `package:node:path` | Confirmed | `scripts/build-lambda.mjs:5` |
| `scripts/build-lambda.mjs` | imports | `package:node:module` | Confirmed | `scripts/build-lambda.mjs:13` |
| `scripts/cleanup-failed-deployment.mjs` | imports | `package:node:child_process` | Confirmed | `scripts/cleanup-failed-deployment.mjs:1` |
| `scripts/cleanup-failed-deployment.mjs` | imports | `package:node:path` | Confirmed | `scripts/cleanup-failed-deployment.mjs:2` |
| `scripts/cleanup-failed-deployment.mjs` | imports | `package:node:url` | Confirmed | `scripts/cleanup-failed-deployment.mjs:3` |
| `scripts/cleanup-smoke-orphans.mjs` | imports | `package:node:child_process` | Confirmed | `scripts/cleanup-smoke-orphans.mjs:1` |
| `scripts/cleanup-smoke-orphans.mjs` | imports | `package:node:crypto` | Confirmed | `scripts/cleanup-smoke-orphans.mjs:2` |
| `scripts/cleanup-smoke-orphans.mjs` | imports | `package:node:path` | Confirmed | `scripts/cleanup-smoke-orphans.mjs:3` |
| `scripts/cleanup-smoke-orphans.mjs` | imports | `package:node:url` | Confirmed | `scripts/cleanup-smoke-orphans.mjs:4` |
| `scripts/cleanup-smoke-orphans.mjs` | imports | `package:@aws-sdk` | Confirmed | `scripts/cleanup-smoke-orphans.mjs:5` |
| `scripts/cleanup-smoke-orphans.mjs` | imports | `package:@aws-sdk` | Confirmed | `scripts/cleanup-smoke-orphans.mjs:9` |
| `scripts/cleanup-smoke-orphans.mjs` | imports | `package:@aws-sdk` | Confirmed | `scripts/cleanup-smoke-orphans.mjs:10` |
| `scripts/cleanup-smoke-orphans.mjs` | imports | `package:@aws-sdk` | Confirmed | `scripts/cleanup-smoke-orphans.mjs:16` |
| `scripts/cleanup-smoke-orphans.mjs` | uses storage | `storage:S3-compatible object storage` | Strongly inferred | `scripts/cleanup-smoke-orphans.mjs:1` |
| `scripts/create-demo-resume.mjs` | imports | `package:node:fs` | Confirmed | `scripts/create-demo-resume.mjs:1` |
| `scripts/prepare-release.mjs` | imports | `package:node:fs` | Confirmed | `scripts/prepare-release.mjs:1` |
| `scripts/prepare-release.mjs` | imports | `package:node:child_process` | Confirmed | `scripts/prepare-release.mjs:2` |
| `scripts/prepare-release.mjs` | imports | `package:node:crypto` | Confirmed | `scripts/prepare-release.mjs:3` |
| `scripts/prepare-release.mjs` | imports | `package:node:url` | Confirmed | `scripts/prepare-release.mjs:4` |
| `scripts/prepare-release.mjs` | uses external service | `external:proairesis.digital` | Confirmed | `scripts/prepare-release.mjs:13` |
| `scripts/prepare-release.mjs` | writes file | `file:dist/config.json` | Confirmed | `scripts/prepare-release.mjs:39` |
| `scripts/prepare-release.mjs` | reads file | `file:dist/index.html` | Confirmed | `scripts/prepare-release.mjs:41` |
| `scripts/prepare-release.mjs` | writes file | `file:dist/release.json` | Confirmed | `scripts/prepare-release.mjs:42` |
| `scripts/reconcile-generation.mjs` | imports | `package:node:fs` | Confirmed | `scripts/reconcile-generation.mjs:1` |
| `scripts/reconcile-generation.mjs` | imports | `package:node:path` | Confirmed | `scripts/reconcile-generation.mjs:2` |
| `scripts/reconcile-generation.mjs` | imports | `package:node:url` | Confirmed | `scripts/reconcile-generation.mjs:3` |
| `scripts/reconcile-generation.mjs` | imports | `server/store.mjs` | Confirmed | `scripts/reconcile-generation.mjs:4` |
| `scripts/reconcile-generation.mjs` | imports | `server/operator.mjs` | Confirmed | `scripts/reconcile-generation.mjs:5` |
| `scripts/smoke-browser.mjs` | imports | `package:node:child_process` | Confirmed | `scripts/smoke-browser.mjs:1` |
| `scripts/smoke-browser.mjs` | imports | `package:node:crypto` | Confirmed | `scripts/smoke-browser.mjs:2` |
| `scripts/smoke-browser.mjs` | imports | `package:node:os` | Confirmed | `scripts/smoke-browser.mjs:3` |
| `scripts/smoke-browser.mjs` | imports | `package:node:path` | Confirmed | `scripts/smoke-browser.mjs:4` |
| `scripts/smoke-browser.mjs` | imports | `package:node:url` | Confirmed | `scripts/smoke-browser.mjs:5` |
| `scripts/smoke-browser.mjs` | imports | `package:@aws-sdk` | Confirmed | `scripts/smoke-browser.mjs:6` |
| `scripts/smoke-browser.mjs` | imports | `scripts/smoke-cloud.mjs` | Confirmed | `scripts/smoke-browser.mjs:14` |
| `scripts/smoke-browser.mjs` | calls API | `endpoint:${siteUrl}/config.json` | Confirmed | `scripts/smoke-browser.mjs:653` |
| `scripts/smoke-browser.mjs` | calls API | `endpoint:https://cognito-idp.${REGION}.amazonaws.com/` | Confirmed | `scripts/smoke-browser.mjs:727` |
| `scripts/smoke-cloud.mjs` | imports | `package:node:child_process` | Confirmed | `scripts/smoke-cloud.mjs:1` |
| `scripts/smoke-cloud.mjs` | imports | `package:node:crypto` | Confirmed | `scripts/smoke-cloud.mjs:2` |
| `scripts/smoke-cloud.mjs` | imports | `package:node:path` | Confirmed | `scripts/smoke-cloud.mjs:3` |
| `scripts/smoke-cloud.mjs` | imports | `package:node:url` | Confirmed | `scripts/smoke-cloud.mjs:4` |
| `scripts/smoke-cloud.mjs` | imports | `package:@aws-sdk` | Confirmed | `scripts/smoke-cloud.mjs:5` |
| `scripts/smoke-cloud.mjs` | calls API | `endpoint:https://cognito-idp.${REGION}.amazonaws.com/` | Confirmed | `scripts/smoke-cloud.mjs:188` |
| `scripts/smoke-cloud.mjs` | uses external service | `external:app.proairesis.digital` | Confirmed | `scripts/smoke-cloud.mjs:150` |
| `scripts/smoke-signup.mjs` | imports | `package:node:crypto` | Confirmed | `scripts/smoke-signup.mjs:1` |
| `scripts/smoke-signup.mjs` | imports | `package:node:child_process` | Confirmed | `scripts/smoke-signup.mjs:2` |
| `scripts/smoke-signup.mjs` | imports | `package:node:readline` | Confirmed | `scripts/smoke-signup.mjs:3` |
| `scripts/smoke-signup.mjs` | imports | `package:@aws-sdk` | Confirmed | `scripts/smoke-signup.mjs:4` |
| `scripts/validate-stripe-sandbox.mjs` | imports | `package:node:assert` | Confirmed | `scripts/validate-stripe-sandbox.mjs:1` |
| `scripts/validate-stripe-sandbox.mjs` | imports | `package:node:child_process` | Confirmed | `scripts/validate-stripe-sandbox.mjs:2` |
| `scripts/validate-stripe-sandbox.mjs` | imports | `package:node:util` | Confirmed | `scripts/validate-stripe-sandbox.mjs:3` |
| `scripts/validate-stripe-sandbox.mjs` | imports | `package:node:url` | Confirmed | `scripts/validate-stripe-sandbox.mjs:4` |
| `scripts/validate-stripe-sandbox.mjs` | imports | `package:stripe` | Confirmed | `scripts/validate-stripe-sandbox.mjs:5` |
| `scripts/validate-stripe-sandbox.mjs` | imports | `package:@aws-sdk` | Confirmed | `scripts/validate-stripe-sandbox.mjs:6` |
| `scripts/validate-stripe-sandbox.mjs` | imports | `server/adapters.mjs` | Confirmed | `scripts/validate-stripe-sandbox.mjs:7` |
| `scripts/validate-stripe-sandbox.mjs` | imports | `server/store.mjs` | Confirmed | `scripts/validate-stripe-sandbox.mjs:8` |
| `scripts/validate-stripe-sandbox.mjs` | imports | `server/service.mjs` | Confirmed | `scripts/validate-stripe-sandbox.mjs:9` |
| `scripts/validate-stripe-sandbox.mjs` | uses external service | `external:app.proairesis.digital` | Confirmed | `scripts/validate-stripe-sandbox.mjs:70` |
| `server/adapters.mjs` | imports | `package:node:crypto` | Confirmed | `server/adapters.mjs:1` |
| `server/adapters.mjs` | imports | `server/store.mjs` | Confirmed | `server/adapters.mjs:2` |
| `server/adapters.mjs` | imports | `server/service.mjs` | Confirmed | `server/adapters.mjs:3` |
| `server/adapters.mjs` | imports | `server/matching.mjs` | Confirmed | `server/adapters.mjs:4` |
| `server/adapters.mjs` | imports | `server/feed-sources.mjs` | Confirmed | `server/adapters.mjs:5` |
| `server/adapters.mjs` | imports | `server/ai-budget.mjs` | Confirmed | `server/adapters.mjs:6` |
| `server/adapters.mjs` | dynamic imports | `package:@aws-sdk` | Confirmed | `server/adapters.mjs:11` |
| `server/adapters.mjs` | dynamic imports | `package:@aws-sdk` | Confirmed | `server/adapters.mjs:156` |
| `server/adapters.mjs` | dynamic imports | `package:@aws-sdk` | Confirmed | `server/adapters.mjs:156` |
| `server/adapters.mjs` | dynamic imports | `package:stripe` | Confirmed | `server/adapters.mjs:172` |
| `server/adapters.mjs` | uses storage | `storage:S3-compatible object storage` | Strongly inferred | `server/adapters.mjs:1` |
| `server/adapters.mjs` | uses external service | `external:api.openai.com` | Confirmed | `server/adapters.mjs:73` |
| `server/ai-budget.mjs` | imports | `package:node:crypto` | Confirmed | `server/ai-budget.mjs:1` |
| `server/ai-budget.mjs` | imports | `server/store.mjs` | Confirmed | `server/ai-budget.mjs:2` |
| `server/feed-sources.mjs` | imports | `package:node:crypto` | Confirmed | `server/feed-sources.mjs:1` |
| `server/feed-sources.mjs` | imports | `server/matching.mjs` | Confirmed | `server/feed-sources.mjs:2` |
| `server/feed-sources.mjs` | uses external service | `external:boards-api.greenhouse.io` | Confirmed | `server/feed-sources.mjs:287` |
| `server/feed-sources.mjs` | uses external service | `external:api.ashbyhq.com` | Confirmed | `server/feed-sources.mjs:288` |
| `server/feed-sources.mjs` | uses external service | `external:api.lever.co` | Confirmed | `server/feed-sources.mjs:289` |
| `server/freehire.mjs` | imports | `package:node:crypto` | Confirmed | `server/freehire.mjs:1` |
| `server/freehire.mjs` | imports | `package:node:net` | Confirmed | `server/freehire.mjs:2` |
| `server/freehire.mjs` | imports | `server/imported-jobs.mjs` | Confirmed | `server/freehire.mjs:3` |
| `server/freehire.mjs` | imports | `server/matching.mjs` | Confirmed | `server/freehire.mjs:4` |
| `server/freehire.mjs` | uses external service | `external:freehire.me` | Confirmed | `server/freehire.mjs:29` |
| `server/guest-onboarding.mjs` | imports | `package:node:crypto` | Confirmed | `server/guest-onboarding.mjs:1` |
| `server/handler.mjs` | imports | `package:node:crypto` | Confirmed | `server/handler.mjs:1` |
| `server/handler.mjs` | imports | `server/store.mjs` | Confirmed | `server/handler.mjs:2` |
| `server/handler.mjs` | imports | `server/service.mjs` | Confirmed | `server/handler.mjs:3` |
| `server/handler.mjs` | imports | `server/resume.mjs` | Confirmed | `server/handler.mjs:4` |
| `server/handler.mjs` | imports | `server/adapters.mjs` | Confirmed | `server/handler.mjs:5` |
| `server/handler.mjs` | imports | `server/freehire.mjs` | Confirmed | `server/handler.mjs:6` |
| `server/handler.mjs` | dynamic imports | `package:@aws-sdk` | Confirmed | `server/handler.mjs:81` |
| `server/handler.mjs` | dynamic imports | `package:@aws-sdk` | Confirmed | `server/handler.mjs:82` |
| `server/imported-jobs.mjs` | imports | `package:node:crypto` | Confirmed | `server/imported-jobs.mjs:1` |
| `server/imported-jobs.mjs` | imports | `package:node:net` | Confirmed | `server/imported-jobs.mjs:2` |
| `server/imported-jobs.mjs` | imports | `server/matching.mjs` | Confirmed | `server/imported-jobs.mjs:3` |
| `server/local.mjs` | imports | `package:node:http` | Confirmed | `server/local.mjs:1` |
| `server/local.mjs` | imports | `server/store.mjs` | Confirmed | `server/local.mjs:2` |
| `server/local.mjs` | imports | `server/service.mjs` | Confirmed | `server/local.mjs:3` |
| `server/local.mjs` | imports | `server/handler.mjs` | Confirmed | `server/local.mjs:4` |
| `server/local.mjs` | imports | `server/matching.mjs` | Confirmed | `server/local.mjs:5` |
| `server/local.mjs` | uses external service | `external:proairesis.digital` | Confirmed | `server/local.mjs:20` |
| `server/operator.mjs` | imports | `package:node:crypto` | Confirmed | `server/operator.mjs:1` |
| `server/operator.mjs` | imports | `server/store.mjs` | Confirmed | `server/operator.mjs:2` |
| `server/profile-extraction.mjs` | imports | `server/matching.mjs` | Confirmed | `server/profile-extraction.mjs:1` |
| `server/resume.mjs` | imports | `server/matching.mjs` | Confirmed | `server/resume.mjs:1` |
| `server/resume.mjs` | imports | `package:node:zlib` | Confirmed | `server/resume.mjs:2` |
| `server/resume.mjs` | dynamic imports | `package:unpdf` | Confirmed | `server/resume.mjs:112` |
| `server/resume.mjs` | dynamic imports | `package:mammoth` | Confirmed | `server/resume.mjs:112` |
| `server/service.mjs` | imports | `package:node:crypto` | Confirmed | `server/service.mjs:1` |
| `server/service.mjs` | imports | `server/store.mjs` | Confirmed | `server/service.mjs:2` |
| `server/service.mjs` | imports | `server/matching.mjs` | Confirmed | `server/service.mjs:3` |
| `server/service.mjs` | imports | `server/imported-jobs.mjs` | Confirmed | `server/service.mjs:4` |
| `server/service.mjs` | imports | `server/resume.mjs` | Confirmed | `server/service.mjs:5` |
| `server/service.mjs` | imports | `server/profile-extraction.mjs` | Confirmed | `server/service.mjs:6` |
| `server/service.mjs` | imports | `server/guest-onboarding.mjs` | Confirmed | `server/service.mjs:7` |
| `server/store.mjs` | dynamic imports | `package:@aws-sdk` | Confirmed | `server/store.mjs:23` |
| `server/store.mjs` | dynamic imports | `package:@aws-sdk` | Confirmed | `server/store.mjs:24` |
| `src/App.jsx` | imports | `package:lucide-react` | Confirmed | `src/App.jsx:2` |
| `src/App.jsx` | imports | `src/auth.js` | Confirmed | `src/App.jsx:33` |
| `src/App.jsx` | imports | `src/api.js` | Confirmed | `src/App.jsx:48` |
| `src/App.jsx` | imports | `src/availability.js` | Confirmed | `src/App.jsx:59` |
| `src/App.jsx` | imports | `src/ui-state.js` | Confirmed | `src/App.jsx:60` |
| `src/App.jsx` | imports | `src/billing-state.js` | Confirmed | `src/App.jsx:68` |
| `src/App.jsx` | imports | `src/GuestJourney.jsx` | Confirmed | `src/App.jsx:75` |
| `src/App.jsx` | imports | `src/guest-state.js` | Confirmed | `src/App.jsx:76` |
| `src/App.jsx` | imports | `src/CareerInterview.jsx` | Confirmed | `src/App.jsx` |
| `src/App.jsx` | imports | `src/intake.js` | Confirmed | `src/App.jsx` |
| `src/App.jsx` | renders | `src/GuestJourney.jsx` | Confirmed | `src/App.jsx:75` |
| `src/App.jsx` | renders | `src/CareerInterview.jsx` | Confirmed | `src/App.jsx` |
| `src/App.jsx` | uses external service | `external:proairesis.digital` | Confirmed | `src/App.jsx:1391` |
| `src/GuestJourney.jsx` | imports | `package:lucide-react` | Confirmed | `src/GuestJourney.jsx:2` |
| `src/GuestJourney.jsx` | imports | `src/api.js` | Confirmed | `src/GuestJourney.jsx:20` |
| `src/GuestJourney.jsx` | imports | `src/guest-state.js` | Confirmed | `src/GuestJourney.jsx:21` |
| `src/GuestJourney.jsx` | imports | `src/CareerInterview.jsx` | Confirmed | `src/GuestJourney.jsx` |
| `src/GuestJourney.jsx` | imports | `src/intake.js` | Confirmed | `src/GuestJourney.jsx` |
| `src/CareerInterview.jsx` | imports | `src/intake.js` | Confirmed | `src/CareerInterview.jsx` |
| `src/api.js` | imports | `src/auth.js` | Confirmed | `src/api.js:1` |
| `src/api.js` | calls API | `endpoint:/config.json` | Confirmed | `src/api.js:204` |
| `src/auth.js` | calls API | `endpoint:https://cognito-idp.${config.cognitoRegion}.amazonaws.com/` | Confirmed | `src/auth.js:50` |
| `src/auth.js` | calls API | `endpoint:${oauthDomain(config)}/oauth2/token` | Confirmed | `src/auth.js:208` |
| `src/main.jsx` | imports | `package:react` | Confirmed | `src/main.jsx:1` |
| `src/main.jsx` | imports | `package:react-dom` | Confirmed | `src/main.jsx:2` |
| `src/main.jsx` | imports | `src/App.jsx` | Confirmed | `src/main.jsx:3` |
| `src/main.jsx` | imports | `src/styles.css` | Confirmed | `src/main.jsx:4` |
| `src/main.jsx` | renders | `src/App.jsx` | Confirmed | `src/main.jsx:3` |
| `tests/ai-budget-cli.test.mjs` | imports | `package:node:test` | Confirmed | `tests/ai-budget-cli.test.mjs:1` |
| `tests/ai-budget-cli.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/ai-budget-cli.test.mjs:2` |
| `tests/ai-budget-cli.test.mjs` | imports | `scripts/ai-budget.mjs` | Confirmed | `tests/ai-budget-cli.test.mjs:3` |
| `tests/ai-budget-cli.test.mjs` | imports | `server/store.mjs` | Confirmed | `tests/ai-budget-cli.test.mjs:4` |
| `tests/ai-budget-cli.test.mjs` | imports | `server/ai-budget.mjs` | Confirmed | `tests/ai-budget-cli.test.mjs:5` |
| `tests/ai-budget.test.mjs` | imports | `package:node:test` | Confirmed | `tests/ai-budget.test.mjs:1` |
| `tests/ai-budget.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/ai-budget.test.mjs:2` |
| `tests/ai-budget.test.mjs` | imports | `server/store.mjs` | Confirmed | `tests/ai-budget.test.mjs:3` |
| `tests/ai-budget.test.mjs` | imports | `server/ai-budget.mjs` | Confirmed | `tests/ai-budget.test.mjs:4` |
| `tests/ai-budget.test.mjs` | imports | `server/adapters.mjs` | Confirmed | `tests/ai-budget.test.mjs:5` |
| `tests/billing-lifecycle.test.mjs` | imports | `package:node:test` | Confirmed | `tests/billing-lifecycle.test.mjs:1` |
| `tests/billing-lifecycle.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/billing-lifecycle.test.mjs:2` |
| `tests/billing-lifecycle.test.mjs` | imports | `server/adapters.mjs` | Confirmed | `tests/billing-lifecycle.test.mjs:3` |
| `tests/billing-lifecycle.test.mjs` | imports | `server/service.mjs` | Confirmed | `tests/billing-lifecycle.test.mjs:4` |
| `tests/billing-lifecycle.test.mjs` | imports | `server/handler.mjs` | Confirmed | `tests/billing-lifecycle.test.mjs:5` |
| `tests/billing-lifecycle.test.mjs` | imports | `server/store.mjs` | Confirmed | `tests/billing-lifecycle.test.mjs:6` |
| `tests/core.test.mjs` | imports | `package:node:test` | Confirmed | `tests/core.test.mjs:1` |
| `tests/core.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/core.test.mjs:2` |
| `tests/core.test.mjs` | imports | `package:node:crypto` | Confirmed | `tests/core.test.mjs:3` |
| `tests/core.test.mjs` | imports | `server/store.mjs` | Confirmed | `tests/core.test.mjs:4` |
| `tests/core.test.mjs` | imports | `server/service.mjs` | Confirmed | `tests/core.test.mjs:5` |
| `tests/core.test.mjs` | imports | `server/handler.mjs` | Confirmed | `tests/core.test.mjs:6` |
| `tests/core.test.mjs` | imports | `server/matching.mjs` | Confirmed | `tests/core.test.mjs:7` |
| `tests/core.test.mjs` | imports | `server/adapters.mjs` | Confirmed | `tests/core.test.mjs:8` |
| `tests/core.test.mjs` | imports | `server/resume.mjs` | Confirmed | `tests/core.test.mjs:9` |
| `tests/error-logging.test.mjs` | imports | `package:node:test` | Confirmed | `tests/error-logging.test.mjs:1` |
| `tests/error-logging.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/error-logging.test.mjs:2` |
| `tests/error-logging.test.mjs` | imports | `server/handler.mjs` | Confirmed | `tests/error-logging.test.mjs:3` |
| `tests/extraction-billing.test.mjs` | imports | `package:node:test` | Confirmed | `tests/extraction-billing.test.mjs:1` |
| `tests/extraction-billing.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/extraction-billing.test.mjs:2` |
| `tests/extraction-billing.test.mjs` | imports | `server/resume.mjs` | Confirmed | `tests/extraction-billing.test.mjs:3` |
| `tests/extraction-billing.test.mjs` | imports | `server/adapters.mjs` | Confirmed | `tests/extraction-billing.test.mjs:4` |
| `tests/extraction-billing.test.mjs` | imports | `server/store.mjs` | Confirmed | `tests/extraction-billing.test.mjs:5` |
| `tests/extraction-billing.test.mjs` | imports | `server/service.mjs` | Confirmed | `tests/extraction-billing.test.mjs:6` |
| `tests/extraction-billing.test.mjs` | dynamic imports | `package:@aws-sdk` | Confirmed | `tests/extraction-billing.test.mjs:14` |
| `tests/extraction-billing.test.mjs` | uses storage | `storage:S3-compatible object storage` | Strongly inferred | `tests/extraction-billing.test.mjs:1` |
| `tests/feed-sources.test.mjs` | imports | `package:node:test` | Confirmed | `tests/feed-sources.test.mjs:1` |
| `tests/feed-sources.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/feed-sources.test.mjs:2` |
| `tests/feed-sources.test.mjs` | imports | `server/feed-sources.mjs` | Confirmed | `tests/feed-sources.test.mjs:3` |
| `tests/freehire.test.mjs` | imports | `package:node:test` | Confirmed | `tests/freehire.test.mjs:1` |
| `tests/freehire.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/freehire.test.mjs:2` |
| `tests/freehire.test.mjs` | imports | `server/freehire.mjs` | Confirmed | `tests/freehire.test.mjs:3` |
| `tests/frontend-billing.test.mjs` | imports | `package:node:test` | Confirmed | `tests/frontend-billing.test.mjs:1` |
| `tests/frontend-billing.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/frontend-billing.test.mjs:2` |
| `tests/frontend-billing.test.mjs` | imports | `package:node:module` | Confirmed | `tests/frontend-billing.test.mjs:3` |
| `tests/frontend-billing.test.mjs` | imports | `package:node:url` | Confirmed | `tests/frontend-billing.test.mjs:4` |
| `tests/frontend-billing.test.mjs` | imports | `package:esbuild` | Confirmed | `tests/frontend-billing.test.mjs:5` |
| `tests/frontend-billing.test.mjs` | imports | `package:react` | Confirmed | `tests/frontend-billing.test.mjs:6` |
| `tests/frontend-billing.test.mjs` | imports | `package:react-dom` | Confirmed | `tests/frontend-billing.test.mjs:7` |
| `tests/frontend-billing.test.mjs` | imports | `src/api.js` | Confirmed | `tests/frontend-billing.test.mjs:8` |
| `tests/frontend-billing.test.mjs` | imports | `src/auth.js` | Confirmed | `tests/frontend-billing.test.mjs:9` |
| `tests/frontend-billing.test.mjs` | imports | `src/billing-state.js` | Confirmed | `tests/frontend-billing.test.mjs:10` |
| `tests/frontend-decisions.test.mjs` | imports | `package:node:test` | Confirmed | `tests/frontend-decisions.test.mjs:1` |
| `tests/frontend-decisions.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/frontend-decisions.test.mjs:2` |
| `tests/frontend-decisions.test.mjs` | imports | `src/api.js` | Confirmed | `tests/frontend-decisions.test.mjs:3` |
| `tests/frontend-decisions.test.mjs` | imports | `src/auth.js` | Confirmed | `tests/frontend-decisions.test.mjs:4` |
| `tests/frontend-onboarding.test.mjs` | imports | `package:node:test` | Confirmed | `tests/frontend-onboarding.test.mjs:1` |
| `tests/frontend-onboarding.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/frontend-onboarding.test.mjs:2` |
| `tests/frontend-onboarding.test.mjs` | imports | `src/guest-state.js` | Confirmed | `tests/frontend-onboarding.test.mjs:3` |
| `tests/frontend-pagination.test.mjs` | imports | `package:node:test` | Confirmed | `tests/frontend-pagination.test.mjs:1` |
| `tests/frontend-pagination.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/frontend-pagination.test.mjs:2` |
| `tests/frontend-pagination.test.mjs` | imports | `src/api.js` | Confirmed | `tests/frontend-pagination.test.mjs:3` |
| `tests/frontend-pagination.test.mjs` | imports | `src/auth.js` | Confirmed | `tests/frontend-pagination.test.mjs:4` |
| `tests/frontend-pagination.test.mjs` | imports | `server/store.mjs` | Confirmed | `tests/frontend-pagination.test.mjs:5` |
| `tests/frontend-pagination.test.mjs` | imports | `server/service.mjs` | Confirmed | `tests/frontend-pagination.test.mjs:6` |
| `tests/frontend-state.test.mjs` | imports | `package:node:test` | Confirmed | `tests/frontend-state.test.mjs:1` |
| `tests/frontend-state.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/frontend-state.test.mjs:2` |
| `tests/frontend-state.test.mjs` | imports | `src/ui-state.js` | Confirmed | `tests/frontend-state.test.mjs:3` |
| `tests/frontend-state.test.mjs` | imports | `src/auth.js` | Confirmed | `tests/frontend-state.test.mjs:11` |
| `tests/guest-onboarding.test.mjs` | imports | `package:node:test` | Confirmed | `tests/guest-onboarding.test.mjs:1` |
| `tests/guest-onboarding.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/guest-onboarding.test.mjs:2` |
| `tests/guest-onboarding.test.mjs` | imports | `package:node:crypto` | Confirmed | `tests/guest-onboarding.test.mjs:3` |
| `tests/guest-onboarding.test.mjs` | imports | `server/store.mjs` | Confirmed | `tests/guest-onboarding.test.mjs:4` |
| `tests/guest-onboarding.test.mjs` | imports | `server/service.mjs` | Confirmed | `tests/guest-onboarding.test.mjs:5` |
| `tests/guest-onboarding.test.mjs` | imports | `server/handler.mjs` | Confirmed | `tests/guest-onboarding.test.mjs:6` |
| `tests/guest-onboarding.test.mjs` | imports | `server/matching.mjs` | Confirmed | `tests/guest-onboarding.test.mjs:7` |
| `tests/guest-onboarding.test.mjs` | imports | `server/profile-extraction.mjs` | Confirmed | `tests/guest-onboarding.test.mjs:8` |
| `tests/import-service.test.mjs` | imports | `package:node:test` | Confirmed | `tests/import-service.test.mjs:1` |
| `tests/import-service.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/import-service.test.mjs:2` |
| `tests/import-service.test.mjs` | imports | `package:node:crypto` | Confirmed | `tests/import-service.test.mjs:3` |
| `tests/import-service.test.mjs` | imports | `server/store.mjs` | Confirmed | `tests/import-service.test.mjs:4` |
| `tests/import-service.test.mjs` | imports | `server/service.mjs` | Confirmed | `tests/import-service.test.mjs:5` |
| `tests/imported-jobs.test.mjs` | imports | `package:node:test` | Confirmed | `tests/imported-jobs.test.mjs:1` |
| `tests/imported-jobs.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/imported-jobs.test.mjs:2` |
| `tests/imported-jobs.test.mjs` | imports | `server/imported-jobs.mjs` | Confirmed | `tests/imported-jobs.test.mjs:3` |
| `tests/infra.test.mjs` | imports | `package:node:test` | Confirmed | `tests/infra.test.mjs:1` |
| `tests/infra.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/infra.test.mjs:2` |
| `tests/infra.test.mjs` | imports | `infra/template.mjs` | Confirmed | `tests/infra.test.mjs:3` |
| `tests/matching-reasons.test.mjs` | imports | `package:node:test` | Confirmed | `tests/matching-reasons.test.mjs:1` |
| `tests/matching-reasons.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/matching-reasons.test.mjs:2` |
| `tests/matching-reasons.test.mjs` | imports | `server/matching.mjs` | Confirmed | `tests/matching-reasons.test.mjs:3` |
| `tests/matching-reasons.test.mjs` | imports | `server/imported-jobs.mjs` | Confirmed | `tests/matching-reasons.test.mjs:4` |
| `tests/matching-reasons.test.mjs` | imports | `server/store.mjs` | Confirmed | `tests/matching-reasons.test.mjs:5` |
| `tests/matching-reasons.test.mjs` | imports | `server/service.mjs` | Confirmed | `tests/matching-reasons.test.mjs:6` |
| `tests/operator.test.mjs` | imports | `package:node:test` | Confirmed | `tests/operator.test.mjs:1` |
| `tests/operator.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/operator.test.mjs:2` |
| `tests/operator.test.mjs` | imports | `server/store.mjs` | Confirmed | `tests/operator.test.mjs:3` |
| `tests/operator.test.mjs` | imports | `server/service.mjs` | Confirmed | `tests/operator.test.mjs:4` |
| `tests/operator.test.mjs` | imports | `server/operator.mjs` | Confirmed | `tests/operator.test.mjs:5` |
| `tests/operator.test.mjs` | imports | `scripts/reconcile-generation.mjs` | Confirmed | `tests/operator.test.mjs:6` |
| `tests/pagination.test.mjs` | imports | `package:node:test` | Confirmed | `tests/pagination.test.mjs:1` |
| `tests/pagination.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/pagination.test.mjs:2` |
| `tests/pagination.test.mjs` | imports | `server/store.mjs` | Confirmed | `tests/pagination.test.mjs:3` |
| `tests/pagination.test.mjs` | imports | `server/service.mjs` | Confirmed | `tests/pagination.test.mjs:4` |
| `tests/pagination.test.mjs` | imports | `server/handler.mjs` | Confirmed | `tests/pagination.test.mjs:5` |
| `tests/pagination.test.mjs` | imports | `server/imported-jobs.mjs` | Confirmed | `tests/pagination.test.mjs:6` |
| `tests/release-billing-copy.test.mjs` | imports | `package:node:test` | Confirmed | `tests/release-billing-copy.test.mjs:1` |
| `tests/release-billing-copy.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/release-billing-copy.test.mjs:2` |
| `tests/release-billing-copy.test.mjs` | imports | `package:node:fs` | Confirmed | `tests/release-billing-copy.test.mjs:3` |
| `tests/release-billing-copy.test.mjs` | imports | `scripts/prepare-release.mjs` | Confirmed | `tests/release-billing-copy.test.mjs:4` |
| `tests/resume-security.test.mjs` | imports | `package:node:test` | Confirmed | `tests/resume-security.test.mjs:1` |
| `tests/resume-security.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/resume-security.test.mjs:2` |
| `tests/resume-security.test.mjs` | imports | `package:node:zlib` | Confirmed | `tests/resume-security.test.mjs:3` |
| `tests/resume-security.test.mjs` | imports | `server/resume.mjs` | Confirmed | `tests/resume-security.test.mjs:4` |
| `tests/storage-limits.test.mjs` | imports | `package:node:test` | Confirmed | `tests/storage-limits.test.mjs:1` |
| `tests/storage-limits.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/storage-limits.test.mjs:2` |
| `tests/storage-limits.test.mjs` | imports | `package:node:crypto` | Confirmed | `tests/storage-limits.test.mjs:3` |
| `tests/storage-limits.test.mjs` | imports | `server/store.mjs` | Confirmed | `tests/storage-limits.test.mjs:4` |
| `tests/storage-limits.test.mjs` | imports | `server/service.mjs` | Confirmed | `tests/storage-limits.test.mjs:5` |
| `tests/storage-limits.test.mjs` | imports | `server/handler.mjs` | Confirmed | `tests/storage-limits.test.mjs:6` |
| `tests/storage-limits.test.mjs` | imports | `server/matching.mjs` | Confirmed | `tests/storage-limits.test.mjs:7` |
| `tests/stripe-sandbox-cli.test.mjs` | imports | `package:node:test` | Confirmed | `tests/stripe-sandbox-cli.test.mjs:1` |
| `tests/stripe-sandbox-cli.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/stripe-sandbox-cli.test.mjs:2` |
| `tests/stripe-sandbox-cli.test.mjs` | imports | `scripts/validate-stripe-sandbox.mjs` | Confirmed | `tests/stripe-sandbox-cli.test.mjs:3` |
| `tests/upload-availability.test.mjs` | imports | `package:node:test` | Confirmed | `tests/upload-availability.test.mjs:1` |
| `tests/upload-availability.test.mjs` | imports | `package:node:assert` | Confirmed | `tests/upload-availability.test.mjs:2` |
| `tests/upload-availability.test.mjs` | imports | `package:node:crypto` | Confirmed | `tests/upload-availability.test.mjs:3` |
| `tests/upload-availability.test.mjs` | imports | `server/store.mjs` | Confirmed | `tests/upload-availability.test.mjs:4` |
| `tests/upload-availability.test.mjs` | imports | `server/service.mjs` | Confirmed | `tests/upload-availability.test.mjs:5` |
| `tests/upload-availability.test.mjs` | imports | `server/resume.mjs` | Confirmed | `tests/upload-availability.test.mjs:6` |
| `tests/upload-availability.test.mjs` | imports | `server/matching.mjs` | Confirmed | `tests/upload-availability.test.mjs:7` |
| `vite.config.mjs` | imports | `package:vite` | Confirmed | `vite.config.mjs:1` |
| `vite.config.mjs` | imports | `package:@vitejs` | Confirmed | `vite.config.mjs:2` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:22` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:26` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:27` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:28` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:28` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:29` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:30` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:31` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:42` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:43` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:44` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:45` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:46` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:47` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:48` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:49` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:50` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:51` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:52` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:53` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:54` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:55` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:56` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:57` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:58` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:59` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:60` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:61` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:62` |
| `server/handler.mjs` | dispatches route | `server/service.mjs` | Confirmed | `server/handler.mjs:63` |
| `src/GuestJourney.jsx` | calls API | `endpoint:/api/guest/start` | Confirmed | `src/GuestJourney.jsx:562` |
| `src/GuestJourney.jsx` | calls API | `endpoint:/api/guest/resume` | Confirmed | `src/GuestJourney.jsx:583` |
| `src/GuestJourney.jsx` | calls API | `endpoint:/api/guest/profile` | Confirmed | `src/GuestJourney.jsx:598` |
| `src/GuestJourney.jsx` | calls API | `endpoint:/api/guest/search` | Confirmed | `src/GuestJourney.jsx:603` |
| `src/GuestJourney.jsx` | calls API | `endpoint:/api/guest/ignore` | Confirmed | `src/GuestJourney.jsx:619` |
| `src/App.jsx` | calls API | `endpoint:/api/me` | Confirmed | `src/App.jsx:373` |
| `src/App.jsx` | calls API | `endpoint:/api/guest/claim` | Confirmed | `src/App.jsx:495` |
| `src/App.jsx` | calls API | `endpoint:/api/continuation/complete` | Confirmed | `src/App.jsx:385` |
| `src/App.jsx` | calls API | `endpoint:/api/profile` | Confirmed | `src/App.jsx:1814` |
| `src/App.jsx` | calls API | `endpoint:/api/opportunities` | Confirmed | `src/App.jsx:2394` |
| `src/App.jsx` | calls API | `endpoint:/api/opportunities/{id}/decision` | Confirmed | `src/App.jsx:2418` |
| `src/App.jsx` | calls API | `endpoint:/api/opportunities/import` | Confirmed | `src/App.jsx:2765` |
| `src/App.jsx` | calls API | `endpoint:/api/applications` | Confirmed | `src/App.jsx:3195` |
| `src/App.jsx` | calls API | `endpoint:/api/applications/{id}/letters` | Confirmed | `src/App.jsx:3484` |
| `src/App.jsx` | calls API | `endpoint:/api/generations/{id}` | Confirmed | `src/App.jsx:3405` |
| `src/App.jsx` | calls API | `endpoint:/api/applications/{id}` | Confirmed | `src/App.jsx:3522` |
| `src/App.jsx` | calls API | `endpoint:/api/applications/{id}/letters/{letterId}` | Confirmed | `src/App.jsx:3538` |
| `src/App.jsx` | calls API | `endpoint:/api/billing/checkout` | Confirmed | `src/App.jsx:1201` |
| `src/App.jsx` | calls API | `endpoint:/api/billing/portal` | Confirmed | `src/App.jsx:3901` |
| `src/App.jsx` | calls API | `endpoint:/api/billing/refresh` | Confirmed | `src/App.jsx:4121` |
| `src/App.jsx` | calls API | `endpoint:/api/export` | Confirmed | `src/App.jsx:4146` |
| `src/App.jsx` | calls API | `endpoint:/api/account` | Confirmed | `src/App.jsx:4164` |
| `infra/template.mjs` | configures | `service:Amazon CloudFront` | Confirmed | `infra/template.mjs:173-191` |
| `infra/template.mjs` | configures | `storage:private S3 site bucket` | Confirmed | `infra/template.mjs:78-84` |
| `infra/template.mjs` | configures | `service:API Gateway HTTP API` | Confirmed | `infra/template.mjs:158-170` |
| `infra/template.mjs` | configures | `service:Amazon Cognito` | Confirmed | `infra/template.mjs:92-125` |
| `infra/template.mjs` | configures | `database:Amazon DynamoDB` | Confirmed | `infra/template.mjs:85-91` |
| `infra/template.mjs` | configures | `queue:Amazon SQS failure destination` | Confirmed | `infra/template.mjs:126-157` |
| `infra/template.mjs` | configures | `service:EventBridge Scheduler` | Confirmed | `infra/template.mjs:171-172` |
| `server/adapters.mjs` | uses storage | `storage:private S3 resume bucket` | Confirmed | `server/adapters.mjs:155-167` |
| `server/adapters.mjs` | reads secret parameter | `service:AWS SSM Parameter Store` | Confirmed | `server/adapters.mjs:10-11` |
| `server/store.mjs` | queries | `database:Amazon DynamoDB` | Confirmed | `server/store.mjs:20-50` |
| `server/adapters.mjs` | calls API | `external:OpenAI Responses API` | Confirmed | `server/adapters.mjs:13-105` |
| `server/adapters.mjs` | calls API | `external:Stripe` | Confirmed | `server/adapters.mjs:170-342` |
| `server/freehire.mjs` | calls API | `external:Freehire authorised ATS search` | Confirmed | `server/freehire.mjs:107-146` |
| `server/ai-budget.mjs` | queries | `database:SYSTEM#EXTERNAL_AI` | Confirmed | `server/ai-budget.mjs:82-367` |
