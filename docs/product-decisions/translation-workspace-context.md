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

The change is tested with isolated PostgreSQL 16. Preview/production database application remains a release gate, not an implied outcome of local tests or a successful build. Keep the follow-up PR draft until target schema verification and PR review are complete.

## Verification

- Unit tests: URL normalization, safe navigation and query identity for every added filter.
- PostgreSQL integration: deduplication, combined filters/counts, scoped page inventory, immutable edit timestamps, language rejection and cascading deletion.
- Playwright: real API recording on fresh/cache requests; UI context navigation; combined filters; edit-driven filter changes; invalid API filter rejection; existing human-review flows.
- Frontend copy includes German umlauts and catalogue entries for all supported UI languages.
