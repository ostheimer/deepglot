# Workspace history release evidence

Scope: new direct workspace text edits only, attached to #257. No historic backfill, restore action, other-editor recording or production customer-content verification writes.

## Schema prerequisite

SQL: `scripts/sql/translation-history.sql`. The fresh production clone `br-red-mud-agl2usli` expires at 2026-09-30 00:00 UTC. Two consecutive applications preserved all 243,343 translation rows; six revision columns, two foreign keys plus primary key and three indexes matched the intended schema. Preview `main` (`br-empty-cherry-ag8su2hl`) was verified to match the Vercel Preview database host, and two applications preserved all 730 translation rows. Both environments had zero revisions. The full Prisma target-schema acceptance passed with no pending statements on clone and preview. JSON reports are included.

Production migration, exact-head independent review, CI, deployed Preview browser checks and Production read-only acceptance are release gates still pending at this initial checkpoint.

## Local verification

- Node 20 unit suite: 746 tests passed, including bounded UTF-8 history responses and all 24 frontend catalogues.
- PostgreSQL integration suite: 49 tests passed. The history test covers before/after chains, no-op/stale/denied attempts, rollback of translation and batch when a revision insert fails, concurrent CAS attempts, project/language scope, segment-scoped cursors, equal-timestamp ordering, actor deletion and segment deletion.
- Final production-build Playwright suite: 67 tests passed on the matching localhost origin. EN/DE history browser tests passed. They verify lazy loading, save/reload persistence, plain-text rendering, no-store, anonymous access and query validation. The API test exercises revoked membership and foreign-language/cursor denial using only an isolated fixture organization.
- Full typecheck, production build, WordPress tests, documentation-language check passed. Lint has zero errors and four pre-existing Stripe warnings.
- Local browser verification uses localhost, matching the existing passkey relying-party configuration. No passkey code was changed.
- Running the unit suite on local Node 26 exposed a pre-existing Next.js proxy AsyncLocalStorage runtime exception; the repository's Node 20 suite passed. Node 26 is not presented as the validated runtime.
