<?php

namespace Deepglot\Sync;

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Support\TranslationWarmer;
use Deepglot\Support\TranslationCache;

class SettingsSync
{
    private const RUNTIME_REFRESH_LOCK_OPTION = 'deepglot_runtime_refresh_lock';
    private const RUNTIME_REFRESH_BACKOFF_TRANSIENT = 'deepglot_runtime_refresh_backoff';
    private const RUNTIME_REFRESH_LOCK_TTL = 60;
    private const RUNTIME_REFRESH_FAILURE_BACKOFF = 60;
    private const CACHE_INVALIDATION_CURSOR_OPTION = 'deepglot_url_cache_invalidation_cursor';
    private const MAX_CACHE_INVALIDATION_PAGES = 24;

    /** In-process fallback for isolated callers without WordPress option storage. */
    private static ?string $runtimeRefreshProcessLock = null;

    private Options $options;
    private Client $client;
    private ?TranslationWarmer $warmer;

    public function __construct(
        Options $options,
        Client $client,
        ?TranslationWarmer $warmer = null
    )
    {
        $this->options = $options;
        $this->client = $client;
        $this->warmer = $warmer;
    }

    public function register(): void
    {
        add_action('update_option_' . Options::OPTION_KEY, [$this, 'handleOptionUpdate'], 10, 2);
    }

    public function handleOptionUpdate($oldValue, $newValue): void
    {
        if (!empty($GLOBALS['deepglot_applying_runtime_config'])) {
            return;
        }

        if (!is_array($newValue)) {
            return;
        }

        if ($this->runtimeSourceChanged($oldValue, $newValue)) {
            $previousMedia = get_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, []);
            $this->options->clearUrlSlugMappings();
            $this->options->clearMediaReplacements();
            if ($previousMedia !== get_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, [])) {
                $this->purgeMediaPageCaches();
            }
            // A new key or backend invalidates the cached 401 verdict. Without
            // this reset a corrected key would only take effect once the
            // circuit breaker's TTL expired (#245).
            delete_transient(Client::INVALID_API_KEY_TRANSIENT);
            $this->schedulePendingWarmQueueForIdentityChange($oldValue, $newValue);
        }

        $result = $this->sync($newValue);

        if (is_wp_error($result)) {
            // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- Operational sync failures must reach the site error log without exposing credentials.
            error_log('[Deepglot] Settings sync failed: ' . $result->get_error_message());
        }
    }

    private function schedulePendingWarmQueueForIdentityChange($oldValue, array $newValue): void
    {
        if (
            !is_array($oldValue)
            || empty($newValue['enabled'])
            || trim((string) ($newValue['api_key'] ?? '')) === ''
            || trim((string) ($newValue['api_base_url'] ?? '')) === ''
            || empty($newValue['target_languages'])
            || !function_exists('wp_next_scheduled')
            || !function_exists('wp_schedule_single_event')
        ) {
            return;
        }

        $oldIdentity = Client::configurationIdentityFor(
            (string) ($oldValue['api_key'] ?? ''),
            (string) ($oldValue['api_base_url'] ?? '')
        );
        $newIdentity = Client::configurationIdentityFor(
            (string) ($newValue['api_key'] ?? ''),
            (string) ($newValue['api_base_url'] ?? '')
        );
        if (
            $oldIdentity === ''
            || $newIdentity === ''
            || hash_equals($oldIdentity, $newIdentity)
            || empty(get_option(TranslationWarmer::QUEUE_OPTION, []))
        ) {
            return;
        }

        $eventArgs = [$newIdentity];
        if (!wp_next_scheduled(TranslationWarmer::HOOK, $eventArgs)) {
            wp_schedule_single_event(time(), TranslationWarmer::HOOK, $eventArgs);
        }
    }

    public function sync(?array $settings = null, ?string $apiKeyOverride = null, ?string $baseUrlOverride = null)
    {
        $normalized = $settings !== null
            ? $this->options->sanitize($settings)
            : $this->options->all();

        if (empty($normalized['api_key']) && $apiKeyOverride === null) {
            return new \WP_Error('deepglot_sync_missing_key', __('No API key is configured for synchronization.', 'deepglot'));
        }

        if (empty($normalized['target_languages']) && !$this->options->hasRuntimeIdentity()) {
            return new \WP_Error('deepglot_sync_missing_languages', __('No target languages are configured for synchronization.', 'deepglot'));
        }

        $requestApiKey = $apiKeyOverride !== null
            ? trim($apiKeyOverride)
            : trim((string) ($normalized['api_key'] ?? ''));
        $requestBaseUrl = $baseUrlOverride !== null
            ? untrailingslashit($baseUrlOverride)
            : untrailingslashit((string) ($normalized['api_base_url'] ?? $this->options->getApiBaseUrl()));
        $usesStoredCredentials = $apiKeyOverride === null && $baseUrlOverride === null;

        if (empty($normalized['target_languages'])) {
            // The SaaS owns target activation. Its runtime readback can recover
            // a paused-all site; the settings-report endpoint requires targets.
            return $this->refreshRuntimeConfig($apiKeyOverride, $baseUrlOverride, true);
        }

        $settingsResult = $this->client->syncSettings($normalized, $apiKeyOverride, $baseUrlOverride);

        if (is_wp_error($settingsResult)) {
            $this->maybeFlagInvalidStoredCredentials(
                $settingsResult,
                $usesStoredCredentials,
                $requestApiKey,
                $requestBaseUrl
            );
            return $settingsResult;
        }

        if ($usesStoredCredentials) {
            // A successful settings-sync proves that the stored credentials
            // are accepted. Clear their stale 401 immediately; a subsequent
            // runtime-config 401 below will arm the marker again.
            $this->client->clearInvalidApiKeyForConfiguration(
                $requestApiKey,
                $requestBaseUrl
            );
        }

        $runtimeResult = $this->refreshRuntimeConfig($apiKeyOverride, $baseUrlOverride, true);

        if (is_wp_error($runtimeResult)) {
            $this->maybeFlagInvalidStoredCredentials(
                $runtimeResult,
                $usesStoredCredentials,
                $requestApiKey,
                $requestBaseUrl
            );
        }

        return is_wp_error($runtimeResult) ? $runtimeResult : $settingsResult;
    }

    public function maybeRefreshRuntimeConfig(): void
    {
        if (
            !$this->options->shouldRefreshRuntimeConfig()
            || get_transient(self::RUNTIME_REFRESH_BACKOFF_TRANSIENT) !== false
        ) {
            return;
        }

        $lockToken = $this->createRuntimeRefreshLockToken();
        if (!$this->acquireRuntimeRefreshLock($lockToken)) {
            return;
        }

        try {
            // Another request may have completed a refresh or established a
            // failure backoff while this request was waiting for the lock.
            if (
                !$this->options->shouldRefreshRuntimeConfig()
                || get_transient(self::RUNTIME_REFRESH_BACKOFF_TRANSIENT) !== false
            ) {
                return;
            }

            $result = $this->refreshRuntimeConfigWhileLocked();

            if (is_wp_error($result)) {
                set_transient(
                    self::RUNTIME_REFRESH_BACKOFF_TRANSIENT,
                    time(),
                    self::RUNTIME_REFRESH_FAILURE_BACKOFF
                );
                // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- Operational refresh failures must reach the site error log without exposing credentials.
                error_log('[Deepglot] Runtime config sync failed: ' . $result->get_error_message());
            }
        } finally {
            $this->releaseRuntimeRefreshLock($lockToken);
        }
    }

    public function refreshRuntimeConfig(?string $apiKeyOverride = null, ?string $baseUrlOverride = null, bool $force = false)
    {
        if (!$force && !$this->options->shouldRefreshRuntimeConfig()) {
            return ['ok' => true, 'skipped' => true];
        }

        $lockToken = $this->createRuntimeRefreshLockToken();
        if (!$this->acquireRuntimeRefreshLock($lockToken)) {
            return ['ok' => true, 'skipped' => true];
        }

        try {
            // A non-forced caller can lose the initial freshness race before
            // acquiring the shared lock. Recheck while owning it so a refresh
            // completed by the preceding owner is not immediately repeated.
            if (!$force && !$this->options->shouldRefreshRuntimeConfig()) {
                return ['ok' => true, 'skipped' => true];
            }

            return $this->refreshRuntimeConfigWhileLocked($apiKeyOverride, $baseUrlOverride);
        } finally {
            $this->releaseRuntimeRefreshLock($lockToken);
        }
    }

    /**
     * Fetch and apply one runtime snapshot while the caller owns the shared
     * refresh lock. Keeping acquisition outside this method lets scheduled and
     * forced refreshes share the lock without recursively acquiring it.
     */
    private function refreshRuntimeConfigWhileLocked(?string $apiKeyOverride = null, ?string $baseUrlOverride = null)
    {
        // Capture key and base URL the fetch will use (the Client falls back
        // to the currently cached option) so applyRuntimeConfig can discard
        // the payload if the stored configuration changed in the meantime —
        // or if this fetch probed a candidate backend that was never saved
        // (test-connection overrides).
        $fetchKey = $apiKeyOverride !== null
            ? trim($apiKeyOverride)
            : trim($this->options->getApiKey());
        $fetchBaseUrl = $baseUrlOverride !== null
            ? untrailingslashit((string) $baseUrlOverride)
            : untrailingslashit($this->options->getApiBaseUrl());

        $identity = Client::configurationIdentityFor($fetchKey, $fetchBaseUrl);
        $cursorRecord = get_option(self::CACHE_INVALIDATION_CURSOR_OPTION, []);
        $cacheAfter = is_array($cursorRecord)
            && ($cursorRecord['identity'] ?? '') === $identity
            && preg_match('/^\d{1,20}$/D', (string) ($cursorRecord['cursor'] ?? '')) === 1
                ? (string) $cursorRecord['cursor'] : '0';
        $runtimeConfig = $this->client->fetchRuntimeConfig($apiKeyOverride, $baseUrlOverride);

        if (is_wp_error($runtimeConfig)) {
            return $runtimeConfig;
        }

        $previousSourceLanguage = $this->warmer !== null
            ? $this->options->getSourceLanguage()
            : null;
        $previousTargetLanguages = $this->warmer !== null
            ? $this->options->getTargetLanguages()
            : [];
        $previousSettings = get_option(Options::OPTION_KEY, []);
        $previousSettings = is_array($previousSettings) ? $previousSettings : [];
        $previousMedia = get_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, []);
        $applied = $this->options->applyRuntimeConfig($runtimeConfig, $fetchKey, $fetchBaseUrl);

        if ($applied) {
            $currentSettings = get_option(Options::OPTION_KEY, []);
            $currentSettings = is_array($currentSettings) ? $currentSettings : [];
            $removedTargets = array_diff(
                (array) ($previousSettings['target_languages'] ?? []),
                (array) ($currentSettings['target_languages'] ?? [])
            );
            $previousGenerations = (array) ($previousSettings['target_language_generations'] ?? []);
            $currentGenerations = (array) ($currentSettings['target_language_generations'] ?? []);
            $changedGenerations = [];
            foreach ((array) ($currentSettings['target_languages'] ?? []) as $target) {
                if (isset($currentGenerations[$target]) && ($previousGenerations[$target] ?? null) !== $currentGenerations[$target]) {
                    $changedGenerations[] = $target;
                }
            }
            $invalidatedTargets = array_unique(array_merge($removedTargets, $changedGenerations));
            if ($invalidatedTargets !== []) {
                $epochs = get_option('deepglot_language_cache_epochs', []);
                $epochs = is_array($epochs) ? $epochs : [];
                foreach ($invalidatedTargets as $removedTarget) {
                    $epochs[$removedTarget] = max(0, (int) ($epochs[$removedTarget] ?? 0)) + 1;
                }
                update_option('deepglot_language_cache_epochs', $epochs, false);
            }
            foreach (['source_language', 'target_languages', 'visible_target_languages', 'automatic_target_languages', 'target_language_generations', 'automatic_translation'] as $runtimeKey) {
                if (($previousSettings[$runtimeKey] ?? null) !== ($currentSettings[$runtimeKey] ?? null)) {
                    $this->purgeMediaPageCaches();
                    break;
                }
            }
        }

        if ($previousMedia !== get_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, [])) {
            $this->purgeMediaPageCaches();
        }

        if ($applied) {
            $this->drainCacheInvalidations($runtimeConfig, $identity, $cacheAfter, $apiKeyOverride, $baseUrlOverride);
            delete_transient(self::RUNTIME_REFRESH_BACKOFF_TRANSIENT);

            if ($this->warmer !== null) {
                $currentSourceLanguage = $this->options->getSourceLanguage();
                $currentTargetLanguages = $this->options->getTargetLanguages();
                if (
                    $previousSourceLanguage !== $currentSourceLanguage
                    || array_diff($previousTargetLanguages, $currentTargetLanguages) !== []
                    || array_diff($currentTargetLanguages, $previousTargetLanguages) !== []
                    || $invalidatedTargets !== []
                ) {
                    $this->warmer->reconcileLanguageConfiguration(
                        $currentSourceLanguage,
                        $currentTargetLanguages,
                        $invalidatedTargets
                    );
                }
            }
        }

        return $runtimeConfig;
    }

    /** Drain the bounded SaaS feed under the existing refresh lock, including a 5,000-row import. */
    private function drainCacheInvalidations(
        array $runtimeConfig,
        string $identity,
        string $cursor,
        ?string $apiKeyOverride,
        ?string $baseUrlOverride
    ): void {
        for ($page = 0; $page < self::MAX_CACHE_INVALIDATION_PAGES; $page++) {
            if (!$this->applyCacheInvalidations($runtimeConfig, $identity, $cursor)) return;
            $batch = $runtimeConfig['cacheInvalidations'] ?? null;
            if (!is_array($batch) || empty($batch['hasMore'])) return;
            $record = get_option(self::CACHE_INVALIDATION_CURSOR_OPTION, []);
            if (!is_array($record) || ($record['identity'] ?? '') !== $identity) return;
            $nextCursor = (string) ($record['cursor'] ?? '');
            if (preg_match('/^\d{1,20}$/D', $nextCursor) !== 1 || (int) $nextCursor <= (int) $cursor) return;
            $cursor = $nextCursor;
            if ($apiKeyOverride === null && $baseUrlOverride === null &&
                Client::configurationIdentityFor($this->options->getApiKey(), $this->options->getApiBaseUrl()) !== $identity) {
                return;
            }
            $next = $this->client->fetchRuntimeConfig($apiKeyOverride, $baseUrlOverride);
            if (is_wp_error($next) || !is_array($next)) return;
            $runtimeConfig = $next;
        }
    }

    /** Apply only explicit digest events after the matching runtime snapshot was accepted. */
    private function applyCacheInvalidations(array $runtimeConfig, string $identity, string $cursor): bool
    {
        $batch = $runtimeConfig['cacheInvalidations'] ?? null;
        if (!is_array($batch) || !is_array($batch['entries'] ?? null) || count($batch['entries']) > 250) {
            return false;
        }
        $cache = new TranslationCache();
        foreach ($batch['entries'] as $entry) {
            if (!is_array($entry)) return false;
            $id = (string) ($entry['id'] ?? '');
            $digest = (string) ($entry['cacheKey'] ?? '');
            if (preg_match('/^\d{1,20}$/D', $id) !== 1 || preg_match('/^[a-f0-9]{40}$/D', $digest) !== 1 || (int) $id <= (int) $cursor) {
                return false;
            }
            if (!$cache->deleteByDigest($digest)) return false;
            $cursor = $id;
            update_option(self::CACHE_INVALIDATION_CURSOR_OPTION, ['identity' => $identity, 'cursor' => $cursor], false);
        }
        return true;
    }

    /** A mapping may occur on any page, so known full-page caches need a site-wide purge. */
    private function purgeMediaPageCaches(): void
    {
        if (function_exists('rocket_clean_domain')) {
            rocket_clean_domain();
        }
        if (function_exists('w3tc_flush_all')) {
            w3tc_flush_all();
        }
        if (function_exists('do_action')) {
            do_action('litespeed_purge_all');
        }
        if (function_exists('wp_cache_clear_cache')) {
            wp_cache_clear_cache();
        }
    }

    private function acquireRuntimeRefreshLock(string $lockToken): bool
    {
        if (!$this->hasPersistentRuntimeRefreshLockStorage()) {
            if (self::$runtimeRefreshProcessLock !== null) {
                return false;
            }

            self::$runtimeRefreshProcessLock = $lockToken;
            return true;
        }

        $currentLock = get_option(self::RUNTIME_REFRESH_LOCK_OPTION, false);

        if ($currentLock !== false) {
            $currentLock = (string) $currentLock;
            $lockTimestamp = $this->runtimeRefreshLockTimestamp($currentLock);
            if ($lockTimestamp > 0 && microtime(true) - $lockTimestamp < self::RUNTIME_REFRESH_LOCK_TTL) {
                return false;
            }

            if (!$this->compareAndDeleteRuntimeRefreshLock($currentLock)) {
                return false;
            }
        }

        return (bool) add_option(self::RUNTIME_REFRESH_LOCK_OPTION, $lockToken, '', false);
    }

    private function releaseRuntimeRefreshLock(string $lockToken): void
    {
        if (
            self::$runtimeRefreshProcessLock !== null
            && hash_equals(self::$runtimeRefreshProcessLock, $lockToken)
        ) {
            self::$runtimeRefreshProcessLock = null;
            return;
        }

        $this->compareAndDeleteRuntimeRefreshLock($lockToken);
    }

    private function hasPersistentRuntimeRefreshLockStorage(): bool
    {
        global $wpdb;

        return function_exists('get_option')
            && function_exists('add_option')
            && isset($wpdb)
            && is_object($wpdb)
            && isset($wpdb->options)
            && method_exists($wpdb, 'delete');
    }

    private function createRuntimeRefreshLockToken(): string
    {
        $suffix = function_exists('wp_generate_uuid4')
            ? wp_generate_uuid4()
            : uniqid('', true);

        return sprintf('%.6F:%s', microtime(true), $suffix);
    }

    private function runtimeRefreshLockTimestamp(string $lockToken): float
    {
        $separator = strpos($lockToken, ':');
        $timestamp = $separator === false
            ? $lockToken
            : substr($lockToken, 0, $separator);

        return is_numeric($timestamp) ? (float) $timestamp : 0.0;
    }

    /**
     * Delete only the exact token this request observed or acquired. A
     * read-then-delete sequence is unsafe because another request can replace
     * the option between those operations.
     */
    private function compareAndDeleteRuntimeRefreshLock(string $lockToken): bool
    {
        global $wpdb;

        if (
            !isset($wpdb)
            || !is_object($wpdb)
            || !isset($wpdb->options)
            || !method_exists($wpdb, 'delete')
        ) {
            return false;
        }

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- A conditional option delete is required for compare-and-delete lock ownership.
        $deleted = $wpdb->delete(
            $wpdb->options,
            [
                'option_name' => self::RUNTIME_REFRESH_LOCK_OPTION,
                'option_value' => $lockToken,
            ],
            ['%s', '%s']
        );

        if ((int) $deleted !== 1) {
            return false;
        }

        if (function_exists('wp_cache_delete')) {
            wp_cache_delete(self::RUNTIME_REFRESH_LOCK_OPTION, 'options');
            wp_cache_delete('alloptions', 'options');
        }

        return true;
    }

    private function runtimeSourceChanged($oldValue, array $newValue): bool
    {
        $oldValue = is_array($oldValue) ? $oldValue : [];

        $oldApiKey = trim((string) ($oldValue['api_key'] ?? ''));
        $newApiKey = trim((string) ($newValue['api_key'] ?? ''));
        $oldBaseUrl = untrailingslashit((string) ($oldValue['api_base_url'] ?? ''));
        $newBaseUrl = untrailingslashit((string) ($newValue['api_base_url'] ?? ''));

        return $oldApiKey !== $newApiKey || $oldBaseUrl !== $newBaseUrl;
    }

    private function maybeFlagInvalidStoredCredentials(
        \WP_Error $error,
        bool $usesStoredCredentials,
        string $apiKey,
        string $baseUrl
    ): void
    {
        if (!$usesStoredCredentials) {
            return;
        }

        $data = method_exists($error, 'get_error_data')
            ? $error->get_error_data()
            : null;
        $statusCode = is_array($data) ? (int) ($data['status'] ?? 0) : 0;

        if ($statusCode === 401) {
            $this->client->flagInvalidApiKeyForConfiguration($apiKey, $baseUrl);
        }
    }
}
