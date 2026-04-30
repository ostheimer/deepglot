# Deepglot Operations Runbook

## Webhook Processor Monitoring

Vercel Cron invokes `/api/webhooks/process` every five minutes. Production requires `CRON_SECRET`; unauthenticated production requests must return `401`.

After each production deployment:

1. Run `npm run smoke:production`.
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
```

When `NEON_API_KEY` and `NEON_PROJECT_ID` are available, create and validate a temporary branch from `prod`:

```bash
npm run acceptance:neon -- --env-file .env.production.local --create
```

Expected behavior:

- Dry run prints the branch that would be created and exits without writing anything.
- Live run creates a temporary child branch from `prod`, validates required tables through a pooled connection string, and sets a 24-hour branch expiry.
- The script never writes to the `prod` branch. Delete the temporary branch manually in Neon if you do not want to wait for TTL expiry.

## Stripe Acceptance

Run env-only validation for test mode and read-only API validation for live mode:

```bash
npm run acceptance:stripe -- --mode test --env-file .env.local --env-only
npm run acceptance:stripe -- --mode live --env-file .env.production.local
```

Expected behavior:

- Test mode requires `sk_test_` and `pk_test_` keys plus all monthly price IDs.
- Live mode requires `sk_live_` and `pk_live_` keys, active monthly prices, and an enabled `/api/webhooks/stripe` endpoint with the required subscription events.
- The script never creates charges, customers, subscriptions, checkout sessions, or prices.
