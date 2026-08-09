# Deepglot WordPress Plugin

This directory contains the Deepglot WordPress plugin (**v0.12.0**). It captures the rendered HTML via output buffering, translates it through the Deepglot API, rewrites internal links, and injects SEO metadata — plus an opt-in client-side layer for dynamically loaded content. See the [repository README](https://github.com/ostheimer/deepglot/blob/main/README.md) for the full feature list.

v0.12.0 stops ordinary page renders from waiting on fresh translations: uncached or failed segments enter a bounded background WP-Cron queue, and supported full-page caches are purged after the local translation cache is warm. Administrators can preview and confirm an immutable batch of up to 250 safe internal sitemap URLs from `Settings → Deepglot`; the job can be monitored, paused, resumed, cancelled, or retried for failed URLs and is not a permanent crawler. The first cold view can show source content; a later view converges after cron succeeds. Once a queue mutation and immediately due event are durable, Deepglot makes at most one non-blocking WP-Cron nudge in that request. It respects `DISABLE_WP_CRON` and active cron contexts, so system-cron sites and cron runs never receive a recursive loopback. The warmer retains the localized public request URL even after request routing rewrites the path internally. WP Rocket, W3 Total Cache, and LiteSpeed Cache purge completed URLs individually; WP Super Cache is global and waits until the tracked queue has fully drained so pending pages stay cached. A completed URL-sync job still requires a query-free public target-language check, and unsupported full-page caches may need a manual purge. Visual-editor previews and WooCommerce HTML emails remain synchronous because they cannot converge on a later page request. Sites on a fast provider can translate ordinary pages inline again via `deepglot_max_sync_batches`.

When the SaaS returns HTTP 429, the client normalizes `Retry-After` delta seconds or strict RFC HTTP dates to a backoff between one second and one hour (60 seconds for a missing, relative, or invalid value). A first 429 stops later sequential batches; parallel responses already in flight retain their own classification and the browser keeps the longest delay. An active 429 marker locally stops synchronous visual-editor and WooCommerce email calls and already-due warmer runs until `retry_at`. The warmer schedules queued work after that delay, while the dynamic browser layer does not immediately retry failed visitor-facing work. Cached translations remain available and other content stays in the source language until a later attempt succeeds.

A permanent `422 velocity_request_too_large` means one request cannot fit the hourly policy even in an empty window. The plugin keeps source language content available, does not schedule an automatic timer retry for that response, and requires the request or PDF to be split into smaller inputs. For one hour, an identical batch is suppressed by a configuration-bound HMAC fingerprint; the marker stores no raw translation text, API key, or URL. Normal following batches continue, and an API key or backend change heals the marker immediately.

v0.11.7 exposes a fail-safe final translated-HTML filter for trusted site-specific localization such as language-specific media embeds; v0.11.6 splits content-heavy cold pages into ordered parallel requests bounded by 2,000 UTF-8 source bytes and 200 strings. Publishing this package does not automatically install or update the plugin on customer sites.

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

For v0.12.0 this creates `deepglot-0.12.0.zip` and
`deepglot-0.12.0.zip.sha256`. Build the same commit into two empty output
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
