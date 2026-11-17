# Project knowledge

Deepglot is a website translation SaaS (Next.js dashboard and API) with a WordPress plugin as
its main client. Setup and product documentation are in `README.md`; operations in
`OPERATIONS.md`; self-hosting in `SELFHOSTING.md`; plugin code in `wordpress-plugin/deepglot/`.

## Stack

- Next.js 16 App Router (TypeScript, Tailwind CSS, shadcn/ui)
- Auth: NextAuth v5 with Prisma adapter (`src/lib/auth.ts`); edge-safe split via `src/lib/auth.config.ts`
- Database: Prisma 7 + Neon PostgreSQL; the adapter is selected by the database URL host
- Billing: Stripe, 7 plans (FREE to ENTERPRISE) in `src/lib/billing-plans.ts`
- Translation: 7 providers (openai, deepl, gemini, openrouter, ollama, openai-compatible, mock)
  orchestrated in `src/lib/translation.ts`
- WordPress plugin: PHP, DOMDocument-based HTML translation. Its REST API is
  `/wp-json/deepglot/v1/` (`wordpress-plugin/deepglot/includes/Api/`)

## Commands

```bash
npm test                    # unit tests (src/lib/*.test.ts)
npm run test:integration    # integration tests (needs PostgreSQL)
npm run test:e2e            # Playwright E2E tests
npm run test:wp             # PHP + JS plugin tests (needs php)
npm run typecheck
npm run check:docs-language # Markdown docs must be English (AGENTS.md and the PR template are excluded)
```

## Environments and deploy

- Vercel Git integration plus `.github/workflows/ci-cd.yml` (verify job on every push and PR).
  Every push to `main` creates a Vercel **Production** deployment. Non-`main` branches get a
  Preview deployment only when they have a pull request (`scripts/vercel-ignore-build.mjs`).
- Databases: Neon branch `prod` is used only by Vercel Production, Neon branch `preview` by
  Preview and Development (`DEEPGLOT_DATABASE_URL`, falls back to `DATABASE_URL`). Details in
  `README.md`, section "CI / CD".
- The production build runs a target-schema gate (`npm run build`). **Schema changes are not
  applied by a deploy:** apply them with the manual `Schema push (production)` workflow
  (`.github/workflows/schema-push.yml`, plan run with `apply=false`, then apply run) before
  deploying a build that selects the new columns. Destructive plans fail the run and must be
  executed by hand. The workflow deliberately avoids `prisma db push`, which would infer and run its own diff.
- Vercel cron jobs (webhook processing, auto-upgrade, activity digest, retention) are defined
  in `vercel.json`; the region is `fra1`.
- The WordPress plugin is released by pushing a tag `wp-plugin-v<major>.<minor>.<patch>`
  (`.github/workflows/wordpress-plugin-release.yml`, reproducible zip from
  `wordpress-plugin/build-zip.sh`); it is not part of the Vercel deploy.

## Architecture notes (do not re-do past decisions)

**Request entrypoint:** `src/proxy.ts` is the request entrypoint for page and dashboard
traffic. Its `config.matcher` excludes `/api`, `/_next/static`, `/_next/image` and static file
extensions, so API route handlers under `src/app/api/` run directly. `middleware.ts` was
removed in a past refactor; do not recreate it.

**Internal route language:** Dashboard routes are internally German (`/agb`, `/datenschutz`,
`/impressum`, `/projekte`, `/abonnement`, `/einstellungen`). Canonical English aliases are
handled via `src/proxy.ts`. New legal or dashboard pages are added as German directories and
routed through the proxy, not as English-named directories.

**Acceptance module pattern:** Unit-testable acceptance logic goes into
`src/lib/*-acceptance.ts`; `scripts/*-acceptance.ts` are CLI runners (arguments, environment,
reporting). Not yet uniform: some runners (for example `scripts/saas-acceptance.ts`) still
carry flow logic. Add new logic to `src/lib/`.

**Access control:** `userCanManageProject()` (org OWNER/ADMIN or project ADMIN) gates
management-sensitive routes: project settings, API keys, language add/remove, webhooks,
exclusions. `userHasProjectAccess()` is the weaker membership check for lighter routes
(glossary CRUD currently uses it, not the manage check). Both live in
`src/lib/project-access.ts`; check the specific route before assuming which gate applies.

**Stripe safety:** `isRealStripeCustomerId()` (`src/lib/billing.ts`) must run before any Stripe
Customer API call. Synthetic or placeholder IDs must never reach the Stripe API.

**Webhook SSRF guard:** `src/lib/webhook-url-safety.ts` applies both when creating or updating
webhook endpoints and when dispatching deliveries. Skipping it on dispatch allows
DNS-rebinding attacks.

**Deprecated file:** `reference-plugin-analysis.md` is a pre-implementation analysis from
March 2026 and is superseded by the actual implementation; it is not an architecture source.
