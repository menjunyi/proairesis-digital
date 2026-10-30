# Release funnel implementation plan

> Use executing-plans inline or subagent-driven-development for the tasks below. The design in ../specs/2026-10-30-release-funnel-design.md and Junyi's explicit implementation approval bind all work.

Goal: deliver a tracked RoleClue release link and truthful consented app funnel in existing private Company Superadmin.

1. Backend: focused `server/analytics.mjs`; HTTP/direct-IAM integration in handler, verified Stripe/generation hooks, explicit API routes/CORS and meaningful analytics tests. No new database/service. Commit and independent review.
2. Browser: `src/analytics.js` and consent component; integrate exact stage events/header context in App/intake/guest/auth/API; optional fail-open behavior and privacy text; meaningful client tests, lint/build and actual synthetic UI review. Commit and independent review.
3. Admin: stage only code files in isolated copy of Company Superadmin, never its operational state. Extend report types and optional funnel table, backend alias validation, share-path/destinations support. Preserve legacy marketing reports. Run lint/typecheck/tests/build and review. Copy changed code into the installed runtime only after review; preserve registry and databases.
4. Release: estimate incremental AWS cost for pilot usage, review full CloudFormation diff, publish app via PR/CI and exact-main versioned deployment, register separate member-app target, create release campaign through normal UI, perform marked live UI test and excluded report verification, record operation video and update canonical PRDs/evidence. No paid AI/provider/payment writes. Test cleanup never deletes unrelated records.

Progress: design recorded; implementation not yet started. Each task's report goes under member-app/.local/funnel-20261030/.
