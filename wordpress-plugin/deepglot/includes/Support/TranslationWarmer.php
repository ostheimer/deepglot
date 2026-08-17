<?php

namespace Deepglot\Support;

use Deepglot\Api\Client;
use Deepglot\Config\Options;

/**
 * Background cache warming for translatable segments.
 *
 * Fresh translations are provider-bound work: on 2026-08-03 the Deepglot API
 * needed 13.2s for 20 fresh segments and 28.2s for 120. Doing all of that
 * inside the page request means either a visitor waits that long or the client
 * gives up and the page silently renders in the source language — the latter
 * is what happened on jobspot.at, permanently, because an aborted request
 * never reaches the cache and every later visitor repeats it.
 *
 * `HtmlTranslator` therefore keeps only a bounded slice of the work inline and
 * hands the rest here. The queue is drained by a WP-Cron event that runs
 * without a visitor attached, so it can use large batches and a long timeout.
 * The result lands in the same `TranslationCache` the render path reads, so the
 * next request serves a fully translated page.
 *
 * Only human traffic enqueues work: bots are served cache-only (issue #147) and
 * must never trigger quota spend.
 */
class TranslationWarmer
{
    /** Cron hook that drains the queue. */
    public const HOOK = 'deepglot_warm_translations';

    /** Option holding the pending texts, keyed by "sourceLang|targetLang". */
    public const QUEUE_OPTION = 'deepglot_warm_queue';

    /** Option holding affected request URLs, keyed by language pair. */
    public const URL_QUEUE_OPTION = 'deepglot_warm_queue_urls';

    /** ASCII-only wrapper for queue values stored in legacy utf8 option rows. */
    private const QUEUE_ENVELOPE_PREFIX = 'deepglot-queue-v1:';

    /** Atomic owner/expiry lock guarding against concurrent cron drains. */
    public const LOCK_OPTION = 'deepglot_warm_running';

    /** Short atomic lock coupling text and URL queue mutations. */
    public const MUTATION_LOCK_OPTION = 'deepglot_warm_queue_mutating';

    /** Persisted next-attempt timestamp after a classified SaaS 429. */
    public const BACKOFF_OPTION = 'deepglot_warm_backoff_until';

    /** Privacy-safe fingerprints for batch shapes proven permanently oversize. */
    private const OVERSIZE_BATCH_TRANSIENT = 'deepglot_warm_oversize_batches';
    private const OVERSIZE_BATCH_TTL = 3600;

    /** Long enough to cover MAX_BATCHES_PER_RUN slow requests. */
    public const LOCK_TTL = 300;

    /** Queue mutations contain no provider work and should finish promptly. */
    public const MUTATION_LOCK_TTL = 15;

    /** Bounded retry after another request owns the queue mutation window. */
    private const MUTATION_LOCK_RETRY_DELAY = 5;

    /**
     * Upper bound on queued texts per language pair. A burst of cold pages
     * must not grow the option row without limit; anything dropped here is
     * re-queued by the next visit of the page it belongs to.
     */
    public const MAX_QUEUE = 1000;

    /**
     * Request timeout for warm runs. No visitor is waiting, so this is sized
     * for the slowest measured API response rather than for page-load latency:
     * a fresh 50-segment batch measured 40.5s against production on
     * 2026-08-03. 120s leaves headroom for a provider failover and matches the
     * route's `maxDuration`, beyond which the response could not arrive anyway.
     */
    public const TIMEOUT = 120;

    /**
     * Texts per request during a warm run. Larger than the render path's
     * batches because nobody is waiting: the provider's ~9s fixed cost is paid
     * once per request, so bigger batches are strictly cheaper here.
     */
    public const BATCH_SIZE = 50;

    /**
     * Requests per warm run. Bounds a single cron invocation; leftovers get a
     * follow-up event, so a large backlog drains over several runs instead of
     * hitting the PHP execution limit.
     */
    public const MAX_BATCHES_PER_RUN = 6;

    private Client $client;
    private Options $options;
    private TranslationCache $cache;

    /** One non-blocking WP-Cron nudge per request, no matter how often we enqueue. */
    private bool $spawnAttempted = false;

    public function __construct(Client $client, Options $options, TranslationCache $cache)
    {
        $this->client  = $client;
        $this->options = $options;
        $this->cache   = $cache;
    }

    public function register(): void
    {
        add_action(self::HOOK, [$this, 'run'], 10, 1);
    }

    /**
     * Queues texts for background translation and makes sure a run is pending.
     *
     * @param string[] $texts
     */
    public function enqueue(
        array $texts,
        string $sourceLang,
        string $targetLang,
        string $requestUrl = ''
    ): void
    {
        $texts = array_values(array_filter(
            array_unique(array_map('strval', $texts)),
            static fn(string $text): bool => $text !== ''
        ));

        if (empty($texts) || $sourceLang === '' || $targetLang === '') {
            return;
        }

        $requestUrl = trim($requestUrl);
        if (
            !$this->queueOptionIsValid(self::QUEUE_OPTION)
            || ($requestUrl !== '' && !$this->queueOptionIsValid(self::URL_QUEUE_OPTION))
        ) {
            return;
        }

        $key = $this->queueKey($sourceLang, $targetLang);
        $mergeTexts = static function (array $queue) use ($key, $texts): array {
            $merged = array_values(array_unique(array_merge($queue[$key] ?? [], $texts)));

            if (count($merged) > self::MAX_QUEUE) {
                $merged = array_slice($merged, 0, self::MAX_QUEUE);
            }

            $queue[$key] = $merged;

            return $queue;
        };

        if ($requestUrl === '') {
            $queueApplied = false;
            $this->updateQueue($mergeTexts, $queueApplied);
            if (!$queueApplied) {
                return;
            }
        } else {
            $mutationLockOwner = $this->acquireMutationLock();
            if ($mutationLockOwner === null) {
                return;
            }

            try {
                // Work out the URL tracking payload without changing the text
                // queue. The purge target must win its CAS before the work it
                // guards can become pending.
                $rawQueue = get_option(self::QUEUE_OPTION, false);
                $queueValid = false;
                $currentQueue = $this->decodeQueueOption(self::QUEUE_OPTION, $rawQueue, $queueValid);
                if (!$queueValid) {
                    return;
                }
                $queued = $mergeTexts($this->normalizeQueue($currentQueue));

                $hadPreviousUrlEntry = false;
                $previousUrlEntry = [];
                $writtenUrlEntry = [];
                $urlQueueApplied = false;
                $this->updateUrlQueue(static function (array $queue) use (
                    $key,
                    $requestUrl,
                    $texts,
                    $queued,
                    &$hadPreviousUrlEntry,
                    &$previousUrlEntry,
                    &$writtenUrlEntry
                ): array {
                    $hadPreviousUrlEntry = array_key_exists($requestUrl, $queue[$key] ?? []);
                    $previousUrlEntry = $hadPreviousUrlEntry
                        ? $queue[$key][$requestUrl]
                        : [];
                    $hasLegacyWildcard = $hadPreviousUrlEntry && empty($previousUrlEntry);
                    $tracked = $hasLegacyWildcard
                        ? ($queued[$key] ?? $texts)
                        : $previousUrlEntry;
                    $writtenUrlEntry = array_values(array_unique(array_merge($tracked, $texts)));
                    $queue[$key][$requestUrl] = $writtenUrlEntry;

                    return $queue;
                }, $urlQueueApplied);
                if (!$urlQueueApplied) {
                    return;
                }

                $queueApplied = false;
                $this->updateQueue($mergeTexts, $queueApplied);
                if (!$queueApplied) {
                    // Restore only the URL entry written by this enqueue. If a
                    // concurrent writer has changed it, leave the newer tracking
                    // data intact instead of trying to infer ownership of texts.
                    $this->updateUrlQueue(static function (array $queue) use (
                        $key,
                        $requestUrl,
                        $hadPreviousUrlEntry,
                        $previousUrlEntry,
                        $writtenUrlEntry
                    ): array {
                        if (
                            !array_key_exists($requestUrl, $queue[$key] ?? [])
                            || $queue[$key][$requestUrl] !== $writtenUrlEntry
                        ) {
                            return $queue;
                        }

                        if ($hadPreviousUrlEntry) {
                            $queue[$key][$requestUrl] = $previousUrlEntry;
                        } else {
                            unset($queue[$key][$requestUrl]);
                            if (empty($queue[$key])) {
                                unset($queue[$key]);
                            }
                        }

                        return $queue;
                    });
                    return;
                }

                // Different pages often contain the same text. Record every
                // affected URL even when no new segment was added. The URL
                // write happens first so a crash can leave only a harmless
                // orphan purge target, never untracked text work.
            } finally {
                $this->releaseMutationLock($mutationLockOwner);
            }
        }

        $retryIdentity = $this->configurationIdentity();
        $now = time();
        $knownBackoffUntil = min(
            $now + Client::MAX_RATE_LIMIT_BACKOFF,
            max(
                Client::rateLimitRetryAtForIdentity($retryIdentity),
                $this->backoffRetryAtForIdentity($retryIdentity)
            )
        );

        if ($knownBackoffUntil > $now) {
            if (
                $this->identityIsCurrent($retryIdentity)
                && $this->storeBackoffUntil($knownBackoffUntil, $retryIdentity)
                && $this->identityIsCurrent($retryIdentity)
            ) {
                $this->schedule(true, $knownBackoffUntil - $now, $retryIdentity);
            } else {
                // The retry belongs to an old snapshot. Leave it scoped to A
                // and plan current configuration B immediately/additively.
                $this->schedule();
            }
            return;
        }

        // Cron events are scoped to the current one-way configuration
        // identity. A stale event can remain until WordPress consumes it;
        // current work is planned additively without a global clear.
        $this->schedule();
    }

    /**
     * Pending texts per language pair. Exposed for diagnostics and tests.
     *
     * @return array<string, string[]>
     */
    public function pending(): array
    {
        return $this->readQueue();
    }

    /**
     * Cron callback: translates a bounded slice of the queue and caches it.
     */
    public function run(): void
    {
        $args = func_get_args();
        $scheduledIdentity = isset($args[0]) && is_string($args[0])
            ? $args[0]
            : null;
        $this->runForIdentity($scheduledIdentity);
    }

    public function runForIdentity(?string $scheduledIdentity = null): void
    {
        if (!$this->options->isEnabled() || !$this->options->isConfigured()) {
            $this->writeQueue([]);
            $this->writeUrlQueue([]);

            return;
        }

        $currentIdentity = $this->configurationIdentity();
        if (
            is_string($scheduledIdentity)
            && $scheduledIdentity !== ''
            && (
                $currentIdentity === ''
                || !hash_equals($scheduledIdentity, $currentIdentity)
            )
        ) {
            $this->schedule();
            return;
        }

        $queue = $this->readQueue();

        if (!$this->identityIsCurrent($currentIdentity)) {
            $this->schedule();
            return;
        }

        if (empty($queue)) {
            return;
        }

        $now = time();
        $backoffUntil = min(
            $now + Client::MAX_RATE_LIMIT_BACKOFF,
            max(
                $this->backoffRetryAtForIdentity($currentIdentity),
                Client::rateLimitRetryAtForIdentity($currentIdentity)
            )
        );
        if ($backoffUntil > $now) {
            // Defensive path for manual/duplicate cron invocations: do not
            // contact SaaS before its bounded Retry-After window has elapsed.
            if (
                $this->identityIsCurrent($currentIdentity)
                && $this->storeBackoffUntil($backoffUntil, $currentIdentity)
                && $this->identityIsCurrent($currentIdentity)
            ) {
                $this->schedule(true, $backoffUntil - $now, $currentIdentity);
            } else {
                $this->schedule();
            }
            return;
        }
        if ($backoffUntil > 0 && function_exists('delete_option')) {
            delete_option(self::BACKOFF_OPTION);
        }

        // `add_option()` is a database-level unique-key claim. A transient's
        // get-then-set sequence is not atomic and lets two simultaneous cron
        // requests spend quota on the same work.
        $lockOwner = $this->acquireLock();
        if ($lockOwner === null) {
            return;
        }

        // A warm batch legitimately runs tens of seconds (40.5s measured for 50
        // fresh segments). The default PHP limit on a WP-Cron request is often
        // 30s, which would kill the run mid-flight and waste the words the SaaS
        // already translated.
        if (function_exists('set_time_limit')) {
            @set_time_limit(self::TIMEOUT * 3); // phpcs:ignore WordPress.PHP.NoSilencedErrors -- disabled by hosts in safe mode.
        }

        try {
            $this->drain($queue, $currentIdentity);
        } finally {
            $this->releaseLock($lockOwner);
        }
    }

    // -------------------------------------------------------------------------

    /**
     * @param array<string, string[]> $queue
     */
    private function drain(array $queue, string $runIdentity): void
    {
        $budget = self::MAX_BATCHES_PER_RUN;
        $untouched = false;
        $completedByKey = [];
        $remainingByKey = [];
        $rateLimitBackoff = 0;
        $rateLimitIdentity = null;
        $oversizeMarkers = $this->readOversizeBatchMarkers($queue, $runIdentity);

        foreach ($queue as $key => $texts) {
            if ($budget <= 0) {
                $untouched = true;
                break;
            }

            [$sourceLang, $targetLang] = $this->parseQueueKey($key);

            if ($sourceLang === '' || $targetLang === '') {
                $completedByKey[$key] = $texts;
                $remainingByKey[$key] = [];
                continue;
            }

            // Another render may have translated some of these in the meantime;
            // re-sending them would spend quota for nothing.
            $cached  = $this->cache->getMany($texts, $sourceLang, $targetLang);
            $missing = array_values(array_filter(
                $texts,
                static fn(string $text): bool => !isset($cached[$text])
            ));

            if (empty($missing)) {
                $completedByKey[$key] = $texts;
                $remainingByKey[$key] = [];
                continue;
            }

            $batches = $this->partitionBatchesAroundOversizePrefixes(
                $missing,
                $sourceLang,
                $targetLang,
                $runIdentity,
                $oversizeMarkers
            );
            $processed = [];
            $blockedBatches = [];
            $deferredBatches = [];

            foreach ($batches as $batchState) {
                $batch = $batchState['batch'];
                if ($batchState['blocked']) {
                    $blockedBatches[] = $batch;
                    continue;
                }
                if ($budget > 0) {
                    $processed[] = $batch;
                    $budget--;
                } else {
                    $deferredBatches[] = $batch;
                }
            }

            if (!$this->identityIsCurrent($runIdentity)) {
                $this->schedule();
                return;
            }

            $dispatchIdentity = $runIdentity;
            $results = empty($processed)
                ? []
                : $this->dispatchBatchesForIdentity(
                    $runIdentity,
                    $processed,
                    $sourceLang,
                    $targetLang,
                    '',
                    0,
                    self::TIMEOUT
                );

            if (!$this->identityIsCurrent($runIdentity)) {
                $this->schedule();
                return;
            }

            $translations = [];
            $oversizeBatchesToRemember = [];
            $failed = empty($blockedBatches)
                ? []
                : array_merge([], ...$blockedBatches);

            foreach ($processed as $index => $batch) {
                $result = $results[$index] ?? null;

                if ($result === null || is_wp_error($result) || !is_array($result)) {
                    if (is_wp_error($result) && method_exists($result, 'get_error_data')) {
                        $errorData = $result->get_error_data();
                        if (is_array($errorData) && (int) ($errorData['status'] ?? 0) === 429) {
                            $responseIdentity = $errorData['rate_limit_identity'] ?? $dispatchIdentity;
                            if (
                                is_string($responseIdentity)
                                && preg_match('/^[a-f0-9]{64}$/D', $responseIdentity) === 1
                            ) {
                                $rateLimitIdentity = $responseIdentity;
                            }
                            $rateLimitBackoff = max(
                                $rateLimitBackoff,
                                max(1, min(
                                    Client::MAX_RATE_LIMIT_BACKOFF,
                                    (int) ($errorData['retry_after'] ?? Client::DEFAULT_RATE_LIMIT_BACKOFF)
                                ))
                            );
                        }
                        if (
                            is_array($errorData)
                            && (int) ($errorData['status'] ?? 0) === 422
                            && ($errorData['api_code'] ?? '') === 'velocity_request_too_large'
                        ) {
                            $oversizeBatchesToRemember[] = $batch;
                            if (count($batch) > 1) {
                                $untouched = true;
                            }
                        }
                    }
                    // Keep failed texts queued so a later run retries them.
                    $failed = array_merge($failed, $batch);
                    continue;
                }

                $pairs = $this->pairResult($result);
                $translations += $pairs;

                // A 2xx response is not necessarily complete. Keep every
                // omitted source text queued instead of silently dropping it.
                foreach ($batch as $text) {
                    if (!array_key_exists($text, $pairs)) {
                        $failed[] = $text;
                    }
                }
            }

            // Result inspection may invoke application hooks. Revalidate only
            // after every response has been evaluated and before committing
            // any cache, queue, URL, or oversize-marker state.
            if (!$this->identityIsCurrent($runIdentity)) {
                $this->schedule();
                return;
            }

            foreach ($oversizeBatchesToRemember as $oversizeBatch) {
                $this->rememberOversizeBatch(
                    $oversizeMarkers,
                    $sourceLang,
                    $targetLang,
                    $oversizeBatch,
                    $runIdentity
                );
            }

            if (!empty($translations)) {
                $this->cache->setMany($translations, $sourceLang, $targetLang);
            }

            $untouched = $untouched || !empty($deferredBatches);

            $remaining = array_values(array_unique(array_merge(
                $failed,
                array_merge([], ...$deferredBatches)
            )));

            $remainingByKey[$key] = $remaining;
            $completedByKey[$key] = array_values(array_diff($texts, $remaining));

            if ($rateLimitBackoff > 0) {
                // The SaaS velocity window is organization-wide. Reconcile
                // this pair, then leave every unvisited pair untouched until
                // the bounded delayed retry instead of spending more calls.
                $untouched = true;
                break;
            }
        }

        // Re-read after the provider calls: a frontend request may have
        // enqueued more work while this run was in flight. Reconcile only the
        // texts this snapshot completed and preserve everything added later.
        $mutationLockOwner = $this->acquireMutationLock();
        if ($mutationLockOwner === null) {
            // Cached provider results are already durable, while the queue is
            // still untouched. Retry reconciliation after the short owner has
            // left instead of repeating it inside the enqueue window.
            $this->schedule(
                true,
                self::MUTATION_LOCK_RETRY_DELAY,
                $runIdentity
            );
            return;
        }

        try {
            if (!$this->queueOptionIsValid(self::URL_QUEUE_OPTION)) {
                return;
            }

            $queueApplied = false;
            $this->updateQueue(static function (array $currentQueue) use (
                $completedByKey,
                $remainingByKey
            ): array {
                foreach ($completedByKey as $key => $completed) {
                    $current = $currentQueue[$key] ?? [];
                    $current = array_values(array_diff($current, $completed));
                    $current = array_values(array_unique(array_merge($current, $remainingByKey[$key] ?? [])));

                    if (empty($current)) {
                        unset($currentQueue[$key]);
                    } else {
                        $currentQueue[$key] = $current;
                    }
                }

                return $currentQueue;
            }, $queueApplied);
            if (!$queueApplied) {
                return;
            }
            $this->purgeCompletedUrls(array_keys($completedByKey), $mutationLockOwner);
        } finally {
            $this->releaseMutationLock($mutationLockOwner);
        }

        // Only chase work this run never attempted. Rescheduling because a
        // batch *failed* would spin: a persistent error (exhausted quota, SaaS
        // outage) would re-fire the event forever. Failed texts stay queued and
        // are retried the next time a visitor enqueues something — which is
        // exactly when translating them is worth attempting again.
        if ($rateLimitBackoff > 0) {
            $backoffUntil = time() + $rateLimitBackoff;
            if (
                is_string($rateLimitIdentity)
                && $this->storeBackoffUntil($backoffUntil, $rateLimitIdentity)
            ) {
                if ($this->identityIsCurrent($rateLimitIdentity)) {
                    $this->schedule(
                        true,
                        max(1, $this->backoffRetryAtForIdentity($rateLimitIdentity) - time()),
                        $rateLimitIdentity
                    );
                } else {
                    $this->schedule();
                }
            } elseif ($untouched) {
                $this->schedule();
            }
        } elseif ($untouched) {
            $this->schedule(true);
        }
    }

    // -------------------------------------------------------------------------

    /**
     * @param  array<string, mixed> $result
     * @return array<string, string>
     */
    private function pairResult(array $result): array
    {
        $from = $result['from_words'] ?? [];
        $to   = $result['to_words'] ?? [];

        if (!is_array($from) || !is_array($to)) {
            return [];
        }

        $from = array_values($from);
        $to   = array_values($to);
        $pairs = [];

        foreach ($from as $index => $original) {
            if (!is_string($original) || !isset($to[$index]) || !is_string($to[$index])) {
                continue;
            }

            $pairs[$original] = $to[$index];
        }

        return $pairs;
    }

    /**
     * @param array<int|string, string[]> $batches
     * @return array<int|string, array|\WP_Error>
     */
    private function dispatchBatchesForIdentity(
        string $expectedIdentity,
        array $batches,
        string $langFrom,
        string $langTo,
        string $requestUrl,
        int $bot,
        ?int $timeout
    ): array {
        return $this->client->translateBatchesForExpectedIdentity(
            $expectedIdentity,
            $batches,
            $langFrom,
            $langTo,
            $requestUrl,
            $bot,
            $timeout
        );
    }

    /** Current one-way API-key/backend identity; never persists raw config. */
    private function configurationIdentity(): string
    {
        return Client::configurationIdentityForOptions($this->options);
    }

    private function identityIsCurrent(string $identity): bool
    {
        $currentIdentity = $this->configurationIdentity();

        return $identity !== ''
            && $currentIdentity !== ''
            && hash_equals($identity, $currentIdentity);
    }

    /** Returns only the backoff bound to an explicit identity snapshot. */
    private function backoffRetryAtForIdentity(string $identity): int
    {
        $marker = get_option(self::BACKOFF_OPTION, false);
        $retryAt = is_array($marker) ? (int) ($marker['retry_at'] ?? 0) : 0;
        $markerIdentity = is_array($marker) ? ($marker['identity'] ?? null) : null;

        if (
            $retryAt <= time()
            || !is_string($markerIdentity)
            || $identity === ''
            || !hash_equals($markerIdentity, $identity)
        ) {
            // This reader owns only the marker snapshot it observed. A
            // different-identity writer may already have replaced the option
            // and event, so cleanup is deferred instead of deleting shared
            // state without compare-and-swap support.
            return 0;
        }

        return min($retryAt, time() + Client::MAX_RATE_LIMIT_BACKOFF);
    }

    /** Persists the longest bounded delay only for the still-current identity. */
    private function storeBackoffUntil(int $retryAt, string $requestIdentity): bool
    {
        for ($attempt = 0; $attempt < 10; $attempt++) {
            if (!$this->identityIsCurrent($requestIdentity)) {
                return false;
            }

            $raw = get_option(self::BACKOFF_OPTION, false);
            $existingRetryAt = is_array($raw)
                && ($raw['identity'] ?? null) === $requestIdentity
                ? (int) ($raw['retry_at'] ?? 0)
                : 0;
            $boundedRetryAt = min(
                time() + Client::MAX_RATE_LIMIT_BACKOFF,
                max($existingRetryAt, $retryAt)
            );
            $next = [
                'retry_at' => $boundedRetryAt,
                'identity' => $requestIdentity,
            ];

            if (!$this->identityIsCurrent($requestIdentity)) {
                return false;
            }

            if ($next === $raw) {
                return true;
            }

            if ($this->compareAndStoreOption(self::BACKOFF_OPTION, $raw, $next)) {
                return true;
            }

            $this->clearOptionCache(self::BACKOFF_OPTION);
        }

        return false;
    }

    /**
     * Keep markers only for exact batch forms that are still present in the
     * bounded queues. This bounds marker storage to queued work without
     * evicting an active form into an automatic resend loop.
     *
     * @param array<string, string[]> $queue
     * @return array<string, array{expires_at: int, length: int, action: string}>
     */
    private function readOversizeBatchMarkers(array $queue, string $configurationIdentity): array
    {
        if (!function_exists('get_transient')) {
            return [];
        }

        $stored = get_transient(self::OVERSIZE_BATCH_TRANSIENT);
        if (!is_array($stored)) {
            return [];
        }

        $now = time();
        $unbound = [];
        foreach ($stored as $fingerprint => $marker) {
            $expiresAt = is_array($marker)
                ? (int) ($marker['expires_at'] ?? 0)
                : (is_numeric($marker) ? (int) $marker : 0);
            $length = is_array($marker) && is_numeric($marker['length'] ?? null)
                ? (int) $marker['length']
                : 0;
            $action = is_array($marker) && in_array(($marker['action'] ?? ''), ['block', 'split'], true)
                ? (string) $marker['action']
                : ($length > 1 ? 'split' : 'block');
            if (
                is_string($fingerprint)
                && preg_match('/^[a-f0-9]{64}$/D', $fingerprint) === 1
                && $expiresAt > $now
                && $length >= 0
                && $length <= self::BATCH_SIZE
            ) {
                $unbound[$fingerprint] = [
                    'expires_at' => min($expiresAt, $now + self::OVERSIZE_BATCH_TTL),
                    'length' => $length,
                    'action' => $action,
                ];
            }
        }

        $active = [];
        foreach ($queue as $key => $texts) {
            [$sourceLang, $targetLang] = $this->parseQueueKey($key);
            if ($sourceLang === '' || $targetLang === '') {
                continue;
            }

            $matchedFingerprints = [];
            $this->partitionBatchesAroundOversizePrefixes(
                $texts,
                $sourceLang,
                $targetLang,
                $configurationIdentity,
                $unbound,
                $matchedFingerprints
            );
            foreach ($matchedFingerprints as $fingerprint => $length) {
                $active[$fingerprint] = [
                    'expires_at' => $unbound[$fingerprint]['expires_at'],
                    'length' => $length,
                    'action' => $length > 1
                        ? ((int) ($unbound[$fingerprint]['length'] ?? 0) === 0
                            ? 'split'
                            : ($unbound[$fingerprint]['action'] ?? 'split'))
                        : 'block',
                ];
            }
        }

        return $active;
    }

    /**
     * Stores only a configuration-bound one-way fingerprint and its own
     * bounded expiry. Rewriting the transient never extends older entries.
     *
     * @param array<string, array{expires_at: int, length: int, action: string}> $markers
     * @param string[] $batch
     */
    private function rememberOversizeBatch(
        array &$markers,
        string $sourceLang,
        string $targetLang,
        array $batch,
        string $configurationIdentity
    ): void {
        if (!function_exists('set_transient')) {
            return;
        }

        $fingerprint = $this->oversizeBatchFingerprint(
            $sourceLang,
            $targetLang,
            $batch,
            $configurationIdentity
        );
        if (!isset($markers[$fingerprint])) {
            $markers[$fingerprint] = [
                'expires_at' => time() + self::OVERSIZE_BATCH_TTL,
                'length' => count($batch),
                'action' => count($batch) > 1 ? 'split' : 'block',
            ];
        } elseif (count($batch) > 1) {
            // Migrate the pre-action schema without extending its own expiry.
            $markers[$fingerprint]['length'] = count($batch);
            $markers[$fingerprint]['action'] = 'split';
        }

        $ttl = max(
            1,
            max(array_column($markers, 'expires_at')) - time()
        );
        set_transient(self::OVERSIZE_BATCH_TRANSIENT, $markers, $ttl);
    }

    /**
     * Splits a current queue chunk at known permanent prefixes. The longest
     * matching prefix wins; an appended tail remains a separate normal batch.
     * Legacy timestamp-only markers are checked defensively without changing
     * the persisted privacy boundary.
     *
     * @param string[] $texts
     * @param array<string, array{expires_at: int, length: int, action: string}> $markers
     * @return array<int, array{batch: string[], blocked: bool}>
     */
    private function partitionBatchesAroundOversizePrefixes(
        array $texts,
        string $sourceLang,
        string $targetLang,
        string $configurationIdentity,
        array $markers,
        ?array &$matchedFingerprints = null
    ): array {
        $partitioned = [];
        $markerLengths = $this->oversizeMarkerLengths($markers);

        foreach (array_chunk($texts, self::BATCH_SIZE) as $chunk) {
            $partitioned = array_merge(
                $partitioned,
                $this->partitionOversizeChunk(
                    $chunk,
                    $sourceLang,
                    $targetLang,
                    $configurationIdentity,
                    $markers,
                    $markerLengths,
                    $matchedFingerprints
                )
            );
        }

        return $partitioned;
    }

    /**
     * @param string[] $chunk
     * @param array<string, array{expires_at: int, length: int, action: string}> $markers
     * @param int[] $markerLengths
     * @return array<int, array{batch: string[], blocked: bool}>
     */
    private function partitionOversizeChunk(
        array $chunk,
        string $sourceLang,
        string $targetLang,
        string $configurationIdentity,
        array $markers,
        array $markerLengths,
        ?array &$matchedFingerprints
    ): array {
        if (empty($chunk)) {
            return [];
        }

        $match = $this->knownOversizePrefix(
            $chunk,
            $sourceLang,
            $targetLang,
            $configurationIdentity,
            $markers,
            $markerLengths
        );
        if ($match === null) {
            return [['batch' => $chunk, 'blocked' => false]];
        }

        if ($matchedFingerprints !== null) {
            $matchedFingerprints[$match['fingerprint']] = $match['length'];
        }
        $prefix = array_slice($chunk, 0, $match['length']);
        $tail = array_slice($chunk, $match['length']);

        if ($match['action'] === 'split' && count($prefix) > 1) {
            $leftSize = (int) ceil(count($prefix) / 2);
            $partitioned = array_merge(
                $this->partitionOversizeChunk(
                    array_slice($prefix, 0, $leftSize),
                    $sourceLang,
                    $targetLang,
                    $configurationIdentity,
                    $markers,
                    $markerLengths,
                    $matchedFingerprints
                ),
                $this->partitionOversizeChunk(
                    array_slice($prefix, $leftSize),
                    $sourceLang,
                    $targetLang,
                    $configurationIdentity,
                    $markers,
                    $markerLengths,
                    $matchedFingerprints
                )
            );
        } else {
            $partitioned = [['batch' => $prefix, 'blocked' => true]];
        }

        return array_merge(
            $partitioned,
            $this->partitionOversizeChunk(
                $tail,
                $sourceLang,
                $targetLang,
                $configurationIdentity,
                $markers,
                $markerLengths,
                $matchedFingerprints
            )
        );
    }

    /**
     * Build the candidate-length index once for the complete partition. Legacy
     * timestamp-only markers may match any bounded batch length.
     *
     * @param array<string, array{expires_at: int, length: int, action: string}> $markers
     * @return int[] Descending unique candidate lengths.
     */
    private function oversizeMarkerLengths(array $markers): array
    {
        $lengths = [];
        $hasLegacyMarker = false;

        foreach ($markers as $marker) {
            $length = (int) ($marker['length'] ?? 0);
            if ($length > 0 && $length <= self::BATCH_SIZE) {
                $lengths[$length] = true;
            } elseif ($length === 0) {
                $hasLegacyMarker = true;
            }
        }

        if ($hasLegacyMarker) {
            foreach (range(1, self::BATCH_SIZE) as $length) {
                $lengths[$length] = true;
            }
        }

        $indexed = array_keys($lengths);
        rsort($indexed, SORT_NUMERIC);

        return $indexed;
    }

    /**
     * @param string[] $batch
     * @param array<string, array{expires_at: int, length: int, action: string}> $markers
     * @param int[] $markerLengths
     * @return array{fingerprint: string, length: int, action: string}|null
     */
    private function knownOversizePrefix(
        array $batch,
        string $sourceLang,
        string $targetLang,
        string $configurationIdentity,
        array $markers,
        array $markerLengths
    ): ?array {
        foreach ($markerLengths as $length) {
            if ($length > count($batch)) {
                continue;
            }
            $fingerprint = $this->oversizeBatchFingerprint(
                $sourceLang,
                $targetLang,
                array_slice($batch, 0, $length),
                $configurationIdentity
            );
            if (
                isset($markers[$fingerprint])
                && (
                    (int) ($markers[$fingerprint]['length'] ?? 0) === 0
                    || (int) $markers[$fingerprint]['length'] === $length
                )
            ) {
                return [
                    'fingerprint' => $fingerprint,
                    'length' => $length,
                    'action' => $length > 1
                        ? ($markers[$fingerprint]['action'] ?? 'split')
                        : 'block',
                ];
            }
        }

        return null;
    }

    /**
     * @param string[] $batch
     */
    private function oversizeBatchFingerprint(
        string $sourceLang,
        string $targetLang,
        array $batch,
        string $configurationIdentity
    ): string {
        $shape = json_encode(
            [$sourceLang, $targetLang, array_values($batch)],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );

        return hash_hmac(
            'sha256',
            "v1\0" . (is_string($shape) ? $shape : ''),
            $configurationIdentity
        );
    }

    private function schedule(
        bool $force = false,
        int $delaySeconds = 0,
        ?string $identity = null
    ): void
    {
        if (!function_exists('wp_schedule_single_event')) {
            return;
        }

        $delaySeconds = max(0, min(Client::MAX_RATE_LIMIT_BACKOFF, $delaySeconds));
        $eventArgs = [$identity ?? $this->configurationIdentity()];

        if ($force && function_exists('wp_clear_scheduled_hook')) {
            wp_clear_scheduled_hook(self::HOOK, $eventArgs);
        }

        $scheduledAt = wp_next_scheduled(self::HOOK, $eventArgs);
        if ($force || !$scheduledAt) {
            // Persist the queue before creating either an immediately due
            // event or the bounded Retry-After event that replaces it.
            wp_schedule_single_event(time() + $delaySeconds, self::HOOK, $eventArgs);
            $scheduledAt = wp_next_scheduled(self::HOOK, $eventArgs);
        }

        if (
            $identity !== null
            && !$this->identityIsCurrent($identity)
            && $this->configurationIdentity() !== ''
        ) {
            $this->schedule();
            return;
        }

        // A delayed Retry-After event must never be nudged immediately.
        // WP-Cron/system cron will run it only after the bounded delay.
        if ($delaySeconds > 0) {
            return;
        }

        // WordPress otherwise starts cron on a later request, which can leave
        // a low-traffic page untranslated for minutes. Spawn immediately once
        // the queue and an already-due event are durable. In particular, an
        // output-buffer callback can enqueue after WordPress has dispatched
        // `shutdown`, so a callback registered there would never execute in
        // that request. Core's loopback is non-blocking and protected by its
        // own `doing_cron` lock; hosts that run a system cron opted out of it.
        if (!is_numeric($scheduledAt) || (int) $scheduledAt > time()) {
            return;
        }

        if (defined('DISABLE_WP_CRON') && DISABLE_WP_CRON) {
            return;
        }

        if (!function_exists('spawn_cron')) {
            return;
        }

        if ((defined('DOING_CRON') && DOING_CRON) || (function_exists('wp_doing_cron') && wp_doing_cron())) {
            return;
        }

        if ($this->spawnAttempted) {
            return;
        }

        $this->spawnAttempted = true;
        spawn_cron();
    }

    /**
     * @return array<string, string[]>
     */
    private function readQueue(?bool &$valid = null): array
    {
        $raw = get_option(self::QUEUE_OPTION, false);
        $decoded = $this->decodeQueueOption(self::QUEUE_OPTION, $raw, $valid);
        $queue = $this->normalizeQueue($decoded);
        if ($valid) {
            $this->migrateLegacyQueueOption(self::QUEUE_OPTION, $raw, $queue);
        }

        return $queue;
    }

    /**
     * Applies a queue mutation through an optimistic database compare-and-set.
     * This closes the final read/write window in which a page request could
     * otherwise be overwritten by a cron run completing at the same instant.
     *
     * @param callable(array<string, string[]>): array<string, string[]> $mutation
     * @return array<string, string[]>
     */
    private function updateQueue(callable $mutation, ?bool &$applied = null): array
    {
        $applied = false;

        for ($attempt = 0; $attempt < 10; $attempt++) {
            $raw = get_option(self::QUEUE_OPTION, false);
            $valid = false;
            $decoded = $this->decodeQueueOption(self::QUEUE_OPTION, $raw, $valid);
            if (!$valid) {
                return [];
            }
            $current = $this->normalizeQueue($decoded);
            $next = $this->normalizeQueue($mutation($current));

            if (
                ($next === $current && !is_array($raw))
                || $this->compareAndStoreOption(self::QUEUE_OPTION, $raw, $next)
            ) {
                $applied = true;
                return $next;
            }

            $this->clearOptionCache(self::QUEUE_OPTION);
        }

        // Failing closed keeps the unclaimed work queued; a later page visit
        // can safely retry it instead of this run risking a lost enqueue.
        return $this->readQueue();
    }

    /**
     * @param mixed $queue
     * @return array<string, string[]>
     */
    private function normalizeQueue($queue): array
    {

        if (!is_array($queue)) {
            return [];
        }

        $clean = [];

        foreach ($queue as $key => $texts) {
            if (!is_string($key) || !is_array($texts)) {
                continue;
            }

            $texts = array_values(array_filter(
                array_map('strval', $texts),
                static fn(string $text): bool => $text !== ''
            ));

            if (!empty($texts)) {
                $clean[$key] = $texts;
            }
        }

        return $clean;
    }

    /**
     * @param mixed                   $expectedRaw
     * @param array<mixed> $next
     */
    private function compareAndStoreOption(string $option, $expectedRaw, array $next): bool
    {
        global $wpdb;

        $nextRaw = $this->isQueueOption($option)
            ? $this->encodeQueueOption($option, $next)
            : $next;

        if (
            !isset($wpdb)
            || !is_object($wpdb)
            || !isset($wpdb->options)
            || !method_exists($wpdb, 'prepare')
            || !method_exists($wpdb, 'query')
        ) {
            // Isolated tests do not load wpdb. Production WordPress always
            // takes the compare-and-set path above.
            if (get_option($option, false) !== $expectedRaw) {
                return false;
            }

            if (empty($next)) {
                delete_option($option);
            } else {
                update_option($option, $nextRaw, false);
            }

            return true;
        }

        if ($expectedRaw === false) {
            return empty($next)
                || (bool) add_option($option, $nextRaw, '', false);
        }

        $expectedStored = function_exists('maybe_serialize')
            ? maybe_serialize($expectedRaw)
            : (is_array($expectedRaw) || is_object($expectedRaw) ? serialize($expectedRaw) : (string) $expectedRaw);

        if (empty($next)) {
            // LONGTEXT commonly uses a case-insensitive collation. BINARY is
            // required so a case-only concurrent change cannot satisfy CAS.
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- wpdb's options table name is trusted.
            $query = $wpdb->prepare(
                "DELETE FROM {$wpdb->options} WHERE option_name = %s AND BINARY option_value = BINARY %s",
                $option,
                $expectedStored
            );
        } else {
            $nextStored = function_exists('maybe_serialize')
                ? maybe_serialize($nextRaw)
                : (is_array($nextRaw) || is_object($nextRaw) ? serialize($nextRaw) : (string) $nextRaw);

            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- wpdb's options table name is trusted.
            $query = $wpdb->prepare(
                "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND BINARY option_value = BINARY %s",
                $nextStored,
                $option,
                $expectedStored
            );
        }

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.PreparedSQL.NotPrepared -- $query was prepared immediately above.
        $changed = $wpdb->query($query);

        if ((int) $changed !== 1) {
            return false;
        }

        $this->clearOptionCache($option);

        return true;
    }

    private function isQueueOption(string $option): bool
    {
        return $option === self::QUEUE_OPTION || $option === self::URL_QUEUE_OPTION;
    }

    /** @param array<mixed> $value */
    private function encodeQueueOption(string $option, array $value): string
    {
        $serialized = serialize($value);

        return self::QUEUE_ENVELOPE_PREFIX
            . hash('sha256', $option . "\0" . $serialized)
            . ':'
            . base64_encode($serialized);
    }

    /**
     * Legacy queue options are native arrays. New queue strings must match the
     * complete versioned/checksummed envelope and the exact expected shape.
     *
     * @param mixed $raw
     * @return array<mixed>
     */
    private function decodeQueueOption(string $option, $raw, ?bool &$valid = null): array
    {
        $valid = false;
        if ($raw === false) {
            $valid = true;
            return [];
        }
        if (is_array($raw)) {
            $valid = $this->isValidLegacyQueuePayload($option, $raw);
            return $valid ? $raw : [];
        }
        if (!is_string($raw) || !str_starts_with($raw, self::QUEUE_ENVELOPE_PREFIX)) {
            return [];
        }

        $envelope = substr($raw, strlen(self::QUEUE_ENVELOPE_PREFIX));
        if (preg_match('/\A([a-f0-9]{64}):([a-z0-9+\/]+={0,2})\z/iD', $envelope, $matches) !== 1) {
            return [];
        }

        $serialized = base64_decode($matches[2], true);
        if (
            !is_string($serialized)
            || base64_encode($serialized) !== $matches[2]
            || !hash_equals($matches[1], hash('sha256', $option . "\0" . $serialized))
        ) {
            return [];
        }

        // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- malformed persisted data must fail closed without emitting on page requests.
        $decoded = @unserialize($serialized, ['allowed_classes' => false]);
        if (
            !is_array($decoded)
            || serialize($decoded) !== $serialized
            || !$this->isValidQueuePayload($option, $decoded)
        ) {
            return [];
        }

        $valid = true;
        return $decoded;
    }

    /** @param array<mixed> $queue */
    private function isValidLegacyQueuePayload(string $option, array $queue): bool
    {
        if ($option === self::QUEUE_OPTION) {
            return $this->isValidQueuePayload($option, $queue);
        }
        if ($option !== self::URL_QUEUE_OPTION) {
            return false;
        }

        foreach ($queue as $key => $entries) {
            if (!is_string($key) || !is_array($entries) || $entries === []) {
                return false;
            }
            foreach ($entries as $urlOrIndex => $textsOrUrl) {
                if (is_int($urlOrIndex) && is_string($textsOrUrl)) {
                    if (trim($textsOrUrl) === '' || trim($textsOrUrl) !== $textsOrUrl) {
                        return false;
                    }
                    continue;
                }
                if (
                    !is_string($urlOrIndex)
                    || trim($urlOrIndex) === ''
                    || trim($urlOrIndex) !== $urlOrIndex
                    || !$this->isValidStringList($textsOrUrl, true)
                ) {
                    return false;
                }
            }
        }

        return true;
    }

    private function queueOptionIsValid(string $option): bool
    {
        $valid = false;
        $this->decodeQueueOption($option, get_option($option, false), $valid);

        return $valid;
    }

    /** @param array<mixed> $queue */
    private function isValidQueuePayload(string $option, array $queue): bool
    {
        if ($option === self::QUEUE_OPTION) {
            foreach ($queue as $key => $texts) {
                if (!is_string($key) || !$this->isValidStringList($texts, false)) {
                    return false;
                }
            }

            return true;
        }

        if ($option !== self::URL_QUEUE_OPTION) {
            return false;
        }

        foreach ($queue as $key => $entries) {
            if (!is_string($key) || !is_array($entries) || $entries === []) {
                return false;
            }
            foreach ($entries as $url => $texts) {
                if (
                    !is_string($url)
                    || trim($url) === ''
                    || trim($url) !== $url
                    || !$this->isValidStringList($texts, true)
                ) {
                    return false;
                }
            }
        }

        return true;
    }

    /** @param mixed $values */
    private function isValidStringList($values, bool $allowEmpty): bool
    {
        if (!is_array($values) || (!$allowEmpty && $values === [])) {
            return false;
        }

        $expectedIndex = 0;
        foreach ($values as $index => $value) {
            if ($index !== $expectedIndex || !is_string($value) || $value === '') {
                return false;
            }
            $expectedIndex++;
        }

        return true;
    }

    /** @param mixed $raw @param array<mixed> $queue */
    private function migrateLegacyQueueOption(string $option, $raw, array $queue): void
    {
        if (!is_array($raw)) {
            return;
        }

        $this->compareAndStoreOption($option, $raw, $queue);
    }

    private function clearOptionCache(string $option): void
    {
        if (!function_exists('wp_cache_delete')) {
            return;
        }

        wp_cache_delete($option, 'options');
        wp_cache_delete('alloptions', 'options');
    }

    /**
     * @param array<string, string[]> $queue
     */
    private function writeQueue(array $queue): void
    {
        if (empty($queue)) {
            delete_option(self::QUEUE_OPTION);

            return;
        }

        // Never autoloaded: the queue is only read by the cron run and by the
        // enqueue path, so it must not sit in every request's option cache.
        update_option(
            self::QUEUE_OPTION,
            $this->encodeQueueOption(self::QUEUE_OPTION, $this->normalizeQueue($queue)),
            false
        );
    }

    /**
     * Legacy versions stored `language pair => URL[]`. New entries map each
     * URL to exactly the texts on that page so one failed page cannot delay a
     * completed page's purge. An empty text list is the legacy wildcard and
     * remains tied to the whole language-pair queue until it drains.
     *
     * @return array<string, array<string, string[]>>
     */
    private function readUrlQueue(?bool &$valid = null): array
    {
        $raw = get_option(self::URL_QUEUE_OPTION, false);
        $decoded = $this->decodeQueueOption(self::URL_QUEUE_OPTION, $raw, $valid);
        $queue = $this->normalizeUrlQueue($decoded);
        if ($valid) {
            $this->migrateLegacyQueueOption(self::URL_QUEUE_OPTION, $raw, $queue);
        }

        return $queue;
    }

    /**
     * @param callable(array<string, array<string, string[]>>): array<string, array<string, string[]>> $mutation
     * @return array<string, array<string, string[]>>
     */
    private function updateUrlQueue(callable $mutation, ?bool &$applied = null): array
    {
        $applied = false;

        for ($attempt = 0; $attempt < 10; $attempt++) {
            $raw = get_option(self::URL_QUEUE_OPTION, false);
            $valid = false;
            $decoded = $this->decodeQueueOption(self::URL_QUEUE_OPTION, $raw, $valid);
            if (!$valid) {
                return [];
            }
            $current = $this->normalizeUrlQueue($decoded);
            $next = $this->normalizeUrlQueue($mutation($current));

            if (
                ($next === $current && !is_array($raw))
                || $this->compareAndStoreOption(self::URL_QUEUE_OPTION, $raw, $next)
            ) {
                $applied = true;
                return $next;
            }

            $this->clearOptionCache(self::URL_QUEUE_OPTION);
        }

        return $this->readUrlQueue();
    }

    /**
     * @param mixed $queue
     * @return array<string, array<string, string[]>>
     */
    private function normalizeUrlQueue($queue): array
    {

        if (!is_array($queue)) {
            return [];
        }

        $clean = [];

        foreach ($queue as $key => $entries) {
            if (!is_string($key) || !is_array($entries)) {
                continue;
            }

            foreach ($entries as $urlOrIndex => $textsOrUrl) {
                if (is_int($urlOrIndex) && is_string($textsOrUrl)) {
                    $url = trim($textsOrUrl);
                    $texts = [];
                } elseif (is_string($urlOrIndex) && is_array($textsOrUrl)) {
                    $url = trim($urlOrIndex);
                    $texts = array_values(array_filter(
                        array_unique(array_map('strval', $textsOrUrl)),
                        static fn(string $text): bool => $text !== ''
                    ));
                } else {
                    continue;
                }

                if ($url !== '') {
                    $clean[$key][$url] = $texts;
                }
            }
        }

        return $clean;
    }

    /**
     * @param array<string, array<string, string[]>> $queue
     */
    private function writeUrlQueue(array $queue): void
    {
        if (empty($queue)) {
            delete_option(self::URL_QUEUE_OPTION);

            return;
        }

        update_option(
            self::URL_QUEUE_OPTION,
            $this->encodeQueueOption(self::URL_QUEUE_OPTION, $this->normalizeUrlQueue($queue)),
            false
        );
    }

    /**
     * @param string[] $keys
     */
    private function purgeCompletedUrls(array $keys, ?string $mutationLockOwner = null): void
    {
        if (empty($keys)) {
            return;
        }

        $releaseMutationLock = false;
        if ($mutationLockOwner === null) {
            $mutationLockOwner = $this->acquireMutationLock();
            if ($mutationLockOwner === null) {
                return;
            }
            $releaseMutationLock = true;
        } elseif (!$this->mutationLockIsOwnedBy($mutationLockOwner)) {
            return;
        }

        try {
            $this->purgeCompletedUrlsWhileLocked($keys);
        } finally {
            if ($releaseMutationLock) {
                $this->releaseMutationLock($mutationLockOwner);
            }
        }
    }

    /** @param string[] $keys */
    private function purgeCompletedUrlsWhileLocked(array $keys): void
    {
        $urls = [];
        $keyLookup = array_fill_keys($keys, true);

        $applied = false;
        $remainingUrlQueue = $this->updateUrlQueue(function (array $urlQueue) use ($keyLookup, &$urls): array {
            $urls = [];
            $textQueueValid = false;
            $pendingQueue = $this->readQueue($textQueueValid);
            if (!$textQueueValid) {
                return $urlQueue;
            }

            foreach ($urlQueue as $key => $trackedUrls) {
                if (!isset($keyLookup[$key])) {
                    continue;
                }

                $pending = $pendingQueue[$key] ?? [];

                foreach ($trackedUrls as $url => $trackedTexts) {
                    // Empty is the backward-compatible language-pair wildcard
                    // used by queues written before per-URL text tracking.
                    $remaining = empty($trackedTexts)
                        ? $pending
                        : array_values(array_intersect($trackedTexts, $pending));

                    if (!empty($remaining)) {
                        $urlQueue[$key][$url] = $remaining;
                        continue;
                    }

                    $urls[] = $url;
                    unset($urlQueue[$key][$url]);
                }

                if (empty($urlQueue[$key])) {
                    unset($urlQueue[$key]);
                }
            }

            return $urlQueue;
        }, $applied);

        if (!$applied) {
            return;
        }

        $urls = array_values(array_unique(array_filter(array_map('strval', $urls))));

        if (empty($urls)) {
            return;
        }

        if (function_exists('rocket_clean_files')) {
            rocket_clean_files($urls);
        }

        foreach ($urls as $url) {
            if (function_exists('w3tc_flush_url')) {
                w3tc_flush_url($url);
            }

            if (function_exists('do_action')) {
                do_action('litespeed_purge_url', $url);
            }
        }

        // WP Super Cache exposes only a full-cache public purge API. Delay it
        // until every tracked URL has completed so one finished page cannot
        // evict pages whose translations are still pending.
        if (empty($remainingUrlQueue) && function_exists('wp_cache_clear_cache')) {
            wp_cache_clear_cache();
        }
    }

    private function acquireMutationLock(): ?string
    {
        $owner = function_exists('wp_generate_uuid4')
            ? wp_generate_uuid4()
            : uniqid('deepglot-queue-', true);
        $lock = [
            'owner' => $owner,
            'expires' => time() + self::MUTATION_LOCK_TTL,
        ];

        for ($attempt = 0; $attempt < 3; $attempt++) {
            if (add_option(self::MUTATION_LOCK_OPTION, $lock, '', false)) {
                return $owner;
            }

            $current = get_option(self::MUTATION_LOCK_OPTION, false);
            $now = time();
            $expires = is_array($current) ? (int) ($current['expires'] ?? 0) : 0;
            if ($expires > $now && $expires <= $now + self::MUTATION_LOCK_TTL) {
                return null;
            }

            // Replace only the exact expired/malformed value observed. This
            // avoids a delete/add gap and cannot steal a concurrently renewed
            // lock under a case-insensitive wp_options collation.
            if ($this->compareAndStoreOption(self::MUTATION_LOCK_OPTION, $current, $lock)) {
                return $owner;
            }

            $this->clearOptionCache(self::MUTATION_LOCK_OPTION);
        }

        return null;
    }

    private function mutationLockIsOwnedBy(string $owner): bool
    {
        $current = get_option(self::MUTATION_LOCK_OPTION, false);

        return is_array($current)
            && hash_equals((string) ($current['owner'] ?? ''), $owner);
    }

    private function releaseMutationLock(string $owner): void
    {
        $current = get_option(self::MUTATION_LOCK_OPTION, false);
        if (
            !is_array($current)
            || !hash_equals((string) ($current['owner'] ?? ''), $owner)
        ) {
            return;
        }

        $this->compareAndStoreOption(self::MUTATION_LOCK_OPTION, $current, []);
    }

    private function acquireLock(): ?string
    {
        $owner = function_exists('wp_generate_uuid4')
            ? wp_generate_uuid4()
            : uniqid('deepglot-', true);
        $lock = [
            'owner' => $owner,
            'expires' => time() + self::LOCK_TTL,
        ];

        if (add_option(self::LOCK_OPTION, $lock, '', false)) {
            return $owner;
        }

        $current = get_option(self::LOCK_OPTION, false);
        if (
            is_array($current)
            && (int) ($current['expires'] ?? 0) > time()
        ) {
            return null;
        }

        if (!$this->compareAndDeleteLock($current)) {
            return null;
        }

        return add_option(self::LOCK_OPTION, $lock, '', false) ? $owner : null;
    }

    private function releaseLock(string $owner): void
    {
        $current = get_option(self::LOCK_OPTION, false);

        if (!is_array($current) || !hash_equals((string) ($current['owner'] ?? ''), $owner)) {
            return;
        }

        $this->compareAndDeleteLock($current);
    }

    /**
     * Deletes only the exact lock value this runner observed. WordPress always
     * provides `$wpdb`; the option-function fallback exists for isolated tests.
     *
     * @param mixed $expected
     */
    private function compareAndDeleteLock($expected): bool
    {
        global $wpdb;

        if (
            isset($wpdb)
            && is_object($wpdb)
            && isset($wpdb->options)
            && method_exists($wpdb, 'delete')
        ) {
            $stored = function_exists('maybe_serialize')
                ? maybe_serialize($expected)
                : (is_array($expected) || is_object($expected) ? serialize($expected) : (string) $expected);

            // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Conditional deletion preserves lock ownership.
            $deleted = $wpdb->delete(
                $wpdb->options,
                [
                    'option_name' => self::LOCK_OPTION,
                    'option_value' => $stored,
                ],
                ['%s', '%s']
            );

            if ((int) $deleted !== 1) {
                return false;
            }

            if (function_exists('wp_cache_delete')) {
                wp_cache_delete(self::LOCK_OPTION, 'options');
                wp_cache_delete('alloptions', 'options');
            }

            return true;
        }

        if (get_option(self::LOCK_OPTION, false) !== $expected) {
            return false;
        }

        return (bool) delete_option(self::LOCK_OPTION);
    }

    private function queueKey(string $sourceLang, string $targetLang): string
    {
        return strtolower($sourceLang) . '|' . strtolower($targetLang);
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function parseQueueKey(string $key): array
    {
        $parts = explode('|', $key);

        return [$parts[0] ?? '', $parts[1] ?? ''];
    }
}
