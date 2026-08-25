<?php

namespace Deepglot\Api;

use Deepglot\Config\Options;
use Deepglot\Support\UrlTranslationSync;
use Deepglot\Sync\SettingsSync;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Deepglot REST API (namespace: deepglot/v1)
 *
 * Endpoints
 * ---------
 * GET  /wp-json/deepglot/v1/settings          – Read all settings
 * PUT  /wp-json/deepglot/v1/settings          – Replace all settings
 * PATCH /wp-json/deepglot/v1/settings         – Partial update
 * GET  /wp-json/deepglot/v1/status            – Plugin status + connection health
 * POST /wp-json/deepglot/v1/test-connection   – Verify API key against backend
 * GET/POST/DELETE /wp-json/deepglot/v1/url-sync – Control bounded URL sync
 * POST /wp-json/deepglot/v1/url-sync/preview – Preview the immutable URL snapshot
 *
 * Security
 * --------
 * • Every endpoint requires `manage_options` capability.
 * • WordPress Application Passwords are supported out-of-the-box via Basic Auth.
 * • A transient-based rate limiter (60 req / min per user) prevents abuse.
 *
 * Authentication example (curl):
 *   curl -u "Redaktion:N8gb 3NYA dfWe qKug ekFN wZuQ" \
 *        https://www.jobspot.at/wp-json/deepglot/v1/status
 */
class RestApi
{
    public const NAMESPACE = 'deepglot/v1';

    /** Maximum requests per user per window. */
    private const RATE_LIMIT     = 60;
    /** Rate-limit window in seconds. */
    private const RATE_WINDOW    = 60;

    /** Project-wide mirrors owned by the authenticated Deepglot project. */
    private const SAAS_MANAGED_SETTINGS = [
        'source_language',
        'target_languages',
        'auto_redirect',
    ];

    private Options $options;
    private SettingsSync $settingsSync;
    private ?UrlTranslationSync $urlSync;

    public function __construct(
        Options $options,
        SettingsSync $settingsSync,
        ?UrlTranslationSync $urlSync = null
    )
    {
        $this->options = $options;
        $this->settingsSync = $settingsSync;
        $this->urlSync = $urlSync;
    }

    public function register(): void
    {
        add_action('rest_api_init', [$this, 'registerRoutes']);
    }

    // -------------------------------------------------------------------------
    // Route registration
    // -------------------------------------------------------------------------

    public function registerRoutes(): void
    {
        // GET / PUT / PATCH  /deepglot/v1/settings
        register_rest_route(self::NAMESPACE, '/settings', [
            [
                'methods'             => 'GET',
                'callback'            => [$this, 'getSettings'],
                'permission_callback' => [$this, 'checkPermission'],
            ],
            [
                'methods'             => 'PUT',
                'callback'            => [$this, 'putSettings'],
                'permission_callback' => [$this, 'checkPermission'],
                'args'                => $this->settingsSchema(),
            ],
            [
                'methods'             => 'PATCH',
                'callback'            => [$this, 'patchSettings'],
                'permission_callback' => [$this, 'checkPermission'],
                'args'                => $this->settingsSchema(required: false),
            ],
        ]);

        // GET  /deepglot/v1/status
        register_rest_route(self::NAMESPACE, '/status', [
            'methods'             => 'GET',
            'callback'            => [$this, 'getStatus'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);

        // POST /deepglot/v1/test-connection
        register_rest_route(self::NAMESPACE, '/test-connection', [
            'methods'             => 'POST',
            'callback'            => [$this, 'testConnection'],
            'permission_callback' => [$this, 'checkPermission'],
            'args'                => [
                'api_key' => [
                    'required'          => false,
                    'type'              => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                    'description'       => 'API key to test (defaults to the stored key).',
                ],
                'api_base_url' => [
                    'required'          => false,
                    'type'              => 'string',
                    'sanitize_callback' => 'esc_url_raw',
                    'description'       => 'Backend URL to test against (defaults to stored URL).',
                ],
            ],
        ]);

        register_rest_route(self::NAMESPACE, '/url-sync', [
            [
                'methods'             => 'GET',
                'callback'            => [$this, 'getUrlSync'],
                'permission_callback' => [$this, 'checkPermission'],
            ],
            [
                'methods'             => 'POST',
                'callback'            => [$this, 'startUrlSync'],
                'permission_callback' => [$this, 'checkPermission'],
                'args'                => [
                    'target_languages' => [
                        'required' => true,
                        'type' => 'array',
                        'items' => ['type' => 'string'],
                    ],
                    'max_urls' => [
                        'required' => false,
                        'type' => 'integer',
                        'minimum' => 1,
                        'maximum' => UrlTranslationSync::MAX_URLS,
                    ],
                    'preview_token' => [
                        'required' => true,
                        'type' => 'string',
                        'sanitize_callback' => 'sanitize_text_field',
                    ],
                    'source_offset' => [
                        'required' => false,
                        'type' => 'integer',
                        'minimum' => 0,
                        'maximum' => UrlTranslationSync::MAX_SOURCE_OFFSET,
                    ],
                ],
            ],
            [
                'methods'             => 'DELETE',
                'callback'            => [$this, 'cancelUrlSync'],
                'permission_callback' => [$this, 'checkPermission'],
            ],
        ]);

        register_rest_route(self::NAMESPACE, '/url-sync/preview', [
            'methods'             => 'POST',
            'callback'            => [$this, 'previewUrlSync'],
            'permission_callback' => [$this, 'checkPermission'],
            'args'                => [
                'target_languages' => [
                    'required' => true,
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
                'max_urls' => [
                    'required' => false,
                    'type' => 'integer',
                    'minimum' => 1,
                    'maximum' => UrlTranslationSync::MAX_URLS,
                ],
                'source_offset' => [
                    'required' => false,
                    'type' => 'integer',
                    'minimum' => 0,
                    'maximum' => UrlTranslationSync::MAX_SOURCE_OFFSET,
                ],
            ],
        ]);

        foreach (['pause', 'resume'] as $action) {
            register_rest_route(self::NAMESPACE, '/url-sync/' . $action, [
                'methods'             => 'POST',
                'callback'            => $action === 'pause'
                    ? [$this, 'pauseUrlSync']
                    : [$this, 'resumeUrlSync'],
                'permission_callback' => [$this, 'checkPermission'],
            ]);
        }

        register_rest_route(self::NAMESPACE, '/url-sync/retry-failed', [
            'methods'             => 'POST',
            'callback'            => [$this, 'retryFailedUrlSync'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);
    }

    // -------------------------------------------------------------------------
    // Handlers
    // -------------------------------------------------------------------------

    /** GET /settings – returns all current settings (api_key masked). */
    public function getSettings(WP_REST_Request $request): WP_REST_Response
    {
        $rateLimitError = $this->checkRateLimit($request);
        if (is_wp_error($rateLimitError)) {
            return $this->errorResponse($rateLimitError);
        }

        return new WP_REST_Response($this->publicSettings(), 200);
    }

    /** PUT /settings – replaces all settings. */
    public function putSettings(WP_REST_Request $request): WP_REST_Response
    {
        $rateLimitError = $this->checkRateLimit($request);
        if (is_wp_error($rateLimitError)) {
            return $this->errorResponse($rateLimitError);
        }

        $managedSettingsError = $this->saasManagedSettingsWriteError($request);
        if ($managedSettingsError !== null) {
            return $this->errorResponse($managedSettingsError);
        }

        $current = $this->options->all();
        $merged  = $this->mergeInput($request, $current, replace: true);
        $this->saveSettings($merged);

        return new WP_REST_Response($this->publicSettings(), 200);
    }

    /** PATCH /settings – partial update, only sent fields are changed. */
    public function patchSettings(WP_REST_Request $request): WP_REST_Response
    {
        $rateLimitError = $this->checkRateLimit($request);
        if (is_wp_error($rateLimitError)) {
            return $this->errorResponse($rateLimitError);
        }

        $managedSettingsError = $this->saasManagedSettingsWriteError($request);
        if ($managedSettingsError !== null) {
            return $this->errorResponse($managedSettingsError);
        }

        $current = $this->options->all();
        $merged  = $this->mergeInput($request, $current, replace: false);
        $this->saveSettings($merged);

        return new WP_REST_Response($this->publicSettings(), 200);
    }

    /** GET /status – plugin state, config check, and live connection health. */
    public function getStatus(WP_REST_Request $request): WP_REST_Response
    {
        $rateLimitError = $this->checkRateLimit($request);
        if (is_wp_error($rateLimitError)) {
            return $this->errorResponse($rateLimitError);
        }

        $settings  = $this->options->all();
        $connected = false;
        $connError = null;
        $connCode  = null;

        if ($this->options->isConfigured()) {
            [$connected, $connError, $connCode] = $this->pingBackend(
                $settings['api_base_url'],
                $settings['api_key']
            );
        }

        return new WP_REST_Response([
            'plugin_version'  => defined('DEEPGLOT_PLUGIN_VERSION') ? DEEPGLOT_PLUGIN_VERSION : 'unknown',
            'enabled'         => $this->options->isEnabled(),
            'configured'      => $this->options->isConfigured(),
            'connected'       => $connected,
            'connection_error'=> $connError,
            'connection_code' => $connCode,
            // True when the quota is exhausted, from EITHER signal: the active
            // ping above (connCode, which trips even a near-empty quota since
            // the ping now sends several words) OR a recent real translation
            // that hit 402 and set this transient (catches partial exhaustion
            // where the small ping still fits but larger pages no longer do).
            'quota_exhausted' => $connCode === 'quota_exhausted'
                                    || (bool) get_transient('deepglot_quota_exhausted'),
            // True when the configured key is rejected outright (HTTP 401),
            // from EITHER the ping above OR the circuit breaker a recent real
            // translation armed. Unlike an exhausted quota this means nothing
            // is being translated at all (#245).
            'api_key_invalid' => $connCode === 'invalid_api_key'
                                    || Client::hasInvalidApiKeyMarkerFor($this->options),
            'source_language' => $settings['source_language'],
            'target_languages'=> $settings['target_languages'],
            'api_key_prefix'  => !empty($settings['api_key'])
                                    ? substr($settings['api_key'], 0, 16) . '…'
                                    : null,
        ], 200);
    }

    /** POST /test-connection – tests an API key without saving it. */
    public function testConnection(WP_REST_Request $request): WP_REST_Response
    {
        $rateLimitError = $this->checkRateLimit($request);
        if (is_wp_error($rateLimitError)) {
            return $this->errorResponse($rateLimitError);
        }

        $settings = $this->options->all();
        $apiKey   = $request->get_param('api_key')      ?? $settings['api_key'];
        $baseUrl  = $request->get_param('api_base_url') ?? $settings['api_base_url'];

        if (empty($apiKey)) {
            return $this->errorResponse(
                new WP_Error('missing_api_key', __('Kein API-Key angegeben.', 'deepglot'), ['status' => 400])
            );
        }

        [$ok, $error, $code] = $this->pingBackend($baseUrl, $apiKey);

        if (!$ok) {
            $data = ['ok' => false, 'error' => $error];

            if ($code !== null) {
                $data['code'] = $code;
            }

            return new WP_REST_Response($data, 422);
        }

        $candidateSettings = $this->options->sanitize(array_merge($settings, [
            'api_key' => $apiKey,
            'api_base_url' => $baseUrl,
        ]));
        $syncResult = $this->settingsSync->sync($candidateSettings, $apiKey, $baseUrl);

        if (is_wp_error($syncResult)) {
            return new WP_REST_Response([
                'ok' => false,
                'error' => $syncResult->get_error_message(),
            ], 502);
        }

        return new WP_REST_Response(['ok' => true, 'synced' => true], 200);
    }

    public function getUrlSync(WP_REST_Request $request): WP_REST_Response
    {
        if (($error = $this->urlSyncRequestError($request)) !== null) {
            return $error;
        }

        return new WP_REST_Response($this->urlSync->status(), 200);
    }

    public function startUrlSync(WP_REST_Request $request): WP_REST_Response
    {
        if (($error = $this->urlSyncRequestError($request)) !== null) {
            return $error;
        }

        $languages = $request->get_param('target_languages');
        $limit = $request->get_param('max_urls');
        $previewToken = $request->get_param('preview_token');
        $sourceOffset = $request->get_param('source_offset');
        $result = $this->urlSync->start(
            is_array($languages) ? $languages : [],
            is_numeric($limit) ? (int) $limit : UrlTranslationSync::MAX_URLS,
            is_scalar($previewToken) ? (string) $previewToken : '',
            is_numeric($sourceOffset) ? (int) $sourceOffset : 0
        );

        return is_wp_error($result)
            ? $this->errorResponse($result)
            : new WP_REST_Response($result, 202);
    }

    public function previewUrlSync(WP_REST_Request $request): WP_REST_Response
    {
        if (($error = $this->urlSyncRequestError($request)) !== null) {
            return $error;
        }

        $languages = $request->get_param('target_languages');
        $limit = $request->get_param('max_urls');
        $sourceOffset = $request->get_param('source_offset');
        $result = $this->urlSync->preview(
            is_array($languages) ? $languages : [],
            is_numeric($limit) ? (int) $limit : UrlTranslationSync::MAX_URLS,
            is_numeric($sourceOffset) ? (int) $sourceOffset : 0
        );

        return is_wp_error($result)
            ? $this->errorResponse($result)
            : new WP_REST_Response($result, 200);
    }

    public function pauseUrlSync(WP_REST_Request $request): WP_REST_Response
    {
        return $this->controlUrlSync($request, 'pause');
    }

    public function resumeUrlSync(WP_REST_Request $request): WP_REST_Response
    {
        return $this->controlUrlSync($request, 'resume');
    }

    public function cancelUrlSync(WP_REST_Request $request): WP_REST_Response
    {
        return $this->controlUrlSync($request, 'cancel');
    }

    public function retryFailedUrlSync(WP_REST_Request $request): WP_REST_Response
    {
        return $this->controlUrlSync($request, 'retryFailed');
    }

    private function controlUrlSync(WP_REST_Request $request, string $action): WP_REST_Response
    {
        if (($error = $this->urlSyncRequestError($request)) !== null) {
            return $error;
        }

        $changed = $this->urlSync->{$action}();

        return new WP_REST_Response([
            'ok' => $changed,
            'job' => $this->urlSync->status(),
        ], $changed ? 200 : 409);
    }

    private function urlSyncRequestError(WP_REST_Request $request): ?WP_REST_Response
    {
        $rateLimitError = $this->checkRateLimit($request);
        if (is_wp_error($rateLimitError)) {
            return $this->errorResponse($rateLimitError);
        }

        if ($this->urlSync === null) {
            return new WP_REST_Response([
                'code' => 'deepglot_url_sync_unavailable',
                'message' => __('URL-Synchronisierung ist nicht verfügbar.', 'deepglot'),
            ], 501);
        }

        return null;
    }

    // -------------------------------------------------------------------------
    // Permission + rate limiting
    // -------------------------------------------------------------------------

    /**
     * Requires the current user to have the `manage_options` capability.
     * Works with both cookie auth (nonce) and Application Passwords (Basic Auth).
     */
    public function checkPermission(WP_REST_Request $request): bool|WP_Error
    {
        if (!current_user_can('manage_options')) {
            return new WP_Error(
                'rest_forbidden',
                __('Du benötigst Administrator-Rechte für diese Aktion.', 'deepglot'),
                ['status' => 403]
            );
        }

        return true;
    }

    /**
     * Transient-based sliding-window rate limiter.
     *
     * Key: deepglot_rl_{user_id}  →  ['count' => int, 'reset' => int (timestamp)]
     * Limits each authenticated user to RATE_LIMIT requests per RATE_WINDOW seconds.
     *
     * @return null|WP_Error  null on success, WP_Error when limit exceeded.
     */
    private function checkRateLimit(WP_REST_Request $request): ?WP_Error
    {
        $userId     = get_current_user_id();
        $transient  = 'deepglot_rl_' . $userId;
        $now        = time();

        $bucket = get_transient($transient);

        if (!is_array($bucket) || $bucket['reset'] <= $now) {
            // Start a fresh window.
            $bucket = ['count' => 1, 'reset' => $now + self::RATE_WINDOW];
        } else {
            $bucket['count']++;
        }

        set_transient($transient, $bucket, self::RATE_WINDOW + 5);

        if ($bucket['count'] > self::RATE_LIMIT) {
            $retryAfter = max(1, $bucket['reset'] - $now);
            return new WP_Error(
                'rate_limited',
                sprintf(
                    /* translators: %d: seconds until reset */
                    __('Zu viele Anfragen. Bitte warte %d Sekunden.', 'deepglot'),
                    $retryAfter
                ),
                ['status' => 429, 'retry_after' => $retryAfter]
            );
        }

        return null;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Merges REST request params into the current settings array.
     *
     * @param  bool  $replace  true = PUT (replace all), false = PATCH (partial).
     */
    private function mergeInput(WP_REST_Request $request, array $current, bool $replace): array
    {
        $params = $request->get_json_params() ?? [];

        if ($replace) {
            // PUT: start from defaults, overlay current, then overlay input.
            $base = wp_parse_args($current, Options::defaults());
        } else {
            // PATCH: keep current, overlay only sent params.
            $base = $current;
        }

        // Map REST keys → options keys.
        $map = [
            'enabled'            => 'enabled',
            'api_key'            => 'api_key',
            'api_base_url'       => 'api_base_url',
            'routing_mode'       => 'routing_mode',
            'domain_mappings'    => 'domain_mappings',
            'translate_emails'   => 'translate_emails',
            'translate_search'   => 'translate_search',
            'translate_amp'      => 'translate_amp',
            'enable_dynamic_translation' => 'enable_dynamic_translation',
            'exclude_urls'       => 'exclude_urls',
            'exclude_selectors'  => 'exclude_selectors',
        ];

        foreach ($map as $restKey => $optKey) {
            if (array_key_exists($restKey, $params)) {
                $base[$optKey] = $params[$restKey];
            }
        }

        // Run through the sanitizer for consistency.
        return $this->options->sanitize($base);
    }

    private function saasManagedSettingsWriteError(WP_REST_Request $request): ?WP_Error
    {
        $params = $request->get_params();
        if (!is_array($params)) {
            return null;
        }

        $requestedFields = array_values(array_filter(
            self::SAAS_MANAGED_SETTINGS,
            static fn(string $field): bool => array_key_exists($field, $params)
        ));
        if ($requestedFields === []) {
            return null;
        }

        return new WP_Error(
            'deepglot_saas_managed_settings',
            __(
                'Originalsprache, Zielsprachen und Auto-Weiterleitung werden im Deepglot-Dashboard verwaltet und können über die WordPress-REST-API nur gelesen werden.',
                'deepglot'
            ),
            [
                'status' => 409,
                'fields' => $requestedFields,
            ]
        );
    }

    private function saveSettings(array $settings): void
    {
        update_option(Options::OPTION_KEY, $settings);
    }

    /**
     * Returns the settings array with the full api_key masked for security.
     */
    private function publicSettings(): array
    {
        $settings = $this->options->all();

        if (!empty($settings['api_key'])) {
            $settings['api_key'] = substr($settings['api_key'], 0, 16) . str_repeat('•', 8);
        }

        return $settings;
    }

    /**
     * Performs a lightweight liveness check against the Deepglot backend.
     * Sends a minimal translate request and expects a valid JSON response.
     *
     * @return array{bool, string|null, string|null}  [success, error_message, error_code]
     */
    private function pingBackend(string $baseUrl, string $apiKey): array
    {
        $url = rtrim($baseUrl, '/') . '/translate?api_key=' . rawurlencode($apiKey);

        $response = wp_remote_post($url, [
            'timeout'     => 8,
            'redirection' => 2,
            'headers'     => ['Content-Type' => 'application/json'],
            'body'        => wp_json_encode([
                'l_from'      => 'de',
                'l_to'        => 'en',
                'quota_probe' => true,
                'words'       => [['w' => 'Verbindung jetzt testen', 't' => 1]],
            ]),
        ]);

        if (is_wp_error($response)) {
            return [false, $response->get_error_message(), null];
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $json = json_decode($body, true);

        if ($code === 200 && isset($json['to_words'])) {
            Client::clearInvalidApiKeyMarkerForConfiguration(
                $this->options,
                $apiKey,
                $baseUrl
            );

            return [true, null, null];
        }

        if ($code === 402) {
            return [
                false,
                __('Monatliches Wortlimit ausgeschöpft.', 'deepglot'),
                'quota_exhausted',
            ];
        }

        if ($code === 401) {
            return [
                false,
                __('API-Key ungültig oder widerrufen.', 'deepglot'),
                'invalid_api_key',
            ];
        }

        $detail = isset($json['detail']) && is_string($json['detail']) && trim($json['detail']) !== ''
            ? $json['detail']
            : (isset($json['error']) ? $json['error'] : "HTTP {$code}");

        return [false, $detail, null];
    }

    /**
     * JSON schema for settings fields (used for REST arg validation).
     *
     * @param  bool  $required  Whether all fields are required (true = PUT, false = PATCH).
     */
    private function settingsSchema(bool $required = true): array
    {
        $req = $required;

        return [
            'enabled' => [
                'type'     => 'boolean',
                'required' => $req,
                'description' => 'Enable or disable the translation pipeline.',
            ],
            'api_key' => [
                'type'              => 'string',
                'required'          => $req,
                'sanitize_callback' => 'sanitize_text_field',
                'description'       => 'Deepglot project API key (dg_live_…).',
            ],
            'api_base_url' => [
                'type'              => 'string',
                'required'          => $req,
                'sanitize_callback' => 'esc_url_raw',
                'description'       => 'Backend URL, e.g. https://deepglot.ai/api',
            ],
            'routing_mode' => [
                'type'     => 'string',
                'required' => false,
                'description' => 'Routing mode: PATH_PREFIX or SUBDOMAIN.',
            ],
            'domain_mappings' => [
                'type'     => 'object',
                'required' => false,
                'description' => 'Language to host map for subdomain routing.',
            ],
            'translate_emails' => [
                'type'     => 'boolean',
                'required' => false,
                'description' => 'Translate WooCommerce and wp_mail emails.',
            ],
            'translate_search' => [
                'type'     => 'boolean',
                'required' => false,
                'description' => 'Translate search behavior.',
            ],
            'translate_amp' => [
                'type'     => 'boolean',
                'required' => false,
                'description' => 'Translate AMP pages.',
            ],
            'enable_dynamic_translation' => [
                'type'     => 'boolean',
                'required' => false,
                'description' => 'Translate content added client-side after load (AJAX, SPA).',
            ],
            'exclude_urls' => [
                'type'              => 'string',
                'required'          => $req,
                'sanitize_callback' => 'sanitize_textarea_field',
                'description'       => 'Newline-separated URL patterns to exclude.',
            ],
            'exclude_selectors' => [
                'type'              => 'string',
                'required'          => $req,
                'sanitize_callback' => 'sanitize_textarea_field',
                'description'       => 'Newline-separated CSS selectors to exclude.',
            ],
        ];
    }

    private function errorResponse(WP_Error $error): WP_REST_Response
    {
        $data   = $error->get_error_data() ?? [];
        $status = is_array($data) && isset($data['status']) ? (int) $data['status'] : 500;

        return new WP_REST_Response(
            ['code' => $error->get_error_code(), 'message' => $error->get_error_message(), 'data' => $data],
            $status
        );
    }
}
