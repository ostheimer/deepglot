# Production Acceptance

This checklist is the release gate for Deepglot production changes after the app is deployed to Vercel and the WordPress plugin is installed on a live site.

> **Note (2026-07):** Since the last documented acceptance run (approximately 2026-05), the Security-Hardening and quota-visibility changes #8.12–#8.34 have been rolled out to production. These cover SSRF-Guard (`webhook-url-safety.ts`), IDOR fixes for project settings and language management routes, CSV-injection protection in import/export, Rate-Limit hardening on manual-translations writes, Visual-Editor session token hardening, duplicate-Checkout guards (8.23–8.29), bot-traffic quota exemption (8.32, plugin v0.8.2), operator quota-exhaustion visibility — dashboard banners at ≥90%/≥100%, owner email alerts, wp-admin notice, plugin status endpoint (8.33) — and quota_probe cache-hit detection (8.34). A new full acceptance run against these changes is still pending.

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
| Billing | Plan, usage, customer portal, cancellation, Stripe Checkout, and webhook handling work in the intended mode | ✅ Completed — Stripe Live provisioned 2026-05-17; 5 products, 10 prices, restricted live key, and webhook active; `acceptance:stripe --mode live` passed (Phase 8.1, 8.5) |

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
| Browser redirect | First-visit redirect respects `Accept-Language`, preference cookie, and skip contexts | ✅ Passed |
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

### `meinhaushalt.at` Acceptance Run - 2026-05-07

PR [#28](https://github.com/ostheimer/deepglot/pull/28) (`Translate head <title>, meta description, og:* and switch <html lang>`) was merged into `main` (`e258597`) and the WordPress plugin was redeployed live via SSH.

- Existing plugin tarballed to `~/deepglot-backup-20260507-003909.tar.gz` on the server before replacement.
- New plugin synced through `rsync` (excluding `tests/`), PHP-linted in place. `BATCH_SIZE` is now `200`, `head` is no longer in `SKIP_TAGS`, and `OutputBuffer` switches `<html lang>` plus `xml:lang`.
- Brand-name glossary rules `Mein Haushalt`, `Meinhaushalt`, `MeinHaushalt`, and `meinhaushalt.at` are present in the production Neon project; the corresponding cached `Translation` rows that contained those terms were invalidated so the next translation run uses glossary protection.
- WordPress translation transients (`_transient_dg_*`) were cleared (700 entries) and the WP Rocket `/en/` page cache was purged before smoke runs.
- `/en/` warm hit returns translated `<title>`, `<meta name="description">`, `<meta property="og:title">`, and `<html lang="en">`. Brand-name occurrences of `Mein Haushalt` are preserved (no `My Household` in output).
- `/en/kategorie/gesundheit/` cold hit returned `200` in ≈7 s and renders translated body and `<title>`.
- `/en/tag/familie/` cold first hit can leave a few segments untranslated when the per-batch HTTP request reaches the 15 s plugin timeout; subsequent hits respond in ~1 s with full translation. Tracked as a follow-up performance task to parallelize translate batches.
- Browser-language redirect was enabled by setting `auto_redirect=true` on the WordPress option `deepglot_settings`. Verified contexts:
  - `/` with `Accept-Language: de` → `200` (no redirect, source language).
  - `/` with `Accept-Language: en-US,en;q=0.9` → `302` to `/en/?…` and sets `deepglot_preferred_language=en` cookie.
  - `/` with `curl/8.0` user agent → `200` (bot detection skip).
  - `/` with cookie `deepglot_preferred_language=de` → `200` (preference respected).
  - `/wp-admin/` with `Accept-Language: en` → only the regular WordPress login redirect.
  - `/feed/` with `Accept-Language: en` → only the existing WP feed redirect to `/`.
  - `/wp-json/` and `/sitemap_index.xml` with `Accept-Language: en` → `200`, no language redirect.
  - DE post slug with `Accept-Language: en` → `302` to the same slug under `/en/`.

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
- `npm run acceptance:stripe -- --mode live --env-file .env.production.local` passed 2026-05-17 after Stripe Live provisioning (Phase 8.5). All five products and 10 prices were verified.
- `npm run acceptance:stripe -- --mode test --env-file .env.local --env-only` validates test-mode keys and price IDs without creating any Stripe objects.

These checks do not create paid Stripe objects; the live API check is read-only and validates price objects plus webhook endpoint registration.

`npm run acceptance:production` is the default post-deploy wrapper. It runs the smoke suite, Neon dry-run/readiness, Stripe live/test readiness, rate-limit config readiness, webhook processor readiness, SaaS acceptance, and Phase 6 acceptance. JSON and JUnit reports can be written with `--json output/production-acceptance.json --junit output/production-acceptance.xml`. The wrapper exits successfully when only external live checks are blocked; use `--strict` to make blocked or skipped checks fail CI.

Latest production wrapper run on 2026-05-03:

- `npm run acceptance:production -- --json output/production-acceptance.json --junit output/production-acceptance.xml`
- Result: `6/9` passed, `0` failed, `3` blocked, `0` skipped.
- Passed: production smoke, Neon dry-run/readiness, rate-limit config, webhook processor readiness, and SaaS acceptance.
- Blocked: Stripe live/test configuration is postponed, and Phase 6 subdomain mapped-host QA needs `DEEPGLOT_PHASE6_SUBDOMAIN_HOST`.

## UI Audit Release - 2026-05-06

PR `#26` (`Fix UI navigation and add full audit coverage`) was merged into `main` and deployed to Vercel Production.

Verified results:

- GitHub Actions `main` CI passed for commit `c882439`, including documentation language checks, unit tests, WordPress PHP tests, build, and Playwright smoke tests.
- Vercel Production deployed successfully.
- `npm run smoke:production` passed `7/7` checks after deployment:
  - `https://deepglot.ai/api/public/status` returned `200`.
  - `https://www.deepglot.ai/api/public/status` returned `200`.
  - `https://deepglot.ai/pricing` returned `200`.
  - `https://www.deepglot.ai/pricing` redirected to `https://deepglot.ai/pricing`.
  - Apex and `www` DNS resolved to the expected Vercel IP.
  - `https://www.meinhaushalt.at/en/` returned translated English output without raw language markers.

Coverage added:

- Public and authenticated route UI audit with visible-interactive labeling checks.
- Internal app-owned link target verification.
- Marketing navigation regression coverage for the logo home link and `WordPress Plugin` navigation item.
- Accessibility coverage for account settings, project settings, subscription usage charts, and dashboard controls.

## Alias Policy

- `https://deepglot.ai` is the canonical SaaS host.
- `www.deepglot.ai` redirects page traffic to the canonical apex host.
- The active Vercel Production deployment host redirects page traffic to the canonical apex host automatically.
- Additional known production aliases can be configured with `DEEPGLOT_CANONICAL_REDIRECT_HOSTS`.
- Vercel Preview and branch deployment URLs remain reachable for PR QA, even when `VERCEL_URL` is present.

## Post-8.34 Re-Verification Checklist

The following commands cover Security-Hardening and quota-visibility changes #8.12–#8.34 that shipped after the last formal acceptance run (2026-05-03). Run these before treating the SaaS Acceptance table above as fully current:

```bash
# Full production wrapper (smoke + Neon + Stripe + SaaS + Phase 6)
npm run acceptance:production -- --json output/production-acceptance.json --junit output/production-acceptance.xml

# SaaS-only when Stripe or WordPress checks must be deferred
npm run acceptance:saas -- --json output/saas.json --junit output/saas.xml

# WordPress plugin v0.8.3 — follow the manual checklist above against meinhaushalt.at
```

Areas requiring explicit manual verification (not yet covered by automated suites):

- **SSRF guard** (`webhook-url-safety.ts`): a webhook URL pointing to an internal IP (e.g. `http://127.0.0.1/`) must be rejected with `400` before delivery.
- **IDOR fixes**: project-settings and language-management routes must return `404` when accessed with a different user's project ID (the handlers hide the project after `userCanManageProject` fails rather than exposing a `403`).
- **CSV injection** (import/export): a cell beginning with `=cmd|' /C calc'!A0` must be stored as a literal string, not evaluated or silently dropped.
- **Duplicate-Checkout guard** (8.23–8.29): submitting a second Stripe Checkout for the same plan/interval must return the URL of the existing open Checkout session rather than creating a new one; confirm only one open session exists in the Stripe dashboard after both attempts.
- **Bot-traffic quota exemption** (8.32, plugin v0.8.2+; deployed as v0.8.3): record the account's word-usage counter before and after sending a translation request with a verified-bot User-Agent — the counter must be unchanged; the plugin status endpoint and dashboard banner alone do not confirm whether `incrementUsageRecord` was called.
- **Quota banners** (8.33): an account at ≥90% word usage must show the dashboard warning banner; to trigger the owner alert email, send a translation request through `/api/translate` with the account at ≥100% — the email is sent on rejection (`402`) of a non-bot batch, not on page load alone.
- **`quota_probe` cache detection** (8.34): with a project at quota exhaustion, a `quota_probe` cache-hit request must be rejected before any translation is returned; note that uncached probes still reach the normal usage path — verify the cache-hit rejection behavior, not the usage counter.

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
