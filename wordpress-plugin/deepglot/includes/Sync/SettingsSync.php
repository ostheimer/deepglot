<?php

namespace Deepglot\Sync;

use Deepglot\Api\Client;
use Deepglot\Config\Options;

class SettingsSync
{
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
        if (!is_array($newValue)) {
            return;
        }

        $result = $this->sync($newValue);

        if (is_wp_error($result)) {
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

        return $this->client->syncSettings($normalized, $apiKeyOverride, $baseUrlOverride);
    }
}
