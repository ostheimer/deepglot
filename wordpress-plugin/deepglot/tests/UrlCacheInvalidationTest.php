<?php

/** Targeted, cursor-safe application of SaaS URL cache events. */
if (!defined('DAY_IN_SECONDS')) define('DAY_IN_SECONDS', 86400);
$GLOBALS['_dg_url_cache_transients'] = [];
$GLOBALS['_dg_url_cache_options'] = [];
function get_transient(string $key) { return $GLOBALS['_dg_url_cache_transients'][$key] ?? false; }
function set_transient(string $key, $value, int $ttl = 0): bool { $GLOBALS['_dg_url_cache_transients'][$key] = $value; return true; }
function delete_transient(string $key): bool { unset($GLOBALS['_dg_url_cache_transients'][$key]); return true; }
function get_option(string $key, $default = false) { return $GLOBALS['_dg_url_cache_options'][$key] ?? $default; }
function update_option(string $key, $value, $autoload = null): bool { $GLOBALS['_dg_url_cache_options'][$key] = $value; return true; }

require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Sync/SettingsSync.php';

$cache = new \Deepglot\Support\TranslationCache();
$cache->set('Änderung', 'de', 'en', 'Old');
$cache->set('Anders', 'de', 'en', 'Keep');
$sync = (new ReflectionClass(\Deepglot\Sync\SettingsSync::class))->newInstanceWithoutConstructor();
$apply = new ReflectionMethod($sync, 'applyCacheInvalidations');
$digest = sha1('de|en|Änderung');
$apply->invoke($sync, ['cacheInvalidations' => ['entries' => [[
    'id' => '1', 'urlPath' => '/en/test', 'cacheKey' => $digest,
]]]], 'test-identity', '0');
if ($cache->get('Änderung', 'de', 'en') !== null || $cache->get('Anders', 'de', 'en') !== 'Keep') {
    throw new RuntimeException('Only the requested translation transient may be deleted.');
}
$cursor = $GLOBALS['_dg_url_cache_options']['deepglot_url_cache_invalidation_cursor'] ?? null;
if ($cursor !== ['identity' => 'test-identity', 'cursor' => '1']) {
    throw new RuntimeException('The digest must be applied before cursor advancement.');
}
$apply->invoke($sync, ['cacheInvalidations' => ['entries' => [[
    'id' => '2', 'urlPath' => '/en/test', 'cacheKey' => 'bad',
]]]], 'test-identity', '1');
if ($GLOBALS['_dg_url_cache_options']['deepglot_url_cache_invalidation_cursor'] !== $cursor) {
    throw new RuntimeException('Malformed entries must not advance the cursor.');
}
echo "UrlCacheInvalidationTest: OK\n";
