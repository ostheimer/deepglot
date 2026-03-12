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

---

## Architecture Overview

```
Next.js App (Vercel)          WordPress Plugin
├── Landing / Marketing  ←──  Install WP plugin
│   ├── EN on `/` and `/pricing`
│   └── DE on `/de` and `/de/pricing`
├── Auth (NextAuth v5)        ↓
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
| 4.2 | URL class (language from URL, `$_SERVER` manipulation) | ⏳ Open |
| 4.3 | Output buffer + HTML parser (DiDOM) | ⏳ Open |
| 4.4 | Deepglot API client (HTTP requests to the Next.js backend) | ⏳ Open |
| 4.5 | Local translation cache (custom DB table) | ⏳ Open |
| 4.6 | Link replacement (HTML, JSON, XML) | ⏳ Open |
| 4.7 | `hreflang` tags + SEO | ⏳ Open |
| 4.8 | Language switcher (shortcode + widget + Gutenberg block) | ⏳ Open |
| 4.9 | Admin settings page (API key, languages, exclusions) | ⏳ Open |

---

## Phase 5 - Self-Hosted Option

| # | Task | Status |
|---|---|---|
| 5.1 | Docker Compose setup (Next.js app + PostgreSQL) | ⏳ Open |
| 5.2 | Environment configuration for self-hosting | ⏳ Open |
| 5.3 | Installation guide | ⏳ Open |

---

## Phase 6 - Post-MVP Extensions

| # | Task | Status |
|---|---|---|
| 6.1 | Visual translation editor (edit directly on the live site) | ⏳ Open |
| 6.2 | Glossary feature (terms that should never be translated) | ⏳ Open |
| 6.3 | Import / export (CSV / PO files) | ⏳ Open |
| 6.4 | WooCommerce email translation | ⏳ Open |
| 6.5 | Browser-language auto redirect | ⏳ Open |
| 6.6 | Subdomain support (`de.example.com`) | ⏳ Open |
| 6.7 | Analytics dashboard (translation volume, language stats) | ⏳ Open |
| 6.8 | Webhook events (for new translations, etc.) | ⏳ Open |

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
| Email | Resend | Next.js friendly, cost-effective |
| Translation (Primary) | OpenAI provider abstraction | Low-cost default path, model configurable, local `mock` mode for development |
| Translation (Secondary) | DeepL provider | Optional quality-focused fallback for production-sensitive content |
| WP HTML Parser | DiDOM | Modern, actively maintained, Composer-ready |
| DB topology (Vercel + Neon) | Variant A: 2 branches | Neon `preview` → Vercel Development + Preview; Neon `prod` → Vercel Production only. See README “Setting up the Neon production branch”. |

---

## Legend

- ✅ Completed
- 🔄 In Progress
- ⏳ Open
- ❌ Blocked
