# Production Acceptance

This checklist is the release gate for Deepglot production changes after the app is deployed to Vercel and the WordPress plugin is installed on a live site.

## Scope

- Canonical SaaS domain: `https://deepglot.ai`
- Secondary host: `https://www.deepglot.ai`, redirected to the apex host for normal pages
- Live WordPress validation site: `https://www.meinhaushalt.at`
- Production backend: Vercel Production with the Neon `prod` branch

## Automated Smoke Test

Run this after every production deploy:

```bash
npm run smoke:production
```

Optional overrides:

```bash
DEEPGLOT_PRODUCTION_URL=https://deepglot.ai \
DEEPGLOT_WWW_URL=https://www.deepglot.ai \
DEEPGLOT_WORDPRESS_URL=https://www.meinhaushalt.at \
DEEPGLOT_EXPECTED_DNS_IP=76.76.21.21 \
npm run smoke:production
```

The smoke test verifies:

- `GET /api/public/status` returns `200` on the apex domain.
- `GET /api/public/status` returns `200` on the `www` host.
- `GET /pricing` returns `200` on the apex domain.
- `www.deepglot.ai/pricing` redirects to `deepglot.ai/pricing` with `308`.
- Public DNS resolves both production hosts to the expected Vercel IP.
- `meinhaushalt.at/en/` renders translated English content without raw language markers.

## SaaS Acceptance

| Area | Required result | Status |
|---|---|---|
| Domain | `deepglot.ai` is the canonical app URL and `www` redirects for page traffic | ✅ Passed |
| Environment | Production uses `AUTH_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL` set to `https://deepglot.ai` | ✅ Passed |
| Public API | `/api/public/status` returns `200` on production hosts | ✅ Passed |
| Auth | Login, logout, signup, OAuth fallback behavior, and localized auth redirects work | ⏳ Pending |
| Project flow | Create project, generate API key, update languages, and delete test project | ⏳ Pending |
| Translation API | `/api/translate` validates API keys, returns backward-compatible response shape, writes batch logs, and updates usage | ⏳ Pending |
| Runtime sync | Plugin settings sync mirrors routing mode, language settings, redirects, email/search/AMP flags, and domain mappings | ⏳ Pending |
| Glossary | CRUD, validation, provider placeholder protection, manual override precedence, and webhook event creation work | ⏳ Pending |
| Import/export | CSV and PO imports are all-or-nothing; exports use deterministic headers and content | ⏳ Pending |
| Visual editor | Token creation, plugin-side token verification, segment selection, save, reload persistence, and invalid-token rejection work | ⏳ Pending |
| Analytics | Translation volume, language mix, provider/cache/manual/glossary mix, top URLs, and import activity are log-backed | ⏳ Pending |
| Webhooks | Endpoint CRUD, signing, test delivery, cron processing, retries, and final failure states work | ⏳ Pending |
| Billing | Plan, usage, customer portal, cancellation, and Stripe webhook handling work in the intended mode | ⏳ Pending |

## WordPress Acceptance

Before installing an updated plugin build on a live WordPress site:

- Keep an SSH-accessible copy of the currently installed plugin directory.
- Export the current Deepglot plugin settings from WordPress admin or via the plugin REST endpoint.
- Confirm the SaaS project has a valid API key and `https://deepglot.ai/api` as the backend URL.
- Leave browser-language auto redirect disabled until path-prefix routing is verified.

Required checks on `meinhaushalt.at`:

| Area | Required result | Status |
|---|---|---|
| Plugin install | Updated plugin activates without fatal errors and settings remain intact | ⏳ Pending |
| Connection | Test connection succeeds and triggers settings sync to the SaaS backend | ⏳ Pending |
| Path-prefix routing | `/en/` resolves to the source page and serves translated content | ✅ Smoke passed |
| Cache | Repeated translated page requests reuse the WordPress translation cache | ⏳ Pending |
| Link rewriting | Internal links, forms, canonicals, hreflang tags, and switcher URLs keep the active locale | ⏳ Pending |
| Exclusions | Admin, REST, AJAX, feed, preview, and excluded paths are not translated or redirected | ⏳ Pending |
| Browser redirect | First-visit redirect respects `Accept-Language`, preference cookie, and skip contexts | ⏳ Pending |
| Subdomains | Host-based language routing works only when every active language has a valid mapping | ⏳ Pending |
| WooCommerce email | If WooCommerce is present, subject, heading, and HTML body use checkout language order meta | ⏳ Pending |
| Visual editor | Editor mode only boots after token verification and only marks visible translated text nodes | ⏳ Pending |

## Exit Criteria

- `npm run smoke:production` passes after the production deployment.
- GitHub Actions and Vercel checks are green on the production commit.
- The WordPress validation site passes the manual plugin acceptance checks.
- No redirect loop exists across `www`, path-prefix routing, switcher navigation, browser redirect, or subdomain routing.
- No production-only credentials are required in source-controlled files.
- Any failed or deferred checks have a GitHub issue or roadmap item with owner and priority.

## Hardening Backlog

- Expand Playwright coverage for Phase 6 dashboard flows: glossary, import/export, analytics, webhooks, and visual editor.
- Add WordPress PHPUnit-style coverage for WooCommerce email translation and subdomain routing edge cases.
- Move API rate limiting from in-memory process state to shared storage before real multi-tenant traffic.
- Verify Vercel Cron authorization for `/api/webhooks/process` in Production and monitor failed webhook deliveries.
- Document the Neon backup and restore procedure for the `prod` branch.
- Decide whether legacy Vercel aliases should remain reachable or redirect to `https://deepglot.ai`.
