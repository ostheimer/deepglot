# Reported translation types

Issue #257 now records explicit `words[].t` observations from successful `/api/translate` requests. These are client claims, not inferred content classification or a complete site inventory.

## Contract and filters

Only numeric integers 0 through 10 are recognized. Missing, malformed and future type values retain the existing translation behavior but add no observation. There is no content/extension guessing or historical backfill. An entry without observations is unknown, even if its text resembles an image URL.

| Filter | Contract values |
| --- | --- |
| Text | 1 text, 2 value, 3 placeholder, 4 meta content, 7 image alt, 9 page title |
| Media / documents | 5 iframe source, 6 image source, 8 PDF href |
| External links | 10 external link |
| Other | 0 other |
| Unknown | No observations |

The cache identity is unchanged. A segment may have multiple observed types and match several filters, without being duplicated in counts or pages. Filters compose with language permissions and every other workspace filter. The existing repeatable-read snapshot covers count, page selection and hydration.

The current native WordPress client sends `t: 1` for all outbound text strings. This release does not change extraction or claim that image URLs, documents or external links are already inventoried. Types reported by compatible clients are retained; imports and other ingestion paths remain unknown until a supported request explicitly reports a type. Local WordPress cache hits do not contact SaaS and therefore add no observations. Media replacement work in PR #322 remains separate: nothing here fetches, replaces or translates resources differently.

## Persistence and release gate

`TranslationTypeObservation` has one row per translation and reported integer type, with first/last observation timestamps. The existing authenticated project/language write guard applies to fresh and cache-only recording, including bots. Recording does not require a page URL, but requires an existing translation in that exact project and language pair: cache-only misses cannot create observations. Idempotency replays retain existing behavior and do not run ingestion again. Repeated or concurrent observations are merged atomically, without changing translation edit tokens, text, assignment or approval state. Deleting a translation cascades its observations.

Apply `scripts/sql/translation-types.sql` before deploying the new Prisma reader. Validate it on an isolated production clone first, then the preview and production targets using direct connections and verified host identities. Do not use a production `prisma db push`. The migration is additive and does not rewrite existing translations. Old application versions can continue running with the extra table present.

The unit suite covers every recognized value, invalid values, duplicate hashes, group mapping and all locale catalogues. PostgreSQL integration coverage checks tenant/language isolation, concurrent updates, stable content tokens, pagination, composed filters and cascade deletion. A real HTTP/browser test covers fresh generation, cache-only hits and misses without a page URL, untyped legacy input, invalid query values, detail display, filter reset and narrow viewport layout.

The 2026-09-05 pre-release gate passed on production clone `br-green-sunset-agkr29kq` (227,658 translations) and the verified preview branch (706 translations). Applying the migration twice preserved translation counts and verified all column types, the composite primary key and cascading foreign key. The clone expires on 2026-09-06 at 18:00 UTC. Local checks passed: 669 unit tests, 39 PostgreSQL integration tests, 50 browser tests, the full type check, WordPress suite, lint (existing warnings only) and documentation language validation. Final deployment evidence is tracked in PR #336.
