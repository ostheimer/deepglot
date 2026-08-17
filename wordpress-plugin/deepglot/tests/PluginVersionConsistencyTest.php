<?php

/**
 * Keep the distributable plugin header, runtime asset version, and release
 * metadata in lockstep. A mismatch can leave WordPress serving stale assets
 * or make the WordPress.org package metadata misleading.
 */

function versionAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

$plugin = file_get_contents(__DIR__ . '/../deepglot.php');
$readme = file_get_contents(__DIR__ . '/../README.md');
$wordpressReadme = file_get_contents(__DIR__ . '/../readme.txt');
$dynamicTranslator = file_get_contents(__DIR__ . '/../assets/js/dynamic-translator.js');
$license = file_get_contents(__DIR__ . '/../LICENSE');
$rootReadme = file_get_contents(__DIR__ . '/../../../README.md');

versionAssert(is_string($plugin), 'Plugin bootstrap must be readable');
versionAssert(is_string($readme), 'Plugin README must be readable');
versionAssert(is_string($wordpressReadme), 'WordPress.org readme must be readable');
versionAssert(is_string($dynamicTranslator), 'Dynamic translator asset must be readable');
versionAssert(is_string($license), 'Plugin license must be readable');
versionAssert(is_string($rootReadme), 'Repository README must be readable');
versionAssert(
    preg_match('/^ \* Version:\s*([^\s]+)$/m', $plugin, $headerMatch) === 1,
    'Plugin header version is missing'
);
versionAssert(
    preg_match("/define\('DEEPGLOT_PLUGIN_VERSION',\s*'([^']+)'\)/", $plugin, $constantMatch) === 1,
    'Runtime plugin version constant is missing'
);

$headerVersion = $headerMatch[1] ?? '';
$constantVersion = $constantMatch[1] ?? '';

versionAssert($headerVersion === '0.12.4', 'Prepared WordPress.org release must be version 0.12.4');
versionAssert(
    !str_contains($dynamicTranslator, 'var rateLimitedUntil = 0;')
        || version_compare($headerVersion, '0.12.1', '>='),
    'Behavior-changing dynamic-translator.js Retry-After logic must ship under version 0.12.1 or newer'
);
versionAssert($headerVersion === $constantVersion, 'Header and runtime versions must match');
versionAssert(
    str_contains($readme, '(**v' . $headerVersion . '**)'),
    'README version must match the plugin bootstrap'
);
versionAssert(
    !str_contains($readme, 'It is a release candidate'),
    'Stable plugin README must not describe the package as a release candidate'
);
versionAssert(
    str_contains($readme, 'does not automatically install or update the plugin on customer sites'),
    'Plugin README must state the customer-installation boundary'
);
versionAssert(
    preg_match('/^Stable tag:\s*([^\s]+)$/m', $wordpressReadme, $stableTagMatch) === 1,
    'WordPress.org stable tag is missing'
);
versionAssert(
    ($stableTagMatch[1] ?? '') === $headerVersion,
    'WordPress.org stable tag must match the plugin bootstrap'
);
versionAssert(
    str_contains($rootReadme, 'Repository version: **v' . $headerVersion . '**'),
    'Repository README version must match the plugin bootstrap'
);
versionAssert(
    !str_contains($rootReadme, 'release candidate')
        && str_contains($rootReadme, 'Publishing the GitHub release does not automatically update customer WordPress sites.'),
    'Repository README must describe the stable release and customer-update boundary'
);
versionAssert(
    str_contains(
        $rootReadme,
        'The currently documented live deployment on `meinhaushalt.at` is **v0.12.1** from commit `3b914007`, deployed on 2026-08-10'
    ),
    'Repository README must reflect the live-verified meinhaushalt.at deployment from HANDOFF.md'
);
versionAssert(
    !str_contains($rootReadme, 'The currently documented live deployment on `meinhaushalt.at` remains **v0.10.4**'),
    'Repository README must not retain the superseded meinhaushalt.at v0.10.4 live state'
);

versionAssert(
    preg_match('/^ \* Requires at least:\s*([^\s]+)$/m', $plugin, $requiresWordPressMatch) === 1,
    'Plugin WordPress requirement is missing'
);
versionAssert(
    preg_match('/^Requires at least:\s*([^\s]+)$/m', $wordpressReadme, $readmeRequiresWordPressMatch) === 1,
    'WordPress.org WordPress requirement is missing'
);
versionAssert(
    ($requiresWordPressMatch[1] ?? '') === ($readmeRequiresWordPressMatch[1] ?? ''),
    'WordPress requirements must match'
);

versionAssert(
    preg_match('/^ \* Requires PHP:\s*([^\s]+)$/m', $plugin, $requiresPhpMatch) === 1,
    'Plugin PHP requirement is missing'
);
versionAssert(
    preg_match('/^Requires PHP:\s*([^\s]+)$/m', $wordpressReadme, $readmeRequiresPhpMatch) === 1,
    'WordPress.org PHP requirement is missing'
);
$requiresPhp = $requiresPhpMatch[1] ?? '';
versionAssert(
    $requiresPhp === ($readmeRequiresPhpMatch[1] ?? ''),
    'PHP requirements must match'
);
versionAssert(
    version_compare($requiresPhp, '8.0', '>='),
    'Requires PHP must cover runtime use of PHP 8 string helpers'
);

versionAssert(
    preg_match('/^Tested up to:\s*7\.0$/m', $wordpressReadme) === 1,
    'WordPress.org tested version must be 7.0'
);
versionAssert(
    preg_match('/^ \* License:\s*GPLv2 or later$/m', $plugin) === 1,
    'Plugin GPL license declaration is missing'
);
versionAssert(
    preg_match('#^ \* License URI:\s*https://www\.gnu\.org/licenses/gpl-2\.0\.html$#m', $plugin) === 1,
    'Plugin GPL license URI is missing'
);
versionAssert(
    preg_match('/^License:\s*GPLv2 or later$/m', $wordpressReadme) === 1,
    'WordPress.org GPL license declaration is missing'
);
versionAssert(
    preg_match('#^License URI:\s*https://www\.gnu\.org/licenses/gpl-2\.0\.html$#m', $wordpressReadme) === 1,
    'WordPress.org GPL license URI is missing'
);
versionAssert(
    strlen($license) > 15000
        && str_contains($license, 'GNU GENERAL PUBLIC LICENSE')
        && str_contains($license, 'Version 2, June 1991')
        && preg_match('/either version 2 of the License, or\s+\(at your option\) any later version\./', $license) === 1,
    'Plugin LICENSE must contain the complete GPL-2.0-or-later license text'
);
versionAssert(
    str_contains($readme, "├── LICENSE"),
    'Plugin README structure must include the packaged LICENSE'
);
versionAssert(
    str_contains($wordpressReadme, '== External services ==')
        && str_contains($wordpressReadme, 'https://deepglot.ai/api/')
        && str_contains($wordpressReadme, 'Settings synchronization sends the configured API key, site URL, routing mode, source and target languages, domain mappings, and the feature flags for automatic redirect, email translation, search translation, AMP translation, and dynamic translation.')
        && str_contains($wordpressReadme, 'Runtime refresh sends the configured API key and receives URL and selector exclusions, regular-expression exclusions, and translated URL-slug mappings.')
        && str_contains($wordpressReadme, 'The plugin can also request the public supported-languages list without an API key.')
        && str_contains($wordpressReadme, 'Starting the Visual Editor verifies its token through the project-scoped `editor-sessions/verify` endpoint. Saving a manual translation sends the token, original and translated text, source and target language codes, and the request URL to the project-scoped `manual-translations` endpoint.')
        && str_contains($wordpressReadme, 'https://deepglot.ai/privacy')
        && str_contains($wordpressReadme, 'https://deepglot.ai/terms'),
    'WordPress.org readme must disclose the Deepglot API service and policies'
);
versionAssert(
    str_contains($wordpressReadme, 'https://github.com/ostheimer/deepglot'),
    'WordPress.org readme must link the public development source and release tooling'
);
versionAssert(
    str_contains($wordpressReadme, '= ' . $headerVersion . ' ='),
    'WordPress.org changelog must contain the release version'
);
versionAssert(
    str_contains($wordpressReadme, 'Deepglot admin branding'),
    'WordPress.org changelog must document the branded admin experience'
);

fwrite(STDOUT, "PluginVersionConsistencyTest: OK\n");
