<?php

require_once __DIR__ . '/WordPressTestBootstrap.php';

if (!function_exists('__')) { function __($text, $domain = null) { return $text; } }
$GLOBALS['_deepglot_inventory_options'] = [];
$GLOBALS['_deepglot_inventory_requests'] = [];
function get_option($key, $default = false) { return $GLOBALS['_deepglot_inventory_options'][$key] ?? $default; }
function update_option($key, $value) { $GLOBALS['_deepglot_inventory_options'][$key] = $value; return true; }
function add_option($key, $value) { if (array_key_exists($key, $GLOBALS['_deepglot_inventory_options'])) return false; $GLOBALS['_deepglot_inventory_options'][$key] = $value; return true; }
function delete_option($key) { unset($GLOBALS['_deepglot_inventory_options'][$key]); return true; }
function get_transient($key) { return false; }
function set_transient($key, $value, $ttl = 0) { return true; }
function wp_next_scheduled($hook) { return false; }
function wp_schedule_single_event($timestamp, $hook) { return true; }
function is_wp_error($value) { return false; }
function wp_parse_args($args, $defaults = []) { return array_merge($defaults, is_array($args) ? $args : []); }
function sanitize_text_field($value) { return trim((string) $value); }
function sanitize_textarea_field($value) { return trim((string) $value); }
function esc_url_raw($value) { return (string) $value; }
function untrailingslashit($value) { return rtrim((string) $value, '/'); }
function wp_json_encode($value) { return json_encode($value); }
function wp_remote_request($url, $args = []) {
    $GLOBALS['_deepglot_inventory_requests'][] = ['url' => $url, 'args' => $args];
    return ['response' => ['code' => 200], 'body' => '{"accepted":true}'];
}
function wp_remote_retrieve_response_code($response) { return $response['response']['code']; }
function wp_remote_retrieve_body($response) { return $response['body']; }
function is_user_logged_in() { return $GLOBALS['_deepglot_inventory_private']['logged_in'] ?? false; }
function is_preview() { return $GLOBALS['_deepglot_inventory_private']['preview'] ?? false; }
function is_admin() { return $GLOBALS['_deepglot_inventory_private']['admin'] ?? false; }
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

class SourceInventoryCacheHit extends TranslationCache {
    public function getMany(array $texts, string $from, string $to): array {
        return array_combine($texts, array_map(static fn($text) => '[en] ' . $text, $texts));
    }
    public function setMany(array $translations, string $from, string $to): array { return []; }
}
class SourceInventoryNoProviderClient extends Client {
    public int $translationCalls = 0;
    public function __construct() {}
    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0, ?int $timeout = null) {
        $this->translationCalls++;
        throw new RuntimeException('Provider must not be used on cache-hit inventory test.');
    }
}
function inventoryAssert(bool $condition, string $message): void {
    if (!$condition) { fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL); exit(1); }
}

$options = new Options();
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true, 'api_key' => 'local-fixture-key', 'api_url' => 'http://127.0.0.1:31557/api',
    'source_language' => 'de', 'target_languages' => ['en'],
]));
$inventoryClient = new Client($options);
$inventoryQueue = new SourceInventoryQueue($inventoryClient, $options);
$noProvider = new SourceInventoryNoProviderClient();
$observer = [$inventoryQueue, 'recordSourceInventory'];
function flushInventory(SourceInventoryQueue $queue): void { $queue->run(); }
$translator = new HtmlTranslator($noProvider, $options, new SourceInventoryCacheHit(), null, null, $observer);
$url = 'https://example.test/en/a';
$html = '<html><head><title>Hallo Welt</title></head><body><p>Guten Tag</p><img alt="Schönes Bild"></body></html>';
http_response_code(200);
$translator->translateSourcePage($html, 'en', $url, 0);
inventoryAssert($GLOBALS['_deepglot_inventory_requests'] === [], 'Render never dispatches inventory HTTP.');
flushInventory($inventoryQueue);
inventoryAssert(count($GLOBALS['_deepglot_inventory_requests']) === 1, 'Complete render must report once on cache hit.');
$request = $GLOBALS['_deepglot_inventory_requests'][0];
$body = json_decode($request['args']['body'], true);
inventoryAssert(str_ends_with($request['url'], '/plugin/source-inventory'), 'Only inventory endpoint is used.');
inventoryAssert($body['complete'] === true && $body['dynamicPossible'] === false, 'Complete static render is identified.');
inventoryAssert($body['requestUrl'] === $url, 'Localized context is preserved.');
inventoryAssert(in_array(md5('Guten Tag|de|en'), $body['originalHashes'], true), 'Digest matches SaaS translation identity.');
inventoryAssert(in_array(md5('Schönes Bild|de|en'), $body['originalHashes'], true), 'Attribute source is observed.');
inventoryAssert(!str_contains($request['args']['body'], 'Guten Tag'), 'Raw source copy never leaves in inventory payload.');
inventoryAssert($noProvider->translationCalls === 0, 'No paid translation call on complete cache hit.');

$translator->translateInline('<span>Inline Text</span>', 'en', $url);
$translator->translateForEditor($html, 'en', $url);
inventoryAssert(count($GLOBALS['_deepglot_inventory_requests']) === 1, 'Inline/editor content cannot claim full-page completeness.');

update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true, 'api_key' => 'local-fixture-key', 'api_url' => 'http://127.0.0.1:31557/api',
    'source_language' => 'de', 'target_languages' => ['en'], 'enable_dynamic_translation' => true,
]));
$translator->translateSourcePage($html, 'en', $url, 0);
flushInventory($inventoryQueue);
$dynamic = json_decode($GLOBALS['_deepglot_inventory_requests'][1]['args']['body'], true);
inventoryAssert($dynamic['complete'] === false && $dynamic['dynamicPossible'] === true
    && $dynamic['originalHashes'] === [], 'Dynamic page fails closed as unknown.');
$translator->translateSourcePage('<html><body><p>Abbruch</p>', 'en', $url, 0);
flushInventory($inventoryQueue);
$partial = json_decode($GLOBALS['_deepglot_inventory_requests'][2]['args']['body'], true);
inventoryAssert($partial['complete'] === false && $partial['originalHashes'] === [], 'Aborted render fails closed.');

update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true, 'api_key' => 'local-fixture-key', 'api_url' => 'http://127.0.0.1:31557/api',
    'source_language' => 'de', 'target_languages' => ['en'],
]));
foreach (['logged_in', 'preview', 'admin'] as $privateContext) {
    $GLOBALS['_deepglot_inventory_private'] = [$privateContext => true];
    $translator->translateSourcePage($html, 'en', $url, 0);
    flushInventory($inventoryQueue);
    $observed = json_decode(end($GLOBALS['_deepglot_inventory_requests'])['args']['body'], true);
    inventoryAssert($observed['complete'] === false && $observed['originalHashes'] === [],
        $privateContext . ' render cannot prove public page absence.');
}
$GLOBALS['_deepglot_inventory_private'] = [];
$_SERVER['REQUEST_METHOD'] = 'POST';
$translator->translateSourcePage($html, 'en', $url, 0);
flushInventory($inventoryQueue);
$observed = json_decode(end($GLOBALS['_deepglot_inventory_requests'])['args']['body'], true);
inventoryAssert($observed['complete'] === false && $observed['originalHashes'] === [],
    'POST response cannot prove public page absence.');
unset($_SERVER['REQUEST_METHOD']);
$_SERVER['HTTP_COOKIE'] = 'customer_session=secret';
$translator->translateSourcePage($html, 'en', $url, 0);
flushInventory($inventoryQueue);
$observed = json_decode(end($GLOBALS['_deepglot_inventory_requests'])['args']['body'], true);
inventoryAssert($observed['complete'] === false && $observed['originalHashes'] === [],
    'Personalized cookie response cannot prove public page absence.');
unset($_SERVER['HTTP_COOKIE']);

$inventoryQueue->recordSourceInventory(array_fill(0, 2001, 'too many source nodes'),
    'de', 'en', $url, true, false, sprintf('%.0f', microtime(true) * 1000000));
flushInventory($inventoryQueue);
$oversized = json_decode(end($GLOBALS['_deepglot_inventory_requests'])['args']['body'], true);
inventoryAssert($oversized['complete'] === false && $oversized['originalHashes'] === [],
    'Oversized source capture cannot truncate into a false complete snapshot.');

define('DONOTCACHEPAGE', true);
$translator->translateSourcePage($html, 'en', $url, 0);
flushInventory($inventoryQueue);
$noCache = json_decode(end($GLOBALS['_deepglot_inventory_requests'])['args']['body'], true);
inventoryAssert($noCache['complete'] === false && $noCache['originalHashes'] === [],
    'Explicit no-cache response cannot prove public page absence.');

fwrite(STDOUT, "SourceInventoryObservationTest: OK\n");
