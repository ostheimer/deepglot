# Agent Guidance

## Bug workflow

When I report a bug, don't start by trying to fix it. Instead, start by writing a test that reproduces the bug. Then, have subagents try to fix the bug and prove it with a passing test.

## Project context

- Next.js 16 + App Router (TypeScript, Tailwind CSS, shadcn/ui)
- Auth: NextAuth v5 with Prisma adapter (src/lib/auth.ts); edge-safe split via src/lib/auth.config.ts
- Database: Prisma 7 + Neon PostgreSQL; adapter auto-selected by the database URL host
- Billing: Stripe with 7 plans (FREE→ENTERPRISE) defined in src/lib/billing-plans.ts
- Translation: 7 providers (openai, deepl, gemini, openrouter, ollama, openai-compatible, mock) orchestrated in src/lib/translation.ts
- WordPress plugin: wordpress-plugin/deepglot/ (PHP, DOMDocument-based HTML translation)

## Key directories

- src/app/api/ — Next.js route handlers (translate, billing, projects, webhooks, plugin, user, public)
- src/lib/ — all shared logic and unit tests (co-located *.test.ts files)
- src/components/ — React components organized by feature
- scripts/ — acceptance and operational scripts (run with npx tsx)
- wordpress-plugin/deepglot/ — the WordPress plugin (PHP)
- tests/e2e/ — Playwright end-to-end tests

## Test commands

```bash
npm test                    # unit tests (src/lib/*.test.ts)
npm run test:e2e            # Playwright E2E tests
npm run test:wp             # PHP + JS plugin tests
npm run typecheck           # TypeScript type check
npm run check:docs-language # verify docs are in English
```

## API base path

All SaaS API routes: /api/ (Next.js route handlers in src/app/api/)
WordPress plugin REST API: /wp-json/deepglot/v1/ (PHP in wordpress-plugin/deepglot/includes/Api/)

## Architecture notes (do not re-do past decisions)

**Request entrypoint:** `src/proxy.ts` is the sole request entrypoint for the SaaS app. `middleware.ts` was removed in a past refactor — do not recreate it.

**Internal route language:** Dashboard routes are internally German (`/agb`, `/datenschutz`, `/impressum`, `/projekte`, `/abonnement`, `/einstellungen`). Canonical English aliases are handled via `src/proxy.ts`. When adding legal or dashboard pages, add them as German directories and route them through the proxy — do not create new English-named directories for internal pages.

**Acceptance module pattern:** Business logic for acceptance tests lives in `src/lib/*-acceptance.ts` (unit-testable). The files in `scripts/*-acceptance.ts` are thin wrappers that call the `src/lib/` modules. Do not duplicate acceptance logic in scripts directly.

**Access control:** Use `userCanManageProject()` for all write operations on projects and `userHasProjectAccess()` for read operations only. Both live in `src/lib/project-access.ts`.

**Stripe safety:** Always call `isRealStripeCustomerId()` (in `src/lib/billing.ts`) before any Stripe Customer API call. Synthetic/placeholder IDs must never reach the Stripe API.

**Webhook SSRF guard:** `src/lib/webhook-url-safety.ts` must be applied both when creating/updating webhook endpoints AND when dispatching webhook deliveries. Skipping it on dispatch allows DNS-rebinding attacks.

**Deprecated file:** `reference-plugin-analysis.md` in the repo root is explicitly deprecated (pre-implementation analysis from March 2026). Do not use it for architectural decisions — the actual implementation supersedes all recommendations in that file.
