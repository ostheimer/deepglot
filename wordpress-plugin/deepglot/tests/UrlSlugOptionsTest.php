<?php

/**
 * Contract tests for the bounded WordPress cache of SaaS UrlSlug records.
 */

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_slug_options'] = [];

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_slug_options'][$key] ?? $default;
    }

    function update_option($key, $value) {
        $GLOBALS['_deepglot_slug_options'][$key] = $value;
        return true;
    }

    function wp_cache_delete($key, $group = '') {
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

function slugOptionsAssert($expected, $actual, string $message): void
{
    if ($expected !== $actual) {
        fwrite(STDERR, $message . PHP_EOL);
        fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
        fwrite(STDERR, 'Actual:   ' . var_export($actual, true) . PHP_EOL);
        exit(1);
    }
}

function slugOptionsSettings(array $overrides = []): array
{
    return array_merge(Options::defaults(), [
        'api_key' => 'dg_live_project_a',
        'api_base_url' => 'https://deepglot.ai/api',
        'target_languages' => ['en', 'fr'],
        // Avoid exercising the unrelated legacy switcher migration here.
        'switcher_instances' => [['id' => 'default']],
    ], $overrides);
}

$options = new Options();
slugOptionsAssert(true, array_key_exists('url_slug_mappings', Options::defaults()), 'A bounded URL slug cache default must exist.');

update_option(Options::OPTION_KEY, slugOptionsSettings());
$options->applyRuntimeConfig([
    'urlSlugs' => [
        ['langTo' => 'en', 'originalSlug' => 'ueber-uns', 'translatedSlug' => 'about-us'],
        ['langTo' => 'en', 'originalSlug' => 'aerzte', 'translatedSlug' => 'ärzte'],
        ['langTo' => 'fr', 'originalSlug' => 'ueber-uns', 'translatedSlug' => 'a-propos'],
        ['langTo' => 'es', 'originalSlug' => 'ueber-uns', 'translatedSlug' => 'sobre-nosotros'],
        ['langTo' => 'en', 'originalSlug' => 'kontakt', 'translatedSlug' => 'contact'],
        ['langTo' => 'en', 'originalSlug' => 'kontaktieren', 'translatedSlug' => 'contact'],
        ['langTo' => 'en', 'originalSlug' => 'Foo', 'translatedSlug' => 'first'],
        ['langTo' => 'en', 'originalSlug' => 'foo', 'translatedSlug' => 'second'],
        ['langTo' => 'en', 'originalSlug' => 'unsafe', 'translatedSlug' => '../wp-admin'],
        ['langTo' => 'en', 'originalSlug' => 'encoded-slash', 'translatedSlug' => 'foo%2Fbar'],
        ['langTo' => 'en', 'originalSlug' => 'literal-percent', 'translatedSlug' => 'foo%252Fbar'],
        ['langTo' => 'en', 'originalSlug' => str_repeat('a', Options::URL_SLUG_SEGMENT_MAX_LEN + 1), 'translatedSlug' => 'too-long'],
        ['langTo' => 'en', 'originalSlug' => 'non-string', 'translatedSlug' => ['bad']],
    ],
]);

$expectedMappings = [
    'en' => [
        'ueber-uns' => 'about-us',
        'aerzte' => '%C3%A4rzte',
        'literal-percent' => 'foo%252Fbar',
    ],
    'fr' => [
        'ueber-uns' => 'a-propos',
    ],
];
slugOptionsAssert($expectedMappings, $options->getUrlSlugMappings(), 'Runtime URL slugs must be sanitized, target-scoped, collision-safe, and canonically encoded.');

$options->applyRuntimeConfig([
    'exclusions' => ['urls' => ['/private'], 'regexes' => [], 'selectors' => []],
]);
slugOptionsAssert($expectedMappings, $options->getUrlSlugMappings(), 'A partial runtime payload without urlSlugs must preserve the existing cache.');

$sameSourceInput = array_merge(slugOptionsSettings(), ['enabled' => true]);
unset($sameSourceInput['url_slug_mappings']);
$sameSourceSave = $options->sanitize($sameSourceInput);
slugOptionsAssert($expectedMappings, $sameSourceSave['url_slug_mappings'], 'A normal settings save for the same key and backend must preserve runtime-only slug mappings.');

$newKeyInput = array_merge(slugOptionsSettings(), ['api_key' => 'dg_live_project_b']);
$newKeyInput['url_slug_mappings'] = $expectedMappings;
$newKeySave = $options->sanitize($newKeyInput);
slugOptionsAssert([], $newKeySave['url_slug_mappings'], 'Changing the API key must clear mappings from the previous project even if a REST merge carries the old runtime-only field forward.');

$newBackendInput = array_merge(slugOptionsSettings(), ['api_base_url' => 'https://staging.deepglot.test/api']);
unset($newBackendInput['url_slug_mappings']);
$newBackendSave = $options->sanitize($newBackendInput);
slugOptionsAssert([], $newBackendSave['url_slug_mappings'], 'Changing the API backend must clear mappings from the previous backend.');

$options->applyRuntimeConfig(['urlSlugs' => []]);
slugOptionsAssert([], $options->getUrlSlugMappings(), 'An explicit empty SaaS urlSlugs list must clear stale cached mappings.');

fwrite(STDOUT, "UrlSlugOptionsTest: OK\n");
