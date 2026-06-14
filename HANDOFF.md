# Deepglot Handoff - 2026-06-14

This file captures the current project state so work can continue in a new chat without relying on previous conversation context.

## Current State

- Branch: `main`
- Latest production commit: `9756310b` (`feat(billing): email the org owner when the word quota nears/hits its limit (#157)`)
- WordPress plugin **v0.8.2** deployed on `meinhaushalt.at`; dynamic-content translation **enabled** (live QA verified 2026-06-10); v0.8.2 adds `BotDetector` and quota-exhaustion signals
- SaaS quota warnings fully shipped: dashboard amber/red banner (PR #154) and bilingual owner email at 90%/100% (PR #157, `UsageAlert` table); ROADMAP 8.33 ✅ Completed
- Open pull requests: verify the current state with `gh pr list --repo ostheimer/deepglot --state open`; documentation sync PRs may be open independently of production state.
- Canonical production URL: `https://deepglot.ai`
- Production validation WordPress site: `https://www.meinhaushalt.at`

## Completed In The Latest Session (since 2026-05-06)

### SaaS Quota Warnings: Dashboard Banner + Owner Email (2026-06-14)

- **Dashboard warning banner** (ROADMAP 8.33 SaaS, PR #154, 2026-06-14): The subscription usage page now shows an amber banner at ≥90% and a red banner at ≥100% of the org's effective word limit (`getEffectiveWordsLimit`). `quotaUsageLevel()` is a pure unit-tested threshold function; `UsageCharts` uses the same limit so the word-count percentage is consistent. Dashboard half of the SaaS side of #148.
- **Bilingual owner email at 90%/100% quota** (ROADMAP 8.33 SaaS, PR #157, 2026-06-14): `/api/translate` emails the org owner once per org per month when usage crosses 90% (warning) or 100% (limit reached). Deduped via new `UsageAlert(organizationId, month, threshold)` unique table (claimed before send, rolled back on failure to allow retry). Bilingual email. 5s send timeout; a send failure is logged and never delays or fails the translation. Closes #148. ROADMAP 8.33 ✅ fully closed.

### Bot Detection & Quota Visibility, v0.8.2 (2026-06-12 – 2026-06-13)

- **Bot-traffic detection** (ROADMAP 8.32, PR #153, plugin v0.8.2, 2026-06-13): New `BotDetector` class maps visitor user-agent to a legacy bot code, threaded `OutputBuffer → HtmlTranslator → Client`. Also passes `request_url` from the plugin to the SaaS — this field was previously empty, causing gaps in per-URL analytics. The SaaS `isBot` threshold corrected from `bot >= GOOGLE` to `bot >= OTHER`, so generic crawlers are now exempt. Bots served cache-only; SEO unaffected. Test-first: `BotDetectorTest`. Closes #147. ROADMAP 8.32 closed.
- **Quota-exhaustion signals** (ROADMAP 8.33 plugin side, PRs #152 + #153, plugin v0.8.2, 2026-06-12 + 2026-06-13): Health ping now sends several real words (a 1-word ping was passing while near-empty quota already 402'd real pages). 402 classified as `connection_code: quota_exhausted`. `deepglot_quota_exhausted` transient set on first 402. Status endpoint (`/wp-json/deepglot/v1/status`) exposes `quota_exhausted` from either signal. Plugin shows wp-admin notice when exhausted. Dynamic-translator proxy returns `quota_exhausted` so browser client stops retrying for the session. Plugin half of #148; SaaS side completed in PRs #154 + #157.

### Dynamic Translator Live QA, v0.8.1 & Billing Hardening (2026-06-08 – 2026-06-10)

- **Live QA passed on `meinhaushalt.at`** (2026-06-10, plugin v0.8.1, flag enabled): injected text + accessibility attributes translate, re-translation on change, no-translate/`contenteditable` markers respected, session cache avoids repeat requests, bots 403, SEO output unchanged. Result recorded in `wordpress-plugin/deepglot/DYNAMIC_TRANSLATION_QA.md`; ROADMAP 8.27 closed.
- **Plugin v0.8.1 — runtime-sync race fix** (PR #146, found live during QA): `applyRuntimeConfig()` no longer writes the request's stale options snapshot back (cache eviction + fresh re-read), and discards payloads fetched with a stale API key or base URL. Test-first: `RuntimeConfigRaceTest` (4 scenarios). Before the fix, frontend traffic silently reverted admin saves — every setting affected.
- **Quota finding:** the meinhaushalt org had burned its 1M-word month (May >1M too); fresh translations silently returned 402 while status pings stayed green. Limit manually raised 1M → 5M (manual ENTERPRISE subscription, `stripeSubscriptionId IS NULL` verified). Follow-ups fully addressed: #147 (BotDetector, v0.8.2), #148 (quota visibility, v0.8.2 plugin + PRs #154/#157 SaaS).
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

- GitHub Actions `main` CI passed for commit `9756310b`.
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

- **Update the marketing site**: dynamic/AJAX/SPA content translation, bot-traffic protection, quota-exhaustion visibility with dashboard banner and owner email are all live — real Weglot-parity selling points worth highlighting.
- **Continue Phase 8.2/8.3** (Weglot competitive parity: multi-switcher instances, visual switcher editor, translation memory, PDF translation, multilingual sitemap) or **8.4** (Housekeeping: dead env vars, stale test duplicate).
- Keep the test-first bug workflow from `AGENTS.md`: reproduce reported UI bugs with Playwright first, then fix and prove the fix.
- For future UI audits, prefer expanding `tests/e2e/full-ui-audit.spec.ts` rather than doing one-off manual checks.
- Remaining open regression tests: **7.13** (marketing copy anti-drift guard), **7.14** (pricing slider alignment), **7.15** (Stripe webhook subscription-lifecycle smoke).
