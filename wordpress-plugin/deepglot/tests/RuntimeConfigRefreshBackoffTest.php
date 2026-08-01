<?php

/**
 * Regression coverage for shared runtime-refresh backoff and persisted source
 * changes. One unavailable SaaS request must not make every WordPress request
 * retry synchronously, while merely sanitizing test-connection candidates must
 * remain side-effect free.
 */

if (!class_exists('WP_Error')) {
    class WP_Error
    {
        private string $code;
        private string $message;

        public function __construct(string $code, string $message = '')
        {
            $this->code = $code;
            $this->message = $message;
        }

        public function get_error_message(): string
        {
            return $this->message;
        }
    }
}

if (!function_exists('is_wp_error')) {
    function is_wp_error($value): bool { return $value instanceof WP_Error; }
}
if (!function_exists('__')) {
    function __($text, $domain = null) { return $text; }
}

$GLOBALS['_dgrb_options'] = [];
$GLOBALS['_dgrb_transients'] = [];

class RefreshBackoffWpdb
{
    public string $options = 'wp_options';

    public function delete($table, array $where, array $formats = [])
    {
        $key = (string) ($where['option_name'] ?? '');
        $expected = (string) ($where['option_value'] ?? '');
        if (
            $table !== $this->options
            || !array_key_exists($key, $GLOBALS['_dgrb_options'])
            || (string) $GLOBALS['_dgrb_options'][$key] !== $expected
        ) {
            return 0;
        }

        unset($GLOBALS['_dgrb_options'][$key]);
        return 1;
    }
}

$GLOBALS['wpdb'] = new RefreshBackoffWpdb();

if (!function_exists('get_option')) {
    function get_option($key, $default = false) {
        return $GLOBALS['_dgrb_options'][$key] ?? $default;
    }
    function add_option($key, $value, $deprecated = '', $autoload = true) {
        if (array_key_exists($key, $GLOBALS['_dgrb_options'])) {
            return false;
        }
        $GLOBALS['_dgrb_options'][$key] = $value;
        return true;
    }
    function update_option($key, $value) {
        $GLOBALS['_dgrb_options'][$key] = $value;
        return true;
    }
    function delete_option($key) {
        unset($GLOBALS['_dgrb_options'][$key]);
        return true;
    }
    function get_transient($key) {
        return $GLOBALS['_dgrb_transients'][$key] ?? false;
    }
    function set_transient($key, $value, $expiration = 0) {
        $GLOBALS['_dgrb_transients'][$key] = $value;
        return true;
    }
    function delete_transient($key) {
        unset($GLOBALS['_dgrb_transients'][$key]);
        return true;
    }
    function wp_cache_delete($key, $group = '') { return true; }
    function wp_parse_args($args, $defaults = []) { return array_merge($defaults, is_array($args) ? $args : []); }
    function sanitize_text_field($value) { return trim((string) $value); }
    function sanitize_textarea_field($value) { return trim((string) $value); }
    function esc_url_raw($value) { return (string) $value; }
    function untrailingslashit($value) { return rtrim((string) $value, '/'); }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Sync/SettingsSync.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Sync\SettingsSync;

function refreshBackoffAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

class RefreshBackoffOptions extends Options
{
    public int $clearCalls = 0;

    public function shouldRefreshRuntimeConfig(int $intervalSeconds = 300): bool { return true; }
    public function getApiKey(): string { return 'dg_live_current'; }
    public function getApiBaseUrl(): string { return 'https://deepglot.ai/api'; }
    public function applyRuntimeConfig(array $runtimeConfig, ?string $fetchedWithApiKey = null, ?string $fetchedFromBaseUrl = null): bool { return true; }
    public function clearUrlSlugMappings(): bool
    {
        $this->clearCalls++;
        return true;
    }
}

class RefreshBackoffClient extends Client
{
    public int $runtimeCalls = 0;
    public int $settingsCalls = 0;
    public bool $runtimeSucceeds = false;

    public function fetchRuntimeConfig(?string $apiKeyOverride = null, ?string $baseUrlOverride = null)
    {
        $this->runtimeCalls++;
        if ($this->runtimeSucceeds) {
            return ['urlSlugs' => []];
        }
        return new WP_Error('unavailable', 'SaaS unavailable');
    }

    public function syncSettings(?array $settings = null, ?string $apiKeyOverride = null, ?string $baseUrlOverride = null)
    {
        $this->settingsCalls++;
        return new WP_Error('unavailable', 'SaaS unavailable');
    }
}

$options = new RefreshBackoffOptions();
$client = new RefreshBackoffClient($options);
$sync = new SettingsSync($options, $client);

$sync->maybeRefreshRuntimeConfig();
$sync->maybeRefreshRuntimeConfig();
refreshBackoffAssert($client->runtimeCalls === 1, 'A shared failure backoff must suppress the immediate second refresh attempt.');
refreshBackoffAssert(get_transient('deepglot_runtime_refresh_backoff') !== false, 'A failed refresh must persist a bounded shared backoff marker.');
refreshBackoffAssert(get_option('deepglot_runtime_refresh_lock', false) === false, 'The shared refresh lock must be released after a failed request.');

delete_transient('deepglot_runtime_refresh_backoff');
$sync->maybeRefreshRuntimeConfig();
refreshBackoffAssert($client->runtimeCalls === 2, 'Refresh must be retried after the bounded backoff expires.');

$client->runtimeSucceeds = true;
$forcedResult = $sync->refreshRuntimeConfig(null, null, true);
refreshBackoffAssert(!is_wp_error($forcedResult), 'A forced refresh must be able to recover after a previous failure.');
refreshBackoffAssert(get_transient('deepglot_runtime_refresh_backoff') === false, 'A successfully applied forced refresh must clear the previous failure backoff.');

$oldSettings = array_merge(Options::defaults(), [
    'api_key' => 'dg_live_old',
    'api_base_url' => 'https://deepglot.ai/api',
    'target_languages' => ['en'],
]);
$newSettings = array_merge($oldSettings, ['api_key' => 'dg_live_new']);
$sync->handleOptionUpdate($oldSettings, $newSettings);
refreshBackoffAssert($options->clearCalls === 1, 'Persisting a different API key must clear the previous project slug cache exactly once.');

$sync->handleOptionUpdate($newSettings, $newSettings);
refreshBackoffAssert($options->clearCalls === 1, 'Saving the same runtime source must preserve the slug cache.');

fwrite(STDOUT, "RuntimeConfigRefreshBackoffTest: OK\n");
