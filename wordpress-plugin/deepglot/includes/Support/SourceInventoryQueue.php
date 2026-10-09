<?php

namespace Deepglot\Support;

use Deepglot\Api\Client;
use Deepglot\Config\Options;

/** Digest-only, bounded WP-Cron handoff; the page render never waits for SaaS. */
class SourceInventoryQueue
{
    public const HOOK = 'deepglot_report_source_inventory';
    public const QUEUE_OPTION = 'deepglot_source_inventory_queue';
    private const LOCK_OPTION = 'deepglot_source_inventory_mutating';
    private const MAX_PENDING = 64;
    private const MAX_PER_RUN = 8;
    private const MAX_CAPTURE_AGE_SECONDS = 300;
    private const RETRY_SECONDS = 60;

    public function __construct(private Client $client, private Options $options) {}

    public function register(): void
    {
        add_action(self::HOOK, [$this, 'run']);
    }

    /** @param string[] $texts */
    public function recordSourceInventory(
        array $texts,
        string $langFrom,
        string $langTo,
        string $requestUrl,
        bool $complete,
        bool $dynamicPossible,
        string $capturedMicros
    ): void {
        if (!$this->options->isEnabled() || !$this->options->isConfigured() || $requestUrl === '') return;
        // Query-bearing renders are already incomplete. Do not queue tokenized
        // query parameters or fragments as page identity.
        $requestUrl = preg_replace('/[?#].*$/', '', $requestUrl);
        $path = wp_parse_url($requestUrl, PHP_URL_PATH);
        if (!is_string($path) || $path === '') return;
        $complete = $complete && !$dynamicPossible && count($texts) <= 2000;
        $hashes = [];
        if ($complete) {
            foreach (array_unique($texts) as $text)
                $hashes[] = md5($text . '|' . $langFrom . '|' . $langTo);
            sort($hashes, SORT_STRING);
        }
        $payload = [
            'requestUrl' => $requestUrl,
            'langFrom' => $langFrom,
            'langTo' => $langTo,
            'originalHashes' => $hashes,
            'complete' => $complete,
            'dynamicPossible' => $dynamicPossible,
            'capturedMicros' => $capturedMicros,
        ];
        $identity = hash('sha256', $requestUrl . '|' . $langFrom . '|' . $langTo
            . '|' . trim($this->options->getApiKey()));
        $digest = hash('sha256', wp_json_encode([$hashes, $complete, $dynamicPossible]));
        $successKey = 'deepglot_source_inventory_' . substr($identity, 0, 32);
        $success = get_transient($successKey);
        $alreadyReported = is_array($success) && ($success['digest'] ?? '') === $digest
            && time() - (int) ($success['sent_at'] ?? 0) < 300;

        $queue = $this->mutateQueue(function (array &$queue) use (
            $identity, $capturedMicros, $payload, $digest, $successKey, $alreadyReported
        ): void {
            $previous = $queue[$identity] ?? null;
            // A newer queued change must be superseded even if this digest
            // matches an earlier successful observation in the debounce window.
            if ($alreadyReported && (!is_array($previous) || ($previous['digest'] ?? '') === $digest))
                return;
            if (is_array($previous) && strcmp((string) ($previous['payload']['capturedMicros'] ?? ''), $capturedMicros) >= 0)
                return;
            if (!isset($queue[$identity]) && count($queue) >= self::MAX_PENDING) return;
            $queue[$identity] = [
                'payload' => $payload, 'digest' => $digest, 'successKey' => $successKey,
                'apiIdentity' => hash('sha256', trim($this->options->getApiKey()) . '|'
                    . $this->options->getApiBaseUrl()),
                'nextAttempt' => is_array($previous) ? max(time(), (int) ($previous['nextAttempt'] ?? 0)) : time(),
            ];
        });
        if ($queue !== null) $this->schedule($queue);
    }

    public function run(): void
    {
        $queue = get_option(self::QUEUE_OPTION, []);
        if (!is_array($queue) || !$queue) return;
        $processed = 0;
        foreach ($queue as $identity => $item) {
            if ($processed >= self::MAX_PER_RUN) break;
            if (!is_array($item) || !is_array($item['payload'] ?? null)) {
                $this->removeIfCurrent($identity, (array) $item);
                continue;
            }
            $payload = $item['payload'];
            $captured = (int) ($payload['capturedMicros'] ?? 0);
            if ($captured <= 0 || time() - (int) floor($captured / 1000000) > self::MAX_CAPTURE_AGE_SECONDS
                || ($item['apiIdentity'] ?? '') !== hash('sha256', trim($this->options->getApiKey()) . '|'
                    . $this->options->getApiBaseUrl())) {
                $this->removeIfCurrent($identity, $item);
                continue;
            }
            if ((int) ($item['nextAttempt'] ?? 0) > time()) continue;
            $processed++;
            try {
                $accepted = $this->client->sendSourceInventory($payload);
            } catch (\Throwable $ignored) {
                $accepted = false;
            }
            if ($accepted) {
                if ($this->removeIfCurrent($identity, $item))
                    set_transient($item['successKey'], ['digest' => $item['digest'], 'sent_at' => time()], 300);
            } else {
                $this->mutateQueue(static function (array &$current) use ($identity, $item): void {
                    if (($current[$identity]['payload']['capturedMicros'] ?? null) === ($item['payload']['capturedMicros'] ?? null)
                        && ($current[$identity]['digest'] ?? null) === ($item['digest'] ?? null))
                        $current[$identity]['nextAttempt'] = time() + self::RETRY_SECONDS;
                });
            }
        }
        $latest = get_option(self::QUEUE_OPTION, []);
        if (is_array($latest)) $this->schedule($latest);
    }

    private function removeIfCurrent(string $identity, array $item): bool
    {
        $removed = false;
        $this->mutateQueue(static function (array &$queue) use ($identity, $item, &$removed): void {
            if (($queue[$identity]['payload']['capturedMicros'] ?? null) !== ($item['payload']['capturedMicros'] ?? null)
                || ($queue[$identity]['digest'] ?? null) !== ($item['digest'] ?? null)) return;
            unset($queue[$identity]);
            $removed = true;
        });
        return $removed;
    }

    /** Short atomic option lock; HTTP dispatch is always outside this window. */
    private function mutateQueue(callable $mutation): ?array
    {
        if (!function_exists('add_option') || !function_exists('delete_option')) return null;
        $owner = bin2hex(random_bytes(8));
        $lock = ['owner' => $owner, 'until' => time() + 10];
        if (!add_option(self::LOCK_OPTION, $lock, '', false)) {
            $old = get_option(self::LOCK_OPTION, false);
            if (!is_array($old) || (int) ($old['until'] ?? 0) >= time()) return null;
            global $wpdb;
            if (!isset($wpdb) || !function_exists('maybe_serialize')) return null;
            $wpdb->query($wpdb->prepare(
                "DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s",
                self::LOCK_OPTION, maybe_serialize($old)
            ));
            if (function_exists('wp_cache_delete')) wp_cache_delete(self::LOCK_OPTION, 'options');
            if (!add_option(self::LOCK_OPTION, $lock, '', false)) return null;
        }
        try {
            $queue = get_option(self::QUEUE_OPTION, []);
            if (!is_array($queue)) $queue = [];
            $mutation($queue);
            update_option(self::QUEUE_OPTION, $queue, false);
            return $queue;
        } finally {
            $current = get_option(self::LOCK_OPTION, false);
            if (is_array($current) && ($current['owner'] ?? null) === $owner)
                delete_option(self::LOCK_OPTION);
        }
    }

    private function schedule(array $queue): void
    {
        if (!$queue || !function_exists('wp_schedule_single_event') || !function_exists('wp_next_scheduled')) return;
        if (wp_next_scheduled(self::HOOK)) return;
        $next = min(array_map(static fn($item) => max(time() + 1, (int) ($item['nextAttempt'] ?? time())), $queue));
        wp_schedule_single_event($next, self::HOOK);
    }
}
