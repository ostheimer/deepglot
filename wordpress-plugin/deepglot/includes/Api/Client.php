<?php

namespace Deepglot\Api;

use Deepglot\Config\Options;

class Client
{
    private Options $options;

    public function __construct(Options $options)
    {
        $this->options = $options;
    }

    public function isConfigured(): bool
    {
        return $this->options->isConfigured();
    }

    public function listLanguages()
    {
        return $this->request('GET', '/public/languages');
    }

    /**
     * Translates an array of plain text strings.
     *
     * @param  string[] $texts      Plain text strings to translate.
     * @param  string   $langFrom   ISO 639-1 source language code (e.g. "de").
     * @param  string   $langTo     ISO 639-1 target language code (e.g. "en").
     * @param  string   $requestUrl Optional page URL for analytics.
     * @return array|\WP_Error      On success: ['from_words' => [...], 'to_words' => [...]].
     */
    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '')
    {
        // Build the words array in the API contract format.
        $words = array_map(static fn(string $w) => ['w' => $w, 't' => 1], $texts);

        $payload = [
            'l_from'      => $langFrom,
            'l_to'        => $langTo,
            'words'       => $words,
            'request_url' => $requestUrl,
            'bot'         => 0,
        ];

        return $this->request('POST', '/translate?api_key=' . rawurlencode($this->options->getApiKey()), $payload);
    }

    public function syncSettings(?array $settings = null, ?string $apiKeyOverride = null, ?string $baseUrlOverride = null)
    {
        $settings = is_array($settings) ? $this->options->sanitize($settings) : $this->options->all();
        $apiKey = $apiKeyOverride !== null ? trim($apiKeyOverride) : trim((string) ($settings['api_key'] ?? ''));
        $baseUrl = $baseUrlOverride !== null
            ? untrailingslashit((string) $baseUrlOverride)
            : untrailingslashit((string) ($settings['api_base_url'] ?? $this->options->getApiBaseUrl()));

        if ($apiKey === '') {
            return new \WP_Error('deepglot_sync_missing_key', __('Kein API-Key für die Synchronisierung vorhanden.', 'deepglot'));
        }

        $domainMappings = [];

        foreach ((array) ($settings['domain_mappings'] ?? []) as $lang => $host) {
            if (!is_string($lang) || !is_string($host) || trim($lang) === '' || trim($host) === '') {
                continue;
            }

            $domainMappings[] = [
                'langCode' => strtolower(trim($lang)),
                'host' => strtolower(trim($host)),
            ];
        }

        $payload = [
            'routingMode' => strtoupper((string) ($settings['routing_mode'] ?? 'PATH_PREFIX')) === 'SUBDOMAIN' ? 'SUBDOMAIN' : 'PATH_PREFIX',
            'siteUrl' => get_site_url(),
            'sourceLanguage' => strtolower((string) ($settings['source_language'] ?? 'de')),
            'targetLanguages' => array_values(array_map('strtolower', (array) ($settings['target_languages'] ?? []))),
            'autoRedirect' => !empty($settings['auto_redirect']),
            'translateEmails' => !empty($settings['translate_emails']),
            'translateSearch' => !empty($settings['translate_search']),
            'translateAmp' => !empty($settings['translate_amp']),
            'domainMappings' => $domainMappings,
        ];

        return $this->request(
            'POST',
            '/plugin/settings-sync?api_key=' . rawurlencode($apiKey),
            $payload,
            $baseUrl
        );
    }

    public function fetchRuntimeConfig(?string $apiKeyOverride = null, ?string $baseUrlOverride = null)
    {
        $apiKey = $apiKeyOverride !== null ? trim($apiKeyOverride) : trim($this->options->getApiKey());
        $baseUrl = $baseUrlOverride !== null
            ? untrailingslashit((string) $baseUrlOverride)
            : $this->options->getApiBaseUrl();

        if ($apiKey === '') {
            return new \WP_Error('deepglot_runtime_config_missing_key', __('Kein API-Key für die Runtime-Konfiguration vorhanden.', 'deepglot'));
        }

        return $this->request(
            'GET',
            '/plugin/runtime-config?api_key=' . rawurlencode($apiKey),
            null,
            $baseUrl
        );
    }

    private function request(string $method, string $path, ?array $payload = null, ?string $baseUrl = null)
    {
        $url = untrailingslashit((string) ($baseUrl ?? $this->options->getApiBaseUrl())) . $path;

        $args = [
            'method' => $method,
            'timeout' => 15,
            'headers' => [
                'Accept' => 'application/json',
                'Content-Type' => 'application/json',
            ],
        ];

        if ($payload !== null) {
            $args['body'] = wp_json_encode($payload);
        }

        $response = wp_remote_request($url, $args);

        if (is_wp_error($response)) {
            return $response;
        }

        $statusCode = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $decoded = json_decode($body, true);

        if ($statusCode >= 400) {
            return new \WP_Error(
                'deepglot_api_error',
                is_array($decoded) && !empty($decoded['error']) ? $decoded['error'] : __('Deepglot API Fehler.', 'deepglot'),
                ['status' => $statusCode, 'body' => $decoded]
            );
        }

        return is_array($decoded) ? $decoded : [];
    }
}
