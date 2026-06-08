# Deepglot Handoff - 2026-06-08

This file captures the current project state so work can continue in a new chat without relying on previous conversation context.

## Current State

- Branch: `main`
- Latest production commit: `603a78d` (`fix(billing): Stripe live-subscription guard before Checkout — TOCTOU (#131)`)
- Open pull requests: verify the current state with `gh pr list --repo ostheimer/deepglot --state open`; documentation sync PRs may be open independently of production state.
- Canonical production URL: `https://deepglot.ai`
- Production validation WordPress site: `https://www.meinhaushalt.at`

## Completed Since Last Handoff (2026-06-06 – 2026-06-07)

### Dynamic Translator Post-Launch Hardening (2026-06-07)

Four hardening commits followed the v0.8.0 dynamic translation release:

- **Guard dynamic API translations by origin** (PR #133): The `/wp-json/deepglot/v1/translate-dynamic` REST endpoint now validates the request origin server-side, enforcing the same-origin constraint independently of the client JS.
- **Fix property-only input value translation** (PR #134): Input elements whose only translatable content is an attribute value (`placeholder`, `aria-label`) were silently skipped by the dynamic pass. Fixed.
- **Sync dynamic translation setting** (PR #135): The `enable_dynamic_translation` admin toggle is now included in the plugin settings sync payload so the runtime configuration reflects the current admin choice.
- **Revalidate pending dynamic exclusions** (PR #136): Dynamic translation queue items now re-check the current exclusion list on each sync cycle, discarding items that match a newly added exclusion rule.

### TOCTOU Billing Race Fix (2026-06-07)

- **PR #131**: `POST /api/billing/checkout` now calls `customerHasBlockingStripeSubscription()` — a paginated, Stripe-authoritative check — before `checkout.sessions.create`, closing the webhook-lag window where a second parallel checkout could create a duplicate paid subscription while `stripeSubscriptionId` was still `null` in the DB. Returns 409 when Stripe already has a blocking subscription. Guard fails closed on Stripe API errors (502).

### Documentation Sync (2026-06-06)

- **PR #130**: Plugin v0.8.0 docs, `DYNAMIC_TRANSLATION_QA.md` live-QA checklist, HANDOFF sync.
- **PR #132**: README corrections — `npm run test:wp`, `/docs` route, `Authorization: Bearer`, i18n-scripts section, 5 new test-coverage entries.
- **PR #129**: `.env.selfhost.example` model updated to `gpt-5-mini`; ROADMAP 7.8 marked completed.
- **PR #126**: OPERATIONS gains `i18n Development Scripts` and `Stripe Setup Scripts` sections; corrected the false claim that an admin cache-flush button exists (`TranslationCache::flush()` is unwired — requires WP-CLI or TTL expiry).

## Completed In The Latest Session (since 2026-05-06)

### Dynamic Content Translation (2026-06-05)

- **Client-side dynamic / SPA content translation** (PR #127, plugin v0.8.0, **default OFF**): a `MutationObserver` re-translates content added or changed after page load (AJAX, infinite scroll, cart drawers, SPA widgets) via a same-origin REST proxy `POST /wp-json/deepglot/v1/translate-dynamic`, so the API key never reaches the browser. Cache-first (a missing/stale nonce degrades to cache-only and never spends quota; a 403 retries without the nonce), SEO-safe (the server pass still renders the crawlable HTML), opt-in via `enable_dynamic_translation`. Shared `Support\TranslationRules` keep the JS and PHP extraction rules from drifting (drift-guarded). Closes the largest untracked Weglot gap (#120).
- **Hardened across three Codex review rounds**, including a P1 where the server's `<html translate="no">` made the dynamic pass a no-op on every translated page; plus `<textarea>` attribute parity, `contenteditable` draft protection, stale-nonce cache-only retry, raw cache-key alignment with the server pass, and attribute-mutation observation.
- **Codex daily-bug-scan automation** (PR #128) independently fixed the round-2 items and added the `tests/DynamicTranslatorAssetTest.js` fake-DOM regression harness, folded into the branch before the squash merge.
- **Next step:** live QA on `meinhaushalt.at` with the flag enabled (checklist: `wordpress-plugin/deepglot/DYNAMIC_TRANSLATION_QA.md`), then enable in production and update marketing.

### Billing, i18n & Docs (2026-05-31 – 2026-06-03)

- **Subscription cancel keeps paid quota until period end** (PR #115, 2026-06-03): `POST /api/billing/cancel` no longer writes `CANCELED` locally while Stripe still bills via `cancel_at_period_end` (the row stays `ACTIVE` until the `customer.subscription.updated`/`deleted` webhook). Prevents premature FREE soft-capping of word usage and a duplicate-Checkout window. Webhook `subscription.updated` now keeps the existing plan on unknown price ids via `tryResolvePlanKeyByStripePriceId()` instead of silently downgrading.
- **Block duplicate Checkout for PAST_DUE subscriptions** (PR #110, 2026-05-30): `POST /api/billing/checkout` only rejected ACTIVE/TRIALING; PAST_DUE orgs could start a second Stripe subscription via direct API. Extended guard via `blocksNewCheckoutForExistingSubscription()` — blocks any non-`CANCELED` row that has a `stripeSubscriptionId`; plan changes go through the billing portal.
- **README documentation audit** (PR #114, 2026-06-03): Documented the public English legal routes (`/terms`, `/privacy`, `/legal-notice`), `TranslationSource.GOOGLE` as a reserved (non-configurable) source, and the `Plan` enum tiers incl. the `PROFESSIONAL` → `PRO` normalization. Also documents `Authorization: Bearer <key>` as an alternative to `?api_key=` on `POST /api/translate`.
- **Fix singular/plural and casing in pricing plan spec line** (PR #113, 2026-05-31): The selected-plan card spec line now inflects the language/project nouns per locale via Unicode CLDR plural rules (`Intl.PluralRules`), so FREE reads "1 Sprache · 1 Projekt" and Slavic tiers render correct paucal/plural forms across all 24 locales.
- **Fix OpenRouter example translation model** (PR #112, 2026-05-31): `.env.example` OpenRouter model aligned to `openai/gpt-5-mini` (runtime default); regression test keeps `.env.example` values in sync with `DEFAULT_*` constants. (PR #116, which would have reverted the OpenAI default to `gpt-4o-mini`, was reviewed and closed as a regression.)

### Security Hardening (2026-05-27 – 2026-05-30)

- **Regression test for Languages-page management gating** (PR #109, 2026-05-30): Source-level guardrail asserting `AddLanguageDialog` renders only for managers; prevents silent regressions of the auth gate added in PR #103.
- **Block new Checkout when org already has live subscription** (PR #108, 2026-05-30): `POST /api/billing/checkout` now returns HTTP 409 when the org already has an ACTIVE or TRIALING subscription, directing to the billing portal instead. Prevents double-billing.
- **Require management to add/remove project languages** (PR #103, 2026-05-30): IDOR fix — `DELETE /api/projects/[id]/languages` had no authorization at all; `POST` gated only on org membership. Both now require `userCanManageProject`. Language code validated via Zod.
- **Hide language add control from non-managers on Languages page** (PR #106, 2026-05-30): UI control for adding languages now only visible to managers, mirroring the API gate from PR #103.
- **Settings UX improvements** (PR #104, 2026-05-30): Visual editor launcher now only offers active target languages within the user's access scope; webhook URL field shows a public-HTTPS hint matching the SSRF guard.
- **Block SSRF in webhook delivery** (PR #100, 2026-05-29): New `src/lib/webhook-url-safety.ts` classifies private/reserved IPv4+IPv6 ranges and internal hostnames. Enforced at create/update (400) AND at dispatch (re-checks resolved IPs to defeat DNS rebinding). Redirects disabled. Response body capped at 512 chars to limit read-back.
- **Harden visual-editor session tokens** (PR #98, 2026-05-29): Language scope bound into the token; `langTo` enforced in `/manual-translations` (language-scoped translator cannot edit other languages). Rate limiting per project on the manual-translations write path.
- **Harden project import/export** (PR #96, 2026-05-29): `MAX_IMPORT_ROWS` cap; chunked writes (one short transaction per chunk); CSV/formula injection protection (CWE-1236) via leading apostrophe; per-language scope for translators; usage attributed per language pair; PO export filename sanitized.
- **Require management for settings-area API routes** (PR #95, 2026-05-29): IDOR fix — project DELETE/PATCH and api-key create/revoke checked only org membership; webhooks and exclusions routes used the weaker `userHasProjectAccess`. All switched to `userCanManageProject`. Source-level guardrail test added.
- **Fix tsc failure on Stripe webhook test mock** (PR #97, 2026-05-29): Type-correct mock arguments so `tsc --noEmit` passes on the test files.
- **Add full tsc --noEmit typecheck to CI** (PR #99, 2026-05-29): New `typecheck` npm script; runs as a dedicated CI step after install so type errors outside the Next.js build graph are caught.
- **Guard Stripe customer API calls** (PR #92, 2026-05-30): All Stripe customer API calls use `isRealStripeCustomerId()` to avoid hitting the Stripe API with placeholder IDs.
- **isRealStripeCustomerId() centralization** (PR #89, 2026-05-27): `manual_<orgId>` placeholder was not excluded by the existing `free_`-only check, causing Stripe 404s for ENTERPRISE orgs. Centralized as `isRealStripeCustomerId()` (allowlist `cus_…` pattern); adopted across three call sites.

### Feature Work (2026-05-17)

- **Stripe Checkout end-to-end** (PRs #56, #61, 2026-05-17): Logged-in users can now subscribe. `POST /api/billing/checkout` implemented; `/(dashboard)/subscription` pages (`/abonnement/uebersicht`, `/abonnement/nutzung`, `/abonnement/karte-rechnungen`) are live. Pricing CTAs route to the checkout flow instead of `/signup`.
- **EU-wide localization** (PR #62, 2026-05-17): Extended locale support beyond EN/DE to additional EU language codes. Public routes, auth, and dashboard routes all serve localized variants.
- **Localized route round-trip regression test** (commit `a9022fb`, 2026-05-17): New Playwright test ensures localized routes correctly round-trip across all supported locales.
- **Fix localized marketing pricing units** (PR #65, 2026-05-17): Pricing hero claims on localized routes are now sourced from `BILLING_PLANS`, not hardcoded strings. Closes a silent drift risk for the Pro tier price/word-ceiling across locales.
- **Localize remaining metadata** (PR #66, 2026-05-17): All `<head>` metadata (title, description, OG tags) rendered in the request locale.
- **Plugin v0.7.0 — per-language custom flag override** (PR #53, 2026-05-14): Each language in the switcher can now use a custom flag image instead of the default emoji/CDN flag.
- **Plugin v0.6.0 — responsive hide** (PR #52, 2026-05-14): Switcher can be shown only on desktop or only on mobile via a new toggle.
- **Switcher aria-expanded bug fix** (PR #51, 0.5.2, 2026-05-14): `aria-expanded` attribute is now only added when the dropdown variant is active.
- **Switcher active-language + skip-plugin-link bugs** (PR #50, 0.5.1, 2026-05-13): Active language now highlighted correctly under stripped `REQUEST_URI`; `LinkRewriter` no longer rewrites the switcher's own `href` attributes.

## Latest Verified Links

- `https://deepglot.ai/`
- `https://deepglot.ai/pricing`
- `https://www.deepglot.ai/api/public/status`
- `https://www.meinhaushalt.at/en/`

## Verification Status

Latest already-completed checks:

- GitHub Actions `main` CI passed for commit `fb06aca`.
- Vercel Production deployment is ready.
- `npm run acceptance:stripe --mode live` PASS.

Run these before starting a new larger implementation branch:

```bash
npm run check:docs-language
npm run typecheck
npm test
npm run test:wp
npm run lint
npm run build
npm run smoke:production
```

Run Playwright when UI behavior changes:

```bash
npm run test:e2e
```

## Known External Blocks

- Phase 6 subdomain live QA remains blocked until a real mapped production host is configured through `DEEPGLOT_PHASE6_SUBDOMAIN_HOST`.
- Visual editor token still passed in the launch URL (`?deepglot_editor_token`); moving it out of the URL requires a coordinated WordPress-plugin change (noted in PR #98).

## Open Roadmap Items

- **8.2** Switcher Weglot-parity: multi-switcher instances, visual switcher editor, pre-made templates (P2).
- **8.3** Strategic Weglot competitive gaps: in-context visual translation editor, translation memory, glossary dashboard UI, PDF translation, multilingual sitemap, AMP verification, translation CDN (P3).
- **8.4** Housekeeping: dead `DATABASE_*` env vars and stale `AccessibilityAttributeTranslationTest 2.php` (P4).
- **7.13** Anti-drift guard for marketing copy (`marketing-home.test.ts`).
- **7.14** Playwright slider-alignment regression test for `pricing-grid.tsx`.
- **7.15** Stripe webhook end-to-end smoke for subscription-lifecycle events.

## Recommended Next Work

- **Dynamic translation live QA (P0):** enable `enable_dynamic_translation` on `meinhaushalt.at` and run the checklist in `wordpress-plugin/deepglot/DYNAMIC_TRANSLATION_QA.md`. Once verified, enable by default and update the plugin marketing.
- Continue with Phase 8.2/8.3 (Weglot competitive parity) or 8.4 (Housekeeping).
- Keep the test-first bug workflow from `AGENTS.md`: reproduce reported UI bugs with Playwright first, then fix and prove the fix.
- For future UI audits, prefer expanding `tests/e2e/full-ui-audit.spec.ts` rather than doing one-off manual checks.
