<?php

namespace Deepglot\Frontend;

use Deepglot\Api\Client;
use Deepglot\Api\RestApi;
use Deepglot\Config\Options;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\TranslationRules;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Same-origin REST proxy that powers the client-side dynamic-content
 * translator (assets/js/dynamic-translator.js).
 *
 * The browser must never hold the Deepglot API key, so the JS layer posts the
 * strings it discovers to this WordPress endpoint, which translates them with
 * the existing {@see Client} + {@see TranslationCache} (so usage accounting and
 * caching behave exactly like the server-side pass) and returns the same
 * `{from_words, to_words}` contract the SaaS `/api/translate` endpoint uses.
 *
 * Abuse controls (a public page is a public endpoint):
 *  • permission: same-origin Referer + bot user-agent are rejected up front;
 *  • per-IP transient rate limit;
 *  • cache-first — a missing/stale nonce degrades to cache-only, so no project
 *    quota can ever be spent without a valid same-origin nonce. This keeps the
 *    layer working on full-page-cached sites (cache hits still serve) while
 *    blocking quota abuse.
 */
class DynamicTranslationController
{
    public const ROUTE = '/translate-dynamic';

    /** Max strings accepted per request (mirrors HtmlTranslator::BATCH_SIZE). */
    private const MAX_TEXTS = 200;

    /** Strings longer than this are dropped — UI copy is never this long. */
    private const MAX_TEXT_LENGTH = 5000;

    /** Per-IP rate limit: requests allowed per window. */
    private const RATE_LIMIT = 60;

    /** Rate-limit window in seconds. */
    private const RATE_WINDOW = 60;

    private Options $options;
    private Client $client;
    private TranslationCache $cache;

    public function __construct(Options $options, Client $client, TranslationCache $cache)
    {
        $this->options = $options;
        $this->client  = $client;
        $this->cache   = $cache;
    }

    public function register(): void
    {
        add_action('rest_api_init', [$this, 'registerRoutes']);
    }

    public function registerRoutes(): void
    {
        register_rest_route(RestApi::NAMESPACE, self::ROUTE, [
            'methods'             => 'POST',
            'callback'            => [$this, 'handle'],
            'permission_callback' => [$this, 'permissionCheck'],
            'args'                => [
                'texts' => [
                    'required' => true,
                    'type'     => 'array',
                    'items'    => ['type' => 'string'],
                ],
                'lang_to' => [
                    'required'          => true,
                    'type'              => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                ],
            ],
        ]);
    }

    // -------------------------------------------------------------------------
    // Request handling
    // -------------------------------------------------------------------------

    public function handle(WP_REST_Request $request): WP_REST_Response
    {
        if (!$this->withinRateLimit()) {
            return new WP_REST_Response([
                'code'    => 'rate_limited',
                'message' => __('Zu viele Anfragen.', 'deepglot'),
            ], 429);
        }

        $texts  = (array) $request->get_param('texts');
        $langTo = (string) $request->get_param('lang_to');

        // A valid same-origin REST nonce plus same-origin request provenance is
        // what unlocks the (quota-spending) API path. Without both we still
        // answer from cache, so hard-cached anonymous pages keep working
        // without ever burning quota.
        $nonceValid = (bool) wp_verify_nonce((string) $request->get_header('X-WP-Nonce'), 'wp_rest');
        $allowApi   = $nonceValid && $this->hasSameOriginProvenance($request);

        $result = $this->translateTexts($texts, $langTo, $allowApi);

        return new WP_REST_Response($result, 200);
    }

    /**
     * Core translation logic, free of WordPress request plumbing so it can be
     * unit-tested directly.
     *
     * @param  array<int, mixed> $texts
     * @param  bool              $allowApi  When false (no valid nonce) only
     *                                      cached translations are returned.
     * @return array{from_words: string[], to_words: string[], quota_exhausted?: bool}
     */
    public function translateTexts(array $texts, string $langTo, bool $allowApi): array
    {
        $empty = ['from_words' => [], 'to_words' => []];

        if (!$this->options->isEnabled()
            || !$this->options->isConfigured()
            || !$this->options->shouldTranslateDynamicContent()
        ) {
            return $empty;
        }

        $langFrom = $this->options->getSourceLanguage();
        $langTo   = strtolower(trim($langTo));

        if ($langTo === '' || $langTo === $langFrom) {
            return $empty;
        }

        if (!in_array($langTo, $this->options->getTargetLanguages(), true)) {
            return $empty;
        }

        $texts = $this->normalizeTexts($texts);

        if (empty($texts)) {
            return $empty;
        }

        $cached  = $this->cache->getMany($texts, $langFrom, $langTo);
        $missing = array_values(array_filter($texts, static fn(string $t) => !isset($cached[$t])));

        $fresh = [];
        $quotaExhausted = false;

        if ($allowApi && !empty($missing)) {
            $response = $this->client->translate($missing, $langFrom, $langTo);

            if (is_wp_error($response)) {
                $errorData = $response->get_error_data();
                if (is_array($errorData) && (int) ($errorData['status'] ?? 0) === 402) {
                    // Monthly word quota exhausted (issue #148): flag it so the
                    // browser client stops retrying for this session. Cached
                    // translations below still serve.
                    $quotaExhausted = true;
                }
            } elseif (
                is_array($response)
                && isset($response['from_words'], $response['to_words'])
                && is_array($response['from_words'])
                && is_array($response['to_words'])
            ) {
                foreach ($response['from_words'] as $index => $original) {
                    if (isset($response['to_words'][$index]) && is_string($original)) {
                        $fresh[$original] = (string) $response['to_words'][$index];
                    }
                }
            }

            if (!empty($fresh)) {
                $this->cache->setMany($fresh, $langFrom, $langTo);
            }
        }

        $all = $cached + $fresh;

        $fromWords = [];
        $toWords   = [];

        foreach ($texts as $text) {
            if (isset($all[$text])) {
                $fromWords[] = $text;
                $toWords[]   = $all[$text];
            }
        }

        $result = ['from_words' => $fromWords, 'to_words' => $toWords];

        if ($quotaExhausted) {
            $result['quota_exhausted'] = true;
        }

        return $result;
    }

    // -------------------------------------------------------------------------
    // Permission + rate limiting
    // -------------------------------------------------------------------------

    /**
     * Public endpoint, but only for same-origin human traffic: cross-origin
     * Referer and bot user-agents are rejected before any work happens. Bots
     * already receive the fully server-translated page and never need this.
     */
    public function permissionCheck(WP_REST_Request $request): bool|WP_Error
    {
        if ($this->isBot((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''))) {
            return new WP_Error('rest_forbidden', __('Nicht verfügbar.', 'deepglot'), ['status' => 403]);
        }

        $referer = (string) $request->get_header('referer');

        if ($referer !== '') {
            $refererHost = wp_parse_url($referer, PHP_URL_HOST);

            if (is_string($refererHost) && !$this->isAllowedHost($refererHost)) {
                return new WP_Error('rest_forbidden', __('Ungültige Herkunft.', 'deepglot'), ['status' => 403]);
            }
        }

        return true;
    }

    /**
     * Same-origin host allow-list. Accepts the host the request actually came
     * in on (so SUBDOMAIN-routed mapped hosts work — there the translated page,
     * and therefore the relative-URL fetch, lives on the mapped host), the
     * canonical site host, and every configured subdomain mapping. A cross-site
     * POST, whose Referer host is none of these, is still rejected.
     */
    private function isAllowedHost(string $host): bool
    {
        $host = strtolower($host);
        $allowed = [];

        if (isset($_SERVER['HTTP_HOST'])) {
            $requestHost = wp_parse_url('http://' . (string) $_SERVER['HTTP_HOST'], PHP_URL_HOST);
            if (is_string($requestHost)) {
                $allowed[] = strtolower($requestHost);
            }
        }

        $homeHost = wp_parse_url(home_url(), PHP_URL_HOST);
        if (is_string($homeHost)) {
            $allowed[] = strtolower($homeHost);
        }

        foreach ($this->options->getDomainMappings() as $mappedHost) {
            if (is_string($mappedHost) && $mappedHost !== '') {
                $allowed[] = strtolower($mappedHost);
            }
        }

        return in_array($host, $allowed, true);
    }

    /**
     * A public page can expose the REST nonce, so the nonce alone must not
     * unlock API-backed cache misses. Require browser provenance from an
     * allowed host before spending quota; missing or foreign provenance falls
     * back to the cache-only path in handle().
     */
    private function hasSameOriginProvenance(WP_REST_Request $request): bool
    {
        foreach (['origin', 'referer'] as $header) {
            $value = trim((string) $request->get_header($header));

            if ($value === '') {
                continue;
            }

            $host = wp_parse_url($value, PHP_URL_HOST);

            if (is_string($host) && $this->isAllowedHost($host)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Sliding-window per-IP rate limiter, mirroring {@see RestApi::checkRateLimit()}
     * but keyed on a hashed client IP since dynamic-content visitors are
     * anonymous (user id 0).
     */
    private function withinRateLimit(): bool
    {
        $ip        = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $transient = 'deepglot_dynrl_' . sha1($ip);
        $now       = time();

        $bucket = get_transient($transient);

        if (!is_array($bucket) || !isset($bucket['reset'], $bucket['count']) || $bucket['reset'] <= $now) {
            $bucket = ['count' => 1, 'reset' => $now + self::RATE_WINDOW];
        } else {
            $bucket['count']++;
        }

        set_transient($transient, $bucket, self::RATE_WINDOW + 5);

        return $bucket['count'] <= self::RATE_LIMIT;
    }

    private function isBot(string $userAgent): bool
    {
        if ($userAgent === '') {
            return false;
        }

        // Mirrors BrowserRedirector::isBotRequest().
        return (bool) preg_match('/bot|crawler|spider|slurp|bingpreview|facebookexternalhit|wget|curl/i', $userAgent);
    }

    /**
     * Filters raw input down to a unique, translation-worthy, length-bounded
     * set of strings, capped at MAX_TEXTS.
     *
     * @param  array<int, mixed> $texts
     * @return string[]
     */
    private function normalizeTexts(array $texts): array
    {
        $clean = [];

        foreach ($texts as $text) {
            if (!is_string($text)) {
                continue;
            }

            if (mb_strlen($text) > self::MAX_TEXT_LENGTH) {
                continue;
            }

            // Gate on the trimmed form (length / numeric-only), but key on the
            // RAW text so the cache key matches the server pass, which caches
            // the untrimmed DOMText value. A dynamic " Hello " then reuses the
            // server's existing entry instead of re-translating a trimmed copy.
            if (!TranslationRules::isTranslatableText(trim($text))) {
                continue;
            }

            $clean[$text] = true;

            if (count($clean) >= self::MAX_TEXTS) {
                break;
            }
        }

        return array_keys($clean);
    }
}
