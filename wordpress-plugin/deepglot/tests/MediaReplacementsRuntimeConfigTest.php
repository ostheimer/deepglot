<?php

declare(strict_types=1);

/**
 * End-to-end contract for project-bound, non-autoloaded image mappings.
 */

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_media_runtime_options'] = [];
    $GLOBALS['_deepglot_media_runtime_autoload'] = [];
    $GLOBALS['_deepglot_media_runtime_deleted_transients'] = [];

    function get_option($key, $default = false)
    {
        return $GLOBALS['_deepglot_media_runtime_options'][$key] ?? $default;
    }

    function add_option($key, $value, $deprecated = '', $autoload = true): bool
    {
        if (array_key_exists($key, $GLOBALS['_deepglot_media_runtime_options'])) {
            return false;
        }

        $GLOBALS['_deepglot_media_runtime_options'][$key] = $value;
        $GLOBALS['_deepglot_media_runtime_autoload'][$key] = (bool) $autoload;

        return true;
    }

    function update_option($key, $value): bool
    {
        $GLOBALS['_deepglot_media_runtime_options'][$key] = $value;

        if (!array_key_exists($key, $GLOBALS['_deepglot_media_runtime_autoload'])) {
            $GLOBALS['_deepglot_media_runtime_autoload'][$key] = true;
        }

        return true;
    }

    function wp_cache_delete($key, $group = ''): bool
    {
        return true;
    }

    function delete_transient($key): bool
    {
        $GLOBALS['_deepglot_media_runtime_deleted_transients'][] = $key;

        return true;
    }

    function wp_parse_args($args, $defaults = []): array
    {
        return array_merge($defaults, is_array($args) ? $args : []);
    }

    function sanitize_text_field($value): string
    {
        return trim((string) $value);
    }

    function sanitize_textarea_field($value): string
    {
        return trim((string) $value);
    }

    function esc_url_raw($value): string
    {
        return (string) $value;
    }

    function untrailingslashit($value): string
    {
        return rtrim((string) $value, '/');
    }

    function get_site_url(): string
    {
        return 'https://example.com';
    }

    function is_wp_error($value): bool
    {
        return false;
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Sync/SettingsSync.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Sync\SettingsSync;

final class MediaRuntimeSettingsSync extends SettingsSync
{
    public function sync(?array $settings = null, ?string $apiKeyOverride = null, ?string $baseUrlOverride = null)
    {
        return ['ok' => true];
    }
}

function assertMediaRuntime($expected, $actual, string $message): void
{
    if ($expected === $actual) {
        return;
    }

    fwrite(STDERR, "FAIL: {$message}\n");
    fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
    fwrite(STDERR, 'Actual:   ' . var_export($actual, true) . PHP_EOL);
    exit(1);
}

function mediaRuntimeSettings(array $overrides = []): array
{
    return array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => 'dg_media_project_a',
        'api_base_url' => 'https://deepglot.ai/api',
        'source_language' => 'de',
        'target_languages' => ['en', 'fr'],
        'switcher_instances' => [['id' => 'default']],
    ], $overrides);
}

$options = new Options();

assertMediaRuntime(
    false,
    array_key_exists('media_replacements', Options::defaults()),
    'Image mappings must not be part of autoloaded main settings defaults.'
);
update_option(Options::OPTION_KEY, mediaRuntimeSettings());

$runtimeMappings = [
    'en' => [
        '/wp-content/uploads/relative.png' => '/wp-content/uploads/relative-en.webp',
        'https://example.com/wp-content/uploads/absolute.jpg?size=400' => 'https://example.com/wp-content/uploads/absolute-en.avif?size=400',
        '/wp-content/uploads/mixed.gif' => 'https://example.com/wp-content/uploads/mixed-en.jpeg',
        'https://EXAMPLE.COM/wp-content/uploads/uppercase.PNG' => '/wp-content/uploads/uppercase-en.JPG',
        'javascript:alert(1)' => '/wp-content/uploads/javascript-en.png',
        '//example.com/wp-content/uploads/protocol-relative.png' => '/wp-content/uploads/protocol-relative-en.png',
        '/wp-content/uploads/data-destination.png' => 'data:image/png;base64,unsafe',
        'https://user@example.com/wp-content/uploads/userinfo-original.png' => '/wp-content/uploads/userinfo-original-en.png',
        '/wp-content/uploads/userinfo-destination.png' => 'https://user@example.com/wp-content/uploads/userinfo-destination-en.png',
        '/wp-content/uploads/fragment-original.png#view' => '/wp-content/uploads/fragment-original-en.png',
        '/wp-content/uploads/fragment-destination.png' => '/wp-content/uploads/fragment-destination-en.png#view',
        '/wp-content/uploads/%2e%2e/private.png' => '/wp-content/uploads/traversal-original-en.png',
        '/wp-content/uploads/traversal-destination.png' => '/wp-content/uploads/%2e%2e/private.png',
        '/wp-content/uploads/double-encoded.png' => '/wp-content/uploads/%252e%252e/private.png',
        '/wp-content/uploads/encoded-slash.png' => '/wp-content/uploads/private%2fasset.png',
        '/wp-content/uploads/encoded-control.png' => '/wp-content/uploads/private%0aasset.png',
        '/wp-content/uploads/malformed-percent.png' => '/wp-content/uploads/private%GGasset.png',
        '/wp-content/uploads/original.svg' => '/wp-content/uploads/original-en.png',
        '/wp-content/uploads/svg-destination.png' => '/wp-content/uploads/svg-destination-en.svg',
        '/wp-content/uploads/document.pdf' => '/wp-content/uploads/document-en.png',
        '/wp-content/uploads/video.mp4' => '/wp-content/uploads/video-en.png',
        'https://outside.example/wp-content/uploads/foreign-original.png' => '/wp-content/uploads/foreign-original-en.png',
        '/wp-content/uploads/foreign-destination.png' => 'https://outside.example/wp-content/uploads/foreign-destination-en.png',
        '/wp-content/uploads/foreign-port.png' => 'https://example.com:8443/wp-content/uploads/foreign-port-en.png',
        '/wp-content/uploads/insecure-destination.png' => 'http://example.com/wp-content/uploads/insecure-destination-en.png',
        '/wp-content/uploads/non-string.png' => ['invalid'],
    ],
    'fr' => [
        '/wp-content/uploads/relative.png' => '/wp-content/uploads/relative-fr.png',
    ],
    'it' => [
        '/wp-content/uploads/relative.png' => '/wp-content/uploads/relative-it.png',
    ],
    'de' => [
        '/wp-content/uploads/relative.png' => '/wp-content/uploads/relative-de.png',
    ],
];

assertMediaRuntime(true, $options->applyRuntimeConfig(['mediaReplacements' => $runtimeMappings]), 'Authenticated runtime image mappings are applied.');

$english = [
    '/wp-content/uploads/relative.png' => '/wp-content/uploads/relative-en.webp',
    '/wp-content/uploads/absolute.jpg?size=400' => '/wp-content/uploads/absolute-en.avif?size=400',
    '/wp-content/uploads/mixed.gif' => '/wp-content/uploads/mixed-en.jpeg',
    '/wp-content/uploads/uppercase.PNG' => '/wp-content/uploads/uppercase-en.JPG',
];
$french = ['/wp-content/uploads/relative.png' => '/wp-content/uploads/relative-fr.png'];

assertMediaRuntime($english, $options->getMediaReplacements('en'), 'Only safe same-origin image mappings survive and canonicalize to exact relative paths plus query.');
assertMediaRuntime($french, $options->getMediaReplacements('fr'), 'French image mappings stay isolated from English mappings.');
assertMediaRuntime([], $options->getMediaReplacements('it'), 'Inactive languages cannot expose persisted image mappings.');
assertMediaRuntime([], $options->getMediaReplacements('de'), 'Source-language image mappings are excluded.');
assertMediaRuntime(['en' => $english, 'fr' => $french], get_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, []), 'Normalized image mappings persist only in the dedicated runtime option.');
assertMediaRuntime(false, $GLOBALS['_deepglot_media_runtime_autoload'][Options::MEDIA_REPLACEMENTS_OPTION_KEY] ?? null, 'The dedicated image mapping option is created with autoload disabled.');
assertMediaRuntime(false, array_key_exists('media_replacements', get_option(Options::OPTION_KEY, [])), 'Runtime image mappings never enter the autoloaded main settings option.');

$options->applyRuntimeConfig(['pageViewsEnabled' => false]);
assertMediaRuntime($english, $options->getMediaReplacements('en'), 'A partial runtime payload without image mappings preserves the existing mappings.');

$options->applyRuntimeConfig(['mediaReplacements' => [
    'en' => [
        '/wp-content/uploads/collision.png' => '/wp-content/uploads/first.png',
        'https://example.com/wp-content/uploads/collision.png' => '/wp-content/uploads/second.png',
        '/wp-content/uploads/unambiguous.png' => '/wp-content/uploads/unambiguous-en.png',
    ],
]]);
assertMediaRuntime(
    ['/wp-content/uploads/unambiguous.png' => '/wp-content/uploads/unambiguous-en.png'],
    $options->getMediaReplacements('en'),
    'Conflicting absolute-versus-relative mappings fail closed without hiding unrelated safe images.'
);

$exactMaximum = [];
for ($index = 0; $index < Options::MEDIA_REPLACEMENTS_MAX; $index++) {
    $exactMaximum['/wp-content/uploads/original-' . $index . '.png'] = '/wp-content/uploads/localized-' . $index . '.webp';
}

$options->applyRuntimeConfig(['mediaReplacements' => ['en' => $exactMaximum]]);
assertMediaRuntime(Options::MEDIA_REPLACEMENTS_MAX, count($options->getMediaReplacements('en')), 'Exactly 500 valid image mappings remain available.');
assertMediaRuntime($exactMaximum, $options->getMediaReplacements('en'), 'The complete exact-limit image mapping set is preserved without truncation.');

$nearJsonMaximum = [];
for ($index = 0; $index < Options::MEDIA_REPLACEMENTS_MAX; $index++) {
    $suffix = str_pad((string) $index, 3, '0', STR_PAD_LEFT);
    $nearJsonMaximum['/wp-content/uploads/' . str_repeat('a', 198) . $suffix . '.png']
        = '/wp-content/uploads/' . str_repeat('b', 198) . $suffix . '.webp';
}
$nearJsonMaximumPayload = ['en' => $nearJsonMaximum];
$nearJsonMaximumBytes = strlen((string) json_encode($nearJsonMaximumPayload, JSON_UNESCAPED_SLASHES));
assertMediaRuntime(true, $nearJsonMaximumBytes > 224 * 1024 - 2048 && $nearJsonMaximumBytes <= 224 * 1024, 'The 500-row fixture approaches the 224 KiB SaaS JSON cap without exceeding it.');
assertMediaRuntime(true, strlen(serialize($nearJsonMaximumPayload)) <= Options::MEDIA_REPLACEMENTS_MAX_BYTES, 'PHP serialization overhead for an accepted near-limit SaaS payload fits the 256 KiB WordPress option cap.');
$options->applyRuntimeConfig(['mediaReplacements' => $nearJsonMaximumPayload]);
assertMediaRuntime($nearJsonMaximum, $options->getMediaReplacements('en'), 'All 500 near-224-KiB SaaS mappings survive PHP serialization without being silently cleared.');

$overMaximum = $exactMaximum;
$overMaximum['/wp-content/uploads/over-limit.png'] = '/wp-content/uploads/over-limit-en.png';
$options->applyRuntimeConfig(['mediaReplacements' => ['en' => $overMaximum]]);
assertMediaRuntime([], $options->getMediaReplacements('en'), 'More than 500 runtime image mappings fail closed.');
assertMediaRuntime([], get_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, null), 'Over-limit image payloads clear the dedicated option rather than storing an unsafe subset.');

update_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, ['en' => $overMaximum]);
assertMediaRuntime([], $options->getMediaReplacements('en'), 'More than 500 previously persisted image mappings also fail closed.');

$oversized = [
    'en' => [
        '/wp-content/uploads/oversized.png' => '/wp-content/uploads/' . str_repeat('a', Options::MEDIA_REPLACEMENTS_MAX_BYTES + 1) . '.png',
    ],
];
assertMediaRuntime(true, strlen(serialize($oversized)) > Options::MEDIA_REPLACEMENTS_MAX_BYTES, 'The oversized fixture exceeds the serialized image option budget.');
$options->applyRuntimeConfig(['mediaReplacements' => $oversized]);
assertMediaRuntime([], $options->getMediaReplacements('en'), 'An oversized serialized runtime payload fails closed.');
assertMediaRuntime([], get_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, null), 'An oversized runtime payload cannot remain in the dedicated option.');

update_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, $oversized);
assertMediaRuntime([], $options->getMediaReplacements('en'), 'An oversized persisted runtime option fails closed during reads.');

$options->applyRuntimeConfig(['mediaReplacements' => ['en' => $english, 'fr' => $french]]);
$beforeStalePayload = get_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, []);

assertMediaRuntime(
    false,
    $options->applyRuntimeConfig(
        ['mediaReplacements' => ['en' => ['/wp-content/uploads/foreign-project.png' => '/wp-content/uploads/foreign-project-en.png']]],
        'dg_media_old_project',
        'https://deepglot.ai/api'
    ),
    'A runtime payload fetched with a stale API key is rejected.'
);
assertMediaRuntime($beforeStalePayload, get_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, []), 'A stale API key cannot replace the active project image mappings.');

assertMediaRuntime(
    false,
    $options->applyRuntimeConfig(
        ['mediaReplacements' => ['en' => ['/wp-content/uploads/foreign-backend.png' => '/wp-content/uploads/foreign-backend-en.png']]],
        'dg_media_project_a',
        'https://staging.deepglot.test/api'
    ),
    'A runtime payload fetched from another API backend is rejected.'
);
assertMediaRuntime($beforeStalePayload, get_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, []), 'A stale backend cannot replace the active project image mappings.');

$options->applyRuntimeConfig(['mediaReplacements' => []]);
assertMediaRuntime([], $options->getMediaReplacements('en'), 'An explicitly empty image mapping payload clears English mappings.');
assertMediaRuntime([], $options->getMediaReplacements('fr'), 'An explicitly empty image mapping payload clears French mappings.');
assertMediaRuntime([], get_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, null), 'An explicitly empty payload clears the dedicated image option.');

$options->applyRuntimeConfig(['mediaReplacements' => ['en' => $english]]);
$settingsSync = new MediaRuntimeSettingsSync($options, new Client($options));
$oldSettings = mediaRuntimeSettings();
$settingsSync->handleOptionUpdate($oldSettings, mediaRuntimeSettings(['api_key' => 'dg_media_project_b']));
assertMediaRuntime([], $options->getMediaReplacements('en'), 'SettingsSync clears image mappings immediately when the stored project API key changes.');
assertMediaRuntime(
    true,
    in_array(Client::INVALID_API_KEY_TRANSIENT, $GLOBALS['_deepglot_media_runtime_deleted_transients'], true),
    'Credential changes preserve the existing invalid-key transient reset.'
);

$options->applyRuntimeConfig(['mediaReplacements' => ['en' => $english]]);
$settingsSync->handleOptionUpdate($oldSettings, mediaRuntimeSettings(['api_base_url' => 'https://staging.deepglot.test/api']));
assertMediaRuntime([], $options->getMediaReplacements('en'), 'SettingsSync clears image mappings immediately when the API backend changes.');

fwrite(STDOUT, "MediaReplacementsRuntimeConfigTest: OK\n");
