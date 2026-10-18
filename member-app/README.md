# RoleClue member app

RoleClue helps Australian technology job seekers review their resume, confirm work constraints, find high-fit roles, track applications, and create evidence-based cover letters.

## Production scope

- Cognito provides verified user accounts.
- DynamoDB stores each account under `USER#<Cognito sub>`.
- Private S3 storage holds original resumes for no more than seven days.
- Freehire supplies current Australian employer-ATS listings through its public API.
- Stripe sells an A$1 Starter pack with two successful letters and an A$20 monthly plan with 50 successful letters.
- OpenAI creates cover-letter drafts. RoleClue applies a hard US$1 daily spend ceiling. Paid generation and daily recommendations use separate durable SQS queues, with dead-letter handling and operator alarms. A DynamoDB outbox and five-minute repair schedule recover pre-provider dispatches even after the user closes the browser. A bounded two-pass migration also enrolls pending generations created before the outbox release.
- CloudFront is the only public API entry point. Its API origin policy sets the viewer address from the trusted connection and overwrites any client copy. Its origin adds a private credential before API Gateway sends the request to Lambda. Guest rate limits use that address only after the origin check succeeds.

Read [contract.json](./contract.json) for the application contract and [.codebase-map/roleclue-technical-architecture.html](./.codebase-map/roleclue-technical-architecture.html) for the technical map.

## Local checks

Use Node.js 22 or later.

```sh
npm ci
npm run check
```

Run the local synthetic app only for development:

```sh
npm run dev:api
npm run dev
```

The local API uses synthetic data. Do not use it as production evidence.

## Production release

The release scripts refuse an unexpected AWS account. They target account `037169690315`, region `ap-southeast-2`, and stack `roleclue-member-app`.

1. Commit and push the complete member-app source.
2. Run `npm run check`.
3. Run `npm run release:secrets`. If it reports missing parameters, review the exact names, then run `npm run release:secrets -- --apply` once.
4. Run `npm run release:ai-policy`. If the dedicated US$1 daily policy is missing, verify the recorded approval and pinned price expiry, then run `npm run release:ai-policy -- --apply` once.
5. Get the public Cognito client ID from the stack output.
6. Set the five public `ROLECLUE_*` release variables. Enable recommendations, guest discovery, cover letters, and billing only when the corresponding production services are ready.
7. Run `npm run release:prepare`.
8. Before the first version-pinned release, run `npm run release:artifacts -- --plan`, review `build/artifact-versioning-plan.json` and the exact CloudFormation change set, then run `npm run release:artifacts -- --execute-existing CHANGE_SET_NAME`. Verify `build/artifact-versioning-evidence.json`. This guarded one-time update enables versioning on the retained `roleclue-member-artifacts` bucket; app releases refuse an unversioned artifact bucket.
9. Read the current stack parameter `ApiOriginGateEnabled`. If it is `false`, set `ROLECLUE_API_ORIGIN_GATE_ENABLED=false`, run `npm run release:plan`, review `build/deployment-plan.json` and the exact `gate-off` change set, then run `npm run release:deploy -- CHANGE_SET_NAME` with the same value. This one-time phase lets CloudFront deploy the private origin header before enforcement.
10. Set `ROLECLUE_API_ORIGIN_GATE_ENABLED=true`, run and review a new plan, then deploy its exact `gate-on` change set. If the current stack parameter is already `true`, skip the gate-off phase and keep it `true` for the single normal plan/deploy. The scripts refuse an implicit value, a protected `true` to `false` transition, mutable artifacts, and removal or replacement of retained user-data resources.
11. Run `ROLECLUE_RUN_CLOUD_SMOKE=1 ROLECLUE_TEST_SIGNED_UPLOAD=1 ROLECLUE_EXPECTED_SOURCE_REVISION=THE_40_CHARACTER_RELEASE_COMMIT npm run smoke:cloud`. If a newly created heartbeat alarm has no data, review the pinned release and rerun with `ROLECLUE_BOOTSTRAP_HEARTBEATS=1`; the script invokes only affected daily jobs on the protected live alias and waits for every alarm to become `OK`.
12. Run `ROLECLUE_RUN_LOAD_SMOKE=1 ROLECLUE_EXPECTED_SOURCE_REVISION=THE_40_CHARACTER_RELEASE_COMMIT npm run smoke:load`. The default plan sends a bounded mix of `GET /api/health`, authenticated `GET /api/me`, and authenticated `GET /api/applications` at 10 requests per second for five minutes. It passes only when p95 latency is below two seconds, combined errors plus HTTP 429 responses stay below 1%, and no production alarm enters `ALARM` through the next CloudWatch evaluation.
13. Use a fresh plus-address on the controlled QA mailbox, disable terminal echo, and run `ROLECLUE_RUN_EMAIL_SMOKE=1 ROLECLUE_TEST_PASSWORD_RECOVERY=1 ROLECLUE_TEST_EMAIL=THE_QA_ALIAS npm run smoke:signup`. Enter only the delivered six-digit confirmation and recovery codes through the script's PTY. Verify that it reports confirmation, recovery, private API access, and cleanup. Never save the codes in release evidence.
14. Set `ROLECLUE_BROWSER_TASKSPACE_ID` to the existing agent-owned browser space and optionally set `ROLECLUE_BROWSER_PAGE_LABEL` (default `p1`), then run `ROLECLUE_RUN_BROWSER_SMOKE=1 npm run smoke:browser`. Keep `build/deployment-evidence.json` together with the separate cloud, load, signup, and browser smoke evidence under `build/`.

If the stack update completes but the site sync, invalidation, or final health check is interrupted, rerun `npm run release:deploy -- CHANGE_SET_NAME` with the same reviewed plan and origin-gate value. The command accepts only that completed change set, re-verifies its pinned artifacts and deployed parameters, and resumes the post-deployment phase without executing the stack update again.

The GitHub workflow runs the repeatable tests, audit, builds, template generation, and release packaging. Production deployment stays on the reviewed local path above until a dedicated member-app OIDC role is provisioned. The existing website deployment role does not have RoleClue member-app permissions.

## Rollback

CloudFormation rolls back a failed stack update. Lambda versions and release artifacts remain available for an emergency rollback.

Only complete version-3 gate-on releases with pinned S3 versions and archive hashes are eligible. First run a dry check:

```sh
npm run release:rollback -- --to-release RELEASE_ID --to-version VERSION
```

After review, repeat the command with `--apply`. This changes the live alias and restores the archived site. It creates CloudFormation drift. Redeploy the prior release through a reviewed change set after service is stable.

## Operations

- Confirm the SNS email subscription after the first infrastructure update.
- Treat a dead-letter message or `GenerationReconciliationRequired` alarm as a paid-work incident.
- Treat `GenerationDispatchRepairFailed` as a paid-work delivery incident. Inspect the generation ID and hashed tenant reference in the structured log; never retry a provider-started request.
- Treat generation or recommendation queue age/backlog alarms as a service incident; paid generation has separate capacity from daily discovery.
- Do not retry an OpenAI request when its provider outcome is unknown. Reconcile it first.
- The one-time AI price-authority schedule sends the existing production SNS topic a direct notice before expiry. Review and renew the authority before its recorded expiry date.
- Keep Stripe webhook signing enabled. Browser redirects never grant access.
- Run a tenant-isolation smoke test after each production deployment.
- Run the delivered-email signup and password-recovery smoke after every Cognito email configuration change and before expanding registration.
