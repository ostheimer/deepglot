<?php

require_once __DIR__ . '/WordPressTestBootstrap.php';

function __($text, $domain = null) { return $text; }
function get_option($key, $default = false) {
    if ($key === 'deepglot_source_inventory_queue') {
        if (array_key_exists($key, $GLOBALS['_dg_async_option_cache'])) return $GLOBALS['_dg_async_option_cache'][$key];
        $GLOBALS['_dg_async_option_cache'][$key] = $GLOBALS['_dg_async_options'][$key] ?? $default;
        return $GLOBALS['_dg_async_option_cache'][$key];
    }
    return $GLOBALS['_dg_async_options'][$key] ?? $default;
}
function update_option($key, $value) {
    $GLOBALS['_dg_async_options'][$key] = $value;
    if ($key === 'deepglot_source_inventory_queue') $GLOBALS['_dg_async_option_cache'][$key] = $value;
    return true;
}
function add_option($key, $value) { if (array_key_exists($key, $GLOBALS['_dg_async_options'])) return false; $GLOBALS['_dg_async_options'][$key] = $value; return true; }
function delete_option($key) { unset($GLOBALS['_dg_async_options'][$key]); return true; }
function wp_cache_delete($key, $group = '') {
    if ($group === 'options') unset($GLOBALS['_dg_async_option_cache'][$key]);
    return true;
}
function get_transient($key) { return $GLOBALS['_dg_async_transients'][$key] ?? false; }
function set_transient($key, $value, $ttl = 0) { $GLOBALS['_dg_async_transients'][$key] = $value; return true; }
function wp_next_scheduled($hook) { return $GLOBALS['_dg_async_events'][$hook] ?? false; }
function wp_schedule_single_event($timestamp, $hook) { $GLOBALS['_dg_async_events'][$hook] = $timestamp; return true; }
class WP_Error { public function __construct(public string $code = 'unavailable') {} }
function is_wp_error($value) { return $value instanceof WP_Error; }
function wp_parse_args($args, $defaults = []) { return array_merge($defaults, is_array($args) ? $args : []); }
function sanitize_text_field($value) { return trim((string) $value); }
function sanitize_textarea_field($value) { return trim((string) $value); }
function esc_url_raw($value) { return (string) $value; }
function untrailingslashit($value) { return rtrim((string) $value, '/'); }
function wp_json_encode($value) { return json_encode($value); }
function wp_remote_request($url, $args = []) {
    $GLOBALS['_dg_async_http'][] = ['url' => $url, 'args' => $args];
    if (isset($GLOBALS['_dg_async_during_http'])) {
        $during = $GLOBALS['_dg_async_during_http'];
        unset($GLOBALS['_dg_async_during_http']);
        $during();
    }
    usleep(200000);
    return ($GLOBALS['_dg_async_available'] ?? false)
        ? ['response' => ['code' => 200], 'body' => '{"accepted":true}']
        : ['response' => ['code' => 503], 'body' => '{}'];
}
function wp_remote_retrieve_response_code($response) { return $response['response']['code']; }
function wp_remote_retrieve_body($response) { return $response['body']; }
function is_user_logged_in() { return false; }
function is_preview() { return false; }
function is_admin() { return false; }
if (!defined('DAY_IN_SECONDS')) define('DAY_IN_SECONDS', 86400);

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Support/SourceInventoryQueue.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Frontend/JsonLdTranslator.php';
require_once __DIR__ . '/../includes/Support/BotDetector.php';
require_once __DIR__ . '/../includes/Support/HtmlDocument.php';
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\SourceInventoryQueue;

class AsyncInventoryCacheHit extends TranslationCache {
    public function getMany(array $texts, string $from, string $to): array {
        return array_combine($texts, array_map(static fn($text) => '[en] ' . $text, $texts));
    }
    public function setMany(array $translations, string $from, string $to): array { return []; }
}
class AsyncInventoryNoProvider extends Client {
    public function __construct() {}
    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0, ?int $timeout = null) {
        throw new RuntimeException('Fully cached page cannot call translation provider.');
    }
}

$GLOBALS['_dg_async_options'] = [];
$GLOBALS['_dg_async_http'] = [];
$GLOBALS['_dg_async_events'] = [];
$GLOBALS['_dg_async_transients'] = [];
$GLOBALS['_dg_async_option_cache'] = [];
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true, 'api_key' => 'local-fixture-key', 'api_url' => 'http://127.0.0.1:31557/api',
    'source_language' => 'de', 'target_languages' => ['en'],
]));
$options = new Options();
$inventory = new Client($options);
$queue = new SourceInventoryQueue($inventory, $options);
$translator = new HtmlTranslator(new AsyncInventoryNoProvider(), $options,
    new AsyncInventoryCacheHit(), null, null, [$queue, 'recordSourceInventory']);
$html = '<html><body><p>Guten Tag</p></body></html>';
$start = microtime(true);
$translator->translateSourcePage($html, 'en', 'https://example.test/en/a');
$elapsed = microtime(true) - $start;
if ($GLOBALS['_dg_async_http'] !== [] || $elapsed > 0.1) {
    fwrite(STDERR, "FAIL: cached frontend render waited for unavailable inventory endpoint.\n");
    exit(1);
}
$pending = get_option(SourceInventoryQueue::QUEUE_OPTION, []);
if (count($pending) !== 1 || !wp_next_scheduled(SourceInventoryQueue::HOOK)) {
    fwrite(STDERR, "FAIL: digest-only source observation was not queued.\n"); exit(1);
}
$queuedPayload = current($pending)['payload'];
if ($queuedPayload['originalHashes'] !== [md5('Guten Tag|de|en')]
    || str_contains(json_encode($pending), 'Guten Tag')) {
    fwrite(STDERR, "FAIL: queue lacks exact digest identity or contains source copy.\n"); exit(1);
}
$GLOBALS['_dg_async_events'] = [];
$queue->run();
if (count($GLOBALS['_dg_async_http']) !== 1
    || count(get_option(SourceInventoryQueue::QUEUE_OPTION, [])) !== 1
    || get_transient(current($pending)['successKey']) !== false) {
    fwrite(STDERR, "FAIL: failed cron request must remain pending without success receipt.\n"); exit(1);
}
$start = microtime(true);
$translator->translateSourcePage($html, 'en', 'https://example.test/en/a');
if (count($GLOBALS['_dg_async_http']) !== 1 || microtime(true) - $start > 0.1) {
    fwrite(STDERR, "FAIL: repeated cached render retried unavailable endpoint inline.\n"); exit(1);
}
$pending = get_option(SourceInventoryQueue::QUEUE_OPTION, []);
$entryKey = array_key_first($pending);
$pending[$entryKey]['nextAttempt'] = time();
update_option(SourceInventoryQueue::QUEUE_OPTION, $pending);
$GLOBALS['_dg_async_available'] = true;
$GLOBALS['_dg_async_events'] = [];
$queue->run();
if (count($GLOBALS['_dg_async_http']) !== 2
    || get_option(SourceInventoryQueue::QUEUE_OPTION, []) !== []
    || get_transient($pending[$entryKey]['successKey']) === false) {
    fwrite(STDERR, "FAIL: successful cron receipt must drain and debounce observation.\n"); exit(1);
}
$body = json_decode($GLOBALS['_dg_async_http'][1]['args']['body'], true);
if ($body['capturedMicros'] !== $pending[$entryKey]['payload']['capturedMicros']) {
    fwrite(STDERR, "FAIL: cron must retain the original source capture time.\n"); exit(1);
}
$queue->recordSourceInventory(['Stale capture'], 'de', 'en', 'https://example.test/en/stale',
    true, false, (string) ((time() - 360) * 1000000));
$GLOBALS['_dg_async_events'] = [];
$queue->run();
if (count($GLOBALS['_dg_async_http']) !== 2 || get_option(SourceInventoryQueue::QUEUE_OPTION, []) !== []) {
    fwrite(STDERR, "FAIL: expired capture must be dropped without reporting success.\n"); exit(1);
}
$raceUrl = 'https://example.test/en/race';
$queue->recordSourceInventory(['Earlier'], 'de', 'en', $raceUrl, true, false,
    (string) (time() * 1000000));
$GLOBALS['_dg_async_during_http'] = static function () use ($queue, $raceUrl): void {
    $queue->recordSourceInventory(['Later'], 'de', 'en', $raceUrl, true, false,
        (string) (time() * 1000000 + 1));
};
$GLOBALS['_dg_async_events'] = [];
$queue->run();
$racePending = get_option(SourceInventoryQueue::QUEUE_OPTION, []);
if (count($racePending) !== 1 || current($racePending)['payload']['originalHashes'] !== [md5('Later|de|en')]) {
    fwrite(STDERR, "FAIL: cron response clobbered a newer render queued during HTTP.\n"); exit(1);
}
update_option(SourceInventoryQueue::QUEUE_OPTION, []);
$cacheRaceUrl = 'https://example.test/en/request-cache-race';
$queue->recordSourceInventory(['Old cached option'], 'de', 'en', $cacheRaceUrl, true, false,
    (string) (time() * 1000000));
$GLOBALS['_dg_async_during_http'] = static function (): void {
    // A second WordPress process updates wp_options while this cron process
    // still has its pre-HTTP get_option() value in its request-local cache.
    $current = $GLOBALS['_dg_async_options'][SourceInventoryQueue::QUEUE_OPTION];
    $key = array_key_first($current);
    $hashes = [md5('New cached option|de|en')];
    $current[$key]['payload']['originalHashes'] = $hashes;
    $current[$key]['payload']['capturedMicros'] = (string) ((int) $current[$key]['payload']['capturedMicros'] + 1);
    $current[$key]['digest'] = hash('sha256', json_encode([$hashes, true, false]));
    $GLOBALS['_dg_async_options'][SourceInventoryQueue::QUEUE_OPTION] = $current;
};
$GLOBALS['_dg_async_events'] = [];
$queue->run();
$cacheRacePending = $GLOBALS['_dg_async_options'][SourceInventoryQueue::QUEUE_OPTION];
if (count($cacheRacePending) !== 1
    || current($cacheRacePending)['payload']['originalHashes'] !== [md5('New cached option|de|en')]) {
    fwrite(STDERR, "FAIL: cron used a stale request-local WordPress option after HTTP.\n"); exit(1);
}
update_option(SourceInventoryQueue::QUEUE_OPTION, []);
for ($i = 0; $i < 70; $i++) {
    $queue->recordSourceInventory(['Cached'], 'de', 'en', 'https://example.test/en/bound-' . $i,
        true, false, (string) (time() * 1000000 + $i));
}
if (count(get_option(SourceInventoryQueue::QUEUE_OPTION, [])) !== 64
    || count($GLOBALS['_dg_async_http']) !== 4) {
    fwrite(STDERR, "FAIL: pending contexts must remain bounded without frontend HTTP.\n"); exit(1);
}
update_option(SourceInventoryQueue::QUEUE_OPTION, []);
$flipUrl = 'https://example.test/en/flip';
$queue->recordSourceInventory(['Absent again'], 'de', 'en', $flipUrl, true, false,
    (string) (time() * 1000000));
$flip = current(get_option(SourceInventoryQueue::QUEUE_OPTION, []));
set_transient($flip['successKey'], ['digest' => $flip['digest'], 'sent_at' => time()], 300);
update_option(SourceInventoryQueue::QUEUE_OPTION, []);
$queue->recordSourceInventory(['Temporarily present'], 'de', 'en', $flipUrl, true, false,
    (string) (time() * 1000000 + 1));
$queue->recordSourceInventory(['Absent again'], 'de', 'en', $flipUrl, true, false,
    (string) (time() * 1000000 + 2));
if (current(get_option(SourceInventoryQueue::QUEUE_OPTION, []))['payload']['originalHashes']
    !== [md5('Absent again|de|en')]) {
    fwrite(STDERR, "FAIL: success debounce kept a superseded pending source capture.\n"); exit(1);
}
update_option(SourceInventoryQueue::QUEUE_OPTION, []);
$queue->recordSourceInventory(['Old project'], 'de', 'en', 'https://example.test/en/changed-key',
    true, false, (string) (time() * 1000000));
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true, 'api_key' => 'different-project-key', 'api_url' => 'http://127.0.0.1:31557/api',
    'source_language' => 'de', 'target_languages' => ['en'],
]));
$GLOBALS['_dg_async_events'] = [];
$queue->run();
if (count($GLOBALS['_dg_async_http']) !== 4 || get_option(SourceInventoryQueue::QUEUE_OPTION, []) !== []) {
    fwrite(STDERR, "FAIL: queued observation cannot cross API-key identity changes.\n"); exit(1);
}
fwrite(STDOUT, "SourceInventoryAsyncTest: OK\n");
