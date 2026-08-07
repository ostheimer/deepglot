<?php

/**
 * Covers the half of the jobspot.at cold-page failure that smaller batches and
 * a longer timeout cannot fix: the waiting itself.
 *
 * Measured from that webserver against production on 2026-08-03, with each
 * size sent twice so a full SaaS cache hit isolates the fixed cost:
 *
 *     segments   fresh   cached   provider
 *            1   10.4s     1.4s       9.0s
 *           12   20.1s     1.4s      18.7s
 *           50   40.5s     1.4s      39.1s
 *
 * The request's own work is only ~1.4s; the provider costs ~9s before it
 * translates anything. No batch size is therefore both worth sending and fast
 * enough for a page load — the render has to stop waiting.
 *
 * The regressions pinned here:
 *   - inline work per render is bounded, and 0 (cache-only) is the default,
 *   - anything not translated inline (deferred or failed) is queued for
 *     background warming, so a page converges instead of staying
 *     source-language forever,
 *   - a warm run caches its results and clears what it completed,
 *   - bot traffic never enqueues warm work (keeps the issue #147 boundary:
 *     crawlers are served cache-only and never spend quota).
 *
 * Run via: npm run test:wp
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }
}

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_options'] = [];

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_options'][$key] ?? $default;
    }

    function update_option($key, $value, $autoload = null) {
        $GLOBALS['_deepglot_options'][$key] = $value;
        return true;
    }

    function delete_option($key) {
        unset($GLOBALS['_deepglot_options'][$key]);
        return true;
    }

    function get_transient($key) {
        return false;
    }

    function set_transient($key, $value, $ttl = 0) {
        return true;
    }

    function delete_transient($key) {
        return true;
    }

    function is_wp_error($value) {
        return $value instanceof DeepglotWarmFakeWpError;
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

    if (!defined('DAY_IN_SECONDS')) {
        define('DAY_IN_SECONDS', 86400);
    }

    if (!defined('MINUTE_IN_SECONDS')) {
        define('MINUTE_IN_SECONDS', 60);
    }
}

$GLOBALS['_deepglot_filters'] = [];
$GLOBALS['_deepglot_actions'] = [];
$GLOBALS['_deepglot_scheduled'] = [];
$GLOBALS['_deepglot_spawned_cron'] = 0;

if (!function_exists('add_filter')) {
    function add_filter($hook, $callback, $priority = 10, $args = 1) {
        $GLOBALS['_deepglot_filters'][$hook][] = $callback;
        return true;
    }

    function apply_filters($hook, $value, ...$args) {
        foreach ($GLOBALS['_deepglot_filters'][$hook] ?? [] as $callback) {
            $value = $callback($value, ...$args);
        }

        return $value;
    }

    function add_action($hook, $callback, $priority = 10, $args = 1) {
        $GLOBALS['_deepglot_actions'][$hook][] = $callback;
        return true;
    }

    function wp_next_scheduled($hook, $args = []) {
        return $GLOBALS['_deepglot_scheduled'][$hook] ?? false;
    }

    function wp_schedule_single_event($timestamp, $hook, $args = []) {
        $GLOBALS['_deepglot_scheduled'][$hook] = $timestamp;
        return true;
    }

    function spawn_cron($gmt_time = 0) {
        $GLOBALS['_deepglot_spawned_cron']++;
        return true;
    }

    function wp_doing_cron() {
        return false;
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Support/TranslationWarmer.php';
require_once __DIR__ . '/../includes/Frontend/JsonLdTranslator.php';
require_once __DIR__ . '/../includes/Support/BotDetector.php';
require_once __DIR__ . '/../includes/Support/HtmlDocument.php';
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Support\BotDetector;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\TranslationWarmer;

class DeepglotWarmFakeWpError
{
    public string $message;

    public function __construct(string $message)
    {
        $this->message = $message;
    }
}

/**
 * Records every dispatched batch plus the timeout it was given, so the tests
 * can assert both the batching shape and that background work is allowed to
 * outlive a visitor-facing request.
 */
class DeepglotWarmFakeClient extends Client
{
    /** @var array<int, string[]> */
    public array $batchCalls = [];

    /** @var array<int, int|null> */
    public array $timeouts = [];

    public int $singleCalls = 0;

    /** @var int[] Indexes (per translateBatches call) that must fail. */
    public array $failingBatchIndexes = [];

    public function __construct() {}

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0, ?int $timeout = null)
    {
        $this->singleCalls++;
        $this->batchCalls[] = $texts;
        $this->timeouts[] = $timeout;

        return [
            'from_words' => $texts,
            'to_words' => array_map(static fn(string $text) => '[en] ' . $text, $texts),
        ];
    }

    public function translateBatches(array $batches, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0, ?int $timeout = null): array
    {
        $results = [];

        foreach ($batches as $index => $batch) {
            $this->batchCalls[] = $batch;
            $this->timeouts[] = $timeout;

            if (in_array($index, $this->failingBatchIndexes, true)) {
                $results[$index] = new DeepglotWarmFakeWpError('boom-' . $index);
                continue;
            }

            $results[$index] = [
                'from_words' => $batch,
                'to_words' => array_map(static fn(string $text) => '[en] ' . $text, $batch),
            ];
        }

        return $results;
    }

    /** @return string[] */
    public function dispatchedTexts(): array
    {
        return array_merge([], ...array_values($this->batchCalls));
    }

    public function reset(): void
    {
        $this->batchCalls = [];
        $this->timeouts = [];
        $this->singleCalls = 0;
    }
}

class DeepglotWarmArrayCache extends TranslationCache
{
    /** @var array<string, string> */
    public array $entries = [];

    public function getMany(array $texts, string $from, string $to): array
    {
        $hits = [];

        foreach ($texts as $text) {
            if (isset($this->entries[$from . '|' . $to . '|' . $text])) {
                $hits[$text] = $this->entries[$from . '|' . $to . '|' . $text];
            }
        }

        return $hits;
    }

    public function setMany(array $translations, string $from, string $to): void
    {
        foreach ($translations as $original => $translated) {
            $this->entries[$from . '|' . $to . '|' . $original] = $translated;
        }
    }
}

function warmAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

/** @return array{0: string, 1: string[]} */
function warmBuildPage(int $segmentCount): array
{
    $paragraphs = '';
    $texts = [];

    for ($i = 0; $i < $segmentCount; $i++) {
        $text = sprintf('Absatz %03d ueber die Bewerbung', $i);
        $paragraphs .= '<p>' . $text . '</p>';
        $texts[] = $text;
    }

    return [
        '<!DOCTYPE html><html><head><title>Kaltstart</title></head><body>' . $paragraphs . '</body></html>',
        $texts,
    ];
}

function warmResetEnvironment(): void
{
    $GLOBALS['_deepglot_filters'] = [];
    $GLOBALS['_deepglot_scheduled'] = [];
    $GLOBALS['_deepglot_spawned_cron'] = 0;
    unset($GLOBALS['_deepglot_options'][TranslationWarmer::QUEUE_OPTION]);
}

$options = new Options();
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));

// How many inline batches the opt-in sections below allow. The shipped default
// is 0 (cache-only renders); sections 1–3 exercise the inline path a site
// enables through `deepglot_max_sync_batches`.
const WARM_TEST_SYNC_LIMIT = 4;

// How batching itself works — count and payload-byte bounds — is
// HtmlTranslator::buildTranslationBatches()' contract and is covered by
// SingleBatchTimeoutTest. What matters here is only what happens to the
// batches the render decides not to wait for.

// -----------------------------------------------------------------------------
// 1. Inline work per render is bounded; the overflow is queued for warming.
// -----------------------------------------------------------------------------
warmResetEnvironment();
add_filter('deepglot_max_sync_batches', static fn() => WARM_TEST_SYNC_LIMIT);
// Comfortably more segments than WARM_TEST_SYNC_LIMIT batches can hold under
// the byte budget, so there is guaranteed overflow to defer.
$largeCount = 600;
[$html, $texts] = warmBuildPage($largeCount);
$client = new DeepglotWarmFakeClient();
$cache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $cache);
$translator = new HtmlTranslator($client, $options, $cache, null, $warmer);
$translator->translate($html, 'en', 'https://jobspot.at/en/gross/', BotDetector::HUMAN);

warmAssert(
    count($client->batchCalls) <= WARM_TEST_SYNC_LIMIT,
    sprintf(
        'A render must dispatch at most %d inline requests, got %d — a cold start may not scale with page size.',
        WARM_TEST_SYNC_LIMIT,
        count($client->batchCalls)
    )
);

$dispatched = $client->dispatchedTexts();
$queued = $warmer->pending();
$queuedTexts = $queued['de|en'] ?? [];

warmAssert(
    count($dispatched) < count($texts),
    'The oversized page must not be translated entirely inline.'
);
warmAssert(
    !empty($queuedTexts),
    'Segments beyond the inline budget must be queued for background warming.'
);

$covered = array_merge($dispatched, $queuedTexts);
foreach ($texts as $text) {
    warmAssert(
        in_array($text, $covered, true),
        sprintf('Every fresh segment must be translated inline or queued, "%s" was dropped.', $text)
    );
}

warmAssert(
    (int) ($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] ?? 0) > 0,
    'Queuing warm work must schedule the background event.'
);

// -----------------------------------------------------------------------------
// 2. A failing inline batch must converge through the warm queue instead of
//    leaving the page permanently untranslated.
// -----------------------------------------------------------------------------
warmResetEnvironment();
add_filter('deepglot_max_sync_batches', static fn() => WARM_TEST_SYNC_LIMIT);
[$html, $texts] = warmBuildPage(80);
$client = new DeepglotWarmFakeClient();
$client->failingBatchIndexes = [1];
$cache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $cache);
$translator = new HtmlTranslator($client, $options, $cache, null, $warmer);
$rendered = $translator->translate($html, 'en', 'https://jobspot.at/en/fail/', BotDetector::HUMAN);

$failedTexts = $client->batchCalls[1] ?? [];
warmAssert(!empty($failedTexts), 'The failing batch must have been dispatched.');

$queuedTexts = $warmer->pending()['de|en'] ?? [];
foreach ($failedTexts as $text) {
    warmAssert(
        in_array($text, $queuedTexts, true),
        sprintf('Texts from a failed batch must be queued for retry, "%s" was lost.', $text)
    );
    warmAssert(
        str_contains($rendered, '<p>' . $text . '</p>'),
        sprintf('A failed batch must leave its source text intact, "%s" was mangled.', $text)
    );
}

// The warm run then fills the cache, and the next render is fully translated
// without touching the API again — this is the convergence the live site never
// reached.
$client->reset();
$warmer->run();

warmAssert(
    !empty($client->batchCalls),
    'The warm run must dispatch the queued texts.'
);
foreach ($client->timeouts as $timeout) {
    warmAssert(
        $timeout !== null && $timeout >= TranslationWarmer::TIMEOUT,
        sprintf(
            'Background warming must use its long timeout (>= %ds), got %s.',
            TranslationWarmer::TIMEOUT,
            var_export($timeout, true)
        )
    );
}

warmAssert(
    empty($warmer->pending()),
    'A completed warm run must clear the queue.'
);

$client->reset();
$rendered = $translator->translate($html, 'en', 'https://jobspot.at/en/fail/', BotDetector::HUMAN);

warmAssert(
    empty($client->batchCalls),
    'After warming, the page must render from cache without any API request.'
);
foreach ($texts as $text) {
    warmAssert(
        str_contains($rendered, '[en] ' . $text),
        sprintf('After warming, every segment must be translated, "%s" was not.', $text)
    );
}

// -----------------------------------------------------------------------------
// 3. Bot traffic never enqueues warm work (issue #147 boundary).
// -----------------------------------------------------------------------------
warmResetEnvironment();
add_filter('deepglot_max_sync_batches', static fn() => WARM_TEST_SYNC_LIMIT);
[$html, $texts] = warmBuildPage($largeCount);
$client = new DeepglotWarmFakeClient();
$cache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $cache);
$translator = new HtmlTranslator($client, $options, $cache, null, $warmer);
$translator->translate($html, 'en', 'https://jobspot.at/en/gross/', BotDetector::GOOGLE);

warmAssert(
    empty($warmer->pending()),
    'Bot traffic must not queue background translation work.'
);

// -----------------------------------------------------------------------------
// 4. The shipped default is a fully asynchronous render: cache-only output,
//    every fresh segment warmed in the background. Measured against production
//    on 2026-08-03, a fresh batch costs ~9s before the provider translates
//    anything, so no inline batch size is fast enough for a page load.
// -----------------------------------------------------------------------------
warmResetEnvironment();
warmAssert(
    HtmlTranslator::MAX_SYNC_BATCHES === 0,
    'The default render path must not block on the translation API.'
);
[$html, $texts] = warmBuildPage(60);
$client = new DeepglotWarmFakeClient();
$cache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $cache);
$translator = new HtmlTranslator($client, $options, $cache, null, $warmer);
$rendered = $translator->translate($html, 'en', 'https://jobspot.at/en/async/', BotDetector::HUMAN);

warmAssert(
    empty($client->batchCalls),
    'With the inline budget disabled a render must not block on the API at all.'
);
$queuedTexts = $warmer->pending()['de|en'] ?? [];
foreach ($texts as $text) {
    warmAssert(
        in_array($text, $queuedTexts, true),
        sprintf('With the inline budget disabled every fresh segment must be queued, "%s" was not.', $text)
    );
}
warmAssert(
    str_contains($rendered, '<p>' . $texts[0] . '</p>'),
    'A cache-only render must serve the source text unchanged.'
);

$warmer->run();
$client->reset();
$rendered = $translator->translate($html, 'en', 'https://jobspot.at/en/async/', BotDetector::HUMAN);

foreach ($texts as $text) {
    warmAssert(
        str_contains($rendered, '[en] ' . $text),
        sprintf('The asynchronous path must converge, "%s" stayed untranslated.', $text)
    );
}

// -----------------------------------------------------------------------------
// 5. Warm runs skip texts another request already cached, and the queue is
//    bounded so a burst of cold pages cannot grow the option row unboundedly.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$cache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $cache);

$warmer->enqueue(['Alpha', 'Beta', 'Gamma'], 'de', 'en');
$cache->setMany(['Beta' => '[en] Beta'], 'de', 'en');
$warmer->run();

warmAssert(
    !in_array('Beta', $client->dispatchedTexts(), true),
    'A warm run must not re-translate a text that is already cached.'
);
warmAssert(
    in_array('Alpha', $client->dispatchedTexts(), true)
        && in_array('Gamma', $client->dispatchedTexts(), true),
    'A warm run must translate the texts that are still missing.'
);

warmResetEnvironment();
$warmer = new TranslationWarmer(new DeepglotWarmFakeClient(), $options, new DeepglotWarmArrayCache());
$flood = [];
for ($i = 0; $i < TranslationWarmer::MAX_QUEUE * 2; $i++) {
    $flood[] = 'Flut ' . $i;
}
$warmer->enqueue($flood, 'de', 'en');

warmAssert(
    count($warmer->pending()['de|en'] ?? []) <= TranslationWarmer::MAX_QUEUE,
    sprintf('The warm queue must stay bounded at %d entries.', TranslationWarmer::MAX_QUEUE)
);

// Duplicates must never accumulate — the same cold page hit by ten visitors
// may not multiply the queued work.
warmResetEnvironment();
$warmer = new TranslationWarmer(new DeepglotWarmFakeClient(), $options, new DeepglotWarmArrayCache());
$warmer->enqueue(['Alpha', 'Beta'], 'de', 'en');
$warmer->enqueue(['Beta', 'Gamma'], 'de', 'en');

warmAssert(
    ($warmer->pending()['de|en'] ?? []) === ['Alpha', 'Beta', 'Gamma'],
    'Repeated enqueues must deduplicate instead of piling up.'
);

fwrite(STDOUT, "ColdPageWarmupTest: OK\n");
