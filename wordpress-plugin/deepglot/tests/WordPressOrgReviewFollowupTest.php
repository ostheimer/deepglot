<?php

/**
 * Regression coverage for the manual WordPress.org review from 2026-08-14.
 *
 * The production output pipeline must use WordPress' standardized template
 * enhancement buffer where available. Its pre-6.9 fallback must own and close
 * every buffer it opens. Third-party globals must not look like unprefixed
 * globals owned by Deepglot to the directory prefix scanner.
 */

function wporgFollowupAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

$pluginRoot = realpath(__DIR__ . '/..');
wporgFollowupAssert(is_string($pluginRoot), 'Plugin root must be readable');

$outputBuffer = file_get_contents($pluginRoot . '/includes/Frontend/OutputBuffer.php');
$requestRouter = file_get_contents($pluginRoot . '/includes/Frontend/RequestRouter.php');
$translationCache = file_get_contents($pluginRoot . '/includes/Support/TranslationCache.php');
$legacyRendererPath = $pluginRoot . '/includes/Frontend/LegacyTemplateRenderer.php';

wporgFollowupAssert(is_string($outputBuffer), 'OutputBuffer.php must be readable');
wporgFollowupAssert(is_string($requestRouter), 'RequestRouter.php must be readable');
wporgFollowupAssert(is_string($translationCache), 'TranslationCache.php must be readable');
wporgFollowupAssert(
    !str_contains($outputBuffer, 'ob_start('),
    'OutputBuffer must not leave a custom response buffer open until shutdown'
);
wporgFollowupAssert(
    str_contains($outputBuffer, "add_filter('wp_template_enhancement_output_buffer'")
        && str_contains($outputBuffer, "add_filter('template_include'"),
    'OutputBuffer must use the WordPress 6.9 buffer with a legacy template fallback'
);
wporgFollowupAssert(
    is_file($legacyRendererPath),
    'The legacy output-buffer fallback must be isolated in a dedicated renderer'
);

$legacyRenderer = is_file($legacyRendererPath)
    ? file_get_contents($legacyRendererPath)
    : false;
wporgFollowupAssert(is_string($legacyRenderer), 'LegacyTemplateRenderer.php must be readable');
wporgFollowupAssert(
    substr_count($legacyRenderer, 'ob_start(') === 1
        && substr_count($legacyRenderer, 'ob_get_clean(') === 1,
    'The legacy renderer must pair its single ob_start() with ob_get_clean()'
);
wporgFollowupAssert(
    str_contains($legacyRenderer, 'finally')
        && str_contains($legacyRenderer, 'ob_get_level()'),
    'The legacy renderer must restore its buffer level even when template rendering fails'
);
wporgFollowupAssert(
    !str_contains($requestRouter, 'global $wpseo_front;')
        && str_contains($requestRouter, "\$GLOBALS['wpseo_front']"),
    'Yoast compatibility must read its third-party global without declaring an unprefixed plugin global'
);
wporgFollowupAssert(
    str_contains($translationCache, "private const PREFIX = 'deepglot_cache_';")
        && !str_contains($translationCache, "private const PREFIX = 'dg_';"),
    'Translation transients must use a unique prefix with at least four characters'
);

fwrite(STDOUT, "WordPressOrgReviewFollowupTest: OK\n");
