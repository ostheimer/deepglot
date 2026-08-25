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
        return $GLOBALS['_deepglot_transients'][$key] ?? false;
    }

    function set_transient($key, $value, $ttl = 0) {
        $GLOBALS['_deepglot_transients'][$key] = $value;
        return true;
    }

    if (!function_exists('random_bytes')) {
        function random_bytes($length) {
            return str_repeat('a', $length);
        }
    }

    function wp_verify_nonce($nonce, $action = -1) {
        return $nonce === 'valid-rest-nonce' && $action === 'wp_rest';
    }

    if (!function_exists('wp_parse_url')) {
        function wp_parse_url($url, $component = -1) {
            return parse_url($url, $component);
        }
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

            public function get_error_data()
            {
                return $this->data;
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
require_once __DIR__ . '/../includes/Support/BotDetector.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/DynamicTranslationController.php';
require_once __DIR__ . '/../includes/Frontend/DynamicUrlLocalizer.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\DynamicTranslationController;
use Deepglot\Frontend\DynamicUrlLocalizer;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\UrlLanguageResolver;

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
    public int $lastBot = 0;

    public function __construct()
    {
    }

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0, ?int $timeout = null)
    {
        $this->callCount++;
        $this->lastTexts = $texts;
        $this->lastBot = $bot;

        return [
            'from_words' => array_values($texts),
            'to_words'   => array_map(static fn(string $t) => '[' . $langTo . '] ' . $t, array_values($texts)),
        ];
    }
}

class CacheOnlyDynamicFakeClient extends DynamicFakeClient
{
    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0, ?int $timeout = null)
    {
        $this->callCount++;
        $this->lastTexts = $texts;
        $this->lastBot = $bot;

        return [
            'from_words' => array_values($texts),
            'to_words' => array_map(
                static fn(string $text): string => $text === 'SaaS cache hit'
                    ? 'Real cached translation'
                    : $text,
                array_values($texts)
            ),
            'cache_only' => true,
        ];
    }
}

class FlippingAutomaticTranslationOptions extends Options
{
    private int $automaticTranslationReads = 0;

    public function shouldAutomaticallyTranslate(): bool
    {
        $this->automaticTranslationReads++;

        return $this->automaticTranslationReads > 1;
    }
}

/** Models a backend that has exhausted the monthly word quota (HTTP 402). */
class QuotaExhaustedFakeClient extends Client
{
    public int $callCount = 0;

    public function __construct()
    {
    }

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0, ?int $timeout = null)
    {
        $this->callCount++;

        return new WP_Error('deepglot_api_error', 'Monatliches Wortlimit erreicht', ['status' => 402]);
    }
}

/** Models a transient SaaS failure (HTTP 500) after local budgets were reserved. */
class ServerErrorFakeClient extends Client
{
    public int $callCount = 0;

    public function __construct()
    {
    }

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0, ?int $timeout = null)
    {
        $this->callCount++;

        return new WP_Error('deepglot_api_error', 'Interner Server-Fehler', ['status' => 500]);
    }
}

/** Models a velocity-limited SaaS response with a bounded client backoff. */
class RateLimitedFakeClient extends Client
{
    public int $callCount = 0;

    public function __construct()
    {
    }

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0, ?int $timeout = null)
    {
        $this->callCount++;

        return new WP_Error('deepglot_api_error', 'Translation velocity limited', [
            'status' => 429,
            'retry_after' => 1800,
            'retry_after_source' => 'delta-seconds',
            'retry_after_capped' => false,
        ]);
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

    public function setMany(array $translations, string $sourceLang, string $targetLang): array
    {
        $this->saved = $translations;

        return array_fill_keys(array_keys($translations), true);
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

// 5. Same-origin valid nonce + quota ticket requests can still translate cache misses.
configureDynamicOptions();
$_SERVER['REMOTE_ADDR'] = '198.51.100.22';
$_SERVER['HTTP_HOST'] = 'example.test';
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$quotaTicket = DynamicTranslationController::issueQuotaTicket();
$response = $controller->handle(new WP_REST_Request([
    'texts' => ['Same-origin miss'],
    'lang_to' => 'en',
], [
    'Origin' => 'https://example.test',
    'X-WP-Nonce' => 'valid-rest-nonce',
    DynamicTranslationController::QUOTA_TICKET_HEADER => $quotaTicket,
]));
dynCheck($client->callCount === 1, 'Valid nonce + quota ticket must call the API for cache misses.');
dynCheck($response->get_data()['to_words'] === ['[en] Same-origin miss'], 'Quota-ticket API translation must be returned.');

// 6. A scraped nonce without a quota ticket must not unlock API translations (Origin spoof).
configureDynamicOptions();
$_SERVER['REMOTE_ADDR'] = '198.51.100.24';
$_SERVER['HTTP_HOST'] = 'example.test';
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$response = $controller->handle(new WP_REST_Request([
    'texts' => ['Spoofed miss'],
    'lang_to' => 'en',
], [
    'Origin' => 'https://example.test',
    'X-WP-Nonce' => 'valid-rest-nonce',
]));
dynCheck($client->callCount === 0, 'A valid nonce with spoofed Origin but no quota ticket must not call the API.');
dynCheck($response->get_data() === ['from_words' => [], 'to_words' => []], 'Missing quota ticket degrades cache misses to empty results.');

// 7. A valid nonce without Origin/Referer but with quota ticket still translates misses.
configureDynamicOptions();
$_SERVER['REMOTE_ADDR'] = '198.51.100.23';
unset($_SERVER['HTTP_HOST']);
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$quotaTicket = DynamicTranslationController::issueQuotaTicket();
$response = $controller->handle(new WP_REST_Request([
    'texts' => ['Remote miss'],
    'lang_to' => 'en',
], [
    'X-WP-Nonce' => 'valid-rest-nonce',
    DynamicTranslationController::QUOTA_TICKET_HEADER => $quotaTicket,
]));
dynCheck($client->callCount === 1, 'A valid nonce + quota ticket must call the API even without Origin/Referer.');
dynCheck($response->get_data()['to_words'] === ['[en] Remote miss'], 'Quota ticket unlocks API translation without browser provenance headers.');

// 8. Same-origin cache-only requests still serve cached translations.
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

// 9. Target language not configured → rejected, no API call.
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$result = $controller->translateTexts(['Hallo'], 'fr', true);
dynCheck($client->callCount === 0, 'An unconfigured target language must be rejected before any API call.');
dynCheck($result === ['from_words' => [], 'to_words' => []], 'Unconfigured target language returns nothing.');

// 10. Target language equals source → rejected.
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$result = $controller->translateTexts(['Hallo'], 'de', true);
dynCheck($client->callCount === 0, 'Translating into the source language must be a no-op.');

// 11. Feature disabled → no-op even with a valid nonce.
configureDynamicOptions(['enable_dynamic_translation' => false]);
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache(['Hallo' => '[en] Hallo']));
$result = $controller->translateTexts(['Hallo'], 'en', true);
dynCheck($client->callCount === 0, 'Disabled feature must not translate.');
dynCheck($result === ['from_words' => [], 'to_words' => []], 'Disabled feature returns nothing.');

// 12. Oversized request is capped at MAX_TEXTS (200) before hitting the API.
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

// 13. A 402 (quota exhausted) flags the response so the browser client stops
//     retrying, while any cached strings still serve.
configureDynamicOptions();
$client = new QuotaExhaustedFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache(['Hallo' => '[en] Hallo']));
$result = $controller->translateTexts(['Hallo', 'Neu'], 'en', true);
dynCheck($client->callCount === 1, 'A cache miss still calls the API once before the 402 surfaces.');
dynCheck(($result['quota_exhausted'] ?? false) === true, 'A 402 must set quota_exhausted on the response.');
dynCheck($result['to_words'] === ['[en] Hallo'], 'Cached strings must still serve when the quota is exhausted.');

// 14. A successful translation must NOT carry the quota_exhausted flag.
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$result = $controller->translateTexts(['Neu'], 'en', true);
dynCheck(!array_key_exists('quota_exhausted', $result), 'A successful response must not carry quota_exhausted.');

// 15. Per-render ticket cap: once a valid ticket's fresh-segment budget is
//     spent, further cache misses on that ticket degrade to cache-only.
configureDynamicOptions();
$GLOBALS['_deepglot_transients'] = [];
$_SERVER['REMOTE_ADDR'] = '198.51.100.30';
$_SERVER['HTTP_HOST'] = 'example.test';
$ticket = DynamicTranslationController::issueQuotaTicket();
// Drive the ticket to its cap directly (one request is capped at MAX_TEXTS,
// so exhausting 2000 segments per request is not otherwise reachable).
set_transient(
    'deepglot_dynqt_' . hash('sha256', $ticket),
    ['spent' => DynamicTranslationController::MAX_FRESH_WORDS_PER_TICKET, 'max' => DynamicTranslationController::MAX_FRESH_WORDS_PER_TICKET],
    DynamicTranslationController::QUOTA_TICKET_TTL
);
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$response = $controller->handle(new WP_REST_Request([
    'texts' => ['Over the ticket budget'],
    'lang_to' => 'en',
], [
    'X-WP-Nonce' => 'valid-rest-nonce',
    DynamicTranslationController::QUOTA_TICKET_HEADER => $ticket,
]));
dynCheck($client->callCount === 0, 'A valid ticket whose per-render budget is exhausted must not call the API.');
dynCheck($response->get_data() === ['from_words' => [], 'to_words' => []], 'Exhausted ticket budget degrades cache misses to empty results.');

// 16. Per-IP window budget: a FRESH ticket must not bypass an exhausted per-IP
//     fresh-segment budget — this is what actually bounds quota drain, since an
//     attacker can mint a new ticket per page load for free.
configureDynamicOptions();
$GLOBALS['_deepglot_transients'] = [];
$_SERVER['REMOTE_ADDR'] = '198.51.100.31';
$_SERVER['HTTP_HOST'] = 'example.test';
set_transient(
    'deepglot_dynfw_' . sha1('198.51.100.31'),
    ['spent' => DynamicTranslationController::MAX_FRESH_WORDS_PER_IP, 'reset' => time() + DynamicTranslationController::FRESH_BUDGET_WINDOW],
    DynamicTranslationController::FRESH_BUDGET_WINDOW + 5
);
$ticket = DynamicTranslationController::issueQuotaTicket();
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$response = $controller->handle(new WP_REST_Request([
    'texts' => ['Over the per-IP budget'],
    'lang_to' => 'en',
], [
    'X-WP-Nonce' => 'valid-rest-nonce',
    DynamicTranslationController::QUOTA_TICKET_HEADER => $ticket,
]));
dynCheck($client->callCount === 0, 'A fresh ticket must not bypass an exhausted per-IP fresh-word budget.');
dynCheck($response->get_data() === ['from_words' => [], 'to_words' => []], 'Exhausted per-IP budget degrades cache misses to empty results.');

// 17. A fresh ticket on a fresh IP still translates cache misses (the caps do
//     not block legitimate first-visit traffic).
configureDynamicOptions();
$GLOBALS['_deepglot_transients'] = [];
$_SERVER['REMOTE_ADDR'] = '198.51.100.32';
$_SERVER['HTTP_HOST'] = 'example.test';
$ticket = DynamicTranslationController::issueQuotaTicket();
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$response = $controller->handle(new WP_REST_Request([
    'texts' => ['Fresh miss'],
    'lang_to' => 'en',
], [
    'X-WP-Nonce' => 'valid-rest-nonce',
    DynamicTranslationController::QUOTA_TICKET_HEADER => $ticket,
]));
dynCheck($client->callCount === 1, 'A fresh ticket within both budgets must still translate cache misses.');
dynCheck($response->get_data()['to_words'] === ['[en] Fresh miss'], 'Legitimate first-visit translation must be returned.');

// 18. The per-IP window budget accumulates ACROSS distinct tickets: minting a
//     new ticket per page render must NOT reset the per-IP counter (the core
//     drain-bound property — otherwise the ticket is free to re-mint).
configureDynamicOptions();
$GLOBALS['_deepglot_transients'] = [];
$_SERVER['REMOTE_ADDR'] = '198.51.100.33';
$_SERVER['HTTP_HOST'] = 'example.test';
// Seed the per-IP window so exactly 2 fresh words remain.
set_transient(
    'deepglot_dynfw_' . sha1('198.51.100.33'),
    ['spent' => DynamicTranslationController::MAX_FRESH_WORDS_PER_IP - 2, 'reset' => time() + DynamicTranslationController::FRESH_BUDGET_WINDOW],
    DynamicTranslationController::FRESH_BUDGET_WINDOW + 5
);
// Ticket A (fresh) spends the 2 remaining per-IP words.
$ticketA = DynamicTranslationController::issueQuotaTicket();
$clientA = new DynamicFakeClient();
$controllerA = new DynamicTranslationController(new Options(), $clientA, new DynamicFakeCache([]));
$controllerA->handle(new WP_REST_Request([
    'texts' => ['zwei woerter'],
    'lang_to' => 'en',
], ['X-WP-Nonce' => 'valid-rest-nonce', DynamicTranslationController::QUOTA_TICKET_HEADER => $ticketA]));
dynCheck($clientA->callCount === 1, 'Ticket A spends the last remaining per-IP words.');
// Ticket B is a brand-new ticket with a full per-render budget, but the per-IP
// window is now spent — a re-minted ticket must not unlock more fresh spend.
$ticketB = DynamicTranslationController::issueQuotaTicket();
dynCheck($ticketB !== $ticketA, 'Each page render mints a distinct ticket.');
$clientB = new DynamicFakeClient();
$controllerB = new DynamicTranslationController(new Options(), $clientB, new DynamicFakeCache([]));
$responseB = $controllerB->handle(new WP_REST_Request([
    'texts' => ['noch mehr text'],
    'lang_to' => 'en',
], ['X-WP-Nonce' => 'valid-rest-nonce', DynamicTranslationController::QUOTA_TICKET_HEADER => $ticketB]));
dynCheck($clientB->callCount === 0, 'A fresh ticket must NOT reset the per-IP window — accumulation holds across tickets.');
dynCheck($responseB->get_data() === ['from_words' => [], 'to_words' => []], 'Re-minted ticket degrades to cache-only once the per-IP window is spent.');

// 19. When the per-IP budget blocks a batch, the ticket budget must NOT be
//     debited — otherwise visitors behind a shared NAT lose their per-render
//     allowance even though no translation ran.
configureDynamicOptions();
$GLOBALS['_deepglot_transients'] = [];
$_SERVER['REMOTE_ADDR'] = '198.51.100.34';
$_SERVER['HTTP_HOST'] = 'example.test';
set_transient(
    'deepglot_dynfw_' . sha1('198.51.100.34'),
    ['spent' => DynamicTranslationController::MAX_FRESH_WORDS_PER_IP, 'reset' => time() + DynamicTranslationController::FRESH_BUDGET_WINDOW],
    DynamicTranslationController::FRESH_BUDGET_WINDOW + 5
);
$ticket = DynamicTranslationController::issueQuotaTicket();
$ticketKey = 'deepglot_dynqt_' . hash('sha256', $ticket);
$client = new DynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$controller->handle(new WP_REST_Request([
    'texts' => ['Should not debit ticket'],
    'lang_to' => 'en',
], [
    'X-WP-Nonce' => 'valid-rest-nonce',
    DynamicTranslationController::QUOTA_TICKET_HEADER => $ticket,
]));
$bucket = get_transient($ticketKey);
dynCheck($client->callCount === 0, 'Exhausted per-IP budget must not call the API.');
dynCheck(is_array($bucket) && (int) $bucket['spent'] === 0, 'Per-IP rejection must not debit the ticket budget.');

// 20. When the SaaS call fails without delivering fresh translations, both the
//     per-IP and per-ticket budgets must be rolled back so transient 5xx/429
//     responses do not poison shared-NAT visitors (same class as case 19).
configureDynamicOptions();
$GLOBALS['_deepglot_transients'] = [];
$_SERVER['REMOTE_ADDR'] = '198.51.100.35';
$_SERVER['HTTP_HOST'] = 'example.test';
$ticket = DynamicTranslationController::issueQuotaTicket();
$ticketKey = 'deepglot_dynqt_' . hash('sha256', $ticket);
$ipKey = 'deepglot_dynfw_' . sha1('198.51.100.35');
$client = new ServerErrorFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$controller->handle(new WP_REST_Request([
    'texts' => ['Transient failure'],
    'lang_to' => 'en',
], [
    'X-WP-Nonce' => 'valid-rest-nonce',
    DynamicTranslationController::QUOTA_TICKET_HEADER => $ticket,
]));
$ipBucket = get_transient($ipKey);
$ticketBucket = get_transient($ticketKey);
dynCheck($client->callCount === 1, 'A cache miss must still call the SaaS API once.');
dynCheck(is_array($ipBucket) && (int) $ipBucket['spent'] === 0, 'SaaS failure must roll back the per-IP fresh-word budget.');
dynCheck(is_array($ticketBucket) && (int) $ticketBucket['spent'] === 0, 'SaaS failure must roll back the per-ticket fresh-word budget.');

// 21. A SaaS 429 keeps the same budget rollback and forwards only its bounded
//     delay to the browser queue, which can then suppress immediate retries.
configureDynamicOptions();
$GLOBALS['_deepglot_transients'] = [];
$_SERVER['REMOTE_ADDR'] = '198.51.100.36';
$_SERVER['HTTP_HOST'] = 'example.test';
$ticket = DynamicTranslationController::issueQuotaTicket();
$ticketKey = 'deepglot_dynqt_' . hash('sha256', $ticket);
$ipKey = 'deepglot_dynfw_' . sha1('198.51.100.36');
$client = new RateLimitedFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$response = $controller->handle(new WP_REST_Request([
    'texts' => ['Rate limited dynamic text'],
    'lang_to' => 'en',
], [
    'X-WP-Nonce' => 'valid-rest-nonce',
    DynamicTranslationController::QUOTA_TICKET_HEADER => $ticket,
]));
$responseData = $response->get_data();
$ipBucket = get_transient($ipKey);
$ticketBucket = get_transient($ticketKey);
dynCheck($client->callCount === 1, 'A dynamic cache miss reaches the SaaS once before the 429 is known.');
dynCheck(($responseData['retry_after'] ?? null) === 1800, 'The dynamic response must preserve a fixed-window 429 backoff beyond five minutes.');
dynCheck(is_array($ipBucket) && (int) $ipBucket['spent'] === 0, 'A dynamic 429 must roll back the per-IP budget.');
dynCheck(is_array($ticketBucket) && (int) $ticketBucket['spent'] === 0, 'A dynamic 429 must roll back the ticket budget.');

// 22. URL localization uses the same public dynamic endpoint but is routing
//     only: it must work without a nonce/ticket and never spend provider words.
configureDynamicOptions();
$GLOBALS['_deepglot_transients'] = [];
$_SERVER['REMOTE_ADDR'] = '198.51.100.37';
$_SERVER['HTTP_HOST'] = 'example.test';
$client = new DynamicFakeClient();
$routing = new SiteRouting(
    new UrlLanguageResolver('de', ['en']),
    'https://example.test',
    'PATH_PREFIX',
    []
);
$controller = new DynamicTranslationController(
    new Options(),
    $client,
    new DynamicFakeCache([]),
    new DynamicUrlLocalizer($routing)
);
$response = $controller->handle(new WP_REST_Request([
    'texts' => [],
    'urls' => [
        '/impressum/',
        'https://outside.example/legal/',
        'mailto:privacy@example.test',
        '//cdn.example.test/privacy.pdf',
        '/wp-content/uploads/privacy.pdf',
    ],
    'lang_to' => 'en',
], []));
$responseData = $response->get_data();
dynCheck($client->callCount === 0, 'URL-only localization must not call the translation provider.');
dynCheck(
    $responseData === [
        'from_words' => [],
        'to_words' => [],
        'from_urls' => ['/impressum/'],
        'to_urls' => ['/en/impressum/'],
    ],
    'The dynamic endpoint must return only safe local URL mappings alongside the text response shape.'
);

// 23. Invalid or unconfigured targets do not produce URL rewrites.
$_SERVER['REMOTE_ADDR'] = '198.51.100.38';
$response = $controller->handle(new WP_REST_Request([
    'texts' => [],
    'urls' => ['/impressum/'],
    'lang_to' => 'it',
], []));
$responseData = $response->get_data();
dynCheck(
    $responseData['from_urls'] === [] && $responseData['to_urls'] === [],
    'An unconfigured URL target language must fail closed.'
);


// isBot() ist als Spiegel von BrowserRedirector::isBotRequest() dokumentiert:
// Performance-Messwerkzeuge müssen auch am dynamischen Endpoint als Bot gelten,
// sonst verbrennt Audit-Traffic Übersetzungs-Quota.
$isBot = new ReflectionMethod(DynamicTranslationController::class, 'isBot');
if (PHP_VERSION_ID < 80100) {
    $isBot->setAccessible(true);
}

foreach ([
    'Lighthouse' => 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
    'HeadlessChrome' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
    'GTmetrix' => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0 Safari/537.36 GTmetrix',
    'WebPageTest (PTST)' => 'Mozilla/5.0 (X11; Linux x86_64; PTST/240301.140921) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
] as $label => $userAgent) {
    dynCheck($isBot->invoke($controller, $userAgent) === true, $label . ' must be treated as a bot at the dynamic endpoint.');
}

dynCheck($isBot->invoke($controller, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1') === false, 'Regular browsers must stay non-bot at the dynamic endpoint.');

// 24. A server-enforced cache-only response may contain a real SaaS cache hit
// plus identity fallbacks for misses. Return/cache only the real hit.
configureDynamicOptions();
$_SERVER['REMOTE_ADDR'] = '198.51.100.39';
$client = new CacheOnlyDynamicFakeClient();
$cache = new DynamicFakeCache([]);
$controller = new DynamicTranslationController(new Options(), $client, $cache);
$result = $controller->translateTexts(['SaaS cache hit', 'SaaS identity miss'], 'en', true);
dynCheck($client->callCount === 1, 'The stale-local-state request reaches SaaS once before cache-only is known.');
dynCheck(
    $result === ['from_words' => ['SaaS cache hit'], 'to_words' => ['Real cached translation']],
    'Dynamic cache-only responses must expose only genuine SaaS cache hits.'
);
dynCheck(
    $cache->saved === ['SaaS cache hit' => 'Real cached translation'],
    'Dynamic translation must never persist a cache-only identity miss.'
);

// 25. Once the runtime readback says automatic translation is disabled, the
// SaaS remains the authoritative cache: local and SaaS cache hits still serve,
// while an explicit cache-only response proves no provider work occurred.
configureDynamicOptions(['automatic_translation' => false]);
$client = new CacheOnlyDynamicFakeClient();
$controller = new DynamicTranslationController(
    new Options(),
    $client,
    new DynamicFakeCache(['Local cache hit' => 'Existing translation'])
);
$result = $controller->translateTexts(
    ['Local cache hit', 'SaaS cache hit', 'SaaS identity miss'],
    'en',
    true
);
dynCheck($client->callCount === 1, 'Disabled automatic translation may still read existing SaaS cache hits.');
dynCheck(
    $result === [
        'from_words' => ['Local cache hit', 'SaaS cache hit'],
        'to_words' => ['Existing translation', 'Real cached translation'],
    ],
    'Disabling automatic translation must preserve local and SaaS cached translations without identity misses.'
);

// 26. Once the authenticated runtime snapshot disables provider work, a valid
// nonce may read the SaaS cache without a fresh-translation ticket or either
// local word budget. The plugin must force the upstream request itself into
// cache-only mode so a stale local snapshot can never create provider spend.
configureDynamicOptions(['automatic_translation' => false]);
$GLOBALS['_deepglot_transients'] = [];
$_SERVER['REMOTE_ADDR'] = '198.51.100.40';
set_transient(
    'deepglot_dynfw_' . sha1('198.51.100.40'),
    [
        'spent' => DynamicTranslationController::MAX_FRESH_WORDS_PER_IP,
        'reset' => time() + DynamicTranslationController::FRESH_BUDGET_WINDOW,
    ],
    DynamicTranslationController::FRESH_BUDGET_WINDOW + 5
);
$client = new CacheOnlyDynamicFakeClient();
$controller = new DynamicTranslationController(new Options(), $client, new DynamicFakeCache([]));
$response = $controller->handle(new WP_REST_Request([
    'texts' => ['SaaS cache hit', 'SaaS identity miss'],
    'lang_to' => 'en',
], [
    'X-WP-Nonce' => 'valid-rest-nonce',
]));
dynCheck(
    $client->callCount === 1,
    'Disabled automatic translation must allow a nonce-authenticated SaaS cache read without a quota ticket.'
);
dynCheck(
    $client->lastBot === 1,
    'A ticket-free dynamic cache read must force the upstream request into the legacy cache-only bot contract.'
);
dynCheck(
    $response->get_data() === [
        'from_words' => ['SaaS cache hit'],
        'to_words' => ['Real cached translation'],
    ],
    'Ticket-free cache readback must expose only genuine SaaS hits.'
);

$clientWithoutNonce = new CacheOnlyDynamicFakeClient();
$controllerWithoutNonce = new DynamicTranslationController(
    new Options(),
    $clientWithoutNonce,
    new DynamicFakeCache([])
);
$controllerWithoutNonce->handle(new WP_REST_Request([
    'texts' => ['SaaS cache hit'],
    'lang_to' => 'en',
], []));
dynCheck(
    $clientWithoutNonce->callCount === 0,
    'Disabling automatic translation must not remove the nonce boundary from SaaS cache readback.'
);

// 27. Bind the cache-only decision to the same request snapshot that admitted
// a ticket-free call. A concurrent dashboard re-enable must not turn that
// already-admitted public request into an unbudgeted provider translation.
configureDynamicOptions(['automatic_translation' => false]);
$GLOBALS['_deepglot_transients'] = [];
$_SERVER['REMOTE_ADDR'] = '198.51.100.41';
$raceClient = new CacheOnlyDynamicFakeClient();
$raceController = new DynamicTranslationController(
    new FlippingAutomaticTranslationOptions(),
    $raceClient,
    new DynamicFakeCache([])
);
$raceController->handle(new WP_REST_Request([
    'texts' => ['SaaS cache hit'],
    'lang_to' => 'en',
], [
    'X-WP-Nonce' => 'valid-rest-nonce',
]));
dynCheck(
    $raceClient->callCount === 1 && $raceClient->lastBot === 1,
    'A ticket-free request admitted as cache-only must stay cache-only across a concurrent re-enable.'
);

fwrite(STDOUT, "DynamicTranslationControllerTest: OK\n");
