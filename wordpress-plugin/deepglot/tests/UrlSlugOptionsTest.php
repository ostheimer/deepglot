<?php

/**
 * Contract tests for the bounded WordPress cache of SaaS UrlSlug records.
 */

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_slug_options'] = [];
    $GLOBALS['_deepglot_slug_autoload'] = [];

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_slug_options'][$key] ?? $default;
    }

    function add_option($key, $value, $deprecated = '', $autoload = true) {
        if (array_key_exists($key, $GLOBALS['_deepglot_slug_options'])) {
            return false;
        }

        $GLOBALS['_deepglot_slug_options'][$key] = $value;
        $GLOBALS['_deepglot_slug_autoload'][$key] = (bool) $autoload;
        return true;
    }

    function update_option($key, $value) {
        $GLOBALS['_deepglot_slug_options'][$key] = $value;
        if (!array_key_exists($key, $GLOBALS['_deepglot_slug_autoload'])) {
            $GLOBALS['_deepglot_slug_autoload'][$key] = true;
        }
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
slugOptionsAssert(false, array_key_exists('url_slug_mappings', Options::defaults()), 'Runtime URL slug mappings must stay out of the autoloaded settings defaults.');

update_option(Options::OPTION_KEY, slugOptionsSettings());
$reservedInfrastructureSegments = [
    'wp-json',
    'wp-admin',
    'wp-content',
    'wp-includes',
    'wp-login.php',
    'wp-cron.php',
    'xmlrpc.php',
    'wp-comments-post.php',
    'wp-mail.php',
    'wp-trackback.php',
    'wp-signup.php',
    'wp-activate.php',
    'wp-links-opml.php',
];
$runtimeUrlSlugRows = [
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
];
foreach ($reservedInfrastructureSegments as $index => $reservedSegment) {
    $runtimeUrlSlugRows[] = [
        'langTo' => 'en',
        'originalSlug' => 'reserved-target-' . $index,
        'translatedSlug' => $reservedSegment,
    ];
    $runtimeUrlSlugRows[] = [
        'langTo' => 'en',
        'originalSlug' => $reservedSegment,
        'translatedSlug' => 'reserved-source-' . $index,
    ];
}
$runtimeUrlSlugRows[] = ['langTo' => 'en', 'originalSlug' => 'wp-json-guide', 'translatedSlug' => 'api-guide'];
$runtimeUrlSlugRows[] = ['langTo' => 'en', 'originalSlug' => 'content-tools', 'translatedSlug' => 'wp-content-tools'];

$options->applyRuntimeConfig(['urlSlugs' => $runtimeUrlSlugRows]);

$expectedMappings = [
    'en' => [
        'ueber-uns' => 'about-us',
        'aerzte' => '%C3%A4rzte',
        'literal-percent' => 'foo%252Fbar',
        'wp-json-guide' => 'api-guide',
        'content-tools' => 'wp-content-tools',
    ],
    'fr' => [
        'ueber-uns' => 'a-propos',
    ],
];
slugOptionsAssert($expectedMappings, $options->getUrlSlugMappings(), 'Runtime URL slugs must be sanitized, target-scoped, collision-safe, and canonically encoded.');
slugOptionsAssert(
    $expectedMappings,
    get_option(Options::URL_SLUG_MAPPINGS_OPTION_KEY, []),
    'Runtime URL slugs must be stored in their dedicated option.'
);
slugOptionsAssert(
    false,
    array_key_exists('url_slug_mappings', get_option(Options::OPTION_KEY, [])),
    'Runtime URL slugs must not be persisted inside the main settings option.'
);
slugOptionsAssert(
    false,
    $GLOBALS['_deepglot_slug_autoload'][Options::URL_SLUG_MAPPINGS_OPTION_KEY] ?? null,
    'The dedicated URL slug mappings option must be added with autoload disabled.'
);

$persistedDefenseMappings = $expectedMappings;
foreach ($reservedInfrastructureSegments as $index => $reservedSegment) {
    $persistedDefenseMappings['en']['persisted-target-' . $index] = $reservedSegment;
    $persistedDefenseMappings['en'][$reservedSegment] = 'persisted-source-' . $index;
}
update_option(Options::URL_SLUG_MAPPINGS_OPTION_KEY, $persistedDefenseMappings);
slugOptionsAssert(
    $expectedMappings,
    $options->getUrlSlugMappings(),
    'Persisted runtime maps must defensively discard reserved WordPress infrastructure originals and targets.'
);

$persistedShadowMappings = $expectedMappings;
$persistedShadowMappings['en']['foo'] = 'wp-json';
$persistedShadowMappings['en']['bar'] = 'foo';
update_option(Options::URL_SLUG_MAPPINGS_OPTION_KEY, $persistedShadowMappings);
slugOptionsAssert(
    $expectedMappings,
    $options->getUrlSlugMappings(),
    'A persisted row with a rejected target must still reserve its real source slug against shadowing.'
);

$options->applyRuntimeConfig(['urlSlugs' => [
    ['langTo' => 'en', 'originalSlug' => 'foo', 'translatedSlug' => 'wp-json'],
    ['langTo' => 'en', 'originalSlug' => 'bar', 'translatedSlug' => 'foo'],
    ['langTo' => 'en', 'originalSlug' => 'safe-page', 'translatedSlug' => 'safe-target'],
]]);
slugOptionsAssert(
    ['en' => ['safe-page' => 'safe-target']],
    $options->getUrlSlugMappings(),
    'Runtime rows with rejected targets must still reserve valid originals against shadowing.'
);

update_option(Options::URL_SLUG_MAPPINGS_OPTION_KEY, $expectedMappings);

$options->applyRuntimeConfig([
    'exclusions' => ['urls' => ['/private'], 'regexes' => [], 'selectors' => []],
]);
slugOptionsAssert($expectedMappings, $options->getUrlSlugMappings(), 'A partial runtime payload without urlSlugs must preserve the existing cache.');

$sameSourceInput = array_merge(slugOptionsSettings(), ['enabled' => true]);
unset($sameSourceInput['url_slug_mappings']);
$sameSourceSave = $options->sanitize($sameSourceInput);
slugOptionsAssert(false, array_key_exists('url_slug_mappings', $sameSourceSave), 'A normal settings save must keep runtime-only slug mappings out of the settings payload.');
slugOptionsAssert($expectedMappings, $options->getUrlSlugMappings(), 'A normal settings save for the same key and backend must preserve the dedicated runtime-only slug cache.');

$newKeyInput = array_merge(slugOptionsSettings(), ['api_key' => 'dg_live_project_b']);
$newKeyInput['url_slug_mappings'] = $expectedMappings;
$newKeySave = $options->sanitize($newKeyInput);
slugOptionsAssert(false, array_key_exists('url_slug_mappings', $newKeySave), 'Changing the API key must keep mappings out of the settings payload.');
slugOptionsAssert($expectedMappings, $options->getUrlSlugMappings(), 'Sanitizing an unsaved candidate API key must not clear the active project slug cache.');

$options->applyRuntimeConfig([
    'urlSlugs' => [
        ['langTo' => 'en', 'originalSlug' => 'leistung', 'translatedSlug' => 'service'],
    ],
]);
slugOptionsAssert(['en' => ['leistung' => 'service']], $options->getUrlSlugMappings(), 'The dedicated slug cache can be repopulated after a project change.');

$newBackendInput = array_merge(slugOptionsSettings(), ['api_base_url' => 'https://staging.deepglot.test/api']);
unset($newBackendInput['url_slug_mappings']);
$newBackendSave = $options->sanitize($newBackendInput);
slugOptionsAssert(false, array_key_exists('url_slug_mappings', $newBackendSave), 'Changing the API backend must keep mappings out of the settings payload.');
slugOptionsAssert(['en' => ['leistung' => 'service']], $options->getUrlSlugMappings(), 'Sanitizing an unsaved candidate backend must not clear the active project slug cache.');

$oversizedRows = [];
for ($index = 0; $index < 6000; $index++) {
    $oversizedRows[] = [
        'langTo' => 'en',
        'originalSlug' => 'source-' . $index . '-' . str_repeat('a', 175),
        'translatedSlug' => 'target-' . $index . '-' . str_repeat('b', 175),
    ];
}
$options->applyRuntimeConfig(['urlSlugs' => $oversizedRows]);
$boundedMappings = get_option(Options::URL_SLUG_MAPPINGS_OPTION_KEY, []);
slugOptionsAssert(true, is_array($boundedMappings) && $boundedMappings !== [], 'A valid oversized runtime map must retain a safe non-empty subset instead of clearing every mapping.');
slugOptionsAssert(true, strlen(serialize($boundedMappings)) <= Options::URL_SLUG_MAPPINGS_MAX_BYTES, 'The retained runtime map subset must respect the serialized byte cap.');
slugOptionsAssert(true, count($boundedMappings['en'] ?? []) < count($oversizedRows), 'The byte bound must omit only the tail that no longer fits.');

unset(
    $GLOBALS['_deepglot_slug_options'][Options::URL_SLUG_MAPPINGS_OPTION_KEY],
    $GLOBALS['_deepglot_slug_autoload'][Options::URL_SLUG_MAPPINGS_OPTION_KEY]
);
update_option(Options::OPTION_KEY, slugOptionsSettings([
    'url_slug_mappings' => [
        'en' => ['legacy' => 'legacy-translated'],
    ],
]));
slugOptionsAssert(
    ['en' => ['legacy' => 'legacy-translated']],
    $options->getUrlSlugMappings(),
    'Legacy caches already stored in deepglot_settings must remain readable during upgrade.'
);

$options->applyRuntimeConfig(['urlSlugs' => []]);
slugOptionsAssert([], $options->getUrlSlugMappings(), 'An explicit empty SaaS urlSlugs list must clear stale cached mappings.');
slugOptionsAssert(false, array_key_exists('url_slug_mappings', get_option(Options::OPTION_KEY, [])), 'Refreshing runtime slugs must remove legacy caches from deepglot_settings.');

fwrite(STDOUT, "UrlSlugOptionsTest: OK\n");
