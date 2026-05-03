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
- Optional legacy alias URLs in `DEEPGLOT_LEGACY_ALIAS_URLS` redirect to `deepglot.ai/pricing` with `308`.
- Public DNS resolves both production hosts to the expected Vercel IP.
- `meinhaushalt.at/en/` renders translated English content without raw language markers.

## SaaS Acceptance

| Area | Required result | Status |
|---|---|---|
| Domain | `deepglot.ai` is the canonical app URL and `www` redirects for page traffic | ✅ Passed |
| Environment | Production uses `AUTH_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL` set to `https://deepglot.ai` | ✅ Passed |
| Public API | `/api/public/status` returns `200` on production hosts | ✅ Passed |
| Auth | Login, logout, signup, OAuth fallback behavior, and localized auth redirects work | ✅ Automated SaaS acceptance passed |
| Project flow | Create project, generate API key, update languages, and delete test project | ✅ Automated SaaS acceptance passed |
| Translation API | `/api/translate` validates API keys, returns backward-compatible response shape, writes batch logs, and updates usage | ✅ Automated SaaS acceptance passed |
| Runtime sync | Plugin settings sync mirrors routing mode, language settings, redirects, email/search/AMP flags, and domain mappings | ✅ Automated SaaS acceptance passed with a disposable project API key |
| Glossary | CRUD, validation, provider placeholder protection, manual override precedence, and webhook event creation work | ✅ Automated Phase 6 Playwright acceptance passed |
| Import/export | CSV and PO imports are all-or-nothing; exports use deterministic headers and content | ✅ Automated Phase 6 Playwright acceptance passed |
| Visual editor | Token creation, backend token verification, WordPress editor boot, segment selection, save, reload persistence, and invalid-token rejection work | ✅ Automated Phase 6 acceptance passed |
| Analytics | Translation volume, language mix, provider/cache/manual/glossary mix, top URLs, and import activity are log-backed | ✅ Automated Phase 6 Playwright acceptance passed |
| Webhooks | Endpoint CRUD, signing, test delivery, cron processing, retries, and final failure states work | ✅ Automated Phase 6 Playwright and webhook observability acceptance passed |
| Billing | Plan, usage, customer portal, cancellation, and Stripe webhook handling work in the intended mode | ⏸️ Postponed - Stripe live billing acceptance is an external dependency |

## WordPress Acceptance

Before installing an updated plugin build on a live WordPress site:

- Keep an SSH-accessible copy of the currently installed plugin directory.
- Export the current Deepglot plugin settings from WordPress admin or via the plugin REST endpoint.
- Confirm the SaaS project has a valid API key and `https://deepglot.ai/api` as the backend URL.
- Leave browser-language auto redirect disabled until path-prefix routing is verified.

Required checks on `meinhaushalt.at`:

| Area | Required result | Status |
|---|---|---|
| Plugin install | Updated plugin activates without fatal errors and settings remain intact | ✅ Passed |
| Connection | Test connection succeeds and triggers settings sync to the SaaS backend | ✅ Passed |
| Path-prefix routing | `/en/` resolves to the source page and serves translated content | ✅ Passed |
| Cache | Repeated translated page requests reuse the WordPress translation cache | ✅ Passed |
| Link rewriting | Internal links, forms, canonicals, hreflang tags, and switcher URLs keep the active locale | ✅ Passed |
| Exclusions | Admin, REST, AJAX, feed, preview, and excluded paths are not translated or redirected | ✅ Passed |
| Browser redirect | First-visit redirect respects `Accept-Language`, preference cookie, and skip contexts | ⏳ Deferred, disabled for rollout |
| Subdomains | Host-based language routing works only when every active language has a valid mapping | ➖ Not applicable on this site |
| WooCommerce email | If WooCommerce is present, subject, heading, and HTML body use checkout language order meta | ➖ Not applicable, WooCommerce inactive |
| Visual editor | Editor mode only boots after token verification and only marks visible translated text nodes | ✅ Passed |

### `meinhaushalt.at` Acceptance Run - 2026-04-26

- Existing plugin and settings were backed up on the server before replacement.
- Current plugin build was uploaded through SSH, linted on the server, and activated in place.
- Stored plugin backend URL was changed from an old Vercel Preview API URL to `https://deepglot.ai/api`.
- Production API key was updated from the local private environment and settings sync succeeded against the production backend.
- Runtime sync updated project `cmoby1ofs0002687hgqupd5m3` with `PATH_PREFIX`, source `de`, target `en`, and `autoRedirect=false`.
- Repeated `/en/` requests returned `200`, kept the Deepglot transient count stable, and rendered English text without raw language markers.
- Link rewriting and SEO output were verified on `/en/`: canonical URL, `de`, `en`, and `x-default` hreflang tags, and localized internal links were present.
- Operational contexts were verified as not translated by Deepglot: admin, REST, feed, and preview requests used WordPress-native responses or redirects.
- Browser-language redirect remained disabled for the rollout; an English `Accept-Language` request to `/` returned `200` without redirect. Full redirect behavior still needs a guarded enablement test with `autoRedirect=true`.
- Visual editor boot was verified with a production editor token: the live page emitted 262 manifest segments, 262 DOM segment markers, and the editor root.
- `DEEPGLOT_EDITOR_SECRET` is set in Vercel Production for stable visual-editor token verification.

Known follow-up:

- The visual-editor live boot check now verifies the token against the production backend before accepting the WordPress editor shell.

## SaaS Automated Acceptance

Run this suite to verify production SaaS behavior without touching Stripe or WordPress content:

```bash
npm run acceptance:saas -- --json output/saas.json --junit output/saas.xml
```

Optional flags:

- `--strict` makes blocked or skipped checks fail the command.
- `--skip-live` skips production SaaS HTTP/API checks.

### SaaS Acceptance Run - 2026-05-03

Latest local run:

- `npm run acceptance:saas -- --json output/saas.json --junit output/saas.xml`
- Result: `4/4` passed, `0` failed, `0` blocked, `0` skipped.
- Passed: dashboard credentials session, disposable project create/update/API-key/delete flow, `/api/translate` response shape plus `TranslationBatchLog` verification, and disposable-project runtime settings sync.
- The suite uses the dedicated `acceptance@deepglot.ai` production acceptance account. It does not create Stripe resources, edit WordPress content, or mutate live project settings; settings sync runs only against the disposable project API key before the project is deleted.

## Phase 6 Automated Acceptance

Run this suite when Phase 6 status needs to be refreshed without changing WordPress content, DNS, billing, or manual translations:

```bash
npm run acceptance:phase6 -- --json output/phase6.json --junit output/phase6.xml
```

Optional flags:

- `--strict` makes blocked or skipped checks fail the command.
- `--skip-live` skips production WordPress/backend checks.
- `--skip-e2e` skips the dashboard Playwright flow.

### Phase 6 Acceptance Run - 2026-05-03

Latest local run:

- `npm run acceptance:phase6 -- --json output/phase6.json --junit output/phase6.xml`
- Result: `6/7` passed, `0` failed, `1` blocked, `0` skipped.
- Passed: WordPress `/en/` translated output, plugin runtime-config API shape, backend-verified visual-editor live boot, browser-language redirect guarded-disabled rollout, WordPress PHP Phase 6 coverage, and Phase 6 Playwright dashboard flows.
- Blocked: subdomain mapped-host QA because no `DEEPGLOT_PHASE6_SUBDOMAIN_HOST` is configured.
- The suite is read-only for production WordPress: it does not save editor changes, update settings, edit content, or create DNS records.

## Operational Acceptance - 2026-04-30

Neon and Stripe acceptance scripts are now repeatable and non-destructive by default:

- `npm run acceptance:neon -- --env-file .env.production.local` passed as a dry run and would create a restore-drill branch from `prod`.
- `npm run acceptance:neon -- --env-file .env.production.local --create` passed on 2026-05-01. It created and validated temporary branch `restore-drill-prod-20260501195333` from `prod`; Neon set it to expire at `2026-05-02T19:53:33.429Z`.
- `npm run acceptance:stripe -- --mode live --env-file .env.production.local` is postponed until live Stripe keys, webhook secret, and monthly price IDs are intentionally configured.
- `npm run acceptance:stripe -- --mode test --env-file .env.local --env-only` is postponed until test Stripe keys, webhook secret, and monthly price IDs are intentionally configured.

Stripe live billing acceptance is not active engineering work right now. These checks do not create paid Stripe objects; once Stripe is resumed, the live API check remains read-only and validates price objects plus webhook endpoint registration.

`npm run acceptance:production` is the default post-deploy wrapper. It runs the smoke suite, Neon dry-run/readiness, Stripe live/test readiness, rate-limit config readiness, webhook processor readiness, SaaS acceptance, and Phase 6 acceptance. JSON and JUnit reports can be written with `--json output/production-acceptance.json --junit output/production-acceptance.xml`. The wrapper exits successfully when only external live checks are blocked; use `--strict` to make blocked or skipped checks fail CI.

Latest production wrapper run on 2026-05-03:

- `npm run acceptance:production -- --json output/production-acceptance.json --junit output/production-acceptance.xml`
- Result: `5/9` passed, `0` failed, `4` blocked, `0` skipped.
- Blocked: Stripe live/test configuration is postponed, SaaS acceptance still used the pre-fix production deployment during this run, and Phase 6 subdomain mapped-host QA needs `DEEPGLOT_PHASE6_SUBDOMAIN_HOST`.

## Alias Policy

- `https://deepglot.ai` is the canonical SaaS host.
- `www.deepglot.ai` redirects page traffic to the canonical apex host.
- The active Vercel Production deployment host redirects page traffic to the canonical apex host automatically.
- Additional known production aliases can be configured with `DEEPGLOT_CANONICAL_REDIRECT_HOSTS`.
- Vercel Preview and branch deployment URLs remain reachable for PR QA, even when `VERCEL_URL` is present.

## Exit Criteria

- `npm run smoke:production` passes after the production deployment.
- `npm run acceptance:production` passes after the production deployment, with no unexpected failures and with any blocked external checks explicitly reported.
- GitHub Actions and Vercel checks are green on the production commit.
- The WordPress validation site passes the manual plugin acceptance checks.
- No redirect loop exists across `www`, path-prefix routing, switcher navigation, browser redirect, or subdomain routing.
- No production-only credentials are required in source-controlled files.
- Any failed or deferred checks have a GitHub issue or roadmap item with owner and priority.

## Hardening Backlog

- Maintain the Phase 6 Playwright coverage for dashboard flows: glossary, import/export, analytics, webhooks, and visual editor.
- Maintain WordPress PHP coverage for WooCommerce email translation, browser redirect edge cases, and subdomain routing.
- Monitor DB-backed rate-limit buckets for `/api/translate`, plugin API-key endpoints, and password-reset abuse paths after production rollout.
- Monitor webhook processor runs and failed deliveries through the Webhooks dashboard after each production deployment.
- Configure Stripe live keys and monthly price IDs, then run the read-only live Stripe acceptance check.
