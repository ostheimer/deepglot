# Deepglot Roadmap

> Website translation platform without cloud lock-in: SaaS platform + self-hosted option  
> Stack: Next.js 16 · TypeScript · Tailwind CSS · shadcn/ui · NextAuth v5 · Neon (PostgreSQL) · Prisma · Stripe · OpenAI / DeepL

---

## Project Operations

| # | Task | Status |
|---|---|---|
| 0.1 | GitHub repository is public with a protected `main` branch | ✅ Completed |
| 0.2 | Project documentation is standardized in English | ✅ Completed |
| 0.3 | Public routing uses English on root and German under `/de` | ✅ Completed |
| 0.4 | App-wide locale switching uses canonical English paths with German under `/de` | ✅ Completed |
| 0.5 | Vendor-neutral terminology in code and core documentation | ✅ Completed |
| 0.6 | Playwright E2E coverage verifies locale switching, redirects, and localized auth entry points | ✅ Completed |
| 0.7 | Automated Markdown documentation language check in npm scripts and GitHub Actions | ✅ Completed |
| 0.8 | CI/CD verifies PRs in GitHub Actions while Vercel Git integration deploys Preview and Production by branch | ✅ Completed |
| 0.9 | Manual Vercel CLI deployments ignore local `.env*` files via `.vercelignore` | ✅ Completed |
| 0.10 | Repository-level `AGENTS.md` defines a test-first bug workflow before fixes | ✅ Completed |
| 0.11 | Vercel Production uses Neon `prod` branch; Dev/Preview use Neon `preview` (Variant A: 2 branches) | ✅ Completed |
| 0.12 | Production is served on the canonical `deepglot.ai` domain with `www` page redirects | ✅ Completed |
| 0.13 | EU-wide localization: public routes, auth, and dashboard serve additional EU language codes beyond EN/DE; localized route round-trip regression test guards regressions | ✅ Completed |

---

## Architecture Overview

```
Next.js App (Vercel)          WordPress Plugin
├── Landing / Marketing  ←──  Install WP plugin
│   ├── EN on `/` and `/pricing`
│   └── DE on `/de` and `/de/pricing`
├── Auth (NextAuth v5)         ↓
│   ├── EN on `/login` and `/signup`
│   └── DE on `/de/login` and `/de/signup`
├── Dashboard            ←──  API key from dashboard
│   ├── Canonical EN paths like `/dashboard`, `/projects`, `/subscription`
│   ├── German locale paths under `/de/...`
│   ├── Proxy rewrites canonical routes to the current app structure
│   └── Locale switcher keeps users on the matching localized page
├── CI / CD
│   ├── `main` deploys to Vercel Production
│   ├── Non-`main` pushes deploy to Vercel Preview
│   └── Local + Preview share Neon `preview`, Production uses Neon `prod`
├── API Routes
│   ├── /api/translate   ←──  Plugin endpoint
│   ├── /api/projects
│   └── /api/webhooks/stripe
└── Billing (Stripe)
```

---

## Phase 1 - Foundation (MVP)

| # | Task | Status |
|---|---|---|
| 1.1 | Initialize the Next.js 16 project (TypeScript, App Router, Tailwind, shadcn/ui) | ✅ Completed |
| 1.2 | Prisma schema: User, Organization, Project, Translation, ApiKey, Subscription | ✅ Completed |
| 1.3 | Configure Neon PostgreSQL adapter (Prisma 7 + `@prisma/adapter-neon`) | ✅ Completed |
| 1.4 | NextAuth v5: Credentials + GitHub/Google OAuth | ✅ Completed |
| 1.5 | Stripe integration: products, webhook handlers, subscription management | ✅ Completed |

---

## Phase 2 - Dashboard and Core Features

| # | Task | Status |
|---|---|---|
| 2.1 | Landing page (marketing, pricing, features) | ✅ Completed |
| 2.1a | Public locale routing: English root + German `/de` routes | ✅ Completed |
| 2.2 | Dashboard layout + navigation (sidebar, header) | ✅ Completed |
| 2.3 | Auth pages (sign in, register) + edge proxy routing | ✅ Completed |
| 2.3b | Local/Preview test login with auto-provisioned demo workspace and project | ✅ Completed |
| 2.3a | App-wide EN/DE UI with route-aware language switcher | ✅ Completed |
| 2.4 | Dashboard overview (stats, projects, usage display) | ✅ Completed |
| 2.5 | Project management: overview, create flow, language selection | ✅ Completed |
| 2.6 | Project detail view: 7-section sidebar navigation based on the reference UI | ✅ Completed |
| 2.6a | Project tools: API-key creation, page-view activation, and visual-editor launch handoff | ✅ Completed |
| 2.7 | Translations / Languages: language pairs with word count + manual percentage | ✅ Completed |
| 2.8 | Translations / URLs: paginated URL list with word counts | ✅ Completed |
| 2.9 | Translations / Glossary: glossary rules + empty state | ✅ Completed |
| 2.10 | Translations / URL Slugs: slug management with auto-translate | ✅ Completed |
| 2.11 | Statistics: monthly trend (bar chart), top URLs | ✅ Completed |
| 2.12 | API key management per project | ✅ Completed |
| 2.13 | Extend Prisma schema: `GlossaryRule`, `UrlSlug`, `TranslationExclusion`, `TranslatedUrl` | ✅ Completed |

---

## Phase 3 - Translation Engine

| # | Task | Status |
|---|---|---|
| 3.1 | DeepL API integration (batch requests, error handling) | ✅ Completed |
| 3.2 | OpenAI translation provider + configurable provider abstraction (`openai`, `deepl`, `mock`) | ✅ Completed |
| 3.3 | Plugin API endpoint (`POST /api/translate`) | ✅ Completed |
| 3.4 | Caching layer (hash-based, DB lookup before API call) | ✅ Completed |
| 3.5 | Rate limiting + API key validation | ✅ Completed |
| 3.6 | Word counting + usage tracking per subscription | ✅ Completed |

---

## Phase 4 - WordPress Plugin

| # | Task | Status |
|---|---|---|
| 3.7 | Settings: General (toggles, website type, industry) | ✅ Completed |
| 3.8 | Settings: Language model (configuration + testimonial) | ✅ Completed |
| 3.9 | Settings: Language switcher (toggles, CSS, language order, drag and drop) | ✅ Completed |
| 3.10 | Settings: Translation exclusions (excluded URLs + blocks) | ✅ Completed |
| 3.11 | Settings: Setup (API key display + WordPress installation guide) | ✅ Completed |
| 3.12 | Settings: WordPress settings (email, search, AMP) | ✅ Completed |
| 3.13 | Settings: Project members (table, roles, invitations) | ✅ Completed |
| 3.14 | Prisma: `ProjectSettings` + `ProjectMember` models | ✅ Completed |
| 3.15 | Global account settings (My Account, password, 2FA, notifications, workspaces) | ✅ Completed |
| 3.16 | API routes: `PATCH /api/user`, `PATCH /api/user/password`, `DELETE /api/user` | ✅ Completed |
| 3.17 | Billing: plan overview, card & invoices, usage (pie charts) | ✅ Completed |
| 3.18 | API routes: `POST /api/billing/portal`, `/cancel`, `/address` | ✅ Completed |
| 3.18a | Billing portal return URL uses `AUTH_URL` with fallback to `NEXT_PUBLIC_APP_URL` plus test coverage | ✅ Completed |
| 3.19 | Production fix: edge-safe auth / proxy split + routing tests | ✅ Completed |
| 3.19a | Production fix: localized rewrite cookies + Playwright route coverage | ✅ Completed |
| 3.19b | Local dev fix: remove deprecated duplicate `middleware.ts` and keep `proxy.ts` as the single request entrypoint | ✅ Completed |
| 3.19c | Local DB fix: only use the Neon adapter for real Neon hosts so localhost PostgreSQL works for dev/test fallback | ✅ Completed |
| 3.19d | Local auth fix: register OAuth providers only when configured and use hard redirects after credentials sign-in | ✅ Completed |
| 3.20 | Production fix: root route `/` switched to the real marketing landing page | ✅ Completed |
| 3.21 | Standardize author / project metadata to Andreas Ostheimer | ✅ Completed |
| 4.1 | Plugin scaffold (`plugin.php`, autoloader, service container) | ✅ Completed |
| 4.2 | URL class (language from URL, `$_SERVER` manipulation) + `RequestRouter` (rewrite rules) | ✅ Completed |
| 4.3 | Output buffer + HTML parser (DOMDocument, no external deps) + full translate pipeline | ✅ Completed |
| 4.4 | Deepglot API client (HTTP requests to the Next.js backend) | ✅ Completed |
| 4.5 | Local translation cache (WordPress transients, no custom table needed) | ✅ Completed |
| 4.6 | Link replacement (internal `<a>`, `<form>`, `<link rel=canonical>`) | ✅ Completed |
| 4.7 | `hreflang` tags + SEO | ✅ Completed |
| 4.8 | Language switcher (shortcode `[deepglot_switcher]` + action hook) | ✅ Completed |
| 4.9 | Admin settings page (API key, languages, exclusions) | ✅ Completed |
| 4.10 | End-to-end live test: jobspot.at/en/ served in English via Deepglot pipeline | ✅ Completed |
| 4.11 | UX: API key auto-generated on project creation with one-time display banner | ✅ Completed |
| 4.12 | WP Plugin: guided 3-step setup wizard + redirect to settings on first activation | ✅ Completed |
| 4.13 | WP Plugin: REST API v1 (CRUD settings, status, test-connection) with auth + rate limiting | ✅ Completed |

---

## Phase 5 - Self-Hosted Option

| # | Task | Status |
|---|---|---|
| 5.1 | Docker Compose setup (Next.js app + PostgreSQL) | ✅ Completed |
| 5.2 | Environment configuration for self-hosting | ✅ Completed |
| 5.3 | Installation guide | ✅ Completed |

---

## Phase 6 - Post-MVP Extensions

| # | Task | Status |
|---|---|---|
| 6.0 | Shared foundation: plugin settings sync, batch translation logs, and log-backed usage accounting | ✅ Implemented |
| 6.1 | Visual translation editor (edit directly on the live site) | ✅ Implemented; dashboard flow and backend-verified WordPress live boot covered by Phase 6 acceptance |
| 6.2 | Glossary feature (terms that should never be translated) | ✅ Implemented and covered by Phase 6 Playwright acceptance |
| 6.3 | Import / export (CSV / PO files) | ✅ Implemented and covered by Phase 6 Playwright acceptance |
| 6.4 | WooCommerce email translation | ✅ Implemented and covered by WordPress PHP acceptance |
| 6.5 | Browser-language auto redirect | ✅ Implemented and enabled on `meinhaushalt.at` after live skip-context verification |
| 6.6 | Subdomain support (`de.example.com`) | 🔄 Implemented; path-prefix default verified, mapped-host live QA blocked until a production host is configured |
| 6.7 | Analytics dashboard (translation volume, language stats) | ✅ Implemented and covered by Phase 6 Playwright acceptance |
| 6.8 | Webhook events (for new translations, etc.) | ✅ Implemented and covered by Phase 6 Playwright and production observability acceptance |

---

## Phase 7 - Production Acceptance and Hardening

| # | Task | Status |
|---|---|---|
| 7.1 | Canonical domain cutover: DNS, Vercel aliases, production env URLs, and WordPress API base URL smoke test | ✅ Completed |
| 7.2 | Production acceptance checklist and repeatable smoke script | ✅ Completed |
| 7.3 | Live WordPress acceptance on `meinhaushalt.at` using the current plugin build | ✅ Completed |
| 7.4 | Phase 6 Playwright coverage for glossary, import/export, analytics, webhooks, and visual editor | ✅ Completed |
| 7.5 | WordPress PHP coverage for subdomain routing, browser redirect edge cases, and WooCommerce email translation | ✅ Completed |
| 7.6 | Production observability: webhook cron monitoring, failed delivery visibility, and operational runbook | ✅ Completed |
| 7.7 | Persistent API rate limiting and abuse controls for multi-instance production traffic | ✅ Completed |
| 7.8 | Neon production backup/restore drill and Stripe live-mode billing acceptance | ✅ Completed — Neon restore drill passed; Stripe live-mode billing acceptance passed 2026-05-17 (see Phase 8.1 and 8.5) |
| 7.9 | Decide and enforce legacy Vercel alias policy | ✅ Completed |
| 7.10 | Autonomous Phase 6 acceptance suite and production acceptance integration | ✅ Completed |
| 7.11 | Autonomous SaaS acceptance for auth, project flow, translation API, and runtime sync | ✅ Completed |
| 7.12 | Full public/authenticated UI navigation audit with Playwright coverage and production release | ✅ Completed |
| 7.13 | Anti-drift guard for marketing copy: a `marketing-home.test.ts` (or lint rule) that scans `src/components/marketing/marketing-home.tsx` for hardcoded €/word tokens not sourced from `BILLING_PLANS`, so the Pro tier price and word ceiling can never silently disagree with the canonical plan again (regression of the `EUR 49 / 1M words` hero claim fixed in PR #38). Implemented 2026-07-03 as `src/lib/marketing-home-drift-guard.test.ts`: asserts the BILLING_PLANS wiring, allowlists competitor-comparison EUR tokens, fails on any hardcoded EUR amount that collides with a real plan price, and rejects literal word amounts in string literals. | ✅ Completed |
| 7.14 | Playwright slider-alignment regression test: drive `src/components/marketing/pricing-grid.tsx` through every `BILLING_PLAN_KEYS` index and assert the thumb's centre pixel is within ±2px of the active tick label's centre. Prevents future flex/absolute layout drifts of the kind fixed in PR #38. Implemented 2026-07-03 as `tests/e2e/pricing-slider-alignment.spec.ts`: re-implements the native thumb travel math independently of the component CSS and asserts every tick-label centre within ±2px, verified by the CI e2e run. | ✅ Completed |
| 7.15 | Stripe webhook end-to-end smoke for subscription-lifecycle: trigger `customer.subscription.deleted`, `customer.subscription.updated`, and `invoice.payment_failed` in Stripe test mode against `/api/webhooks/stripe` and assert that `Subscription.status`, `plan`, and `wordsLimit` are written as expected, with `getEffectiveWordsLimit` returning the FREE soft-cap for non-ACTIVE/TRIALING statuses. Closes the verification gap behind PR #37's grace-period policy. Implemented 2026-07-03 as `scripts/stripe-webhook-smoke.ts` (`npm run smoke:stripe-webhooks`, locally signed events — explicit `DEEPGLOT_WEBHOOK_SMOKE_BASE_URL` targeting, disposable org, cleanup in finally). First run 5/5 PASS against a local server + the shared dev/preview Neon branch: signature gate 400, status updates, PAST_DUE with `getEffectiveWordsLimit` FREE soft-cap (25,000 stored → 10,000 effective), deleted → CANCELED+FREE on subscription and organization. | ✅ Completed |

---

## Phase 8 - Live Commerce and Competitive Parity

Captured at the close of the 2026-05 working session. Each open item has a tracking GitHub issue; this table is the prioritised index.

| ID | Description | Status |
|---|---|---|
| 8.1 | **Stripe Checkout end-to-end** ([#56](https://github.com/ostheimer/deepglot/issues/56), [#61](https://github.com/ostheimer/deepglot/issues/61)). Stripe Live is fully provisioned (5 products, 10 prices, webhook, 13 prod env vars). Logged-in users can now subscribe via `POST /api/billing/checkout` and the `/(dashboard)/subscription` pages (`/abonnement/uebersicht`, `/abonnement/nutzung`, `/abonnement/karte-rechnungen`). Pricing CTAs route to the checkout flow. Implemented 2026-05-17. | ✅ Completed |
| 8.2 | **Switcher Weglot-parity remainder** ([#57](https://github.com/ostheimer/deepglot/issues/57)): multi-switcher instances, visual switcher editor (drag-on-live-preview), pre-made templates. Plugin v0.7.0 already live with admin UI / 5 flag styles / nav-menu / Gutenberg block / classic widget / responsive-hide / per-language custom flags. P2. | ⏳ Open |
| 8.3 | **Strategic Weglot competitive gaps** ([#58](https://github.com/ostheimer/deepglot/issues/58)): in-context visual translation editor, translation memory, glossary dashboard UI, PDF translation, multilingual sitemap, AMP verification, translation CDN. P3, sequence after 8.1. | ⏳ Open |
| 8.4 | **Housekeeping** ([#59](https://github.com/ostheimer/deepglot/issues/59)). Completed 2026-07-03: the orphaned `DATABASE_URL`/`DATABASE_URL_UNPOOLED` vars were removed from all three Vercel scopes after verifying (a) `DEEPGLOT_DATABASE_URL` is set everywhere and byte-identical to the legacy values, (b) `prisma generate` succeeds with no DB env at all (clean-room test), and (c) CI uses its own local Postgres URLs. `prisma.config.ts` now mirrors the runtime precedence (`DEEPGLOT_DATABASE_URL` first). The `DATABASE_POSTGRES_*` family and the stale duplicate test file were already gone. | ✅ Completed |
| 8.5 | Stripe Live Mode provisioning (account `acct_1GRyA0FAiA6nPZyW` "Ostheimer OG", EUR, livemode), webhook + restricted `rk_live_*` key + 13 production env vars, verified via `acceptance:stripe --mode live`. | ✅ Completed |
| 8.6 | Clean 2-dataset Neon topology made real: disconnected Vercel↔Neon per-preview auto-branching, set static `DEEPGLOT_DATABASE_URL` per scope (Production→`prod` 59 MB real data, Preview+Development→`main` 31 MB test data), pruned 55→2 branches, verified Production unaffected (HTTP 200 + Stripe live PASS + redeploy). Implements the "Variant A: 2 branches" decision below. | ✅ Completed |
| 8.7 | WP plugin language-switcher suite shipped to v0.7.0 and deployed to meinhaushalt.at: admin UI, list/dropdown, 5 flag styles, drag order, 4 fixed/floating positions, JS-free checkbox dropdown, full ARIA, nav-menu integration, Gutenberg block, classic widget, responsive-hide, per-language custom flags. Two P1 render bugs (wrong active language under stripped REQUEST_URI; LinkRewriter rewriting switcher's own hrefs) caught via Playwright visual test, fixed in PR #50. | ✅ Completed |
| 8.8 | **EU-wide localization** ([#62](https://github.com/ostheimer/deepglot/issues/62)). Extended locale support beyond EN/DE to additional EU language codes. Public routes, auth pages, dashboard routes, and marketing metadata serve localized variants. Playwright localized route round-trip regression test added. Completed 2026-05-17. | ✅ Completed |
| 8.9 | **Localize remaining metadata** ([#66](https://github.com/ostheimer/deepglot/issues/66)). All remaining `<head>` metadata (title, description, OG tags) now rendered in the request locale across all supported locales. Completed 2026-05-17. | ✅ Completed |
| 8.10 | **Fix localized marketing pricing units** ([#65](https://github.com/ostheimer/deepglot/issues/65)). Pricing page word-ceiling and price display for localized routes sourced from `BILLING_PLANS` instead of hardcoded strings, preventing the Pro tier hero claim from silently drifting across locales. Completed 2026-05-17. | ✅ Completed |
| 8.11 | **Enforce project limits from `BILLING_PLANS` on `POST /api/projects`**. Stale inline `planLimits` map omitted PRO/BUSINESS/ADVANCED/EXTENDED (fallback `?? 1`), blocking paying customers after their first project. Fixed 2026-05-28 via `getProjectsLimitForPlan()`. | ✅ Completed |
| 8.12 | **`isRealStripeCustomerId()` centralization** ([#89](https://github.com/ostheimer/deepglot/pull/89)). `manual_<orgId>` placeholder was not excluded by the existing `free_`-only check, causing Stripe 404s for ENTERPRISE orgs. Centralized as `isRealStripeCustomerId()` (allowlist `cus_…` pattern); adopted across three call sites. Completed 2026-05-27. | ✅ Completed |
| 8.13 | **Guard all Stripe customer API calls** ([#92](https://github.com/ostheimer/deepglot/pull/92)). All Stripe customer API calls use `isRealStripeCustomerId()` to avoid hitting the Stripe API with placeholder IDs. Completed 2026-05-30. | ✅ Completed |
| 8.14 | **Require management for settings-area API routes** ([#95](https://github.com/ostheimer/deepglot/pull/95)). IDOR fix — project DELETE/PATCH and api-key create/revoke checked only org membership; webhooks and exclusions routes used the weaker `userHasProjectAccess`. All switched to `userCanManageProject`. Source-level guardrail test added. Completed 2026-05-29. | ✅ Completed |
| 8.15 | **Harden project import/export** ([#96](https://github.com/ostheimer/deepglot/pull/96)). `MAX_IMPORT_ROWS` cap; chunked writes (one short transaction per chunk); CSV/formula injection protection (CWE-1236) via leading apostrophe; per-language scope for translators; usage attributed per language pair; PO export filename sanitized. Completed 2026-05-29. | ✅ Completed |
| 8.16 | **Fix tsc failure on Stripe webhook test mock** ([#97](https://github.com/ostheimer/deepglot/pull/97)). Type-correct mock arguments so `tsc --noEmit` passes on the test files. Completed 2026-05-29. | ✅ Completed |
| 8.17 | **Harden visual-editor session tokens** ([#98](https://github.com/ostheimer/deepglot/pull/98)). Language scope bound into the token; `langTo` enforced in `/manual-translations` (language-scoped translator cannot edit other languages). Rate limiting per project on the manual-translations write path. Completed 2026-05-29. | ✅ Completed |
| 8.18 | **Add full `tsc --noEmit` typecheck to CI** ([#99](https://github.com/ostheimer/deepglot/pull/99)). New `typecheck` npm script; runs as a dedicated CI step after install so type errors outside the Next.js build graph are caught. Completed 2026-05-29. | ✅ Completed |
| 8.19 | **Block SSRF in webhook delivery** ([#100](https://github.com/ostheimer/deepglot/pull/100)). New `src/lib/webhook-url-safety.ts` classifies private/reserved IPv4+IPv6 ranges and internal hostnames. Enforced at create/update (400) AND at dispatch (re-checks resolved IPs to defeat DNS rebinding). Redirects disabled. Response body capped at 512 chars to limit read-back. Completed 2026-05-29. | ✅ Completed |
| 8.20 | **Settings UX improvements** ([#104](https://github.com/ostheimer/deepglot/pull/104)). Visual editor launcher now only offers active target languages within the user's access scope; webhook URL field shows a public-HTTPS hint matching the SSRF guard. Completed 2026-05-30. | ✅ Completed |
| 8.21 | **Require management to add/remove project languages** ([#103](https://github.com/ostheimer/deepglot/pull/103)). IDOR fix — `DELETE /api/projects/[id]/languages` had no authorization at all; `POST` gated only on org membership. Both now require `userCanManageProject`. Language code validated via Zod. Completed 2026-05-30. | ✅ Completed |
| 8.22 | **Hide language add control from non-managers on Languages page** ([#106](https://github.com/ostheimer/deepglot/pull/106)). UI control for adding languages now only visible to managers, mirroring the API gate from PR #103. Completed 2026-05-30. | ✅ Completed |
| 8.23 | **Block new Checkout when org already has live subscription** ([#108](https://github.com/ostheimer/deepglot/pull/108)). `POST /api/billing/checkout` now returns HTTP 409 when the org already has an ACTIVE or TRIALING subscription, directing to the billing portal instead. Prevents double-billing. Completed 2026-05-30. | ✅ Completed |
| 8.24 | **Regression test for Languages-page management gating** ([#109](https://github.com/ostheimer/deepglot/pull/109)). Source-level guardrail asserting `AddLanguageDialog` renders only for managers; prevents silent regressions of the auth gate added in PR #103. Completed 2026-05-30. | ✅ Completed |
| 8.25 | **Block duplicate Checkout for PAST_DUE subscriptions** ([#110](https://github.com/ostheimer/deepglot/pull/110)). #108 only rejected ACTIVE/TRIALING; PAST_DUE orgs could start a second Stripe subscription via direct API. Extended guard via `blocksNewCheckoutForExistingSubscription()` (portal for plan changes). Completed 2026-05-30. | ✅ Completed |
| 8.26 | **Subscription cancel keeps paid quota until period end** (cron bug scan). `POST /api/billing/cancel` no longer writes `CANCELED` while Stripe still bills (`cancel_at_period_end`). Checkout guard blocks any non-`CANCELED` row with `stripeSubscriptionId` (incl. INACTIVE incomplete subs). Webhook `subscription.updated` skips plan downgrade on unknown price ids (`tryResolvePlanKeyByStripePriceId`). | ✅ Completed |
| 8.27 | **Client-side dynamic / SPA content translation** ([#120](https://github.com/ostheimer/deepglot/issues/120)). A `MutationObserver` re-translates content added after page load (AJAX, infinite scroll, cart drawers, SPA widgets) through a same-origin REST proxy (`POST /wp-json/deepglot/v1/translate-dynamic`) so the API key never reaches the browser. Cache-first: a missing/stale nonce degrades to cache-only, so quota is never spent without a valid same-origin nonce (hard-cached pages still serve). SEO-safe — the server pass still renders the initial crawlable HTML. A shared `TranslationRules` (drift-guarded by `TranslationRulesTest`) keeps the JS and PHP passes in sync. Opt-in via `enable_dynamic_translation`. **Live QA passed 2026-06-10 on `meinhaushalt.at` (plugin v0.8.1, flag enabled there)**: injected text and accessibility attributes translate, re-translation on change works, `contenteditable`/no-translate markers and bots stay untouched, session cache avoids repeat requests, SEO output unchanged. QA surfaced two follow-ups: quota-usage investigation ([#147](https://github.com/ostheimer/deepglot/issues/147)) and 402 visibility ([#148](https://github.com/ostheimer/deepglot/issues/148)). | ✅ Completed |
| 8.28 | **Checkout TOCTOU: Stripe live-subscription guard** (cron bug scan). `POST /api/billing/checkout` now calls `customerHasBlockingStripeSubscription()` before `checkout.sessions.create` so parallel checkouts cannot create a second paid Stripe subscription while `stripeSubscriptionId` is still null in the DB. | ✅ Completed |
| 8.29 | **Checkout concurrent-open-session race** ([#138](https://github.com/ostheimer/deepglot/issues/138)). Prevent-and-alert: `POST /api/billing/checkout` now reuses an existing open Checkout session for the same plan+interval and expires other open sessions (`classifyOpenCheckoutSessions`) so a double-click / two tabs returns one session; the `checkout.session.completed` webhook flags a duplicate completed Checkout (`checkoutCompletionIsDuplicate`) for manual cancel/refund, keeping the first subscription. No automated refunds. | ✅ Completed |
| 8.30 | **Runtime sync must not revert fresh admin saves** ([#146](https://github.com/ostheimer/deepglot/pull/146), plugin v0.8.1). Found during the 8.27 live QA: `applyRuntimeConfig()` rewrote the whole settings option from the request's stale options cache, so frontend traffic silently reverted admin saves (every setting affected). Fixed via cache eviction + fresh re-read before merging; payloads fetched with a stale API key or from a stale/unsaved base URL are discarded. Test-first: `RuntimeConfigRaceTest` reproduces the race and pins 4 scenarios. | ✅ Completed |
| 8.31 | **Email alert on duplicate Stripe subscription** ([#145](https://github.com/ostheimer/deepglot/pull/145)). The `DUPLICATE SUBSCRIPTION` webhook log (8.29) now also sends an operations email (recipient via `DEEPGLOT_BILLING_ALERT_EMAIL`, set in Vercel Production): at most once per orphaned subscription (metadata marker on the Stripe object, written only after a real send), 5s send timeout, and untracked-subscription guards so the marker write cannot poison the webhook event loop. | ✅ Completed |
| 8.32 | **Bot traffic must not burn translation quota** ([#147](https://github.com/ostheimer/deepglot/issues/147), plugin v0.8.2). Investigation of meinhaushalt.at's ~1M words/month found crawlers grinding the long-tail archive were billed as human: the plugin hardcoded `bot:0` and the SaaS treated `BotType.OTHER` as human (`bot >= GOOGLE`). New `BotDetector` maps the visitor UA to the legacy bot code, threaded `OutputBuffer → HtmlTranslator → Client` (which also now passes the page `request_url` the SaaS analytics were missing); the SaaS exemption is corrected to `bot >= OTHER`. Bots are served cache-only, so cached translated URLs remain crawlable while uncached translated URLs fall back to source-language content until a human visit warms the cache. Test-first: `BotDetectorTest`. | ✅ Completed |
| 8.33 | **Surface translation-quota exhaustion to operators** ([#148](https://github.com/ostheimer/deepglot/issues/148), plugin v0.8.2). The health ping now sends several words (a 1-word ping passed while a near-empty quota already 402'd real pages) and classifies 402 as `connection_code: quota_exhausted`; a real 402 also sets a `deepglot_quota_exhausted` transient. The status endpoint exposes `quota_exhausted` from EITHER signal, the plugin shows a wp-admin notice, and the dynamic-translator proxy returns `quota_exhausted` so the browser client stops retrying for the session. **SaaS dashboard:** the usage page shows a warning banner at ≥90% and a "limit reached" banner at ≥100% of the effective word limit (`quotaUsageLevel`). **Proactive owner email:** `/api/translate` emails the org owner once per month per threshold — at 90% when an accepted increment crosses the warning line, and at 100% when a request is rejected with 402 (large batches are rejected before they increment, so the 402 is the real "reached" signal). Deduped via a new `UsageAlert(organizationId, month, threshold)` unique table (applied additively to prod + preview); the send is bounded by a 5s timeout and never fails the translation. | ✅ Completed |
| 8.34 | **WP status ping must detect quota exhaustion on cache hits** (cron bug scan). `/api/translate` skipped the monthly quota check when every word was a cache hit, so the plugin health ping could stay green while real translations returned 402. Added optional `quota_probe` flag (used by the WP plugin status/test-connection ping) that rejects exhausted quotas even on cache hits; visitor cache-only traffic remains allowed. | ✅ Completed |
| 8.35 | **Bot cache-only fallback must not poison the WP translation cache** ([#163](https://github.com/ostheimer/deepglot/issues/163), plugin v0.8.3). When a bot was the first visitor of an uncached page, the SaaS identity fallback (`to_words == from_words`, 8.32) was persisted by `HtmlTranslator` into the 30-day transient cache, so later human visitors saw source-language text until expiry/flush. `translateDocument()` now drops identity pairs from the cache write on bot requests (`bot >= BotDetector::OTHER`); real translations in bot responses and legitimate human-backed identical translations stay cacheable. Test-first: `BotCachePoisoningTest`. | ✅ Completed |
| 8.36 | **Dynamic-translate proxy: mitigate quota drain via spoofed Origin** ([#199](https://github.com/ostheimer/deepglot/pull/199), plugin v0.8.4). `POST /wp-json/deepglot/v1/translate-dynamic` treated a scraped REST nonce plus a spoofable `Origin` header as proof of same-origin traffic, so server-side HTTP clients could burn project quota without a browser. Replaced the spoofable Origin gate with two word-denominated caps: a short-lived **server-issued ticket** (minted per page render — quota spend now requires actually rendering the page, capped per render) and a **per-IP fresh-word window budget** (`MAX_FRESH_WORDS_PER_IP`). Test-first: `DynamicTranslationControllerTest` cases 6–7 (ticket required) and 15–18 (both caps, per-IP accumulation across tickets, legitimate first-visit still served). **Interim mitigation only** — an adversarial review confirmed the caps are soft (non-atomic transients) and per-IP, so a distributed attacker rotating IPs can still burn the victim's remaining monthly quota early. The authoritative per-org fresh-word velocity limit landed SaaS-side in 8.37 ([#203](https://github.com/ostheimer/deepglot/issues/203)). | ✅ Completed |
| 8.37 | **SaaS-side per-org fresh-word velocity limit** ([#203](https://github.com/ostheimer/deepglot/issues/203)). The authoritative fix behind the plugin's soft per-IP caps (8.36): `POST /api/translate` now atomically reserves the fresh (provider-billed) word count against a per-**organization** rolling-hour budget (`TRANSLATE_WORD_VELOCITY_PER_HOUR`, default 50k) via the existing `RateLimitBucket` upsert — a hard, atomic cap (closes the review's TOCTOU concern) keyed per org to match the per-org monthly quota (closes the IP-rotation bypass and prevents an org with N project keys from draining N× the rate against one shared pool). Cache hits and bots are exempt; `quota_probe` is **not** (attacker-settable flag that still spends). Over-budget → `429 velocity_limited` + `Retry-After`. Monthly quota still caps the total; this caps the drain *rate*. Adversarial-reviewed. Test-first: `rate-limit.test.ts` (cost-based reservation, per-org isolation, window reset) + `translate-velocity-guard.test.ts` (route wiring, probes charged). Known follow-ups (availability edge cases): [#208](https://github.com/ostheimer/deepglot/issues/208). | ✅ Completed |

---

## Technical Decisions

| Area | Decision | Rationale |
|---|---|---|
| Framework | Next.js 16 (App Router) | Server Components, API Routes, optimized for Vercel |
| Auth | NextAuth v5 | Open source, no lock-in, self-hosted compatible |
| Database | Neon (serverless PostgreSQL) | Vercel integration, serverless, generous free tier |
| ORM | Prisma | Type-safe, migrations, strong Next.js integration |
| Billing | Stripe | Industry standard, strong subscription support |
| UI | Tailwind CSS + shadcn/ui | Fast, customizable, accessible |
| Email | Cloudflare Email Sending | Integrated with existing Cloudflare infrastructure (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`) |
| Translation (Primary) | OpenAI provider abstraction | Low-cost default path, model configurable, local `mock` mode for development; `TRANSLATION_PROVIDER` accepts `openai`, `openrouter`, `ollama`, `openai-compatible`, `deepl`, `gemini`, or `mock` |
| Translation (Gemini) | Google Gemini provider | Fully implemented and tested (`src/lib/gemini.ts`); auto-selected when `GEMINI_API_KEY` is set and `TRANSLATION_PROVIDER` is unset (highest priority in the auto-selection chain); default model `gemini-3.1-flash-lite` (stable id — never a `-preview` alias, Google retires those once the stable ships) |
| Translation (Secondary) | DeepL provider | Optional quality-focused fallback for production-sensitive content |
| WP HTML Parser | DOMDocument (PHP native) | No external dependencies, available in all WordPress environments, used in HtmlTranslator and OutputBuffer |
| DB topology (Vercel + Neon) | Variant A: 2 branches | Neon `preview` → Vercel Development + Preview; Neon `prod` → Vercel Production only. See README "Setting up the Neon production branch". |

---

## Legend

- ✅ Completed
- 🔄 Implemented, QA / hardening pending
- ⏳ Open
- ❌ Blocked
