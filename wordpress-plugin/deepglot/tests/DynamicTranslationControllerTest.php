<?php

/**
 * Contract test for the dynamic-content REST proxy core (translateTexts).
 *
 * Proves the cost + security invariants that protect project quota on a public
 * endpoint:
 *   • cache hits never call the API;
 *   • without a valid nonce (allowApi=false) the API is never called, but the
 *     cache still serves — so hard-cached anonymous pages keep working;
 *   • target-language validation rejects unconfigured / source-equal langs;
 *   • the request is capped at MAX_TEXTS strings.
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }

    $GLOBALS['_deepglot_options'] = [];

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_options'][$key] ?? $default;
    }

    function update_option($key, $value) {
        $GLOBALS['_deepglot_options'][$key] = $value;
        return true;
    }

    function get_transient($key) {
        return false;
    }

    function set_transient($key, $value, $ttl = 0) {
        return true;
    }

    function wp_verify_nonce($nonce, $action = -1) {
        return $nonce === 'valid-rest-nonce' && $action === 'wp_rest';
    }

    function wp_parse_url($url, $component = -1) {
        return parse_url($url, $component);
    }

    function home_url($path = '/') {
        return 'https://example.test' . ($path === '/' ? '' : $path);
    }

    function is_wp_error($value) {
        return $value instanceof \WP_Error;
    }

    function wp_parse_args($args, $defaults = []) {
        return array_merge($defaults, is_array($args) ? $args : []);
    }

    function sanitize_text_field($value) {
        return trim((string) $value);
    }

    function sanitize_textarea_field($value) {
        return trim((string) $value);
    }

    function esc_url_raw($value) {
        return (string) $value;
    }

    function untrailingslashit($value) {
        return rtrim((string) $value, '/');
    }

    if (!class_exists('WP_Error')) {
        class WP_Error
        {
            public function __construct(
                public string $code = '',
                public string $message = '',
                public array $data = []
            ) {
            }
        }
    }

    if (!class_exists('WP_REST_Request')) {
        class WP_REST_Request
        {
            public function __construct(
                private array $params = [],
                private array $headers = []
            ) {
            }

            public function get_param($key) {
                return $this->params[$key] ?? null;
            }

            public function get_header($key) {
                $key = strtolower((string) $key);
                foreach ($this->headers as $header => $value) {
                    if (strtolower((string) $header) === $key) {
                        return $value;
                    }
                }
                return '';
            }
        }
    }

    if (!class_exists('WP_REST_Response')) {
        class WP_REST_Response
        {
            public function __construct(
                private mixed $data = null,
                private int $status = 200
            ) {
            }

            public function get_data() {
                return $this->data;
            }

            public function get_status(): int {
                return $this->status;
            }
        }
    }

    if (!defined('DAY_IN_SECONDS')) {
        define('DAY_IN_SECONDS', 86400);
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Support/TranslationRules.php';
require_once __DIR__ . '/../includes/Frontend/DynamicTranslationController.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\DynamicTranslationController;
use Deepglot\Support\TranslationCache;

function dynCheck($condition, string $message): void
{
    if ($condition !== true) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

function configureDynamicOptions(array $overrides = []): void
{
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), array_merge([
        'enabled' => true,
        'api_key' => 'dg_live_test',
        'source_language' => 'de',
        'target_languages' => ['en'],
        'enable_dynamic_translation' => true,
    ], $overrides)));
}

class DynamicFakeClient extends Client
{
    public int $callCount = 0;
    public array $lastTexts = [];

    public function __construct()
    {
    }

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '')
    {
        $this->callCount++;
        $this->lastTexts = $texts;

        return [
            'from_words' => array_values($texts),
            'to_words'   => array_map(static fn(string $t) => '[' . $langTo . '] ' . $t, array_values($texts)),
        ];
    }
}

class DynamicFakeCache extends TranslationCache
{
    /** @var array<string, string> */
    public array $hits;
    /** @var array<string, string> */
    public array $saved = [];

    public function __construct(array $hits = [])
    {
        $this->hits = $hits;
    }

    public function getMany(array $texts, string $sourceLang, string $targetLang): array
    {
        $out = [];
        foreach ($texts as $text) {
            if (isset($this->hits[$text])) {
                $out[$text] = $this->hits[$text];
            }
        }
        return $out;
    }

    public function setMany(array $translations, string $sourceLang, string $targetLang): void
    {
        $this->saved = $translations;
    }
}

// 1. Cache hit → no API call, translation returned from cache.
configureDynamicOptions();
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache(['Hallo' => '[en] Hallo']));
$result = $controller->translateTexts(['Hallo'], 'en', true);
dynCheck($client->callCount === 0, 'Cache hit must not call the translation API.');
dynCheck($result['from_words'] === ['Hallo'], 'Cache hit must echo the source word.');
dynCheck($result['to_words'] === ['[en] Hallo'], 'Cache hit must return the cached translation.');

// 2. Miss + valid nonce → API called once, result returned and cached.
$client = new DynamicFakeClient();
$cache = new DynamicFakeCache([]);
$controller = new DynamicTranslationController(new Options(), $client, $cache);
$result = $controller->translateTexts(['Neu'], 'en', true);
dynCheck($client->callCount === 1, 'A cache miss with a valid nonce must call the API once.');
dynCheck($client->lastTexts === ['Neu'], 'Only the missing word should be sent to the API.');
dynCheck($result['to_words'] === ['[en] Neu'], 'API translation must be returned.');
dynCheck($cache->saved === ['Neu' => '[en] Neu'], 'Fresh translations must be written to the cache.');

// 3. Miss + invalid nonce → API never called, empty result (no quota spent).
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$result = $controller->translateTexts(['Neu'], 'en', false);
dynCheck($client->callCount === 0, 'Without a valid nonce the API must never be called.');
dynCheck($result === ['from_words' => [], 'to_words' => []], 'Without a nonce a cache miss returns nothing.');

// 4. Invalid nonce but cache hit → served from cache, still no API call.
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache(['Hallo' => '[en] Hallo']));
$result = $controller->translateTexts(['Hallo'], 'en', false);
dynCheck($client->callCount === 0, 'Cache-only path must not call the API.');
dynCheck($result['to_words'] === ['[en] Hallo'], 'Hard-cached pages must still serve cached translations without a nonce.');

// 5. Same-origin valid nonce requests can still translate cache misses.
configureDynamicOptions();
$_SERVER['REMOTE_ADDR'] = '198.51.100.22';
$_SERVER['HTTP_HOST'] = 'example.test';
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$response = $controller->handle(new WP_REST_Request([
    'texts' => ['Same-origin miss'],
    'lang_to' => 'en',
], [
    'Origin' => 'https://example.test',
    'X-WP-Nonce' => 'valid-rest-nonce',
]));
dynCheck($client->callCount === 1, 'Same-origin valid nonce requests must call the API for cache misses.');
dynCheck($response->get_data()['to_words'] === ['[en] Same-origin miss'], 'Same-origin API translation must be returned.');

// 6. A scraped nonce without Origin/Referer must not unlock API translations.
configureDynamicOptions();
$_SERVER['REMOTE_ADDR'] = '198.51.100.23';
unset($_SERVER['HTTP_HOST']);
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$response = $controller->handle(new WP_REST_Request([
    'texts' => ['Remote miss'],
    'lang_to' => 'en',
], [
    'X-WP-Nonce' => 'valid-rest-nonce',
]));
dynCheck($client->callCount === 0, 'A valid nonce without Origin/Referer must not call the API.');
dynCheck($response->get_data() === ['from_words' => [], 'to_words' => []], 'Missing Origin/Referer degrades cache misses to empty results.');

// 7. Same-origin cache-only requests still serve cached translations.
$_SERVER['HTTP_HOST'] = 'example.test';
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache(['Hallo' => '[en] Hallo']));
$response = $controller->handle(new WP_REST_Request([
    'texts' => ['Hallo'],
    'lang_to' => 'en',
], [
    'Referer' => 'https://example.test/de/',
]));
dynCheck($client->callCount === 0, 'Same-origin cache-only request must not call the API.');
dynCheck($response->get_data()['to_words'] === ['[en] Hallo'], 'Same-origin cache-only request must serve cached translations.');

// 8. Target language not configured → rejected, no API call.
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$result = $controller->translateTexts(['Hallo'], 'fr', true);
dynCheck($client->callCount === 0, 'An unconfigured target language must be rejected before any API call.');
dynCheck($result === ['from_words' => [], 'to_words' => []], 'Unconfigured target language returns nothing.');

// 9. Target language equals source → rejected.
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$result = $controller->translateTexts(['Hallo'], 'de', true);
dynCheck($client->callCount === 0, 'Translating into the source language must be a no-op.');

// 10. Feature disabled → no-op even with a valid nonce.
configureDynamicOptions(['enable_dynamic_translation' => false]);
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache(['Hallo' => '[en] Hallo']));
$result = $controller->translateTexts(['Hallo'], 'en', true);
dynCheck($client->callCount === 0, 'Disabled feature must not translate.');
dynCheck($result === ['from_words' => [], 'to_words' => []], 'Disabled feature returns nothing.');

// 11. Oversized request is capped at MAX_TEXTS (200) before hitting the API.
configureDynamicOptions();
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$texts = [];
for ($i = 0; $i < 250; $i++) {
    $texts[] = 'Wort-' . $i;
}
$result = $controller->translateTexts($texts, 'en', true);
dynCheck($client->callCount === 1, 'Oversized request still results in a single API call.');
dynCheck(count($client->lastTexts) === 200, 'Request must be capped at 200 strings, got ' . count($client->lastTexts) . '.');

fwrite(STDOUT, "DynamicTranslationControllerTest: OK\n");
