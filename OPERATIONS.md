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
- Creates and deletes a disposable SaaS project when credentials are valid.
- Verifies `/api/translate` response shape and the matching `TranslationBatchLog` row.
- Verifies plugin settings sync returns `runtimeSyncedAt` only on a disposable project when dashboard credentials are valid.
- Does not touch Stripe billing resources, WordPress content, or live project settings.

Runtime configuration:

- `DEEPGLOT_SAAS_APP_URL` defaults to `https://deepglot.ai`.
- `DEEPGLOT_DASHBOARD_EMAIL` and `DEEPGLOT_DASHBOARD_PASSWORD` are required for auth and project-flow checks.
- `DEEPGLOT_SAAS_PROJECT_ID` falls back to `MEINHAUSHALT_PROD_DEEPGLOT_PROJECT_ID`.
- `DEEPGLOT_SAAS_API_KEY` falls back to `MEINHAUSHALT_PROD_DEEPGLOT_API_KEY`.
- `DEEPGLOT_SAAS_PROJECT_DOMAIN` overrides the disposable project domain.

## Stripe Acceptance

Stripe live billing acceptance is postponed as an external dependency until live/test billing configuration is intentionally created. Do not create products, prices, webhooks, customers, checkout sessions, or subscriptions as part of normal engineering work.

When Stripe is resumed, run env-only validation for test mode and read-only API validation for live mode:

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
- Reports Stripe live/test acceptance as blocked or postponed until the required Stripe keys, webhook secret, and monthly price IDs exist.
- Reports rate-limit and webhook processor readiness.
- Runs SaaS acceptance and reports the aggregate as `PASS`, `FAIL`, `BLOCKED`, or `SKIPPED`.
- Runs Phase 6 acceptance and reports the aggregate as `PASS`, `FAIL`, `BLOCKED`, or `SKIPPED`.

Use `--strict` when CI should fail on blocked or skipped checks. Use `--skip-live` to skip SaaS and Phase 6 production HTTP checks. Use `--run-webhook-processor` only when it is acceptable to invoke the scheduled webhook processor immediately. Use `--create-neon-branch` only when a temporary Neon restore-drill branch should be created.
