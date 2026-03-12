<?php

namespace Deepglot\Api;

use Deepglot\Config\Options;
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

    private Options $options;

    public function __construct(Options $options)
    {
        $this->options = $options;
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

        if ($this->options->isConfigured()) {
            [$connected, $connError] = $this->pingBackend(
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

        [$ok, $error] = $this->pingBackend($baseUrl, $apiKey);

        if (!$ok) {
            return new WP_REST_Response(['ok' => false, 'error' => $error], 422);
        }

        return new WP_REST_Response(['ok' => true], 200);
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
            'source_language'    => 'source_language',
            'target_languages'   => 'target_languages',
            'auto_redirect'      => 'auto_redirect',
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
     * @return array{bool, string|null}  [success, error_message]
     */
    private function pingBackend(string $baseUrl, string $apiKey): array
    {
        $url = rtrim($baseUrl, '/') . '/translate?api_key=' . rawurlencode($apiKey);

        $response = wp_remote_post($url, [
            'timeout'     => 8,
            'redirection' => 2,
            'headers'     => ['Content-Type' => 'application/json'],
            'body'        => wp_json_encode([
                'l_from' => 'de',
                'l_to'   => 'en',
                'words'  => [['w' => 'Test', 't' => 1]],
            ]),
        ]);

        if (is_wp_error($response)) {
            return [false, $response->get_error_message()];
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $json = json_decode($body, true);

        if ($code === 200 && isset($json['to_words'])) {
            return [true, null];
        }

        $detail = isset($json['error']) ? $json['error'] : "HTTP {$code}";

        return [false, $detail];
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
                'description'       => 'Backend URL, e.g. https://deepglot-five.vercel.app/api',
            ],
            'source_language' => [
                'type'              => 'string',
                'required'          => $req,
                'sanitize_callback' => 'sanitize_text_field',
                'description'       => 'ISO 639-1 source language code.',
            ],
            'target_languages' => [
                'type'        => 'array',
                'required'    => $req,
                'items'       => ['type' => 'string'],
                'description' => 'Array of ISO 639-1 target language codes.',
            ],
            'auto_redirect' => [
                'type'     => 'boolean',
                'required' => $req,
                'description' => 'Redirect visitors based on browser language.',
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
