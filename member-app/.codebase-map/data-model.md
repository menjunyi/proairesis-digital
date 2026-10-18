# Storage and keyspace map

| Keyspace/store | Records | Purpose | Evidence |
|---|---|---|---|
| `USER#{sub}` | PROFILE, ENTITLEMENT, CONTINUATION, APP#, LETTER#, GEN#, DECISION#, IMPORTED_JOB#, upload, checkout and rate records | Member source of truth | `server/service.mjs:97-599` |
| `GUEST#{sha256(token)}` | SESSION, JOB# and rate records with TTL | 24-hour guest discovery state; raw token is not the partition key | `server/guest-onboarding.mjs:6-29; server/service.mjs:222-349` |
| `GUEST_RATE#{HMAC(IP)}` | Per-action rate counters | Network-level abuse control without storing a raw IP key | `server/service.mjs:200-220` |
| `FEED#catalog / FEED#snapshot#{id}` | STATUS, LOCK and JOB# records | Atomic daily feed snapshot switching | `server/adapters.mjs:109-150` |
| `BILLING#customers / BILLING#locks` | Stripe customer mapping and reconciliation locks | Tenant-safe Stripe reconciliation | `server/adapters.mjs:230-340` |
| `ACCOUNT#deleted` | Hashed user tombstones | Prevents deleted identities from being silently recreated | `server/service.mjs:97-102,573-599` |
| `SYSTEM#EXTERNAL_AI` | Policy, daily ledger and hashed reservations | Daily external-AI cost control and reconciliation | `server/ai-budget.mjs:82-367` |
| `Private S3 resume bucket` | pending/{user}/{uploadId}; validated originals | Five-minute direct uploads; validated originals expire after seven days | `server/adapters.mjs:155-167; infra/template.mjs:78-84` |
