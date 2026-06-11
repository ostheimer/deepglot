# Deepglot WordPress Plugin

This directory contains the Deepglot WordPress plugin (**v0.8.1**). It captures the rendered HTML via output buffering, translates it through the Deepglot API, rewrites internal links, and injects SEO metadata — plus an opt-in client-side layer for dynamically loaded content. See the repository [README](../../README.md) for the full feature list.

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
- Language switcher (shortcode, Gutenberg block, classic widget, nav-menu), WooCommerce email translation, and browser-language redirect.
- An opt-in client-side translator for content loaded after page render (see below).

## Test

Run the full plugin suite (PHP unit tests + the dynamic-translator JS regression):

```bash
npm run test:wp
```

Or a single PHP test directly:

```bash
php wordpress-plugin/deepglot/tests/UrlLanguageResolverTest.php
```

## Dynamic content translation (opt-in)

The server-side pass only translates the HTML present at render time. The optional client-side translator (`assets/js/dynamic-translator.js`) extends coverage to content added or changed **after** load — AJAX results, infinite scroll, cart drawers, and SPA widgets.

- **How it works:** a `MutationObserver` collects newly added/changed text nodes and whitelisted attributes (`alt`, `aria-label`, `placeholder`, option / button labels), then translates them through a same-origin WordPress REST proxy — the Deepglot API key never reaches the browser.
- **Enable it:** `Settings → Deepglot → WordPress settings` → enable the "translate dynamically loaded content" toggle (option `enable_dynamic_translation`, **default off**).
- **Endpoint:** `POST /wp-json/deepglot/v1/translate-dynamic` — same-origin, nonce-gated, per-IP rate-limited, bot-skipped. It reuses the same `Client` + transient cache as the server pass and returns the `{ from_words, to_words }` contract.
- **Cache-first / quota-safe:** a missing or stale nonce degrades to cache-only, so project quota is never spent without a valid same-origin nonce; full-page-cached pages still serve cached translations.
- **SEO-safe:** the initial, crawlable HTML is still produced by the server pass; this layer only enhances live interaction and is skipped for bots.
- **Extraction parity:** the skip rules and attribute whitelist are shared with the server pass via `Support\TranslationRules` (drift-guarded by `tests/TranslationRulesTest.php`); the shipped asset is covered by `tests/DynamicTranslatorAssetTest.js`.

> Status: **live QA passed on 2026-06-10** on `meinhaushalt.at` (plugin v0.8.1, flag enabled there). The toggle remains **off by default** for new installs. See [DYNAMIC_TRANSLATION_QA.md](DYNAMIC_TRANSLATION_QA.md) for the checklist and the recorded result.
