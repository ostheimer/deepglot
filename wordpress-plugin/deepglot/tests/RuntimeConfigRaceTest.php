<?php

/**
 * Reproduces the runtime-sync read-modify-write race observed live on
 * meinhaushalt.at (2026-06-10): applyRuntimeConfig() rebuilt the whole
 * settings option from THIS request's options cache. A frontend request that
 * started before an admin save therefore wrote its stale snapshot back and
 * silently reverted the admin's change (e.g. `enable_dynamic_translation`
 * flipped back to false within minutes of being enabled).
 *
 * The stubs model WordPress' per-request options cache: get_option() serves
 * the cached snapshot until wp_cache_delete() evicts it, after which it falls
 * through to the persistent store. applyRuntimeConfig() must evict and
 * re-read before writing, so the admin's fresh save survives the sync.
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }
}

$GLOBALS['_dgrace_store'] = []; // persistent store ("database")
$GLOBALS['_dgrace_cache'] = []; // per-request options cache (stale snapshot)

if (!function_exists('get_option')) {
    function get_option($key, $default = false) {
        if (array_key_exists($key, $GLOBALS['_dgrace_cache'])) {
            return $GLOBALS['_dgrace_cache'][$key];
        }
        return $GLOBALS['_dgrace_store'][$key] ?? $default;
    }

    function update_option($key, $value) {
        $GLOBALS['_dgrace_store'][$key] = $value;
        $GLOBALS['_dgrace_cache'][$key] = $value;
        return true;
    }

    function wp_cache_delete($key, $group = '') {
        unset($GLOBALS['_dgrace_cache'][$key]);
        return true;
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
}

require_once __DIR__ . '/../includes/Config/Options.php';

use Deepglot\Config\Options;

function raceCheck($condition, string $message): void
{
    if ($condition !== true) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

// The database holds the admin's fresh save: dynamic translation enabled,
// a custom switcher style, and e-mail translation turned on.
$freshSave = array_merge(Options::defaults(), [
    'api_key' => 'dg_live_test',
    'enabled' => true,
    'enable_dynamic_translation' => true,
    'translate_emails' => true,
    'switcher_default_style' => 'dropdown',
]);
$GLOBALS['_dgrace_store'][Options::OPTION_KEY] = $freshSave;

// This (long-running frontend) request still holds the pre-save snapshot in
// its options cache: everything off / defaults.
$GLOBALS['_dgrace_cache'][Options::OPTION_KEY] = array_merge(Options::defaults(), [
    'api_key' => 'dg_live_test',
    'enabled' => true,
]);

// The request's 5-minute runtime sync fires and applies the SaaS config.
$options = new Options();
$options->applyRuntimeConfig([
    'exclusions' => [
        'urls' => ['/private'],
        'regexes' => [],
        'selectors' => ['.no-translate'],
    ],
]);

$stored = $GLOBALS['_dgrace_store'][Options::OPTION_KEY];

// The runtime fields from the SaaS must be applied …
raceCheck($stored['exclude_urls'] === '/private', 'Runtime exclusions must be applied to the stored option.');
raceCheck($stored['exclude_selectors'] === '.no-translate', 'Runtime selectors must be applied to the stored option.');
raceCheck(($stored['runtime_config_synced_at'] ?? 0) > 0, 'The sync timestamp must be updated.');

// … but the admin's fresh save must survive: the sync must re-read the
// stored option instead of writing this request's stale snapshot back.
raceCheck($stored['enable_dynamic_translation'] === true, 'A stale request cache must not revert enable_dynamic_translation.');
raceCheck($stored['translate_emails'] === true, 'A stale request cache must not revert translate_emails.');
raceCheck($stored['switcher_default_style'] === 'dropdown', 'A stale request cache must not revert switcher settings.');

// Scenario 2: the payload was fetched with the PREVIOUS project's API key
// (admin switched projects while this request was in flight). It must be
// discarded entirely — neither another project's exclusions nor a fresh sync
// timestamp may be written.
$GLOBALS['_dgrace_store'][Options::OPTION_KEY] = array_merge(Options::defaults(), [
    'api_key' => 'dg_live_project_b',
    'enabled' => true,
    'exclude_urls' => '/keep-b',
]);
$GLOBALS['_dgrace_cache'][Options::OPTION_KEY] = array_merge(Options::defaults(), [
    'api_key' => 'dg_live_project_a',
    'enabled' => true,
]);

$applied = $options->applyRuntimeConfig(
    ['exclusions' => ['urls' => ['/from-project-a'], 'regexes' => [], 'selectors' => []]],
    'dg_live_project_a'
);

$storedB = $GLOBALS['_dgrace_store'][Options::OPTION_KEY];
raceCheck($applied === false, 'A payload fetched with a stale API key must be discarded.');
raceCheck($storedB['exclude_urls'] === '/keep-b', 'Another project\'s exclusions must not be merged in.');
raceCheck(($storedB['runtime_config_synced_at'] ?? 0) === 0, 'A discarded payload must not stamp the sync timestamp.');

// Scenario 3: same key but a DIFFERENT backend (e.g. test-connection probed a
// candidate base URL that was never saved) must also be discarded.
$applied = $options->applyRuntimeConfig(
    ['exclusions' => ['urls' => ['/from-other-backend'], 'regexes' => [], 'selectors' => []]],
    'dg_live_project_b',
    'https://staging.example.test/api'
);
$storedB = $GLOBALS['_dgrace_store'][Options::OPTION_KEY];
raceCheck($applied === false, 'A payload fetched from a different base URL must be discarded.');
raceCheck($storedB['exclude_urls'] === '/keep-b', 'Another backend\'s exclusions must not be merged in.');

// Scenario 4: matching key and base URL applies normally (trailing slash on
// the fetch URL must not cause a false mismatch).
$applied = $options->applyRuntimeConfig(
    ['exclusions' => ['urls' => ['/from-project-b'], 'regexes' => [], 'selectors' => []]],
    'dg_live_project_b',
    Options::defaults()['api_base_url'] . '/'
);
$storedB = $GLOBALS['_dgrace_store'][Options::OPTION_KEY];
raceCheck($applied === true, 'A payload fetched with the current key and base URL must be applied.');
raceCheck($storedB['exclude_urls'] === '/from-project-b', 'Matching payloads must update exclusions.');

fwrite(STDOUT, "RuntimeConfigRaceTest: OK\n");
