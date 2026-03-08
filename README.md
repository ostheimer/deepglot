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

## CI / CD

The repository now uses `.github/workflows/ci-cd.yml` plus Vercel's native Git integration with this branch and environment mapping:

- Local development: Vercel `Local` / `Development` variables + Neon `preview`
- Any pushed non-`main` branch: GitHub Actions verify job, then Vercel `Preview` deploy + Neon `preview`
- `main`: GitHub Actions verify job, then Vercel `Production` deploy + Neon `prod`

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

After each deployment, verify the current production URL and deployment status.

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

## Test coverage

The current lightweight test suite covers:

- auth redirect rules in `src/lib/route-access.ts`
- locale path mapping, canonical route generation, and legacy redirects in `src/lib/site-locale.ts`
- billing portal return URL resolution in `src/lib/billing.ts`
- translation provider selection and mock translations in `src/lib/translation.ts`
- markdown documentation language checks in `src/lib/docs-language.ts`
- end-to-end locale switching, query preservation, legacy German redirects, and locale-aware auth redirects via Playwright in `tests/e2e/locale-routing.spec.ts`

## Documentation guardrail

- Run `npm run check:docs-language` to verify that Markdown documentation stays in English.
- The CI / CD workflow also runs the same check automatically on pushes and pull requests.
