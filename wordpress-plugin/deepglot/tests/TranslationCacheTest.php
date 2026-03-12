<?php

/**
 * Unit tests for TranslationCache (WP-transient wrapper).
 * Run with: vendor/bin/phpunit tests/ (requires a WP test environment or stubs).
 *
 * These tests use simple stubs for get_transient / set_transient / $wpdb
 * so they can run without a live WordPress installation.
 */

// Minimal WP stubs so the class can be loaded standalone.
if (!function_exists('get_transient')) {
    $GLOBALS['_transient_store'] = [];

    function get_transient(string $key)
    {
        return $GLOBALS['_transient_store'][$key] ?? false;
    }

    function set_transient(string $key, $value, int $ttl = 0): bool
    {
        $GLOBALS['_transient_store'][$key] = $value;
        return true;
    }

    function delete_transient(string $key): bool
    {
        unset($GLOBALS['_transient_store'][$key]);
        return true;
    }

    if (!defined('DAY_IN_SECONDS')) {
        define('DAY_IN_SECONDS', 86400);
    }
}

require_once __DIR__ . '/../includes/Support/TranslationCache.php';

use Deepglot\Support\TranslationCache;

// ---------------------------------------------------------------------------

function test_cache_miss_returns_null(): void
{
    $cache = new TranslationCache();
    assert($cache->get('Hello', 'de', 'en') === null, 'Cache miss must return null');
}

function test_set_then_get_returns_value(): void
{
    $cache = new TranslationCache();
    $cache->set('Hallo', 'de', 'en', 'Hello');
    assert($cache->get('Hallo', 'de', 'en') === 'Hello', 'Stored value must be retrievable');
}

function test_different_languages_do_not_collide(): void
{
    $cache = new TranslationCache();
    $cache->set('Hallo', 'de', 'en', 'Hello');
    $cache->set('Hallo', 'de', 'fr', 'Bonjour');
    assert($cache->get('Hallo', 'de', 'en') === 'Hello', 'EN translation must be independent');
    assert($cache->get('Hallo', 'de', 'fr') === 'Bonjour', 'FR translation must be independent');
}

function test_get_many_returns_only_cached(): void
{
    $GLOBALS['_transient_store'] = [];
    $cache = new TranslationCache();
    $cache->set('Hallo', 'de', 'en', 'Hello');

    $result = $cache->getMany(['Hallo', 'Welt'], 'de', 'en');
    assert(count($result) === 1, 'Only cached entries returned');
    assert($result['Hallo'] === 'Hello', 'Cached entry has correct value');
    assert(!isset($result['Welt']), 'Uncached entry must be absent');
}

function test_set_many_stores_all(): void
{
    $GLOBALS['_transient_store'] = [];
    $cache = new TranslationCache();
    $cache->setMany(['Hallo' => 'Hello', 'Welt' => 'World'], 'de', 'en');
    assert($cache->get('Hallo', 'de', 'en') === 'Hello');
    assert($cache->get('Welt', 'de', 'en') === 'World');
}

// ---------------------------------------------------------------------------
// Run tests.

$tests = [
    'test_cache_miss_returns_null',
    'test_set_then_get_returns_value',
    'test_different_languages_do_not_collide',
    'test_get_many_returns_only_cached',
    'test_set_many_stores_all',
];

$passed = 0;
$failed = 0;

foreach ($tests as $test) {
    try {
        $test();
        echo "✓ {$test}\n";
        $passed++;
    } catch (\Throwable $e) {
        echo "✗ {$test}: {$e->getMessage()}\n";
        $failed++;
    }
}

echo "\n{$passed} passed, {$failed} failed\n";

exit($failed > 0 ? 1 : 0);
