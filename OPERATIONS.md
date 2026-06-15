# Deepglot Operations Runbook

## Webhook Processor Monitoring

Vercel Cron invokes `/api/webhooks/process` every five minutes. Production requires `CRON_SECRET`; unauthenticated production requests must return `401`.

After each production deployment:

1. Run `npm run acceptance:production`.
2. Open a project under `Settings -> Webhooks`.
3. Confirm the processor health card shows the latest cron run, due deliveries, failed deliveries, delivered deliveries, and duration.
4. Confirm failed deliveries show the HTTP status or error message and the next retry time when retries remain.
5. If the processor health card shows a failed run, inspect Vercel logs for `/api/webhooks/process`, then re-run a webhook test delivery from the dashboard after fixing the endpoint or runtime issue.

Expected behavior:

- Successful cron responses include `runId`, `processed`, `delivered`, `failed`, `pendingRemaining`, and `durationMs`.
- Failed cron responses create a failed processor run when the database is reachable.
- Final webhook delivery failures stay visible as `FAILED`; retryable failures return to `PENDING` with the next attempt time.

## Rate-Limit Monitoring

Deepglot stores rate-limit buckets in Postgres so limits are shared across Vercel instances.

Defaults:

- `TRANSLATE_RATE_LIMIT_PER_MINUTE=60` for `/api/translate` per API key.
- `PLUGIN_RATE_LIMIT_PER_MINUTE=120` shared across plugin API-key endpoints per API key.
- `AUTH_RATE_LIMIT_PER_MINUTE=5` for password-reset requests per normalized email.

Expected behavior:

- Over-limit responses return `429` with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.
- Bucket subjects are SHA-256 hashes; raw API keys and email addresses are not stored in `RateLimitBucket`.
- Raising or lowering limits should be done through Vercel environment variables, followed by a production redeploy.

## Duplicate Subscription Alert (Stripe)

`POST /api/billing/checkout` prevents duplicate Checkout sessions (open-session reuse/expire, Stripe live-subscription guard), but a sub-second concurrent race can still let two Checkouts complete (issue #138, "prevent + alert"). When that happens, the `checkout.session.completed` webhook keeps the first subscription and logs the duplicate instead of overwriting the database row:

```text
[Stripe Webhook] DUPLICATE SUBSCRIPTION for org <orgId> — keeping <sub_kept> ; new subscription is orphaned, cancel/refund it manually: <sub_orphaned>
```

The orphaned subscription bills the customer in Stripe but is not tracked by the app, so it must be cleaned up manually and promptly:

1. Open the alert email (sent automatically when `DEEPGLOT_BILLING_ALERT_EMAIL` is configured) or search the Vercel production logs for `DUPLICATE SUBSCRIPTION` (route `/api/webhooks/stripe`); both contain the two subscription ids.
2. In the Stripe Dashboard, open the **orphaned** subscription (the `cancel/refund it manually` id) and cancel it immediately.
3. Refund the orphaned subscription's paid invoice(s) in full.
4. Verify the kept subscription: the `Subscription` row for the organization still points at the `keeping` id with the expected plan, and the customer has exactly one active subscription left in Stripe.
5. Inform the customer that the duplicate charge has been refunded.

Expected behavior:

- Redeliveries of the kept subscription's own event are never flagged. Redeliveries of the duplicate event log again, but the alert email is sent at most once per orphaned subscription — a `deepglot_duplicate_alerted` metadata marker on the Stripe subscription dedupes it durably.
- The kept subscription and the organization plan are never modified by the duplicate event.
- The alert email never blocks webhook processing — the send is bounded by a 5-second timeout, and a delivery failure is logged while the event still completes.

The alert email is built in: set `DEEPGLOT_BILLING_ALERT_EMAIL` to the operations recipient (delivery uses the existing Cloudflare email configuration: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`, `EMAIL_FROM`). A Vercel log-based notification on the string `DUPLICATE SUBSCRIPTION` remains useful as a backup in case email delivery fails.

## Quota Exhaustion Monitoring

Deepglot surfaces translation-quota exhaustion at two levels: the SaaS dashboard and the WordPress plugin admin.

### SaaS dashboard warning banners

The usage page evaluates `quotaUsageLevel(wordsUsed, wordsLimit)`:

- At ≥ 90 % of `wordsLimit` the usage page shows a **Warning** banner indicating the monthly limit will be reached soon.
- At ≥ 100 % of `wordsLimit` the usage page shows a **Limit reached** banner. Note: large batches may be rejected with 402 before usage increments past 100 %, so the red banner may not appear even when translations are already being rejected — the owner email at the 100 % threshold (below) and the WordPress admin notice are the more reliable operator signals for that case.

### Proactive owner email alerts

`POST /api/translate` emails the org owner at two thresholds, at most once per org per calendar month per threshold:

- **90 % warning**: the first accepted translation batch that pushes cumulative usage past 90 % triggers a warning email.
- **100 % limit reached**: the first 402 rejection triggers a "limit reached" email (large batches are rejected before they increment usage, so the 402 is the real "reached" signal).

Deduplication is handled by a `UsageAlert(organizationId, month, threshold)` unique table row (applied additively to the production and preview databases). The email send is bounded by a 5-second timeout and never causes the in-flight translation to fail.

Email delivery uses the same Cloudflare channel as the duplicate-subscription alert: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`, and `EMAIL_FROM` must be set in the Vercel Production environment.

### WordPress plugin quota signals

When the SaaS returns 402 for a translation request, the plugin:

1. Sets a `deepglot_quota_exhausted` WordPress transient (expires after 1 hour by default).
2. Displays a persistent **wp-admin notice** on all admin pages while the transient is active.
3. Returns `{ quota_exhausted: true }` from the dynamic-translation proxy (`POST /wp-json/deepglot/v1/translate-dynamic`) so the browser client stops retrying for the current browser session.

The WordPress REST status endpoint (`GET /wp-json/deepglot/v1/status`) exposes `quota_exhausted: true` from either signal — the health-ping `connection_code` or the transient set by a real translation 402.

**Authentication required**: the `/status` route uses `permission_callback => checkPermission` (requires `manage_options`). Unauthenticated requests receive a 403, not quota state. Use a WordPress Application Password in the `Authorization: Basic <base64(user:app-password)>` header.

**Probe-phrase caching caveat**: `pingBackend()` sends a fixed German phrase (`"Verbindung jetzt testen"`). Once that phrase is cached on the SaaS side, `/api/translate` serves it from cache without touching the quota gate — so `connection_code` returns success and `quota_exhausted: false` even when real uncached translations would still receive 402. The transient (set by a real translation 402) is therefore the more reliable signal for external monitoring; the health-ping path is most useful in the minutes immediately after an incident when the phrase has not yet been cached.

(The SaaS `GET /api/public/status` is a bare DB health-check that returns no body and does not expose quota state.)

### Raising the quota

To lift the monthly word limit for a specific org (e.g. an ENTERPRISE org with `stripeSubscriptionId IS NULL`), update `Subscription.wordsLimit` directly in the database:

```sql
UPDATE "Subscription" SET "wordsLimit" = <new_limit> WHERE "organizationId" = '<org_id>';
```

(`Organization` has no `wordsLimit` column; the enforced limit is read from `Subscription.wordsLimit` via `getEffectiveWordsLimit`.)

**Status check**: `getEffectiveWordsLimit()` only honours the new `wordsLimit` when `status` is `ACTIVE` or `TRIALING`. For `PAST_DUE`, `INACTIVE` (the Prisma schema default), or `CANCELED` rows the function caps at the FREE-tier ceiling regardless of `wordsLimit`. Verify the subscription status and set it to `ACTIVE` if necessary:

```sql
SELECT status, "wordsLimit" FROM "Subscription" WHERE "organizationId" = '<org_id>';
-- If status is not ACTIVE or TRIALING:
UPDATE "Subscription" SET status = 'ACTIVE' WHERE "organizationId" = '<org_id>';
```

After the update:

1. Clear the WordPress plugin transient first: `wp transient delete deepglot_quota_exhausted` (or flush all transients with `wp transient delete --all`). This dismisses the wp-admin notice immediately and is required before the status check below is meaningful — the status endpoint ORs the live ping result with the transient, so if the transient is still set it will report `quota_exhausted: true` even after a successful ping.
2. Verify the quota is lifted: `GET /wp-json/deepglot/v1/status` should return `quota_exhausted: false` once the transient is cleared and the next health ping succeeds (or a real translation request goes through).

## Neon Restore Drill

Use the dry-run check before attempting a live branch drill:

```bash
npm run acceptance:neon -- --env-file .env.production.local
npm run acceptance:neon -- --env-file .env.production.local --json output/neon.json --junit output/neon.xml
```

When `NEON_API_KEY` and `NEON_PROJECT_ID` are available, create and validate a temporary branch from `prod`:

```bash
npm run acceptance:neon -- --env-file .env.production.local --create
```

Expected behavior:

- Dry run prints the branch that would be created and exits without writing anything.
- Live run creates a temporary child branch from `prod`, validates required tables through a pooled connection string, and sets a 24-hour branch expiry.
- The script never writes to the `prod` branch. Delete the temporary branch manually in Neon if you do not want to wait for TTL expiry.

## Phase 6 Acceptance

Run the autonomous Phase 6 suite after relevant deployments or before moving Phase 6 roadmap items from QA pending to verified:

```bash
npm run acceptance:phase6
npm run acceptance:phase6 -- --json output/phase6.json --junit output/phase6.xml
```

Default behavior is production-safe:

- Reads `https://deepglot.ai` and `https://www.meinhaushalt.at` unless overridden.
- Verifies translated `/en/` output, plugin runtime-config shape, backend-verified visual-editor boot, browser redirect guard behavior, and mapped subdomain status.
- Runs WordPress PHP coverage and Phase 6 Playwright dashboard flows.
- Does not save visual-editor edits, update WordPress settings, edit content, create DNS records, or touch Stripe billing resources.

Useful flags:

- `--strict` exits non-zero for blocked or skipped checks.
- `--skip-live` skips production WordPress/backend checks.
- `--skip-e2e` skips the Playwright dashboard checks.

Runtime configuration:

- `DEEPGLOT_PHASE6_APP_URL` defaults to `https://deepglot.ai`.
- `DEEPGLOT_PHASE6_WORDPRESS_URL` defaults to `https://www.meinhaushalt.at`.
- `DEEPGLOT_PHASE6_PROJECT_ID` falls back to `MEINHAUSHALT_PROD_DEEPGLOT_PROJECT_ID`.
- `DEEPGLOT_PHASE6_API_KEY` falls back to `MEINHAUSHALT_PROD_DEEPGLOT_API_KEY`.
- `DEEPGLOT_EDITOR_SECRET`, `AUTH_SECRET`, or `NEXTAUTH_SECRET` is required for the visual-editor live boot check.
- `DEEPGLOT_PHASE6_SUBDOMAIN_HOST` is required before subdomain live QA can pass.

## SaaS Acceptance

Run the SaaS acceptance suite after production deploys or auth/project-flow changes:

```bash
npm run acceptance:saas
npm run acceptance:saas -- --json output/saas.json --junit output/saas.xml
```

Default behavior:

- Verifies production dashboard credentials can create a real session.
- Creates and deletes a disposable SaaS project with the dedicated production acceptance account when credentials are valid.
- Verifies `/api/translate` response shape and the matching `TranslationBatchLog` row.
- Verifies plugin settings sync returns `runtimeSyncedAt` only on a disposable project API key before that project is deleted.
- Does not touch Stripe billing resources, WordPress content, or live project settings.

Runtime configuration:

- `DEEPGLOT_SAAS_APP_URL` defaults to `https://deepglot.ai`.
- `DEEPGLOT_DASHBOARD_EMAIL` and `DEEPGLOT_DASHBOARD_PASSWORD` are required for auth and project-flow checks.
- `DEEPGLOT_SAAS_PROJECT_ID` falls back to `MEINHAUSHALT_PROD_DEEPGLOT_PROJECT_ID`.
- `DEEPGLOT_SAAS_API_KEY` falls back to `MEINHAUSHALT_PROD_DEEPGLOT_API_KEY`.
- `DEEPGLOT_SAAS_PROJECT_DOMAIN` overrides the disposable project domain.

## Stripe Acceptance

Stripe is fully provisioned in live mode (account `acct_1GRyA0FAiA6nPZyW`, EUR). Five products with 10 prices (STARTER / BUSINESS / PRO / ADVANCED / EXTENDED × monthly and yearly), a webhook endpoint, and a restricted `rk_live_*` key are active in Vercel Production. `POST /api/billing/checkout` and the subscription pages (`/abonnement/*`) are live as of 2026-05-17 (Phase 8.1, 8.5). Do not create ad-hoc Stripe objects outside the defined plan structure.

Run env-only validation for test mode and read-only API validation for live mode:

```bash
npm run acceptance:stripe -- --mode test --env-file .env.local --env-only
npm run acceptance:stripe -- --mode live --env-file .env.production.local
npm run acceptance:stripe -- --mode live --env-file .env.production.local --json output/stripe.json --junit output/stripe.xml
```

Expected behavior:

- Test mode requires `sk_test_` and `pk_test_` keys plus all monthly price IDs.
- Live mode requires `sk_live_` and `pk_live_` keys, active monthly prices, and an enabled `/api/webhooks/stripe` endpoint with the required subscription events.
- The script never creates charges, customers, subscriptions, checkout sessions, or prices.

## Production Acceptance Wrapper

Use the wrapper for autonomous post-deploy checks:

```bash
npm run acceptance:production
npm run acceptance:production -- --json output/production-acceptance.json --junit output/production-acceptance.xml
```

Default behavior is non-destructive:

- Runs the production smoke suite.
- Runs the Neon restore-drill dry run.
- Reports Neon live restore-drill branch creation as blocked until `NEON_API_KEY` is available.
- Runs Stripe live/test acceptance; reports blocked only when Stripe keys, webhook secret, or monthly price IDs are absent from the environment.
- Reports rate-limit and webhook processor readiness.
- Runs SaaS acceptance and reports the aggregate as `PASS`, `FAIL`, `BLOCKED`, or `SKIPPED`.
- Runs Phase 6 acceptance and reports the aggregate as `PASS`, `FAIL`, `BLOCKED`, or `SKIPPED`.

Use `--strict` when CI should fail on blocked or skipped checks. Use `--skip-live` to skip SaaS and Phase 6 production HTTP checks. Use `--run-webhook-processor` only when it is acceptable to invoke the scheduled webhook processor immediately. Use `--create-neon-branch` only when a temporary Neon restore-drill branch should be created.

## i18n Development Scripts

The `scripts/` directory contains i18n utility scripts not exposed as `npm run` commands. These are developer tools for maintaining internationalization content and are invoked directly with `npx tsx`.

### Glossary management (meinhaushalt.at)

```bash
npx tsx scripts/glossary-rule-meinhaushalt.ts
npx tsx scripts/glossary-bust-meinhaushalt-cache.ts
```

- `glossary-rule-meinhaushalt.ts` — applies glossary term substitution rules for the meinhaushalt.at project.
- `glossary-bust-meinhaushalt-cache.ts` — deletes the backend `Translation` rows for glossary entries so that fresh translations are generated on the next API request. **This script does not flush the WordPress plugin's transient cache.** Because `HtmlTranslator` reads WordPress transients before calling `/api/translate`, existing transients keep serving the old translation until they expire (30-day TTL). The plugin does not yet expose an admin cache-flush control (`TranslationCache::flush()` exists but is not wired to the UI), so to make the updated glossary visible to visitors immediately, clear the plugin's transients directly — e.g. WP-CLI `wp transient delete --all` or a transient / object-cache cleaner. Otherwise the cached translations clear on their own once the 30-day TTL expires.

### i18n codemods

```bash
npx tsx scripts/i18n-codemod-api-copy.ts
npx tsx scripts/i18n-codemod-simple-copy.ts
```

One-shot codemods for migrating API-copy and simple-copy strings to the current i18n message format. Run only when performing a deliberate i18n format migration across the codebase.

### Static and plugin language file generation

```bash
npx tsx scripts/i18n-generate-static-messages.ts
npx tsx scripts/i18n-generate-wordpress-plugin-languages.ts
```

- `i18n-generate-static-messages.ts` — regenerates static message catalogues from source.
- `i18n-generate-wordpress-plugin-languages.ts` — generates the WordPress plugin `.pot` / `.po` locale files for EU language support. Run this after adding or changing any translatable strings inside `wordpress-plugin/deepglot/`.

## Stripe Setup Scripts

One-time provisioning scripts for initial Stripe account setup. These are not part of the regular acceptance workflow and must not be re-run against an already-provisioned account.

Credentials are read from the environment (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`). The scripts accept `--mode test` (default) or `--mode live`; use `--mode live` when provisioning against the production Stripe account. `--dry-run` prints what would be created without writing to Stripe.

```bash
# Test account (safe to run repeatedly against a test key)
npx tsx scripts/stripe-setup.ts --mode test
npx tsx scripts/stripe-backfill-plan-key-metadata.ts --mode test

# Production account (run only once; irreversible)
npx tsx scripts/stripe-setup.ts --mode live
npx tsx scripts/stripe-backfill-plan-key-metadata.ts --mode live
```

- `stripe-setup.ts` — creates the full Stripe product and price structure (5 products × 10 prices). Run only when provisioning a brand-new Stripe account or a new environment from scratch.
- `stripe-backfill-plan-key-metadata.ts` — backfills `plan_key` metadata on existing Stripe prices to align with the `Plan` enum. Run this after adding a new billing tier if the Stripe price was created before the `plan_key` metadata convention was established.
