# Deepglot WordPress Plugin

This directory contains the Deepglot WordPress plugin (**v0.12.6**). It captures the rendered HTML via output buffering, translates it through the Deepglot API, rewrites internal links, and injects SEO metadata — plus an opt-in client-side layer for dynamically loaded content. See the [repository README](https://github.com/ostheimer/deepglot/blob/main/README.md) for the full feature list.

v0.12.6 follows WordPress core post-type viewability so built-in public pages remain in the multilingual sitemap and URL-sync inventory while non-viewable builder content types, attachments, and non-queryable taxonomies stay excluded. v0.12.5 translates explicitly configured cookie-consent roots that already exist before the footer observer starts, without rescanning normal server-rendered content. Internal page links in those dynamic roots are localized through the same server-side routing semantics and URLs never enter provider translation requests. v0.12.4 stores translated transient values in a separate, versioned ASCII-safe key space with canonical Base64URL and a key-bound checksum. Existing plain-string cache entries remain readable. A provider result is complete only after an exact cache readback; failed writes stay in both background queues, do not purge the affected page, and keep inline responses out of full-page caches. v0.12.3 stores background text and URL queues in a versioned, checksummed ASCII-safe envelope. Valid Unicode, including emoji, therefore remains durable on legacy WordPress option tables that cannot store four-byte UTF-8 directly. Existing array queues migrate automatically, while damaged persistence fails closed and is not silently replaced or deleted during disabled cleanup. A separate short atomic lock couples text and purge-target mutations; lease fencing prevents stale owners from committing only one side, and provider requests remain outside that lock. If a cold render cannot durably acquire the coupled state, the source-language response is marked non-cacheable so a later request can retry. v0.12.2 lets URL synchronization explicitly verify one safe canonical redirect on the exact same origin and in the requested target language. Automatic redirect following remains disabled, and all other redirects stay in the bounded error path. This repository state prepares the package only; it is not evidence of a tag, WordPress.org publication, customer installation, or live acceptance.

v0.12.0 stops ordinary page renders from waiting on fresh translations: uncached or failed segments enter a bounded background WP-Cron queue, and supported full-page caches are purged after the local translation cache is warm. Administrators can preview and confirm an immutable batch of up to 250 safe internal sitemap URLs from `Settings → Deepglot`; the job can be monitored, paused, resumed, cancelled, or retried for failed URLs and is not a permanent crawler. The first cold view can show source content; a later view converges after cron succeeds. Once a queue mutation and immediately due event are durable, Deepglot makes at most one non-blocking WP-Cron nudge in that request. It respects `DISABLE_WP_CRON` and active cron contexts, so system-cron sites and cron runs never receive a recursive loopback. The warmer retains the localized public request URL even after request routing rewrites the path internally. WP Rocket, W3 Total Cache, and LiteSpeed Cache purge completed URLs individually; WP Super Cache is global and waits until the tracked queue has fully drained so pending pages stay cached. A completed URL-sync job still requires a query-free public target-language check, and unsupported full-page caches may need a manual purge. Visual-editor previews and WooCommerce HTML emails remain synchronous because they cannot converge on a later page request. Sites on a fast provider can translate ordinary pages inline again via `deepglot_max_sync_batches`.

When every attempted SaaS provider returns only a count mismatch for the same multi-text root chunk, Deepglot starts direct singleton isolation. It skips redundant binary intermediate shapes and retries each original text through the configured provider chain in input order. The provider-call ceiling is chain length × (chunk size + 1) for a multi-text root, while an original singleton gets one chain; a default eight-text chunk with two providers therefore allows at most 18 provider calls. All root chunks and isolated singletons share the request-wide provider-call concurrency cap (default 12) and a 100-second provider-work deadline. A failing parallel chunk stops new sibling provider calls, while the WordPress warmer keeps any terminal remainder queued. Singleton, call-budget, and deadline mismatches remain terminal; timeouts, authentication failures, rate limits, U+0000 output, and other malformed responses never enter this extra isolation path.

When the SaaS returns HTTP 429, the client normalizes `Retry-After` delta seconds or strict RFC HTTP dates to a backoff between one second and one hour (60 seconds for a missing, relative, or invalid value). A first 429 stops later sequential batches; parallel responses already in flight retain their own classification and the browser keeps the longest delay. An active 429 marker locally stops synchronous visual-editor and WooCommerce email calls and already-due warmer runs until `retry_at`. Only translation 429 responses set the active marker; configuration and synchronization 429 responses do not. The marker and warmer backoff are bound to the API key and backend. Configuration changes, late responses from the previous configuration, and legacy or unbound markers do not block new translations. The warmer schedules queued work after that delay, while the dynamic browser layer does not immediately retry failed visitor-facing work. Cached translations remain available and other content stays in the source language until a later attempt succeeds.

A permanent `422 velocity_request_too_large` means one request cannot fit the hourly policy even in an empty window. The WordPress warmer automatically splits a multi-text 422 batch under its existing six-batch run budget. Every 422 batch shape is tracked for up to one hour by a configuration-bound HMAC fingerprint to drive bounded splitting; only a text that still returns 422 alone is blocked from automatic resend. The marker stores no raw translation text, API key, or URL. Normal following batches continue, and an API key or backend change heals the marker immediately. The plugin keeps source language content available and does not schedule an automatic timer retry for that singleton response. API requests and PDFs must still be split into smaller inputs by clients.

v0.11.7 exposes a fail-safe final translated-HTML filter for trusted site-specific localization such as language-specific media embeds; v0.11.6 splits content-heavy cold pages into ordered parallel requests bounded by 2,000 UTF-8 source bytes and 200 strings. Publishing this package does not automatically install or update the plugin on customer sites.

The SaaS finishes all bounded root-chunk attempts before starting singleton work. It collects only roots whose complete provider chains produced count mismatches; any other terminal error still aborts siblings immediately. It then compares the remaining shared deadline with an optimistic first-provider-only estimate: the shortest provider-call duration observed in those root chains × `ceil(total mismatched texts / request-wide concurrency)`. If even that cannot fit, the request fails with the privacy-safe classified error `count-mismatch singleton recovery cannot fit the remaining request deadline` before the first singleton call. Otherwise, all affected roots enter one globally bounded singleton queue that preserves result order and each text's full provider fallback chain.

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
4. Under `Settings -> Deepglot`, configure the API base URL, API key, and languages.

## Current scope

The plugin ships a complete translation pipeline:

- Admin configuration under `Settings → Deepglot` (API, languages, switcher, exclusions, members).
- `OutputBuffer` + `HtmlTranslator` (PHP `DOMDocument`) translate the rendered HTML — text nodes, head metadata, accessibility attributes, and JSON-LD.
- `LinkRewriter` rewrites internal links; SaaS-managed translated URL-slug mappings are applied and reversed for path-prefix and subdomain routing; `HreflangInjector` adds `hreflang` / canonical SEO tags; `<html lang>` is switched.
- A WordPress-transient translation cache, bounded background cache warming, batched + parallel API requests, and path-prefix / subdomain routing. Queue claims are atomic, partial responses stay queued, and supported full-page caches are purged after a page finishes warming.
- Independent language-switcher instances (shortcode, Gutenberg block, classic widget, nav-menu, automatic placement), versioned design templates, and a same-origin visual placement editor.
- WooCommerce email translation and browser-language redirect.
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

For v0.12.6 this creates `deepglot-0.12.6.zip` and
`deepglot-0.12.6.zip.sha256`. Build the same commit into two empty output
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

## Dynamic content translation (opt-in)

The server-side pass only translates the HTML present at render time. The optional client-side translator (`assets/js/dynamic-translator.js`) extends coverage to content added or changed **after** load — AJAX results, infinite scroll, cart drawers, and SPA widgets.

- **How it works:** a `MutationObserver` collects newly added/changed text nodes and whitelisted attributes (`alt`, `aria-label`, `placeholder`, option / button labels), then translates them through a same-origin WordPress REST proxy — the Deepglot API key never reaches the browser.
- **Enable it:** `Settings → Deepglot → WordPress settings` → enable the "translate dynamically loaded content" toggle (option `enable_dynamic_translation`, **default off**).
- **Endpoint:** `POST /wp-json/deepglot/v1/translate-dynamic` — same-origin, nonce- and quota-ticket-gated, per-IP rate-limited, bot-skipped. It reuses the same `Client` + transient cache as the server pass and returns the `{ from_words, to_words }` contract.
- **Cache-first / quota-safe:** a missing or stale nonce or quota ticket degrades to cache-only, so project quota is never spent without a valid server-issued ticket. Fresh-word spend is bounded by two word-denominated caps — the per-render ticket budget and a per-IP fresh-word window budget — so a scraped nonce plus a spoofed `Origin` no longer lets a server-side client drain quota freely; full-page-cached pages still serve cached translations. These plugin-side caps are an interim mitigation (soft, per-IP); the authoritative site-wide velocity limit is enforced SaaS-side.
- **SEO-safe:** the initial, crawlable HTML is still produced by the server pass; this layer only enhances live interaction and is skipped for bots.
- **Extraction parity:** the skip rules and attribute whitelist are shared with the server pass via `Support\TranslationRules` (drift-guarded by `tests/TranslationRulesTest.php`); the shipped asset is covered by `tests/DynamicTranslatorAssetTest.js`.

> Status: **live QA passed on 2026-06-10** on `meinhaushalt.at` (plugin v0.8.1, flag enabled there). The toggle remains **off by default** for new installs. See the [dynamic-translation QA record](https://github.com/ostheimer/deepglot/blob/main/wordpress-plugin/deepglot/DYNAMIC_TRANSLATION_QA.md) for the checklist and the recorded result.
