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
- OpenAI / DeepL

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

The first plugin scaffold lives in `wordpress-plugin/deepglot`.

Current contents:

- Bootstrap file with the plugin header
- Autoloader and a lightweight service container
- Admin settings page under `Settings -> Deepglot`
- Prepared API client
- First testable URL language logic

Local plugin test:

```bash
php wordpress-plugin/deepglot/tests/UrlLanguageResolverTest.php
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
  - set `OPENAI_TRANSLATION_MODEL=gpt-5.5`
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

The translation flow now uses a provider abstraction:

- `TRANSLATION_PROVIDER` accepts `openai`, `deepl`, or `mock`.
- Without an explicit setting, the app prefers `openai` when `OPENAI_API_KEY` is present, then `deepl` when `DEEPL_API_KEY` is present, otherwise `mock` in `development` and `test`.
- `OPENAI_TRANSLATION_MODEL` controls the low-cost LLM model and defaults to `gpt-4o-mini`.
- `mock` is intended for local development and tests and returns visibly marked output instead of real translations.

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
