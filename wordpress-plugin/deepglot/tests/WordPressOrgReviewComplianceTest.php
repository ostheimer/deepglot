<?php

/**
 * Regression contract for the WordPress.org pre-review received 2026-08-08.
 *
 * The distributed plugin must not expose arbitrary CSS input and must use
 * WordPress enqueue APIs instead of printing executable <style>/<script>
 * blocks from PHP templates or string returns.
 *
 * Run standalone: php tests/WordPressOrgReviewComplianceTest.php
 */

function wporgReviewAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

function wporgReviewSource(string $path): string
{
    $source = file_get_contents($path);
    wporgReviewAssert(is_string($source), 'Unable to read ' . $path);

    return $source;
}

/**
 * Inspect executable/template tokens while ignoring comments and docblocks.
 */
function wporgReviewContainsExecutableTag(string $path, string $tag): bool
{
    foreach (token_get_all(wporgReviewSource($path)) as $token) {
        if (!is_array($token)) {
            continue;
        }

        if (!in_array($token[0], [T_INLINE_HTML, T_CONSTANT_ENCAPSED_STRING], true)) {
            continue;
        }

        if (stripos($token[1], '<' . $tag) !== false) {
            return true;
        }
    }

    return false;
}

$root = dirname(__DIR__);
$settingsPage = $root . '/includes/Admin/SettingsPage.php';
$navMenuMetaBox = $root . '/includes/Admin/NavMenuMetaBox.php';
$languageSwitcher = $root . '/includes/Frontend/LanguageSwitcher.php';
$options = $root . '/includes/Config/Options.php';
$templates = $root . '/includes/Config/SwitcherTemplates.php';

foreach ([$settingsPage, $navMenuMetaBox, $languageSwitcher] as $path) {
    wporgReviewAssert(
        !wporgReviewContainsExecutableTag($path, 'style'),
        basename($path) . ' must not print or return a <style> block'
    );
    wporgReviewAssert(
        !wporgReviewContainsExecutableTag($path, 'script'),
        basename($path) . ' must not print or return a <script> block'
    );
}

$settingsSource = wporgReviewSource($settingsPage);
$navSource = wporgReviewSource($navMenuMetaBox);
$switcherSource = wporgReviewSource($languageSwitcher);

wporgReviewAssert(
    str_contains($settingsSource, 'wp_enqueue_style('),
    'SettingsPage must enqueue its stylesheet with wp_enqueue_style()'
);
wporgReviewAssert(
    str_contains($settingsSource, 'wp_enqueue_script('),
    'SettingsPage must enqueue its JavaScript with wp_enqueue_script()'
);
wporgReviewAssert(
    str_contains($navSource, 'wp_enqueue_script('),
    'NavMenuMetaBox must enqueue its JavaScript with wp_enqueue_script()'
);
wporgReviewAssert(
    str_contains($switcherSource, 'wp_add_inline_style('),
    'LanguageSwitcher must attach generated responsive/flag CSS with wp_add_inline_style()'
);

foreach ([$settingsPage, $languageSwitcher, $options, $templates] as $path) {
    $source = wporgReviewSource($path);
    wporgReviewAssert(
        !str_contains($source, 'switcher_custom_css') && !str_contains($source, "'custom_css'"),
        basename($path) . ' must not expose or consume arbitrary custom CSS settings'
    );
}

wporgReviewAssert(
    is_file($root . '/assets/css/admin-settings.css'),
    'Static admin styles must live in assets/css/admin-settings.css'
);
wporgReviewAssert(
    is_file($root . '/assets/js/nav-menu-metabox.js'),
    'Nav menu behavior must live in assets/js/nav-menu-metabox.js'
);

fwrite(STDOUT, "WordPressOrgReviewComplianceTest: OK\n");
