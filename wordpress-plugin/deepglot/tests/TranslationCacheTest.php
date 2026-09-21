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
    $GLOBALS['_transient_ttls'] = [];

    function get_transient(string $key)
    {
        return $GLOBALS['_transient_store'][$key] ?? false;
    }

    function set_transient(string $key, $value, int $ttl = 0): bool
    {
        if (
            ($GLOBALS['_transient_reject_nonbmp'] ?? false) === true
            && is_string($value)
            && preg_match('/[\x{10000}-\x{10FFFF}]/u', $value) === 1
        ) {
            return false;
        }

        if (($GLOBALS['_transient_force_write_failure'] ?? false) === true) {
            return false;
        }

        if (
            ($GLOBALS['_transient_false_when_unchanged'] ?? false) === true
            && array_key_exists($key, $GLOBALS['_transient_store'])
            && $GLOBALS['_transient_store'][$key] === $value
        ) {
            return false;
        }

        $GLOBALS['_transient_store'][$key] = $value;
        $GLOBALS['_transient_ttls'][$key] = $ttl;
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

class DeepglotTranslationCacheWpdbStub
{
    public string $options = 'wp_options';
    /** @var array<int, string> */
    public array $prepareArguments = [];
    /** @var string[] */
    public array $queries = [];

    public function prepare(string $query, string ...$arguments): string
    {
        $this->prepareArguments = $arguments;

        return $query;
    }

    public function query(string $query): void
    {
        $this->queries[] = $query;
    }
}

require_once __DIR__ . '/../includes/Support/TranslationCache.php';

use Deepglot\Support\TranslationCache;

// ---------------------------------------------------------------------------

function assertCache(bool $condition, string $message = 'Cache assertion failed'): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function test_cache_miss_returns_null(): void
{
    $cache = new TranslationCache();
    assert($cache->get('Hello', 'de', 'en') === null, 'Cache miss must return null');
}

function test_set_then_get_returns_value(): void
{
    $GLOBALS['_transient_store'] = [];
    $GLOBALS['_transient_ttls'] = [];
    $cache = new TranslationCache();
    $cache->set('Hallo', 'de', 'en', 'Hello');
    assert($cache->get('Hallo', 'de', 'en') === 'Hello', 'Stored value must be retrievable');

    $key = array_key_first($GLOBALS['_transient_store']);
    assert(str_starts_with($key, 'dgv1_'), 'New translations must use the versioned cache key');
    assert($GLOBALS['_transient_ttls'][$key] === 30 * DAY_IN_SECONDS, 'Translations must retain the 30-day TTL');
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
    $results = $cache->setMany(['Hallo' => 'Hello', 'Welt' => 'World'], 'de', 'en');
    assert($results === ['Hallo' => true, 'Welt' => true], 'Batch writes must report durable status per entry');
    assert($cache->get('Hallo', 'de', 'en') === 'Hello');
    assert($cache->get('Welt', 'de', 'en') === 'World');
}

function test_empty_translations_never_become_cache_hits(): void
{
    $GLOBALS['_transient_store'] = [];
    $cache = new TranslationCache();

    assertCache(
        $cache->set('Meta Beschreibung', 'de', 'en', '') === false,
        'An empty provider result must not become a durable cache hit'
    );
    assertCache(
        $cache->set('Zweite Beschreibung', 'de', 'en', " \t\n") === false,
        'A whitespace-only provider result must not become a durable cache hit'
    );
    assertCache($cache->get('Meta Beschreibung', 'de', 'en') === null, 'Empty translations must be cache misses');
    assertCache($cache->get('Zweite Beschreibung', 'de', 'en') === null, 'Whitespace-only translations must be cache misses');
}

function test_unicode_whitespace_translations_never_become_cache_hits(): void
{
    $GLOBALS['_transient_store'] = [];
    $source = 'Unicode Leerraum';
    $translated = "\u{00A0}\u{2003}";
    $cache = new TranslationCache();

    assertCache(
        $cache->set($source, 'de', 'en', $translated) === false,
        'Unicode whitespace-only provider results must not be cached'
    );

    $versionedKey = 'dgv1_' . sha1('de|en|' . $source);
    $payload = rtrim(strtr(base64_encode($translated), '+/', '-_'), '=');
    $GLOBALS['_transient_store'][$versionedKey] = 'deepglot-cache:v1:'
        . $payload
        . ':'
        . hash('sha256', $versionedKey . "\0" . $translated);

    assertCache(
        $cache->get($source, 'de', 'en') === null,
        'Existing versioned Unicode whitespace-only translations must be cache misses'
    );

    $GLOBALS['_transient_store'] = [
        'dg_' . sha1('de|en|' . $source) => $translated,
    ];

    assertCache(
        $cache->get($source, 'de', 'en') === null,
        'Legacy Unicode whitespace-only translations must be cache misses'
    );
}

function test_legacy_empty_translation_is_treated_as_a_cache_miss(): void
{
    $GLOBALS['_transient_store'] = [];
    $source = 'Bestehende Meta Beschreibung';
    $GLOBALS['_transient_store']['dg_' . sha1('de|en|' . $source)] = '';

    assertCache(
        (new TranslationCache())->get($source, 'de', 'en') === null,
        'A legacy empty translation must be retried instead of blanking frontend metadata'
    );
}

function test_legacy_plain_string_transient_remains_readable(): void
{
    $GLOBALS['_transient_store'] = [];
    $key = 'dg_' . sha1('de|en|Hallo');
    $GLOBALS['_transient_store'][$key] = 'Legacy translation';

    assert((new TranslationCache())->get('Hallo', 'de', 'en') === 'Legacy translation', 'Existing plain-string transients must remain readable');
}

function test_corrupted_envelope_fails_closed(): void
{
    $GLOBALS['_transient_store'] = [];
    $cache = new TranslationCache();
    $cache->set('Hallo', 'de', 'en', 'Hello');

    $key = array_key_first($GLOBALS['_transient_store']);
    $GLOBALS['_transient_store'][$key] = 'deepglot-cache:v1:SGVsbG8:' . str_repeat('0', 64);
    $GLOBALS['_transient_store']['dg_' . sha1('de|en|Hallo')] = 'Legacy fallback must not bypass corruption';

    assert($cache->get('Hallo', 'de', 'en') === null, 'A corrupted envelope must not be returned as a cache hit');
}

function test_unknown_envelope_version_fails_closed(): void
{
    $GLOBALS['_transient_store'] = [];
    $cache = new TranslationCache();
    $cache->set('Hallo', 'de', 'en', 'Hello');

    $key = array_key_first($GLOBALS['_transient_store']);
    $GLOBALS['_transient_store'][$key] = 'deepglot-cache:v2:SGVsbG8:' . hash('sha256', 'Hello');

    assert($cache->get('Hallo', 'de', 'en') === null, 'An unknown envelope version must not be returned as a cache hit');
}

function test_nonbmp_translation_survives_legacy_three_byte_transient_storage(): void
{
    $GLOBALS['_transient_store'] = [];
    $GLOBALS['_transient_reject_nonbmp'] = true;

    try {
        $cache = new TranslationCache();
        $cache->set('Tolles Ergebnis 🎉', 'de', 'en', 'Great result 🎉');

        assert(
            $cache->get('Tolles Ergebnis 🎉', 'de', 'en') === 'Great result 🎉',
            'A translated value containing non-BMP Unicode must survive a legacy three-byte transient table'
        );

        $stored = reset($GLOBALS['_transient_store']);
        assert(is_string($stored), 'The translation cache must store a string transient');
        assert(
            preg_match('/[\x{10000}-\x{10FFFF}]/u', $stored) !== 1,
            'The persisted transient envelope must be ASCII-safe'
        );
    } finally {
        $GLOBALS['_transient_reject_nonbmp'] = false;
    }
}

function test_cache_reports_a_real_transient_write_failure(): void
{
    $GLOBALS['_transient_store'] = [];
    $GLOBALS['_transient_force_write_failure'] = true;

    try {
        $stored = (new TranslationCache())->set('Hallo', 'de', 'en', 'Hello');
        assert($stored === false, 'A failed transient write must be visible to the caller');
    } finally {
        $GLOBALS['_transient_force_write_failure'] = false;
    }
}

function test_cache_treats_an_identical_false_write_as_durable_after_readback(): void
{
    $GLOBALS['_transient_store'] = [];
    $cache = new TranslationCache();
    $cache->set('Hallo', 'de', 'en', 'Hello');
    $GLOBALS['_transient_false_when_unchanged'] = true;

    try {
        assert(
            $cache->set('Hallo', 'de', 'en', 'Hello') === true,
            'WordPress false-for-unchanged semantics must be verified by an exact readback'
        );
    } finally {
        $GLOBALS['_transient_false_when_unchanged'] = false;
    }
}

function test_envelope_is_bound_to_the_exact_cache_key(): void
{
    $GLOBALS['_transient_store'] = [];
    $cache = new TranslationCache();
    $cache->set('Katze', 'de', 'en', 'Cat');
    $firstKey = array_key_last($GLOBALS['_transient_store']);
    $cache->set('Haus', 'de', 'en', 'House');
    $secondKey = array_key_last($GLOBALS['_transient_store']);

    $firstValue = $GLOBALS['_transient_store'][$firstKey];
    $GLOBALS['_transient_store'][$firstKey] = $GLOBALS['_transient_store'][$secondKey];
    $GLOBALS['_transient_store'][$secondKey] = $firstValue;

    assert($cache->get('Katze', 'de', 'en') === null, 'A valid envelope moved to another source text must fail closed');
    assert($cache->get('Haus', 'de', 'en') === null, 'Both swapped cache entries must fail closed');
}

function test_noncanonical_base64url_payload_fails_closed(): void
{
    $GLOBALS['_transient_store'] = [];
    $cache = new TranslationCache();
    $cache->set('Buchstabe', 'de', 'en', 'A');
    $key = array_key_last($GLOBALS['_transient_store']);
    $value = $GLOBALS['_transient_store'][$key];
    $GLOBALS['_transient_store'][$key] = str_replace(':QQ:', ':QR:', $value);

    assert($cache->get('Buchstabe', 'de', 'en') === null, 'A non-canonical Base64URL spelling must fail closed');
}

function test_legacy_plain_string_with_envelope_like_prefix_remains_readable(): void
{
    $GLOBALS['_transient_store'] = [];
    $source = 'Legacy marker text';
    $legacyKey = 'dg_' . sha1('de|en|' . $source);
    $legacyValue = 'deepglot-cache:not-an-envelope';
    $GLOBALS['_transient_store'][$legacyKey] = $legacyValue;

    assert(
        (new TranslationCache())->get($source, 'de', 'en') === $legacyValue,
        'Legacy plain strings must remain unambiguous even when they start with the new envelope marker'
    );
}

function test_flush_keeps_translation_transient_key_patterns(): void
{
    global $wpdb;

    $wpdb = new DeepglotTranslationCacheWpdbStub();
    (new TranslationCache())->flush();

    assert(count($wpdb->queries) === 1, 'Flush must issue one cache invalidation query');
    assert(
        $wpdb->prepareArguments === [
            '_transient_dg_%',
            '_transient_timeout_dg_%',
            '_transient_dgv1_%',
            '_transient_timeout_dgv1_%',
        ],
        'Flush must continue to target legacy and versioned translation values and their timeout rows'
    );
}

// ---------------------------------------------------------------------------
// Run tests.

$tests = [
    'test_cache_miss_returns_null',
    'test_set_then_get_returns_value',
    'test_different_languages_do_not_collide',
    'test_get_many_returns_only_cached',
    'test_set_many_stores_all',
    'test_empty_translations_never_become_cache_hits',
    'test_unicode_whitespace_translations_never_become_cache_hits',
    'test_legacy_empty_translation_is_treated_as_a_cache_miss',
    'test_legacy_plain_string_transient_remains_readable',
    'test_corrupted_envelope_fails_closed',
    'test_unknown_envelope_version_fails_closed',
    'test_nonbmp_translation_survives_legacy_three_byte_transient_storage',
    'test_cache_reports_a_real_transient_write_failure',
    'test_cache_treats_an_identical_false_write_as_durable_after_readback',
    'test_envelope_is_bound_to_the_exact_cache_key',
    'test_noncanonical_base64url_payload_fails_closed',
    'test_legacy_plain_string_with_envelope_like_prefix_remains_readable',
    'test_flush_keeps_translation_transient_key_patterns',
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
