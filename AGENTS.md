# Agent Guidance

## Bug workflow

When I report a bug, don't start by trying to fix it. Instead, start by writing a test that reproduces the bug. Then, have subagents try to fix the bug and prove it with a passing test.

## Project context

- Next.js 16 + App Router (TypeScript, Tailwind CSS, shadcn/ui)
- Auth: NextAuth v5 with Prisma adapter (src/lib/auth.ts); edge-safe split via src/lib/auth.config.ts
- Database: Prisma 7 + Neon PostgreSQL; adapter auto-selected by DATABASE_URL host
- Billing: Stripe with 7 plans (FREE→ENTERPRISE) defined in src/lib/billing-plans.ts
- Translation: 7 providers (openai, deepl, gemini, openrouter, ollama, openai-compatible, mock) in src/lib/translation.ts
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
