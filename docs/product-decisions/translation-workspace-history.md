# Workspace text change history

This bounded slice of #257 records new direct text edits made through the central human-review workspace. It is not a complete audit trail and does not reconstruct earlier changes. Visual-editor/manual-translations writes, imports, automatic translation, labels, notes, assignments, approval and deletion are outside the recording scope. There is no restore action.

## Persistence and permissions

`TranslationContentRevision` stores the previous and committed target text, creation time and an optional authenticated user reference. No email or name snapshot is stored. A removed user has a null reference; the UI displays an unknown editor. Names reflect the current user record. Deleting a segment or its project removes its revisions through the translation foreign key.

`updateProjectTranslationContent` writes the revision in the same transaction as the optimistic content update, workflow reset, batch log and webhook queue. A no-op, stale version, forbidden edit or transaction failure records nothing. Existing content permissions, review reset, authoritative manual translation and cache/webhook behavior are preserved. The HTTP route supplies the actor from the authenticated session; clients cannot select an actor.

GET `/api/projects/{projectId}/translations/{translationId}/history` requires current project access and the segment's allowed target language. Managers can read all project segments; translators retain their target-language scope. Responses are private and not cached. Pagination uses a segment-scoped revision cursor, ordered by creation time and ID descending, with 10 entries by default and a maximum of 20. Cursor ordering is deterministic when timestamps coincide. A deleted or foreign cursor fails rather than changing the requested segment scope.

Long revisions can shorten a page to stay within a 3 MB text payload budget; the returned cursor still resumes immediately after its final item. An individual oversized revision (for example, previously imported content) returns at most 100,000 UTF-16 code units per text, without splitting surrogate pairs, with an explicit localized preview notice. The stored revision remains complete.

## UI and limits

Each workspace segment has a lazy history disclosure. Opening it fetches only that segment's first page; older entries load on request. A changed content version resets the panel. Before/after text is rendered as plain text, with bounded scrolling for long content. Every supported locale explicitly says that only new workspace edits are included. An empty history does not prove that a segment was never edited. The history is retained for the lifetime of its segment; additional storage grows with edits, not with read requests. No provider is called and history reads do not consume translation words.

## Rollout

Apply the versioned additive SQL in `scripts/sql/translation-history.sql` to a fresh production clone, then preview and production before deploying the Prisma client that uses it. Reapply on the clone to prove idempotency and inspect column types, foreign keys, indexes and unchanged translation counts. Never use production `prisma db push` for this slice. The target-schema build gate must pass before Preview/Production deployment.

Use synthetic preview rows for edit/save/readback. Production acceptance only opens the history of an existing visible segment and checks the limited-scope notice and response; do not edit customer content for verification. Keep #257 open for remaining workspace work.
