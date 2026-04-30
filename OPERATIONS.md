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
