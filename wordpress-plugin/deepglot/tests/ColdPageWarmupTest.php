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

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}

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

    function add_option($key, $value, $deprecated = '', $autoload = true) {
        if (array_key_exists($key, $GLOBALS['_deepglot_options'])) {
            return false;
        }

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
$GLOBALS['_deepglot_spawned_cron_events'] = [];
$GLOBALS['_deepglot_is_doing_cron'] = false;
$GLOBALS['_deepglot_purged_urls'] = [];
$GLOBALS['_deepglot_w3tc_purged_urls'] = [];
$GLOBALS['_deepglot_litespeed_purged_urls'] = [];
$GLOBALS['_deepglot_wp_super_cache_purges'] = 0;

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

    function do_action($hook, ...$args) {
        if ($hook === 'litespeed_purge_url' && isset($args[0])) {
            $GLOBALS['_deepglot_litespeed_purged_urls'][] = (string) $args[0];
        }

        foreach ($GLOBALS['_deepglot_actions'][$hook] ?? [] as $callback) {
            $callback(...$args);
        }
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
        $GLOBALS['_deepglot_spawned_cron_events'][] = $GLOBALS['_deepglot_scheduled'][\Deepglot\Support\TranslationWarmer::HOOK] ?? null;
        return true;
    }

    function wp_doing_cron() {
        return (bool) ($GLOBALS['_deepglot_is_doing_cron'] ?? false);
    }

    function rocket_clean_files($urls) {
        $GLOBALS['_deepglot_purged_urls'] = array_merge(
            $GLOBALS['_deepglot_purged_urls'],
            is_array($urls) ? $urls : [$urls]
        );
    }

    function w3tc_flush_url($url) {
        $GLOBALS['_deepglot_w3tc_purged_urls'][] = (string) $url;
    }

    function wp_cache_clear_cache() {
        $GLOBALS['_deepglot_wp_super_cache_purges']++;
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

    /** @var array<string, mixed> */
    private array $data;

    /** @param array<string, mixed> $data */
    public function __construct(string $message, array $data = [])
    {
        $this->message = $message;
        $this->data = $data;
    }

    /** @return array<string, mixed> */
    public function get_error_data(): array
    {
        return $this->data;
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

    /** @var int[] Indexes that return a classified SaaS 429. */
    public array $rateLimitedBatchIndexes = [];

    /** @var int[] Indexes that return only the first requested translation. */
    public array $partialBatchIndexes = [];

    /** @var callable|null Runs once while a warm API request is in flight. */
    public $duringBatchCall = null;

    public int $translateBatchesCalls = 0;

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
        $this->translateBatchesCalls++;

        if (is_callable($this->duringBatchCall)) {
            $callback = $this->duringBatchCall;
            $this->duringBatchCall = null;
            $callback();
        }

        $results = [];

        foreach ($batches as $index => $batch) {
            $this->batchCalls[] = $batch;
            $this->timeouts[] = $timeout;

            if (in_array($index, $this->failingBatchIndexes, true)) {
                $results[$index] = new DeepglotWarmFakeWpError('boom-' . $index);
                continue;
            }

            if (in_array($index, $this->rateLimitedBatchIndexes, true)) {
                $results[$index] = new DeepglotWarmFakeWpError('rate-limited-' . $index, [
                    'status' => 429,
                    'retry_after' => 120,
                    'retry_after_source' => 'delta-seconds',
                    'retry_after_capped' => false,
                ]);
                continue;
            }

            $returnedBatch = in_array($index, $this->partialBatchIndexes, true)
                ? array_slice($batch, 0, 1)
                : $batch;

            $results[$index] = [
                'from_words' => $returnedBatch,
                'to_words' => array_map(static fn(string $text) => '[en] ' . $text, $returnedBatch),
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
        $this->translateBatchesCalls = 0;
        $this->rateLimitedBatchIndexes = [];
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
    $GLOBALS['_deepglot_actions'] = [];
    $GLOBALS['_deepglot_scheduled'] = [];
    $GLOBALS['_deepglot_spawned_cron'] = 0;
    $GLOBALS['_deepglot_spawned_cron_events'] = [];
    $GLOBALS['_deepglot_is_doing_cron'] = false;
    $GLOBALS['_deepglot_purged_urls'] = [];
    $GLOBALS['_deepglot_w3tc_purged_urls'] = [];
    $GLOBALS['_deepglot_litespeed_purged_urls'] = [];
    $GLOBALS['_deepglot_wp_super_cache_purges'] = 0;

    foreach (array_keys($GLOBALS['_deepglot_options']) as $key) {
        if (str_starts_with((string) $key, 'deepglot_warm_')) {
            unset($GLOBALS['_deepglot_options'][$key]);
        }
    }
}

function warmRunScheduledEvent(): void
{
    warmAssert(
        isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]),
        'A warmup cron event must be scheduled before it can run.'
    );
    unset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]);
    do_action(TranslationWarmer::HOOK);
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
warmAssert(
    $translator->getLastPendingSegmentCount() === count($queuedTexts),
    'The translator must expose the exact number of unresolved segments so URL sync cannot report a cold page as complete.'
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
warmAssert(
    (int) ($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] ?? PHP_INT_MAX) <= time(),
    'The event must already be due when the immediate cron nudge runs.'
);
warmAssert(
    (int) ($GLOBALS['_deepglot_spawned_cron_events'][0] ?? PHP_INT_MAX) <= time(),
    'The cron event must be due before spawn_cron() is called.'
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
warmAssert(
    $translator->getLastPendingSegmentCount() === 0,
    'A fully cache-backed render must report zero pending segments.'
);

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

// A real page can reach the Deepglot output-buffer callback only after
// WordPress has already dispatched its `shutdown` action (observed on
// meinhaushalt.at with WP Rocket). Scheduling another shutdown callback from
// that late render can never run in the same request, so the nudge must still
// happen immediately after the queue/event are durable.
[$lateHtml] = warmBuildPage(4);
$lateClient = new DeepglotWarmFakeClient();
$lateCache = new DeepglotWarmArrayCache();
$lateWarmer = new TranslationWarmer($lateClient, $options, $lateCache);
$lateWarmer->register();
$lateTranslator = new HtmlTranslator($lateClient, $options, $lateCache, null, $lateWarmer);
do_action('shutdown');
$lateTranslator->translate(
    $lateHtml,
    'en',
    'https://jobspot.at/en/late-buffer/',
    BotDetector::HUMAN
);

warmAssert(
    $GLOBALS['_deepglot_spawned_cron'] === 1,
    'A render that enqueues after the shutdown action must still nudge WP-Cron in the same request.'
);

warmResetEnvironment();
warmAssert(
    HtmlTranslator::MAX_SYNC_BATCHES === 0,
    'The default render path must not block on the translation API.'
);
[$html, $texts] = warmBuildPage(60);
$client = new DeepglotWarmFakeClient();
$cache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $cache);
$warmer->register();
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

warmAssert(
    count($GLOBALS['_deepglot_actions'][TranslationWarmer::HOOK] ?? []) === 1,
    'The registered WordPress cron hook must point to the warmer callback.'
);
warmAssert(
    count($GLOBALS['_deepglot_actions']['shutdown'] ?? []) === 0,
    'A cold page must not rely on a shutdown callback to nudge WP-Cron.'
);
warmAssert(
    $GLOBALS['_deepglot_spawned_cron'] === 1,
    'A cold page must nudge WP-Cron immediately after the durable queue and due event.'
);
$warmer->enqueue(['A second cold render in the same request'], 'de', 'en', 'https://jobspot.at/en/async-second/');
warmAssert(
    $GLOBALS['_deepglot_spawned_cron'] === 1,
    'Repeated enqueues in one request must not spawn WP-Cron more than once.'
);
do_action('shutdown');
warmAssert(
    $GLOBALS['_deepglot_spawned_cron'] === 1,
    'Dispatching shutdown after the immediate nudge must not spawn WP-Cron again.'
);
warmRunScheduledEvent();
warmAssert(
    in_array('https://jobspot.at/en/async/', $GLOBALS['_deepglot_purged_urls'], true),
    'The render request URL must follow deferred work into the page-cache purge.'
);
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

// Calling spawn_cron() while WP-Cron itself is draining work can recurse into
// another loopback. The warmer keeps the due event but never nudges from that
// context; a later visitor or the host's cron runner can continue it.
warmResetEnvironment();
$GLOBALS['_deepglot_is_doing_cron'] = true;
$cronContextWarmer = new TranslationWarmer(new DeepglotWarmFakeClient(), $options, new DeepglotWarmArrayCache());
$cronContextWarmer->enqueue(['Cron context'], 'de', 'en');
warmAssert(
    $GLOBALS['_deepglot_spawned_cron'] === 0,
    'A WP-Cron context must never recursively call spawn_cron().'
);
warmAssert(
    (int) ($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] ?? PHP_INT_MAX) <= time(),
    'A WP-Cron context must still leave its follow-up event due and durable.'
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

// -----------------------------------------------------------------------------
// 6. Human-only contexts that cannot converge on a later page request must
//    stay synchronous even when ordinary page renders default to cache-only.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$cache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $cache);
$translator = new HtmlTranslator($client, $options, $cache, null, $warmer);
$editorResult = $translator->translateForEditor(
    '<!DOCTYPE html><html><body><p>Vorschau</p></body></html>',
    'en',
    'https://example.com/editor/'
);

warmAssert(
    !empty($client->batchCalls),
    'The visual editor must translate cold content synchronously.'
);
warmAssert(
    str_contains($editorResult['html'], '[en] Vorschau') && !empty($editorResult['segments']),
    'The visual editor must receive translated, annotated segments on its first request.'
);

// -----------------------------------------------------------------------------
// 7. A render may enqueue new work while cron is translating an older queue
//    snapshot. That work must survive the completed run.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$cache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $cache);
$warmer->enqueue(['Alpha'], 'de', 'en');
$client->duringBatchCall = static function () use ($warmer): void {
    $warmer->enqueue(['Später hinzugefügt'], 'de', 'en');
};
$warmer->run();

warmAssert(
    in_array('Später hinzugefügt', $warmer->pending()['de|en'] ?? [], true),
    'Work enqueued during a warm run must not be overwritten by the stale queue snapshot.'
);

// A successful HTTP response can still contain fewer pairs than requested.
// Every omitted text needs to remain queued for another attempt.
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$client->partialBatchIndexes = [0];
$cache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $cache);
$warmer->enqueue(['Alpha', 'Beta'], 'de', 'en');
$warmer->run();

warmAssert(
    ($warmer->pending()['de|en'] ?? []) === ['Beta'],
    'Texts omitted from a partial successful response must remain queued.'
);

// A failure on one page must not keep URL-specific caches for an unrelated,
// fully warmed page stale. WP Super Cache exposes only a global purge, so it
// must wait until every tracked page has converged instead of also purging a
// page that remains pending. A later visitor then schedules the retry through
// the real registered cron hook.
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$client->partialBatchIndexes = [0];
$cache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $cache);
$warmer->register();
$warmer->enqueue(['Alpha'], 'de', 'en', 'https://example.com/en/alpha/');
$warmer->enqueue(['Beta'], 'de', 'en', 'https://example.com/en/beta/');
do_action('shutdown');
warmRunScheduledEvent();

warmAssert(
    in_array('https://example.com/en/alpha/', $GLOBALS['_deepglot_purged_urls'], true),
    'A fully warmed page must be purged even while another page in the language pair remains queued.'
);
warmAssert(
    !in_array('https://example.com/en/beta/', $GLOBALS['_deepglot_purged_urls'], true),
    'A page with untranslated queued text must not be purged early.'
);
warmAssert(
    in_array('https://example.com/en/alpha/', $GLOBALS['_deepglot_w3tc_purged_urls'], true)
        && !in_array('https://example.com/en/beta/', $GLOBALS['_deepglot_w3tc_purged_urls'], true),
    'W3 Total Cache must purge only the completed URL.'
);
warmAssert(
    in_array('https://example.com/en/alpha/', $GLOBALS['_deepglot_litespeed_purged_urls'], true)
        && !in_array('https://example.com/en/beta/', $GLOBALS['_deepglot_litespeed_purged_urls'], true),
    'LiteSpeed Cache must purge only the completed URL.'
);
warmAssert(
    $GLOBALS['_deepglot_wp_super_cache_purges'] === 0,
    'WP Super Cache must not globally purge while any tracked page remains pending.'
);
warmAssert(
    ($warmer->pending()['de|en'] ?? []) === ['Beta'],
    'The omitted page text must remain queued after the first cron run.'
);
warmAssert(
    !isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]),
    'A partial provider response must not spin an immediate retry loop.'
);

// Simulate the next visitor request: WordPress rebuilds hook registrations,
// the visitor re-enqueues its still-missing segment, and a second cron run
// completes the cache lifecycle.
$GLOBALS['_deepglot_actions'] = [];
$GLOBALS['_deepglot_scheduled'] = [];
$GLOBALS['_deepglot_spawned_cron'] = 0;
$client->partialBatchIndexes = [];
$retryWarmer = new TranslationWarmer($client, $options, $cache);
$retryWarmer->register();
$retryWarmer->enqueue(['Beta'], 'de', 'en', 'https://example.com/en/beta/');
do_action('shutdown');
warmRunScheduledEvent();

warmAssert(
    empty($retryWarmer->pending()),
    'A later visitor and second cron run must complete the pending retry.'
);
warmAssert(
    in_array('https://example.com/en/beta/', $GLOBALS['_deepglot_purged_urls'], true)
        && in_array('https://example.com/en/beta/', $GLOBALS['_deepglot_w3tc_purged_urls'], true)
        && in_array('https://example.com/en/beta/', $GLOBALS['_deepglot_litespeed_purged_urls'], true),
    'The retry completion must purge the second URL from every URL-aware cache integration.'
);
warmAssert(
    $GLOBALS['_deepglot_wp_super_cache_purges'] === 1,
    'WP Super Cache must receive one global purge only after all tracked pages complete.'
);

$client->reset();
$retryTranslator = new HtmlTranslator($client, $options, $cache, null, $retryWarmer);
$retryHtml = '<!DOCTYPE html><html><body><p>Alpha</p><p>Beta</p></body></html>';
$retryRendered = $retryTranslator->translate(
    $retryHtml,
    'en',
    'https://example.com/en/retry/',
    BotDetector::HUMAN
);
warmAssert(
    empty($client->batchCalls)
        && str_contains($retryRendered, '[en] Alpha')
        && str_contains($retryRendered, '[en] Beta'),
    'After retry completion a later render must use the local cache without another provider call.'
);

// -----------------------------------------------------------------------------
// 8. Once a page has converged in the translation cache, its full-page cache
//    must be purged or visitors can keep receiving the earlier source render.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$cache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $cache);
$warmer->enqueue(['Alpha'], 'de', 'en', 'https://example.com/en/alpha/');
$warmer->run();

warmAssert(
    in_array('https://example.com/en/alpha/', $GLOBALS['_deepglot_purged_urls'], true),
    'A completed warm run must purge the affected page from supported full-page caches.'
);
warmAssert(
    in_array('https://example.com/en/alpha/', $GLOBALS['_deepglot_w3tc_purged_urls'], true)
        && in_array('https://example.com/en/alpha/', $GLOBALS['_deepglot_litespeed_purged_urls'], true)
        && $GLOBALS['_deepglot_wp_super_cache_purges'] === 1,
    'A fully completed queue must exercise W3TC, LiteSpeed, and WP Super Cache purges.'
);

// -----------------------------------------------------------------------------
// 9. The cron lock must be an atomic option claim. A live owner prevents a
//    second runner from dispatching the same provider work.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$warmer = new TranslationWarmer($client, $options, new DeepglotWarmArrayCache());
$warmer->enqueue(['Alpha'], 'de', 'en');
update_option(TranslationWarmer::LOCK_OPTION, [
    'owner' => 'another-cron-run',
    'expires' => time() + TranslationWarmer::LOCK_TTL,
], false);
$warmer->run();

warmAssert(
    $client->translateBatchesCalls === 0,
    'A live atomic lock owner must prevent duplicate warm provider calls.'
);

// -----------------------------------------------------------------------------
// 10. A classified SaaS 429 keeps failed work queued and moves the next warm
//     attempt to the bounded Retry-After time. A visitor enqueue during that
//     window must not replace it with an immediately due cron event.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$client->rateLimitedBatchIndexes = [0];
$warmer = new TranslationWarmer($client, $options, new DeepglotWarmArrayCache());
$warmer->enqueue(['Alpha'], 'de', 'en');
$beforeRateLimit = time();
$warmer->run();
$scheduledAfterRateLimit = (int) ($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] ?? 0);

warmAssert(
    ($warmer->pending()['de|en'] ?? []) === ['Alpha'],
    'A 429 batch must remain queued for a later warm attempt.'
);
warmAssert(
    $scheduledAfterRateLimit >= $beforeRateLimit + 119
        && $scheduledAfterRateLimit <= $beforeRateLimit + 121,
    'The warm queue must honor the bounded 120-second Retry-After instead of retrying immediately.'
);
warmAssert(
    (int) get_option(TranslationWarmer::BACKOFF_OPTION, 0) === $scheduledAfterRateLimit,
    'The warm backoff must survive across cron and visitor requests.'
);

$callsBeforeEarlyRun = $client->translateBatchesCalls;
$warmer->run();
warmAssert(
    $client->translateBatchesCalls === $callsBeforeEarlyRun,
    'A prematurely invoked cron callback must not call the SaaS during its 429 backoff.'
);

$warmer->enqueue(['Beta'], 'de', 'en');
warmAssert(
    (int) ($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] ?? 0) === $scheduledAfterRateLimit,
    'A visitor enqueue must preserve the delayed warm event instead of creating an immediate retry loop.'
);

fwrite(STDOUT, "ColdPageWarmupTest: OK\n");
