# Reference Plugin Analysis for a WordPress Translation Solution

> Analysis date: March 2026  
> Goal: a solid foundation for a custom WordPress translation plugin without cloud lock-in

---

## 1. Architecture overview

The analyzed reference system does not rely on duplicated WordPress posts. Instead, it captures the final HTML output, extracts translatable segments, and returns a localized response to the browser.

```text
WordPress renders HTML
        ↓
Output buffering captures the response
        ↓
The parser extracts translatable strings
        ↓
Batch request to the translation API
        ↓
Links, language switcher, and SEO metadata are adjusted
        ↓
Localized output is sent to the browser
```

---

## 2. Typical plugin building blocks

The reference system is clearly split into frontend, routing, parser, API client, and supporting services. For Deepglot, these building blocks are especially relevant:

- Bootstrap and a service container for clean instantiation
- Frontend hooks for output buffering, switcher rendering, and dynamic content
- A URL service for language prefixes and canonical paths
- A parser service for HTML, JSON, and XML
- An API client for batched translation requests
- A cache layer for reusable strings
- SEO components for `hreflang`, canonicals, and alternate URLs

---

## 3. Core mechanism

The most important observation is the output-buffering approach:

1. The page is rendered normally by WordPress.
2. The completed output is captured in a buffer.
3. Only relevant text nodes and attributes are extracted.
4. The texts are sent to the API in a single batch.
5. The response is inserted back into HTML, JSON, or XML.

This approach is useful for Deepglot because it treats theme, plugin, and content output in a uniform way.

---

## 4. Routing and language paths

The reference system handles language paths through URL manipulation instead of separate content copies:

- Language prefixes such as `/de/` or `/fr/` are read from the request
- Internally, WordPress still sees the original path
- Links in HTML, JSON, and XML are rewritten to language-specific variants
- `hreflang` tags and canonicals are generated accordingly

For Deepglot, this confirms the current direction with a URL resolver and language-aware path logic.

---

## 5. API contract

A compatible API contract for a WordPress integration mainly needs:

- An API key in the query string or a Bearer header
- Source and target language
- Text segments as an array with type information
- `from_words` and `to_words` returned in the same order
- Support for bot detection, request URL, and page title

It is also important to bundle as many strings as possible into a single request. That reduces latency and simplifies caching.

---

## 6. Frontend and language switcher

The reference pattern uses a language switcher built from configuration data and can re-process content that loads later. That leads to these requirements for Deepglot:

- Prepare switcher markup on the server
- Embed configuration as JSON in the DOM
- Re-check dynamic content later
- Optionally use browser language detection for redirects

---

## 7. Relevant edge cases

These cases should be considered early in the custom plugin:

- Bot traffic should not generate unnecessary translation costs
- AJAX and REST responses need dedicated handling
- XML sitemaps must not be processed with HTML rules
- Caching plugins and hosting-specific output hooks may require special handling
- WooCommerce, Elementor, and similar builders introduce their own dynamic structures
- Canonical URLs, trailing slashes, and language redirects must stay consistent

---

## 8. Implications for Deepglot

The analysis suggests these prioritized decisions for Deepglot:

1. Keep output buffering as the central integration layer
2. Keep API requests batched and compatible with the plugin contract
3. Add a local cache inside the WordPress plugin
4. Handle link replacement separately for HTML, JSON, and XML
5. Integrate SEO logic with `hreflang`, canonicals, and language-specific URLs early
6. Add a small frontend layer later for dynamic content updates

---

## 9. Next implementation steps

- Integrate URL and language logic directly into the frontend flow
- Build parser and string extraction on top of DiDOM
- Add a local cache table for already translated segments
- Harden link replacement and SEO output
- Expand tests for HTML, JSON, and XML cases
