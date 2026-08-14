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
    public const RATE_LIMIT_TRANSIENT = 'deepglot_rate_limited';
    public const RATE_LIMIT_OPTION = 'deepglot_rate_limited_by_identity';

    /**
     * Short enough that a key re-enabled on the SaaS side heals without an
     * admin save, long enough that a busy site pays at most one failed batch
     * per window instead of one per page view.
     */
    private const INVALID_API_KEY_TTL = 900;

    /** Conservative fallback when a 429 omits or malforms Retry-After. */
    public const DEFAULT_RATE_LIMIT_BACKOFF = 60;

    /** Preserve the fixed hourly velocity window, but never exceed one hour. */
    public const MAX_RATE_LIMIT_BACKOFF = 3600;

    /** Translation providers may need longer than ordinary API operations. */
    private const TRANSLATE_TIMEOUT_SECONDS = 60;

    private Options $options;

    /**
     * Request-local scopes for nested identity-aware batch calls.
     *
     * @var string[]
     */
    private array $batchExpectedIdentityStack = [];

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
    public function translate(
        array $texts,
        string $langFrom,
        string $langTo,
        string $requestUrl = '',
        int $bot = 0,
        ?int $timeout = null
    )
    {
        return $this->translateWithExpectedIdentity(
            null,
            $texts,
            $langFrom,
            $langTo,
            $requestUrl,
            $bot,
            $timeout
        );
    }

    public function translateForExpectedIdentity(
        string $expectedIdentity,
        array $texts,
        string $langFrom,
        string $langTo,
        string $requestUrl = '',
        int $bot = 0,
        ?int $timeout = null
    ) {
        return $this->translateWithExpectedIdentity(
            $expectedIdentity,
            $texts,
            $langFrom,
            $langTo,
            $requestUrl,
            $bot,
            $timeout
        );
    }

    private function translateWithExpectedIdentity(
        ?string $expectedIdentity,
        array $texts,
        string $langFrom,
        string $langTo,
        string $requestUrl,
        int $bot,
        ?int $timeout
    )
    {
        $requestConfiguration = $this->translationRequestConfiguration();

        if (!$this->expectedIdentityMatches($expectedIdentity, $requestConfiguration['identity'])) {
            return $this->configurationChangedError();
        }

        if ($this->isApiKeyIdentityKnownInvalid($requestConfiguration['identity'])) {
            return $this->invalidApiKeyError();
        }

        $rateLimitError = $this->activeRateLimitError($requestConfiguration['identity']);
        if ($rateLimitError !== null) {
            return $rateLimitError;
        }

        return $this->buildTranslateResponse($this->dispatchTranslate(
            $this->buildTranslatePayload($texts, $langFrom, $langTo, $requestUrl, $bot),
            $requestConfiguration['api_key'],
            $requestConfiguration['base_url'],
            $timeout
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
    public function translateBatches(
        array $batches,
        string $langFrom,
        string $langTo,
        string $requestUrl = '',
        int $bot = 0,
        ?int $timeout = null
    ): array
    {
        $expectedIdentity = empty($this->batchExpectedIdentityStack)
            ? null
            : $this->batchExpectedIdentityStack[count($this->batchExpectedIdentityStack) - 1];

        return $this->translateBatchesWithExpectedIdentity(
            $expectedIdentity,
            $batches,
            $langFrom,
            $langTo,
            $requestUrl,
            $bot,
            $timeout
        );
    }

    public function translateBatchesForExpectedIdentity(
        string $expectedIdentity,
        array $batches,
        string $langFrom,
        string $langTo,
        string $requestUrl = '',
        int $bot = 0,
        ?int $timeout = null
    ): array {
        $this->batchExpectedIdentityStack[] = $expectedIdentity;

        try {
            // Keep the original virtual entrypoint in the call chain so
            // integrations that override only translateBatches() still run.
            // A delegating override's parent::translateBatches() call then
            // consumes the request-local expected identity from the stack.
            return $this->translateBatches(
                $batches,
                $langFrom,
                $langTo,
                $requestUrl,
                $bot,
                $timeout
            );
        } finally {
            array_pop($this->batchExpectedIdentityStack);
        }
    }

    private function translateBatchesWithExpectedIdentity(
        ?string $expectedIdentity,
        array $batches,
        string $langFrom,
        string $langTo,
        string $requestUrl,
        int $bot,
        ?int $timeout
    ): array
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

        if (!$this->expectedIdentityMatches($expectedIdentity, $requestConfiguration['identity'])) {
            $configurationChanged = [];
            foreach (array_keys($payloads) as $key) {
                $configurationChanged[$key] = $this->configurationChangedError();
            }

            return $configurationChanged;
        }

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

        $rateLimitError = $this->activeRateLimitError($requestConfiguration['identity']);
        if ($rateLimitError !== null) {
            $shortCircuited = [];

            foreach (array_keys($payloads) as $key) {
                $shortCircuited[$key] = $this->activeRateLimitError(
                    $requestConfiguration['identity']
                ) ?? $rateLimitError;
            }

            return $shortCircuited;
        }

        if (count($payloads) === 1) {
            $singleKey = array_key_first($payloads);
            $result = $this->dispatchTranslate(
                $payloads[$singleKey],
                $requestConfiguration['api_key'],
                $requestConfiguration['base_url'],
                $timeout
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
            $requestConfiguration['identity'],
            $timeout
        );

        if ($parallel !== null) {
            return $parallel;
        }

        // Sequential fallback when the Requests v2 helper is not available.
        $results = [];
        $invalidApiKeyDetected = false;
        $rateLimitBackoff = null;
        $deadline = microtime(true) + $this->resolveTranslateTimeout($timeout);

        foreach ($payloads as $key => $payload) {
            if (
                $invalidApiKeyDetected
                || $this->isApiKeyIdentityKnownInvalid($requestConfiguration['identity'])
            ) {
                $results[$key] = $this->invalidApiKeyError();
                continue;
            }

            if (is_array($rateLimitBackoff)) {
                $results[$key] = $this->rateLimitedError($rateLimitBackoff);
                continue;
            }

            $remainingTimeout = (int) ceil($deadline - microtime(true));
            if ($remainingTimeout <= 0) {
                $results[$key] = new \WP_Error(
                    'deepglot_api_timeout',
                    __('Deepglot API Fehler.', 'deepglot')
                );
                continue;
            }

            $result = $this->buildTranslateResponse(
                $this->dispatchTranslate(
                    $payload,
                    $requestConfiguration['api_key'],
                    $requestConfiguration['base_url'],
                    $remainingTimeout
                ),
                $requestConfiguration['identity']
            );
            $results[$key] = $result;
            $status = $this->apiErrorStatus($result);
            $invalidApiKeyDetected = $status === 401;

            if ($status === 429 && $result instanceof \WP_Error) {
                $data = $result->get_error_data();
                $rateLimitBackoff = is_array($data)
                    ? $this->rateLimitDataFromErrorData($data)
                    : $this->classifyRetryAfter('');
            }
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
    /**
     * Resolves the timeout for a translate call. Background warming passes a
     * longer budget because no visitor is waiting on it, and
     * `deepglot_api_timeout` lets an operator adapt the default to their
     * site's real API latency without editing plugin code.
     */
    private function resolveTranslateTimeout(?int $timeout): int
    {
        if ($timeout !== null && $timeout > 0) {
            return $timeout;
        }

        $filtered = function_exists('apply_filters')
            ? apply_filters('deepglot_api_timeout', self::TRANSLATE_TIMEOUT_SECONDS)
            : self::TRANSLATE_TIMEOUT_SECONDS;

        return is_numeric($filtered) && (int) $filtered > 0
            ? (int) $filtered
            : self::TRANSLATE_TIMEOUT_SECONDS;
    }

    private function dispatchTranslate(array $payload, string $apiKey, string $baseUrl, ?int $timeout = null)
    {
        return $this->request(
            'POST',
            '/translate?api_key=' . rawurlencode($apiKey),
            $payload,
            $baseUrl,
            $this->resolveTranslateTimeout($timeout),
            self::configurationIdentity($apiKey, $baseUrl)
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
        string $requestIdentity,
        ?int $timeout = null
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
                    'timeout' => $this->resolveTranslateTimeout($timeout),
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
                $retryAfter = $this->responseHeader($response, 'Retry-After');

                $this->maybeFlagQuotaExhausted($statusCode);
                $this->maybeFlagRateLimited(
                    $statusCode,
                    is_scalar($retryAfter) ? (string) $retryAfter : '',
                    $requestIdentity
                );
                $this->maybeFlagInvalidApiKey($statusCode, $requestIdentity);
                $results[$key] = $this->apiError(
                    $statusCode,
                    $decoded,
                    $retryAfter,
                    $requestIdentity
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
        int $timeoutSeconds = 15,
        ?string $translationIdentity = null
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
            if ($translationIdentity !== null) {
                $this->maybeFlagRateLimited(
                    (int) $statusCode,
                    function_exists('wp_remote_retrieve_header')
                        ? (string) wp_remote_retrieve_header($response, 'retry-after')
                        : '',
                    $translationIdentity
                );
            }

            return $this->apiError(
                (int) $statusCode,
                $decoded,
                function_exists('wp_remote_retrieve_header')
                    ? wp_remote_retrieve_header($response, 'Retry-After')
                    : '',
                $translationIdentity
            );
        }

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * Builds the existing API error contract and adds only bounded,
     * machine-readable 429 metadata. The raw header is never persisted or
     * logged, so an upstream value cannot leak request-specific content.
     */
    private function apiError(
        int $statusCode,
        $decoded,
        $retryAfterHeader = '',
        ?string $rateLimitIdentity = null
    ): \WP_Error
    {
        $data = ['status' => $statusCode, 'body' => $decoded];

        if (is_array($decoded) && isset($decoded['code']) && is_string($decoded['code'])) {
            $data['api_code'] = $decoded['code'];
        }

        if ($statusCode === 429) {
            $data = array_merge($data, $this->classifyRetryAfter($retryAfterHeader));
            if (is_string($rateLimitIdentity) && $rateLimitIdentity !== '') {
                $data['rate_limit_identity'] = $rateLimitIdentity;
            }
        }

        return new \WP_Error(
            'deepglot_api_error',
            $this->getApiErrorMessage($decoded),
            $data
        );
    }

    /**
     * @param mixed $value Retry-After delta-seconds or HTTP-date.
     * @return array{retry_after: int, retry_after_source: string, retry_after_capped: bool}
     */
    private function classifyRetryAfter($value): array
    {
        if (is_array($value)) {
            $value = reset($value);
        }

        $raw = is_scalar($value) ? trim((string) $value) : '';
        $source = 'default';
        $seconds = self::DEFAULT_RATE_LIMIT_BACKOFF;

        if ($raw !== '' && ctype_digit($raw)) {
            $source = 'delta-seconds';
            $seconds = max(1, (int) $raw);
        } elseif ($raw !== '') {
            $timestamp = $this->parseHttpDate($raw);
            if ($timestamp !== null) {
                $source = 'http-date';
                $seconds = max(1, $timestamp - time());
            }
        }

        $capped = $seconds > self::MAX_RATE_LIMIT_BACKOFF;

        return [
            'retry_after' => min($seconds, self::MAX_RATE_LIMIT_BACKOFF),
            'retry_after_source' => $source,
            'retry_after_capped' => $capped,
        ];
    }

    /** Accepts only the RFC HTTP-date IMF-fixdate form, never relative text. */
    private function parseHttpDate(string $raw): ?int
    {
        if (!preg_match('/^[A-Z][a-z]{2}, [0-9]{2} [A-Z][a-z]{2} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/D', $raw)) {
            return null;
        }

        $date = \DateTimeImmutable::createFromFormat(
            '!D, d M Y H:i:s \G\M\T',
            $raw,
            new \DateTimeZone('GMT')
        );
        $errors = \DateTimeImmutable::getLastErrors();
        if (
            !$date
            || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))
            || $date->format('D, d M Y H:i:s \G\M\T') !== $raw
        ) {
            return null;
        }

        return $date->getTimestamp();
    }

    /** @param array<string, mixed> $data */
    private function rateLimitDataFromErrorData(array $data): array
    {
        $retryAfter = isset($data['retry_after']) && is_numeric($data['retry_after'])
            ? max(1, min(self::MAX_RATE_LIMIT_BACKOFF, (int) $data['retry_after']))
            : self::DEFAULT_RATE_LIMIT_BACKOFF;

        return [
            'retry_after' => $retryAfter,
            'retry_after_source' => is_string($data['retry_after_source'] ?? null)
                ? $data['retry_after_source']
                : 'default',
            'retry_after_capped' => (bool) ($data['retry_after_capped'] ?? false),
        ];
    }

    /** @param array<string, mixed> $backoff */
    private function rateLimitedError(array $backoff): \WP_Error
    {
        return new \WP_Error(
            'deepglot_rate_limited',
            __('Deepglot API Fehler.', 'deepglot'),
            array_merge(['status' => 429], $backoff)
        );
    }

    /** Returns a local 429 while the bounded shared retry window is active. */
    private function activeRateLimitError(string $requestIdentity): ?\WP_Error
    {
        $retryAt = self::rateLimitRetryAtForIdentity($requestIdentity);
        if ($retryAt <= 0) {
            return null;
        }

        return $this->rateLimitedError([
            'retry_after' => max(
                1,
                min(self::MAX_RATE_LIMIT_BACKOFF, $retryAt - time())
            ),
            'retry_after_source' => 'stored-marker',
            'retry_after_capped' => false,
        ]);
    }

    /** Reads a case-insensitive Requests v2 response header. */
    private function responseHeader($response, string $name)
    {
        $headers = is_object($response) ? ($response->headers ?? null) : null;

        if (is_array($headers)) {
            foreach ($headers as $header => $value) {
                if (strtolower((string) $header) === strtolower($name)) {
                    return $value;
                }
            }
        }

        if ($headers instanceof \Traversable) {
            foreach ($headers as $header => $value) {
                if (strtolower((string) $header) === strtolower($name)) {
                    return $value;
                }
            }
        }

        if (is_object($headers) && method_exists($headers, 'getValues')) {
            $values = $headers->getValues($name);
            if (is_array($values) && !empty($values)) {
                return reset($values);
            }
        }

        if ($headers instanceof \ArrayAccess && isset($headers[$name])) {
            return $headers[$name];
        }

        return '';
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

    private function maybeFlagRateLimited(
        int $statusCode,
        string $retryAfter,
        string $requestIdentity
    ): void
    {
        if (
            $statusCode !== 429
            || $requestIdentity === ''
            || !function_exists('get_option')
            || !function_exists('update_option')
        ) {
            return;
        }

        $currentIdentity = $this->translationRequestConfiguration()['identity'];
        if ($currentIdentity === '' || !hash_equals($requestIdentity, $currentIdentity)) {
            return;
        }

        $classified = $this->classifyRetryAfter($retryAfter);
        $delay = (int) $classified['retry_after'];
        $this->storeRateLimitRetryAtForIdentity(
            $requestIdentity,
            time() + $delay
        );
    }

    public static function rateLimitRetryAt(): int
    {
        return self::rateLimitRetryAtForOptions(new Options());
    }

    public static function rateLimitRetryAtForOptions(Options $options): int
    {
        return self::rateLimitRetryAtForIdentity(
            self::configurationIdentityForOptions($options)
        );
    }

    /** Reads only the bounded 429 marker for an explicit one-way identity. */
    public static function rateLimitRetryAtForIdentity(string $identity): int
    {
        if ($identity === '') {
            return 0;
        }

        $mapRetryAt = 0;
        if (function_exists('get_option')) {
            $stored = get_option(self::RATE_LIMIT_OPTION, false);
            $mapRetryAt = is_array($stored) ? (int) ($stored[$identity] ?? 0) : 0;
        }

        // Upgrade compatibility for the former single shared transient. New
        // writes use the CAS-protected identity map above.
        $legacyRetryAt = 0;
        if (function_exists('get_transient')) {
            $marker = get_transient(self::RATE_LIMIT_TRANSIENT);
            $retryAt = is_array($marker) ? (int) ($marker['retry_at'] ?? 0) : 0;
            $markerIdentity = is_array($marker) ? ($marker['identity'] ?? null) : null;
            if (
                $retryAt > time()
                && is_string($markerIdentity)
                && hash_equals($markerIdentity, $identity)
            ) {
                $legacyRetryAt = $retryAt;
            }
        }

        $retryAt = max($mapRetryAt, $legacyRetryAt);
        if ($retryAt <= time()) {
            // A caller holds only its own configuration snapshot. Deleting a
            // different marker here could race with a current-identity writer;
            // malformed, legacy, stale, and mismatched state therefore fails
            // open and is left to the bounded transient TTL.
            return 0;
        }

        return min($retryAt, time() + self::MAX_RATE_LIMIT_BACKOFF);
    }

    private function expectedIdentityMatches(?string $expectedIdentity, string $actualIdentity): bool
    {
        return $expectedIdentity === null
            || ($expectedIdentity !== ''
                && $actualIdentity !== ''
                && hash_equals($expectedIdentity, $actualIdentity));
    }

    private function configurationChangedError(): \WP_Error
    {
        return new \WP_Error(
            'deepglot_configuration_changed',
            __('Deepglot API Fehler.', 'deepglot'),
            ['status' => 409, 'api_code' => 'configuration_changed']
        );
    }

    /** Stores the longest bounded delay without cross-identity lost updates. */
    private function storeRateLimitRetryAtForIdentity(string $identity, int $retryAt): bool
    {
        $boundedRetryAt = min(time() + self::MAX_RATE_LIMIT_BACKOFF, $retryAt);

        for ($attempt = 0; $attempt < 10; $attempt++) {
            if (!$this->translationIdentityIsCurrent($identity)) {
                return false;
            }

            $raw = get_option(self::RATE_LIMIT_OPTION, false);
            $current = self::normalizeRateLimitIdentityMap($raw);
            $next = $current;
            $next[$identity] = max((int) ($current[$identity] ?? 0), $boundedRetryAt);

            if (!$this->translationIdentityIsCurrent($identity)) {
                return false;
            }

            if ($next === $raw || self::compareAndStoreRateLimitOption($raw, $next)) {
                return true;
            }

            self::clearRateLimitOptionCache();
        }

        return false;
    }

    private function translationIdentityIsCurrent(string $identity): bool
    {
        $currentIdentity = $this->translationRequestConfiguration()['identity'];

        return $identity !== ''
            && $currentIdentity !== ''
            && hash_equals($identity, $currentIdentity);
    }

    /** @return array<string, int> */
    private static function normalizeRateLimitIdentityMap($stored): array
    {
        if (!is_array($stored)) {
            return [];
        }

        $now = time();
        $active = [];
        foreach ($stored as $identity => $retryAt) {
            if (
                is_string($identity)
                && preg_match('/^[a-f0-9]{64}$/D', $identity) === 1
                && (int) $retryAt > $now
            ) {
                $active[$identity] = min(
                    (int) $retryAt,
                    $now + self::MAX_RATE_LIMIT_BACKOFF
                );
            }
        }

        return $active;
    }

    /** @param mixed $expectedRaw @param array<string, int> $next */
    private static function compareAndStoreRateLimitOption($expectedRaw, array $next): bool
    {
        global $wpdb;

        if (
            !isset($wpdb)
            || !is_object($wpdb)
            || !isset($wpdb->options)
            || !method_exists($wpdb, 'update')
        ) {
            if (get_option(self::RATE_LIMIT_OPTION, false) !== $expectedRaw) {
                return false;
            }

            if ($expectedRaw === false && function_exists('add_option')) {
                return (bool) add_option(self::RATE_LIMIT_OPTION, $next, '', false);
            }

            update_option(self::RATE_LIMIT_OPTION, $next, false);
            return true;
        }

        if ($expectedRaw === false) {
            return (bool) add_option(self::RATE_LIMIT_OPTION, $next, '', false);
        }

        $expectedStored = function_exists('maybe_serialize')
            ? maybe_serialize($expectedRaw)
            : (is_array($expectedRaw) || is_object($expectedRaw)
                ? serialize($expectedRaw)
                : (string) $expectedRaw);
        $nextStored = function_exists('maybe_serialize')
            ? maybe_serialize($next)
            : serialize($next);

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- CAS prevents concurrent 429 marker lost updates.
        $changed = $wpdb->update(
            $wpdb->options,
            ['option_value' => $nextStored],
            [
                'option_name' => self::RATE_LIMIT_OPTION,
                'option_value' => $expectedStored,
            ],
            ['%s'],
            ['%s', '%s']
        );

        if ((int) $changed !== 1) {
            return false;
        }

        self::clearRateLimitOptionCache();
        return true;
    }

    private static function clearRateLimitOptionCache(): void
    {
        if (!function_exists('wp_cache_delete')) {
            return;
        }

        wp_cache_delete(self::RATE_LIMIT_OPTION, 'options');
        wp_cache_delete('alloptions', 'options');
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

    /** Builds the shared one-way API-key/backend identity without persisting raw config. */
    public static function configurationIdentityFor(string $apiKey, string $baseUrl): string
    {
        return self::configurationIdentity($apiKey, $baseUrl);
    }

    /** Builds the shared identity from one atomic Options snapshot. */
    public static function configurationIdentityForOptions(Options $options): string
    {
        $settings = $options->all();

        return self::configurationIdentity(
            (string) ($settings['api_key'] ?? ''),
            (string) ($settings['api_base_url'] ?? '')
        );
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
