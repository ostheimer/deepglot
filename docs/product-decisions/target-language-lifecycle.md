# Target language lifecycle

Project managers may add a lowercase BCP 47 language, script, or region tag (for example `en`, `pt-br`, `zh-hant-tw`). This exact tag is the stable database value and WordPress URL segment. Existing target records keep their per-language settings when reactivated. A variant request first checks its own cache and then existing parent-locale translations, preferring the most specific parent. Fresh provider work remains subject to the project's global automatic-translation switch and the target's own switch. Provider support for every custom locale is not guaranteed; a parent cache hit does not create or bill a new translation.

The three switches are independent:

| Setting | Visitor delivery | Discovery | Fresh provider work |
| --- | --- | --- | --- |
| Active off | Target routes and API translations stop | Target is absent | Stopped |
| Visible off | Direct target URLs still work | Excluded from switchers, browser redirects, hreflang, and the multilingual sitemap; direct pages receive `noindex` | Unchanged |
| Automatic translation off | Existing cached and manual translations remain available; missing segments fall back to source text | Unchanged | Stopped for this target |

The runtime snapshot includes each active target's existing `ProjectLanguage.id` as its generation. Pausing and reactivating preserves that identity and its cached content. Deleting and re-adding the same code creates a new identity, so WordPress advances that target's cache epoch, drops stale warm-queue work, and purges known page caches even when its next observed language list is unchanged. A site with all targets paused keeps its authenticated runtime identity and continues bounded refreshes so a later reactivation reaches anonymous requests; translated delivery and warm-up remain disabled while the list is empty.

Visibility is not access control or privacy. An upstream full-page or CDN cache may serve an earlier page until refreshed. The WordPress plugin applies a versioned runtime snapshot, purges known WordPress page caches on a changed language policy, and advances its target cache epoch after a target is removed. It does not control an upstream CDN or guarantee that all customer sites have installed the matching plugin package. Verify origin and anonymous public output after installation.

Removal requires a fresh manager-only preview token. The transactional confirmation compares the current project configuration and target-owned data to that preview. On a mismatch it returns `409` and a new preview, with no deletion. Confirmed removal deletes only that target's translations and dependent translation history/context, translated URL statistics, URL slugs, glossary rules, media replacements, domain mappings, and the target record. Historical page views, translation batch logs, and billed project usage remain. Member assignments and pending invitations remain visible for managers to reassign or revoke; removal does not grant broader access. Project-wide source URL inventory and exclusion rules remain. Bulk operations report one status per requested language, including partial failures and stale previews.

`scripts/sql/language-lifecycle.sql` is additive. Apply it to the exact verified Preview and Production databases before deploying the generated Prisma client. Inspect unrelated schema drift separately; do not use a broad production `prisma db push` to resolve it.
