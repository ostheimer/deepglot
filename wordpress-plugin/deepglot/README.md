# Deepglot WordPress Plugin

This directory contains the Deepglot WordPress plugin (**v0.12.8**). It captures the rendered HTML via output buffering, translates it through the Deepglot API, rewrites internal links, and injects SEO metadata — plus an opt-in client-side layer for dynamically loaded content. See the [repository README](https://github.com/ostheimer/deepglot/blob/main/README.md) for the full feature list.

v0.12.8 translates generic ARIA labels in page content, image title tooltips, and human-readable RSS or Atom feed titles. The dynamic-content pass applies the same attribute rules with request deduplication, while ordinary link metadata remains excluded from translation-provider requests. Empty and whitespace-only translations are rejected on cache writes and reads, including legacy plain-string entries, so a stale blank value cannot remove translated metadata.

v0.12.7 consumes project-wide source language, target languages, automatic redirect, AI disclosure, and automatic-translation policy as one authenticated, versioned SaaS snapshot. The WordPress admin displays source, targets, and redirect as explicit read-only mirrors after that snapshot, while a key or backend change keeps valid bootstrap values until the new project readback arrives. The settings REST API exposes those mirrors for reads but rejects writes. Disabling fresh automatic translation still permits local and SaaS cache hits, including dynamic content; identity fallbacks under target URLs are non-cacheable, and runtime language changes prune only obsolete warm-up state.

v0.12.6 follows WordPress core post-type viewability so built-in public pages remain in the multilingual sitemap and URL-sync inventory while non-viewable builder content types, attachments, and non-queryable taxonomies stay excluded. v0.12.5 translates explicitly configured cookie-consent roots that already exist before the footer observer starts, without rescanning normal server-rendered content. Internal page links in those dynamic roots are localized through the same server-side routing semantics and URLs never enter provider translation requests. v0.12.4 stores translated transient values in a separate, versioned ASCII-safe key space with canonical Base64URL and a key-bound checksum. Existing plain-string cache entries remain readable. A provider result is complete only after an exact cache readback; failed writes stay in both background queues, do not purge the affected page, and keep inline responses out of full-page caches. v0.12.3 stores background text and URL queues in a versioned, checksummed ASCII-safe envelope. Valid Unicode, including emoji, therefore remains durable on legacy WordPress option tables that cannot store four-byte UTF-8 directly. Existing array queues migrate automatically, while damaged persistence fails closed and is not silently replaced or deleted during disabled cleanup. A separate short atomic lock couples text and purge-target mutations; lease fencing prevents stale owners from committing only one side, and provider requests remain outside that lock. If a cold render cannot durably acquire the coupled state, the source-language response is marked non-cacheable so a later request can retry. v0.12.2 lets URL synchronization explicitly verify one safe canonical redirect on the exact same origin and in the requested target language. Automatic redirect following remains disabled, and all other redirects stay in the bounded error path. This repository state prepares the package only; it is not evidence of a tag, WordPress.org publication, customer installation, or live acceptance.

v0.12.0 stops ordinary page renders from waiting on fresh translations: uncached or failed segments enter a bounded background WP-Cron queue, and supported full-page caches are purged after the local translation cache is warm. Administrators can preview and confirm an immutable batch of up to 250 safe internal sitemap URLs from `Settings → Deepglot`; the job can be monitored, paused, resumed, cancelled, or retried for failed URLs and is not a permanent crawler. The first cold view can show source content; a later view converges after cron succeeds. Once a queue mutation and immediately due event are durable, Deepglot makes at most one non-blocking WP-Cron nudge in that request. It respects `DISABLE_WP_CRON` and active cron contexts, so system-cron sites and cron runs never receive a recursive loopback. The warmer retains the localized public request URL even after request routing rewrites the path internally. WP Rocket, W3 Total Cache, and LiteSpeed Cache purge completed URLs individually; WP Super Cache is global and waits until the tracked queue has fully drained so pending pages stay cached. A completed URL-sync job still requires a query-free public target-language check, and unsupported full-page caches may need a manual purge. Visual-editor previews and WooCommerce HTML emails remain synchronous because they cannot converge on a later page request. Sites on a fast provider can translate ordinary pages inline again via `deepglot_max_sync_batches`.

When every attempted SaaS provider returns only a count mismatch for the same multi-text root chunk, Deepglot starts direct singleton isolation. It skips redundant binary intermediate shapes and retries each original text through the configured provider chain in input order. The provider-call ceiling is chain length × (chunk size + 1) for a multi-text root, while an original singleton gets one chain; a default eight-text chunk with two providers therefore allows at most 18 provider calls. All root chunks and isolated singletons share the request-wide provider-call concurrency cap (default 12) and a 100-second provider-work deadline. A failing parallel chunk stops new sibling provider calls, while the WordPress warmer keeps any terminal remainder queued. Singleton, call-budget, and deadline mismatches remain terminal; timeouts, authentication failures, rate limits, U+0000 output, and other malformed responses never enter this extra isolation path.

When the SaaS returns HTTP 429, the client normalizes `Retry-After` delta seconds or strict RFC HTTP dates to a backoff between one second and one hour (60 seconds for a missing, relative, or invalid value). A first 429 stops later sequential batches; parallel responses already in flight retain their own classification and the browser keeps the longest delay. An active 429 marker locally stops synchronous visual-editor and WooCommerce email calls and already-due warmer runs until `retry_at`. Only translation 429 responses set the active marker; configuration and synchronization 429 responses do not. The marker and warmer backoff are bound to the API key and backend. Configuration changes, late responses from the previous configuration, and legacy or unbound markers do not block new translations. The warmer schedules queued work after that delay, while the dynamic browser layer does not immediately retry failed visitor-facing work. Cached translations remain available and other content stays in the source language until a later attempt succeeds.

A permanent `422 velocity_request_too_large` means one request cannot fit the hourly policy even in an empty window. The WordPress warmer automatically splits a multi-text 422 batch under its existing six-batch run budget. Every 422 batch shape is tracked for up to one hour by a configuration-bound HMAC fingerprint to drive bounded splitting; only a text that still returns 422 alone is blocked from automatic resend. The marker stores no raw translation text, API key, or URL. Normal following batches continue, and an API key or backend change heals the marker immediately. The plugin keeps source language content available and does not schedule an automatic timer retry for that singleton response. API requests and PDFs must still be split into smaller inputs by clients.

v0.11.7 exposes a fail-safe final translated-HTML filter for trusted site-specific localization such as language-specific media embeds; v0.11.6 splits content-heavy cold pages into ordered parallel requests bounded by 2,000 UTF-8 source bytes and 200 strings. Publishing this package does not automatically install or update the plugin on customer sites.

Deepglot finishes all bounded root-chunk attempts before starting singleton work. It collects only roots whose complete provider chains produced count mismatches; any other terminal error still aborts siblings immediately. Before calibration, Deepglot compares the remaining deadline with a conservative one-wave reserve: the fastest elapsed duration among the completed full count-mismatch root chains. If that reserve cannot fit, no singleton provider call starts. This root-derived reserve is used only for calibration admission and is never extrapolated across later work. It then runs one global calibration wave containing the first `min(request-wide concurrency, total mismatched texts)` real singletons through their full provider fallback chains and retains its results. If the shared deadline expires during any admitted singleton wave despite the admission checks, Deepglot returns the same typed deadline error instead of a generic timeout. The remaining work is split into request-wide bounded waves. Before each later wave, Deepglot compares `waves still pending × duration of the immediately preceding observed singleton wave` with the remaining shared deadline and remeasures after every completed wave. That deadline is the earlier of the local provider-work ceiling and the caller's monotonic absolute deadline; the PDF route passes its route-entry 40-second deadline so authentication, upload handling, and preparation consume the same budget. If the pending work cannot fit, Deepglot stops after the last retained wave and before any further singleton call. `/api/translate` and PDF return the stable 503 code `translation_count_mismatch_deadline`; once provider work has started, the API conservatively keeps the velocity reservation and retains an idempotent same-key 503 for at most 60 seconds. Otherwise, the remaining affected texts continue through the same globally bounded singleton queue, preserving result order and each text's full provider fallback chain.

## Author

Andreas Ostheimer  
https://www.ostheimer.at

## Included in this iteration

- Plugin bootstrap with the WordPress header
- Simple PSR-4-style autoloader
- Lightweight service container
- Admin page under `Settings -> Deepglot`
- Configurable API client for the Deepglot API
- First frontend integration via output buffering
- Testable URL language logic for language prefixes such as `/en/about/`

## Directory structure

```text
wordpress-plugin/deepglot/
├── deepglot.php
├── bootstrap.php
├── LICENSE
├── README.md
├── readme.txt
├── includes/
│   ├── Admin/
│   ├── Api/
│   ├── Config/
│   ├── Frontend/
│   └── Support/
└── tests/
```

## Structured data

JSON-LD localization supports Recipe instructions as strings, arrays of strings,
typed HowToStep objects and text entries inside HowToSection `itemListElement`.
HowToDirection text is also supported along recipe instruction, section and
step relationships; unrelated direction nodes remain outside this scope.
Nested recipe sections retain instruction semantics through lists and aliases;
unrelated ItemLists and foreign type/property mappings do not acquire them.
Page identities and matching references, including
references with extra metadata, are collected across all JSON-LD blocks in one
document before rewriting. Safe page relationships also seed these identities;
one graph-discovery pass builds adjacency links, then a work queue propagates
reachable identities without rescanning the document. Chained generic definitions
stay linked regardless of script order. Scalar and array page URLs retain their property
semantics and are trimmed before routing; external values remain unchanged.
Supported simple URL value objects retain their envelope and local keyword
aliases while their inner URL follows the same page identity and routing checks.
Valid `@list`/`@set` wrappers, including local keyword aliases and optional string
`@index` metadata, preserve the enclosing field and parent semantics. Unsupported
wrapper envelopes are left untouched.
Plain `@index` containers, optionally combined with `@set`, preserve their index
keys and process values with the enclosing property's semantics. Index keys are
never interpreted as properties or graph identities. Bucket nodes retain the
active scope for their own properties; ordinary descendants still restore a
non-propagating context.
Custom property-index mappings and graph-index combinations remain opaque.
Identity (`@id`) containers, including `@set`/`@graph` combinations, are also
entirely opaque: their implicit identity keys and contents cannot be partially
localized, collected for translation or used to seed external graph references.
Type (`@type`) containers, including `@set` combinations, remain wholly opaque
as well: this helper does not implement their implicit node-type semantics.
Reverse properties (explicit `@reverse`, keyword aliases and term definitions)
are opaque to all visitors. Their resolved reverse IRI never falls back to a
similarly named forward Schema.org property; forward redefinition removes that
boundary. This is conservative non-processing, not reverse-graph localization.

Compact type prefixes, ordinary class aliases, supported Schema.org property
aliases and local keyword aliases are resolved from the active `@context`, including
inherited aliases, overrides, context arrays and null resets. Property-scoped
term contexts apply to their values before any value-local context; redefining a
term without a scoped context removes that association. Type-scoped term contexts
apply to the node's properties in lexical type-term order; type identities use
the pre-type-scope definitions. Type scopes do not propagate by default. Explicit
`@propagate: false` contexts restore their previous scope at descendant nodes,
while scalars, `@value` objects and ID-only references retain their active scope.
Property scopes and value-local overrides are applied after that restoration.
Context scope stays within its script block and subtree; page identity matching
spans script blocks.
Chained term aliases resolve recursively before vocabulary fallback, independent
of definition order. Resolved inherited aliases retain their original meaning
after child-context overrides; disabled targets and cycles do not fall back to
familiar Schema.org names.
Coercion keyword aliases in term `@type` mappings are expanded when the term is
defined, independent of definition order. Later alias overrides do not change
already inherited coercions.
Full Schema.org IRIs remain supported, with case-insensitive scheme/host matching
and case-sensitive type/property names. Context definitions are never sent for
translation or rewritten, and no remote context fetch is performed. The known
Schema.org context is handled locally, including the exact HTTP/HTTPS
`schema.org/docs/jsonldcontext.jsonld` and `.json` URLs. Its relevant keyword
(`type`, `id`) and datatype/prefix definitions are modeled locally, respect
later overrides and are reinstalled by a later known context. This bounded model
is not a runtime download of the entire Schema.org context.
The model is checked against the [published context](https://schema.org/docs/jsonldcontext.jsonld).
Known `@import` forms reuse that model with importing definitions taking
precedence. Unknown imports clear unresolved mappings just like unknown remote
contexts; explicit local definitions can restore only their declared semantics.
Import precedence follows [JSON-LD 1.1 context processing](https://www.w3.org/TR/json-ld11-api/#context-processing-algorithm).
Context-free bare type names retain the legacy Schema.org
default, which explicit null contexts or foreign vocabularies remove. Generic
`text` outside HowToStep or supported recipe directions and shared person,
organization and media IDs remain
outside the new translation/routing scope.

Schema.org types ending in `Article` follow page routing, including specific
news and scholarly subtypes. For objects without an explicit page-related type,
relationships and exact collected page-ID matches only supply page semantics to
untyped objects or exclusively Schema.org `Thing` types. Other specific, mixed
or unresolved reference types remain unchanged, including organization, person
and media subtypes. Aliases retain their original JSON keys and share the same
scope for text selection, ID collection and routing. Scalar `isPartOf` and
`breadcrumb` references, including aliases with `@id` or `@vocab` coercion, only route when
they exactly match a collected page ID; `sameAs`, `citation` and unrelated
strings do not acquire routing semantics from a matching value.
Explicit page-plus-shared multi-types retain their stable entity identities too.
The bounded shared-type list covers the direct subtypes documented under
[Organization](https://schema.org/Organization) and
[MediaObject](https://schema.org/MediaObject), plus common business, education,
sports, performance and media-snapshot descendants. It is not runtime subclass
inference or a complete transitive Schema.org taxonomy.
Direct scalar `mainEntityOfPage` and `ListItem.item` relationships also respect
literal datatype coercion: such literals neither route nor seed page identities.
Explicit node references remain eligible independently of scalar coercion.
`@vocab`-coerced scalar references first resolve their term/vocabulary meaning
before the internal-URL check. Root-looking text under a foreign vocabulary
does not become an internal page identity. The helper's legacy default for bare
Schema.org property/type names is not an implicit vocabulary for IRI values.
Relative page IRIs resolve against the effective local `@base` before internal
origin/effective-port checks or graph identity discovery. Context arrays,
property/type scopes and imports carry that base alongside other mappings;
a null context resets it to the document base, while `@base: null` disables
relative resolution. Unknown remote/imported bases are not guessed as internal.
The actual render URL supplies the initial document base and travels with each
mutation, preventing state from leaking between documents. Paths, dot segments,
queries and fragments resolve before routing; external bases and nondefault
ports stay external. Absolute/prefixed IRIs and `@vocab` coercion retain their
own expansion rules. No context is fetched by the runtime helper.
Valid `@nest` maps and arrays, including keyword aliases and repeated nesting,
group properties of the same node: they share type, identity and visitor state.
Nesting itself does not trigger context rollback; actual child nodes still do.
Nested `@type` values contribute node identity but do not activate type-scoped
contexts: JSON-LD expansion unfolds nesting after direct type scopes are applied.
Malformed nesting envelopes are left untouched.

Canonical identity keys equate root-relative and same-site absolute IDs, including
configured internal language hosts, paths and slug mappings. Query and fragment
distinctions remain intact. Keys are separate from URL output: each actual rewrite
still uses SiteRouting and preserves its relative/absolute routing behavior.
Absolute and scheme-relative page URLs must match a configured routing host and
its effective port. Explicit and implicit default HTTP/HTTPS ports are equivalent;
other services on the same host cannot seed identities or acquire page routing.
Scheme-relative URLs use the source site's scheme for the comparison and routing.
Mapped language hosts use their own generated routing origin, including its port.
External network-path references remain unchanged.

Local prefix definitions also expand compact page IDs and supported page URL
values before internal-host checks, identity matching and routing. Only internal
targets are rewritten; absolute prefixes produce absolute localized URLs. External or unresolved compact
IRIs remain byte-for-byte unchanged. This does not add `@base` resolution or a
general JSON-LD processor.

Simple string value objects (`@value`, optional string `@language`, valid
`@direction: "ltr"` or `"rtl"`, and local
`@context`) retain their enclosing supported text property's meaning, including inside
arrays. Local `@value`/`@language`/`@direction` aliases are supported. Direction
metadata retains its exact envelope on both cache hits and misses. An existing language
tag changes only when a translated value is available and its language exactly
matches the configured source (case-insensitive). The same source-language guard
applies to scalar prose under default or term-specific context language mappings,
before collection and again before applying cached translations. Target-language,
third-language and distinct regional alternatives remain unchanged even when
their text equals an eligible source value. Untagged prose remains source content.
Explicit `xsd:string`
value objects also translate while retaining their datatype and envelope,
including full, compact and local term datatype aliases. Other typed, identified,
index-bearing, invalid-direction or otherwise unsupported value-object shapes remain
untouched. Foreign or disabled property aliases are not interpreted as Schema.org properties.
Combining a datatype with direction metadata is unsupported and remains opaque.
Supporting typed string prose does not make explicit datatype literals eligible
for page-URL rewriting or graph-identity discovery. Language-tagged URL value
objects, including direction-tagged literals, are also excluded from routing and
graph discovery regardless of their tag or an independently collected matching
page ID. Only untagged, untyped URL
envelopes retain the existing routing support. Explicit value objects do not
inherit the surrounding default language; their own tags/datatypes are decisive.
Default and term-specific context language mappings are overridden with explicit
target-language value objects only for translated literals. Context definitions,
cache misses and unrelated literals keep their original language interpretation;
explicitly untagged values remain untagged.
Language-map containers (`@language`, optionally with `@set`) retain the enclosing
supported text property's meaning, including HowToStep text and scoped aliases.
Translated strings move to the target-language bucket; existing target values are
preserved and merged without overwriting them. Collection receives the configured
source and target languages before cache lookup, provider batching and background
warming. Only exact source-tag matches (case-insensitive) are eligible; target,
third-language and distinct regional alternatives remain unchanged, even when
their text is identical to source text or happens to have a cached translation.
The source language travels with each collected mutation into application.
Cache misses, short strings, nulls
and empty arrays keep their source buckets. Explicit `@none` buckets and aliases
remain untagged. Language maps are terminal literals, never graph nodes or page
URLs; malformed maps and unsupported properties are not modified. A map also
stays unchanged if its requested target language code is aliased to `@none`,
because that key cannot represent the requested language.
Values coerced with `@type: @json` are opaque JSON literals: their complete
contents are excluded from text collection, translation, ID discovery and routing,
even when nested payload fields resemble JSON-LD nodes or contexts.
Literal `inLanguage` codes, including aliases and simple value objects, use the
target code. Active default or term language mappings receive an explicit
target-language value override without changing the shared context or cache
misses; null term-language mappings remain untagged.
`@id`/`@vocab`-coerced language IRIs remain unchanged.

## Installation in WordPress

1. Build the versioned ZIP from an explicit commit using the release command below.
2. Upload it in WordPress under `Plugins -> Add New -> Upload Plugin`.
3. Activate the plugin.
4. Create source and target languages in the Deepglot dashboard, then enter the API base URL and API key under `Settings -> Deepglot` and configure the WordPress-owned routing, switcher, and exclusions.

## Current scope

The plugin ships a complete translation pipeline:

- Admin configuration under `Settings → Deepglot` (API identity plus WordPress-owned routing, switcher, and exclusions); SaaS-owned project languages and automatic redirect appear as read-only runtime mirrors after authenticated sync.
- `OutputBuffer` + `HtmlTranslator` (PHP `DOMDocument`) translate the rendered HTML — text nodes, head metadata, accessibility attributes, and JSON-LD. Recipe ingredients and instruction text use the same cache/warm-up pipeline; internal page and breadcrumb identities and their exact graph references follow target-language routing while shared person, organization, media, and external identifiers remain stable.
- `LinkRewriter` rewrites internal links; SaaS-managed translated URL-slug mappings are applied and reversed for path-prefix and subdomain routing; `HreflangInjector` adds `hreflang` / canonical SEO tags; `<html lang>` is switched.
- A WordPress-transient translation cache, bounded background cache warming, batched + parallel API requests, and path-prefix / subdomain routing. Queue claims are atomic, partial responses stay queued, and supported full-page caches are purged after a page finishes warming.
- Independent language-switcher instances (shortcode, Gutenberg block, classic widget, nav-menu, automatic placement), versioned design templates, and a same-origin visual placement editor.
- WooCommerce email translation and SaaS-controlled browser-language redirect.
- AMP translation is controlled by the `translate_amp` option: when disabled,
  detected AMP endpoints bypass the output pipeline entirely; when enabled,
  AMP uses the same translation, bot classification, and cache-safety path as
  ordinary pages.
- A dedicated multilingual sitemap at `/deepglot-sitemap.xml`, advertised in
  `robots.txt`, lists public WordPress posts, pages, and taxonomy terms with
  source, active target-language, and `x-default` alternates. Generated URLs
  follow path-prefix or configured subdomain routing; translation exclusions
  and external URLs are rejected before XML serialization.
- An administrator-triggered URL synchronization previews and confirms an
  immutable batch of up to 250 safe internal sitemap entries, opens at most
  two target pages per cron run,
  and feeds their missing segments into the existing translation warmer. It
  respects queue backpressure, retries transient failures, pauses on exhausted
  quota or an invalid API key, backs off on API rate limits, and exposes
  status/pause/resume/cancel/failed-only-retry controls in wp-admin and the
  authenticated `/wp-json/deepglot/v1/url-sync` routes. Large sites continue
  through explicit source-offset batches instead of one oversized option row.
  If WordPress recognizes a safe HTTPS request on the same host as an internal
  target still stored with HTTP, the preview changes only that target's scheme
  to HTTPS. Semantic query parameters and fragments are preserved. The request
  host is used only for the same-host check and is never copied. One absolute,
  query-free redirect on the exact same origin and in the requested target
  language is verified through separate public and origin probes. Automatic
  redirect following remains disabled; other redirects remain failures.
  A completed job confirms that the origin queue has drained; operators must
  still purge unsupported full-page caches and verify a query-free public
  target-language response.
- An opt-in client-side translator for content loaded after page render (see below).
- Independent, dashboard-controlled page-view analytics for translated pages;
  collection is disabled by default and never relies on translation cache misses.
- WP Rocket compatibility: `switcher.css` and the switcher's inline `<style>`
  blocks are excluded from "Remove Unused CSS" and minification
  (`WpRocketCompat`), because WP Rocket's used-CSS pipeline re-encodes the
  emoji flag glyphs as HTML entities — invalid CSS that renders as literal
  text instead of flags.
- UTF-8-safe serialization: every DOM round-trip goes through
  `Support\HtmlDocument`. `DOMDocument::saveHTML()` only emits raw UTF-8 when
  libxml can read the encoding from the classic
  `<meta http-equiv="Content-Type" …>` tag; WordPress ships the HTML5 short
  form `<meta charset="UTF-8">`, which libxml ignores, so output fell back to
  entity-escaping everything. Harmless in text, but corruption inside
  `<style>` / `<script>`, where CSS and JS have no entities. `HtmlDocument`
  injects the meta libxml reads and strips it again after serializing.

## Reproducible release package

Build only from a full commit SHA. The builder reads committed Git objects,
packages the runtime allowlist under a single `deepglot/` directory, and writes
a SHA-256 sidecar next to the ZIP:

```bash
wordpress-plugin/build-zip.sh "$(git rev-parse --verify HEAD)" wordpress-plugin/dist
```

For v0.12.8 this creates `deepglot-0.12.8.zip` and
`deepglot-0.12.8.zip.sha256`. Build the same commit into two empty output
directories and compare the ZIP hashes when validating a release candidate.

## Test

Run the full plugin suite (PHP unit tests plus dynamic-translator and visual-switcher JS regressions):

```bash
npm run test:wp
```

Or a single PHP test directly:

```bash
php wordpress-plugin/deepglot/tests/UrlLanguageResolverTest.php
```

## Language-switcher instances

The legacy global switcher is migrated to the `default` instance without changing its appearance or auto-inject behavior. Additional instances can be created from versioned templates under `Settings → Deepglot → Sprachumschalter` and edited independently.

- Shortcode: `[deepglot_switcher instance="header-main"]`
- Gutenberg block: set the instance ID in the block inspector.
- Classic widget: select the saved instance in the widget form.
- Automatic placement: enable auto placement and either enter a conservative DOM selector or select an element in the same-origin, script-free preview iframe.

If a saved selector is invalid or no longer exists after a theme change, the switcher remains at its safe WordPress footer fallback. Every render retains a unique checkbox/label ID for independent dropdown and ARIA state.

## Anonymous page-view analytics (explicit opt-in)

Page views and translation requests are different measurements. A translated
page served entirely from a full-page cache can still receive a genuine visitor
without generating a new translation request. The independent
`assets/js/page-view-tracker.js` asset therefore measures rendered visits even
when dynamic content translation is disabled.

- **Consent and default:** tracking remains disabled until a project manager
  explicitly enables page-view analytics in the Deepglot dashboard. The
  authenticated runtime configuration propagates that project-specific choice
  to WordPress; changing the project API key or backend immediately clears stale
  consent. Existing cached trackers also stop working once consent is withdrawn.
- **Collected fields:** a cryptographically random one-time UUID, the current
  query-free URL path, the target language, and a server-generated timestamp.
  No cookies, visitor identifiers, raw IP addresses, user-agent strings,
  referrer URLs, query parameters, fragments, or API keys are included in the
  event. Deepglot deletes page-view events after **90 days**.
- **Transport and security:** the browser sends one event to the same-origin
  `POST /wp-json/deepglot/v1/page-views` endpoint with a path- and
  language-bound, cache-compatible signed capability. The WordPress backend
  forwards only the anonymous fields to Deepglot using an `Authorization`
  header; the project API key never reaches browser JavaScript.
- **Bots and duplicates:** known crawlers are excluded before collection.
  Session-local storage suppresses repeat events for the same language and path
  for 30 seconds, event UUIDs are independently deduplicated by Deepglot, and
  a short-lived site/project-wide rate-limit bucket bounds endpoint abuse
  without inspecting, hashing, storing, or forwarding visitor IP addresses.

## Dynamic content translation (opt-in)

The server-side pass only translates the HTML present at render time. The optional client-side translator (`assets/js/dynamic-translator.js`) extends coverage to content added or changed **after** load — AJAX results, infinite scroll, cart drawers, and SPA widgets.

- **How it works:** a `MutationObserver` collects newly added/changed text nodes and whitelisted attributes (`alt`, `aria-label`, `placeholder`, option / button labels), then translates them through a same-origin WordPress REST proxy — the Deepglot API key never reaches the browser.
- **Enable it:** `Settings → Deepglot → WordPress settings` → enable the "translate dynamically loaded content" toggle (option `enable_dynamic_translation`, **default off**).
- **Endpoint:** `POST /wp-json/deepglot/v1/translate-dynamic` — same-origin, nonce- and quota-ticket-gated, per-IP rate-limited, bot-skipped. It reuses the same `Client` + transient cache as the server pass and returns the `{ from_words, to_words }` contract.
- **Cache-first / quota-safe:** a missing or stale nonce or quota ticket degrades to cache-only, so project quota is never spent without a valid server-issued ticket. When the authenticated project disables automatic translation, the endpoint still performs nonce and per-IP rate checks and may read existing SaaS cache entries without consuming a fresh-word ticket or budget; cache misses remain source content. Fresh-word spend is bounded by two word-denominated caps — the per-render ticket budget and a per-IP fresh-word window budget — so a scraped nonce plus a spoofed `Origin` no longer lets a server-side client drain quota freely. These plugin-side caps are an interim mitigation (soft, per-IP); the authoritative site-wide velocity limit is enforced SaaS-side.
- **SEO-safe:** the initial, crawlable HTML is still produced by the server pass; this layer only enhances live interaction and is skipped for bots.
- **Extraction parity:** the skip rules and attribute whitelist are shared with the server pass via `Support\TranslationRules` (drift-guarded by `tests/TranslationRulesTest.php`); the shipped asset is covered by `tests/DynamicTranslatorAssetTest.js`.

> Status: **live QA passed on 2026-06-10** on `meinhaushalt.at` (plugin v0.8.1, flag enabled there). The toggle remains **off by default** for new installs. See the [dynamic-translation QA record](https://github.com/ostheimer/deepglot/blob/main/wordpress-plugin/deepglot/DYNAMIC_TRANSLATION_QA.md) for the checklist and the recorded result.
