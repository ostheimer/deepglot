<?php

declare(strict_types=1);

$GLOBALS['_dg_media_cache_options'] = [
    'deepglot_media_replacements' => ['en' => ['/uploads/a.pdf' => '/uploads/a-en.pdf']],
];
$GLOBALS['_dg_media_cache_purges'] = [];

function get_option($name, $default = false) { return $GLOBALS['_dg_media_cache_options'][$name] ?? $default; }
function delete_transient($name) { return true; }
function rocket_clean_domain() { $GLOBALS['_dg_media_cache_purges'][] = 'rocket'; }
function w3tc_flush_all() { $GLOBALS['_dg_media_cache_purges'][] = 'w3tc'; }
function do_action($name) { $GLOBALS['_dg_media_cache_purges'][] = $name; }
function wp_cache_clear_cache() { $GLOBALS['_dg_media_cache_purges'][] = 'super-cache'; }
function untrailingslashit($value) { return rtrim((string) $value, '/'); }
function is_wp_error($value) { return false; }

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Sync/SettingsSync.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Sync\SettingsSync;

final class MediaCacheOptions extends Options
{
    public function getApiKey(): string { return 'dg_test'; }
    public function getApiBaseUrl(): string { return 'https://deepglot.test/api'; }
    public function shouldRefreshRuntimeConfig(int $intervalSeconds = 300): bool { return true; }
    public function applyRuntimeConfig(array $runtimeConfig, ?string $fetchedWithApiKey = null, ?string $fetchedFromBaseUrl = null): bool
    {
        if ($runtimeConfig['changed'] ?? false) {
            $GLOBALS['_dg_media_cache_options'][Options::MEDIA_REPLACEMENTS_OPTION_KEY] = $runtimeConfig['mediaReplacements'];
        }
        return true;
    }
}

final class MediaCacheClient extends Client
{
    public array $snapshot = ['changed' => false];
    public function fetchRuntimeConfig(?string $apiKeyOverride = null, ?string $baseUrlOverride = null) { return $this->snapshot; }
}

$options = new MediaCacheOptions();
$client = new MediaCacheClient($options);
$sync = new SettingsSync($options, $client);
$sync->refreshRuntimeConfig(null, null, true);
if ($GLOBALS['_dg_media_cache_purges'] !== []) { throw new RuntimeException('Identical snapshots must not purge page caches.'); }

$client->snapshot = ['changed' => true, 'mediaReplacements' => ['en' => ['/uploads/a.pdf' => '/uploads/b-en.pdf']]];
$sync->refreshRuntimeConfig(null, null, true);
if ($GLOBALS['_dg_media_cache_purges'] !== ['rocket', 'w3tc', 'litespeed_purge_all', 'super-cache']) {
    throw new RuntimeException('Changed media mappings must purge every supported full-page cache.');
}

$GLOBALS['_dg_media_cache_purges'] = [];
$sync->refreshRuntimeConfig(null, null, true);
if ($GLOBALS['_dg_media_cache_purges'] !== []) { throw new RuntimeException('Repeated snapshots must not purge again.'); }

fwrite(STDOUT, "OK: media cache invalidation\n");
