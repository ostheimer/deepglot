# Deepglot

## Automatic subscription upgrades

Organization owners can opt in from **Subscription → Plan overview**. The setting is off for every existing and new organization. An owner chooses the highest paid plan and a EUR recurring-price ceiling. At 90% of measured monthly translated words, Deepglot may request one higher tier. Stripe can invoice a proration immediately. No automatic downgrade occurs, and a pending or failed payment never grants the proposed allowance. Attempts and confirmed upgrades remain visible in the owner's plan history. See [the operator runbook](docs/auto-upgrade.md) for the schema, reconciliation and release gates.

Deepglot is a multilingual WordPress platform without cloud lock-in: a Next.js dashboard app with Stripe billing, NextAuth, Prisma/Neon, and a compatible translation API for a custom WordPress plugin.

## Author

Andreas Ostheimer  
https://www.ostheimer.at

## Stack

- Next.js 16 + App Router
- TypeScript
- Tailwind CSS + shadcn/ui
- NextAuth v5
- Prisma 7 + Neon PostgreSQL
- Stripe
- 7 Translation Providers (OpenAI, DeepL, Gemini, OpenRouter, Ollama, openai-compatible, mock)

## Local development

```bash
npm install
npm run dev
```

The app will then be available at `http://localhost:3000`.

For database access, the app now auto-selects the Prisma Neon adapter only for real Neon hosts. Local PostgreSQL URLs such as `localhost` or `127.0.0.1` automatically use Prisma's default PostgreSQL driver, which makes local fallback databases work without extra code changes.

## Important scripts

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
npm run check:docs-language
npm run test:e2e
```

## Public routing

Deepglot now uses English as the canonical URL structure across the public site and the app:

- Canonical English routes:
  - `/`
  - `/pricing`
  - `/login`
  - `/signup`
  - `/dashboard`
  - `/projects`
  - `/subscription`
  - `/settings`
  - `/docs` (public developer and WordPress integration reference)
  - Legal pages (German statutory requirements):
    - `/terms` (Terms of Service)
    - `/privacy` (Privacy Policy)
    - `/legal-notice` (Legal Notice)
- German localized routes use translated path segments under `/de`:
  - `/de`
  - `/de/preise`
  - `/de/anmelden`
  - `/de/registrieren`
  - `/de/dashboard`
  - `/de/projekte`
  - `/de/abonnement`
  - `/de/einstellungen`
- Legacy German routes such as `/preise`, `/anmelden`, `/registrieren`, and `/projekte/...` redirect to their canonical `/de/...` equivalents.

Internally, the Next.js app still uses the existing route folders (e.g. `/projekte`, `/abonnement`, `/einstellungen`), while `src/proxy.ts` rewrites the external English path structure (`/projects`, `/subscription`, `/settings`) to the current internal implementation. The proxy also forwards the active locale through the request context and syncs the locale cookie so localized `/de/...` routes behave consistently during full-page navigation and auth redirects.

## Locale switching

- The UI can be switched between English and German on the marketing site, auth pages, and inside the dashboard.
- English is the default language and German is the first localized variant.
- The language switcher keeps users on the equivalent localized route and the proxy persists the active locale in `deepglot-locale`.

## Auth architecture

The auth configuration is intentionally split:

- `src/lib/auth.config.ts`: edge-safe base configuration for the proxy
- `src/lib/auth.ts`: server-side configuration with Prisma adapter and providers
- `src/proxy.ts`: uses only the edge-safe configuration for redirects, locale rewrites, and request cookies

This separation prevents edge/runtime failures such as `MIDDLEWARE_INVOCATION_FAILED` on Vercel while keeping locale-aware auth redirects stable.

The authentication entry points are now:

- English: `/login`, `/signup`
- German: `/de/login`, `/de/signup`

GitHub and Google sign-in are only registered when both provider secrets are configured. Local credentials login and the shared test-login therefore continue to work even when local OAuth credentials are intentionally absent.

Passkey sign-in uses Auth.js WebAuthn with discoverable, user-verified credentials. Users can add or remove passkeys only from their authenticated account settings; the public login flow does not create new accounts. Existing password and OAuth sign-in remain available.

Before enabling a build with passkey support against an existing database, run `npx prisma db push` for that exact environment so the required `Authenticator` table exists. The same applies to the `ProjectSettings.runtimeSyncSiteHost`, `runtimeSyncApiKeyId` and `runtimeSyncConflicts` columns that record the last plugin sync: apply the schema with the `Schema push (production)` workflow (`gh workflow run schema-push.yml --ref main -f apply=false -f target_schema=current`, review its SQL and printed digest, then `gh workflow run schema-push.yml --ref main -f apply=true -f schema_sha=<printed commit> -f target_schema=current -f plan_digest=<printed digest>`) before deploying a build that includes them, because Prisma selects them on every settings page. Use `target_schema=current` for the reviewed schema on main. Production WebAuthn requires HTTPS and a stable application origin matching the relying-party hostname. Auth.js currently marks its WebAuthn implementation as experimental. Because passkey credential identifiers, public keys, counters, device type, and backup status are stored, review the approved privacy notice before production rollout; private keys and biometric data are not stored by Deepglot.

## API compatibility

The `POST /api/translate` route is designed for drop-in compatibility:

- `?api_key=...` is supported
- `Authorization: Bearer <key>` is supported as an alternative to `?api_key=`
- Optional `quota_probe: true` in the request body rejects exhausted monthly quotas even when every word is a cache hit (used by the WordPress plugin health ping; normal visitor cache-only traffic is unaffected)
- Source-language, translation, title, and request-URL values containing U+0000 are rejected with `400 validation_failed` before provider calls or translation-content persistence. Other control characters and valid Unicode remain unchanged; provider output containing U+0000 is treated as an invalid provider response and can use the configured fallback chain.
- Fresh provider words are reserved atomically against a per-organization hourly velocity limit derived from 10% of the effective monthly quota (minimum 1,000) unless a valid positive `TRANSLATE_WORD_VELOCITY_PER_HOUR` override is configured. A single fresh-word request that exceeds the complete hourly cap returns `422 velocity_request_too_large` with no Retry-After and does not reserve or mutate a velocity bucket; split the request, or a PDF, into smaller inputs. An exhausted existing window instead returns a retryable 429 `velocity_limited`; clients must wait for `Retry-After` instead of immediately resending the same work. With an `Idempotency-Key`, concurrent duplicates share that response, it is replayed only through Retry-After, and the key can execute again after expiry.
- Velocity reservations emit privacy-safe `allowed`, `blocked`, or `oversize` classification metadata. Organization, project, and repeated-request grouping use keyed HMAC pseudonyms; raw IDs, text, keys, and URLs are never logged. Actor class, API/PDF surface, item count, and idempotency protection make retry amplification distinguishable from ordinary traffic. There is no historical classification before this change, so the threshold must not be tuned from the aggregate 429 count alone; follow `OPERATIONS.md` for the evidence gate.
- The response includes `from_words` and `to_words`
- Public endpoints:
  - `GET /api/public/status`
  - `GET /api/public/languages`
  - `GET /api/public/languages/is-supported`

## Translation workspace

Account settings support persistent workspace creation, renaming and management of already-known registered members within plan and seat limits. Project creation targets an explicit managed workspace, and the project list offers a signed, expiring transfer preview before an owner/admin moves a project to another workspace they manage. An unresolved URL provider operation or a legacy receipt without evidenced billing origin blocks both preview and commit until reconciled. Historical billed usage and attributed URL operation receipts stay with their source; plugin/API keys and webhook credentials require reconnecting. A transferred project BYOK provider key is removed and fresh provider work pauses until the destination saves a new key; projects already using the platform provider continue under destination plan and quota gates. Apply the compatible expansion in `scripts/sql/workspace-transfer.sql` after the #263 URL operations migration and before deploying #267; see the [complete transfer matrix and operational boundaries](docs/product-decisions/workspace-transfer.md).

### Professional translation orders (release gated)

Issue #272 adds a separate manager-only ordering candidate alongside the
existing member review and export → vendor → import paths. It snapshots an
authorized segment/language scope, accepts a vendor quote with price,
turnaround and expiry, records durable payment/fulfillment states, and holds
delivery as a review draft until the manager explicitly adopts it into the
existing assignment and approval workflow.
The feature is disabled by default. One-time Stripe Checkout and a separate
signed payment/refund/dispute webhook are implemented behind the gate; no
live payment or vendor call has been made.
See [the order runbook](docs/operations/professional-translation-orders.md)
for the state contract, schema trigger, adapter boundary and launch decisions.

Project managers can set a website description, tone, audience, and additional translation instructions under **Project → Settings → Language Model**. A description suggestion runs only when requested and remains unsaved until the manager saves it. Separate switches include relevant glossary entries and approved or manually edited translations from the same project and language pair in bounded provider context for new translations. Existing cache, manual translations, protected glossary terms, quotas, and provider fallback retain their priority. See [project translation context](docs/product-decisions/project-translation-context.md) for limits and rollout details.

New direct workspace text edits have an atomic, lazy-loaded before/after history with editor attribution and scoped pagination. Earlier edits and writes through other editors are not reconstructed or included. Apply `scripts/sql/translation-history.sql` before deploying; see [workspace history scope and rollout](docs/product-decisions/translation-workspace-history.md).

The project's **Human Review** workspace supports direct manual editing and deletion with role- and language-scoped access checks. Filters combine target language, workflow status, assignee, text search, translation source, manual-edit state and observed page context. Open a segment's context to visit its source page or filter by its exact path.

Context is recorded on successful fresh and cached SaaS translation requests, not inferred from page-view analytics. Existing translations gain context when observed again; missing context does not mean inactive content. Apply the additive `scripts/sql/translation-context.sql` migration before deploying this feature to an existing database. See [context semantics and deployment verification](docs/product-decisions/translation-workspace-context.md).

Selected-variable checks now distinguish exact token-count matches, mismatches and unconfigured annotations. Observed-activity filters distinguish SaaS observations within 30 days, older observations and unknown context; they do not claim that content is inactive. Counts and pagination use the same database snapshot. See [quality and observation semantics](docs/product-decisions/translation-workspace-quality.md).

Explicit client-reported types are retained for text, media/documents, external links and other content, with an unknown filter for entries without observations. Multiple types per segment are supported; types are never guessed from content. The native WordPress client currently reports all outbound text as text, so this is not a complete media inventory. Apply `scripts/sql/translation-types.sql` before deployment. See [reported-type semantics and release gate](docs/product-decisions/translation-workspace-types.md).

Segment metadata supports persistent labels, plain-text notes and explicitly selected placeholder variables, with exact-label and saved-variable filters. Annotations have independent concurrency versions and do not alter translation text or approval status. Apply `scripts/sql/translation-metadata.sql` before deploying. See [metadata semantics and limits](docs/product-decisions/translation-workspace-metadata.md).

The workspace supports selecting visible segments on the current page and applying one assignment or review action to at most 100 segments. Each request is atomic: a stale, unauthorized, missing or invalid row leaves the entire selection unchanged. See [bulk workflow semantics](docs/product-decisions/translation-workspace-bulk.md).

All-placeholder filters compare every recognized literal token in the source and target, independently of saved variable annotations. Selected text can be searched and replaced through a fingerprinted preview and an atomic 100-row CAS save. Explicitly included manual or approved text loses approval after a content change. AI Improve, Rephrase and Shorten show the effective project provider/model, word quota and conservative approved-price ceiling before a separate provider call; the result remains a suggestion until a manual CAS save. PDF translation previews the same project context and the full configured fallback/repair envelope before an explicit Run click. Automatic WordPress translation has no visitor click; with active budget enforcement, a server-side whole-action preflight covers pending strings, context and fallback before the first provider attempt. Each budgeted provider attempt has a durable spend reservation; unknown usage retains its hold and no platform credits are implied. See [workspace AI and replacement safeguards](docs/product-decisions/translation-workspace-ai-tools.md). WordPress now reports bounded, digest-only snapshots of fully rendered source pages, including translation-cache hits. The separate presence filter can say a segment is no longer present **in those captured pages** only when every known context has fresh complete evidence; dynamic, missing and stale pages remain unknown. Apply `scripts/sql/source-page-snapshot.sql` before deploying the matching WordPress runtime. Old or missing SaaS observations never establish site-wide inactivity; see [source-page semantics](docs/product-decisions/translation-workspace-quality.md).

## Locale-specific media URL replacements

Project managers can explicitly map an original image, document, or video URL to a localized URL for
one active target language. Open **Project → Translations → Media** to search original
or replacement URLs, filter by target language and media type, and create, edit or
delete mappings. Only project managers can open this page or use its API. Existing
inactive-language mappings remain visible and deletable; editing requires an active
target language. Deletion restores the original after plugin runtime synchronization
and cache refresh; it does not delete a media file. The dashboard uses the existing
authenticated project management endpoints:

- `GET /api/projects/{projectId}/media` lists project-owned media mappings.
- `POST /api/projects/{projectId}/media` creates one mapping.
- `PATCH /api/projects/{projectId}/media/{mediaId}` updates selected fields.
- `DELETE /api/projects/{projectId}/media/{mediaId}` removes one mapping.

For example, the create endpoint accepts:

```json
{
  "langTo": "en",
  "originalUrl": "https://example.com/wp-content/uploads/product.png",
  "localizedUrl": "/wp-content/uploads/product-en.webp"
}
```

Returned records contain `id`, `langTo`, `originalUrl`, `localizedUrl`,
`createdAt`, and `updatedAt`. The collection response includes
`mediaReplacements` and `limitExceeded`; listing remains bounded while allowing
managers to inspect and remove historical overflow. Every read and write
requires project-management access. Image ownership is project-scoped, target
languages must be active, and the same original image can have a different
replacement for each target language or independent project.
Validation and conflict responses include stable machine-readable `code` values
such as `invalid_media_image_url`, `inactive_target_language`, and
`media_replacement_already_exists` alongside their localized error message.
Configurations exceeding the runtime payload limit return
`media_replacements_payload_too_large`.

File URLs must be root-relative paths or HTTPS URLs on the exact project
hostname. Accepted image formats are PNG, JPG, JPEG, WebP, AVIF, and GIF;
document links support PDF, DOCX, XLSX, and PPTX; self-hosted video supports
MP4 and WebM. Documents and video replacements must retain their file extension.
The only external URLs supported are exact HTTPS embed endpoints of the form
`https://www.youtube.com/embed/{11-character-id}`,
`https://www.youtube-nocookie.com/embed/{11-character-id}`, and
`https://player.vimeo.com/video/{numeric-id}`. An embed replacement must retain
the provider hostname. Query parameters, fragments, watch-page links, short URLs,
external CDNs, and other iframe providers are unsupported.
Absolute same-site URLs are stored in canonical root-relative form, with a
maximum length of 2,048 characters after percent encoding. Foreign origins,
IP hosts, embedded credentials, fragments, unsafe or recursively encoded path
separators, SVG, and executable formats are rejected. Project managers are
responsible for owning or obtaining the necessary usage and redistribution
rights for every original and localized file or embedded video, including the
right to publish the localized URL on the target site. Deepglot does not verify
licenses, provider terms, or the existence and content type of remote files.

A project can contain at most **500 media URL replacements**. Concurrent creation
and partial updates use serializable project-scoped checks; a duplicate,
exhausted item limit, or active-language JSON payload exceeding **224 KiB**
returns HTTP 409 before its transaction commits. Activating a language through
the dashboard applies the same payload limit before exposing existing mappings;
WordPress settings synchronization cannot mutate the SaaS-owned language set.
Because mappings depend on the source/target language relationship, any existing
mapping also locks source-language migration until the mapping is removed.
Independent simultaneous updates preserve omitted fields, and existing
oversized configurations can still be reduced or deleted. The authenticated
plugin runtime includes only mappings
belonging to its API key's project and currently active target languages.
WordPress applies a separate **256 KiB** serialized-option limit and keeps the
mappings in a dedicated, non-autoloaded
`deepglot_media_replacements` option.

During server-side target-language rendering, the plugin replaces matching
`img[src]`, `img[srcset]`, `img[data-src]`, and `img[data-srcset]` values, plus
`srcset` and `data-srcset` on `picture > source`. Literal Unicode and spaces in
rendered image paths are normalized to the same canonical representation as the
saved mapping. Valid responsive width and density descriptors are preserved,
including leading zeros and scientific notation; excluded subtrees are not
modified, and source-language pages remain unchanged. Document mappings rewrite
`a[href]`; MP4/WebM mappings rewrite `video[src]`,
`video[data-src]`, and direct `video > source[src|data-src]`; provider embed
mappings rewrite `iframe[src|data-src]`. A missing, deleted, unsupported, or
unsafe mapping leaves the original URL in place. Existing link text, download
attributes, video MIME hints, dimensions, and accessibility attributes remain
unchanged. Known WP Rocket, W3 Total Cache, LiteSpeed Cache, and WP Super Cache
page caches are purged site-wide after a changed runtime snapshot is applied.
Runtime settings refresh at most every **300 seconds** on a request that reaches
WordPress.
An upstream CDN or a full-page cache that blocks the refresh request still
requires an operator purge and public readback.

The dashboard provides mapping search and editing as described above. This feature
does not provide uploads, file storage, external CDN images, SVG, arbitrary embeds,
subtitles, transcoding, AI-generated media, or replacement in dynamically inserted
AJAX content. The separate translation workspace remains tracked by #257.
The [2026-09-28 WordPress media acceptance](docs/acceptance/media-wordpress-2026-09-28/README.md)
records production-dashboard mappings, authenticated runtime refresh, anonymous
DE/EN output, reachable neutral assets, WP Engine cache readback, editing,
deletion, and cleanup on an independent public test installation. The test
installation's original plugin was restored afterwards; customer production
upgrades and other cache hosts remain separately verified deployment steps.

**Production schema gate completed on 2026-09-04:** the exact Deepglot Neon
production branch (`prod`, database `neondb`) was inspected first. Only the
additive `ProjectMediaReplacement` table, its `Project(id)` foreign key with
update/delete cascade, its unique `(projectId, langTo, originalUrl)` constraint,
and its `(projectId, langTo)` index were applied in one transaction. A separate
catalogue read verified the seven expected columns, primary key, both indexes,
foreign key, cascade actions, and an empty table. No broad production
`prisma db push` was used.

## Optional page-view analytics


Real page-view analytics is disabled by default for every project and can only
be enabled or disabled by a project administrator. When enabled, the WordPress
plugin reports visits to translated pages independently of translation requests,
provider calls, dynamic-content translation, and full-page-cache misses. The
browser talks only to a same-origin WordPress endpoint; the plugin API key never
appears in frontend JavaScript.

Older `pageViewsEnabled` settings do not count as informed consent: existing
projects must explicitly enable the new feature after reviewing its data and
retention disclosure. A nullable `pageViewsConsentGrantedAt` timestamp records
that decision and is never backfilled from historical settings. Revoking the
feature clears the consent timestamp immediately.

Each event contains a normalized URL path without query parameters or fragments,
the target language, its collection timestamp, and a random one-time event ID.
Visitor IP addresses, user agents, referrers, cookies, fingerprints, and
persistent visitor identifiers are not stored in page-view analytics. Obvious
bots and duplicate event deliveries are ignored. A short-lived, page-specific
session-storage entry prevents immediate duplicate reports in the same tab.

Page-view events are retained for **90 days** and removed by the authenticated
daily retention job. Existing translation-request counters are never backfilled
or relabeled as visitor page views; they remain visible separately under
translation requests. Before deploying this feature to an existing environment,
review that exact environment's schema drift and apply only the additive
`ProjectSettings.pageViewsConsentGrantedAt` column and independent `PageView`
table/indexes before traffic reaches the new dashboard or ingestion route. Do
not use a broad schema push to apply unrelated existing drift merely to enable
page-view analytics.

## Translated URL slug management

Project managers can search original and translated URL slugs, filter by active language and mapping status, edit one target, or select visible rows for four-column CSV export and atomic reset. The existing CSV format also supports atomic reimport with line-specific conflict reports and a 5,000-row limit. Language-bound translators can view and export only their assigned active language; they cannot edit, reset, or import slug mappings.

WordPress applies a changed mapping on its next request-driven runtime-config refresh after the 300-second interval, or on forced settings sync. The new target becomes canonical after sync. An old translated target has no automatic historical redirect; site-level full-page caches may need a separate clear. See the [Issue 264 acceptance record](docs/acceptance/issue-264/slug-management.md) for routing and test details.

## WordPress plugin

The plugin lives in `wordpress-plugin/deepglot`. Repository version: **v0.12.15**; the public WordPress.org installer and GitHub release are now v0.12.15. The dashboard installer points to the verified public package. v0.12.15 adds bounded background source-page observations for the translation workspace, including complete cache-hit renders, while uncertain or stale observations remain unknown. v0.12.14 reports bounded URL-sync results and applies confirmed URL-operation cache invalidations. v0.12.13 adds per-target pause, visibility, automatic-translation controls, and safe removal in the SaaS lifecycle. That lifecycle runtime was published in WordPress.org v0.12.13; customer installations still need an update to receive the current v0.12.15 package. v0.12.12 changes plugin translation originals to US English and migrates bundled language catalogs, including AI-reviewed Swedish UI text. WordPress.org publication and catalog approval are separate steps. v0.12.11 adds explicit dashboard ownership for switcher settings with versioned WordPress synchronization and conflict visibility. v0.12.10 added document and video URL replacements as described above. v0.12.9 added project- and target-language-specific same-site media replacements with safe rewriting for server-rendered responsive and lazy-loaded images, consistent picture-source MIME hints, and no-translate plus configured class and ID exclusions. v0.12.8 translates generic ARIA labels in page content, image title tooltips, and human-readable RSS or Atom feed titles while excluding ordinary link metadata from provider requests. v0.12.7 makes the authenticated SaaS project authoritative for source language, target languages, automatic redirect, AI disclosure, and automatic-translation policy through one versioned runtime snapshot. WordPress shows source, targets, and redirect as read-only mirrors after sync, rejects REST writes to them, preserves valid bootstrap mirrors across a key change, continues serving existing cache hits when fresh generation is off, prevents target-URL caching of source-language fallbacks, and reconciles obsolete warm-up work after runtime language changes. v0.12.6 follows WordPress core post-type viewability so built-in public pages remain in the multilingual sitemap and URL-sync inventory while non-viewable builder content types, attachments, and non-queryable taxonomies stay excluded. v0.12.5 translates explicitly configured cookie-consent roots that render before the dynamic footer observer starts and localizes their internal links through the server-side routing rules without sending URLs to a translation provider. v0.12.4 preserves translated transient values containing emoji or other four-byte Unicode on legacy WordPress option tables through a separate versioned ASCII-safe key space, canonical Base64URL, and key-bound integrity checks. Existing plain-string cache entries remain readable. A provider result is complete only after exact cache readback; failed writes stay in the text and URL queues, do not purge the affected page, and keep inline responses out of full-page caches. v0.12.3 preserves background text and URL queues with the same Unicode constraint through a versioned, checksummed ASCII-safe storage envelope. Existing array queues migrate automatically, while damaged queue persistence fails closed, including during disabled cleanup. A separate short atomic lock couples text and purge-target mutations without surrounding provider calls; lease fencing prevents a stale owner from committing only one side. If a cold render cannot durably acquire that coupled queue state, its source-language response is marked non-cacheable so a later request can retry. v0.12.2 explicitly verifies one safe canonical redirect on the exact same origin and in the requested target language during URL synchronization, while automatic redirect following stays disabled. Publishing the GitHub release does not automatically update customer WordPress sites. The currently documented live deployment on `meinhaushalt.at` is **v0.12.1** from commit `3b914007`, deployed on 2026-08-10; the exact package/tree comparison, semantic configuration, 39-file PHP lint, canonical `?ver=0.12.1` browser asset, same-host HTTPS URL sync, public route smoke, WP Rocket purge, and cleanup all passed. This customer deployment is not evidence of a GitHub tag, GitHub release, WordPress.org publication, or automatic update channel.

The [WordPress.org directory entry](https://wordpress.org/plugins/deepglot/) and its downloadable installer are live at v0.12.15 (verified 2026-10-09); the matching [GitHub release](https://github.com/ostheimer/deepglot/releases/tag/wp-plugin-v0.12.15) provides the published package. The dashboard Setup page links to that directory and displays the version pinned in `src/lib/wordpress-installer.json`. CI verifies the public package against the GitHub release ZIP and checksum; [installation, upgrade, hashes, and release order](wordpress-plugin/deepglot/README.md#installation-in-wordpress) are documented with the plugin. The older `meinhaushalt.at` deployment described above remains a separate customer-site checkpoint, not proof that it has auto-updated to the directory version.

The v0.12.8 package treats empty and whitespace-only versioned or legacy cache values as misses and rejects new blank translations, preventing stale cache data from clearing translated metadata.

Metadata and accessibility attribute serialization also preserves raw ampersands,
quotes, and literal entity strings from fresh or cached translations, including
inline output and the visual editor. Installing that fix requires the exact
fixed plugin build and a targeted full-page-cache refresh; existing valid
translation-cache values remain usable.

Output-buffer source URL checks retain the canonical source path when URL
synchronization is configured. Signed sync tokens are validated against the
original localized URI; the control query is removed from the source URI without
changing ordinary query parameters or bypassing source URL exclusions.

v0.12.0 stops cold pages from blocking the visitor. Measured from the jobspot.at webserver on 2026-08-03, a translate request's own work is only ~1.4 s while the provider needs ~9 s before it returns anything, plus ~0.9 s per segment (50 segments = 40.5 s) — so no batch size is both worth sending and fast enough for a page load. The render path is now cache-only by default: uncached segments, plus anything that failed, are translated by a background WP-Cron job (`deepglot_max_sync_batches` restores inline translation on fast providers). Once the queue and its immediately due event are durable, Deepglot makes one non-blocking WP-Cron nudge in that request; it respects `DISABLE_WP_CRON` and never recurses from a cron run. On the SaaS side each request is split into concurrent provider calls, so response time tracks the slowest chunk instead of the whole page. Chunking reduces provider payload size and exposure, but it does not eliminate provider count mismatches; when every attempted provider returns a count mismatch for the same multi-text root chunk, Deepglot starts direct singleton isolation. It skips redundant binary intermediate shapes and retries each original text through the configured provider chain in input order. The provider-call ceiling is chain length × (chunk size + 1) for a multi-text root, while an original singleton gets one chain; a default eight-text chunk with two providers therefore allows at most 18 provider HTTP calls. All root chunks and isolated singletons share the request-wide provider-call concurrency cap (default 12) and a 100-second provider-work deadline below the 120-second route limit. PDF translation uses a route-specific 40-second provider-work ceiling measured from handler entry, so authentication, multipart parsing, and PDF preparation reduce the time left for providers and the 60-second route retains a nominal 20-second completion margin. Singleton, call-budget, and deadline failures remain terminal. Timeouts, authentication, rate limits, NUL output, and other malformed responses are never amplified by this isolation path. A failing parallel chunk also aborts sibling provider work before it can start new provider calls. Post-deploy acceptance must still inspect response completeness and provider logs rather than treating HTTP 200 as sufficient. Individual provider HTTP calls retain their own deadline (`TRANSLATION_PROVIDER_TIMEOUT_MS`, default 45 s).

v0.11.7 adds a fail-safe final translated-HTML filter for trusted site-specific localization such as language-specific media embeds. v0.11.6 bounds each translation request by both string count and 2,000 UTF-8 source bytes, so content-heavy cold pages use smaller parallel provider calls instead of timing out as one payload. v0.11.5 gives translation batches a bounded 60-second request window. v0.11.4 preserves numeric-looking source-slug mappings when the dedicated WordPress cache is read back, so established translated routes keep resolving after runtime synchronization. v0.11.3 hardens reciprocal canonical, hreflang, and multilingual sitemap output, redirects stale translated slugs to their current localized URLs, suppresses source-only Avada AJAX suggestions on target-language pages while preserving normal localized search and other semantic query requests, allows 30 seconds for translation batches, and fails over malformed provider responses instead of accepting partial results. v0.11.2 detects a revoked or invalid API key (HTTP 401), reports it in wp-admin instead of showing a green "active" state, and opens a short-lived circuit breaker so uncached pages stop re-sending every translation batch against a key the backend rejects. v0.11.1 preserves whitespace-prefixed action links, restores descriptive ISO-code switcher labels, and brings the package in line with WordPress.org Plugin Check. v0.11.0 added SaaS-managed translated URL slugs, bounded runtime-config refresh, request guards for WordPress infrastructure paths, and the refreshed Deepglot branding in WordPress settings and visual-editor controls. v0.10.4 prevents intermediary caches from preserving stale WordPress `robots.txt` responses. v0.10.3 makes the multilingual sitemap discoverable alongside Yoast SEO by appending its `robots.txt` line after Yoast's late renderer. v0.10.2 routes every DOM round-trip through `Support\HtmlDocument`, which makes `saveHTML()` emit raw UTF-8 instead of entity-escaping non-ASCII — the escaping corrupted emoji and umlauts inside `<style>` / `<script>`, where CSS and JS have no HTML entities. v0.10.1 excludes the switcher CSS from WP Rocket's "Remove Unused CSS"/minify pipelines so emoji flags survive on translated pages. v0.10.0 added independent switcher instances, versioned templates, safe visual placement, real AMP option enforcement, and a validated multilingual sitemap. v0.8.6 added rollback of plugin-side fresh-word reservations after failed SaaS calls. Earlier v0.8.x releases added the dynamic-content translator, fixed runtime-sync races, stopped bots from consuming fresh quota, surfaced quota exhaustion, and prevented cache-only bot identity responses from poisoning the local translation cache. See `wordpress-plugin/deepglot/README.md`, `ROADMAP.md`, and `HANDOFF.md` for the implementation, test, deployment, and live-verification boundaries.

v0.12.0 operational semantics:

- The first cold target-language view can intentionally render source content; it queues missing segments and returns without waiting for the provider.
- WP-Cron claims the bounded queue atomically, keeps failed or partial results pending, preserves work enqueued during a run, and applies one total timeout budget to sequential fallback requests.
- Successful warming stores translations locally and purges completed URLs from WP Rocket, W3 Total Cache, and LiteSpeed Cache. WP Super Cache exposes only a global purge, so Deepglot waits until the tracked URL queue is empty; pages that are still pending stay cached. Hosts with `DISABLE_WP_CRON` must invoke WordPress cron themselves; unsupported page-cache plugins may require a manual purge.
- Administrators can explicitly preview and confirm a bounded sitemap URL synchronization from `Settings -> Deepglot` or the authenticated `/wp-json/deepglot/v1/url-sync` routes. Each immutable batch contains at most 250 safe internal target URLs, opens at most two pages per cron run, respects queue and API-rate-limit backpressure, and supports status, pause, resume, cancellation, and failed-only retry. When WordPress recognizes a safe HTTPS request on the same host as an internal target still stored with HTTP, the preview changes only that target's scheme to HTTPS; semantic query parameters and fragments are preserved. It never copies a foreign request host. One absolute, query-free redirect on the exact same origin and in the requested target language is verified through separate public and origin probes while automatic redirect following stays disabled. Other redirects remain bounded failures. A source offset continues large sites in bounded batches. It is not a permanent crawler.
- Project managers can preview and confirm per-URL retranslation or deletion in the SaaS URL inventory. Retranslation refreshes at most 250 exclusively associated, unreviewed machine segments per confirmed step through the normal provider, quota, velocity and billing path; the preview shows exact billable words and current monthly usage and limit. Larger URLs report their full eligible count and offer another bounded, separately confirmed step. Shared, manual, reviewed and glossary-protected translations are retained. Final deletion removes the URL inventory row, its exclusive machine translations and this URL's context links, while preserving historic usage and batch records. Ten visible URLs can be processed sequentially with individual results. A pending unknown provider outcome blocks further mutation until its billing and persistence evidence is reconciled; a committed usage receipt supports replay without a second provider call. Digest-only invalidation events remove affected WordPress text transients on the next runtime refresh. The WordPress URL synchronizer reports actual completed or failed attempts and observed HTTP status to the SaaS inventory. Older visits have no inferred HTTP or sync result. The dashboard's error filter links to WordPress's bounded failed-only retry; full-page cache rebuild and public verification remain separate.
- A completed URL-synchronization job confirms that the WordPress-origin queue has drained. Operators must still purge unsupported full-page caches and verify a query-free public target-language response.
- Visual-editor previews and WooCommerce HTML emails remain synchronous because these one-off outputs cannot converge on a later request.

Features:

- Visual exclusion selection for project managers: load bounded public server-rendered HTML from a path on the configured project host, click an element with a unique ID or class on that preview page, and save the literal token through the existing exclusion API. The rule applies project-wide after the next settings sync on WordPress plugin version 0.12.12 or later. The script-free preview follows no redirects and has an eight-second deadline and 1 MiB response cap; it does not support arbitrary CSS selectors or a page-only rule. See `docs/exclusion-visual.md`.
- PHP autoloader and lightweight service container
- URL language resolver and request router (path-prefix and subdomain routing)
- OutputBuffer + HTML translator using DOMDocument — no external PHP dependencies
- Optional client-side dynamic-content translator: a MutationObserver re-translates AJAX / infinite-scroll / SPA content added after page load through a same-origin REST proxy (`POST /wp-json/deepglot/v1/translate-dynamic`); opt-in via `enable_dynamic_translation`, cache-first (a missing nonce never spends quota), and SEO-safe because the server pass still renders the initial crawlable HTML
- JSON-LD and accessibility attribute translation, including cached Recipe ingredients/instructions and target-language page/breadcrumb identities with consistent graph references while shared entity and media IDs stay stable
- Deepglot API client (HTTP requests to the Next.js backend)
- WordPress transient-based translation cache (no custom table needed)
- Link rewriter (`<a>`, `<form>`, `<link rel=canonical>`)
- Explicit, project- and target-language-scoped replacement of same-site
  images, document links, self-hosted video, and supported video embeds in
  server-rendered HTML
- hreflang SEO tags and `<html lang>` switching
- Independent language switchers: named shortcode/block/widget/automatic instances, safe legacy migration, 5 flag styles, list/dropdown mode, fixed/floating or validated selector placement, per-language custom flags, responsive hide, three versioned templates, and a same-origin visual placement preview
- Gutenberg block for language switcher
- Classic widget for language switcher
- WordPress nav-menu integration
- Admin settings page with 7-section tab UI (General, Language Model, Switcher, Exclusions, Setup, WordPress Settings, Members)
- Guided 3-step setup wizard on first activation
- REST API v1 at `/wp-json/deepglot/v1/` for WordPress-owned settings CRUD, read-only SaaS project mirrors, status, and test-connection; writes to source language, target languages, and automatic redirect return an explicit ownership conflict
- WooCommerce order email translation
- Browser-language auto redirect with bot-detection skip, cookie preference, and admin/feed context guards
- AMP translation option enforced before runtime sync, cache, and provider work
- Multilingual sitemap at `/deepglot-sitemap.xml` with validated internal source/target/`x-default` alternatives and `robots.txt` discovery
- Operator-triggered sitemap URL synchronization with a fixed snapshot, hard URL limits, queue backpressure, retry/backoff, and automatic pauses for exhausted quota or an invalid API key
- Subdomain support (`de.example.com`) (implemented; live QA pending — requires `DEEPGLOT_PHASE6_SUBDOMAIN_HOST`)
- Bot detection via dedicated `BotDetector` class (UA → BotType mapping); bot traffic served cache-only to prevent quota burn
- Word quota exhaustion alerts: wp-admin notice, dashboard warning banner (≥90%/100%), proactive email to the organization owner when 90% or 100% of the monthly word limit is reached
- Opt-in weekly workspace activity digest with new-translation, manual-edit, and translation-request totals; quiet weeks are skipped and retry-safe delivery claims prevent duplicate emails
- Optional notification preferences for product updates (monthly), project notices (weekly), and billing summaries (monthly) are stored per user and workspace and default to off. `GET/PATCH /api/user/notification-preferences` reads and updates the current member's own settings. Billing preferences require an owner or admin. These categories have no event producers yet; enabling one does not currently send email. The existing weekly activity digest and mandatory account/security messages are separate.
  The additive SQL and target-specific Preview/Production verification procedure are in `scripts/sql/notification-preferences.sql` and `docs/acceptance/issue-268/README.md`.
- Quota probe via `quota_probe: true` in status/test-connection pings; `quota_exhausted` response stops dynamic translation
- 58 PHP fixtures plus the dynamic-translator and visual-switcher JavaScript regressions, covering URL resolution, HTML parsing, link rewriting, JSON-LD, accessibility attributes, browser redirect, independent switchers, AMP, multilingual sitemap, controlled URL synchronization, synchronous WooCommerce email/editor output, bounded background warming, cache purges, request deadlines, caching, exclusions, metadata, routing, REST API quota status, dynamic translation, runtime-config races, and bot cache-poisoning prevention

Run the full WordPress suite locally:

```bash
npm run test:wp
```

Deepglot finishes all bounded root-chunk attempts before starting singleton work. It collects only roots whose complete provider chains produced count mismatches; any other terminal error still aborts siblings immediately. Before calibration, Deepglot compares the remaining deadline with a conservative one-wave reserve: the fastest elapsed duration among the completed full count-mismatch root chains. If that reserve cannot fit, no singleton provider call starts. This root-derived reserve is used only for calibration admission and is never extrapolated across later work. It then runs one global calibration wave containing the first `min(request-wide concurrency, total mismatched texts)` real singletons through their full provider fallback chains and retains its results. If the shared deadline expires during any admitted singleton wave despite the admission checks, Deepglot returns the same typed deadline error instead of a generic timeout. The remaining work is split into request-wide bounded waves. Before each later wave, Deepglot compares `waves still pending × duration of the immediately preceding observed singleton wave` with the remaining shared deadline and remeasures after every completed wave. That deadline is the earlier of the local provider-work ceiling and the caller's monotonic absolute deadline; the PDF route passes its route-entry 40-second deadline so authentication, upload handling, and preparation consume the same budget. If the pending work cannot fit, Deepglot stops after the last retained wave and before any further singleton call. `/api/translate` and PDF return the stable 503 code `translation_count_mismatch_deadline`; `/api/translate` retains an idempotent same-key 503 for at most 60 seconds. Otherwise, the remaining affected texts continue through the same globally bounded singleton queue, preserving result order and each text's full provider fallback chain. Only the final pre-provider configuration gate may release an exact API reservation. Once a provider call starts, both API and PDF translation retain the reservation conservatively, even when the provider or later persistence fails.

## Deployment

The app is deployed on Vercel. For a local production check:

```bash
npm run build
```

For self-hosting with Docker Compose, see [SELFHOSTING.md](SELFHOSTING.md).

## CI / CD

The repository now uses `.github/workflows/ci-cd.yml` plus Vercel's native Git integration with this branch and environment mapping:

- Local development: Vercel `Local` / `Development` variables + Neon `preview`
- Any pushed non-`main` branch: GitHub Actions verify job, then Vercel `Preview` deploy + Neon `preview`
- `main`: GitHub Actions verify job, then Vercel `Production` deploy + Neon `prod`

Recommended database topology:

- Neon branch `preview`: used by Vercel `Development` and `Preview`
- Neon branch `prod`: used only by Vercel `Production`

The verification stage currently runs:

- `npm run check:docs-language`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e`

Required Vercel configuration:

- set `DEEPGLOT_DATABASE_URL` in `Development` and `Preview` to the Neon preview branch, and in `Production` to the Neon production branch (static 2-dataset topology; the app resolves `DEEPGLOT_DATABASE_URL` first and falls back to `DATABASE_URL` only for self-host/local setups)
- keep the repository connected to Vercel Git deployment so non-`main` pushes create Preview deployments and `main` creates Production deployments
- enable automatic exposure of Vercel system environment variables so Preview and Production deployments can fall back to `VERCEL_BRANCH_URL`, `VERCEL_URL`, and `VERCEL_PROJECT_PRODUCTION_URL`

**Setting up the Neon production branch (Variant A: 2 branches)**

**Option A – Neon CLI (recommended)**  
From the repo root, create the `prod` branch and print connection strings:

```bash
export NEON_API_KEY=neon_...   # Create at https://console.neon.tech → Account → API keys
./scripts/neon-create-prod-branch.sh
```

The script creates branch `prod` from `main` (if missing), prints `DATABASE_URL` and `DATABASE_URL_UNPOOLED`, and reminds you to run `prisma db push` and set the variables in Vercel Production.

**Neon restore drill**

Dry-run the restore drill without creating a branch:

```bash
npm run acceptance:neon -- --env-file .env.production.local
```

Create a temporary restore-drill branch from `prod`, validate that the cloned schema is reachable, and let Neon auto-expire it after 24 hours:

```bash
export NEON_API_KEY=neon_...
export NEON_PROJECT_ID=...
npm run acceptance:neon -- --env-file .env.production.local --create
```

This script creates only a temporary child branch and never writes to `prod`.

**Plan schema acceptance**

Check a configured database for all canonical `Plan` enum values and verify that no `Organization` or `Subscription` rows still use the deprecated `PROFESSIONAL` alias:

```bash
npm run acceptance:plan-schema -- --env-file .env.development.local
npm run acceptance:plan-schema -- --env-file .env.production.local
```

The guard uses `DEEPGLOT_DATABASE_URL` first and falls back to `DATABASE_URL`. It runs only read-only catalog and aggregate count queries. Its output includes the database hostname, observed enum values, and row counts, but never the connection credentials. CI runs the same guard against its local PostgreSQL database after `prisma db push`; run it separately against shared Neon environments to detect environment-specific schema drift.

**Target schema acceptance**

Compare the configured database with `prisma/schema.prisma` before treating an environment as ready:

```bash
npm run acceptance:target-schema -- --env-file .env.preview.local
```

The check runs Prisma's read-only `migrate diff` from the live database to the target schema. It reports pending table, column, index and constraint statements separately, and fails on any unclassified SQL. Raw SQL and connection credentials are withheld from its output. A missing or unreachable database blocks acceptance. CI runs this check after preparing its isolated PostgreSQL database; Vercel Preview and Production builds run it against their own configured database before `next build`. A green isolated CI database does not establish that the shared Preview or Production schema is current. Apply only reviewed, environment-specific migrations, then rerun the check; the acceptance command itself never applies SQL.

On 2026-09-24, Vercel Preview was verified to use Neon `main` (`neondb`), while Production used the separate `prod` branch. The narrowly scoped, rerunnable Preview repairs are [`scripts/sql/preview-missing-tables.sql`](scripts/sql/preview-missing-tables.sql) and [`scripts/sql/preview-runtime-sync-media.sql`](scripts/sql/preview-runtime-sync-media.sql). They were tested twice on a schema-only Preview clone, then applied twice to the verified Preview branch. Readback confirmed all four tables, their columns, indexes, primary keys and cascading foreign keys, plus the three runtime-sync columns. The full target-schema check passed with no pending statements, and the Preview database idempotency integration suite passed all three cases; its synthetic rows were removed. No Production schema was changed by this repair.

**Option B – Neon Console**  
1. In the [Neon Console](https://console.neon.tech), open **Branches** and create a branch named `prod` with parent `main`.
2. Open the `prod` branch and copy both connection strings: **Connection string** (pooled) → `DATABASE_URL`, **Session mode** (unpooled) → `DATABASE_URL_UNPOOLED`.
3. Apply the schema once:  
   `DATABASE_URL="<prod-pooled-url>" npx prisma db push`
4. In Vercel → Settings → Environment Variables, set **Production** only: `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to the `prod` URLs. Leave Development and Preview unchanged.
5. Redeploy Production and verify the app uses the prod database.

Recommended environment matrix:

- `Development`
  - set `AUTH_URL=http://localhost:3000`
  - set `NEXT_PUBLIC_APP_URL=http://localhost:3000`
  - set `TRANSLATION_PROVIDER=mock` unless a dedicated development provider key is available
  - point both database URLs to Neon `preview`
- `Preview`
  - do not hardcode `AUTH_URL` or `NEXT_PUBLIC_APP_URL` to `localhost`
  - set `TRANSLATION_PROVIDER=mock` unless Preview should spend real provider credits
  - point both database URLs to Neon `preview`
- `Production`
  - set `AUTH_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL` to the canonical production domain
  - set `TRANSLATION_PROVIDER=openai`
  - set `OPENAI_TRANSLATION_MODEL=gpt-5-mini`
  - point both database URLs to Neon `prod`

Stripe acceptance can be checked without creating charges:

```bash
npm run acceptance:stripe -- --mode test --env-file .env.local --env-only
npm run acceptance:stripe -- --mode live --env-file .env.production.local
```

The live check reads configured prices and webhook endpoints from Stripe. It does not create customers, subscriptions, checkout sessions, or payments.

If the Vercel `Development` values are placeholders or missing, local development can temporarily run against a local PostgreSQL-compatible database instead.

Manual `vercel deploy` runs should never upload local `.env*` files. The repository therefore keeps a `.vercelignore` file that excludes local environment files from ad-hoc deployments.

Production alias policy:

- `deepglot.ai` is canonical.
- `www.deepglot.ai` redirects page traffic to `deepglot.ai`.
- The active Vercel Production deployment host redirects page traffic to `deepglot.ai`.
- Vercel Preview and branch deployment URLs remain reachable for PR QA.
- Additional production-only aliases can be configured with `DEEPGLOT_CANONICAL_REDIRECT_HOSTS`.

After each deployment, verify the current production URL and deployment status.

Production acceptance is tracked in [PRODUCTION_ACCEPTANCE.md](PRODUCTION_ACCEPTANCE.md). After a production deployment, run the repeatable smoke test:

```bash
npm run smoke:production
```

For the full non-destructive acceptance wrapper, use:

```bash
npm run acceptance:production
npm run acceptance:production -- --json output/production-acceptance.json --junit output/production-acceptance.xml
```

The wrapper runs production smoke, Neon dry-run/readiness, Stripe env/API readiness, rate-limit config checks, and webhook processor readiness. It exits successfully when only external live checks are blocked by missing credentials; add `--strict` to make blocked or skipped checks fail CI.

## Self-hosting

Deepglot now includes a first self-hosted setup:

- `Dockerfile` builds the Next.js app for production use.
- `docker-compose.yml` starts the app together with PostgreSQL.
- `.env.selfhost.example` provides a dedicated self-hosting environment template.
- `scripts/docker-entrypoint.sh` waits for PostgreSQL, runs `prisma db push`, and starts the app.

Quick start:

```bash
cp .env.selfhost.example .env.selfhost
openssl rand -base64 32
# paste the secret into .env.selfhost as AUTH_SECRET
docker compose up --build -d
```

The full installation guide lives in [SELFHOSTING.md](SELFHOSTING.md).

## Environment variables

For server-side return URLs such as the Stripe Billing Portal:

- `AUTH_URL` is the primary base URL.
- `NEXT_PUBLIC_APP_URL` is used as a fallback when `AUTH_URL` is not set locally.
- On Vercel, the app can also fall back to system deployment URLs for Preview and Production environments.

## Translation providers

AI provider spending has a separate, explicit owner approval gate. An organization OWNER prepares both organization and project monthly caps, per-call caps, exact model/provider allowlists, and expiring conservative price ceilings in Project Settings → Language model → AI budget. `AI_BUDGET_ENFORCEMENT` defaults to `off`: preparation is readable but current provider calls continue unchanged and are not metered by this ledger. A later explicit server-side `on` deployment enforces all approved limits, with no legacy exception or automatic approval; missing or stale approval then blocks fresh provider calls. Plan word quotas do not grant provider spending. `POST /api/projects/{projectId}/ai-budget` returns a read-only ceiling estimate and reports whether it is only an activation preview. Under active enforcement, dispatch reserves atomically and settles provider usage separately. Projects with in-flight or unresolved provider work cannot be deleted or transferred; settled spend remains charged to the original organization after project deletion or transfer. Transfer clears the source project policy so the destination OWNER must approve a new one. AI budgets do not purchase credits, increase their own limits, or trigger paid media generation. The separately owner-approved automatic subscription upgrade (#269) can raise a plan's word quota but does not approve or increase an AI budget. See [AI budget governance](docs/ai-budget-governance.md) for units, retry/unknown usage behavior, retention, schema rollout, and the existing-customer activation gate.

The translation flow uses a provider abstraction:

- `TRANSLATION_PROVIDER` accepts `openai`, `openrouter`, `ollama`, `openai-compatible`, `deepl`, `gemini`, or `mock`.
- Without an explicit `TRANSLATION_PROVIDER`, the app auto-selects by the first credential present, in this order: `gemini` (`GEMINI_API_KEY`) → `openai` (`OPENAI_API_KEY`) → `openrouter` (`OPENROUTER_API_KEY`) → `deepl` (`DEEPL_API_KEY`) → `ollama` (`OLLAMA_BASE_URL`), otherwise `mock` in `development` and `test`.
- `OPENAI_TRANSLATION_MODEL` controls the model for the OpenAI provider (current production default: `gpt-5-mini`).
- `GEMINI_API_KEY`, `GEMINI_TRANSLATION_MODEL`, and `GEMINI_BASE_URL` configure the Gemini provider (default model: `gemini-3.1-flash-lite` — the stable id; never point the default at a `-preview` alias, Google retires those once the stable ships).
- `OPENROUTER_API_KEY` and `OPENROUTER_TRANSLATION_MODEL` configure the OpenRouter gateway.
- `OLLAMA_BASE_URL` and `OLLAMA_TRANSLATION_MODEL` configure a local Ollama instance.
- `TRANSLATION_API_KEY`, `TRANSLATION_BASE_URL`, and `TRANSLATION_MODEL` are generic overrides for `openai-compatible` gateways.
- `mock` is intended for local development and tests and returns visibly marked output instead of real translations.
- The database schema includes `TranslationSource.GOOGLE` as a reserved source identifier. Google Translate is not currently available as a `TRANSLATION_PROVIDER` value and is not configurable via environment variables.
- Projects on the Pro plan and above can store their own encrypted provider API key; set `DEEPGLOT_SECRET_ENCRYPTION_KEY` to enable at-rest encryption for per-project keys.

### Fallback provider configuration

When the primary provider fails with quota exhaustion, a rate limit (429), a server error (5xx), a supported connection-level failure such as `ETIMEDOUT`/`ECONNRESET`, or an invalid provider-response contract, Deepglot automatically tries the configured fallback chain. Auth errors, validation errors, and other 4xx failures propagate immediately. If every attempted provider returns only a count mismatch for the same multi-text chunk, the bounded isolation described above runs after the chain is exhausted; other failure classes never enter that split path.

- `TRANSLATION_FALLBACK_PROVIDERS` accepts a comma-separated list of provider names (e.g. `gemini,openai`).
- Default fallback chain when the variable is unset: `gemini,openai` — these providers are only included if they have valid API credentials configured; unconfigured providers are silently skipped (defined in `src/lib/translation-config.ts`).
- Example: set `TRANSLATION_FALLBACK_PROVIDERS=openai,deepl` to fall back to OpenAI first, then DeepL.
- Terminal failures (the last provider in the chain fails, or a non-failover error occurs) are logged at error level with the failing provider and the attempted chain; recoverable hops are logged as warnings.

### TranslationSource database values

The `TranslationSource` enum is a coarse provider bucket, not a precise per-request audit trail. The stored value reflects the initially selected provider, not the provider that actually served the response after a fallback:

- `TranslationSource.DEEPL` — written only when the selected provider is DeepL.
- `TranslationSource.MOCK` — written only when the mock provider is active.
- `TranslationSource.OPENAI` — written for **all other providers**: OpenAI, Gemini, OpenRouter, Ollama, and `openai-compatible`. The persistence layer only distinguishes `deepl` / `mock` / everything-else, so querying this value does not tell you which of those providers was actually used.
- `TranslationSource.GOOGLE` is reserved in the schema but is not actively written by any current provider. It does not correspond to any configurable `TRANSLATION_PROVIDER` value.

### Supported translation languages

The canonical language list lives in `src/lib/supported-languages.ts` and is the single source for the public endpoints (`GET /api/public/languages`, `GET /api/public/languages/is-supported`) and any documentation claim — `supported-languages.test.ts` pins the counts and keeps the dashboard picker within the list.

- **33 languages** are offered by the product and served by the default AI providers (OpenAI, Gemini, OpenRouter, Ollama, openai-compatible).
- **30 of them** are additionally guaranteed on every configurable provider, including the narrowest (DeepL-class); the three EU additions `hr`, `ga`, and `mt` carry `sharedAcrossProviders: false` and may be unavailable when an organization pins such a provider.
- The dashboard language picker offers a curated EU-focused subset (`EU_LANGUAGE_CODES`), which is always a subset of the canonical list.
- Weglot-parity context (#123): Weglot advertises 110+ languages; Deepglot deliberately documents the verified cross-provider set instead of an unverifiable ceiling — LLM providers accept far more codes, but only the canonical list is enforced and tested.

## Test login and demo workspace

The app now includes an instant test login for local work and Preview deployments:

- enabled automatically in local development
- enabled automatically on Vercel Preview
- disabled by default on Production
- optionally overrideable via `DEEPGLOT_ENABLE_TEST_LOGIN=true|false`

On the first test login, the app automatically provisions a shared test user, a test workspace, and a demo project with sample data for the dashboard, activity feed, page views, and project subpages.

## Project pages

Project pages now support these additional flows:

- API keys can be created directly under `Setup` and `API Keys`
- the full API key is shown exactly once after creation
- page views can be enabled under `Stats -> Page views`
- the visual editor opens a real target URL with `deepglot_editor=1`
- **Security note:** the visual-editor session token is currently passed in the launch URL as `?deepglot_editor_token=…`. Moving it out of the URL requires a coordinated WordPress-plugin change and is tracked as a known limitation (see PR #98).

## i18n automation scripts

Four scripts under `scripts/` automate i18n maintenance tasks:

- `scripts/i18n-codemod-api-copy.ts` — codemod for migrating API copy strings to i18n keys
- `scripts/i18n-codemod-simple-copy.ts` — codemod for migrating simple inline copy strings to i18n keys
- `scripts/i18n-generate-static-messages.ts` — generates static message catalogues for all supported locales
- `scripts/i18n-generate-wordpress-plugin-languages.ts` — generates WordPress `.pot`/`.po` language files for the plugin from the shared i18n source

## Test coverage

The current lightweight test suite covers:

- Auth.js-safe user normalization in `src/lib/auth-user.ts`
- existing-account-only passkey enrollment and ownership-bound revocation in `src/lib/passkey-provider.test.ts` and `src/lib/passkey-management.test.ts`
- auth redirect rules in `src/lib/route-access.ts`
- locale path mapping, canonical route generation, and legacy redirects in `src/lib/site-locale.ts`
- billing portal return URL resolution in `src/lib/billing.ts`
- Neon-vs-local database adapter detection in `src/lib/database-url.ts`
- optional GitHub/Google provider activation in `src/lib/oauth-provider-config.ts`
- test-login environment gating and defaults in `src/lib/test-login-config.ts`
- project and visual-editor URL generation in `src/lib/project-url.ts`
- translation provider selection and mock translations in `src/lib/translation.ts`
- markdown documentation language checks in `src/lib/docs-language.ts`
- ops and production acceptance readiness checks in `src/lib/ops-acceptance.test.ts`
- Phase 6 acceptance config, URL builders, and blocked-check classification in `src/lib/phase-6-acceptance.test.ts`
- SaaS acceptance config, payload builders, and failure classification in `src/lib/saas-acceptance.test.ts`
- settings-area API route authorization guardrail (management gate on all management methods) in `src/lib/project-settings-route-authz.test.ts`
- translations language page management gating (AddLanguageDialog only for managers) in `src/lib/project-language-page-authz.test.ts`
- password reset flow in `src/lib/password-reset.test.ts`
- project invitation token lifecycle in `src/lib/project-invitations.test.ts`
- end-to-end locale switching, query preservation, legacy German redirects, and locale-aware auth redirects via Playwright in `tests/e2e/locale-routing.spec.ts`
- end-to-end account settings flows via Playwright in `tests/e2e/account-settings.spec.ts`
- English and German virtual-authenticator passkey registration, passwordless login, revocation, revoked-credential rejection, and anonymous-enrollment blocking via Playwright in `tests/e2e/passkey-auth.spec.ts`
- full UI navigation audit via Playwright in `tests/e2e/full-ui-audit.spec.ts`
- phase 6 dashboard features (glossary, import/export, analytics, webhooks, visual editor) via Playwright in `tests/e2e/phase-6-dashboard.spec.ts`
- project settings accessibility via Playwright in `tests/e2e/project-settings-accessibility.spec.ts`
- translation provider settings via Playwright in `tests/e2e/provider-settings.spec.ts`
- subscription usage accessibility via Playwright in `tests/e2e/subscription-usage-accessibility.spec.ts`
- pricing slider alignment regression (drives `pricing-grid.tsx` through every `BILLING_PLAN_KEYS` index and asserts the thumb centre is within ±2 px of the active tick label) via Playwright in `tests/e2e/pricing-slider-alignment.spec.ts`
- marketing copy anti-drift guard (asserts `BILLING_PLANS` wiring in the marketing home component, allowlists competitor-comparison EUR tokens, and fails on any hardcoded EUR amount or word-count literal that collides with a real plan price) in `src/lib/marketing-home-drift-guard.test.ts`
- Stripe webhook subscription-lifecycle smoke (trigger `customer.subscription.deleted`, `customer.subscription.updated`, and `invoice.payment_failed`, assert `Subscription.status`, `plan`, `wordsLimit`, and the `getEffectiveWordsLimit` FREE soft-cap for non-ACTIVE statuses) run via `npm run smoke:stripe-webhooks` in `scripts/stripe-webhook-smoke.ts`

### WordPress plugin PHP test suite

The plugin test suite (`wordpress-plugin/deepglot/tests/`) contains 28 PHP unit test files plus one JS asset test, all run via `npm run test:wp`:

| Test file | What it covers |
|---|---|
| `AccessibilityAttributeTranslationTest.php` | Translation of ARIA and accessibility attributes |
| `BlockRenderTest.php` | Gutenberg block rendering for the language switcher |
| `BotCachePoisoningTest.php` | Guard against bot-visit identity mappings poisoning the WP translation cache for later human visitors |
| `BotDetectorTest.php` | Bot-traffic detection to skip unnecessary translation |
| `BrowserRedirectorTest.php` | Browser-language auto-redirect logic and guard conditions |
| `ClientSettingsSyncTest.php` | Sync of admin settings to the client-side JS config object |
| `DynamicTranslationControllerTest.php` | REST endpoint for client-side dynamic-content translation |
| `ExclusionsTest.php` | CSS-selector and URL exclusion rules |
| `HtmlLangSwitchTest.php` | `<html lang>` attribute switching per active language |
| `JsonLdTranslationTest.php` | JSON-LD string translation plus consistent target-language page/breadcrumb graph references and stable shared/media IDs |
| `LanguageSwitcherAriaTest.php` | ARIA attributes on the language switcher widget |
| `LanguageSwitcherRenderingTest.php` | HTML output of the language switcher (all modes and styles) |
| `LinkRewriterTest.php` | Link rewriting for `<a>`, `<form>`, and `<link rel=canonical>` |
| `MetadataTranslationTest.php` | `<title>`, `<meta description>`, and OG tag translation |
| `NavMenuSwitcherTest.php` | WordPress nav-menu integration for the language switcher |
| `ParallelBatchesTest.php` | Parallel batching of translation API requests |
| `RestApiQuotaStatusTest.php` | REST endpoint for quota/status health checks |
| `RuntimeConfigRaceTest.php` | Race-condition guard for runtime admin-settings sync (v0.8.1 fix) |
| `SiteRoutingTest.php` | Path-prefix and subdomain routing modes |
| `SwitcherCustomFlagsTest.php` | Per-language custom flag image support |
| `SwitcherJsAriaTest.php` | JS-driven ARIA state updates on the switcher |
| `SwitcherResponsiveHideTest.php` | Responsive-hide CSS class behavior |
| `SwitcherSettingsTest.php` | Admin settings round-trip for all switcher options |
| `TranslationCacheTest.php` | WordPress transient-based translation cache |
| `TranslationRulesTest.php` | Per-language translation rule evaluation |
| `UrlLanguageResolverTest.php` | URL language prefix detection and resolution |
| `WidgetRenderTest.php` | Classic widget rendering for the language switcher |
| `WooCommerceEmailTranslatorTest.php` | WooCommerce order email translation |
| `DynamicTranslatorAssetTest.js` | MutationObserver / client-side dynamic translator (JS) |

## Plans and billing tiers

Deepglot uses a `Plan` enum in the database schema with the following values:

- `FREE` — default plan for new users
- `STARTER`, `BUSINESS`, `PRO`, `ADVANCED`, `EXTENDED` — active paid billing tiers
- `ENTERPRISE` — active tier with custom pricing; limits are 20 million words, 50 languages, and 100 projects; excluded from self-serve plan switching in the dashboard
- `PROFESSIONAL` — deprecated; normalized to `PRO` by `resolveBillingPlanKey()`

Active plan limits and prices are configured in `src/lib/billing-plans.ts`. Stripe price IDs are supplied via `STRIPE_PRICE_*` environment variables (e.g. `STRIPE_PRICE_STARTER_MONTHLY`).

## Documentation guardrail

- Run `npm run check:docs-language` to verify that Markdown documentation stays in English.
- The CI / CD workflow also runs the same check automatically on pushes and pull requests.
