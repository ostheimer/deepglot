<?php

/**
 * Reproduces issue #163: a bot first-visit to an uncached page must not
 * poison the WordPress transient translation cache with identity mappings.
 *
 * The SaaS serves bot traffic cache-only (quota protection, ROADMAP 8.32):
 * words that are not in the SaaS cache come back with the ORIGINAL source
 * text (`to_words == from_words`). Before the fix, HtmlTranslator persisted
 * those identity pairs via TranslationCache::setMany() with a 30-day TTL,
 * so later human visitors read untranslated source text from the local
 * cache until the transient expired or was flushed manually.
 *
 * Pinned scenarios:
 *  1. Bot first-visit, fully uncached page — no identity mapping is
 *     persisted; the bot itself still receives source text (the cache-only
 *     contract is unchanged).
 *  2. Bot visit with a mixed response — real translations served from the
 *     SaaS cache may be persisted locally, identity fallbacks must not be.
 *  3. Human visit after the bot visit — the poisoning-candidate texts are
 *     re-requested, translated for real, rendered, and cached.
 *  4. Human request whose translation is legitimately identical to the
 *     source (proper noun) — still cached; the guard must not become a
 *     blanket `original === translated` filter for human traffic.
 *
 * Run standalone: php tests/BotCachePoisoningTest.php
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }
}

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_options'] = [];
    $GLOBALS['_transient_store'] = [];

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_options'][$key] ?? $default;
    }

    function update_option($key, $value) {
        $GLOBALS['_deepglot_options'][$key] = $value;
        return true;
    }

    function get_transient($key) {
        return $GLOBALS['_transient_store'][$key] ?? false;
    }

    function set_transient($key, $value, $ttl = 0) {
        $GLOBALS['_transient_store'][$key] = $value;
        return true;
    }

    function delete_transient($key) {
        unset($GLOBALS['_transient_store'][$key]);
        return true;
    }

    function is_wp_error($value) {
        return false;
    }

    function wp_parse_args($args, $defaults = []) {
        return array_merge($defaults, is_array($args) ? $args : []);
    }

    function wp_json_encode($data, $options = 0, $depth = 512) {
        return json_encode($data, $options, $depth);
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

    if (!defined('DAY_IN_SECONDS')) {
        define('DAY_IN_SECONDS', 86400);
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Support/BotDetector.php';
require_once __DIR__ . '/../includes/Frontend/JsonLdTranslator.php';
require_once __DIR__ . '/../includes/Support/HtmlDocument.php';
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Support\BotDetector;
use Deepglot\Support\TranslationCache;

/**
 * Mimics the SaaS /api/translate contract per bot code:
 *  - words present in $saasCache return their real translation (the SaaS
 *    cache serves bots and humans alike),
 *  - uncached words on a BOT request come back as identity mappings
 *    (route.ts step 8 fills unresolved pending words with the source text),
 *  - uncached words on a HUMAN request are provider-translated ("[en] …").
 */
class DeepglotPoisoningFakeClient extends Client
{
    /** @var array<int, array{texts: string[], bot: int}> */
    public array $calls = [];

    /** @var array<string, string> original => translated (SaaS-side cache) */
    public array $saasCache = [];

    public function __construct() {}

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0)
    {
        $this->calls[] = ['texts' => array_values($texts), 'bot' => $bot];

        $toWords = [];
        foreach ($texts as $text) {
            if (isset($this->saasCache[$text])) {
                $toWords[] = $this->saasCache[$text];
            } elseif ($bot >= BotDetector::OTHER) {
                $toWords[] = $text; // identity fallback for uncached bot words
            } else {
                $toWords[] = '[en] ' . $text;
            }
        }

        return ['from_words' => array_values($texts), 'to_words' => $toWords];
    }
}

function poisoningCheck(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

$options = new Options();
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));

// ---------------------------------------------------------------------------
// Scenario 1 + 3: bot first-visit on an uncached page, then a human visit.
// ---------------------------------------------------------------------------

$GLOBALS['_transient_store'] = [];
$client = new DeepglotPoisoningFakeClient();
$cache = new TranslationCache();
$translator = new HtmlTranslator($client, $options, $cache);

$html = '<!DOCTYPE html><html><head><title>Haushaltstipps</title></head><body>'
    . '<p>Warmwasser sparen im Haushalt</p>'
    . '</body></html>';

$botHtml = $translator->translate($html, 'en', 'https://example.com/tipps', BotDetector::GOOGLE);

poisoningCheck(
    str_contains($botHtml, 'Warmwasser sparen im Haushalt'),
    'Bot keeps receiving the source text for uncached words (cache-only contract unchanged).'
);
poisoningCheck(
    $cache->get('Warmwasser sparen im Haushalt', 'de', 'en') === null,
    '#163: the identity fallback from a bot request must not be persisted in the transient cache.'
);
poisoningCheck(
    $cache->get('Haushaltstipps', 'de', 'en') === null,
    '#163: identity fallbacks for <title> text must not be persisted either.'
);

$humanHtml = $translator->translate($html, 'en', 'https://example.com/tipps', BotDetector::HUMAN);

poisoningCheck(
    str_contains($humanHtml, '[en] Warmwasser sparen im Haushalt'),
    'A human visit after the bot visit must render the real translation, not a poisoned cache entry.'
);
poisoningCheck(
    $cache->get('Warmwasser sparen im Haushalt', 'de', 'en') === '[en] Warmwasser sparen im Haushalt',
    'The provider-backed translation from the human visit is persisted.'
);
poisoningCheck(
    count($client->calls) === 2 && $client->calls[1]['bot'] === BotDetector::HUMAN,
    'The human visit re-requests the texts instead of being served from a poisoned cache.'
);

// ---------------------------------------------------------------------------
// Scenario 2: bot visit with a mixed response (SaaS cache hit + identity).
// ---------------------------------------------------------------------------

$GLOBALS['_transient_store'] = [];
$mixedClient = new DeepglotPoisoningFakeClient();
$mixedClient->saasCache['Bekannter Artikeltext'] = '[en] Bekannter Artikeltext';
$mixedCache = new TranslationCache();
$mixedTranslator = new HtmlTranslator($mixedClient, $options, $mixedCache);

$mixedHtml = '<!DOCTYPE html><html><head></head><body>'
    . '<p>Bekannter Artikeltext</p>'
    . '<p>Frisch veroeffentlichter Artikeltext</p>'
    . '</body></html>';

$mixedResult = $mixedTranslator->translate($mixedHtml, 'en', '', BotDetector::OTHER);

poisoningCheck(
    str_contains($mixedResult, '[en] Bekannter Artikeltext'),
    'Bots still receive real translations for SaaS-cached words.'
);
poisoningCheck(
    $mixedCache->get('Bekannter Artikeltext', 'de', 'en') === '[en] Bekannter Artikeltext',
    'Real translations inside a bot response may be persisted locally.'
);
poisoningCheck(
    $mixedCache->get('Frisch veroeffentlichter Artikeltext', 'de', 'en') === null,
    '#163: the identity part of a mixed bot response must not be persisted.'
);

// ---------------------------------------------------------------------------
// Scenario 4: legitimately identical translation on a HUMAN request.
// ---------------------------------------------------------------------------

$GLOBALS['_transient_store'] = [];
$identityClient = new DeepglotPoisoningFakeClient();
// The provider legitimately returns the identical string (proper noun).
$identityClient->saasCache['Photosynthese Museum Berlin'] = 'Photosynthese Museum Berlin';
$identityCache = new TranslationCache();
$identityTranslator = new HtmlTranslator($identityClient, $options, $identityCache);

$identityHtml = '<!DOCTYPE html><html><head></head><body>'
    . '<p>Photosynthese Museum Berlin</p>'
    . '</body></html>';

$identityTranslator->translate($identityHtml, 'en', '', BotDetector::HUMAN);

poisoningCheck(
    $identityCache->get('Photosynthese Museum Berlin', 'de', 'en') === 'Photosynthese Museum Berlin',
    'A legitimately identical translation from a human/provider-backed request stays cacheable.'
);

fwrite(STDOUT, "BotCachePoisoningTest: OK\n");
