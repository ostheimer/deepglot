<?php

namespace Deepglot\Api;

use Deepglot\Config\Options;

class Client
{
    /**
     * Circuit breaker for a revoked or mistyped API key (#245). While this
     * transient is set, translation calls fail locally instead of queuing
     * another round of doomed HTTP requests.
     */
    public const INVALID_API_KEY_TRANSIENT = 'deepglot_invalid_api_key';

    /**
     * Short enough that a key re-enabled on the SaaS side heals without an
     * admin save, long enough that a busy site pays at most one failed batch
     * per window instead of one per page view.
     */
    private const INVALID_API_KEY_TTL = 900;

    /** Translation providers may need longer than ordinary API operations. */
    private const TRANSLATE_TIMEOUT_SECONDS = 30;

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
        $requestConfiguration = $this->translationRequestConfiguration();

        if ($this->isApiKeyIdentityKnownInvalid($requestConfiguration['identity'])) {
            return $this->invalidApiKeyError();
        }

        return $this->buildTranslateResponse($this->dispatchTranslate(
            $this->buildTranslatePayload($texts, $langFrom, $langTo, $requestUrl, $bot),
            $requestConfiguration['api_key'],
            $requestConfiguration['base_url']
        ), $requestConfiguration['identity']);
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

        $requestConfiguration = $this->translationRequestConfiguration();

        // A page render fans out into several batches. With a known-invalid
        // key every one of them would block on its own 401, which is what made
        // uncached pages take 16.7 s on the live site — fail them all locally.
        if ($this->isApiKeyIdentityKnownInvalid($requestConfiguration['identity'])) {
            $shortCircuited = [];

            foreach (array_keys($payloads) as $key) {
                $shortCircuited[$key] = $this->invalidApiKeyError();
            }

            return $shortCircuited;
        }

        if (count($payloads) === 1) {
            $singleKey = array_key_first($payloads);
            $result = $this->dispatchTranslate(
                $payloads[$singleKey],
                $requestConfiguration['api_key'],
                $requestConfiguration['base_url']
            );

            return [
                $singleKey => $this->buildTranslateResponse(
                    $result,
                    $requestConfiguration['identity']
                ),
            ];
        }

        $parallel = $this->dispatchTranslateParallel(
            $payloads,
            $requestConfiguration['api_key'],
            $requestConfiguration['base_url'],
            $requestConfiguration['identity']
        );

        if ($parallel !== null) {
            return $parallel;
        }

        // Sequential fallback when the Requests v2 helper is not available.
        $results = [];
        $invalidApiKeyDetected = false;

        foreach ($payloads as $key => $payload) {
            if (
                $invalidApiKeyDetected
                || $this->isApiKeyIdentityKnownInvalid($requestConfiguration['identity'])
            ) {
                $results[$key] = $this->invalidApiKeyError();
                continue;
            }

            $result = $this->buildTranslateResponse(
                $this->dispatchTranslate(
                    $payload,
                    $requestConfiguration['api_key'],
                    $requestConfiguration['base_url']
                ),
                $requestConfiguration['identity']
            );
            $results[$key] = $result;
            $invalidApiKeyDetected = $this->apiErrorStatus($result) === 401;
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
    private function dispatchTranslate(array $payload, string $apiKey, string $baseUrl)
    {
        return $this->request(
            'POST',
            '/translate?api_key=' . rawurlencode($apiKey),
            $payload,
            $baseUrl,
            self::TRANSLATE_TIMEOUT_SECONDS
        );
    }

    /**
     * @param  mixed $result
     * @return mixed
     */
    private function buildTranslateResponse($result, string $requestIdentity)
    {
        if ($result instanceof \WP_Error) {
            $data = $result->get_error_data();
            $this->maybeFlagInvalidApiKey(
                is_array($data) ? (int) ($data['status'] ?? 0) : 0,
                $requestIdentity
            );
        }

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
    private function dispatchTranslateParallel(
        array $payloads,
        string $apiKey,
        string $baseUrl,
        string $requestIdentity
    ): ?array
    {
        $requestsClass = '\\WpOrg\\Requests\\Requests';

        if (!class_exists($requestsClass)) {
            return null;
        }

        $url = untrailingslashit($baseUrl) . '/translate?api_key=' . rawurlencode($apiKey);
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
                    'timeout' => self::TRANSLATE_TIMEOUT_SECONDS,
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
                $this->maybeFlagInvalidApiKey($statusCode, $requestIdentity);
                $results[$key] = new \WP_Error(
                    'deepglot_api_error',
                    $this->getApiErrorMessage($decoded),
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

    private function request(
        string $method,
        string $path,
        ?array $payload = null,
        ?string $baseUrl = null,
        int $timeoutSeconds = 15
    )
    {
        $url = untrailingslashit((string) ($baseUrl ?? $this->options->getApiBaseUrl())) . $path;

        $args = [
            'method' => $method,
            'timeout' => $timeoutSeconds,
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
                $this->getApiErrorMessage($decoded),
                ['status' => $statusCode, 'body' => $decoded]
            );
        }

        return is_array($decoded) ? $decoded : [];
    }

    private function getApiErrorMessage($decoded): string
    {
        if (is_array($decoded) && isset($decoded['detail']) && is_string($decoded['detail']) && trim($decoded['detail']) !== '') {
            return $decoded['detail'];
        }

        if (is_array($decoded) && isset($decoded['error']) && is_string($decoded['error']) && trim($decoded['error']) !== '') {
            return $decoded['error'];
        }

        return __('Deepglot API Fehler.', 'deepglot');
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

    /**
     * Marks a 401 against the exact key/backend pair that made the request.
     * The transient stores only a one-way fingerprint, never the API key.
     */
    public function flagInvalidApiKeyForConfiguration(string $apiKey, string $baseUrl): void
    {
        $this->storeInvalidApiKeyIdentity(self::configurationIdentity($apiKey, $baseUrl));
    }

    /**
     * Clears a recovered stored configuration's persisted breaker.
     */
    public function clearInvalidApiKeyForConfiguration(string $apiKey, string $baseUrl): void
    {
        self::clearInvalidApiKeyMarkerForConfiguration($this->options, $apiKey, $baseUrl);
    }

    /**
     * Clears only a marker belonging to the configuration that is still
     * stored. Candidate or stale in-flight successes cannot heal another key.
     */
    public static function clearInvalidApiKeyMarkerForConfiguration(
        Options $options,
        string $apiKey,
        string $baseUrl
    ): void {
        if (!function_exists('get_transient') || !function_exists('delete_transient')) {
            return;
        }

        $identity = self::configurationIdentity($apiKey, $baseUrl);
        $settings = $options->all();
        $currentIdentity = self::configurationIdentity(
            (string) ($settings['api_key'] ?? ''),
            (string) ($settings['api_base_url'] ?? '')
        );

        if ($identity === '' || !hash_equals($identity, $currentIdentity)) {
            return;
        }

        $marker = get_transient(self::INVALID_API_KEY_TRANSIENT);

        if (
            self::invalidApiKeyMarkerMatches($marker, $identity)
            || self::isLegacyInvalidApiKeyMarker($marker)
        ) {
            delete_transient(self::INVALID_API_KEY_TRANSIENT);
        }
    }

    /**
     * True only when the cached 401 belongs to the currently stored settings.
     * A late response from an old key or backend can therefore never poison a
     * replacement configuration saved while that request was still in flight.
     */
    public static function hasInvalidApiKeyMarkerFor(Options $options): bool
    {
        if (!function_exists('get_transient')) {
            return false;
        }

        $settings = $options->all();

        $identity = self::configurationIdentity(
            (string) ($settings['api_key'] ?? ''),
            (string) ($settings['api_base_url'] ?? '')
        );
        $marker = get_transient(self::INVALID_API_KEY_TRANSIENT);

        return $identity !== ''
            && (
                self::invalidApiKeyMarkerMatches($marker, $identity)
                || self::isLegacyInvalidApiKeyMarker($marker)
            );
    }

    /**
     * A 401 means the request's key is revoked, rotated, or mistyped. Arm the
     * identity-bound breaker so remaining sequential batches of this render
     * and later requests using the same configuration fail locally (#245).
     */
    private function maybeFlagInvalidApiKey(int $statusCode, string $requestIdentity): void
    {
        if ($statusCode === 401) {
            $this->storeInvalidApiKeyIdentity($requestIdentity);
        }
    }

    private function storeInvalidApiKeyIdentity(string $identity): void
    {
        if ($identity === '') {
            return;
        }

        // Never let a stale in-flight failure overwrite the persisted verdict
        // for a key or backend that an administrator has since replaced.
        $currentIdentity = $this->translationRequestConfiguration()['identity'];
        if (
            !hash_equals($identity, $currentIdentity)
            || !function_exists('set_transient')
        ) {
            return;
        }

        set_transient(
            self::INVALID_API_KEY_TRANSIENT,
            [
                'identity' => $identity,
                'flagged_at' => time(),
            ],
            self::INVALID_API_KEY_TTL
        );
    }

    private function isApiKeyIdentityKnownInvalid(string $identity): bool
    {
        if ($identity === '' || !function_exists('get_transient')) {
            return false;
        }

        $marker = get_transient(self::INVALID_API_KEY_TRANSIENT);

        return self::invalidApiKeyMarkerMatches($marker, $identity)
            || self::isLegacyInvalidApiKeyMarker($marker);
    }

    private static function invalidApiKeyMarkerMatches($marker, string $identity): bool
    {
        return is_array($marker)
            && isset($marker['identity'])
            && is_string($marker['identity'])
            && hash_equals($marker['identity'], $identity);
    }

    private static function isLegacyInvalidApiKeyMarker($marker): bool
    {
        return is_int($marker)
            || (is_string($marker) && ctype_digit($marker));
    }

    private function apiErrorStatus($result): int
    {
        if (!$result instanceof \WP_Error || !method_exists($result, 'get_error_data')) {
            return 0;
        }

        $data = $result->get_error_data();

        return is_array($data) ? (int) ($data['status'] ?? 0) : 0;
    }

    private static function configurationIdentity(string $apiKey, string $baseUrl): string
    {
        $normalizedApiKey = trim($apiKey);
        $normalizedBaseUrl = untrailingslashit(trim($baseUrl));

        if ($normalizedApiKey === '' || $normalizedBaseUrl === '') {
            return '';
        }

        return hash('sha256', $normalizedBaseUrl . "\0" . $normalizedApiKey);
    }

    /**
     * @return array{api_key: string, base_url: string, identity: string}
     */
    private function translationRequestConfiguration(): array
    {
        $settings = $this->options->all();
        $apiKey = trim((string) ($settings['api_key'] ?? ''));
        $baseUrl = untrailingslashit(trim((string) ($settings['api_base_url'] ?? '')));

        return [
            'api_key' => $apiKey,
            'base_url' => $baseUrl,
            'identity' => self::configurationIdentity($apiKey, $baseUrl),
        ];
    }

    private function invalidApiKeyError(): \WP_Error
    {
        return new \WP_Error(
            'deepglot_invalid_api_key',
            __('Deepglot API-Key ungültig oder widerrufen.', 'deepglot'),
            ['status' => 401]
        );
    }
}
