# Translation workspace: observed page context (#257)

## Delivered slice

- Track segment/page associations for successful fresh and cached SaaS translation requests.
- Preserve first-seen and last-seen timestamps independently from translation edit versions.
- Display associated paths, open the observed path on the project website, and filter the workspace by clicking a path.
- Combine source, manual-edit state, recorded/missing context, exact page path, language, workflow status, assignee and text search. Sort by modification time, creation time or original text, with a stable ID tie-breaker.
- Keep page navigation restricted to the same project and the actor's target-language scope.
- Reload the current query after edits so rows that no longer match a filter disappear.

## Deliberate limits

Context is observed, never inferred from project-level page analytics. Existing translations remain without context until another SaaS translation request includes them. WordPress-local cache hits that never reach SaaS cannot update these timestamps. A missing context does **not** mean inactive content.

Only HTTP(S) URLs on the configured project hostname and port are accepted. Credentials, query strings and fragments are not stored in context records. Mapped language-subdomain attribution is a follow-up; unrelated hosts are never accepted implicitly.

Each segment returns at most 100 paths with its full association count. The page selector returns at most 500 distinct paths, grouped in PostgreSQL; neither selector nor metadata loads an unlimited site inventory. Exact path filtering in the API also supports paths outside this selector. These limits are presentation limits, not limits on recorded associations.

This is the first advanced-filter slice, not completion of #257. Content type, quality, variables and labels need their own durable metadata semantics and tests. Inactive content needs a defined last-seen policy. Implement these before moving on to the agreed bulk actions, followed by AI and search-and-replace tools. No synthetic quality score or guessed media classification is exposed.

## Additive deployment gate

`scripts/sql/translation-context.sql` creates only `TranslationContext`, its composite primary key, cascading translation foreign key and path index. Apply and verify this additive change in each target database **before** deploying the new application code. Do not use a broad production `prisma db push` to resolve unrelated drift.

The change is tested with isolated PostgreSQL 16. On 2026-09-05 the exact additive SQL was also applied and verified on an expiring Neon production clone, the actual Vercel preview database, and the production database. Column types/nullability, the composite key, cascading foreign key and path index passed. Translation row counts before/after each migration were unchanged (227,582 in production). This schema gate is separate from application deployment and review acceptance.

The preview database also lacked older workflow and activity-digest membership columns. The narrowly scoped `scripts/sql/translation-workflow.sql` restores the workflow prerequisite. The two membership columns were added with the schema's existing defaults (`activityDigestEnabled=false`, `activityDigestLocale='en'`); no subscriptions or notifications were enabled. Production already had these older columns. No broad schema push was used.

The deployed preview was checked through the shared synthetic test account: workspace loading, observed-context filtering, timestamps and safe page links, and exact-path combined filters. Saving a manual edit while filtering for non-manual translations correctly removed the row and displayed zero matches. A single `/preise` association was seeded only for the synthetic preview project for this UI check; fresh/cache request ingestion is separately covered by the PostgreSQL integration and Playwright tests. This is not a claim of authenticated production UI acceptance.

## Verification

- Unit tests: URL normalization, safe navigation and query identity for every added filter.
- PostgreSQL integration: deduplication, combined filters/counts, scoped page inventory, immutable edit timestamps, language rejection and cascading deletion.
- Playwright: real API recording on fresh/cache requests; UI context navigation; combined filters; edit-driven filter changes; invalid API filter rejection; existing human-review flows.
- Frontend copy includes German umlauts and catalogue entries for all supported UI languages.
