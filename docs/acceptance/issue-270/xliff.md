# Issue #270: XLIFF translation round trip

## Format and contract

- XLIFF 1.2, namespace `urn:oasis:names:tc:xliff:document:1.2`, one `file` and one `body` per project and target language.
- `file@original` is the project ID; `source-language` and `target-language` must match the signed-in project's active language pair. `trans-unit@id` is the stable existing translation hash for the source text and language pair. Existing mixed-case language codes retain their stored hashes; new rows use the project's current source spelling and the requested target spelling.
- Source and target are UTF-8 text. XML escaping preserves placeholders, literal HTML, and carriage returns; XML 1.0-invalid control characters produce a controlled export error. Nested XLIFF inline elements are rejected with a segment number instead of silently losing markup.
- A 4 MB / 5,000 segment limit applies to both import and export, leaving room below Vercel's 4.5 MB function payload cap for multipart framing. Invalid UTF-8, XML, DTDs, entity declarations, extra processing instructions, duplicate IDs, mismatched hashes, and structure errors are rejected before persistence.
- A project manager must explicitly choose `applyApproved=true` to apply `approved="yes"`; otherwise the file is rejected. Missing `approved` means unapproved. The namespaced `dg:manual="yes|no"` extension records exported manual status; an absent marker defaults to manual for external files. An untrusted `no` marker preserves machine status only when an existing machine segment has exactly the same target. New or edited imports become manual. Existing manual or approved text with a different target is a conflict. Matching manual text keeps its manual provenance.
- The entire import, including row webhook enqueue, cache invalidations, and import batch log, runs in one serializable transaction. Access is rechecked under project membership locks. Writes and row webhook deliveries are batched in groups of 100, and unchanged segments are not rewritten. Any preflight, row, or database failure rolls back every segment. The API returns `issues` with one-based segment numbers for detected conflicts.
- Cache invalidation selects at most one ordered page context per changed translation. The feed includes the target language for new events; WordPress applies digest invalidations and advances positive epochs only for affected languages once per feed page. Legacy feed rows without a language advance all positive language epochs. Remaining feed pages run in bounded WP-Cron work.

## Verification on the feature branch

- `node --import tsx --test src/lib/xliff.test.ts`: 8 passed, including fixture files for external entity and expansion payloads, machine marker validation, carriage-return preservation, and the 4 MB transport boundary.
- `npm run test:wp`: passed. The cache invalidation regression covers 751 events: one page applied during settings refresh, then bounded WP-Cron runs for the remaining pages. The visitor request performs no follow-up runtime fetches.
- `node --import tsx --test src/lib/public-design-regressions.test.ts`: 8 passed.
- `npm test` against the isolated local PostgreSQL cluster: 846 passed, 0 failed.
- `npx tsc --noEmit --incremental false`: passed after regenerating Prisma Client for current `origin/main`.
- `npm run lint`: passed with four existing warnings in Stripe/webhook files.
- `npm run check:docs-language`: passed.
- `tests/integration/xliff-import.test.ts` against a synthetic database on local PostgreSQL: conflict on segment 2 left segment 1 unwritten and kept the protected text; a corrected retry saved both segments and preserved `MANUAL` provenance. Test-created organization and project rows were deleted in `finally`.

## Remaining release proof

Record the PR URL, exact merge commit, green CI, production deployment tied to that commit, public DE/EN Help and Developer readback, and signed-in Import & Export UI/API readback here after the release. No production translation data should be written for acceptance.
