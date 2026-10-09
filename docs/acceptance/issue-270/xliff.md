# Issue #270: XLIFF translation round trip

## Format and contract

- XLIFF 1.2, namespace `urn:oasis:names:tc:xliff:document:1.2`, one `file` and one `body` per project and target language.
- `file@original` is the project ID; `source-language` and `target-language` must match the signed-in project's active language pair. `trans-unit@id` is the stable existing translation hash for the source text and language pair.
- Source and target are UTF-8 text. XML escaping preserves placeholders and literal HTML; nested XLIFF inline elements are rejected with a segment number instead of silently losing markup.
- A 5 MiB / 5,000 segment limit applies to both import and export. Invalid UTF-8, XML, DTDs, entity declarations, extra processing instructions, duplicate IDs, mismatched hashes, and structure errors are rejected before persistence.
- A project manager must explicitly choose `applyApproved=true` to apply `approved="yes"`; otherwise the file is rejected. Imports create manual overrides. Existing manual or approved text with a different target is a conflict. Matching manual text keeps its manual provenance.
- The entire import, including row webhook enqueue and import batch log, runs in one serializable transaction. Any preflight, row, or database failure rolls back every segment. The API returns `issues` with one-based segment numbers for detected conflicts.

## Verification on the feature branch

- `node --import tsx --test src/lib/xliff.test.ts`: 5 passed, including fixture files for external entity and expansion payloads.
- `node --import tsx --test src/lib/public-design-regressions.test.ts`: 8 passed.
- `npm test` against the isolated local PostgreSQL cluster: 846 passed, 0 failed.
- `npx tsc --noEmit --incremental false`: passed after regenerating Prisma Client for current `origin/main`.
- `npm run lint`: passed with four existing warnings in Stripe/webhook files.
- `npm run check:docs-language`: passed.
- `tests/integration/xliff-import.test.ts` against a synthetic database on local PostgreSQL: conflict on segment 2 left segment 1 unwritten and kept the protected text; a corrected retry saved both segments and preserved `MANUAL` provenance. Test-created organization and project rows were deleted in `finally`.

## Remaining release proof

Record the PR URL, exact merge commit, green CI, production deployment tied to that commit, public DE/EN Help and Developer readback, and signed-in Import & Export UI/API readback here after the release. No production translation data should be written for acceptance.
