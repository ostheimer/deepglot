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
     * @param  int      $bot        Legacy bot code (0 human … 6 Yandex); the
     *                              SaaS exempts bot traffic from the quota and
     *                              serves it cache-only. See BotDetector.
     * @return array|\WP_Error      On success: ['from_words' => [...], 'to_words' => [...]].
     */
    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0)
    {
        return $this->buildTranslateResponse($this->dispatchTranslate(
            $this->buildTranslatePayload($texts, $langFrom, $langTo, $requestUrl, $bot)
        ));
    }

    /**
     * Translates several batches of texts at once, returning the result for
     * each batch in the same key order as the input array.
     *
     * On servers that ship the WordPress Requests v2 library (WP 6.2+) the
     * batches are dispatched in parallel via curl_multi, which keeps cold
     * archive pages comfortably below the per-request timeout. Older sites
     * fall back to sequential calls so behavior never silently changes.
     *
     * @param  array<int|string, string[]> $batches
     * @return array<int|string, array|\WP_Error>
     */
    public function translateBatches(array $batches, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0): array
    {
        if (empty($batches)) {
            return [];
        }

        $payloads = [];

        foreach ($batches as $key => $batch) {
            if (!is_array($batch) || empty($batch)) {
                continue;
            }

            $payloads[$key] = $this->buildTranslatePayload($batch, $langFrom, $langTo, $requestUrl, $bot);
        }

        if (empty($payloads)) {
            return [];
        }

        if (count($payloads) === 1) {
            $singleKey = array_key_first($payloads);
            $result = $this->dispatchTranslate($payloads[$singleKey]);

            return [$singleKey => $this->buildTranslateResponse($result)];
        }

        $parallel = $this->dispatchTranslateParallel($payloads);

        if ($parallel !== null) {
            return $parallel;
        }

        // Sequential fallback when the Requests v2 helper is not available.
        $results = [];

        foreach ($payloads as $key => $payload) {
            $results[$key] = $this->buildTranslateResponse($this->dispatchTranslate($payload));
        }

        return $results;
    }

    /**
     * @param  string[] $texts
     * @return array<string, mixed>
     */
    private function buildTranslatePayload(array $texts, string $langFrom, string $langTo, string $requestUrl, int $bot = 0): array
    {
        return [
            'l_from'      => $langFrom,
            'l_to'        => $langTo,
            'words'       => array_map(static fn(string $word) => ['w' => $word, 't' => 1], $texts),
            'request_url' => $requestUrl,
            'bot'         => $bot,
        ];
    }

    /**
     * @param  array<string, mixed> $payload
     * @return mixed
     */
    private function dispatchTranslate(array $payload)
    {
        return $this->request(
            'POST',
            '/translate?api_key=' . rawurlencode($this->options->getApiKey()),
            $payload
        );
    }

    /**
     * @param  mixed $result
     * @return mixed
     */
    private function buildTranslateResponse($result)
    {
        return $result;
    }

    /**
     * Tries to dispatch every payload in parallel through Requests v2.
     * Returns null when the helper class is unavailable so the caller can
     * gracefully fall back to sequential calls.
     *
     * @param  array<int|string, array<string, mixed>> $payloads
     * @return array<int|string, array|\WP_Error>|null
     */
    private function dispatchTranslateParallel(array $payloads): ?array
    {
        $requestsClass = '\\WpOrg\\Requests\\Requests';

        if (!class_exists($requestsClass)) {
            return null;
        }

        $baseUrl = untrailingslashit($this->options->getApiBaseUrl());
        $url = $baseUrl . '/translate?api_key=' . rawurlencode($this->options->getApiKey());
        $headers = [
            'Accept' => 'application/json',
            'Content-Type' => 'application/json',
        ];

        $requests = [];

        foreach ($payloads as $key => $payload) {
            $body = wp_json_encode($payload);

            $requests[$key] = [
                'url' => $url,
                'type' => 'POST',
                'headers' => $headers,
                'data' => is_string($body) ? $body : '',
                'options' => [
                    'timeout' => 30,
                    'connect_timeout' => 10,
                    'useragent' => 'Deepglot WordPress Plugin/' . (defined('DEEPGLOT_PLUGIN_VERSION') ? DEEPGLOT_PLUGIN_VERSION : 'dev'),
                ],
            ];
        }

        try {
            $responses = call_user_func([$requestsClass, 'request_multiple'], $requests);
        } catch (\Throwable $exception) {
            return null;
        }

        $results = [];

        foreach ($responses as $key => $response) {
            if ($response instanceof \Throwable) {
                $results[$key] = new \WP_Error('deepglot_api_error', $response->getMessage());
                continue;
            }

            $statusCode = (int) ($response->status_code ?? 0);
            $body = (string) ($response->body ?? '');
            $decoded = json_decode($body, true);

            if ($statusCode >= 400) {
                $this->maybeFlagQuotaExhausted($statusCode);
                $results[$key] = new \WP_Error(
                    'deepglot_api_error',
                    is_array($decoded) && !empty($decoded['error'])
                        ? $decoded['error']
                        : __('Deepglot API Fehler.', 'deepglot'),
                    ['status' => $statusCode, 'body' => $decoded]
                );
                continue;
            }

            $results[$key] = is_array($decoded) ? $decoded : [];
        }

        return $results;
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
            'enableDynamicTranslation' => !empty($settings['enable_dynamic_translation']),
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
            $this->maybeFlagQuotaExhausted((int) $statusCode);

            return new \WP_Error(
                'deepglot_api_error',
                is_array($decoded) && !empty($decoded['error']) ? $decoded['error'] : __('Deepglot API Fehler.', 'deepglot'),
                ['status' => $statusCode, 'body' => $decoded]
            );
        }

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * A 402 from the backend means the monthly word quota is exhausted.
     * Persist a short-lived marker so the admin notice and the status
     * endpoint can surface it without extra backend calls (issue #148);
     * re-set on every 402, so the notice clears about an hour after
     * translations start succeeding again.
     */
    private function maybeFlagQuotaExhausted(int $statusCode): void
    {
        if ($statusCode === 402 && function_exists('set_transient')) {
            set_transient('deepglot_quota_exhausted', time(), 3600);
        }
    }
}
