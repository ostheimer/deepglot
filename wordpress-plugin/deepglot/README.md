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

## Installation in WordPress

1. Build the versioned ZIP from an explicit commit using the release command below.
2. Upload it in WordPress under `Plugins -> Add New -> Upload Plugin`.
3. Activate the plugin.
4. Create source and target languages in the Deepglot dashboard, then enter the API base URL and API key under `Settings -> Deepglot` and configure the WordPress-owned routing, switcher, and exclusions.

## Current scope

The plugin ships a complete translation pipeline:

- Admin configuration under `Settings → Deepglot` (API identity plus WordPress-owned routing, switcher, and exclusions); SaaS-owned project languages and automatic redirect appear as read-only runtime mirrors after authenticated sync.
- `OutputBuffer` + `HtmlTranslator` (PHP `DOMDocument`) translate the rendered HTML — text nodes, head metadata, accessibility attributes, and JSON-LD.
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
