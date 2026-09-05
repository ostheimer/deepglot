# Translation workspace: selected-variable checks and observed activity (#257)

## Quality semantics

The `quality` filter checks **explicitly selected variables**, not overall linguistic quality. It uses the existing literal brace/printf suggestion grammar, not a full ICU or template parser.

- `mismatch`: at least one selected token is absent from the source, or its occurrence count differs between source and translation. This includes missing and extra occurrences, changed case/spacing, escaped printf strings and stale annotations.
- `match`: there is at least one selected variable and all selected token counts match. Unselected placeholders, grammar and glossary compliance are not assessed.
- `unchecked`: metadata is missing or no variables are selected. This does not mean there are no placeholders in the text.

Checks are computed from current source, translation and metadata during the read. There is no derived status to invalidate after provider, import or manual updates, and no automatic text rewriting. SQL tokenization is tested against the JavaScript reference implementation using actual PostgreSQL.

## Observation semantics

The `activity` filter describes recorded SaaS page-context observations:

- `recent`: at least one associated path was observed at or after the request's UTC cutoff (30 exact 24-hour days before evaluation).
- `older`: there is recorded context, but every path was last observed before that cutoff.
- `unknown`: no recorded context.

Activity is segment-wide. Selecting an old path does not classify a segment as old if another path was observed recently. The API returns `observation.evaluatedAt` and `observation.cutoff` for interpretation. Local WordPress cache hits do not reach SaaS; therefore **older and unknown are not proof of inactivity**. No segment is hidden by default, deactivated or deleted.

## Query and access contract

Existing project access and target-language checks remain in place. All old and new filters compose with AND semantics; text search still matches source OR translation. Search terms and all filter values are SQL parameters, including literal `%`, `_`, backslashes and quotes. Sorting uses only fixed expressions and an ID tie-breaker.

Filtering and counts execute in PostgreSQL before pagination. Token counts are materialized once per source/target text and reused for all selected variables. Count, selected IDs and bounded Prisma hydration share a repeatable-read transaction; there is no unbounded project scan in application memory. The path selector retains its existing scope and 500-path presentation limit. No schema migration is needed beyond the metadata/context prerequisites shipped in #328 and #331.

A local synthetic PostgreSQL benchmark with 1,000 fully annotated segments and 50 selected variables per segment exposed repeated tokenization: match/mismatch listings took 11,084/10,784 ms. Materializing the two token-count sets reduced the same workload to 483/471 ms, with identical totals. These are local measurements, not a production latency guarantee. A structural regression test guards the two materialized tokenization operations without imposing flaky wall-clock assertions in CI.

## Verification and remaining scope

Unit tests cover token multiplicities, escapes, exact spelling, stale/unconfigured annotations, the UTC cutoff and client query identity. PostgreSQL tests cover SQL/reference parity, tenant/language boundaries, combined filters, literal search, pagination/counts, multiple path observations, the exact cutoff and immediate edit visibility. Browser tests exercise combined filters, correction-driven removal, reset and invalid API values; the existing workspace suite guards prior editing and permission behavior.

True content type requires ingestion provenance for normal text, media and external-link entries; do not infer it from string contents or file extensions. Confirmed inactivity needs authoritative inventory/crawl semantics. These remain in #257, along with full placeholder preservation, history, bulk actions and AI/search-and-replace. This slice does not claim complete Weglot parity.
