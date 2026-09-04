<?php

/**
 * Regression for PR #323: SiteRouting and every service that shares the
 * request-scoped resolver must observe a language change applied by the early
 * authenticated runtime refresh. Keeping the resolver snapshot from plugin
 * construction can route/cache the first request with stale languages.
 */

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}

if (!function_exists('wp_parse_url')) {
    function wp_parse_url($url, $component = -1) {
        return parse_url($url, $component);
    }
}

require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';

use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function runtimeLanguageRefreshAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

$resolver = new UrlLanguageResolver('de', ['en']);
$routing = new SiteRouting($resolver, 'https://example.test', 'PATH_PREFIX', []);

runtimeLanguageRefreshAssert(
    method_exists($resolver, 'replaceLanguages'),
    'The shared resolver must support replacing its source and target language snapshot after runtime refresh.'
);

$resolver->replaceLanguages('en', ['fr']);

runtimeLanguageRefreshAssert(
    $routing->getSourceLanguage() === 'en'
        && $routing->getTargetLanguages() === ['fr']
        && $routing->detectLanguage('/fr/article/') === 'fr'
        && $routing->detectLanguage('/en/article/') === null,
    'Existing SiteRouting instances must immediately use the refreshed language configuration.'
);

$pluginSource = file_get_contents(__DIR__ . '/../includes/Plugin.php');
runtimeLanguageRefreshAssert(
    strpos($pluginSource, '->replaceLanguages(') !== false,
    'Plugin::refreshRuntimeRouting() must update the shared resolver after applying runtime settings.'
);

fwrite(STDOUT, "RuntimeLanguageRefreshTest: OK\n");
