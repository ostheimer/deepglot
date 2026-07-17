=== Deepglot ===
Contributors: helpstring
Tags: translation, multilingual, language switcher, localization, machine translation
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 0.10.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

AI-powered website translation with SEO-friendly URLs, hreflang tags, and a customizable language switcher.

== Description ==

Deepglot translates your rendered WordPress pages through the Deepglot translation API and serves each visitor a fully localized site — no duplicate posts, no manual copies.

**Translation pipeline**

* Translates the rendered HTML output: text content, head metadata (title, description, Open Graph), accessibility attributes (`alt`, `aria-label`, placeholders), and JSON-LD structured data.
* Rewrites internal links to the active language and switches `<html lang>`.
* Injects `hreflang` and canonical tags for SEO; cached translations are served to crawlers.
* Path-prefix routing (`/en/about/`) or subdomain routing (`en.example.com`).
* Translation cache via WordPress transients with batched, parallel API requests.
* Bot detection: crawlers are served cached translations only and never consume translation quota.

**Language switcher**

* Independent switcher instances via shortcode, Gutenberg block, classic widget, nav-menu integration, or automatic placement.
* Versioned design templates, five flag styles, custom flag images per language, drag-and-drop ordering, fixed/floating positions, responsive show/hide, and a visual placement editor.
* Accessible markup (ARIA) that works without JavaScript.

**Dynamic content (opt-in)**

* A client-side layer re-translates content loaded after the initial page render (AJAX, infinite scroll, cart drawers, SPA widgets) through a same-origin proxy, so your API key never reaches the browser.

**More**

* WooCommerce email translation and browser-language redirect.
* Optional AMP support: translated AMP endpoints use the same pipeline and cache safety as ordinary pages.
* A dedicated multilingual sitemap at `/deepglot-sitemap.xml`, advertised in `robots.txt`, with source, target-language, and `x-default` alternates.
* Quota visibility: an admin notice appears when your translation quota is exhausted.

== External services ==

This plugin sends the text content of your rendered pages to the Deepglot translation API to obtain machine translations. By default this is the hosted service at `https://deepglot.ai`; self-hosted Deepglot instances are supported by changing the API base URL in the plugin settings.

Transmitted data: the page text segments to be translated, the source and target language codes, the page URL, and a bot-classification code for the current visitor. No personal visitor data (IP addresses, cookies, form input) is transmitted. Data is sent on page render whenever a translation is not already cached locally.

Service provider: Deepglot, https://deepglot.ai
Terms of service: https://deepglot.ai/terms
Privacy policy: https://deepglot.ai/privacy

An API key from a Deepglot account (free tier available) or a self-hosted Deepglot instance is required for translation.

== Installation ==

1. Upload the plugin ZIP under `Plugins -> Add New -> Upload Plugin`, or install it from the plugin directory.
2. Activate the plugin.
3. Go to `Settings -> Deepglot` and enter your API base URL and API key.
4. Choose your source language and the target languages to serve.
5. Optionally configure the language switcher, routing mode, and exclusions.

== Frequently Asked Questions ==

= Do I need a Deepglot account? =

Yes. Translations are produced by the Deepglot API. You can create a free account at https://deepglot.ai or run a self-hosted Deepglot instance and point the plugin at its URL.

= Does the plugin duplicate my posts? =

No. Translations happen at render time on the HTML output. Your content stays single-source; translated variants are cached and served per language.

= Is it SEO-friendly? =

Yes. Each language is served under its own URL (path prefix or subdomain), with `hreflang` alternates, canonical tags, translated metadata, and a multilingual sitemap at `/deepglot-sitemap.xml`. Crawlers receive cached translations.

= Does it work with page caching plugins? =

Yes. Translated pages are regular server-rendered HTML and can be cached per URL by page caches and CDNs.

= What happens when my translation quota is exhausted? =

Visitors receive cached translations where available and the source language otherwise. Site admins see a notice in wp-admin.

== Changelog ==

= 0.10.1 =
* Compatibility: exclude the switcher CSS from WP Rocket's "Remove Unused CSS" so emoji flags are never inlined as invalid HTML entities.

= 0.10.0 =
* Independent language-switcher instances with versioned design templates and a visual placement editor.
* Multilingual XML sitemap at /deepglot-sitemap.xml, advertised in robots.txt.
* AMP pipeline support behind the translate_amp option.

= 0.8.x =
* Bot detection with cache-only serving for crawlers; quota-exhaustion notices in wp-admin.
* Client-side dynamic content translation (opt-in) with per-render and per-IP budgets.
* Cache-poisoning guard for bot-first visits; runtime settings-sync race fix.

= 0.7.0 =
* Per-language custom flag images, responsive show/hide, nav-menu integration, Gutenberg block, and classic widget for the language switcher.

= 0.5.0 =
* Weglot-parity language switcher: JS-free dropdown, ARIA, floating positions.

= 0.2.0 =
* Admin UI for the language switcher with style, flag, order, and CSS controls.

= 0.1.0 =
* Initial release: output-buffer translation pipeline, link rewriting, hreflang injection, translation cache, admin settings.

== Upgrade Notice ==

= 0.10.0 =
Adds switcher instances/templates, the multilingual sitemap, and AMP support. Settings are migrated automatically; review Settings -> Deepglot after updating.
