# Dynamic Content Translation — Live QA Checklist

Manual verification for the opt-in client-side translator (`assets/js/dynamic-translator.js`, plugin **v0.8.1**) before enabling it in production. The automated `tests/DynamicTranslatorAssetTest.js` covers the logic against a fake DOM; this checklist verifies real browser behavior on a real WordPress site.

> Target site: `https://www.meinhaushalt.at` (or any staging WP install with the plugin active and at least one target language configured).

## Result — PASSED (2026-06-10, meinhaushalt.at, plugin v0.8.1)

Executed live with the flag enabled. Verified: config + script on translated pages (root-relative endpoint, nonce); injected text translated despite `<html translate="no">`; `img alt` and `textarea placeholder` translated; re-translation after a text change; `contenteditable`, `data-deepglot-no-translate`, and non-root `translate="no"` untouched; session cache answers repeats with zero requests; bot user agents get 403; the anonymous server-rendered output is unchanged (SEO intact); no console errors. Not exercised live: subdomain routing (site uses path-prefix) and the per-IP 429 (covered by unit tests).

The QA surfaced and fixed two production issues: a runtime-sync race that reverted fresh admin saves (v0.8.1, PR #146) and an exhausted monthly word quota that silently returned 402 (limit raised; follow-ups [#147](https://github.com/ostheimer/deepglot/issues/147) and [#148](https://github.com/ostheimer/deepglot/issues/148)).

## Preconditions

- [ ] Plugin **v0.8.0** active; API key + at least one target language configured.
- [ ] Open `Settings → Deepglot → WordPress settings` and enable the "translate dynamically loaded content" toggle (option `enable_dynamic_translation`). Save.
- [ ] Browse to a **translated** page (e.g. `/en/...`), not the source-language page.
- [ ] Open DevTools → Network, filter for `translate-dynamic`. Open Console.

## Sanity

- [ ] `window.deepglotDynamic` is defined on the translated page, with `langTo` = the active language and `langFrom` = source.
- [ ] On the **source-language** page, `window.deepglotDynamic` is **absent** (script not enqueued).
- [ ] With the flag **off**, the script is not enqueued on any page.

## Core: content added after load (the P1 regression)

- [ ] Trigger an AJAX/JS insertion of new copy (e.g. a WooCommerce filter, "load more", a cart drawer, or `document.body.insertAdjacentHTML('beforeend','<p>Hello world</p>')` in the console).
- [ ] The inserted text is replaced with the target-language translation within ~1s.
- [ ] A `POST /wp-json/deepglot/v1/translate-dynamic` fires and returns `200` with `{ from_words, to_words }`.
- [ ] **Critical (round-3 P1):** this works even though `<html>` carries `translate="no"`. Confirm `document.documentElement.getAttribute('translate') === 'no'` and translation still happens.

## Re-translation on change (SPA)

- [ ] A node that updates in place (e.g. a mini-cart count `1 item` → `2 items`) is re-translated, not left in the source language.
- [ ] Our own writes do not loop (no repeated requests for the same string; the Network tab shows one request per unique string).

## Attributes & accessibility

- [ ] An injected element with **only** an attribute gets that attribute translated: `<img alt>`, `<button aria-label>`, `<input placeholder>`, submit/button `value`, `<option label>`.
- [ ] **Round-3:** a `<textarea placeholder="…">` has its placeholder translated even though textarea **text** content is never translated.
- [ ] An attribute set **after** the element mounts (e.g. JS later sets `placeholder`) is still translated (attribute mutations are observed).

## Must NOT translate

- [ ] **contenteditable:** type into a comment box / rich-text editor (`contenteditable`). No `translate-dynamic` request fires for the typed text; the draft is never altered. (Privacy + UX.)
- [ ] Subtrees marked `data-deepglot-no-translate` (e.g. the language switcher) are untouched.
- [ ] Elements/ancestors with `translate="no"` (other than the `<html>` root) are skipped.
- [ ] Excluded CSS selectors (Settings → Exclusions) are skipped.
- [ ] Excluded URLs: on a URL excluded under Settings, the script is **not** enqueued and no dynamic translation occurs.
- [ ] Content inside `<script>`, `<style>`, `<pre>`, `<code>`, `<svg>`, `<math>` text is not translated.

## SEO / bots

- [ ] `view-source:` of a translated page shows the fully server-translated HTML (the dynamic layer changes nothing for crawlers).
- [ ] With a bot user-agent (`curl -A "Googlebot" …` against `/translate-dynamic`) the endpoint returns `403`.

## Routing modes

- [ ] **Path-prefix** (`/en/...`): dynamic translation works.
- [ ] **Subdomain** (`en.example.com`, if configured): the `translate-dynamic` request is **same-origin** (goes to the mapped host, not the source host) and succeeds — confirm cookies/nonce are sent and there is no CORS/403. (Round-1 fix.)

## Cost & abuse controls

- [ ] **Cache-first:** reload the page and re-trigger the same dynamic content — strings already translated return from cache (verify in the dashboard usage that quota is not re-spent for repeats).
- [ ] **Stale nonce / full-page cache:** on a hard-cached page whose nonce has expired, the first request `403`s and a second request **without** `X-WP-Nonce` follows; cached translations still render. (Round-3 fix.)
- [ ] **Quota exhausted / API miss:** strings the endpoint does not return are left as source text and are **not** resent on every later scroll/mutation (no request storm). (Round-2 fix.)
- [ ] **Rate limit:** rapid repeated requests from one IP eventually receive `429`.

## Performance

- [ ] No visible jank on infinite scroll / large AJAX inserts; requests are batched (≤200 strings) and debounced (~200ms).
- [ ] No console errors from `dynamic-translator.js`.

## Sign-off

- [ ] All boxes checked on `meinhaushalt.at`.
- [ ] Bump nothing further; enable `enable_dynamic_translation` in production config.
- [ ] Update the marketing site to list dynamic/AJAX/SPA content translation (Weglot-parity point).
