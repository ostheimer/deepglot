# Deepglot

Deepglot is a multilingual WordPress platform without cloud lock-in: a Next.js dashboard app with Stripe billing, NextAuth, Prisma/Neon, and a compatible translation API for a custom WordPress plugin.

## Author

Andreas Ostheimer  
https://www.ostheimer.at

## Stack

- Next.js 16 + App Router
- TypeScript
- Tailwind CSS + shadcn/ui
- NextAuth v5
- Prisma 7 + Neon PostgreSQL
- Stripe
- 7 Translation Providers (OpenAI, DeepL, Gemini, OpenRouter, Ollama, openai-compatible, mock)

## Local development

```bash
npm install
npm run dev
```

The app will then be available at `http://localhost:3000`.

For database access, the app now auto-selects the Prisma Neon adapter only for real Neon hosts. Local PostgreSQL URLs such as `localhost` or `127.0.0.1` automatically use Prisma's default PostgreSQL driver, which makes local fallback databases work without extra code changes.

## Important scripts

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
npm run check:docs-language
npm run test:e2e
```

## Public routing

Deepglot now uses English as the canonical URL structure across the public site and the app:

- Canonical English routes:
  - `/`
  - `/pricing`
  - `/login`
  - `/signup`
  - `/dashboard`
  - `/projects`
  - `/subscription`
  - `/settings`
  - `/docs` (WIP/Draft)
  - Legal pages (German statutory requirements):
    - `/terms` (Terms of Service)
    - `/privacy` (Privacy Policy)
    - `/legal-notice` (Legal Notice)
- German localized routes use the same path structure under `/de`:
  - `/de`
  - `/de/pricing`
  - `/de/login`
  - `/de/signup`
  - `/de/dashboard`
  - `/de/projects`
  - `/de/subscription`
  - `/de/settings`
- Legacy German routes such as `/preise`, `/anmelden`, `/registrieren`, and `/projekte/...` redirect to their canonical `/de/...` equivalents.

Internally, the Next.js app still uses the existing route folders (e.g. `/projekte`, `/abonnement`, `/einstellungen`), while `src/proxy.ts` rewrites the external English path structure (`/projects`, `/subscription`, `/settings`) to the current internal implementation. The proxy also forwards the active locale through the request context and syncs the locale cookie so localized `/de/...` routes behave consistently during full-page navigation and auth redirects.

## Locale switching

- The UI can be switched between English and German on the marketing site, auth pages, and inside the dashboard.
- English is the default language and German is the first localized variant.
- The language switcher keeps users on the equivalent localized route and the proxy persists the active locale in `deepglot-locale`.

## Auth architecture

The auth configuration is intentionally split:

- `src/lib/auth.config.ts`: edge-safe base configuration for the proxy
- `src/lib/auth.ts`: server-side configuration with Prisma adapter and providers
- `src/proxy.ts`: uses only the edge-safe configuration for redirects, locale rewrites, and request cookies

This separation prevents edge/runtime failures such as `MIDDLEWARE_INVOCATION_FAILED` on Vercel while keeping locale-aware auth redirects stable.

The authentication entry points are now:

- English: `/login`, `/signup`
- German: `/de/login`, `/de/signup`

GitHub and Google sign-in are only registered when both provider secrets are configured. Local credentials login and the shared test-login therefore continue to work even when local OAuth credentials are intentionally absent.

## API compatibility

The `POST /api/translate` route is designed for drop-in compatibility:

- `?api_key=...` is supported
- `Authorization: Bearer <key>` is supported as an alternative to `?api_key=`
- Optional `quota_probe: true` in the request body rejects exhausted monthly quotas even when every word is a cache hit (used by the WordPress plugin health ping; normal visitor cache-only traffic is unaffected)
- The response includes `from_words` and `to_words`
- Public endpoints:
  - `GET /api/public/status`
  - `GET /api/public/languages`
  - `GET /api/public/languages/is-supported`

## WordPress plugin

The plugin lives in `wordpress-plugin/deepglot`. Current version: **v0.8.3**. v0.8.3 guards the local translation cache against bot cache-poisoning ([#163](https://github.com/ostheimer/deepglot/issues/163)): identity mappings from cache-only bot responses are no longer persisted, so a crawler being the first visitor of an uncached page can no longer pin source-language text into the 30-day transient cache for later human visitors. v0.8.2 stops bot traffic from burning translation quota (new `BotDetector` maps the visitor UA to the legacy bot code; bots are served cache-only — crawlers receive cached translations, and uncached URLs fall back to source-language content until a human visit warms the cache), surfaces quota exhaustion to operators (wp-admin notice, plugin status endpoint, dashboard warning/limit banners, owner email alerts at 90%/100%), and makes the dynamic-translator proxy return `quota_exhausted` so the browser stops retrying (closes [#147](https://github.com/ostheimer/deepglot/issues/147) and [#148](https://github.com/ostheimer/deepglot/issues/148)). v0.8.1 (2026-06-10) fixed a runtime-sync race that could revert freshly saved admin settings on busy sites and passed live QA for the dynamic-content translator on `meinhaushalt.at` (see `wordpress-plugin/deepglot/DYNAMIC_TRANSLATION_QA.md`). v0.8.3 is deployed on `meinhaushalt.at` and live-verified (2026-07-03): the poisoned transient cache was flushed and re-warmed with real translations only.

Features:

- PHP autoloader and lightweight service container
- URL language resolver and request router (path-prefix and subdomain routing)
- OutputBuffer + HTML translator using DOMDocument — no external PHP dependencies
- Optional client-side dynamic-content translator: a MutationObserver re-translates AJAX / infinite-scroll / SPA content added after page load through a same-origin REST proxy (`POST /wp-json/deepglot/v1/translate-dynamic`); opt-in via `enable_dynamic_translation`, cache-first (a missing nonce never spends quota), and SEO-safe because the server pass still renders the initial crawlable HTML
- JSON-LD and accessibility attribute translation
- Deepglot API client (HTTP requests to the Next.js backend)
- WordPress transient-based translation cache (no custom table needed)
- Link rewriter (`<a>`, `<form>`, `<link rel=canonical>`)
- hreflang SEO tags and `<html lang>` switching
- Language switcher: shortcode `[deepglot_switcher]`, action hook, 5 flag styles, list/dropdown mode, 4 fixed/floating positions, per-language custom flags, responsive hide
- Gutenberg block for language switcher
- Classic widget for language switcher
- WordPress nav-menu integration
- Admin settings page with 7-section tab UI (General, Language Model, Switcher, Exclusions, Setup, WordPress Settings, Members)
- Guided 3-step setup wizard on first activation
- REST API v1 at `/wp-json/deepglot/v1/` for settings CRUD, status, and test-connection
- WooCommerce order email translation
- Browser-language auto redirect with bot-detection skip, cookie preference, and admin/feed context guards
- Subdomain support (`de.example.com`) (implemented; live QA pending — requires `DEEPGLOT_PHASE6_SUBDOMAIN_HOST`)
- Bot detection via dedicated `BotDetector` class (UA → BotType mapping); bot traffic served cache-only to prevent quota burn
- Word quota exhaustion alerts: wp-admin notice, dashboard warning banner (≥90%/100%), proactive email to the organization owner when 90% or 100% of the monthly word limit is reached
- Quota probe via `quota_probe: true` in status/test-connection pings; `quota_exhausted` response stops dynamic translation
- 28 PHP unit tests plus `DynamicTranslatorAssetTest.js` covering URL resolution, HTML parsing, link rewriting, JSON-LD, accessibility attributes, browser redirect, language switcher rendering, block/widget rendering, WooCommerce email, caching, exclusions, metadata, routing, REST API quota status, dynamic translation controller, runtime-config race conditions, and bot cache-poisoning prevention

Run the PHP test suite (all PHP tests + DynamicTranslatorAssetTest.js) locally:

```bash
npm run test:wp
```

## Deployment

The app is deployed on Vercel. For a local production check:

```bash
npm run build
```

For self-hosting with Docker Compose, see [SELFHOSTING.md](SELFHOSTING.md).

## CI / CD

The repository now uses `.github/workflows/ci-cd.yml` plus Vercel's native Git integration with this branch and environment mapping:

- Local development: Vercel `Local` / `Development` variables + Neon `preview`
- Any pushed non-`main` branch: GitHub Actions verify job, then Vercel `Preview` deploy + Neon `preview`
- `main`: GitHub Actions verify job, then Vercel `Production` deploy + Neon `prod`

Recommended database topology:

- Neon branch `preview`: used by Vercel `Development` and `Preview`
- Neon branch `prod`: used only by Vercel `Production`

The verification stage currently runs:

- `npm run check:docs-language`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e`

Required Vercel configuration:

- set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in `Development` and `Preview` to the Neon preview branch
- set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in `Production` to the Neon production branch
- keep the repository connected to Vercel Git deployment so non-`main` pushes create Preview deployments and `main` creates Production deployments
- enable automatic exposure of Vercel system environment variables so Preview and Production deployments can fall back to `VERCEL_BRANCH_URL`, `VERCEL_URL`, and `VERCEL_PROJECT_PRODUCTION_URL`

**Setting up the Neon production branch (Variant A: 2 branches)**

**Option A – Neon CLI (recommended)**  
From the repo root, create the `prod` branch and print connection strings:

```bash
export NEON_API_KEY=neon_...   # Create at https://console.neon.tech → Account → API keys
./scripts/neon-create-prod-branch.sh
```

The script creates branch `prod` from `main` (if missing), prints `DATABASE_URL` and `DATABASE_URL_UNPOOLED`, and reminds you to run `prisma db push` and set the variables in Vercel Production.

**Neon restore drill**

Dry-run the restore drill without creating a branch:

```bash
npm run acceptance:neon -- --env-file .env.production.local
```

Create a temporary restore-drill branch from `prod`, validate that the cloned schema is reachable, and let Neon auto-expire it after 24 hours:

```bash
export NEON_API_KEY=neon_...
export NEON_PROJECT_ID=...
npm run acceptance:neon -- --env-file .env.production.local --create
```

This script creates only a temporary child branch and never writes to `prod`.

**Option B – Neon Console**  
1. In the [Neon Console](https://console.neon.tech), open **Branches** and create a branch named `prod` with parent `main`.
2. Open the `prod` branch and copy both connection strings: **Connection string** (pooled) → `DATABASE_URL`, **Session mode** (unpooled) → `DATABASE_URL_UNPOOLED`.
3. Apply the schema once:  
   `DATABASE_URL="<prod-pooled-url>" npx prisma db push`
4. In Vercel → Settings → Environment Variables, set **Production** only: `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to the `prod` URLs. Leave Development and Preview unchanged.
5. Redeploy Production and verify the app uses the prod database.

Recommended environment matrix:

- `Development`
  - set `AUTH_URL=http://localhost:3000`
  - set `NEXT_PUBLIC_APP_URL=http://localhost:3000`
  - set `TRANSLATION_PROVIDER=mock` unless a dedicated development provider key is available
  - point both database URLs to Neon `preview`
- `Preview`
  - do not hardcode `AUTH_URL` or `NEXT_PUBLIC_APP_URL` to `localhost`
  - set `TRANSLATION_PROVIDER=mock` unless Preview should spend real provider credits
  - point both database URLs to Neon `preview`
- `Production`
  - set `AUTH_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL` to the canonical production domain
  - set `TRANSLATION_PROVIDER=openai`
  - set `OPENAI_TRANSLATION_MODEL=gpt-5-mini`
  - point both database URLs to Neon `prod`

Stripe acceptance can be checked without creating charges:

```bash
npm run acceptance:stripe -- --mode test --env-file .env.local --env-only
npm run acceptance:stripe -- --mode live --env-file .env.production.local
```

The live check reads configured prices and webhook endpoints from Stripe. It does not create customers, subscriptions, checkout sessions, or payments.

If the Vercel `Development` values are placeholders or missing, local development can temporarily run against a local PostgreSQL-compatible database instead.

Manual `vercel deploy` runs should never upload local `.env*` files. The repository therefore keeps a `.vercelignore` file that excludes local environment files from ad-hoc deployments.

Production alias policy:

- `deepglot.ai` is canonical.
- `www.deepglot.ai` redirects page traffic to `deepglot.ai`.
- The active Vercel Production deployment host redirects page traffic to `deepglot.ai`.
- Vercel Preview and branch deployment URLs remain reachable for PR QA.
- Additional production-only aliases can be configured with `DEEPGLOT_CANONICAL_REDIRECT_HOSTS`.

After each deployment, verify the current production URL and deployment status.

Production acceptance is tracked in [PRODUCTION_ACCEPTANCE.md](PRODUCTION_ACCEPTANCE.md). After a production deployment, run the repeatable smoke test:

```bash
npm run smoke:production
```

For the full non-destructive acceptance wrapper, use:

```bash
npm run acceptance:production
npm run acceptance:production -- --json output/production-acceptance.json --junit output/production-acceptance.xml
```

The wrapper runs production smoke, Neon dry-run/readiness, Stripe env/API readiness, rate-limit config checks, and webhook processor readiness. It exits successfully when only external live checks are blocked by missing credentials; add `--strict` to make blocked or skipped checks fail CI.

## Self-hosting

Deepglot now includes a first self-hosted setup:

- `Dockerfile` builds the Next.js app for production use.
- `docker-compose.yml` starts the app together with PostgreSQL.
- `.env.selfhost.example` provides a dedicated self-hosting environment template.
- `scripts/docker-entrypoint.sh` waits for PostgreSQL, runs `prisma db push`, and starts the app.

Quick start:

```bash
cp .env.selfhost.example .env.selfhost
openssl rand -base64 32
# paste the secret into .env.selfhost as AUTH_SECRET
docker compose up --build -d
```

The full installation guide lives in [SELFHOSTING.md](SELFHOSTING.md).

## Environment variables

For server-side return URLs such as the Stripe Billing Portal:

- `AUTH_URL` is the primary base URL.
- `NEXT_PUBLIC_APP_URL` is used as a fallback when `AUTH_URL` is not set locally.
- On Vercel, the app can also fall back to system deployment URLs for Preview and Production environments.

## Translation providers

The translation flow uses a provider abstraction:

- `TRANSLATION_PROVIDER` accepts `openai`, `openrouter`, `ollama`, `openai-compatible`, `deepl`, `gemini`, or `mock`.
- Without an explicit `TRANSLATION_PROVIDER`, the app auto-selects by the first credential present, in this order: `gemini` (`GEMINI_API_KEY`) → `openai` (`OPENAI_API_KEY`) → `openrouter` (`OPENROUTER_API_KEY`) → `deepl` (`DEEPL_API_KEY`) → `ollama` (`OLLAMA_BASE_URL`), otherwise `mock` in `development` and `test`.
- `OPENAI_TRANSLATION_MODEL` controls the model for the OpenAI provider (current production default: `gpt-5-mini`).
- `GEMINI_API_KEY`, `GEMINI_TRANSLATION_MODEL`, and `GEMINI_BASE_URL` configure the Gemini provider (default model: `gemini-3.1-flash-lite` — the stable id; never point the default at a `-preview` alias, Google retires those once the stable ships).
- `OPENROUTER_API_KEY` and `OPENROUTER_TRANSLATION_MODEL` configure the OpenRouter gateway.
- `OLLAMA_BASE_URL` and `OLLAMA_TRANSLATION_MODEL` configure a local Ollama instance.
- `TRANSLATION_API_KEY`, `TRANSLATION_BASE_URL`, and `TRANSLATION_MODEL` are generic overrides for `openai-compatible` gateways.
- `mock` is intended for local development and tests and returns visibly marked output instead of real translations.
- The database schema includes `TranslationSource.GOOGLE` as a reserved source identifier. Google Translate is not currently available as a `TRANSLATION_PROVIDER` value and is not configurable via environment variables.
- Projects on the Pro plan and above can store their own encrypted provider API key; set `DEEPGLOT_SECRET_ENCRYPTION_KEY` to enable at-rest encryption for per-project keys.

### Fallback provider configuration

When the primary provider fails with a quota exhaustion, rate-limit (429), or server error (5xx), Deepglot automatically retries with a fallback chain. Auth errors, validation errors, and other 4xx failures propagate immediately. Note: connection-level failures (ETIMEDOUT, ECONNRESET) that arrive via Node's native `fetch` are **not** retried — `isProviderFailoverError()` checks `error.message`, but undici reports these as `"fetch failed"` with details in `error.cause`.

- `TRANSLATION_FALLBACK_PROVIDERS` accepts a comma-separated list of provider names (e.g. `gemini,openai`).
- Default fallback chain when the variable is unset: `gemini,openai` — these providers are only included if they have valid API credentials configured; unconfigured providers are silently skipped (defined in `src/lib/translation-config.ts`).
- Example: set `TRANSLATION_FALLBACK_PROVIDERS=openai,deepl` to fall back to OpenAI first, then DeepL.
- Terminal failures (the last provider in the chain fails, or a non-failover error occurs) are logged at error level with the failing provider and the attempted chain; recoverable hops are logged as warnings.

### TranslationSource database values

The `TranslationSource` enum is a coarse provider bucket, not a precise per-request audit trail. The stored value reflects the initially selected provider, not the provider that actually served the response after a fallback:

- `TranslationSource.DEEPL` — written only when the selected provider is DeepL.
- `TranslationSource.MOCK` — written only when the mock provider is active.
- `TranslationSource.OPENAI` — written for **all other providers**: OpenAI, Gemini, OpenRouter, Ollama, and `openai-compatible`. The persistence layer only distinguishes `deepl` / `mock` / everything-else, so querying this value does not tell you which of those providers was actually used.
- `TranslationSource.GOOGLE` is reserved in the schema but is not actively written by any current provider. It does not correspond to any configurable `TRANSLATION_PROVIDER` value.

## Test login and demo workspace

The app now includes an instant test login for local work and Preview deployments:

- enabled automatically in local development
- enabled automatically on Vercel Preview
- disabled by default on Production
- optionally overrideable via `DEEPGLOT_ENABLE_TEST_LOGIN=true|false`

On the first test login, the app automatically provisions a shared test user, a test workspace, and a demo project with sample data for the dashboard, activity feed, page views, and project subpages.

## Project pages

Project pages now support these additional flows:

- API keys can be created directly under `Setup` and `API Keys`
- the full API key is shown exactly once after creation
- page views can be enabled under `Stats -> Page views`
- the visual editor opens a real target URL with `deepglot_editor=1`

## i18n automation scripts

Four scripts under `scripts/` automate i18n maintenance tasks:

- `scripts/i18n-codemod-api-copy.ts` — codemod for migrating API copy strings to i18n keys
- `scripts/i18n-codemod-simple-copy.ts` — codemod for migrating simple inline copy strings to i18n keys
- `scripts/i18n-generate-static-messages.ts` — generates static message catalogues for all supported locales
- `scripts/i18n-generate-wordpress-plugin-languages.ts` — generates WordPress `.pot`/`.po` language files for the plugin from the shared i18n source

## Test coverage

The current lightweight test suite covers:

- Auth.js-safe user normalization in `src/lib/auth-user.ts`
- auth redirect rules in `src/lib/route-access.ts`
- locale path mapping, canonical route generation, and legacy redirects in `src/lib/site-locale.ts`
- billing portal return URL resolution in `src/lib/billing.ts`
- Neon-vs-local database adapter detection in `src/lib/database-url.ts`
- optional GitHub/Google provider activation in `src/lib/oauth-provider-config.ts`
- test-login environment gating and defaults in `src/lib/test-login-config.ts`
- project and visual-editor URL generation in `src/lib/project-url.ts`
- translation provider selection and mock translations in `src/lib/translation.ts`
- markdown documentation language checks in `src/lib/docs-language.ts`
- ops and production acceptance readiness checks in `src/lib/ops-acceptance.test.ts`
- Phase 6 acceptance config, URL builders, and blocked-check classification in `src/lib/phase-6-acceptance.test.ts`
- SaaS acceptance config, payload builders, and failure classification in `src/lib/saas-acceptance.test.ts`
- settings-area API route authorization guardrail (management gate on all management methods) in `src/lib/project-settings-route-authz.test.ts`
- translations language page management gating (AddLanguageDialog only for managers) in `src/lib/project-language-page-authz.test.ts`
- password reset flow in `src/lib/password-reset.test.ts`
- project invitation token lifecycle in `src/lib/project-invitations.test.ts`
- end-to-end locale switching, query preservation, legacy German redirects, and locale-aware auth redirects via Playwright in `tests/e2e/locale-routing.spec.ts`
- end-to-end account settings flows via Playwright in `tests/e2e/account-settings.spec.ts`
- full UI navigation audit via Playwright in `tests/e2e/full-ui-audit.spec.ts`
- phase 6 dashboard features (glossary, import/export, analytics, webhooks, visual editor) via Playwright in `tests/e2e/phase-6-dashboard.spec.ts`
- project settings accessibility via Playwright in `tests/e2e/project-settings-accessibility.spec.ts`
- translation provider settings via Playwright in `tests/e2e/provider-settings.spec.ts`
- subscription usage accessibility via Playwright in `tests/e2e/subscription-usage-accessibility.spec.ts`

### WordPress plugin PHP test suite

The plugin test suite (`wordpress-plugin/deepglot/tests/`) contains 28 PHP unit test files plus one JS asset test, all run via `npm run test:wp`:

| Test file | What it covers |
|---|---|
| `AccessibilityAttributeTranslationTest.php` | Translation of ARIA and accessibility attributes |
| `BlockRenderTest.php` | Gutenberg block rendering for the language switcher |
| `BotCachePoisoningTest.php` | Guard against bot-visit identity mappings poisoning the WP translation cache for later human visitors |
| `BotDetectorTest.php` | Bot-traffic detection to skip unnecessary translation |
| `BrowserRedirectorTest.php` | Browser-language auto-redirect logic and guard conditions |
| `ClientSettingsSyncTest.php` | Sync of admin settings to the client-side JS config object |
| `DynamicTranslationControllerTest.php` | REST endpoint for client-side dynamic-content translation |
| `ExclusionsTest.php` | CSS-selector and URL exclusion rules |
| `HtmlLangSwitchTest.php` | `<html lang>` attribute switching per active language |
| `JsonLdTranslationTest.php` | JSON-LD structured-data string translation |
| `LanguageSwitcherAriaTest.php` | ARIA attributes on the language switcher widget |
| `LanguageSwitcherRenderingTest.php` | HTML output of the language switcher (all modes and styles) |
| `LinkRewriterTest.php` | Link rewriting for `<a>`, `<form>`, and `<link rel=canonical>` |
| `MetadataTranslationTest.php` | `<title>`, `<meta description>`, and OG tag translation |
| `NavMenuSwitcherTest.php` | WordPress nav-menu integration for the language switcher |
| `ParallelBatchesTest.php` | Parallel batching of translation API requests |
| `RestApiQuotaStatusTest.php` | REST endpoint for quota/status health checks |
| `RuntimeConfigRaceTest.php` | Race-condition guard for runtime admin-settings sync (v0.8.1 fix) |
| `SiteRoutingTest.php` | Path-prefix and subdomain routing modes |
| `SwitcherCustomFlagsTest.php` | Per-language custom flag image support |
| `SwitcherJsAriaTest.php` | JS-driven ARIA state updates on the switcher |
| `SwitcherResponsiveHideTest.php` | Responsive-hide CSS class behavior |
| `SwitcherSettingsTest.php` | Admin settings round-trip for all switcher options |
| `TranslationCacheTest.php` | WordPress transient-based translation cache |
| `TranslationRulesTest.php` | Per-language translation rule evaluation |
| `UrlLanguageResolverTest.php` | URL language prefix detection and resolution |
| `WidgetRenderTest.php` | Classic widget rendering for the language switcher |
| `WooCommerceEmailTranslatorTest.php` | WooCommerce order email translation |
| `DynamicTranslatorAssetTest.js` | MutationObserver / client-side dynamic translator (JS) |

## Plans and billing tiers

Deepglot uses a `Plan` enum in the database schema with the following values:

- `FREE` — default plan for new users
- `STARTER`, `BUSINESS`, `PRO`, `ADVANCED`, `EXTENDED` — active paid billing tiers
- `ENTERPRISE` — active tier with custom pricing; limits are 20 million words, 50 languages, and 100 projects; excluded from self-serve plan switching in the dashboard
- `PROFESSIONAL` — deprecated; normalized to `PRO` by `resolveBillingPlanKey()`

Active plan limits and prices are configured in `src/lib/billing-plans.ts`. Stripe price IDs are supplied via `STRIPE_PRICE_*` environment variables (e.g. `STRIPE_PRICE_STARTER_MONTHLY`).

## Documentation guardrail

- Run `npm run check:docs-language` to verify that Markdown documentation stays in English.
- The CI / CD workflow also runs the same check automatically on pushes and pull requests.
