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

    /** Guards against two cron spawns draining the queue at the same time. */
    public const LOCK_TRANSIENT = 'deepglot_warm_running';

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
    public function enqueue(array $texts, string $sourceLang, string $targetLang): void
    {
        $texts = array_values(array_filter(
            array_unique(array_map('strval', $texts)),
            static fn(string $text): bool => $text !== ''
        ));

        if (empty($texts) || $sourceLang === '' || $targetLang === '') {
            return;
        }

        $queue = $this->readQueue();
        $key   = $this->queueKey($sourceLang, $targetLang);
        $merged = array_values(array_unique(array_merge($queue[$key] ?? [], $texts)));

        if (count($merged) > self::MAX_QUEUE) {
            $merged = array_slice($merged, 0, self::MAX_QUEUE);
        }

        if ($merged === ($queue[$key] ?? null)) {
            // Nothing new — the event scheduled by the first visitor still covers it.
            $this->schedule();

            return;
        }

        $queue[$key] = $merged;
        $this->writeQueue($queue);
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

            return;
        }

        $queue = $this->readQueue();

        if (empty($queue)) {
            return;
        }

        // WP-Cron can spawn the same event twice (a loopback racing a system
        // cron). Without a lock both runs would translate the same texts and
        // pay for them twice.
        if (get_transient(self::LOCK_TRANSIENT)) {
            return;
        }

        set_transient(self::LOCK_TRANSIENT, time(), self::LOCK_TTL);

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
            delete_transient(self::LOCK_TRANSIENT);
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

        foreach ($queue as $key => $texts) {
            if ($budget <= 0) {
                $untouched = true;
                break;
            }

            [$sourceLang, $targetLang] = $this->parseQueueKey($key);

            if ($sourceLang === '' || $targetLang === '') {
                unset($queue[$key]);
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
                unset($queue[$key]);
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

                $translations += $this->pairResult($result);
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

            if (empty($remaining)) {
                unset($queue[$key]);
                continue;
            }

            $queue[$key] = $remaining;
        }

        $this->writeQueue($queue);

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

        wp_schedule_single_event(time() + 1, self::HOOK);

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
        $queue = get_option(self::QUEUE_OPTION, []);

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
