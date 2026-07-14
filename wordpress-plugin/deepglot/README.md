# Deepglot WordPress Plugin

This directory contains the Deepglot WordPress plugin (**v0.10.0**). It captures the rendered HTML via output buffering, translates it through the Deepglot API, rewrites internal links, and injects SEO metadata — plus an opt-in client-side layer for dynamically loaded content. See the repository [README](../../README.md) for the full feature list.

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
├── includes/
│   ├── Admin/
│   ├── Api/
│   ├── Config/
│   ├── Frontend/
│   └── Support/
└── tests/
```

## Installation in WordPress

1. Package the `wordpress-plugin/deepglot` directory as a ZIP archive.
2. Upload it in WordPress under `Plugins -> Add New -> Upload Plugin`.
3. Activate the plugin.
4. Under `Settings -> Deepglot`, configure the API base URL, API key, and languages.

## Current scope

The plugin ships a complete translation pipeline:

- Admin configuration under `Settings → Deepglot` (API, languages, switcher, exclusions, members).
- `OutputBuffer` + `HtmlTranslator` (PHP `DOMDocument`) translate the rendered HTML — text nodes, head metadata, accessibility attributes, and JSON-LD.
- `LinkRewriter` rewrites internal links; `HreflangInjector` adds `hreflang` / canonical SEO tags; `<html lang>` is switched.
- A WordPress-transient translation cache, batched + parallel API requests, and path-prefix / subdomain routing.
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
- An opt-in client-side translator for content loaded after page render (see below).

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

> Status: **live QA passed on 2026-06-10** on `meinhaushalt.at` (plugin v0.8.1, flag enabled there). The toggle remains **off by default** for new installs. See [DYNAMIC_TRANSLATION_QA.md](DYNAMIC_TRANSLATION_QA.md) for the checklist and the recorded result.
