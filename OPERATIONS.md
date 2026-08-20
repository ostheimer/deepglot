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

## Weekly Activity Digest

Vercel Cron invokes `/api/cron/activity-digest` every Monday at 08:00 UTC. The job summarizes the previous complete UTC Monday-to-Monday period. Users opt in separately for each workspace under `Settings -> Notifications`; weeks without new translations, manual edits, or runtime translation requests are skipped.

Rollout order:

1. Apply `prisma/schema.prisma` to the target database with the repository's normal `npx prisma db push` workflow. The additive change introduces the two membership preference columns and the `ActivityDigestDelivery` table.
2. Deploy the application so the authenticated preference endpoint, cron route, and updated `vercel.json` become active together.
3. Enable the digest for a non-production test workspace from account settings.
4. Invoke the endpoint once with the production `CRON_SECRET`, then inspect the JSON counters and the recipient inbox. Do not invoke it again expecting another email for the same period: the delivery claim intentionally deduplicates retries.

Expected behavior:

- Production requests without `Authorization: Bearer <CRON_SECRET>` return `401`.
- Missing Cloudflare email configuration returns `503` with `configured: false`.
- Successful responses report `eligible`, `sent`, `duplicates`, `withoutActivity`, and `failed` without exposing recipient addresses.
- A provider failure removes the owned claim so a later Vercel retry can send it. Claims abandoned before the send lock is acquired are reclaimed after 15 minutes; successful claims remain unique per workspace, recipient, and period. Immediately before the provider call the claim is marked with a pending `sentAt` sentinel so stale reclaim cannot resend after a successful delivery when the final `sentAt` write is slow or transiently fails. If the process terminates after that sentinel write, the claim intentionally remains non-reclaimable: the delivery path favors at-most-once email over risking a duplicate when provider acceptance cannot be proven.
- Organization owners/admins receive totals for every workspace project. Members receive activity only for projects they can access, and sends run with at most four recipients in parallel.
- Imports and manual-save batches are not counted as runtime translation requests. Manual saves are reported separately, while newly created translation-cache entries supply the new-translation and word totals.

## Rate-Limit Monitoring

Deepglot stores rate-limit buckets in Postgres so limits are shared across Vercel instances.

Defaults:

- `TRANSLATE_RATE_LIMIT_PER_MINUTE=60` for `/api/translate` per API key.
- `PLUGIN_RATE_LIMIT_PER_MINUTE=120` shared across plugin API-key endpoints per API key.
- `AUTH_RATE_LIMIT_PER_MINUTE=5` for password-reset requests per normalized email.
- The translation fresh-word velocity limit is plan-derived: 10% of the effective monthly word quota per hour, with a minimum of 1,000. A valid positive `TRANSLATE_WORD_VELOCITY_PER_HOUR` value replaces that derived limit.

Expected behavior:

- Exhausted request-count or fresh-word windows return `429` with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`. Individually oversized fresh-word requests are the 422 exception: they return `velocity_request_too_large` without `Retry-After` and must be split into smaller inputs.
- Bucket subjects are SHA-256 hashes; raw API keys and email addresses are not stored in `RateLimitBucket`.
- Request-count limits are changed through their Vercel environment variables. Do not change the fresh-word velocity threshold until the classification-readiness steps below have produced representative evidence.

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

### Fresh and cached translation latency

Run the write-producing latency acceptance only with the explicitly approved dedicated production acceptance project:

```bash
npm run acceptance:translation-latency -- --confirm-write
npm run acceptance:translation-latency -- --confirm-write --json output/translation-latency.json
npm run acceptance:translation-latency -- --confirm-write --prod-env-file .env.production.local --local-env-file .env.local
```

The runner sends unique German corpora with 1, 12, 25, and 50 segments, then repeats each request byte-for-byte to measure the cached path. It verifies status, exact source order, complete non-empty translations, stable repeated output, and a faster cached response. HTTP 200 alone is not a pass. The command writes real translation, cache, usage, and batch-log state and therefore is not a read-only smoke test.

Set `DEEPGLOT_LATENCY_ACCEPTANCE_APP_URL` to exactly `https://deepglot.ai` and pair it with `DEEPGLOT_LATENCY_ACCEPTANCE_API_KEY` from the same environment source. Use a key for the dedicated acceptance project whose quota and stored synthetic translations may be consumed. The runner loads `.env.production.local` and `.env.local` separately; a complete process-environment pair overrides them, a complete local-file pair overrides the production file, and partial cross-source combinations fail closed. Generic project keys, customer keys, preview hosts, foreign hosts, URL credentials, and alternate paths are not accepted. Reports contain timing and contract classifications, never API-key values or response text. `--confirm-write` is mandatory.

The dedicated production run on 2026-08-09 passed all four representative sizes against the SaaS translation code later included unchanged in `cccc9ba`:

| Segments | Fresh | Cached | Fresh/cached |
| ---: | ---: | ---: | ---: |
| 1 | 11,516 ms | 1,140 ms | 10.10× |
| 12 | 15,580 ms | 1,135 ms | 13.73× |
| 25 | 16,330 ms | 1,212 ms | 13.47× |
| 50 | 18,735 ms | 1,225 ms | 15.29× |

Every response preserved exact source order and returned a complete, non-empty, non-identity translation set; the repeat returned identical translated values. All eight matching `/api/translate` requests were HTTP 200, with no provider-fallback, count-mismatch, timeout, rate-limit, or 429 event in that controlled window. The later WordPress warm-up window on deployment `dpl_DLwoXpjKFJJ6BpweArYLTMpB2atn` contained four `/api/translate` events and likewise no warning, error, count-mismatch, or timeout message.

After the run, inspect privacy-safe provider fallback and timeout logs for the same window. A complete 200 response can still have used a fallback provider, so clean API shape and latency evidence do not by themselves prove a healthy primary provider. Record the deployed application version and the WordPress plugin version before attributing any result to v0.12.0 background warming.

Provider count-mismatch recovery is deliberately narrower than ordinary fallback. Only when every attempted provider returns a count mismatch for the same multi-text root chunk does the SaaS start direct singleton isolation; it skips redundant binary intermediate shapes and retries each original text through the configured provider chain in input order. The provider-call ceiling is derived from the root chunk size and provider-chain length: for a multi-text root it is chain length × (chunk size + 1), while an original singleton gets one chain. A default eight-text chunk with two providers therefore allows at most 18 provider HTTP calls. This ceiling covers the root chain plus every singleton chain and remains a backstop against control-flow bugs. All root chunks and isolated singletons share the request-wide provider-call concurrency cap (default 12) and a provider-work deadline of at most 100 seconds (`TRANSLATION_REQUEST_TIMEOUT_MS` may lower but not raise it), preserving 20 seconds of the route's 120-second duration for refunds, persistence, and the response. PDF translation has a separate 40-second provider-work ceiling measured from the 60-second route handler's entry; authentication, multipart parsing, and PDF preparation consume that same clock before providers start, retaining a nominal 20-second margin for velocity refunds, rendering, persistence, and the response. A failed root chunk aborts siblings before they can start new provider calls. A singleton, provider-call-budget, or request-deadline mismatch remains terminal. Timeouts, authentication failures, quota/rate limits, U+0000 output, and other malformed responses never enter this isolation path. The root warning and terminal budget error record only provider chain, batch size, and count/budget metadata — never source or translated text, URLs, or credentials.

For WordPress warm-up verification, confirm that the stored purge target is the localized public request URL after routing rewrites, not the canonical source path. After Deepglot has durably written warm-up work and an immediately due event, it makes one non-blocking `spawn_cron()` nudge in the same request so a low-traffic page does not wait for another visit. The nudge is skipped with `DISABLE_WP_CRON`, while `DOING_CRON`/`wp_doing_cron()` is true, and after the first attempt in that request; system-cron sites remain responsible for invoking cron. WP Rocket, W3 Total Cache, and LiteSpeed Cache purge completed URLs individually. WP Super Cache exposes a global public purge only, so Deepglot delays that purge until the tracked URL queue has fully drained; pages that remain pending must stay cached.

From v0.12.3, `deepglot_warm_queue` and `deepglot_warm_queue_urls` are stored as versioned, checksummed ASCII-safe envelopes. This avoids four-byte Unicode write failures on legacy `wp_options` encodings while keeping exact texts and URLs available after decoding. Existing native-array values migrate through byte-exact compare-and-set. Treat a malformed envelope as recoverable evidence: the plugin fails closed and does not overwrite or delete either queue, including during disabled or missing-key cleanup. Back up the exact raw option before any manual repair; do not delete or rewrite it merely because the public pending count is zero. A separate short-lived option claim couples text, URL, and purge reconciliation; provider calls happen before that claim. Lease fencing prevents a stale owner from committing only the text side. A contended reconciliation keeps both queues intact and schedules a five-second retry; a cold visitor response whose enqueue is rejected is marked non-cacheable so a later request can retry.

From v0.12.4, translated transients use the separate `dgv1_` key space and a canonical, key-bound ASCII-safe envelope. Legacy `dg_` plain-string values remain readable only when the versioned key is absent; malformed versioned values fail closed. `set_transient()` returning false counts as success only after an exact readback. Otherwise the warmer retains both text and URL work, does not purge the page, and an inline response is marked non-cacheable and re-enqueued. This distinction is required on legacy `utf8mb3` option tables, where WordPress may create a timeout row but reject the four-byte value row.

Before confirming a WordPress URL-sync preview, inspect its sample URLs. If WordPress still stores an HTTP home/site URL while the current trusted wp-admin request is HTTPS on the identical host, each affected preview target must use HTTPS while preserving its approved route, including semantic query parameters and fragments. Deepglot uses the request host only to prove the same-host upgrade and never copies it into the target. A foreign host, an untrusted forwarded-protocol hint, or a request WordPress does not recognize as SSL must not rewrite the configured origin. One absolute, query- and fragment-free redirect on the exact same origin and in the requested target language may be verified through separate public and origin probes; automatic redirect following remains disabled. Other redirects remain bounded failures. Completion verification separately probes the query-free public target.

Production warm-up acceptance passed on `meinhaushalt.at` with v0.12.0 from commit `cccc9ba` on 2026-08-09. A unique cold `/en/` page returned all four German source sentences in 827 ms and created two WP Rocket files. A synthetic one-shot provider failure left five texts plus the localized request URL queued and retryable. The next visitor request returned in 1.197 s and emitted an HTTPS, non-blocking cron request (`blocking=false`, `timeout=0.01`); at the first 2.5-second drain poll, both warm-up options were empty and the two stale WP Rocket files were gone. The next render contained all four translated marker paragraphs and no original German sentence in 189 ms; the cached repeat preserved those four paragraphs in 56 ms. Cleanup deleted the page, synthetic hook, flags, queue entries, and cache files, and the temporary public URL returned 404.

The follow-up v0.12.1 production acceptance passed on `meinhaushalt.at` from merge commit `3b91400798e363973d9ecc5810d541fbd33bbe39` on 2026-08-10. Build the exact commit twice and require identical release bytes before deployment; the accepted ZIP SHA-256 is `56f2bd30c563682062f75d4e3e310bfd8318df7b7f0b526b373fd2f1c777aabc`, and the installed normalized tree is `ba69705480a33033d44d7998789f7b005a6c733ebc05159145656867f4154795`. Purge the WP Rocket domain cache after replacing plugin files: otherwise cached HTML can continue referencing the previous `?ver=` value even when the new asset exists. Fresh `/en/` HTML referenced `dynamic-translator.js?ver=0.12.1`, whose canonical URL without a cache-buster matched the package SHA-256 `ed7ccdd22b90191f1a56b947817f8aa1b18f9f31926e96b9deb79b2b9f0804cb`. A one-URL preview emitted `https://www.meinhaushalt.at/en/` without a query, completed in one cron attempt, and left no error; the job, locks, queues, and cron events were removed afterward.

An already active WordPress core `doing_cron` lock can legitimately defer the immediate loopback; Deepglot leaves the event due so a later request or the configured system cron can claim it. Do not remove an active lock. If the queue and due event remain after the configured `WP_CRON_LOCK_TIMEOUT` (60 seconds by default), verify loopback reachability, `DISABLE_WP_CRON`, the host's system-cron schedule, and the `doing_cron` lock age before retrying or purging anything manually.

### Request-wide count-mismatch admission

Complete the bounded root-chunk phase before any singleton request starts. Collect only roots whose complete provider chains produced count mismatches; every other terminal error must still abort siblings immediately. Before isolation, compare the remaining shared deadline with an optimistic first-provider-only estimate: the shortest provider-call duration observed in those root chains × `ceil(total mismatched texts / request-wide concurrency)`. If even that optimistic work cannot fit, fail before the first singleton with the privacy-safe classified error `count-mismatch singleton recovery cannot fit the remaining request deadline`. Otherwise, process all affected roots through one globally bounded singleton queue, preserving result order and the full provider fallback chain for every text.

## Stripe Acceptance

The repository defines the supported Stripe plan structure in `src/lib/billing-plans.ts`. Account, price, webhook, and Vercel-Production state are time-sensitive and must be verified with the read-only acceptance command below before being described as live. Do not put account identifiers or secret material in this runbook, and do not create ad-hoc Stripe objects outside the defined plan structure.

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

## PostgreSQL Text Rejection Monitoring

PostgreSQL text and `jsonb` fields cannot store U+0000. Deepglot rejects NUL-containing translation inputs before provider translation or translation-content persistence instead of truncating or rewriting content. Provider output with NUL is an invalid provider response, so the configured fallback provider is attempted before the request fails.

The structured warning event is `postgres_text_nul_rejected`. It contains only the boundary, field name, NUL count, and optional item index or provider; it never contains customer text, provider output, URLs, hashes, tenant identifiers, or credentials.

Runbook:

1. Group warnings by `boundary`. API, manual-translation, and import boundaries indicate invalid client content and should correspond to an HTTP 400 response.
2. For `translation_provider_output`, check the adjacent provider-failover warning. A successful fallback needs no data repair because the rejected output was never written.
3. A persistence-boundary warning is defense-in-depth evidence. Trace which earlier validation boundary was bypassed before retrying; do not normalize, truncate, or copy the rejected value into PostgreSQL.
4. Alert on sustained event-count growth, not on field values. No raw content is available or required for triage.

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

## Word Quota Alerts

Deepglot sends automatic email alerts when an organization's monthly word quota reaches 90% and 100%.

**How alerts are sent:**
- Alert emails go to the **organization owner's email address** (the first `OWNER` member of the organization, queried from `OrganizationMember`).
- Email delivery requires Cloudflare Email Sending to be configured (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`, `EMAIL_FROM`).
- `DEEPGLOT_BILLING_ALERT_EMAIL` is **not** used for quota alerts — it is the recipient for Stripe duplicate-subscription operational alerts only (see the "Duplicate Subscription Alert" section above).
- Deduplication: the `UsageAlert` table prevents duplicate alerts — one row per `(organizationId, month, threshold)`.

**Alert thresholds:**
- **90%** — triggered when an accepted translation request crosses the 90% usage boundary during processing.
- **100%** — triggered when a request is rejected with `402` (hard limit reached).

> **Note:** Thresholds fire only on increment — `crossedQuotaThresholds(usedBefore, usedAfter, limit)` returns thresholds strictly crossed by the current request. An organization already at 95% at the start of processing will not receive a retroactive 90% alert.

**UsageAlert table schema:**
```sql
-- month: YYYYMM integer, threshold: 90 or 100
-- Unique constraint: (organizationId, month, threshold)
```

**Runbook — alert not received:**
1. Verify the organization has an `OWNER` member with a valid email address in `OrganizationMember`.
2. Verify Cloudflare Email Sending is configured: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`, and `EMAIL_FROM` must all be set and non-empty.
3. Check Cloudflare Email Sending logs for delivery failures.
4. Check whether a `UsageAlert` row already exists — if so, the alert was previously triggered (possibly to a stale owner email address).

**Runbook — re-trigger a bounced alert:**
Deleting a `UsageAlert` row only enables re-sending when the threshold will be crossed again by a future request:
- **100% threshold:** if the organization is still at or above 100%, delete the row and the next rejected request will re-trigger the email.
- **90% threshold:** if current usage is already above 90%, deleting the row is not sufficient — the alert fires only when a request crosses 90% from below. To force a re-send in this case, either temporarily increase the word limit (so the ratio drops below 90%) and then delete the row, or send the email manually via `sendQuotaAlertEmail`.

```sql
DELETE FROM "UsageAlert"
WHERE "organizationId" = '<org-id>'
AND "month" = <YYYYMM>
AND "threshold" = <90 or 100>;
```

**Runbook — quota exhausted, translation stopped:**
- wp-admin shows a notice via `deepglot_quota_exhausted` transient
- Dynamic Translator stops retries upon `402` response from API
- To restore translation: upgrade the organization's plan or increase the quota limit
- Enterprise orgs without `stripeSubscriptionId` (e.g., meinhaushalt.at): quota can be adjusted manually in the database

### Translation velocity limit (per-org drain rate)

Separate from the monthly quota (a total) and the per-minute request rate limit (a count), `POST /api/translate` enforces a **per-organization fresh-word velocity limit** (ROADMAP 8.37, #203). The unchanged default is 10% of the effective monthly word quota per fixed 1-hour window, with a minimum of 1,000 fresh, provider-billed words. A valid positive `TRANSLATE_WORD_VELOCITY_PER_HOUR` value is an explicit operator override. Reservations are atomic in `RateLimitBucket`. The limit caps how fast an organization can drain its shared monthly quota and remains authoritative behind the WordPress plugin's soft per-IP caps.

- **Hard cap:** a request whose own fresh-word cost exceeds the complete hourly limit is classified as `oversize`, returns 422 `velocity_request_too_large` with no `Retry-After`, and never mutates a new or expired bucket. It is permanent for that request shape: split the request or PDF instead of scheduling it again. Normal requests retain the same atomic reservation behavior. This closes the prior first-request exception without raising or lowering the threshold.
- **Exempt:** cache hits and bot traffic never consume velocity. Health probes (`quota_probe`) are **not** exempt — the flag is attacker-settable and the spend path does not honor it, so exempting velocity would let it bypass the limit; a real probe's few words are negligible against the hourly budget.
- **Signal:** an exhausted existing window gets retryable 429 with `code: velocity_limited` and a `Retry-After` header. The plugin preserves a known delay from 1 through 3,600 seconds (60 seconds when missing or invalid), keeps the longest concurrent delay, and does not retry before it. This is not hard monthly exhaustion (that is still `402`).
- **WordPress send gate:** an active 429 marker locally stops synchronous visual-editor and WooCommerce email calls as well as an already-due warmer run until `retry_at`; the warmer persists the longest bounded timestamp before acquiring its dispatch lock. Only translation 429 responses set the active marker; configuration and synchronization 429 responses do not. Both the marker and warmer backoff are bound to the API key and backend. Configuration changes, late responses from the previous configuration, and legacy or unbound markers do not block new translations.
- **WordPress oversized batch isolation:** the warmer automatically splits a multi-text 422 batch under the existing six-batch run budget. Every 422 batch shape is tracked for up to one hour by a configuration-bound HMAC fingerprint to drive bounded splitting; only a text that still returns 422 alone is blocked from automatic resend. Normal following batches continue. No raw translation text, API key, or URL is stored in the marker. API key or backend changes alter its scope and heal it immediately; the bounded per-fingerprint expiry lets a later plan change heal. API requests and PDFs remain client-split.
- **Idempotency:** concurrent requests with the same `Idempotency-Key` share one execution and one response. A retryable 429 is retained only through its bounded `Retry-After` interval and can execute again after expiry; successful responses and deterministic 422 responses keep the normal retention. Replays emit only bounded status/code/retention metadata and keyed HMAC pseudonyms for scope and key.
- **Privacy-safe classification:** every attempted fresh-word reservation emits one JSON log event named `translate_velocity_reservation`. `outcome` is `allowed`, `blocked`, or `oversize`; the event also records actor class, surface, item count, retry protection, limit source, fresh-word count, limit, remaining words, retry seconds, and window seconds. Organization, project, and request grouping use 16-character keyed HMAC pseudonyms derived with the server-side auth secret. Raw organization/project IDs, translation text, API keys, idempotency keys, and URLs are never logged.

**Classification readiness before policy tuning:** No historical outcome classification exists before this rollout, so the previously observed aggregate 429 count cannot establish whether traffic was legitimate, abusive, retry amplification, request-count limiting, or velocity limiting. Do not change the threshold from that evidence alone.

1. Deploy the classifier and collect a representative window that includes normal weekdays and at least one expected traffic peak.
2. Verify `organizationPseudonym`, `projectPseudonym`, and `requestPseudonym` are present rather than `unavailable`, then aggregate `translate_velocity_reservation` by those HMAC pseudonyms, `outcome`, `actorClass`, `surface`, `itemCount`, `retryProtection`, `limitSource`, `freshWords`, and retry range. Repeated request pseudonyms without idempotency protection are the privacy-safe retry-amplification signal. Separately count `rate_limit_exceeded` and `velocity_limited` API responses; do not infer one from the total HTTP 429 count.
3. Verify that `oversize` attempts do not create or reset buckets and that ordinary concurrent reservations still stop at the configured limit.
4. Correlate aggregate changes with privacy-safe operational facts (release times, configured cron cadence, known import windows, and confirmed support reports). Do not add raw tenant IDs, request text, keys, or URLs to the event; use only the keyed HMAC pseudonyms already defined by the fixed schema.
5. Change a limit only with a reviewed sample showing repeatable legitimate blocking. Preserve the per-organization atomic guard and document the evidence, expected capacity, rollback value, and observation window.

**Runbook — a site reports "translations stopped" but the monthly quota is not exhausted:**
1. Confirm the response code: `velocity_limited` is the fresh-word guard; `rate_limit_exceeded` is the per-minute request guard. Preserve `Retry-After` when capturing the response metadata.
2. Review the privacy-safe classifier aggregate and the site's WP-Cron/import timing. A single support report or total 429 count is not enough to tune the shared policy.
3. Verify the WordPress client stopped later sequential batches after its first 429. Parallel batches may already be in flight, but each response must preserve its own bounded Retry-After classification.
4. Verify the warmer scheduled its next attempt for Retry-After and that the dynamic browser queue did not immediately resend visitor-facing work. Cached translations remain available; uncached content stays in the source language meanwhile.
5. If reviewed evidence proves legitimate repeatable blocking, use a positive `TRANSLATE_WORD_VELOCITY_PER_HOUR` override and redeploy with an explicit rollback value. If evidence indicates abuse or retry amplification, keep the threshold and address that source instead.

### WordPress plugin quota signals

When the SaaS returns 402 for a translation request, the plugin:

1. Sets a `deepglot_quota_exhausted` WordPress transient (expires after 1 hour).
2. Displays a **wp-admin notice** on admin pages while the transient is active.
3. Returns `quota_exhausted` from the dynamic-translation proxy (`POST /wp-json/deepglot/v1/translate-dynamic`) so the browser client stops retrying for the current session.

The plugin REST status endpoint (`GET /wp-json/deepglot/v1/status`) exposes `quota_exhausted` from either signal — the transient or a live 402 on the health ping. The endpoint is **not public**: it requires the `manage_options` capability (`permission_callback`), so external monitoring must authenticate, e.g. with a WordPress Application Password via `Authorization: Basic <base64(user:app-password)>`.

The status/test-connection ping sends `quota_probe: true`, so the SaaS rejects an exhausted quota even when every pinged word is already cached (ROADMAP 8.34) — the health check cannot be masked by cache hits.

### Dynamic consent widgets and multilingual discovery

Since WordPress plugin v0.12.5, the dynamic browser pass scans only explicitly configured consent-widget roots that already exist before its footer observer starts. It does not rescan the normal server-rendered document. Text follows the existing bounded dynamic endpoint; internal widget links are localized separately with server-side `SiteRouting` rules and URL values never enter provider requests. Acceptance must use a fresh browser context and verify both visible consent copy and the final targets of legal links on a target-language route.

On sites where WP Rocket rewrites JavaScript to `wp-content/cache/min/`, a normal page-cache purge can leave an older optimized copy of `dynamic-translator.js` active even though the direct plugin asset and its version query are current. After replacing the plugin, clear the WP Rocket JavaScript minify cache as well as the page and host caches. Do not accept the rollout from the direct asset alone: inspect the query-free target-language page, confirm that its actually loaded optimized asset contains the current URL-localization contract, and verify in a fresh human browser request that the dynamic payload includes `urls` and the response maps the legal links through `from_urls` and `to_urls`.

Since WordPress plugin v0.12.6, post-type discovery follows WordPress core `is_post_type_viewable()` semantics. Built-in public pages therefore remain discoverable even though core marks them `publicly_queryable=false`; non-viewable custom builder content types and attachments stay excluded. Taxonomies must be both `public` and `publicly_queryable`. Production acceptance must confirm that ordinary pages and categories are present while builder-internal or redirect-only archives are absent.

Deepglot normally advertises that sitemap through WordPress's `robots_txt` filter. A physical `robots.txt` in the WordPress document root bypasses the WordPress `robots_txt` filter completely, so plugin tests and the virtual route cannot prove the public result. Back up any physical file before editing it, preserve its existing directives, and add exactly one `Sitemap:` line using the canonical production host. Acceptance must read the query-free public `robots.txt` after all host caches are purged. Managed staging environments may intentionally replace it with `Disallow: /`; do not weaken that host-level protection merely to expose a staging sitemap.

### Raising the quota

To lift the monthly word limit for a specific org (e.g. an ENTERPRISE org with `stripeSubscriptionId IS NULL`), update `Subscription.wordsLimit` directly in the database:

```sql
UPDATE "Subscription" SET "wordsLimit" = <new_limit> WHERE "organizationId" = '<org_id>';
```

> **Note:** `Subscription.wordsLimit` is only fully honoured when the subscription status is `ACTIVE` or `TRIALING`. For other statuses, `getEffectiveWordsLimit()` caps the effective limit regardless of the stored value — verify the subscription status before raising the limit.

After the update, clear the plugin transient so the status endpoint reflects the live ping instead of the stale 402-set value (`wp transient delete deepglot_quota_exhausted`), then re-run the plugin test-connection — the `quota_probe` ping verifies the quota gate is genuinely open even on cache hits.
