=== Deepglot ===
Contributors: helpstring
Tags: translation, multilingual, language switcher, localization, machine translation
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 8.0
Stable tag: 0.12.0
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

== External services ==

By default, this plugin connects to the Deepglot service at `https://deepglot.ai/api/`. A compatible self-hosted API base URL can be selected in the settings.

For translation requests, the plugin sends the configured API key, text fragments from rendered pages, source and target language codes, the requested page URL, and a bot-classification code. It sends these requests when uncached content needs translation or when an administrator tests the connection. Dynamic translation requests first pass through the site's same-origin WordPress REST endpoint, so the API key is not exposed to browsers.

Settings synchronization sends the configured API key, site URL, routing mode, source and target languages, domain mappings, and the feature flags for automatic redirect, email translation, search translation, AMP translation, and dynamic translation.

Runtime refresh sends the configured API key and receives URL and selector exclusions, regular-expression exclusions, and translated URL-slug mappings. The plugin can also request the public supported-languages list without an API key.

Starting the Visual Editor verifies its token through the project-scoped `editor-sessions/verify` endpoint. Saving a manual translation sends the token, original and translated text, source and target language codes, and the request URL to the project-scoped `manual-translations` endpoint.

Deepglot returns translated text, language and quota status, and the synchronized project configuration described above. Review the service policies before enabling the hosted service:

* Terms of service: https://deepglot.ai/terms
* Privacy policy: https://deepglot.ai/privacy

== Changelog ==

= 0.12.0 =
* Page rendering no longer waits for fresh translations. Uncached segments are translated by a background job, so the first view of a new page is fast and every later view is served fully translated from the cache.
* Added background cache warming, which also retries requests that failed instead of silently dropping them, so a page can no longer stay untranslated permanently.
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
