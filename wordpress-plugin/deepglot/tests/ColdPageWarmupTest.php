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

if (!class_exists('WP_Error')) {
    class WP_Error
    {
        public function __construct(
            private string $code = '',
            private string $message = '',
            private $data = null
        ) {}

        public function get_error_data() {
            return $this->data;
        }

        public function get_error_message(): string {
            return $this->message;
        }
    }
}

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_options'] = [];
    $GLOBALS['_deepglot_transients'] = [];
    $GLOBALS['_deepglot_after_get_option'] = null;
    $GLOBALS['_deepglot_after_get_transient'] = null;
    $GLOBALS['_deepglot_after_next_scheduled'] = null;
    $GLOBALS['_deepglot_add_option_override'] = null;

    function get_option($key, $default = false) {
        $value = $GLOBALS['_deepglot_options'][$key] ?? $default;
        $callback = $GLOBALS['_deepglot_after_get_option'] ?? null;
        if (is_callable($callback)) {
            $callback($key, $value);
        }

        return $value;
    }

    function update_option($key, $value, $autoload = null) {
        $GLOBALS['_deepglot_options'][$key] = $value;
        return true;
    }

    function add_option($key, $value, $deprecated = '', $autoload = true) {
        $override = $GLOBALS['_deepglot_add_option_override'] ?? null;
        if (is_callable($override)) {
            return (bool) $override($key, $value, $autoload);
        }
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
        $value = $GLOBALS['_deepglot_transients'][$key] ?? false;
        $callback = $GLOBALS['_deepglot_after_get_transient'] ?? null;
        if (is_callable($callback)) {
            $callback($key, $value);
        }

        return $value;
    }

    function set_transient($key, $value, $ttl = 0) {
        $GLOBALS['_deepglot_transients'][$key] = $value;
        return true;
    }

    function delete_transient($key) {
        unset($GLOBALS['_deepglot_transients'][$key]);
        return true;
    }

    function is_wp_error($value) {
        return $value instanceof DeepglotWarmFakeWpError || $value instanceof WP_Error;
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

if (!function_exists('wp_remote_request')) {
    $GLOBALS['_deepglot_remote_requests'] = [];

    if (!function_exists('wp_json_encode')) {
        function wp_json_encode($value) {
            return json_encode($value);
        }
    }

    function wp_remote_request($url, $args = []) {
        $GLOBALS['_deepglot_remote_requests'][] = [
            'url' => (string) $url,
            'args' => is_array($args) ? $args : [],
        ];

        return [
            'response' => ['code' => 200],
            'body' => wp_json_encode([
                'from_words' => ['Legacy race queue'],
                'to_words' => ['Legacy race translated'],
            ]),
            'headers' => [],
        ];
    }

    function wp_remote_retrieve_response_code($response) {
        return (int) ($response['response']['code'] ?? 0);
    }

    function wp_remote_retrieve_body($response) {
        return (string) ($response['body'] ?? '');
    }

    function wp_remote_retrieve_header($response, $name) {
        return (string) ($response['headers'][(string) $name] ?? '');
    }
}

$GLOBALS['_deepglot_filters'] = [];
$GLOBALS['_deepglot_actions'] = [];
$GLOBALS['_deepglot_scheduled'] = [];
$GLOBALS['_deepglot_scheduled_args'] = [];
$GLOBALS['_deepglot_scheduled_event_log'] = [];
$GLOBALS['_deepglot_cleared_scheduled_args'] = [];
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
        $scheduledAt = ($GLOBALS['_deepglot_scheduled_args'][$hook] ?? []) === $args
            ? ($GLOBALS['_deepglot_scheduled'][$hook] ?? false)
            : false;
        $callback = $GLOBALS['_deepglot_after_next_scheduled'] ?? null;
        if (is_callable($callback)) {
            $callback($hook, $args, $scheduledAt);
        }

        return $scheduledAt;
    }

    function wp_schedule_single_event($timestamp, $hook, $args = []) {
        $GLOBALS['_deepglot_scheduled'][$hook] = $timestamp;
        $GLOBALS['_deepglot_scheduled_args'][$hook] = $args;
        $GLOBALS['_deepglot_scheduled_event_log'][] = [
            'timestamp' => $timestamp,
            'hook' => $hook,
            'args' => $args,
        ];
        return true;
    }

    function wp_clear_scheduled_hook($hook, $args = []) {
        $GLOBALS['_deepglot_cleared_scheduled_args'][] = $args;
        $matches = ($GLOBALS['_deepglot_scheduled_args'][$hook] ?? []) === $args;
        $cleared = $matches && isset($GLOBALS['_deepglot_scheduled'][$hook]) ? 1 : 0;
        if ($matches) {
            unset(
                $GLOBALS['_deepglot_scheduled'][$hook],
                $GLOBALS['_deepglot_scheduled_args'][$hook]
            );
        }
        return $cleared;
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
        $callback = $GLOBALS['_deepglot_during_rocket_clean_files'] ?? null;
        if (is_callable($callback)) {
            $callback($urls);
        }
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
require_once __DIR__ . '/../includes/Sync/SettingsSync.php';
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
use Deepglot\Sync\SettingsSync;

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
        $callback = $GLOBALS['_deepglot_before_error_data'] ?? null;
        if (is_callable($callback)) {
            $GLOBALS['_deepglot_before_error_data'] = null;
            $callback();
        }

        return $this->data;
    }
}

class DeepglotWarmQueueWakeupProbe
{
    public function __wakeup(): void
    {
        $GLOBALS['_deepglot_queue_wakeup_calls'] =
            (int) ($GLOBALS['_deepglot_queue_wakeup_calls'] ?? 0) + 1;
    }
}

/** Counts marker-field reads so recursive partition complexity is testable. */
final class DeepglotWarmCountingMarker implements ArrayAccess
{
    public static int $inspections = 0;

    /** @param array<string, mixed> $data */
    public function __construct(private array $data) {}

    public function offsetExists(mixed $offset): bool
    {
        self::$inspections++;
        return is_string($offset) && array_key_exists($offset, $this->data);
    }

    public function offsetGet(mixed $offset): mixed
    {
        self::$inspections++;
        return is_string($offset) ? ($this->data[$offset] ?? null) : null;
    }

    public function offsetSet(mixed $offset, mixed $value): void
    {
        if (is_string($offset)) {
            $this->data[$offset] = $value;
        }
    }

    public function offsetUnset(mixed $offset): void
    {
        if (is_string($offset)) {
            unset($this->data[$offset]);
        }
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

    public int $rateLimitRetryAfter = 120;

    /** Privacy-safe identity of the configuration that received the test 429. */
    public ?string $rateLimitIdentity = null;

    /** @var int[] Indexes that return permanent request oversize. */
    public array $oversizedBatchIndexes = [];

    /** @var string[] Texts that make any containing batch permanently oversize. */
    public array $permanentlyOversizedTexts = [];

    /** Any batch above this test-only size is classified request-oversize. */
    public ?int $maxSuccessfulBatchSize = null;

    /** @var int[] Number of batches passed to each client call. */
    public array $batchesPerTranslateCall = [];

    /** @var int[] Indexes that return only the first requested translation. */
    public array $partialBatchIndexes = [];

    /** @var callable|null Runs once while a warm API request is in flight. */
    public $duringBatchCall = null;

    /** @var callable|null Runs at Client entry before its configuration snapshot. */
    public $beforeBatchConfigurationSnapshot = null;

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

    public function translateBatches(
        array $batches,
        string $langFrom,
        string $langTo,
        string $requestUrl = '',
        int $bot = 0,
        ?int $timeout = null
    ): array
    {
        return $this->fakeTranslateBatches(
            null,
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
        return $this->fakeTranslateBatches(
            $expectedIdentity,
            $batches,
            $langFrom,
            $langTo,
            $requestUrl,
            $bot,
            $timeout
        );
    }

    private function fakeTranslateBatches(
        ?string $expectedIdentity,
        array $batches,
        string $langFrom,
        string $langTo,
        string $requestUrl,
        int $bot,
        ?int $timeout
    ): array
    {
        if (is_callable($this->beforeBatchConfigurationSnapshot)) {
            $callback = $this->beforeBatchConfigurationSnapshot;
            $this->beforeBatchConfigurationSnapshot = null;
            $callback();
        }

        if (
            is_string($expectedIdentity)
            && $expectedIdentity !== ''
            && !hash_equals($expectedIdentity, warmRateIdentity(new Options()))
        ) {
            return array_map(
                static fn(array $batch): DeepglotWarmFakeWpError => new DeepglotWarmFakeWpError(
                    'configuration-changed',
                    ['status' => 409, 'api_code' => 'configuration_changed']
                ),
                $batches
            );
        }

        $this->translateBatchesCalls++;
        $this->batchesPerTranslateCall[] = count($batches);

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
                $rateLimitData = [
                    'status' => 429,
                    'retry_after' => $this->rateLimitRetryAfter,
                    'retry_after_source' => 'delta-seconds',
                    'retry_after_capped' => false,
                ];
                if ($this->rateLimitIdentity !== null) {
                    $rateLimitData['rate_limit_identity'] = $this->rateLimitIdentity;
                }
                $results[$index] = new DeepglotWarmFakeWpError('rate-limited-' . $index, $rateLimitData);
                continue;
            }

            if (
                in_array($index, $this->oversizedBatchIndexes, true)
                || array_intersect($batch, $this->permanentlyOversizedTexts) !== []
                || ($this->maxSuccessfulBatchSize !== null && count($batch) > $this->maxSuccessfulBatchSize)
            ) {
                $results[$index] = new DeepglotWarmFakeWpError('oversized-' . $index, [
                    'status' => 422,
                    'api_code' => 'velocity_request_too_large',
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
        $this->rateLimitIdentity = null;
        $this->oversizedBatchIndexes = [];
        $this->permanentlyOversizedTexts = [];
        $this->maxSuccessfulBatchSize = null;
        $this->batchesPerTranslateCall = [];
        $this->beforeBatchConfigurationSnapshot = null;
    }
}

/** Existing integrations may customize only the original public batch API. */
class DeepglotWarmLegacyBatchOverrideClient extends Client
{
    public int $calls = 0;

    /** @var array<int, string[][]> */
    public array $dispatched = [];

    public function __construct() {}

    public function translateBatches(
        array $batches,
        string $langFrom,
        string $langTo,
        string $requestUrl = '',
        int $bot = 0,
        ?int $timeout = null
    ): array {
        $this->calls++;
        $this->dispatched[] = $batches;

        return array_map(
            static fn(array $batch): array => [
                'from_words' => $batch,
                'to_words' => array_map(
                    static fn(string $text): string => '[legacy] ' . $text,
                    $batch
                ),
            ],
            $batches
        );
    }
}

/** Legacy wrapper that delegates its actual HTTP work to the original API. */
class DeepglotWarmLegacyDelegatingBatchClient extends Client
{
    public int $legacyCalls = 0;

    /** @var callable|null */
    public $beforeParentDispatch = null;

    public function translateBatches(
        array $batches,
        string $langFrom,
        string $langTo,
        string $requestUrl = '',
        int $bot = 0,
        ?int $timeout = null
    ): array {
        $this->legacyCalls++;
        if (is_callable($this->beforeParentDispatch)) {
            $callback = $this->beforeParentDispatch;
            $this->beforeParentDispatch = null;
            $callback();
        }

        return parent::translateBatches(
            $batches,
            $langFrom,
            $langTo,
            $requestUrl,
            $bot,
            $timeout
        );
    }
}

class DeepglotWarmSettingsClient extends DeepglotWarmFakeClient
{
    public function syncSettings(?array $settings = null, ?string $apiKeyOverride = null, ?string $baseUrlOverride = null)
    {
        return ['ok' => true];
    }

    public function fetchRuntimeConfig(?string $apiKeyOverride = null, ?string $baseUrlOverride = null)
    {
        return [];
    }

    public function clearInvalidApiKeyForConfiguration(string $apiKey, string $baseUrl): void
    {
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

$GLOBALS['_deepglot_collected_failures'] = [];

function warmCollectAssert(bool $condition, string $message): void
{
    if (!$condition) {
        $GLOBALS['_deepglot_collected_failures'][] = $message;
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
    $GLOBALS['_deepglot_scheduled_args'] = [];
    $GLOBALS['_deepglot_scheduled_event_log'] = [];
    $GLOBALS['_deepglot_cleared_scheduled_args'] = [];
    $GLOBALS['_deepglot_spawned_cron'] = 0;
    $GLOBALS['_deepglot_spawned_cron_events'] = [];
    $GLOBALS['_deepglot_is_doing_cron'] = false;
    $GLOBALS['_deepglot_purged_urls'] = [];
    $GLOBALS['_deepglot_w3tc_purged_urls'] = [];
    $GLOBALS['_deepglot_litespeed_purged_urls'] = [];
    $GLOBALS['_deepglot_wp_super_cache_purges'] = 0;
    $GLOBALS['_deepglot_during_rocket_clean_files'] = null;
    $GLOBALS['_deepglot_transients'] = [];
    $GLOBALS['_deepglot_after_get_option'] = null;
    $GLOBALS['_deepglot_after_get_transient'] = null;
    $GLOBALS['_deepglot_after_next_scheduled'] = null;
    $GLOBALS['_deepglot_before_error_data'] = null;
    $GLOBALS['_deepglot_add_option_override'] = null;

    foreach (array_keys($GLOBALS['_deepglot_options']) as $key) {
        if (
            str_starts_with((string) $key, 'deepglot_warm_')
            || $key === Client::RATE_LIMIT_OPTION
        ) {
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
    $args = $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK] ?? [];
    unset(
        $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK],
        $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK]
    );
    do_action(TranslationWarmer::HOOK, ...$args);
}

function warmRateIdentity(Options $options): string
{
    return hash(
        'sha256',
        untrailingslashit($options->getApiBaseUrl()) . "\0" . $options->getApiKey()
    );
}

/** @param string[] $batch */
function warmOversizeFingerprint(Options $options, string $sourceLang, string $targetLang, array $batch): string
{
    $configurationKey = hash(
        'sha256',
        untrailingslashit($options->getApiBaseUrl()) . "\0" . $options->getApiKey()
    );
    $shape = json_encode(
        [$sourceLang, $targetLang, array_values($batch)],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );

    return hash_hmac('sha256', "v1\0" . (is_string($shape) ? $shape : ''), $configurationKey);
}

function warmBackoffRetryAt(): int
{
    $marker = get_option(TranslationWarmer::BACKOFF_OPTION, []);

    return is_array($marker) ? (int) ($marker['retry_at'] ?? 0) : 0;
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

// A legacy utf8 (three-byte) wp_options table rejects a serialized option
// value containing a non-BMP character. Persist queue payloads in an
// ASCII-safe envelope while exposing the original text through pending().
warmResetEnvironment();
$GLOBALS['_deepglot_add_option_override'] = static function (
    string $key,
    $value,
    $autoload
): bool {
    if (preg_match('/[\x{10000}-\x{10FFFF}]/u', serialize($value)) === 1) {
        return false;
    }
    if (array_key_exists($key, $GLOBALS['_deepglot_options'])) {
        return false;
    }
    $GLOBALS['_deepglot_options'][$key] = $value;
    return true;
};
$nonBmpWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$nonBmpText = 'Sehr zufrieden 😀';
$nonBmpUrl = 'https://example.com/en/experience/';
$nonBmpWarmer->enqueue([$nonBmpText], 'de', 'en', $nonBmpUrl);

warmAssert(
    ($nonBmpWarmer->pending()['de|en'] ?? []) === [$nonBmpText],
    'A non-BMP source segment must remain durably queued on a legacy utf8 options table.'
);
$rawNonBmpQueue = $GLOBALS['_deepglot_options'][TranslationWarmer::QUEUE_OPTION] ?? null;
$rawNonBmpUrls = $GLOBALS['_deepglot_options'][TranslationWarmer::URL_QUEUE_OPTION] ?? null;
warmAssert(
    is_string($rawNonBmpQueue)
        && preg_match('/[^\x00-\x7F]/', $rawNonBmpQueue) !== 1
        && is_string($rawNonBmpUrls)
        && preg_match('/[^\x00-\x7F]/', $rawNonBmpUrls) !== 1,
    'Text and URL warm queues must be stored in an ASCII-safe option envelope.'
);
$readUrlQueue = new ReflectionMethod(TranslationWarmer::class, 'readUrlQueue');
warmAssert(
    $readUrlQueue->invoke($nonBmpWarmer) === [
        'de|en' => [$nonBmpUrl => [$nonBmpText]],
    ],
    'The ASCII-safe URL queue must expose the original URL and non-BMP text.'
);

// Existing sites already have native array options. Reading them must preserve
// the public queue shape and opportunistically migrate the exact raw value into
// the ASCII-safe envelope instead of requiring a manual reset.
warmResetEnvironment();
$legacyTextQueue = [
    'de|en' => ['Legacy text', 'Legacy emoji 😀'],
];
update_option(TranslationWarmer::QUEUE_OPTION, $legacyTextQueue, false);
$legacyQueueWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
warmAssert(
    $legacyQueueWarmer->pending() === $legacyTextQueue,
    'A legacy native-array text queue must remain readable without data loss.'
);
$migratedTextQueue = get_option(TranslationWarmer::QUEUE_OPTION, false);
warmAssert(
    is_string($migratedTextQueue)
        && preg_match('/[^\x00-\x7F]/', $migratedTextQueue) !== 1,
    'Reading a legacy text queue must migrate it to the ASCII-safe envelope.'
);

// A damaged envelope is untrusted persistence data. Decoding must fail closed
// without warnings, partial queue recovery, or an implicit overwrite.
$corruptedTextQueue = substr($migratedTextQueue, 0, -1)
    . (str_ends_with($migratedTextQueue, 'A') ? 'B' : 'A');
update_option(TranslationWarmer::QUEUE_OPTION, $corruptedTextQueue, false);
warmAssert(
    $legacyQueueWarmer->pending() === []
        && get_option(TranslationWarmer::QUEUE_OPTION, false) === $corruptedTextQueue,
    'A corrupted text queue envelope must fail closed and remain recoverable.'
);
$legacyQueueWarmer->enqueue(
    ['Must not replace damaged persistence'],
    'de',
    'en',
    'https://example.com/en/damaged-queue/'
);
warmAssert(
    get_option(TranslationWarmer::QUEUE_OPTION, false) === $corruptedTextQueue,
    'Enqueue must not silently overwrite a corrupted queue envelope.'
);
warmAssert(
    get_option(TranslationWarmer::URL_QUEUE_OPTION, false) === false,
    'A rejected text-queue mutation must not leave a partial URL-queue write.'
);

warmResetEnvironment();
$wrongTypeTextQueue = ['de|en' => 'not-a-text-list'];
update_option(TranslationWarmer::QUEUE_OPTION, $wrongTypeTextQueue, false);
$legacyQueueWarmer->enqueue(
    ['Must not replace wrong-type persistence'],
    'de',
    'en',
    'https://example.com/en/wrong-type-queue/'
);
warmAssert(
    get_option(TranslationWarmer::QUEUE_OPTION, false) === $wrongTypeTextQueue
        && get_option(TranslationWarmer::URL_QUEUE_OPTION, false) === false,
    'Enqueue must preserve a wrong-type legacy queue and avoid partial URL writes.'
);

warmResetEnvironment();
$urlIntegrityWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$urlIntegrityWarmer->enqueue(
    ['Existing durable text'],
    'de',
    'en',
    'https://example.com/en/existing/'
);
$textBeforeCorruptUrl = get_option(TranslationWarmer::QUEUE_OPTION, false);
$validUrlBeforeCorruption = get_option(TranslationWarmer::URL_QUEUE_OPTION, false);
$corruptedUrlQueue = substr($validUrlBeforeCorruption, 0, -1)
    . (str_ends_with($validUrlBeforeCorruption, 'A') ? 'B' : 'A');
update_option(TranslationWarmer::URL_QUEUE_OPTION, $corruptedUrlQueue, false);
$urlIntegrityWarmer->enqueue(
    ['Must not partially enter text queue'],
    'de',
    'en',
    'https://example.com/en/corrupted-url-queue/'
);
warmAssert(
    get_option(TranslationWarmer::QUEUE_OPTION, false) === $textBeforeCorruptUrl
        && get_option(TranslationWarmer::URL_QUEUE_OPTION, false) === $corruptedUrlQueue,
    'A corrupted URL queue must block both sides of an enqueue mutation.'
);

// If URL tracking loses every optimistic CAS race, the text must not commit
// first and then remain unscheduled without its purge target. Repeated writes
// to the URL option simulate another request winning between each read/CAS.
warmResetEnvironment();
$splitWriteWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$urlReadCount = 0;
$raceUrlA = ['de|en' => ['https://example.com/en/race-a/']];
$raceUrlB = ['de|en' => ['https://example.com/en/race-b/']];
$GLOBALS['_deepglot_after_get_option'] = static function ($key, $value) use (
    &$urlReadCount,
    $raceUrlA,
    $raceUrlB
): void {
    if ($key !== TranslationWarmer::URL_QUEUE_OPTION) {
        return;
    }
    $urlReadCount++;
    if ($urlReadCount < 2) {
        return;
    }
    update_option(
        TranslationWarmer::URL_QUEUE_OPTION,
        $urlReadCount % 2 === 0 ? $raceUrlA : $raceUrlB,
        false
    );
};
$splitWriteWarmer->enqueue(
    ['Must stay coupled to its purge target'],
    'de',
    'en',
    'https://example.com/en/split-write/'
);
$GLOBALS['_deepglot_after_get_option'] = null;
warmAssert(
    !in_array(
        'Must stay coupled to its purge target',
        $splitWriteWarmer->pending()['de|en'] ?? [],
        true
    ),
    'An exhausted URL-queue CAS must not leave a text-only queue write behind.'
);
warmAssert(
    !isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]),
    'A rejected coupled enqueue must not claim that warm work was scheduled.'
);

// A previous cron run may reconcile and purge while a new frontend enqueue is
// between its URL-first and text writes. The coupled mutation must prevent the
// purge from treating the new URL tracking as already completed in that gap.
warmResetEnvironment();
$interleavedUrl = 'https://example.com/en/enqueue-purge-race/';
update_option(TranslationWarmer::URL_QUEUE_OPTION, [
    'de|en' => [$interleavedUrl => ['Previously completed text']],
], false);
$interleavedWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$purgeCompletedUrls = new ReflectionMethod(TranslationWarmer::class, 'purgeCompletedUrls');
$textQueueReadCount = 0;
$GLOBALS['_deepglot_after_get_option'] = static function ($key, $value) use (
    &$textQueueReadCount,
    $interleavedWarmer,
    $purgeCompletedUrls
): void {
    if ($key !== TranslationWarmer::QUEUE_OPTION) {
        return;
    }
    $textQueueReadCount++;
    if ($textQueueReadCount !== 3) {
        return;
    }
    $GLOBALS['_deepglot_after_get_option'] = null;
    $purgeCompletedUrls->invoke($interleavedWarmer, ['de|en']);
};
$interleavedWarmer->enqueue(
    ['New text'],
    'de',
    'en',
    $interleavedUrl
);
$GLOBALS['_deepglot_after_get_option'] = null;
$interleavedUrlsAfter = $readUrlQueue->invoke($interleavedWarmer);
warmAssert(
    ($interleavedWarmer->pending()['de|en'] ?? []) === ['New text']
        && ($interleavedUrlsAfter['de|en'][$interleavedUrl] ?? []) === [
            'Previously completed text',
            'New text',
        ]
        && !in_array($interleavedUrl, $GLOBALS['_deepglot_purged_urls'], true),
    'An in-flight purge must not split a URL-first enqueue before its text write.'
);

// Disabling the plugin (or removing its key) clears both queues. That cleanup
// must use the same short mutation lock: otherwise it can delete URL tracking
// after the URL-first CAS but before the corresponding text CAS commits.
warmResetEnvironment();
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_disable_race',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$disableRaceWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$disableRaceIdentity = warmRateIdentity($options);
$disableRaceUrl = 'https://example.com/en/disable-race/';
$disableRaceQueueReads = 0;
$GLOBALS['_deepglot_after_get_option'] = static function ($key, $value) use (
    &$disableRaceQueueReads,
    $disableRaceWarmer,
    $disableRaceIdentity
): void {
    if ($key !== TranslationWarmer::QUEUE_OPTION) {
        return;
    }

    $disableRaceQueueReads++;
    if ($disableRaceQueueReads !== 3) {
        return;
    }

    $GLOBALS['_deepglot_after_get_option'] = null;
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => false,
        'api_key' => 'dg_disable_race',
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
    $disableRaceWarmer->runForIdentity($disableRaceIdentity);
};
$disableRaceWarmer->enqueue(
    ['New text during disable'],
    'de',
    'en',
    $disableRaceUrl
);
$GLOBALS['_deepglot_after_get_option'] = null;
$disableRacePending = $disableRaceWarmer->pending();
$disableRaceUrls = $readUrlQueue->invoke($disableRaceWarmer);
warmAssert(
    (($disableRacePending['de|en'] ?? []) === ['New text during disable'])
        === (($disableRaceUrls['de|en'][$disableRaceUrl] ?? []) === ['New text during disable']),
    'Configuration cleanup must not split an in-flight URL/text enqueue mutation.'
);
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));

// The queue mutation lock is a separate, short owner claim. A live owner wins,
// a stale owner may be replaced atomically, and neither an old nor an unrelated
// owner may release the replacement.
warmResetEnvironment();
$mutationLockWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$acquireMutationLock = new ReflectionMethod(TranslationWarmer::class, 'acquireMutationLock');
$releaseMutationLock = new ReflectionMethod(TranslationWarmer::class, 'releaseMutationLock');
$firstMutationOwner = $acquireMutationLock->invoke($mutationLockWarmer);
$firstMutationLock = get_option(TranslationWarmer::MUTATION_LOCK_OPTION, false);
$contendingMutationOwner = $acquireMutationLock->invoke($mutationLockWarmer);
$releaseMutationLock->invoke($mutationLockWarmer, 'not-the-owner');
warmAssert(
    is_string($firstMutationOwner)
        && $firstMutationOwner !== ''
        && $contendingMutationOwner === null
        && get_option(TranslationWarmer::MUTATION_LOCK_OPTION, false) === $firstMutationLock,
    'A live queue mutation owner must reject contention and survive an unrelated release.'
);

$expiredMutationLock = [
    'owner' => 'expired-owner',
    'expires' => time() - 1,
];
update_option(TranslationWarmer::MUTATION_LOCK_OPTION, $expiredMutationLock, false);
$replacementMutationOwner = $acquireMutationLock->invoke($mutationLockWarmer);
$replacementMutationLock = get_option(TranslationWarmer::MUTATION_LOCK_OPTION, false);
$releaseMutationLock->invoke($mutationLockWarmer, 'expired-owner');
$afterExpiredOwnerRelease = get_option(TranslationWarmer::MUTATION_LOCK_OPTION, false);
$releaseMutationLock->invoke($mutationLockWarmer, (string) $replacementMutationOwner);
warmAssert(
    is_string($replacementMutationOwner)
        && $replacementMutationOwner !== ''
        && is_array($replacementMutationLock)
        && ($replacementMutationLock['owner'] ?? null) === $replacementMutationOwner
        && $afterExpiredOwnerRelease === $replacementMutationLock
        && get_option(TranslationWarmer::MUTATION_LOCK_OPTION, false) === false,
    'An expired queue mutation lock must be replaceable without allowing its old owner to release the replacement.'
);

// A process can die after its URL-first CAS and before its text CAS. The stale
// lock is the durable evidence that this window may have occurred. Its next
// owner must reconcile every URL-only entry so it cannot permanently suppress
// the later global WP Super Cache purge.
warmResetEnvironment();
$crashedUrl = 'https://example.com/fr/crashed-url-first/';
update_option(TranslationWarmer::URL_QUEUE_OPTION, [
    'de|fr' => [$crashedUrl => ['Crash-window text']],
], false);
update_option(TranslationWarmer::MUTATION_LOCK_OPTION, [
    'owner' => 'crashed-url-first-owner',
    'expires' => time() - 1,
], false);
$crashRecoveryWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$afterCrashUrl = 'https://example.com/en/after-crash/';
$crashRecoveryWarmer->enqueue(
    ['Work after crashed enqueue'],
    'de',
    'en',
    $afterCrashUrl
);
$crashRecoveryWarmer->run();
$urlQueueAfterCrashRecovery = $readUrlQueue->invoke($crashRecoveryWarmer);
warmAssert(
    $crashRecoveryWarmer->pending() === []
        && $urlQueueAfterCrashRecovery === []
        && in_array($crashedUrl, $GLOBALS['_deepglot_purged_urls'], true)
        && in_array($afterCrashUrl, $GLOBALS['_deepglot_purged_urls'], true)
        && $GLOBALS['_deepglot_wp_super_cache_purges'] === 1,
    'Expired mutation-lock recovery must purge URL-only crash residue before later work completes.'
);

// Recovery may call third-party cache integrations. If that work outlives the
// 15-second lease and another request replaces the owner, acquire must not hand
// the stale owner back to code that will mutate both queues.
warmResetEnvironment();
$leaseLossUrl = 'https://example.com/fr/recovery-lease-loss/';
update_option(TranslationWarmer::URL_QUEUE_OPTION, [
    'de|fr' => [$leaseLossUrl => ['Lease-loss crash text']],
], false);
update_option(TranslationWarmer::MUTATION_LOCK_OPTION, [
    'owner' => 'expired-before-slow-recovery',
    'expires' => time() - 1,
], false);
$leaseLossWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$foreignOwnerAfterRecovery = [
    'owner' => 'new-foreign-owner',
    'expires' => time() + TranslationWarmer::MUTATION_LOCK_TTL,
];
$replacedDuringRecovery = false;
$GLOBALS['_deepglot_during_rocket_clean_files'] = static function () use (
    &$replacedDuringRecovery,
    $foreignOwnerAfterRecovery
): void {
    $replacedDuringRecovery = true;
    update_option(
        TranslationWarmer::MUTATION_LOCK_OPTION,
        $foreignOwnerAfterRecovery,
        false
    );
};
$ownerReturnedAfterRecovery = $acquireMutationLock->invoke($leaseLossWarmer);
$GLOBALS['_deepglot_during_rocket_clean_files'] = null;
$actualOwnerAfterRecovery = get_option(TranslationWarmer::MUTATION_LOCK_OPTION, false);
warmAssert(
    $replacedDuringRecovery
        && $actualOwnerAfterRecovery === $foreignOwnerAfterRecovery
        && $ownerReturnedAfterRecovery === null,
    'A stale owner lost during crash recovery must never be returned as the current mutation owner.'
);

// Provider work precedes the short mutation claim. If reconciliation later
// contends, translated cache data remains useful while both queues stay intact
// and a bounded delayed retry replaces the current cron event.
warmResetEnvironment();
$providerLockClient = new DeepglotWarmFakeClient();
$mutationLockDuringProvider = null;
$providerLockClient->duringBatchCall = static function () use (&$mutationLockDuringProvider): void {
    $mutationLockDuringProvider = get_option(TranslationWarmer::MUTATION_LOCK_OPTION, false);
};
$providerLockWarmer = new TranslationWarmer(
    $providerLockClient,
    $options,
    new DeepglotWarmArrayCache()
);
$providerLockUrl = 'https://example.com/en/provider-lock-boundary/';
$providerLockWarmer->enqueue(['Provider lock boundary'], 'de', 'en', $providerLockUrl);
$providerLockWarmer->run();
warmAssert(
    $providerLockClient->translateBatchesCalls === 1
        && $mutationLockDuringProvider === false
        && in_array($providerLockUrl, $GLOBALS['_deepglot_purged_urls'], true),
    'Warm provider work must finish before the short queue mutation lock is acquired.'
);

warmResetEnvironment();
$contendedDrainClient = new DeepglotWarmFakeClient();
$contendedDrainWarmer = new TranslationWarmer(
    $contendedDrainClient,
    $options,
    new DeepglotWarmArrayCache()
);
$contendedDrainUrl = 'https://example.com/en/contended-reconciliation/';
$contendedDrainWarmer->enqueue(['Contended reconciliation'], 'de', 'en', $contendedDrainUrl);
$foreignMutationLock = [
    'owner' => 'foreign-enqueue',
    'expires' => time() + TranslationWarmer::MUTATION_LOCK_TTL,
];
update_option(TranslationWarmer::MUTATION_LOCK_OPTION, $foreignMutationLock, false);
$beforeMutationRetry = time();
$contendedDrainWarmer->run();
$contendedDrainUrls = $readUrlQueue->invoke($contendedDrainWarmer);
$mutationRetryAt = (int) ($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] ?? 0);
warmAssert(
    $contendedDrainClient->translateBatchesCalls === 1
        && ($contendedDrainWarmer->pending()['de|en'] ?? []) === ['Contended reconciliation']
        && ($contendedDrainUrls['de|en'][$contendedDrainUrl] ?? []) === ['Contended reconciliation']
        && get_option(TranslationWarmer::MUTATION_LOCK_OPTION, false) === $foreignMutationLock
        && !in_array($contendedDrainUrl, $GLOBALS['_deepglot_purged_urls'], true)
        && $mutationRetryAt >= $beforeMutationRetry + 4
        && $mutationRetryAt <= $beforeMutationRetry + 6,
    'A contended drain must preserve both queues and the foreign lock while scheduling a bounded reconciliation retry.'
);

$GLOBALS['_deepglot_queue_wakeup_calls'] = 0;
$encodeQueueOption = new ReflectionMethod(TranslationWarmer::class, 'encodeQueueOption');
$objectEnvelope = $encodeQueueOption->invoke(
    $legacyQueueWarmer,
    TranslationWarmer::QUEUE_OPTION,
    ['de|en' => [new DeepglotWarmQueueWakeupProbe()]]
);
update_option(TranslationWarmer::QUEUE_OPTION, $objectEnvelope, false);
warmAssert(
    $legacyQueueWarmer->pending() === []
        && $GLOBALS['_deepglot_queue_wakeup_calls'] === 0,
    'Queue envelope decoding must reject objects without invoking their wakeup hooks.'
);

// Migration is a compare-and-set against the exact legacy raw value. A writer
// that wins after the read must survive instead of being replaced by the stale
// migration snapshot.
warmResetEnvironment();
$legacyRaceA = ['de|en' => ['Legacy snapshot A']];
$legacyRaceB = ['de|en' => ['Concurrent snapshot B']];
update_option(TranslationWarmer::QUEUE_OPTION, $legacyRaceA, false);
$GLOBALS['_deepglot_after_get_option'] = static function ($key, $value) use ($legacyRaceB): void {
    if ($key !== TranslationWarmer::QUEUE_OPTION) {
        return;
    }
    $GLOBALS['_deepglot_after_get_option'] = null;
    update_option(TranslationWarmer::QUEUE_OPTION, $legacyRaceB, false);
};
$legacyQueueWarmer->pending();
warmAssert(
    get_option(TranslationWarmer::QUEUE_OPTION, false) === $legacyRaceB,
    'Legacy migration must not overwrite a concurrent queue writer.'
);

// wp_options normally compares LONGTEXT under a case-insensitive collation.
// A case-only concurrent change therefore needs an explicit byte-exact SQL
// predicate; ordinary $wpdb->update() can match and replace the newer value.
warmResetEnvironment();
$legacyCaseA = ['de|en' => ['Alpha']];
$legacyCaseB = ['de|en' => ['alpha']];
update_option(TranslationWarmer::QUEUE_OPTION, $legacyCaseA, false);
$GLOBALS['_deepglot_after_get_option'] = static function ($key, $value) use ($legacyCaseB): void {
    if ($key !== TranslationWarmer::QUEUE_OPTION) {
        return;
    }
    $GLOBALS['_deepglot_after_get_option'] = null;
    update_option(TranslationWarmer::QUEUE_OPTION, $legacyCaseB, false);
};
$GLOBALS['wpdb'] = new class {
    public string $options = 'wp_options';
    public bool $usedBinaryComparison = false;
    /** @var mixed[] */
    private array $preparedArgs = [];

    public function update($table, $data, $where, $format = null, $whereFormat = null): int
    {
        $actual = get_option($where['option_name'], false);
        $actualStored = is_array($actual) || is_object($actual)
            ? serialize($actual)
            : (string) $actual;
        if (strcasecmp($actualStored, (string) $where['option_value']) !== 0) {
            return 0;
        }
        update_option($where['option_name'], $data['option_value'], false);
        return 1;
    }

    public function delete($table, $where, $whereFormat = null): int
    {
        return 0;
    }

    public function prepare($query, ...$args): string
    {
        $this->usedBinaryComparison = stripos((string) $query, 'binary') !== false;
        $this->preparedArgs = $args;
        return (string) $query;
    }

    public function query($query): int
    {
        if (!$this->usedBinaryComparison || count($this->preparedArgs) < 2) {
            return 0;
        }
        if (count($this->preparedArgs) === 2) {
            [$option, $expected] = $this->preparedArgs;
            $next = null;
        } else {
            [$next, $option, $expected] = $this->preparedArgs;
        }
        $actual = get_option((string) $option, false);
        $actualStored = is_array($actual) || is_object($actual)
            ? serialize($actual)
            : (string) $actual;
        if (!hash_equals((string) $expected, $actualStored)) {
            return 0;
        }
        if (count($this->preparedArgs) === 2) {
            delete_option((string) $option);
        } else {
            update_option((string) $option, $next, false);
        }
        return 1;
    }
};
$caseRaceWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$caseRaceWarmer->pending();
$caseRaceUsedBinary = $GLOBALS['wpdb']->usedBinaryComparison;
warmAssert(
    get_option(TranslationWarmer::QUEUE_OPTION, false) === $legacyCaseB
        && $caseRaceUsedBinary,
    'Legacy queue migration must compare the expected option bytes exactly.'
);

$compareAndStoreQueue = new ReflectionMethod(TranslationWarmer::class, 'compareAndStoreOption');
update_option(TranslationWarmer::QUEUE_OPTION, $legacyCaseB, false);
$caseOnlyDeleteResult = $compareAndStoreQueue->invoke(
    $caseRaceWarmer,
    TranslationWarmer::QUEUE_OPTION,
    $legacyCaseA,
    []
);
warmAssert(
    $caseOnlyDeleteResult === false
        && get_option(TranslationWarmer::QUEUE_OPTION, false) === $legacyCaseB,
    'Queue deletion CAS must not match a case-only concurrent option value.'
);
update_option(TranslationWarmer::QUEUE_OPTION, $legacyCaseA, false);
$exactDeleteResult = $compareAndStoreQueue->invoke(
    $caseRaceWarmer,
    TranslationWarmer::QUEUE_OPTION,
    $legacyCaseA,
    []
);
$caseRaceUsedBinaryDelete = $GLOBALS['wpdb']->usedBinaryComparison;
unset($GLOBALS['wpdb']);
warmAssert(
    $exactDeleteResult === true
        && get_option(TranslationWarmer::QUEUE_OPTION, false) === false
        && $caseRaceUsedBinaryDelete,
    'Queue deletion CAS must delete one byte-exact expected option value.'
);

// Legacy URL queues used a language-pair => URL[] shape. The reader still
// normalizes that wildcard shape and migrates the raw option atomically.
warmResetEnvironment();
$legacyUrl = 'https://example.com/en/legacy-page/';
update_option(TranslationWarmer::URL_QUEUE_OPTION, [
    'de|en' => [$legacyUrl],
], false);
$legacyUrlWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$normalizedLegacyUrls = $readUrlQueue->invoke($legacyUrlWarmer);
warmAssert(
    $normalizedLegacyUrls === ['de|en' => [$legacyUrl => []]],
    'A legacy URL list must retain its backward-compatible wildcard semantics.'
);
$migratedUrlQueue = get_option(TranslationWarmer::URL_QUEUE_OPTION, false);
warmAssert(
    is_string($migratedUrlQueue)
        && preg_match('/[^\x00-\x7F]/', $migratedUrlQueue) !== 1,
    'Reading a legacy URL queue must migrate it to the ASCII-safe envelope.'
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
    warmBackoffRetryAt() === $scheduledAfterRateLimit,
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

// -----------------------------------------------------------------------------
// 11. The SaaS velocity limit is organization-wide. After one language pair
//     returns 429, the same cron run must not spend more requests on another
//     pair; untouched work stays queued for the delayed retry.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$client->rateLimitedBatchIndexes = [0];
$warmer = new TranslationWarmer($client, $options, new DeepglotWarmArrayCache());
$warmer->enqueue(['English pending'], 'de', 'en');
$warmer->enqueue(['French untouched'], 'de', 'fr');
$beforeCrossLanguageRateLimit = time();
$warmer->run();
$scheduledAfterCrossLanguageRateLimit = (int) ($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] ?? 0);

warmAssert(
    $client->translateBatchesCalls === 1,
    'An organization-wide 429 must stop the outer language-pair loop after exactly one client call.'
);
warmAssert(
    ($warmer->pending()['de|en'] ?? []) === ['English pending']
        && ($warmer->pending()['de|fr'] ?? []) === ['French untouched'],
    'The rate-limited pair and every untouched language pair must remain queued unchanged.'
);
warmAssert(
    $scheduledAfterCrossLanguageRateLimit >= $beforeCrossLanguageRateLimit + 119
        && $scheduledAfterCrossLanguageRateLimit <= $beforeCrossLanguageRateLimit + 121
        && warmBackoffRetryAt() === $scheduledAfterCrossLanguageRateLimit,
    'A cross-language 429 must persist and schedule the bounded Retry-After delay.'
);

// -----------------------------------------------------------------------------
// 12. The SaaS velocity limiter uses a fixed one-hour window. A known reset
//     must not be shortened to five minutes and retried up to twelve times.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$client->rateLimitedBatchIndexes = [0];
$client->rateLimitRetryAfter = 3600;
$warmer = new TranslationWarmer($client, $options, new DeepglotWarmArrayCache());
$warmer->enqueue(['Full fixed-window delay'], 'de', 'en');
$beforeFixedWindowRateLimit = time();
$warmer->run();
$scheduledAfterFixedWindowRateLimit = (int) ($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] ?? 0);

warmAssert(
    $scheduledAfterFixedWindowRateLimit >= $beforeFixedWindowRateLimit + 3599
        && $scheduledAfterFixedWindowRateLimit <= $beforeFixedWindowRateLimit + 3601,
    'A known hourly Retry-After must schedule near 3,600 seconds, not the former 300-second cap.'
);

// -----------------------------------------------------------------------------
// 13. If an inline page request already received 429, enqueue must reuse the
//     client marker instead of immediately nudging the same work into cron.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$knownRetryAt = time() + 3600;
set_transient(Client::RATE_LIMIT_TRANSIENT, [
    'retry_at' => $knownRetryAt,
    'identity' => warmRateIdentity($options),
], 3600);
$client = new DeepglotWarmFakeClient();
$warmer = new TranslationWarmer($client, $options, new DeepglotWarmArrayCache());
$warmer->enqueue(['Inline 429 pending'], 'de', 'en');
$scheduledAfterInlineRateLimit = (int) ($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] ?? 0);

warmAssert(
    $scheduledAfterInlineRateLimit >= $knownRetryAt - 1
        && $scheduledAfterInlineRateLimit <= $knownRetryAt + 1
        && warmBackoffRetryAt() === $scheduledAfterInlineRateLimit,
    'A synchronous page 429 must flow into the persisted delayed warmer schedule.'
);
warmAssert(
    $GLOBALS['_deepglot_spawned_cron'] === 0,
    'A synchronous page 429 must not immediately nudge WP-Cron during its known backoff.'
);

// -----------------------------------------------------------------------------
// 14. Permanent oversize is not a timer condition. Keep the batch for an
//     operator-visible split, but do not create an automatic cron retry loop.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$client->oversizedBatchIndexes = [0];
$warmer = new TranslationWarmer($client, $options, new DeepglotWarmArrayCache());
$warmer->register();
$warmer->enqueue(['Permanently oversized batch'], 'de', 'en');
warmRunScheduledEvent();

warmAssert(
    $client->translateBatchesCalls === 1
        && ($warmer->pending()['de|en'] ?? []) === ['Permanently oversized batch'],
    'An oversized batch must remain queued without being mistaken for success.'
);
warmAssert(
    !isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK])
        && warmBackoffRetryAt() === 0,
    'Permanent oversize must not create a Retry-After timer loop.'
);

$callsAfterPermanentOversize = $client->translateBatchesCalls;
$warmer->enqueue(['Permanently oversized batch'], 'de', 'en');
warmRunScheduledEvent();
warmAssert(
    $client->translateBatchesCalls === $callsAfterPermanentOversize,
    'An identical visitor enqueue must not resend a batch already classified as permanent oversize.'
);
warmAssert(
    !isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]),
    'A repeated permanent oversize enqueue must not recreate an automatic timer loop.'
);

// -----------------------------------------------------------------------------
// 15. A newly classified oversized batch must not suppress the follow-up that
//     ordinary work beyond this run's budget still needs. The follow-up skips
//     the fingerprinted batch, completes normal work, then ends timer-free.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$client->oversizedBatchIndexes = [0];
$deferredCache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $deferredCache);
$warmer->register();
$oversizedQueue = [];
for ($index = 0; $index < 301; $index++) {
    $oversizedQueue[] = 'Permanently oversized segment ' . $index;
}
$warmer->enqueue($oversizedQueue, 'de', 'en');
warmRunScheduledEvent();

warmAssert(
    $client->translateBatchesCalls === 1
        && count($warmer->pending()['de|en'] ?? []) === 51,
    'The oversized batch and one deferred normal segment must remain while five normal batches complete.'
);
warmAssert(
    isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]),
    'A new permanent oversize result must not suppress the follow-up required by ordinary deferred work.'
);

$client->oversizedBatchIndexes = [];
warmRunScheduledEvent();
warmAssert(
    $client->translateBatchesCalls === 2
        && ($warmer->pending()['de|en'] ?? []) === []
        && count($deferredCache->getMany($oversizedQueue, 'de', 'en')) === count($oversizedQueue),
    'The follow-up must split the multi-text 422 and finish every now-valid deferred segment.'
);
warmAssert(
    !isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]),
    'After split and deferred work complete, the warmer must not create a timer loop.'
);

// -----------------------------------------------------------------------------
// 16. Blocking a proven oversized leading batch must not starve ordinary work
//     that still fits in a later batch of the same language pair.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$client->permanentlyOversizedTexts = ['Individually oversized leading'];
$cache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $cache);
$warmer->register();
$mixedQueue = ['Individually oversized leading'];
for ($index = 1; $index < 50; $index++) {
    $mixedQueue[] = 'Ordinary leading segment ' . $index;
}
$mixedQueue[] = 'Ordinary trailing work';
$warmer->enqueue($mixedQueue, 'de', 'en');
warmRunScheduledEvent();

$mixedRuns = 1;
while (isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]) && $mixedRuns < 8) {
    warmRunScheduledEvent();
    $mixedRuns++;
}

warmAssert(
    ($warmer->pending()['de|en'] ?? []) === ['Individually oversized leading'],
    'Binary isolation must keep only the single text that still returns 422 alone.'
);
warmAssert(
    count($cache->getMany(array_slice($mixedQueue, 1), 'de', 'en')) === count($mixedQueue) - 1,
    'A content-bound oversized text must not starve normal work from its batch or the trailing batch.'
);
warmAssert(
    !isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]),
    'Mixed oversize and completed work must not leave an automatic retry timer.'
);

// -----------------------------------------------------------------------------
// 17. A cron event may already be due when a separate synchronous render learns
//     about a later 429. run() must consult the client marker again before send.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$warmer = new TranslationWarmer($client, $options, new DeepglotWarmArrayCache());
$warmer->register();
$warmer->enqueue(['Already due before 429'], 'de', 'en');
$laterRetryAt = time() + 1800;
set_transient(Client::RATE_LIMIT_TRANSIENT, [
    'retry_at' => $laterRetryAt,
    'identity' => warmRateIdentity($options),
], 1800);
warmRunScheduledEvent();
$rescheduledAfterLateMarker = (int) ($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] ?? 0);

warmAssert(
    $client->translateBatchesCalls === 0,
    'A due warmer event must recheck a later 429 marker before any client call.'
);
warmAssert(
    $rescheduledAfterLateMarker >= $laterRetryAt - 1
        && $rescheduledAfterLateMarker <= $laterRetryAt + 1
        && warmBackoffRetryAt() === $rescheduledAfterLateMarker,
    'A due warmer event must persist and move itself to the later client retry_at.'
);

// -----------------------------------------------------------------------------
// 18. The one-hour suppression contract must cover every oversized batch still
//     in the bounded per-language queues. An arbitrary global marker cap must
//     not evict older shapes into an automatic resend/starvation loop.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$client->oversizedBatchIndexes = [0];
$warmer = new TranslationWarmer($client, $options, new DeepglotWarmArrayCache());
$warmer->register();

$manyTargetLanguages = [];
for ($index = 0; $index < 80; $index++) {
    $targetLanguage = 'target-' . $index;
    $manyTargetLanguages[] = $targetLanguage;
    $warmer->enqueue([$targetLanguage . ' permanent segment'], 'de', $targetLanguage);
}

$oversizeRuns = 0;
while (isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]) && $oversizeRuns < 30) {
    warmRunScheduledEvent();
    $oversizeRuns++;
}

$dispatchedBatchShapes = array_map(
    static fn(array $batch): string => hash('sha256', serialize($batch)),
    $client->batchCalls
);
warmAssert(
    count($dispatchedBatchShapes) === 80
        && count(array_unique($dispatchedBatchShapes)) === 80,
    'Every queued oversized batch shape must be sent at most once during its one-hour suppression window.'
);
warmAssert(
    !isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]),
    'After all oversized batch shapes are classified, the automatic Cron chain must end without starvation.'
);
foreach ($manyTargetLanguages as $targetLanguage) {
    warmAssert(
        count($warmer->pending()['de|' . $targetLanguage] ?? []) === 1,
        'Every singleton 422 must remain queued for an explicit input or configuration change.'
    );
}

// -----------------------------------------------------------------------------
// 19. Appending normal work to a short, fingerprinted oversized batch must not
//     change the chunk shape and resend the permanent text with its new tail.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$client->permanentlyOversizedTexts = ['Known partial oversize'];
$partialCache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $partialCache);
$warmer->register();
$warmer->enqueue(['Known partial oversize'], 'de', 'en');
warmRunScheduledEvent();

warmAssert(
    $client->translateBatchesCalls === 1
        && ($warmer->pending()['de|en'] ?? []) === ['Known partial oversize'],
    'The initial short oversized batch must be classified and remain queued.'
);

$warmer->enqueue(['Ordinary appended work'], 'de', 'en');
warmRunScheduledEvent();
$laterBatchCalls = array_slice($client->batchCalls, 1);

warmAssert(
    $client->translateBatchesCalls === 2
        && $laterBatchCalls === [['Ordinary appended work']],
    'Appending normal work must not resend or bind it to the known permanent oversized prefix.'
);
warmAssert(
    ($warmer->pending()['de|en'] ?? []) === ['Known partial oversize']
        && isset($partialCache->getMany(['Ordinary appended work'], 'de', 'en')['Ordinary appended work']),
    'The known oversized prefix must stay queued while newly appended normal work completes.'
);
warmAssert(
    !isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]),
    'A completed appended tail plus known oversize must end without a timer loop.'
);

// -----------------------------------------------------------------------------
// 20. A 422 classifies the self-built request shape, not every member text.
//     Split a mixed batch until only the individually proven oversize text is
//     blocked; ordinary work from the same original batch must still converge.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$client->permanentlyOversizedTexts = ['Individually oversized'];
$isolationCache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $isolationCache);
$warmer->register();
$warmer->enqueue(['Individually oversized', 'Ordinary mixed work'], 'de', 'en');
warmRunScheduledEvent();

$mixedIsolationRuns = 1;
while (isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]) && $mixedIsolationRuns < 6) {
    warmRunScheduledEvent();
    $mixedIsolationRuns++;
}

$mixedIsolationDispatches = $client->batchCalls;
$mixedIsolationTail = array_slice($mixedIsolationDispatches, 1);
warmCollectAssert(
    $mixedIsolationDispatches[0] === ['Individually oversized', 'Ordinary mixed work']
        && $mixedIsolationTail === [['Individually oversized'], ['Ordinary mixed work']],
    'A mixed 422 batch must be retried only as bounded smaller requests that isolate its texts.'
);
warmCollectAssert(
    ($warmer->pending()['de|en'] ?? []) === ['Individually oversized']
        && isset($isolationCache->getMany(['Ordinary mixed work'], 'de', 'en')['Ordinary mixed work']),
    'Only the individually confirmed oversize text may remain while normal mixed work is cached.'
);
warmCollectAssert(
    !isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK])
        && max($client->batchesPerTranslateCall) <= TranslationWarmer::MAX_BATCHES_PER_RUN,
    'Mixed-batch isolation must finish without a timer loop or exceeding the per-run batch budget.'
);

// -----------------------------------------------------------------------------
// 21. A group may be oversized only in aggregate even though each smaller
//     request is valid. Bounded binary splitting must drain it without asking
//     an operator to reconstruct the warmer's private batch boundaries.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$client = new DeepglotWarmFakeClient();
$client->maxSuccessfulBatchSize = 2;
$aggregateCache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $aggregateCache);
$warmer->register();
$aggregateTexts = [];
for ($index = 0; $index < 8; $index++) {
    $aggregateTexts[] = 'Aggregate valid segment ' . $index;
}
$warmer->enqueue($aggregateTexts, 'de', 'en');
warmRunScheduledEvent();

$aggregateSplitRuns = 1;
while (isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]) && $aggregateSplitRuns < 10) {
    warmRunScheduledEvent();
    $aggregateSplitRuns++;
}

warmCollectAssert(
    ($warmer->pending()['de|en'] ?? []) === []
        && count($aggregateCache->getMany($aggregateTexts, 'de', 'en')) === count($aggregateTexts),
    'An aggregate-only oversize batch must fully converge through smaller valid requests.'
);
warmCollectAssert(
    count($client->batchCalls) === 7
        && max($client->batchesPerTranslateCall) <= TranslationWarmer::MAX_BATCHES_PER_RUN,
    'Binary oversize isolation must remain bounded instead of exploding the request count.'
);
warmCollectAssert(
    !isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]),
    'Aggregate-only oversize isolation must end its Cron chain after all smaller requests succeed.'
);

// -----------------------------------------------------------------------------
// 22. A persisted warmer delay belongs to the key/backend that received its
//     429. Switching configuration must replace the old future event with an
//     immediately due run and allow the new backend to translate.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$oldRateKey = 'dg_old_warmer_rate';
$oldRateBase = 'https://old-rate.deepglot.test/api';
$newRateKey = 'dg_new_warmer_rate';
$newRateBase = 'https://new-rate.deepglot.test/api';
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $oldRateKey,
    'api_base_url' => $oldRateBase,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$client = new DeepglotWarmFakeClient();
$client->rateLimitedBatchIndexes = [0];
$client->rateLimitRetryAfter = 3600;
$client->rateLimitIdentity = hash('sha256', $oldRateBase . "\0" . $oldRateKey);
$identityCache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $identityCache);
$warmer->register();
$warmer->enqueue(['Old identity pending'], 'de', 'en');
warmRunScheduledEvent();
$oldIdentityBackoffMarker = get_option(TranslationWarmer::BACKOFF_OPTION, false);

update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $newRateKey,
    'api_base_url' => $newRateBase,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$client->rateLimitedBatchIndexes = [];
$client->rateLimitIdentity = null;
$warmer->enqueue(['New identity work'], 'de', 'en');
$scheduledAfterRateIdentityChange = (int) ($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] ?? PHP_INT_MAX);
warmCollectAssert(
    $scheduledAfterRateIdentityChange <= time(),
    'A key/backend change must replace the previous identity delay with an immediately due warm event.'
);
warmRunScheduledEvent();
warmCollectAssert(
    $client->translateBatchesCalls === 2
        && ($warmer->pending()['de|en'] ?? []) === []
        && count($identityCache->getMany(['Old identity pending', 'New identity work'], 'de', 'en')) === 2,
    'The new warmer identity must ignore the old backoff and dispatch its queued translation work.'
);
warmCollectAssert(
    get_option(TranslationWarmer::BACKOFF_OPTION, false) === $oldIdentityBackoffMarker,
    'A stale unmatched warmer backoff marker must remain bounded for safe expiry instead of a racy delete.'
);

// -----------------------------------------------------------------------------
// 23. A late 429 response from an old in-flight request must not create a
//     warmer delay for settings that changed while the request was running.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$staleRateKey = 'dg_stale_warmer_rate';
$staleRateBase = 'https://stale-warmer.deepglot.test/api';
$replacementRateKey = 'dg_replacement_warmer_rate';
$replacementRateBase = 'https://replacement-warmer.deepglot.test/api';
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $staleRateKey,
    'api_base_url' => $staleRateBase,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$client = new DeepglotWarmFakeClient();
$client->rateLimitedBatchIndexes = [0];
$client->rateLimitRetryAfter = 3600;
$client->rateLimitIdentity = hash('sha256', $staleRateBase . "\0" . $staleRateKey);
$client->duringBatchCall = static function () use ($replacementRateKey, $replacementRateBase): void {
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => $replacementRateKey,
        'api_base_url' => $replacementRateBase,
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
};
$staleIdentityCache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $staleIdentityCache);
$warmer->register();
$warmer->enqueue(['Stale in-flight work'], 'de', 'en');
warmRunScheduledEvent();

warmCollectAssert(
    get_option(TranslationWarmer::BACKOFF_OPTION, false) === false,
    'A stale in-flight 429 must not persist warmer backoff for the replacement identity.'
);
$client->rateLimitedBatchIndexes = [];
$client->rateLimitIdentity = null;
$warmer->enqueue(['Replacement identity work'], 'de', 'en');
$scheduledAfterStaleRateResponse = (int) ($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] ?? PHP_INT_MAX);
warmCollectAssert(
    $scheduledAfterStaleRateResponse <= time(),
    'A stale old-identity 429 must not leave the replacement identity on a delayed event.'
);
warmRunScheduledEvent();
warmCollectAssert(
    $client->translateBatchesCalls === 2
        && ($warmer->pending()['de|en'] ?? []) === []
        && count($staleIdentityCache->getMany(['Stale in-flight work', 'Replacement identity work'], 'de', 'en')) === 2,
    'The replacement warmer identity must dispatch after a stale old-identity 429.'
);

// -----------------------------------------------------------------------------
// 24. A timestamp-only marker from the pre-action schema must adopt the current
//     contract: split a matching multi-text form, but block a singleton.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$legacyOversizeBatch = ['Legacy aggregate first', 'Legacy aggregate second'];
set_transient('deepglot_warm_oversize_batches', [
    warmOversizeFingerprint($options, 'de', 'en', $legacyOversizeBatch) => time() + 3600,
], 3600);
$client = new DeepglotWarmFakeClient();
$legacyOversizeCache = new DeepglotWarmArrayCache();
$warmer = new TranslationWarmer($client, $options, $legacyOversizeCache);
$warmer->register();
$warmer->enqueue($legacyOversizeBatch, 'de', 'en');
warmRunScheduledEvent();

warmCollectAssert(
    $client->batchCalls === [['Legacy aggregate first'], ['Legacy aggregate second']]
        && ($warmer->pending()['de|en'] ?? []) === []
        && count($legacyOversizeCache->getMany($legacyOversizeBatch, 'de', 'en')) === 2,
    'A legacy multi-text oversize marker must split its matched form instead of blocking it.'
);

// -----------------------------------------------------------------------------
// 25. Marker metadata may be indexed once per partition, but must not be
//     rescanned at every recursive split node. The privacy-safe HMAC lookup and
//     resulting binary split remain unchanged.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$complexityBatch = [];
for ($index = 0; $index < 8; $index++) {
    $complexityBatch[] = 'Complexity segment ' . $index;
}
$complexityMarkers = [];
for ($index = 0; $index < 512; $index++) {
    $complexityMarkers[hash('sha256', 'irrelevant marker ' . $index)] = new DeepglotWarmCountingMarker([
        'expires_at' => time() + 3600,
        'length' => 50,
        'action' => 'block',
    ]);
}
$splitShapes = [
    $complexityBatch,
    array_slice($complexityBatch, 0, 4),
    array_slice($complexityBatch, 4, 4),
    array_slice($complexityBatch, 0, 2),
    array_slice($complexityBatch, 2, 2),
    array_slice($complexityBatch, 4, 2),
    array_slice($complexityBatch, 6, 2),
];
foreach ($splitShapes as $shape) {
    $complexityMarkers[warmOversizeFingerprint($options, 'de', 'en', $shape)] = new DeepglotWarmCountingMarker([
        'expires_at' => time() + 3600,
        'length' => count($shape),
        'action' => 'split',
    ]);
}

DeepglotWarmCountingMarker::$inspections = 0;
$partitionWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$partitionMethod = new ReflectionMethod(
    TranslationWarmer::class,
    'partitionBatchesAroundOversizePrefixes'
);
$partitioned = $partitionMethod->invoke(
    $partitionWarmer,
    $complexityBatch,
    'de',
    'en',
    warmRateIdentity($options),
    $complexityMarkers
);
$partitionedTexts = array_map(
    static fn(array $state): array => $state['batch'],
    $partitioned
);
$allUnblocked = array_reduce(
    $partitioned,
    static fn(bool $carry, array $state): bool => $carry && $state['blocked'] === false,
    true
);
$inspectionBudget = count($complexityMarkers) * 5 + 200;
warmCollectAssert(
    $partitionedTexts === array_map(static fn(string $text): array => [$text], $complexityBatch)
        && $allUnblocked,
    'The indexed complexity path must preserve the exact HMAC-driven binary split semantics.'
);
warmCollectAssert(
    DeepglotWarmCountingMarker::$inspections <= $inspectionBudget,
    'Oversize marker metadata must be indexed once instead of rescanned at every recursive split node.'
);

// -----------------------------------------------------------------------------
// 26. A stale backoff reader may fail open, but it must not delete the valid
//     marker and event that a concurrent writer stored for the current config.
// -----------------------------------------------------------------------------
warmResetEnvironment();
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_backoff_race_new',
    'api_base_url' => 'https://backoff-race-new.deepglot.test/api',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$oldBackoffMarker = [
    'retry_at' => time() + 300,
    'identity' => hash('sha256', "https://backoff-race-old.deepglot.test/api\0dg_backoff_race_old"),
];
$newBackoffMarker = [
    'retry_at' => time() + 900,
    'identity' => warmRateIdentity($options),
];
$oldBackoffArgs = [$oldBackoffMarker['identity']];
$newBackoffArgs = [$newBackoffMarker['identity']];
$newBackoffEvent = time() + 900;
update_option(TranslationWarmer::BACKOFF_OPTION, $oldBackoffMarker, false);
$GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] = time() + 300;
$GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK] = $oldBackoffArgs;
$GLOBALS['_deepglot_after_next_scheduled'] = static function ($hook, $args, $captured) use (
    $newBackoffMarker,
    $newBackoffArgs,
    $newBackoffEvent
): void {
    if ($hook !== TranslationWarmer::HOOK || $args !== $newBackoffArgs) {
        return;
    }

    $GLOBALS['_deepglot_after_next_scheduled'] = null;
    update_option(TranslationWarmer::BACKOFF_OPTION, $newBackoffMarker, false);
    $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] = $newBackoffEvent;
    $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK] = $newBackoffArgs;
    $GLOBALS['_deepglot_scheduled_event_log'][] = [
        'timestamp' => $newBackoffEvent,
        'hook' => TranslationWarmer::HOOK,
        'args' => $newBackoffArgs,
    ];
};
$backoffWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$backoffWarmer->enqueue(['Backoff writer race'], 'de', 'en');
warmCollectAssert(
    get_option(TranslationWarmer::BACKOFF_OPTION, false) === $newBackoffMarker,
    'A stale backoff reader must not delete a concurrently written current-identity marker.'
);
warmCollectAssert(
    in_array([
        'timestamp' => $newBackoffEvent,
        'hook' => TranslationWarmer::HOOK,
        'args' => $newBackoffArgs,
    ], $GLOBALS['_deepglot_scheduled_event_log'], true),
    'A current-identity event written after the stale reader\'s last lookup must remain scheduled additively.'
);
warmCollectAssert(
    !in_array($newBackoffArgs, $GLOBALS['_deepglot_cleared_scheduled_args'], true),
    'A stale reader must never globally clear the current identity event scope.'
);

// -----------------------------------------------------------------------------
// 27. An old identity-scoped event must still clear pending text and URL work
//     after the plugin is disabled or its API key is removed. Neither state may
//     dispatch translations or create replacement events.
// -----------------------------------------------------------------------------
foreach (['disabled', 'missing-key'] as $unconfiguredState) {
    warmResetEnvironment();
    $oldCronKey = 'dg_old_cron_cleanup_' . $unconfiguredState;
    $oldCronBase = 'https://old-cron-cleanup.deepglot.test/api';
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => $oldCronKey,
        'api_base_url' => $oldCronBase,
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
    $client = new DeepglotWarmFakeClient();
    $cleanupWarmer = new TranslationWarmer(
        $client,
        $options,
        new DeepglotWarmArrayCache()
    );
    $cleanupWarmer->register();
    $cleanupWarmer->enqueue(
        ['Pending before configuration removal'],
        'de',
        'en',
        'https://old-cron-cleanup.deepglot.test/pending'
    );
    $oldCronIdentity = warmRateIdentity($options);
    $eventCountBeforeCleanup = count($GLOBALS['_deepglot_scheduled_event_log']);

    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => $unconfiguredState !== 'disabled',
        'api_key' => $unconfiguredState === 'missing-key' ? '' : $oldCronKey,
        'api_base_url' => $oldCronBase,
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
    unset(
        $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK],
        $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK]
    );
    $cleanupWarmer->runForIdentity($oldCronIdentity);

    warmCollectAssert(
        get_option(TranslationWarmer::QUEUE_OPTION, false) === false,
        sprintf(
            'An old identity event must clear the text queue when configuration becomes %s.',
            $unconfiguredState
        )
    );
    warmCollectAssert(
        get_option(TranslationWarmer::URL_QUEUE_OPTION, false) === false,
        sprintf(
            'An old identity event must clear the URL queue when configuration becomes %s.',
            $unconfiguredState
        )
    );
    warmCollectAssert(
        $client->translateBatchesCalls === 0 && $client->singleCalls === 0,
        sprintf(
            'Queue cleanup for %s configuration must not contact the translation client.',
            $unconfiguredState
        )
    );
    warmCollectAssert(
        count($GLOBALS['_deepglot_scheduled_event_log']) === $eventCountBeforeCleanup
            && !isset($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK]),
        sprintf(
            'Queue cleanup for %s configuration must not schedule another warm event.',
            $unconfiguredState
        )
    );
}

// -----------------------------------------------------------------------------
// 28. A rate-limit retry time read for configuration A must not be rebound to
//     configuration B when settings change before enqueue stores and schedules
//     that delay.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$enqueueRaceKeyA = 'dg_enqueue_retry_a';
$enqueueRaceBaseA = 'https://enqueue-retry-a.deepglot.test/api';
$enqueueRaceKeyB = 'dg_enqueue_retry_b';
$enqueueRaceBaseB = 'https://enqueue-retry-b.deepglot.test/api';
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $enqueueRaceKeyA,
    'api_base_url' => $enqueueRaceBaseA,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$enqueueRaceIdentityA = warmRateIdentity($options);
$enqueueRaceIdentityB = hash('sha256', $enqueueRaceBaseB . "\0" . $enqueueRaceKeyB);
set_transient(Client::RATE_LIMIT_TRANSIENT, [
    'retry_at' => time() + 600,
    'identity' => $enqueueRaceIdentityA,
], 600);
$GLOBALS['_deepglot_after_get_transient'] = static function ($key, $value) use (
    $enqueueRaceKeyB,
    $enqueueRaceBaseB
): void {
    if ($key !== Client::RATE_LIMIT_TRANSIENT) {
        return;
    }

    $GLOBALS['_deepglot_after_get_transient'] = null;
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => $enqueueRaceKeyB,
        'api_base_url' => $enqueueRaceBaseB,
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
};
$enqueueRaceWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$enqueueRaceWarmer->enqueue(['Enqueue retry identity race'], 'de', 'en');
$enqueueRaceBackoff = get_option(TranslationWarmer::BACKOFF_OPTION, false);
$enqueueRaceDelayedForB = array_filter(
    $GLOBALS['_deepglot_scheduled_event_log'],
    static fn(array $event): bool => ($event['args'] ?? []) === [$enqueueRaceIdentityB]
        && (int) ($event['timestamp'] ?? 0) > time()
);
warmCollectAssert(
    !is_array($enqueueRaceBackoff)
        || ($enqueueRaceBackoff['identity'] ?? null) !== $enqueueRaceIdentityB,
    'An enqueue retry time read for identity A must never be persisted as identity B backoff.'
);
warmCollectAssert(
    $enqueueRaceDelayedForB === [],
    'An enqueue retry time read for identity A must never schedule a delayed identity B event.'
);

// -----------------------------------------------------------------------------
// 29. The same snapshot boundary applies in run(): a retry time read for A may
//     not become B backoff when configuration changes before store/schedule.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$runRaceKeyA = 'dg_run_retry_a';
$runRaceBaseA = 'https://run-retry-a.deepglot.test/api';
$runRaceKeyB = 'dg_run_retry_b';
$runRaceBaseB = 'https://run-retry-b.deepglot.test/api';
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $runRaceKeyA,
    'api_base_url' => $runRaceBaseA,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$runRaceIdentityA = warmRateIdentity($options);
$runRaceIdentityB = hash('sha256', $runRaceBaseB . "\0" . $runRaceKeyB);
$runRaceClient = new DeepglotWarmFakeClient();
$runRaceWarmer = new TranslationWarmer(
    $runRaceClient,
    $options,
    new DeepglotWarmArrayCache()
);
$runRaceWarmer->enqueue(['Run retry identity race'], 'de', 'en');
unset(
    $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK],
    $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK]
);
$GLOBALS['_deepglot_scheduled_event_log'] = [];
set_transient(Client::RATE_LIMIT_TRANSIENT, [
    'retry_at' => time() + 600,
    'identity' => $runRaceIdentityA,
], 600);
$GLOBALS['_deepglot_after_get_transient'] = static function ($key, $value) use (
    $runRaceKeyB,
    $runRaceBaseB
): void {
    if ($key !== Client::RATE_LIMIT_TRANSIENT) {
        return;
    }

    $GLOBALS['_deepglot_after_get_transient'] = null;
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => $runRaceKeyB,
        'api_base_url' => $runRaceBaseB,
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
};
$runRaceWarmer->runForIdentity($runRaceIdentityA);
$runRaceBackoff = get_option(TranslationWarmer::BACKOFF_OPTION, false);
$runRaceDelayedForB = array_filter(
    $GLOBALS['_deepglot_scheduled_event_log'],
    static fn(array $event): bool => ($event['args'] ?? []) === [$runRaceIdentityB]
        && (int) ($event['timestamp'] ?? 0) > time()
);
warmCollectAssert(
    !is_array($runRaceBackoff)
        || ($runRaceBackoff['identity'] ?? null) !== $runRaceIdentityB,
    'A run retry time read for identity A must never be persisted as identity B backoff.'
);
warmCollectAssert(
    $runRaceDelayedForB === [],
    'A run retry time read for identity A must never schedule a delayed identity B event.'
);
warmCollectAssert(
    $runRaceClient->translateBatchesCalls === 0,
    'The run retry race must remain locally deferred without contacting the translation client.'
);

// -----------------------------------------------------------------------------
// 30. A stale A writer must not overwrite the valid B backoff that appears
//     after A's initial current-identity check but before its option write.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$storeRaceKeyA = 'dg_store_backoff_a';
$storeRaceBaseA = 'https://store-backoff-a.deepglot.test/api';
$storeRaceKeyB = 'dg_store_backoff_b';
$storeRaceBaseB = 'https://store-backoff-b.deepglot.test/api';
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $storeRaceKeyA,
    'api_base_url' => $storeRaceBaseA,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$storeRaceIdentityA = warmRateIdentity($options);
$storeRaceIdentityB = hash('sha256', $storeRaceBaseB . "\0" . $storeRaceKeyB);
$storeRaceMarkerB = [
    'retry_at' => time() + 900,
    'identity' => $storeRaceIdentityB,
];
$storeRaceEventB = time() + 900;
$GLOBALS['_deepglot_after_get_option'] = static function ($key, $value) use (
    $storeRaceKeyB,
    $storeRaceBaseB,
    $storeRaceIdentityB,
    $storeRaceMarkerB,
    $storeRaceEventB
): void {
    if ($key !== TranslationWarmer::BACKOFF_OPTION) {
        return;
    }

    $GLOBALS['_deepglot_after_get_option'] = null;
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => $storeRaceKeyB,
        'api_base_url' => $storeRaceBaseB,
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
    update_option(TranslationWarmer::BACKOFF_OPTION, $storeRaceMarkerB, false);
    $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] = $storeRaceEventB;
    $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK] = [$storeRaceIdentityB];
};
$storeRaceWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$storeBackoffMethod = new ReflectionMethod(TranslationWarmer::class, 'storeBackoffUntil');
$storeBackoffMethod->invoke($storeRaceWarmer, time() + 300, $storeRaceIdentityA);
warmCollectAssert(
    get_option(TranslationWarmer::BACKOFF_OPTION, false) === $storeRaceMarkerB,
    'A stale storeBackoffUntil writer must not overwrite a concurrently stored identity B marker.'
);
warmCollectAssert(
    ($GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK] ?? []) === [$storeRaceIdentityB],
    'The concurrent identity B event must survive the stale identity A store.'
);

// -----------------------------------------------------------------------------
// 31. A stale A event that observes configuration B after its initial identity
//     check must not drain or dispatch B's shared queue. It plans B additively.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$drainRaceKeyA = 'dg_drain_race_a';
$drainRaceBaseA = 'https://drain-race-a.deepglot.test/api';
$drainRaceKeyB = 'dg_drain_race_b';
$drainRaceBaseB = 'https://drain-race-b.deepglot.test/api';
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $drainRaceKeyA,
    'api_base_url' => $drainRaceBaseA,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$drainRaceIdentityA = warmRateIdentity($options);
$drainRaceIdentityB = hash('sha256', $drainRaceBaseB . "\0" . $drainRaceKeyB);
$drainRaceClient = new DeepglotWarmFakeClient();
$drainRaceWarmer = new TranslationWarmer(
    $drainRaceClient,
    $options,
    new DeepglotWarmArrayCache()
);
$drainRaceWarmer->enqueue(
    ['Queue must survive stale run'],
    'de',
    'en',
    'https://drain-race.deepglot.test/pending'
);
$drainRaceQueueBefore = get_option(TranslationWarmer::QUEUE_OPTION, false);
$drainRaceUrlsBefore = get_option(TranslationWarmer::URL_QUEUE_OPTION, false);
unset(
    $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK],
    $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK]
);
$GLOBALS['_deepglot_scheduled_event_log'] = [];
$GLOBALS['_deepglot_after_get_option'] = static function ($key, $value) use (
    $drainRaceKeyB,
    $drainRaceBaseB
): void {
    if ($key !== TranslationWarmer::QUEUE_OPTION) {
        return;
    }

    $GLOBALS['_deepglot_after_get_option'] = null;
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => $drainRaceKeyB,
        'api_base_url' => $drainRaceBaseB,
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
};
$drainRaceWarmer->runForIdentity($drainRaceIdentityA);
$drainRaceEventsForB = array_filter(
    $GLOBALS['_deepglot_scheduled_event_log'],
    static fn(array $event): bool => ($event['args'] ?? []) === [$drainRaceIdentityB]
        && (int) ($event['timestamp'] ?? PHP_INT_MAX) <= time() + 1
);
warmCollectAssert(
    $drainRaceClient->translateBatchesCalls === 0,
    'A stale identity A event must not dispatch Client or HTTP work after configuration becomes B.'
);
warmCollectAssert(
    get_option(TranslationWarmer::QUEUE_OPTION, false) === $drainRaceQueueBefore
        && get_option(TranslationWarmer::URL_QUEUE_OPTION, false) === $drainRaceUrlsBefore,
    'A stale identity A event must preserve B text and URL queues without reconciliation.'
);
warmCollectAssert(
    $drainRaceEventsForB !== [],
    'A stale identity A event must plan the current identity B queue immediately and additively.'
);

// -----------------------------------------------------------------------------
// 32. If configuration changes after the final successful delay revalidation
//     but before schedule(A), the stale A event must not be the only event: B
//     needs an immediate additive event so its queue cannot be stranded.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$scheduleGapKeyA = 'dg_schedule_gap_a';
$scheduleGapBaseA = 'https://schedule-gap-a.deepglot.test/api';
$scheduleGapKeyB = 'dg_schedule_gap_b';
$scheduleGapBaseB = 'https://schedule-gap-b.deepglot.test/api';
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $scheduleGapKeyA,
    'api_base_url' => $scheduleGapBaseA,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$scheduleGapIdentityA = warmRateIdentity($options);
$scheduleGapIdentityB = hash('sha256', $scheduleGapBaseB . "\0" . $scheduleGapKeyB);
set_transient(Client::RATE_LIMIT_TRANSIENT, [
    'retry_at' => time() + 600,
    'identity' => $scheduleGapIdentityA,
], 600);
$GLOBALS['_deepglot_after_next_scheduled'] = static function ($hook, $args, $captured) use (
    $scheduleGapIdentityA,
    $scheduleGapKeyB,
    $scheduleGapBaseB
): void {
    if ($hook !== TranslationWarmer::HOOK || $args !== [$scheduleGapIdentityA]) {
        return;
    }

    $GLOBALS['_deepglot_after_next_scheduled'] = null;
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => $scheduleGapKeyB,
        'api_base_url' => $scheduleGapBaseB,
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
};
$scheduleGapWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$scheduleGapWarmer->enqueue(['Schedule gap queue'], 'de', 'en');
$scheduleGapImmediateForB = array_filter(
    $GLOBALS['_deepglot_scheduled_event_log'],
    static fn(array $event): bool => ($event['args'] ?? []) === [$scheduleGapIdentityB]
        && (int) ($event['timestamp'] ?? PHP_INT_MAX) <= time() + 1
);
$scheduleGapDelayedForB = array_filter(
    $GLOBALS['_deepglot_scheduled_event_log'],
    static fn(array $event): bool => ($event['args'] ?? []) === [$scheduleGapIdentityB]
        && (int) ($event['timestamp'] ?? 0) > time() + 1
);
warmCollectAssert(
    $scheduleGapImmediateForB !== [],
    'A configuration switch immediately before schedule(A) must add an immediate current identity B event.'
);
warmCollectAssert(
    $scheduleGapDelayedForB === [],
    'A configuration switch immediately before schedule(A) must not transfer A delay to identity B.'
);

// -----------------------------------------------------------------------------
// 33. Consuming the only old A event after an administrator switches to valid
//     B must preserve both queues and hand them to one immediate B event even
//     when no frontend request performs another enqueue.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$adminSwitchKeyA = 'dg_admin_switch_a';
$adminSwitchBaseA = 'https://admin-switch-a.deepglot.test/api';
$adminSwitchKeyB = 'dg_admin_switch_b';
$adminSwitchBaseB = 'https://admin-switch-b.deepglot.test/api';
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $adminSwitchKeyA,
    'api_base_url' => $adminSwitchBaseA,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$adminSwitchIdentityA = warmRateIdentity($options);
$adminSwitchIdentityB = hash('sha256', $adminSwitchBaseB . "\0" . $adminSwitchKeyB);
$adminSwitchClient = new DeepglotWarmFakeClient();
$adminSwitchWarmer = new TranslationWarmer(
    $adminSwitchClient,
    $options,
    new DeepglotWarmArrayCache()
);
$adminSwitchWarmer->enqueue(
    ['Admin switch queue'],
    'de',
    'en',
    'https://admin-switch.deepglot.test/pending'
);
$adminSwitchQueueBefore = get_option(TranslationWarmer::QUEUE_OPTION, false);
$adminSwitchUrlsBefore = get_option(TranslationWarmer::URL_QUEUE_OPTION, false);
unset(
    $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK],
    $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK]
);
$GLOBALS['_deepglot_scheduled_event_log'] = [];
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $adminSwitchKeyB,
    'api_base_url' => $adminSwitchBaseB,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$adminSwitchWarmer->runForIdentity($adminSwitchIdentityA);
$adminSwitchEventsForB = array_filter(
    $GLOBALS['_deepglot_scheduled_event_log'],
    static fn(array $event): bool => ($event['args'] ?? []) === [$adminSwitchIdentityB]
        && (int) ($event['timestamp'] ?? PHP_INT_MAX) <= time() + 1
);
warmCollectAssert(
    $adminSwitchClient->translateBatchesCalls === 0
        && get_option(TranslationWarmer::QUEUE_OPTION, false) === $adminSwitchQueueBefore
        && get_option(TranslationWarmer::URL_QUEUE_OPTION, false) === $adminSwitchUrlsBefore,
    'A consumed stale A event after an admin switch must preserve B queues without Client or HTTP work.'
);
warmCollectAssert(
    count($adminSwitchEventsForB) === 1,
    'A consumed stale A event must hand pending work to exactly one immediate additive identity B event.'
);

// -----------------------------------------------------------------------------
// 34. Same-identity writers keep the longest delay: if the shorter writer read
//     before a longer writer stored, its later continuation cannot shorten the
//     marker or the effective scheduled TTL.
// -----------------------------------------------------------------------------
warmResetEnvironment();
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_warmer_same_identity',
    'api_base_url' => 'https://warmer-same-identity.deepglot.test/api',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$warmerSameIdentity = warmRateIdentity($options);
$warmerLongRetryAt = time() + 900;
$warmerLongMarker = [
    'retry_at' => $warmerLongRetryAt,
    'identity' => $warmerSameIdentity,
];
$GLOBALS['_deepglot_after_get_option'] = static function ($key, $value) use (
    $warmerLongMarker,
    $warmerSameIdentity,
    $warmerLongRetryAt
): void {
    if ($key !== TranslationWarmer::BACKOFF_OPTION) {
        return;
    }

    $GLOBALS['_deepglot_after_get_option'] = null;
    update_option(TranslationWarmer::BACKOFF_OPTION, $warmerLongMarker, false);
    $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] = $warmerLongRetryAt;
    $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK] = [$warmerSameIdentity];
};
$warmerSameIdentityStore = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$sameIdentityStoreResult = $storeBackoffMethod->invoke(
    $warmerSameIdentityStore,
    time() + 120,
    $warmerSameIdentity
);
warmCollectAssert(
    $sameIdentityStoreResult === true
        && get_option(TranslationWarmer::BACKOFF_OPTION, false) === $warmerLongMarker
        && ($GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] ?? 0) === $warmerLongRetryAt,
    'A stale shorter same-identity Warmer writer must preserve the longer retry_at and scheduled TTL.'
);

// -----------------------------------------------------------------------------
// 35. WordPress reports zero affected rows for an identical SQL update. When
//     the longer same-identity marker already equals the computed next value,
//     that no-op is success rather than a failed store that triggers now.
// -----------------------------------------------------------------------------
warmResetEnvironment();
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_warmer_noop_cas',
    'api_base_url' => 'https://warmer-noop-cas.deepglot.test/api',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$noopCasIdentity = warmRateIdentity($options);
$noopCasMarker = [
    'retry_at' => time() + 900,
    'identity' => $noopCasIdentity,
];
update_option(TranslationWarmer::BACKOFF_OPTION, $noopCasMarker, false);
$GLOBALS['wpdb'] = new class {
    public string $options = 'wp_options';
    public int $updates = 0;
    public function update($table, $data, $where, $format = null, $whereFormat = null): int
    {
        $this->updates++;
        return 0;
    }
    public function delete($table, $where, $whereFormat = null): int
    {
        return 0;
    }
};
$noopCasWarmer = new TranslationWarmer(
    new DeepglotWarmFakeClient(),
    $options,
    new DeepglotWarmArrayCache()
);
$noopCasResult = $storeBackoffMethod->invoke(
    $noopCasWarmer,
    time() + 120,
    $noopCasIdentity
);
$noopCasUpdates = $GLOBALS['wpdb']->updates;
unset($GLOBALS['wpdb']);
warmCollectAssert(
    $noopCasResult === true
        && $noopCasUpdates === 0
        && get_option(TranslationWarmer::BACKOFF_OPTION, false) === $noopCasMarker,
    'An unchanged longer same-identity marker must be a successful no-op CAS without an immediate retry.'
);

// -----------------------------------------------------------------------------
// 36. The run identity must cross the Client boundary. A switch exactly when
//     Client snapshots config is local/no-HTTP; a switch during legitimate A
//     HTTP is detected before any returned result mutates shared state.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$entrySwitchKeyA = 'dg_client_entry_a';
$entrySwitchBaseA = 'https://client-entry-a.deepglot.test/api';
$entrySwitchKeyB = 'dg_client_entry_b';
$entrySwitchBaseB = 'https://client-entry-b.deepglot.test/api';
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $entrySwitchKeyA,
    'api_base_url' => $entrySwitchBaseA,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$entrySwitchIdentityA = warmRateIdentity($options);
$entrySwitchIdentityB = hash('sha256', $entrySwitchBaseB . "\0" . $entrySwitchKeyB);
$entrySwitchClient = new DeepglotWarmFakeClient();
$entrySwitchWarmer = new TranslationWarmer(
    $entrySwitchClient,
    $options,
    new DeepglotWarmArrayCache()
);
$entrySwitchWarmer->enqueue(
    ['Client entry queue'],
    'de',
    'en',
    'https://client-entry.deepglot.test/pending'
);
$entrySwitchQueueBefore = get_option(TranslationWarmer::QUEUE_OPTION, false);
$entrySwitchUrlsBefore = get_option(TranslationWarmer::URL_QUEUE_OPTION, false);
unset(
    $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK],
    $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK]
);
$GLOBALS['_deepglot_scheduled_event_log'] = [];
$entrySwitchClient->beforeBatchConfigurationSnapshot = static function () use (
    $entrySwitchKeyB,
    $entrySwitchBaseB
): void {
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => $entrySwitchKeyB,
        'api_base_url' => $entrySwitchBaseB,
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
};
$entrySwitchWarmer->runForIdentity($entrySwitchIdentityA);
$entrySwitchEventsForB = array_filter(
    $GLOBALS['_deepglot_scheduled_event_log'],
    static fn(array $event): bool => ($event['args'] ?? []) === [$entrySwitchIdentityB]
        && (int) ($event['timestamp'] ?? PHP_INT_MAX) <= time() + 1
);
warmCollectAssert(
    $entrySwitchClient->translateBatchesCalls === 0,
    'A Client-entry configuration mismatch must be local and send zero B HTTP requests.'
);
warmCollectAssert(
    get_option(TranslationWarmer::QUEUE_OPTION, false) === $entrySwitchQueueBefore
        && get_option(TranslationWarmer::URL_QUEUE_OPTION, false) === $entrySwitchUrlsBefore,
    'A Client-entry configuration mismatch must leave text and URL queues untouched.'
);
warmCollectAssert(
    count($entrySwitchEventsForB) === 1,
    'A Client-entry configuration mismatch must plan exactly one immediate B event.'
);

warmResetEnvironment();
$inFlightKeyA = 'dg_in_flight_a';
$inFlightBaseA = 'https://in-flight-a.deepglot.test/api';
$inFlightKeyB = 'dg_in_flight_b';
$inFlightBaseB = 'https://in-flight-b.deepglot.test/api';
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $inFlightKeyA,
    'api_base_url' => $inFlightBaseA,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$inFlightIdentityA = warmRateIdentity($options);
$inFlightIdentityB = hash('sha256', $inFlightBaseB . "\0" . $inFlightKeyB);
$inFlightClient = new DeepglotWarmFakeClient();
$inFlightClient->permanentlyOversizedTexts = ['In-flight oversize'];
$inFlightCache = new DeepglotWarmArrayCache();
$inFlightWarmer = new TranslationWarmer($inFlightClient, $options, $inFlightCache);
$inFlightWarmer->enqueue(
    ['In-flight oversize'],
    'de',
    'en',
    'https://in-flight.deepglot.test/pending'
);
$inFlightQueueBefore = get_option(TranslationWarmer::QUEUE_OPTION, false);
$inFlightUrlsBefore = get_option(TranslationWarmer::URL_QUEUE_OPTION, false);
unset(
    $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK],
    $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK]
);
$GLOBALS['_deepglot_scheduled_event_log'] = [];
$inFlightClient->duringBatchCall = static function () use ($inFlightKeyB, $inFlightBaseB): void {
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => $inFlightKeyB,
        'api_base_url' => $inFlightBaseB,
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
};
$inFlightWarmer->runForIdentity($inFlightIdentityA);
$inFlightEventsForB = array_filter(
    $GLOBALS['_deepglot_scheduled_event_log'],
    static fn(array $event): bool => ($event['args'] ?? []) === [$inFlightIdentityB]
        && (int) ($event['timestamp'] ?? PHP_INT_MAX) <= time() + 1
);
warmCollectAssert(
    $inFlightClient->translateBatchesCalls === 1,
    'The in-flight switch contract starts with exactly one legitimate identity A Client call.'
);
warmCollectAssert(
    get_option(TranslationWarmer::QUEUE_OPTION, false) === $inFlightQueueBefore
        && get_option(TranslationWarmer::URL_QUEUE_OPTION, false) === $inFlightUrlsBefore
        && $inFlightCache->entries === []
        && get_transient('deepglot_warm_oversize_batches') === false,
    'An in-flight A-to-B switch must not mutate cache, queues, URLs, or B-keyed 422 fingerprints.'
);
warmCollectAssert(
    count($inFlightEventsForB) === 1,
    'An in-flight A-to-B switch must plan exactly one immediate additive B event.'
);

// -----------------------------------------------------------------------------
// 37. The real settings update handler must hand a non-empty queue from A to B
//     immediately, without waiting for another page enqueue or clearing A.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$settingsSwitchKeyA = 'dg_settings_switch_a';
$settingsSwitchBaseA = 'https://settings-switch-a.deepglot.test/api';
$settingsSwitchKeyB = 'dg_settings_switch_b';
$settingsSwitchBaseB = 'https://settings-switch-b.deepglot.test/api';
$settingsA = array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $settingsSwitchKeyA,
    'api_base_url' => $settingsSwitchBaseA,
    'source_language' => 'de',
    'target_languages' => ['en'],
]);
update_option(Options::OPTION_KEY, $settingsA);
$settingsSwitchIdentityA = warmRateIdentity($options);
$settingsClient = new DeepglotWarmSettingsClient();
$settingsWarmer = new TranslationWarmer(
    $settingsClient,
    $options,
    new DeepglotWarmArrayCache()
);
$settingsWarmer->enqueue(
    ['Settings switch queue'],
    'de',
    'en',
    'https://settings-switch.deepglot.test/pending'
);
$settingsAEvent = time() + 600;
$GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK] = $settingsAEvent;
$GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK] = [$settingsSwitchIdentityA];
$GLOBALS['_deepglot_scheduled_event_log'] = [];
$settingsB = array_merge($settingsA, [
    'api_key' => $settingsSwitchKeyB,
    'api_base_url' => $settingsSwitchBaseB,
]);
update_option(Options::OPTION_KEY, $settingsB);
$settingsSwitchIdentityB = warmRateIdentity($options);
$settingsSync = new SettingsSync($options, $settingsClient);
$settingsSync->handleOptionUpdate($settingsA, $settingsB);
$settingsSwitchEventsForB = array_filter(
    $GLOBALS['_deepglot_scheduled_event_log'],
    static fn(array $event): bool => ($event['args'] ?? []) === [$settingsSwitchIdentityB]
        && (int) ($event['timestamp'] ?? PHP_INT_MAX) <= time() + 1
);
warmCollectAssert(
    count($settingsSwitchEventsForB) === 1,
    'A valid admin identity switch with pending queue must schedule one immediate additive B event.'
);
warmCollectAssert(
    !in_array([$settingsSwitchIdentityA], $GLOBALS['_deepglot_cleared_scheduled_args'], true),
    'The settings update handoff must never globally clear the old identity A event.'
);

// -----------------------------------------------------------------------------
// 38. An A-scoped singleton 422 may switch to B while its WP_Error is being
//     inspected, after the first post-response identity check. It must never
//     derive a B HMAC or commit any successful sibling result/shared state.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$resultSwitchKeyA = 'dg_result_switch_a';
$resultSwitchBaseA = 'https://result-switch-a.deepglot.test/api';
$resultSwitchKeyB = 'dg_result_switch_b';
$resultSwitchBaseB = 'https://result-switch-b.deepglot.test/api';
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $resultSwitchKeyA,
    'api_base_url' => $resultSwitchBaseA,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$resultSwitchIdentityA = warmRateIdentity($options);
$resultSwitchIdentityB = hash('sha256', $resultSwitchBaseB . "\0" . $resultSwitchKeyB);
$resultSwitchTexts = ['A singleton oversize', 'Successful sibling must stay pending'];
$resultSwitchShapeA = warmOversizeFingerprint($options, 'de', 'en', $resultSwitchTexts);
set_transient('deepglot_warm_oversize_batches', [
    $resultSwitchShapeA => [
        'expires_at' => time() + 3600,
        'length' => 2,
        'action' => 'split',
    ],
], 3600);
$resultSwitchClient = new DeepglotWarmFakeClient();
$resultSwitchClient->permanentlyOversizedTexts = ['A singleton oversize'];
$resultSwitchCache = new DeepglotWarmArrayCache();
$resultSwitchWarmer = new TranslationWarmer(
    $resultSwitchClient,
    $options,
    $resultSwitchCache
);
$resultSwitchWarmer->enqueue(
    $resultSwitchTexts,
    'de',
    'en',
    'https://result-switch.deepglot.test/pending'
);
$resultSwitchQueueBefore = get_option(TranslationWarmer::QUEUE_OPTION, false);
$resultSwitchUrlsBefore = get_option(TranslationWarmer::URL_QUEUE_OPTION, false);
unset(
    $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK],
    $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK]
);
$GLOBALS['_deepglot_scheduled_event_log'] = [];
$GLOBALS['_deepglot_before_error_data'] = static function () use (
    $resultSwitchKeyB,
    $resultSwitchBaseB
): void {
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => $resultSwitchKeyB,
        'api_base_url' => $resultSwitchBaseB,
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
};
$resultSwitchWarmer->runForIdentity($resultSwitchIdentityA);
$resultSwitchFingerprintB = warmOversizeFingerprint(
    $options,
    'de',
    'en',
    ['A singleton oversize']
);
$resultSwitchMarkers = get_transient('deepglot_warm_oversize_batches');
$resultSwitchEventsForB = array_filter(
    $GLOBALS['_deepglot_scheduled_event_log'],
    static fn(array $event): bool => ($event['args'] ?? []) === [$resultSwitchIdentityB]
        && (int) ($event['timestamp'] ?? PHP_INT_MAX) <= time() + 1
);
warmCollectAssert(
    !is_array($resultSwitchMarkers)
        || !array_key_exists($resultSwitchFingerprintB, $resultSwitchMarkers),
    'An identity A 422 inspected after a switch must never create a B-keyed HMAC marker.'
);
warmCollectAssert(
    get_option(TranslationWarmer::QUEUE_OPTION, false) === $resultSwitchQueueBefore
        && get_option(TranslationWarmer::URL_QUEUE_OPTION, false) === $resultSwitchUrlsBefore
        && $resultSwitchCache->entries === [],
    'A result-loop identity switch must precede every cache, queue, URL, and sibling-result commit.'
);
warmCollectAssert(
    count($resultSwitchEventsForB) === 1,
    'A result-loop identity switch must plan exactly one immediate additive B event.'
);

// -----------------------------------------------------------------------------
// 39. A warmer dispatch must preserve existing Client subclasses that override
//     only the original public translateBatches() method. Identity-scoped cron
//     protection must still prevent that override from running for stale work.
// -----------------------------------------------------------------------------
warmResetEnvironment();
$legacyDispatchKeyA = 'dg_legacy_dispatch_a';
$legacyDispatchBaseA = 'https://legacy-dispatch-a.deepglot.test/api';
$legacyDispatchKeyB = 'dg_legacy_dispatch_b';
$legacyDispatchBaseB = 'https://legacy-dispatch-b.deepglot.test/api';
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $legacyDispatchKeyA,
    'api_base_url' => $legacyDispatchBaseA,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$legacyDispatchIdentityA = warmRateIdentity($options);
$legacyDispatchClient = new DeepglotWarmLegacyBatchOverrideClient();
$legacyDispatchCache = new DeepglotWarmArrayCache();
$legacyDispatchWarmer = new TranslationWarmer(
    $legacyDispatchClient,
    $options,
    $legacyDispatchCache
);
$legacyDispatchWarmer->enqueue(['Legacy override queue'], 'de', 'en');
unset(
    $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK],
    $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK]
);
$legacyDispatchWarmer->runForIdentity($legacyDispatchIdentityA);
warmCollectAssert(
    $legacyDispatchClient->calls === 1
        && $legacyDispatchClient->dispatched === [[['Legacy override queue']]],
    'The warmer must dispatch exactly once through an existing translateBatches override.'
);

$legacyDispatchWarmer->enqueue(['Stale identity queue'], 'de', 'en');
$legacyDispatchQueueBefore = get_option(TranslationWarmer::QUEUE_OPTION, false);
unset(
    $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK],
    $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK]
);
$GLOBALS['_deepglot_scheduled_event_log'] = [];
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $legacyDispatchKeyB,
    'api_base_url' => $legacyDispatchBaseB,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$legacyDispatchWarmer->runForIdentity($legacyDispatchIdentityA);
warmCollectAssert(
    $legacyDispatchClient->calls === 1
        && get_option(TranslationWarmer::QUEUE_OPTION, false) === $legacyDispatchQueueBefore,
    'A stale identity event must not invoke a legacy batch override or reconcile its queue.'
);

warmResetEnvironment();
$GLOBALS['_deepglot_remote_requests'] = [];
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => $legacyDispatchKeyA,
    'api_base_url' => $legacyDispatchBaseA,
    'source_language' => 'de',
    'target_languages' => ['en'],
]));
$legacyRaceIdentityA = warmRateIdentity($options);
$legacyRaceIdentityB = hash('sha256', $legacyDispatchBaseB . "\0" . $legacyDispatchKeyB);
$legacyRaceClient = new DeepglotWarmLegacyDelegatingBatchClient($options);
$legacyRaceClient->beforeParentDispatch = static function () use (
    $legacyDispatchKeyB,
    $legacyDispatchBaseB
): void {
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => $legacyDispatchKeyB,
        'api_base_url' => $legacyDispatchBaseB,
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
};
$legacyRaceWarmer = new TranslationWarmer(
    $legacyRaceClient,
    $options,
    new DeepglotWarmArrayCache()
);
$legacyRaceWarmer->enqueue(
    ['Legacy race queue'],
    'de',
    'en',
    'https://legacy-race.deepglot.test/pending'
);
$legacyRaceQueueBefore = get_option(TranslationWarmer::QUEUE_OPTION, false);
$legacyRaceUrlsBefore = get_option(TranslationWarmer::URL_QUEUE_OPTION, false);
unset(
    $GLOBALS['_deepglot_scheduled'][TranslationWarmer::HOOK],
    $GLOBALS['_deepglot_scheduled_args'][TranslationWarmer::HOOK]
);
$GLOBALS['_deepglot_scheduled_event_log'] = [];
$legacyRaceWarmer->runForIdentity($legacyRaceIdentityA);
$legacyRaceEventsForB = array_filter(
    $GLOBALS['_deepglot_scheduled_event_log'],
    static fn(array $event): bool => ($event['args'] ?? []) === [$legacyRaceIdentityB]
        && (int) ($event['timestamp'] ?? PHP_INT_MAX) <= time() + 1
);
warmCollectAssert(
    $legacyRaceClient->legacyCalls === 1,
    'An identity-bound warm run must continue to enter a legacy delegating override.'
);
warmCollectAssert(
    $GLOBALS['_deepglot_remote_requests'] === [],
    'A switch at legacy override entry must be rejected before parent Client sends B HTTP.'
);
warmCollectAssert(
    get_option(TranslationWarmer::QUEUE_OPTION, false) === $legacyRaceQueueBefore
        && get_option(TranslationWarmer::URL_QUEUE_OPTION, false) === $legacyRaceUrlsBefore,
    'A legacy override entry switch must preserve text and URL queues.'
);
warmCollectAssert(
    count($legacyRaceEventsForB) === 1,
    'A legacy override entry switch must plan exactly one immediate additive B event.'
);

if ($GLOBALS['_deepglot_collected_failures'] !== []) {
    foreach ($GLOBALS['_deepglot_collected_failures'] as $failure) {
        fwrite(STDERR, '✗ ' . $failure . PHP_EOL);
    }
    exit(1);
}

fwrite(STDOUT, "ColdPageWarmupTest: OK\n");
