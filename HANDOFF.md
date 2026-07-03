# Deepglot Handoff - 2026-07-01

This file captures the current project state so work can continue in a new chat without relying on previous conversation context.

## Current State

- Branch: `main`
- Latest production commit: `126f27a` (`fix(wp-plugin): guard translation cache against bot identity poisoning (v0.8.3) (#185)`)
- WordPress plugin **v0.8.3 deployed on `meinhaushalt.at` (2026-07-03)** and live-verified: asset versions serve `?ver=0.8.3`, the human path renders translated pages, the bot path (curl UA) serves 200 cache-only. The pre-fix poisoned transient cache was flushed (239,624 `dg_` rows deleted) and re-warmed by human traffic with real English translations only — no identity mappings reappeared, confirming the #163 guard live. WP Rocket page cache purged in the same pass. (The 2026-06-10 dynamic-content-translation QA ran on v0.8.1 and still covers that feature; a dedicated quota-exhaustion live drill remains optional.)
- Open pull requests: verify the current state with `gh pr list --repo ostheimer/deepglot --state open`; documentation sync PRs may be open independently of production state.
- Canonical production URL: `https://deepglot.ai`
- Production validation WordPress site: `https://www.meinhaushalt.at`

## Completed In The Latest Session (since 2026-06-10)

### Quota Visibility, Bot-Traffic Fix & Provider Reliability (2026-06-11 – 2026-07-02)

- **Plugin v0.8.3 — bot cache-poisoning guard** (2026-07-02, ROADMAP 8.35, closes [#163](https://github.com/ostheimer/deepglot/issues/163)): when a bot was the first visitor of an uncached page, the SaaS cache-only fallback returned `to_words == from_words` and `HtmlTranslator` persisted those identity mappings into the 30-day transient cache — later human visitors saw untranslated source text until the transient expired. `translateDocument()` now drops identity pairs from the cache write when the request carries a bot code (`bot >= BotDetector::OTHER`); real translations inside a bot response (SaaS cache hits) stay cacheable, and human/provider-backed identical translations (proper nouns) are still cached. Test-first: `BotCachePoisoningTest` (bot first-visit, mixed response, post-bot human visit, legitimate identity translation).

- **Plugin v0.8.2 — BotDetector + quota exhaustion surfacing** (commit `f30b021`, PR #153, 2026-06-13, ROADMAP 8.32, closes [#147](https://github.com/ostheimer/deepglot/issues/147) + plugin side of [#148](https://github.com/ostheimer/deepglot/issues/148)): Investigation of meinhaushalt.at's ~1M words/month found crawlers billed as human (plugin hardcoded `bot:0`; SaaS treated `BotType.OTHER` as human). New `BotDetector` maps the visitor UA to the legacy bot code; bots are now served cache-only, so cached translated URLs remain crawlable while uncached translated URLs fall back to source-language content until a human visit warms the cache. Also threads `request_url` (previously empty) through `OutputBuffer → HtmlTranslator → Client`. SaaS correction: `isBot` now checks `bot >= OTHER`. Quota-exhaustion visibility: `deepglot_quota_exhausted` transient + wp-admin notice + status `quota_exhausted` + dynamic-translator proxy returns `quota_exhausted` so the browser stops retrying. Test-first: `BotDetectorTest` + 402 scenarios in controller/JS tests. Follow-up [#163](https://github.com/ostheimer/deepglot/issues/163) (identity mappings poisoning the transient cache) fixed in v0.8.3, see below.
- **Dashboard quota usage warnings** (commit `17d04c2`, PR #154, 2026-06-14, SaaS side of [#148](https://github.com/ostheimer/deepglot/issues/148)): the usage page now shows an amber banner at ≥90% and a red "limit reached" banner at ≥100% of the org's effective word limit (`getEffectiveWordsLimit`). `UsageCharts` uses the same limit for a consistent percentage. Threshold logic extracted to a pure, unit-tested `quotaUsageLevel()`.
- **Owner email alert for quota thresholds** (commit `9756310`, PR #157, 2026-06-14, ROADMAP 8.33, closes [#148](https://github.com/ostheimer/deepglot/issues/148)): `/api/translate` emails the org owner once per org per month at 90% (accepted increment crosses the warning line) and 100% (request rejected with 402). Deduped via a new `UsageAlert(organizationId, month, threshold)` unique table (applied additively to prod + preview; claimed before send, rolled back on failure to allow retry). Send bounded by 5s timeout; the orchestrator never fails/delays the translation. Bilingual owner email. `UsageAlert` model added to `prisma/schema.prisma`. Threshold math + email payload unit-tested.
- **Billing quota alert HTML escaping** (commit `047384b`, PR #165, 2026-06-15): fixes HTML escaping in the quota alert email body introduced in the 8.33 email. Pure bugfix.
- **quota_probe cache-hit fix** (commit `66f8dca`, PR #155, 2026-06-15, ROADMAP 8.34): `/api/translate` was skipping the monthly quota check when every word was a cache hit, so the WP plugin health ping could stay green while real translations returned 402. The `quota_probe` flag (used by the WP plugin status/test-connection ping) now rejects exhausted quotas even on cache hits; visitor cache-only traffic remains unaffected.
- **Gemini default moved to the stable model id** (commit `ab4e299`, PR #140, 2026-07-01): `DEFAULT_GEMINI_TRANSLATION_MODEL` switched from the `gemini-3.1-flash-lite-preview` alias to the stable `gemini-3.1-flash-lite`. Google retires preview aliases once the stable ships, and Gemini is the default fallback in `buildFallbackProviderChain` — a retired id would 500 every `/api/translate` call on the openai → gemini chain. Regression test pins the default to a non-`-preview` id.
- **Terminal provider failures now logged at error level** (commit `748f9b6`, PR #139, 2026-07-01): when the last provider in the fallback chain fails (or a non-failover error occurs), `translateTexts` logs the failing provider, the attempted chain, and up to 500 chars of the upstream error at error level; recoverable hops stay warnings with full detail. Closes the observability gap from the `/api/translate` outage where only a generic route error was visible.

## Completed In Prior Sessions (since 2026-05-06)

### Dynamic Translator Live QA, v0.8.1 & Billing Hardening (2026-06-08 – 2026-06-10)

- **Live QA passed on `meinhaushalt.at`** (2026-06-10, plugin v0.8.1, flag enabled): injected text + accessibility attributes translate, re-translation on change, no-translate/`contenteditable` markers respected, session cache avoids repeat requests, bots 403, SEO output unchanged. Result recorded in `wordpress-plugin/deepglot/DYNAMIC_TRANSLATION_QA.md`; ROADMAP 8.27 closed.
- **Plugin v0.8.1 — runtime-sync race fix** (PR #146, found live during QA): `applyRuntimeConfig()` no longer writes the request's stale options snapshot back (cache eviction + fresh re-read), and discards payloads fetched with a stale API key or base URL. Test-first: `RuntimeConfigRaceTest` (4 scenarios). Before the fix, frontend traffic silently reverted admin saves — every setting affected.
- **Quota finding:** the meinhaushalt org had burned its 1M-word month (May >1M too); fresh translations silently returned 402 while status pings stayed green. Limit manually raised 1M → 5M (manual ENTERPRISE subscription, `stripeSubscriptionId IS NULL` verified). Follow-ups [#147](https://github.com/ostheimer/deepglot/issues/147) and [#148](https://github.com/ostheimer/deepglot/issues/148) resolved by 8.32–8.34 (see the latest session above); root cause confirmed as bot traffic.
- **Email alert on duplicate Stripe subscription** (PR #145): operations email from the `checkout.session.completed` duplicate branch; recipient `DEEPGLOT_BILLING_ALERT_EMAIL` (set in Vercel Production); at-most-once via Stripe-metadata marker written only after a real send; 5s send timeout; untracked-subscription guards in subscription.updated/invoice handlers. OPERATIONS runbook updated (PR #143).
- **Checkout concurrency closed** (PRs #131 + #142, issues #138): Stripe-authoritative subscription guard (paginated) + open-session reuse/expire + duplicate flagging; ROADMAP 8.28/8.29.
- **Docs triage:** #132 (test command, routes, test list — trimmed against #130), #129 (self-host model default, Phase 7.8 status), #126 (provider list, i18n/glossary/Stripe script docs — corrected a non-existent admin cache-flush claim).

### Dynamic Content Translation (2026-06-05)

- **Client-side dynamic / SPA content translation** (PR #127, plugin v0.8.0, **default OFF**): a `MutationObserver` re-translates content added or changed after page load (AJAX, infinite scroll, cart drawers, SPA widgets) via a same-origin REST proxy `POST /wp-json/deepglot/v1/translate-dynamic`, so the API key never reaches the browser. Cache-first (a missing/stale nonce degrades to cache-only and never spends quota; a 403 retries without the nonce), SEO-safe (the server pass still renders the crawlable HTML), opt-in via `enable_dynamic_translation`. Shared `Support\TranslationRules` keep the JS and PHP extraction rules from drifting (drift-guarded). Closes the largest untracked Weglot gap (#120).
- **Hardened across three Codex review rounds**, including a P1 where the server's `<html translate="no">` made the dynamic pass a no-op on every translated page; plus `<textarea>` attribute parity, `contenteditable` draft protection, stale-nonce cache-only retry, raw cache-key alignment with the server pass, and attribute-mutation observation.
- **Codex daily-bug-scan automation** (PR #128) independently fixed the round-2 items and added the `tests/DynamicTranslatorAssetTest.js` fake-DOM regression harness, folded into the branch before the squash merge.
- ~~Next step: live QA on `meinhaushalt.at`~~ — done 2026-06-10, see the session above; marketing update is the remaining step.

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
- **8.4** Housekeeping: remove dead `DATABASE_*` Neon-integration env vars. The stale `AccessibilityAttributeTranslationTest 2.php` duplicate has already been removed from the repo — only the env-var cleanup remains (P4).
- **7.13** Anti-drift guard for marketing copy (`marketing-home.test.ts`).
- **7.14** Playwright slider-alignment regression test for `pricing-grid.tsx`.
- **7.15** Stripe webhook end-to-end smoke for subscription-lifecycle events.

## Recommended Next Work

- **Finalize the public legal pages** before commercial launch ([#159](https://github.com/ostheimer/deepglot/issues/159)): `/terms`, `/privacy`, and `/legal-notice` still carry placeholder content on the live domain.
- **Update the marketing site**: dynamic/AJAX/SPA content translation is live and QA-verified (Weglot-parity selling point); the bot-traffic and quota protections (v0.8.2) also warrant a mention ([#160](https://github.com/ostheimer/deepglot/issues/160)).
- **Optional: quota-exhaustion live drill on `meinhaushalt.at`**: v0.8.3 is deployed and the bot/cache behavior is live-verified (2026-07-03, see Current State); what has not been exercised live is the full quota-exhaustion signal chain (402 → wp-admin notice → owner email) — only needed if an end-to-end drill is desired.
- **Run a full production acceptance suite** (`npm run acceptance:production`) to close the gap acknowledged in PRODUCTION_ACCEPTANCE.md — the security and quota-visibility changes 8.12–8.34 are deployed but no formal acceptance run has been documented since 2026-05.
- Continue with Phase 8.2/8.3 (Weglot competitive parity) or 8.4 (Housekeeping: dead env vars).
- Keep the test-first bug workflow from `AGENTS.md`: reproduce reported UI bugs with Playwright first, then fix and prove the fix.
- For future UI audits, prefer expanding `tests/e2e/full-ui-audit.spec.ts` rather than doing one-off manual checks.
