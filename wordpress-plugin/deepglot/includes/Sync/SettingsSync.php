<?php

namespace Deepglot\Sync;

use Deepglot\Api\Client;
use Deepglot\Config\Options;

class SettingsSync
{
    private const RUNTIME_REFRESH_LOCK_OPTION = 'deepglot_runtime_refresh_lock';
    private const RUNTIME_REFRESH_BACKOFF_TRANSIENT = 'deepglot_runtime_refresh_backoff';
    private const RUNTIME_REFRESH_LOCK_TTL = 60;
    private const RUNTIME_REFRESH_FAILURE_BACKOFF = 60;

    private Options $options;
    private Client $client;

    public function __construct(Options $options, Client $client)
    {
        $this->options = $options;
        $this->client = $client;
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
            $this->options->clearUrlSlugMappings();
            // A new key or backend invalidates the cached 401 verdict. Without
            // this reset a corrected key would only take effect once the
            // circuit breaker's TTL expired (#245).
            delete_transient(Client::INVALID_API_KEY_TRANSIENT);
        }

        $result = $this->sync($newValue);

        if (is_wp_error($result)) {
            // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- Operational sync failures must reach the site error log without exposing credentials.
            error_log('[Deepglot] Settings sync failed: ' . $result->get_error_message());
        }
    }

    public function sync(?array $settings = null, ?string $apiKeyOverride = null, ?string $baseUrlOverride = null)
    {
        $normalized = $settings !== null
            ? $this->options->sanitize($settings)
            : $this->options->all();

        if (empty($normalized['api_key']) && $apiKeyOverride === null) {
            return new \WP_Error('deepglot_sync_missing_key', __('Kein API-Key für die Synchronisierung vorhanden.', 'deepglot'));
        }

        if (empty($normalized['target_languages'])) {
            return new \WP_Error('deepglot_sync_missing_languages', __('Keine Zielsprachen für die Synchronisierung konfiguriert.', 'deepglot'));
        }

        $settingsResult = $this->client->syncSettings($normalized, $apiKeyOverride, $baseUrlOverride);

        if (is_wp_error($settingsResult)) {
            return $settingsResult;
        }

        $runtimeResult = $this->refreshRuntimeConfig($apiKeyOverride, $baseUrlOverride, true);

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

            $result = $this->refreshRuntimeConfig();

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

        $runtimeConfig = $this->client->fetchRuntimeConfig($apiKeyOverride, $baseUrlOverride);

        if (is_wp_error($runtimeConfig)) {
            return $runtimeConfig;
        }

        $applied = $this->options->applyRuntimeConfig($runtimeConfig, $fetchKey, $fetchBaseUrl);

        if ($applied) {
            delete_transient(self::RUNTIME_REFRESH_BACKOFF_TRANSIENT);
        }

        return $runtimeConfig;
    }

    private function acquireRuntimeRefreshLock(string $lockToken): bool
    {
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
        $this->compareAndDeleteRuntimeRefreshLock($lockToken);
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
}
