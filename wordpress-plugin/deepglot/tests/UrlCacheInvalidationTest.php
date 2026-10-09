<?php

/** Targeted, cursor-safe application of SaaS URL cache events. */
if (!defined('DAY_IN_SECONDS')) define('DAY_IN_SECONDS', 86400);
$GLOBALS['_dg_url_cache_transients'] = [];
$GLOBALS['_dg_url_cache_options'] = [];
$GLOBALS['_dg_page_purges'] = 0;
function rocket_clean_domain(): void { $GLOBALS['_dg_page_purges']++; }
function get_transient(string $key) { return $GLOBALS['_dg_url_cache_transients'][$key] ?? false; }
function set_transient(string $key, $value, int $ttl = 0): bool { $GLOBALS['_dg_url_cache_transients'][$key] = $value; return true; }
function delete_transient(string $key): bool { if (($GLOBALS['_dg_url_cache_stubborn'] ?? '') === $key) return true; unset($GLOBALS['_dg_url_cache_transients'][$key]); return true; }
function get_option(string $key, $default = false) { return $GLOBALS['_dg_url_cache_options'][$key] ?? $default; }
function update_option(string $key, $value, $autoload = null): bool {
    if ($key === 'deepglot_url_cache_invalidation_cursor' && !empty($GLOBALS['_dg_url_cache_fail_cursor'])) return false;
    $GLOBALS['_dg_url_cache_options'][$key] = $value;
    return true;
}
function untrailingslashit(string $value): string { return rtrim($value, '/'); }
function is_wp_error($value): bool { return false; }
function wp_next_scheduled(string $hook, array $args = []) { return $GLOBALS['_dg_url_cache_events'][$hook] ?? false; }
function wp_schedule_single_event(int $timestamp, string $hook, array $args = []): bool { $GLOBALS['_dg_url_cache_events'][$hook] = $timestamp; return true; }

require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Sync/SettingsSync.php';

$cache = new \Deepglot\Support\TranslationCache();
$cache->set('Änderung', 'de', 'en', 'Old');
$cache->set('Anders', 'de', 'en', 'Keep');
$sync = (new ReflectionClass(\Deepglot\Sync\SettingsSync::class))->newInstanceWithoutConstructor();
$apply = new ReflectionMethod($sync, 'applyCacheInvalidations');
$digest = sha1('de|en|Änderung');
$apply->invoke($sync, ['cacheInvalidations' => ['entries' => [[
    'id' => '1', 'urlPath' => '/en/test', 'cacheKey' => $digest, 'targetLang' => 'en',
]]]], 'test-identity', '0');
if ($cache->get('Änderung', 'de', 'en') !== null || $cache->get('Anders', 'de', 'en') !== 'Keep') {
    throw new RuntimeException('Only the requested translation transient may be deleted.');
}
$cursor = $GLOBALS['_dg_url_cache_options']['deepglot_url_cache_invalidation_cursor'] ?? null;
if ($cursor !== ['identity' => 'test-identity', 'cursor' => '1']) {
    throw new RuntimeException('The digest must be applied before cursor advancement.');
}
if ($GLOBALS['_dg_page_purges'] !== 1) {
    throw new RuntimeException('Rendered page cache must be purged before cursor advancement.');
}
$apply->invoke($sync, ['cacheInvalidations' => ['entries' => [[
    'id' => '2', 'urlPath' => '/en/test', 'cacheKey' => 'bad',
]]]], 'test-identity', '1');
if ($GLOBALS['_dg_url_cache_options']['deepglot_url_cache_invalidation_cursor'] !== $cursor) {
    throw new RuntimeException('Malformed entries must not advance the cursor.');
}
$stubborn = 'dgv1_' . sha1('de|en|Anders');
$GLOBALS['_dg_url_cache_stubborn'] = $stubborn;
$GLOBALS['_dg_url_cache_options']['deepglot_language_cache_epochs'] = ['en' => 2, 'fr' => 3];
$apply->invoke($sync, ['cacheInvalidations' => ['entries' => [[
    'id' => '3', 'urlPath' => '/en/test', 'cacheKey' => sha1('de|en|Anders'), 'targetLang' => 'en',
]]]], 'test-identity', '1');
if ($GLOBALS['_dg_url_cache_options']['deepglot_url_cache_invalidation_cursor'] !== $cursor) {
    throw new RuntimeException('A reported successful deletion without transient readback must not advance the cursor.');
}
if (get_option('deepglot_language_cache_epochs', []) !== ['en' => 2, 'fr' => 3]) {
    throw new RuntimeException('A failed deletion must not rotate cache epochs.');
}
if ($GLOBALS['_dg_page_purges'] !== 1) {
    throw new RuntimeException('A failed deletion must not purge rendered pages.');
}

class CacheDrainOptions extends \Deepglot\Config\Options {
    public function getApiKey(): string { return 'test-key'; }
    public function getApiBaseUrl(): string { return 'https://example.invalid/api'; }
}
class CacheDrainClient extends \Deepglot\Api\Client {
    public int $calls = 0;
    public int $total = 751;
    public string $digest;
    public function fetchRuntimeConfig(?string $apiKeyOverride = null, ?string $baseUrlOverride = null) {
        $this->calls++;
        $record = get_option('deepglot_url_cache_invalidation_cursor', []);
        $after = (int) ($record['cursor'] ?? 0);
        $entries = [];
        for ($id = $after + 1; $id <= min($after + 250, $this->total); $id++) {
            $entries[] = ['id' => (string) $id, 'urlPath' => '/en/test', 'cacheKey' => $this->digest, 'targetLang' => 'en'];
        }
        return ['cacheInvalidations' => ['entries' => $entries, 'hasMore' => $after + 250 < $this->total]];
    }
}
$GLOBALS['_dg_url_cache_stubborn'] = '';
$GLOBALS['_dg_url_cache_options']['deepglot_language_cache_epochs'] = [];
$GLOBALS['_dg_url_cache_options']['deepglot_url_cache_invalidation_cursor'] = [];
$cache->set('Änderung', 'de', 'en', 'Old');
$drainOptions = new CacheDrainOptions();
$drainClient = new CacheDrainClient($drainOptions);
$drainClient->digest = $digest;
$drainSync = new \Deepglot\Sync\SettingsSync($drainOptions, $drainClient);
$identity = \Deepglot\Api\Client::configurationIdentityFor($drainOptions->getApiKey(), $drainOptions->getApiBaseUrl());
$entries = [];
for ($id = 1; $id <= 250; $id++) {
    $entries[] = ['id' => (string) $id, 'urlPath' => '/en/test', 'cacheKey' => $digest, 'targetLang' => 'en'];
}
$apply->invoke($drainSync, ['cacheInvalidations' => ['entries' => $entries, 'hasMore' => true]], $identity, '0');
if ($drainClient->calls !== 0 || (get_option('deepglot_url_cache_invalidation_cursor', [])['cursor'] ?? '') !== '250') {
    throw new RuntimeException('The visitor request must apply only the first page.');
}
$schedule = new ReflectionMethod($drainSync, 'scheduleCacheInvalidationDrain');
$schedule->invoke($drainSync, $identity);
if (!wp_next_scheduled('deepglot_drain_cache_invalidations', [$identity])) {
    throw new RuntimeException('Remaining cache invalidations must be scheduled for WP-Cron.');
}
$GLOBALS['_dg_url_cache_events'] = [];
$drainSync->drainCacheInvalidationsInBackground($identity);
$drained = get_option('deepglot_url_cache_invalidation_cursor', []);
if (($drained['cursor'] ?? '') !== '750' || $drainClient->calls !== 2
    || !wp_next_scheduled('deepglot_drain_cache_invalidations', [$identity])) {
    throw new RuntimeException('A background run must stop after two pages and schedule the remainder.');
}
$GLOBALS['_dg_url_cache_events'] = [];
$drainSync->drainCacheInvalidationsInBackground($identity);
$drained = get_option('deepglot_url_cache_invalidation_cursor', []);
if (($drained['cursor'] ?? '') !== '751' || $drainClient->calls !== 3
    || $cache->get('Änderung', 'de', 'en') !== null) {
    throw new RuntimeException('A 751-entry feed must complete in background without waiting for settings refresh.');
}
$GLOBALS['_dg_url_cache_options']['deepglot_language_cache_epochs'] = ['en' => 2, 'fr' => 3];
$cache->set('Änderung', 'de', 'en', 'Stale at epoch two');
if ($cache->get('Änderung', 'de', 'en') !== 'Stale at epoch two') {
    throw new RuntimeException('Epoch-scoped cache fixture was not stored.');
}
$apply->invoke($drainSync, ['cacheInvalidations' => ['entries' => [[
    'id' => '752', 'urlPath' => '/en/test', 'cacheKey' => $digest, 'targetLang' => 'en',
]]]], $identity, '751');
$epochs = get_option('deepglot_language_cache_epochs', []);
unset($epochs['__url_cache_cursor']);
if ($epochs !== ['en' => 3, 'fr' => 3]
    || $cache->get('Änderung', 'de', 'en') !== null) {
    throw new RuntimeException('Digest invalidation must retire only matching language epoch-scoped entries.');
}
$apply->invoke($drainSync, ['cacheInvalidations' => ['entries' => [[
    'id' => '753', 'urlPath' => '/en/test', 'cacheKey' => $digest,
]]]], $identity, '752');
$epochs = get_option('deepglot_language_cache_epochs', []);
unset($epochs['__url_cache_cursor']);
if ($epochs !== ['en' => 4, 'fr' => 4]) {
    throw new RuntimeException('Legacy feed entries must retire all positive language epochs.');
}
$GLOBALS['_dg_url_cache_fail_cursor'] = true;
$apply->invoke($drainSync, ['cacheInvalidations' => ['entries' => [[
    'id' => '754', 'urlPath' => '/en/test', 'cacheKey' => $digest, 'targetLang' => 'en',
]]]], $identity, '753');
$epochs = get_option('deepglot_language_cache_epochs', []);
if (($epochs['en'] ?? null) !== 5 || (get_option('deepglot_url_cache_invalidation_cursor', [])['cursor'] ?? '') !== '753') {
    throw new RuntimeException('The epoch and page marker must persist before cursor advancement.');
}
$apply->invoke($drainSync, ['cacheInvalidations' => ['entries' => [[
    'id' => '754', 'urlPath' => '/en/test', 'cacheKey' => $digest, 'targetLang' => 'en',
]]]], $identity, '753');
if ((get_option('deepglot_language_cache_epochs', [])['en'] ?? null) !== 5) {
    throw new RuntimeException('Retrying a failed cursor write must not rotate an epoch twice.');
}
$GLOBALS['_dg_url_cache_fail_cursor'] = false;
echo "UrlCacheInvalidationTest: OK\n";
