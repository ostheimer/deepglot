# Translation workspace: editorial metadata (#257)

## Delivered slice

Each segment has optional, durable labels, an editorial note and an explicitly selected list of variable tokens. Metadata uses its own integer version. A stale save returns 409, including simultaneous first saves; it never overwrites a newer annotation silently. Saving annotations does not change translation text, translation timestamps, approval state, quota or dependent translation caches.

Project managers may edit annotations. Translators may edit only their own assigned segments in their permitted target language. The API validates the active language pair and the current assignment while holding the same project/segment locks used by content mutations. Deleting a translation cascades to its annotations.

Labels are trimmed, NFKC-normalized, lowercased and deduplicated (20 labels, 40 characters each). The label filter is an exact normalized match, not a substring search; apply it with Search. Notes are plain text up to 2,000 characters. Label/variable filters combine with all existing workflow filters and participate in request identity and pagination. Metadata changes reload the latest active query.

## Variables: explicit selection, not automatic rewriting

The editor offers up to 50 unique literal-token suggestions: simple `{name}`, `${name}`, `{{ name }}` and printf `%s`, `%d`, `%i`, `%f`, including positional forms such as `%1$s`. Escaped `%%` is ignored. These suggestions are not a parser for ICU messages, template languages, HTML or executable expressions. Users explicitly select tokens to persist, and the server verifies that each selected supported token exists in the current original text.

The filter distinguishes **saved variables** from **no saved variables**. It does not claim that unannotated segments contain no placeholders. Existing translations are not automatically backfilled or reclassified. Removing a saved token only removes its annotation; no source or target text is changed. The saved list is groundwork for future validation/AI safeguards, not a claim that provider output or subsequent manual edits already enforce placeholder preservation.

## Session API

`PATCH /api/projects/{projectId}/translations/{translationId}` accepts a metadata-only payload (do not mix it with content or workflow changes):

```json
{
  "metadata": { "labels": ["qa"], "variables": ["{{name}}"], "note": "Check terminology" },
  "expectedVersion": 0
}
```

Version 0 means no metadata exists yet. The response contains `metadata` with its new `version`; subsequent saves must submit that version. GET workspace responses include nullable `metadata`; use `label=qa` and `variables=saved|none` for filters. These are authenticated session endpoints, not public plugin API-key endpoints.

## Deployment


Apply `scripts/sql/translation-metadata.sql` before deploying the application. It adds only `TranslationMetadata`, a cascading foreign key and a GIN label index. No translation backfill, broad schema push or translation-content rewrite is required. Verify on an isolated production branch first, then on the actual preview/production databases. Runtime credentials must remain out of logs and repository files.

## Verification and follow-up

Unit tests cover normalization, limits, token suggestions and query identity. PostgreSQL integration covers actor/language/project boundaries, stale/concurrent saves, unchanged content versions and approval state, combined filters, missing versus empty annotations, inactive languages and cascading deletion. Playwright covers edit/save/reload, selected variables, label filtering, disappearing rows after metadata edits, stale writes and invalid variable rejection.

This does not close #257. Type/quality/inactivity semantics, complete variable management and history remain open, followed by bulk actions and AI/search-and-replace. No synthetic quality score is introduced.
