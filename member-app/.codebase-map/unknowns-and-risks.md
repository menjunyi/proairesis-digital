# Unknowns and risks

## Confirmed

- `member-app/` is untracked in the parent repository. The document records a working-tree snapshot, not a committed release.
- `src/App.jsx` has 4,399 lines and owns authentication, continuation, payment gating, navigation and most member UI.
- Manual Lambda route dispatch is easy for generic static analysis to miss. Keep the route matrix in sync with `server/handler.mjs:18-63`.
- Build and template preparation exist, but this directory declares no deployment or CI command.
- `contract.json` and the accepted work-rights values in `server/service.mjs:82` disagree.

## Runtime checks not performed

This documentation run did not contact Stripe, OpenAI, Freehire, Cognito, S3, DynamoDB or SSM. Source code proves the integration paths and gates, not current provider health.

## Privacy and exclusions

The scan excluded `.local/`, `.env*`, `build/`, `dist/`, `node_modules/`, videos, resumes, databases and binary files. The published HTML uses repository-relative source paths and contains no credential values or resume content.
