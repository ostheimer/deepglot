<?php

/**
 * Regression coverage for stale-lock takeover and release ownership races.
 * Every lock deletion must compare both option_name and the exact token in one
 * database operation, otherwise one request can delete another request's lock.
 */

if (!class_exists('WP_Error')) {
    class WP_Error
    {
        public function get_error_message(): string { return ''; }
    }
}
if (!function_exists('is_wp_error')) {
    function is_wp_error($value): bool { return $value instanceof WP_Error; }
}
if (!function_exists('untrailingslashit')) {
    function untrailingslashit($value): string { return rtrim((string) $value, '/'); }
}

$GLOBALS['_dgcas_options'] = [];
$GLOBALS['_dgcas_transients'] = [];
$GLOBALS['_dgcas_interleaving'] = null;
$GLOBALS['_dgcas_interleaving_injected'] = false;
$GLOBALS['_dgcas_racing_token'] = '';

function dgcasInjectRacingLockIfNeeded($currentValue): void
{
    if (
        $GLOBALS['_dgcas_interleaving_injected']
        || $GLOBALS['_dgcas_interleaving'] === null
        || $currentValue === false
    ) {
        return;
    }

    $GLOBALS['_dgcas_options']['deepglot_runtime_refresh_lock'] = $GLOBALS['_dgcas_racing_token'];
    $GLOBALS['_dgcas_interleaving_injected'] = true;
}

if (!function_exists('get_option')) {
    function get_option($key, $default = false) {
        $value = $GLOBALS['_dgcas_options'][$key] ?? $default;
        if ($key === 'deepglot_runtime_refresh_lock') {
            dgcasInjectRacingLockIfNeeded($value);
        }
        return $value;
    }
    function add_option($key, $value, $deprecated = '', $autoload = true) {
        if (array_key_exists($key, $GLOBALS['_dgcas_options'])) {
            return false;
        }
        $GLOBALS['_dgcas_options'][$key] = $value;
        return true;
    }
    function delete_option($key) {
        unset($GLOBALS['_dgcas_options'][$key]);
        return true;
    }
    function get_transient($key) {
        return $GLOBALS['_dgcas_transients'][$key] ?? false;
    }
    function set_transient($key, $value, $expiration = 0) {
        $GLOBALS['_dgcas_transients'][$key] = $value;
        return true;
    }
    function delete_transient($key) {
        unset($GLOBALS['_dgcas_transients'][$key]);
        return true;
    }
    function wp_cache_delete($key, $group = '') { return true; }
}

class RuntimeConfigLockCasWpdb
{
    public string $options = 'wp_options';

    public function delete($table, array $where, array $formats = [])
    {
        $key = (string) ($where['option_name'] ?? '');
        $expected = (string) ($where['option_value'] ?? '');
        $current = $GLOBALS['_dgcas_options'][$key] ?? false;
        dgcasInjectRacingLockIfNeeded($current);

        if (
            $table !== $this->options
            || !array_key_exists($key, $GLOBALS['_dgcas_options'])
            || (string) $GLOBALS['_dgcas_options'][$key] !== $expected
        ) {
            return 0;
        }

        unset($GLOBALS['_dgcas_options'][$key]);
        return 1;
    }
}

$GLOBALS['wpdb'] = new RuntimeConfigLockCasWpdb();

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Sync/SettingsSync.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Sync\SettingsSync;

$GLOBALS['_dgcas_failures'] = [];

function runtimeLockCasAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        $GLOBALS['_dgcas_failures'][] = $message;
    }
}

class RuntimeLockCasOptions extends Options
{
    public function shouldRefreshRuntimeConfig(int $intervalSeconds = 300): bool { return true; }
    public function getApiKey(): string { return 'dg_live_current'; }
    public function getApiBaseUrl(): string { return 'https://deepglot.ai/api'; }
    public function applyRuntimeConfig(array $runtimeConfig, ?string $fetchedWithApiKey = null, ?string $fetchedFromBaseUrl = null): bool { return true; }
}

class RuntimeLockCasClient extends Client
{
    public int $runtimeCalls = 0;

    public function fetchRuntimeConfig(?string $apiKeyOverride = null, ?string $baseUrlOverride = null)
    {
        $this->runtimeCalls++;
        return ['urlSlugs' => []];
    }
}

function runtimeLockCasSync(&$client): SettingsSync
{
    $options = new RuntimeLockCasOptions();
    $client = new RuntimeLockCasClient($options);
    return new SettingsSync($options, $client);
}

// Request B reads an expired token. Before B deletes it, request A installs a
// fresh token. B must not delete A's token or enter the network path.
$GLOBALS['_dgcas_options'] = [
    'deepglot_runtime_refresh_lock' => (string) (microtime(true) - 120),
];
$GLOBALS['_dgcas_interleaving'] = 'stale_takeover';
$GLOBALS['_dgcas_interleaving_injected'] = false;
$GLOBALS['_dgcas_racing_token'] = sprintf('%.6F:fresh-owner-a', microtime(true));
$freshTakeoverToken = $GLOBALS['_dgcas_racing_token'];
$sync = runtimeLockCasSync($client);
$sync->maybeRefreshRuntimeConfig();

runtimeLockCasAssert($GLOBALS['_dgcas_interleaving_injected'] === true, 'The stale-takeover interleaving must be exercised.');
runtimeLockCasAssert($client->runtimeCalls === 0, 'A stale-lock contender must stop when compare-and-delete loses ownership.');
runtimeLockCasAssert(
    ($GLOBALS['_dgcas_options']['deepglot_runtime_refresh_lock'] ?? null) === $freshTakeoverToken,
    'Stale takeover must preserve the fresh lock installed by another request.'
);

// Request B owns a lock and completes its fetch. Between B's ownership read and
// deletion, request A replaces the option. B's release must preserve A's lock.
$GLOBALS['_dgcas_options'] = [];
$GLOBALS['_dgcas_transients'] = [];
$GLOBALS['_dgcas_interleaving'] = 'release';
$GLOBALS['_dgcas_interleaving_injected'] = false;
$GLOBALS['_dgcas_racing_token'] = sprintf('%.6F:fresh-owner-a-release', microtime(true));
$freshReleaseToken = $GLOBALS['_dgcas_racing_token'];
$sync = runtimeLockCasSync($client);
$sync->maybeRefreshRuntimeConfig();

runtimeLockCasAssert($GLOBALS['_dgcas_interleaving_injected'] === true, 'The release interleaving must be exercised.');
runtimeLockCasAssert($client->runtimeCalls === 1, 'The lock owner must complete exactly one runtime fetch.');
runtimeLockCasAssert(
    ($GLOBALS['_dgcas_options']['deepglot_runtime_refresh_lock'] ?? null) === $freshReleaseToken,
    'Release must not delete a fresh lock installed by another request.'
);

if ($GLOBALS['_dgcas_failures'] !== []) {
    exit(1);
}

fwrite(STDOUT, "RuntimeConfigLockCasTest: OK\n");
