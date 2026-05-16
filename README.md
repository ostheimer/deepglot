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
- OpenAI / Gemini / DeepL

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

Internally, the Next.js app still uses the existing route folders, while `src/proxy.ts` rewrites the external English path structure to the current implementation. The proxy also forwards the active locale through the request context and syncs the locale cookie so localized `/de/...` routes behave consistently during full-page navigation and auth redirects.

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
- The response includes `from_words` and `to_words`
- Public endpoints:
  - `GET /api/public/status`
  - `GET /api/public/languages`
  - `GET /api/public/languages/is-supported`

## WordPress plugin

The plugin lives in `wordpress-plugin/deepglot` and is currently at **version 0.7.0**.

Core capabilities:

- Bootstrap file, autoloader, and lightweight service container
- Output-buffer pipeline: WordPress renders HTML → buffer captures → strings extracted → batch API call → localized output returned
- HTML, JSON, and XML parser with accessibility-attribute translation (`<img alt>`, `aria-label`, `placeholder`, submit button copy)
- Link rewriter for internal `<a>`, `<form>`, and `<link rel=canonical>` elements; skips subtrees marked `data-deepglot-no-translate`
- `hreflang` tags and canonical URL management
- Deepglot API client with local WordPress transient cache
- RequestRouter for language prefix detection and URL rewriting
- BrowserRedirector for browser-language auto-redirect (explicit pick marker via `?deepglot-explicit=1`)
- REST API v1 (CRUD settings, status, test-connection) with auth and rate limiting
- WooCommerce email translation

Language switcher (v0.7.0):

- Semantic `<aside data-deepglot-no-translate>` with checkbox-driven CSS dropdown and `aria-expanded` JS sync
- Placement: auto-inject via `switcher_position` (inline | fixed-bottom-right | fixed-bottom-left | fixed-top-right | fixed-top-left), shortcode `[deepglot_switcher]`, action hook, Gutenberg block `deepglot/switcher`, or classic WP_Widget
- WP nav-menu integration: drop switcher into any registered menu via Appearance → Menus with dropdown and hide-current modifiers
- `switcher_responsive_hide` (none | mobile | desktop) + `switcher_responsive_breakpoint` (default 768 px)
- `switcher_custom_flags` assoc array for per-language emoji or image URL overrides

Admin settings:

- General (toggles, website type, industry)
- Language model (provider, model selection)
- Language switcher (style, flags, order, CSS, responsive, custom flags)
- Translation exclusions (excluded URLs, blocks, selectors)
- Setup (API key display, installation guide)
- WordPress settings (email, search, AMP)
- Project members (table, roles, invitations)

Guided 3-step setup wizard on first activation.

Local plugin test:

```bash
php wordpress-plugin/deepglot/tests/UrlLanguageResolverTest.php
```

Full PHP test suite:

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

The translation flow uses a provider abstraction. `TRANSLATION_PROVIDER` accepts:

| Value | Key env var | Notes |
|---|---|---|
| `openai` | `OPENAI_API_KEY` | Default model `gpt-5-mini`; override with `OPENAI_TRANSLATION_MODEL` and `OPENAI_BASE_URL` |
| `gemini` | `GEMINI_API_KEY` | Default model `gemini-3.1-flash-lite-preview`; override with `GEMINI_TRANSLATION_MODEL` and `GEMINI_BASE_URL` |
| `openrouter` | `OPENROUTER_API_KEY` | Default model `openai/gpt-5-mini`; override with `OPENROUTER_TRANSLATION_MODEL` and `OPENROUTER_BASE_URL` |
| `ollama` | `OLLAMA_BASE_URL` | Default model `llama3.3`; override with `OLLAMA_TRANSLATION_MODEL`. Useful for local or private deployments |
| `openai-compatible` | `TRANSLATION_API_KEY` | Bring-your-own gateway; set `TRANSLATION_BASE_URL` and `TRANSLATION_MODEL`. Aliases: `custom`, `compatible` |
| `deepl` | `DEEPL_API_KEY` | Quality-focused option; no model selection needed |
| `mock` | — | Returns visibly marked output; intended for local development and tests |

Without an explicit `TRANSLATION_PROVIDER`, the app auto-selects based on which key is present:
`GEMINI_API_KEY` → `gemini` · `OPENAI_API_KEY` → `openai` · `OPENROUTER_API_KEY` → `openrouter` · `DEEPL_API_KEY` → `deepl` · `OLLAMA_BASE_URL` → `ollama` · otherwise `mock` in `development` and `test`.

`TRANSLATION_FALLBACK_PROVIDERS` (comma-separated, optional) defines the failover chain when the primary provider returns a quota error or 5xx response. The default chain is `gemini,openai`.

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
- end-to-end locale switching, query preservation, legacy German redirects, and locale-aware auth redirects via Playwright in `tests/e2e/locale-routing.spec.ts`

## Documentation guardrail

- Run `npm run check:docs-language` to verify that Markdown documentation stays in English.
- The CI / CD workflow also runs the same check automatically on pushes and pull requests.
