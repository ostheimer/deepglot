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

    /** Atomic owner/expiry lock guarding against concurrent cron drains. */
    public const LOCK_OPTION = 'deepglot_warm_running';

    /** Long enough to cover MAX_BATCHES_PER_RUN slow requests. */
    public const LOCK_TTL = 300;

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

    /** One loopback nudge per request, no matter how often we enqueue. */
    private bool $spawnRegistered = false;

    public function __construct(Client $client, Options $options, TranslationCache $cache)
    {
        $this->client  = $client;
        $this->options = $options;
        $this->cache   = $cache;
    }

    public function register(): void
    {
        add_action(self::HOOK, [$this, 'run']);
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

        $key   = $this->queueKey($sourceLang, $targetLang);
        $queued = $this->updateQueue(static function (array $queue) use ($key, $texts): array {
            $merged = array_values(array_unique(array_merge($queue[$key] ?? [], $texts)));

            if (count($merged) > self::MAX_QUEUE) {
                $merged = array_slice($merged, 0, self::MAX_QUEUE);
            }

            $queue[$key] = $merged;

            return $queue;
        });

        // Different pages often contain the same text. Record every affected
        // URL even when this enqueue did not add a new segment, otherwise only
        // the first page would be purged after the shared cache is warmed.
        $requestUrl = trim($requestUrl);
        if ($requestUrl !== '') {
            $this->updateUrlQueue(static function (array $queue) use (
                $key,
                $requestUrl,
                $texts,
                $queued
            ): array {
                $hasLegacyWildcard = array_key_exists($requestUrl, $queue[$key] ?? [])
                    && empty($queue[$key][$requestUrl]);
                $tracked = $hasLegacyWildcard
                    ? ($queued[$key] ?? $texts)
                    : ($queue[$key][$requestUrl] ?? []);
                $queue[$key][$requestUrl] = array_values(array_unique(array_merge($tracked, $texts)));

                return $queue;
            });
        }

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
        if (!$this->options->isEnabled() || !$this->options->isConfigured()) {
            $this->writeQueue([]);
            $this->writeUrlQueue([]);

            return;
        }

        $queue = $this->readQueue();

        if (empty($queue)) {
            return;
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
            $this->drain($queue);
        } finally {
            $this->releaseLock($lockOwner);
        }
    }

    // -------------------------------------------------------------------------

    /**
     * @param array<string, string[]> $queue
     */
    private function drain(array $queue): void
    {
        $budget = self::MAX_BATCHES_PER_RUN;
        $untouched = false;
        $completedByKey = [];
        $remainingByKey = [];

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

            $batches   = array_chunk($missing, self::BATCH_SIZE);
            $processed = array_slice($batches, 0, $budget);
            $budget   -= count($processed);

            $results = $this->client->translateBatches(
                $processed,
                $sourceLang,
                $targetLang,
                '',
                0,
                self::TIMEOUT
            );

            $translations = [];
            $failed = [];

            foreach ($processed as $index => $batch) {
                $result = $results[$index] ?? null;

                if ($result === null || is_wp_error($result) || !is_array($result)) {
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

            if (!empty($translations)) {
                $this->cache->setMany($translations, $sourceLang, $targetLang);
            }

            $deferredBatches = array_slice($batches, count($processed));
            $untouched = $untouched || !empty($deferredBatches);

            $remaining = array_values(array_unique(array_merge(
                $failed,
                array_merge([], ...$deferredBatches)
            )));

            $remainingByKey[$key] = $remaining;
            $completedByKey[$key] = array_values(array_diff($texts, $remaining));
        }

        // Re-read after the provider calls: a frontend request may have
        // enqueued more work while this run was in flight. Reconcile only the
        // texts this snapshot completed and preserve everything added later.
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
        });
        $this->purgeCompletedUrls(array_keys($completedByKey));

        // Only chase work this run never attempted. Rescheduling because a
        // batch *failed* would spin: a persistent error (exhausted quota, SaaS
        // outage) would re-fire the event forever. Failed texts stay queued and
        // are retried the next time a visitor enqueues something — which is
        // exactly when translating them is worth attempting again.
        if ($untouched) {
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

    private function schedule(bool $force = false): void
    {
        if (!function_exists('wp_schedule_single_event')) {
            return;
        }

        if (!$force && wp_next_scheduled(self::HOOK)) {
            return;
        }

        // The shutdown callback below invokes spawn_cron() immediately. The
        // event must already be due at that moment or the loopback is wasted.
        wp_schedule_single_event(time(), self::HOOK);

        // WordPress only spawns cron on a later request, which on a low-traffic
        // page can be minutes away. Nudge it from this request's shutdown so
        // the page converges within seconds; the loopback core performs is
        // non-blocking and rate-limited by its own `doing_cron` lock. Sites
        // that run a real system cron opted out of loopbacks — respect that.
        if (defined('DISABLE_WP_CRON') && DISABLE_WP_CRON) {
            return;
        }

        if (!function_exists('add_action') || !function_exists('spawn_cron')) {
            return;
        }

        if ((defined('DOING_CRON') && DOING_CRON) || (function_exists('wp_doing_cron') && wp_doing_cron())) {
            return;
        }

        if ($this->spawnRegistered) {
            return;
        }

        $this->spawnRegistered = true;
        add_action('shutdown', static function (): void {
            spawn_cron();
        });
    }

    /**
     * @return array<string, string[]>
     */
    private function readQueue(): array
    {
        return $this->normalizeQueue(get_option(self::QUEUE_OPTION, []));
    }

    /**
     * Applies a queue mutation through an optimistic database compare-and-set.
     * This closes the final read/write window in which a page request could
     * otherwise be overwritten by a cron run completing at the same instant.
     *
     * @param callable(array<string, string[]>): array<string, string[]> $mutation
     * @return array<string, string[]>
     */
    private function updateQueue(callable $mutation): array
    {
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $raw = get_option(self::QUEUE_OPTION, false);
            $current = $this->normalizeQueue($raw);
            $next = $this->normalizeQueue($mutation($current));

            if ($next === $current || $this->compareAndStoreOption(self::QUEUE_OPTION, $raw, $next)) {
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

        if (
            !isset($wpdb)
            || !is_object($wpdb)
            || !isset($wpdb->options)
            || !method_exists($wpdb, 'update')
            || !method_exists($wpdb, 'delete')
        ) {
            // Isolated tests do not load wpdb. Production WordPress always
            // takes the compare-and-set path above.
            if (get_option($option, false) !== $expectedRaw) {
                return false;
            }

            if (empty($next)) {
                delete_option($option);
            } else {
                update_option($option, $next, false);
            }

            return true;
        }

        if ($expectedRaw === false) {
            return empty($next)
                || (bool) add_option($option, $next, '', false);
        }

        $expectedStored = function_exists('maybe_serialize')
            ? maybe_serialize($expectedRaw)
            : (is_array($expectedRaw) || is_object($expectedRaw) ? serialize($expectedRaw) : (string) $expectedRaw);

        if (empty($next)) {
            // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Conditional deletion prevents lost concurrent enqueues.
            $changed = $wpdb->delete(
                $wpdb->options,
                [
                    'option_name' => $option,
                    'option_value' => $expectedStored,
                ],
                ['%s', '%s']
            );
        } else {
            $nextStored = function_exists('maybe_serialize')
                ? maybe_serialize($next)
                : serialize($next);

            // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Conditional update prevents lost concurrent enqueues.
            $changed = $wpdb->update(
                $wpdb->options,
                ['option_value' => $nextStored],
                [
                    'option_name' => $option,
                    'option_value' => $expectedStored,
                ],
                ['%s'],
                ['%s', '%s']
            );
        }

        if ((int) $changed !== 1) {
            return false;
        }

        $this->clearOptionCache($option);

        return true;
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
        update_option(self::QUEUE_OPTION, $queue, false);
    }

    /**
     * Legacy versions stored `language pair => URL[]`. New entries map each
     * URL to exactly the texts on that page so one failed page cannot delay a
     * completed page's purge. An empty text list is the legacy wildcard and
     * remains tied to the whole language-pair queue until it drains.
     *
     * @return array<string, array<string, string[]>>
     */
    private function readUrlQueue(): array
    {
        return $this->normalizeUrlQueue(get_option(self::URL_QUEUE_OPTION, []));
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
            $current = $this->normalizeUrlQueue($raw);
            $next = $this->normalizeUrlQueue($mutation($current));

            if ($next === $current || $this->compareAndStoreOption(self::URL_QUEUE_OPTION, $raw, $next)) {
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

        update_option(self::URL_QUEUE_OPTION, $queue, false);
    }

    /**
     * @param string[] $keys
     */
    private function purgeCompletedUrls(array $keys): void
    {
        if (empty($keys)) {
            return;
        }

        $urls = [];
        $keyLookup = array_fill_keys($keys, true);

        $applied = false;
        $this->updateUrlQueue(function (array $urlQueue) use ($keyLookup, &$urls): array {
            $urls = [];
            $pendingQueue = $this->readQueue();

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

        // WP Super Cache exposes only a full-cache public purge API.
        if (function_exists('wp_cache_clear_cache')) {
            wp_cache_clear_cache();
        }
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
