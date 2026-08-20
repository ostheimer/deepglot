=== Deepglot ===
Contributors: helpstring
Tags: translation, multilingual, language switcher, localization, machine translation
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 8.0
Stable tag: 0.12.6
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

AI-powered website translation with SEO-friendly URLs, hreflang tags, and a customizable language switcher.

== Description ==

Deepglot translates rendered WordPress pages through the Deepglot translation API and serves each visitor a localized site without duplicating posts.

* Translates text, metadata, accessibility attributes, and JSON-LD structured data.
* Rewrites internal links and SaaS-managed translated URL slugs for path-prefix or subdomain routing.
* Adds canonical and `hreflang` tags plus a multilingual sitemap.
* Provides shortcode, block, widget, nav-menu, and automatic language switchers.
* Caches translations locally and serves cached translations to crawlers without spending quota.
* Lets administrators synchronize a bounded sitemap URL snapshot through the existing background translation queue.
* Optionally translates dynamically loaded content through a same-origin WordPress REST endpoint.

Development source and release build instructions are available at https://github.com/ostheimer/deepglot.

== Installation ==

1. Upload the release ZIP under `Plugins -> Add New -> Upload Plugin`.
2. Activate Deepglot.
3. Open `Settings -> Deepglot` and enter the API base URL and API key.
4. Choose the source language, target languages, routing, switcher, and exclusions.

== Frequently Asked Questions ==

= Do I need a Deepglot account? =

Yes. Use an account at https://deepglot.ai or configure a compatible self-hosted Deepglot service.

= Does the plugin duplicate posts? =

No. Translation happens on rendered output. Source content remains in the original WordPress posts and pages.

= What happens when the quota is exhausted? =

Cached translations remain available. Uncached content falls back to the source language, and administrators see a quota notice.

= What happens when Deepglot returns HTTP 429? =

The plugin respects Retry-After as delta seconds or a strict RFC HTTP date, using a bounded delay of one second to one hour and a 60-second fallback for missing, relative, or invalid values. The first 429 stops the remaining sequential batches; parallel batches already in flight keep their own responses and the browser keeps the longest delay. An active 429 marker locally stops synchronous visual-editor and WooCommerce email calls and already-due warmer runs until `retry_at`. Only translation 429 responses set the active marker; configuration and synchronization 429 responses do not. The marker and warmer backoff are bound to the API key and backend. Configuration changes, late responses from the previous configuration, and legacy or unbound markers do not block new translations. Background warming waits for the bounded delay, and dynamic visitor requests are not immediately retried. Cached translations remain available while uncached content stays in the source language.

A permanent `422 velocity_request_too_large` means one request cannot fit the hourly policy even in an empty window. The WordPress warmer automatically splits a multi-text 422 batch under its existing six-batch run budget. Every 422 batch shape is tracked for up to one hour by a configuration-bound HMAC fingerprint to drive bounded splitting; only a text that still returns 422 alone is blocked from automatic resend. The marker stores no raw translation text, API key, or URL. Normal following batches continue, and an API key or backend change heals the marker immediately. The plugin keeps source language content available and does not schedule an automatic timer retry for that singleton response. API requests and PDFs must still be split into smaller inputs by clients.

= Why can the first translated page view still show the source language? =

Since version 0.12.0, ordinary page requests do not wait for a slow translation provider. The first view queues uncached text for an immediately due WP-Cron job and, once both are stored, makes one non-blocking WP-Cron nudge in the same request. The nudge is skipped for DISABLE_WP_CRON and while cron is already running. After the job succeeds, Deepglot stores the translations locally and purges completed URLs in WP Rocket, W3 Total Cache, and LiteSpeed Cache. Because WP Super Cache exposes only a global purge, Deepglot waits until the tracked queue is empty so pending pages stay cached. If later views remain in the source language, verify that WP-Cron or the host's system cron is running and purge any other page-cache plugin manually.

Since version 0.12.3, the text and URL queues use a versioned, checksummed ASCII-safe storage envelope. This preserves valid Unicode, including emoji, even on legacy WordPress option tables that cannot store four-byte UTF-8 directly. Existing queue arrays migrate automatically; damaged queue data is rejected without being overwritten or deleted during disabled cleanup. A separate short atomic lock couples text and URL queue reconciliation with cache purging, and lease fencing stops stale owners from committing only one side. Translation-provider requests remain outside that lock. If a cold render cannot durably enqueue both sides, its source-language response is marked non-cacheable so a later request can retry.

Since version 0.12.4, translated cache values also use a separate versioned, checksummed ASCII-safe key space. Existing plain-string cache entries remain readable. A cache write counts as complete only after an exact readback; failed writes stay queued, their page cache is not purged, and inline responses remain non-cacheable until the translation is durable.

Since version 0.12.5, configured cookie-consent widgets that already exist before the footer observer starts are translated through the same bounded dynamic endpoint without rescanning the server-rendered page. Their internal page links are localized with the server-side routing rules and are never sent to the translation provider. Version 0.12.6 follows WordPress core viewability for public post types, so built-in pages remain in the multilingual sitemap while non-viewable builder content types stay excluded. Public taxonomies must still be publicly queryable.

When every attempted SaaS provider returns only a count mismatch for the same multi-text root chunk, Deepglot starts direct singleton isolation. It skips redundant binary intermediate shapes and retries each original text through the configured provider chain in input order. The provider-call ceiling is chain length × (chunk size + 1) for a multi-text root, while an original singleton gets one chain; a default eight-text chunk with two providers therefore allows at most 18 provider calls. All root chunks and isolated singletons share the request-wide provider-call concurrency cap (default 12) and a 100-second provider-work deadline. A failing parallel chunk stops new sibling provider calls, while the WordPress warmer keeps any terminal remainder queued. Singleton, call-budget, and deadline mismatches remain terminal; timeouts, authentication failures, rate limits, U+0000 output, and other malformed responses never enter this extra isolation path.

The SaaS finishes all bounded root-chunk attempts before starting singleton work. It collects only roots whose complete provider chains produced count mismatches; any other terminal error still aborts siblings immediately. It then runs one global calibration wave containing the first `min(request-wide concurrency, total mismatched texts)` real singletons through their full provider fallback chains and retains its results. Only the remaining singleton work is checked against the remaining shared deadline: `ceil(remaining singleton texts / request-wide concurrency) × observed calibration-wave duration`. If that work cannot fit, the request fails with the privacy-safe classified error `count-mismatch singleton recovery cannot fit the remaining request deadline` after calibration and before any further singleton call. Otherwise, the remaining affected texts continue through the same globally bounded singleton queue, preserving result order and each text's full provider fallback chain.

= How do I translate existing pages without opening every URL? =

Under `Settings -> Deepglot`, create a URL preview with a small limit and the required target languages, review the sample URLs, and explicitly confirm the immutable snapshot. When WordPress recognizes a safe HTTPS request on the same host as an internal target still stored with HTTP, the preview changes only that target's scheme to HTTPS; semantic query parameters and fragments are preserved. It never copies a foreign request host. One absolute, query-free redirect on the exact same origin and in the requested target language is verified through separate public and origin probes while automatic redirect following stays disabled. Other redirects remain bounded failures; unsafe targets do too. One batch contains at most 250 safe internal entries from the multilingual sitemap and opens at most two target pages per cron run. The job reports aggregate progress and can be paused, resumed, cancelled, or retried for failed URLs. It pauses when the quota is exhausted or the API key is invalid and automatically backs off on API rate limits. Continue large sites with the next bounded batch. This is an explicit administrator action, not a permanent crawler.

== External services ==

By default, this plugin connects to the Deepglot service at `https://deepglot.ai/api/`. A compatible self-hosted API base URL can be selected in the settings.

For translation requests, the plugin sends the configured API key, text fragments from rendered pages, source and target language codes, the requested page URL, and a bot-classification code. It sends these requests when uncached content needs translation, when an administrator starts URL synchronization, or when an administrator tests the connection. URL synchronization first requests safe internal target pages on the same WordPress site; those pages feed missing segments into the normal translation queue. Dynamic translation requests first pass through the site's same-origin WordPress REST endpoint, so the API key is not exposed to browsers.

Settings synchronization sends the configured API key, site URL, routing mode, source and target languages, domain mappings, and the feature flags for automatic redirect, email translation, search translation, AMP translation, and dynamic translation.

Runtime refresh sends the configured API key and receives URL and selector exclusions, regular-expression exclusions, and translated URL-slug mappings. The plugin can also request the public supported-languages list without an API key.

Starting the Visual Editor verifies its token through the project-scoped `editor-sessions/verify` endpoint. Saving a manual translation sends the token, original and translated text, source and target language codes, and the request URL to the project-scoped `manual-translations` endpoint.

Deepglot returns translated text, language and quota status, and the synchronized project configuration described above. Review the service policies before enabling the hosted service:

* Terms of service: https://deepglot.ai/terms
* Privacy policy: https://deepglot.ai/privacy

== Changelog ==

= 0.12.6 =
* Restored built-in public pages to the multilingual sitemap and URL synchronization inventory by following WordPress core post-type viewability.
* Kept non-viewable builder content types, attachments, and non-queryable taxonomies out of multilingual discovery.

= 0.12.5 =
* Translated configured cookie-consent widgets that render before the dynamic footer observer starts without rescanning the normal server-rendered page.
* Localized internal links inside dynamic widgets with the server-side routing rules while keeping URLs out of translation-provider requests.
* Excluded public but non-queryable builder content types and taxonomies from the multilingual sitemap and URL synchronization inventory.

= 0.12.4 =
* Preserved translated cache values containing emoji or other four-byte Unicode on legacy three-byte WordPress option tables.
* Kept existing plain-string cache entries readable through a separate versioned key space with canonical Base64URL and key-bound integrity checks.
* Retained failed cache writes in the background text and URL queues and prevented incomplete inline results from entering full-page caches.

= 0.12.3 =
* Preserved background text and URL queues containing emoji or other four-byte Unicode on legacy WordPress option tables through an ASCII-safe, checksummed storage envelope.
* Kept existing queue arrays backward compatible and rejected damaged queue persistence without silently replacing it.
* Coupled text and purge-target mutations with a short atomic lock while keeping translation-provider work outside the lock.

= 0.12.2 =
* Verified one safe same-origin canonical redirect in the requested target language during URL synchronization without enabling automatic redirect following.

= 0.12.1 =
* Assigned a new public asset version to the Retry-After-aware dynamic translator so WordPress and intermediary caches do not keep serving the older browser behavior.
* Preserved bounded Retry-After signals on HTTP 429, stopped later sequential batches, and delayed warm and dynamic follow-up requests instead of immediately retrying.
* Corrected stale same-host HTTP targets to HTTPS during URL-sync preview when WordPress recognizes the current request as HTTPS, while preserving semantic query parameters and fragments and never copying a foreign request host.

= 0.12.0 =
* Ordinary page rendering no longer waits for fresh translations. Uncached segments are translated by a background job, so the first cold view is fast and later views converge after WP-Cron succeeds.
* Added bounded, atomically locked background cache warming. Failed and partial results remain queued, and supported full-page caches are purged after warming completes.
* Added administrator-triggered URL synchronization from a bounded internal sitemap snapshot, with progress, pause, resume, cancel, backpressure, retry, quota, and invalid-key controls.
* Kept visual-editor previews and WooCommerce HTML emails synchronous because those one-off outputs cannot converge on a later page request.
* Added the `deepglot_max_sync_batches` filter to translate inline again on fast providers, and `deepglot_api_timeout` to tune the request budget.

= 0.11.7 =
* Added a fail-safe final translated-HTML filter for trusted site-specific localization such as language-specific media embeds.

= 0.11.6 =
* Split content-heavy cold pages into ordered parallel requests bounded by 2,000 UTF-8 source bytes and 200 strings.

= 0.11.5 =
* Extended the bounded translation request window to 60 seconds so valid cold large-page batches do not fall back to untranslated content.

= 0.11.4 =
* Preserved numeric-looking source-slug mappings after persistence so existing translated routes remain resolvable.

= 0.11.3 =
* Hardened reciprocal canonical, hreflang, and multilingual sitemap output across source and translated routes.
* Redirected stale translated slugs to current localized URLs, preserved semantic query routing, and suppressed source-only Avada AJAX suggestions on target-language pages.
* Allowed 30 seconds for translation batches and rejected malformed provider responses instead of accepting partial results.

= 0.11.2 =
* Detected a revoked or invalid API key (HTTP 401) and stopped retrying it on every page view.
* Added a wp-admin error notice and an "API-Key ungültig" settings status instead of a misleading active state.
* Cleared the invalid-key state immediately when a new API key or backend URL is saved.

= 0.11.1 =
* Preserved whitespace-prefixed `mailto:` and `tel:` action links during URL rewriting.
* Restored full-language descriptions when the switcher displays ISO-code labels.
* Cleared WordPress.org Plugin Check errors for URL parsing, direct access, escaping, and translator comments.

= 0.11.0 =
* Added SaaS-managed translated URL slugs for forward and reverse request routing.
* Added bounded runtime-config refresh and dedicated persisted slug mappings.
* Excluded WordPress infrastructure paths from translation routing.
* Added the refreshed Deepglot admin branding, packaged logo, and orange visual-editor accents.
* Updated dashboard links and localized setup copy from deepglot.app to deepglot.ai.

= 0.10.4 =
* Prevented intermediary caches from preserving stale virtual `robots.txt` responses.

= 0.10.3 =
* Kept multilingual sitemap discovery when late renderers such as Yoast SEO replace `robots.txt` output.

= 0.10.2 =
* Preserved raw UTF-8 through DOM serialization, including emoji and umlauts in scripts and styles.

= 0.10.1 =
* Excluded switcher CSS from WP Rocket used-CSS and minification pipelines.

= 0.10.0 =
* Added independent switcher instances, templates, visual placement, AMP handling, and a multilingual sitemap.

== Upgrade Notice ==

= 0.12.6 =
Keeps ordinary WordPress pages discoverable for multilingual synchronization while builder-only archives remain excluded.

= 0.12.5 =
Keeps early cookie-consent widgets and their legal links in the active language and removes non-queryable builder archives from multilingual discovery.

= 0.12.4 =
Prevents paid translations containing emoji from being dropped when WordPress transients use a legacy three-byte database table.

= 0.12.3 =
Prevents valid emoji and other four-byte Unicode from stalling background translation queues on sites with legacy WordPress database encodings.

= 0.12.2 =
Allows bounded URL synchronization to complete for safe canonical aliases while preserving strict origin, language, and no-follow validation.

= 0.12.1 =
Refreshes the dynamic translator asset for bounded Retry-After handling and corrects safe same-host HTTPS URL-sync previews. Preparing or publishing the package does not update customer sites automatically.

= 0.12.0 =
Moves fresh translations off the page render into a background job, so cold pages load fast instead of waiting for the translation API. Requires PHP 8.0 or newer.

= 0.11.7 =
Allows trusted site-specific callbacks to localize media embeds after the full translation pipeline. Requires PHP 8.0 or newer.

= 0.11.6 =
Prevents content-heavy cold pages from exceeding the translation window as one oversized provider request. Requires PHP 8.0 or newer.

= 0.11.5 =
Allows cold large-page translations up to 60 seconds to complete instead of returning partially untranslated pages. Requires PHP 8.0 or newer.

= 0.11.4 =
Preserves translated routes whose source slug consists only of digits. Requires PHP 8.0 or newer.

= 0.11.3 =
Hardens localized SEO metadata and slug canonicalization, preserves search routing, and allows longer translation batches. Requires PHP 8.0 or newer.

= 0.11.2 =
Reports an invalid or revoked API key in wp-admin and stops re-sending doomed translation requests on every page view. Requires PHP 8.0 or newer.

= 0.11.1 =
Preserves action links, restores descriptive ISO-code labels, and improves WordPress.org compatibility. Requires PHP 8.0 or newer.
