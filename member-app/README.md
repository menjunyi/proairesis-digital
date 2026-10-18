# RoleClue member app

RoleClue helps Australian technology job seekers review their resume, confirm work constraints, find high-fit roles, track applications, and create evidence-based cover letters.

## Production scope

- Cognito provides verified user accounts.
- DynamoDB stores each account under `USER#<Cognito sub>`.
- Private S3 storage holds original resumes for no more than seven days.
- Freehire supplies current Australian employer-ATS listings through its public API.
- Stripe sells an A$1 Starter pack with two successful letters and an A$20 monthly plan with 50 successful letters.
- OpenAI creates cover-letter drafts. RoleClue applies a hard US$1 daily spend ceiling. A durable SQS queue prevents a lost Lambda response from losing paid work.
- CloudFront is the only public API entry point. It adds an origin secret before API Gateway sends a request to Lambda.

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
8. Run `npm run release:plan`.
9. Review `build/deployment-plan.json` and the AWS change set.
10. Run `npm run release:deploy -- CHANGE_SET_NAME`.
11. Run the cloud and browser acceptance checks. Save their output with `build/deployment-evidence.json`.

The GitHub workflow runs the repeatable tests, audit, builds, template generation, and release packaging. Production deployment stays on the reviewed local path above until a dedicated member-app OIDC role is provisioned. The existing website deployment role does not have RoleClue member-app permissions.

## Rollback

CloudFormation rolls back a failed stack update. Lambda versions and release artifacts remain available for an emergency rollback.

First run a dry check:

```sh
npm run release:rollback -- --to-release RELEASE_ID --to-version VERSION
```

After review, repeat the command with `--apply`. This changes the live alias and restores the archived site. It creates CloudFormation drift. Redeploy the prior release through a reviewed change set after service is stable.

## Operations

- Confirm the SNS email subscription after the first infrastructure update.
- Treat a dead-letter message or `GenerationReconciliationRequired` alarm as a paid-work incident.
- Do not retry an OpenAI request when its provider outcome is unknown. Reconcile it first.
- Review the external-AI price authority before its recorded expiry date.
- Keep Stripe webhook signing enabled. Browser redirects never grant access.
- Run a tenant-isolation smoke test after each production deployment.
