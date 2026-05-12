<?php

/**
 * Reproduces the gap surfaced on 2026-05-12: the Deepglot WordPress plugin
 * shipped a language switcher renderer but the admin had no controls for
 * its appearance. This test pins the new switcher_* options in Options
 * defaults / sanitize / runtime-config flow so the SaaS Switcher panel can
 * mirror a real plugin state instead of read-only placeholders.
 *
 * Run standalone: php tests/SwitcherSettingsTest.php
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }
}

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_options'] = [];

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_options'][$key] ?? $default;
    }

    function update_option($key, $value) {
        $GLOBALS['_deepglot_options'][$key] = $value;
        return true;
    }

    function get_transient($key) {
        return false;
    }

    function set_transient($key, $value, $ttl = 0) {
        return true;
    }

    function is_wp_error($value) {
        return false;
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

    if (!defined('DAY_IN_SECONDS')) {
        define('DAY_IN_SECONDS', 86400);
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';

use Deepglot\Config\Options;

function switcherAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

$options = new Options();

// 1. Defaults exposed: every switcher option has a documented default so the
// admin UI never needs to guess and unit tests fail fast on rename.
$defaults = Options::defaults();
switcherAssert(array_key_exists('switcher_auto_inject', $defaults), 'switcher_auto_inject default missing');
switcherAssert(array_key_exists('switcher_default_style', $defaults), 'switcher_default_style default missing');
switcherAssert(array_key_exists('switcher_flag_style', $defaults), 'switcher_flag_style default missing');
switcherAssert(array_key_exists('switcher_show_label', $defaults), 'switcher_show_label default missing');
switcherAssert(array_key_exists('switcher_label_format', $defaults), 'switcher_label_format default missing');
switcherAssert(array_key_exists('switcher_language_order', $defaults), 'switcher_language_order default missing');
switcherAssert(array_key_exists('switcher_custom_css', $defaults), 'switcher_custom_css default missing');

switcherAssert($defaults['switcher_auto_inject'] === false, 'switcher_auto_inject default must be off (opt-in)');
switcherAssert($defaults['switcher_default_style'] === 'list', 'switcher_default_style must default to list');
switcherAssert($defaults['switcher_flag_style'] === 'rectangle_mat', 'switcher_flag_style must default to rectangle_mat');
switcherAssert($defaults['switcher_show_label'] === true, 'switcher_show_label default must be on');
switcherAssert($defaults['switcher_label_format'] === 'full_name', 'switcher_label_format must default to full_name');
switcherAssert($defaults['switcher_language_order'] === [], 'switcher_language_order default must be empty array');
switcherAssert($defaults['switcher_custom_css'] === '', 'switcher_custom_css default must be empty string');

// 2. Sanitization clamps every option to safe values so a malformed admin
// form submission cannot poison the runtime renderer.
$sanitized = $options->sanitize([
    'enabled' => '1',
    'switcher_auto_inject' => '1',
    'switcher_default_style' => 'invalid-style',
    'switcher_flag_style' => 'rectangle_mat',
    'switcher_show_label' => '1',
    'switcher_label_format' => 'unknown_format',
    'switcher_language_order' => "en\ndE\n  fr  \n!!\nde",
    'switcher_custom_css' => "  .deepglot-switcher{color:red;}  ",
]);

switcherAssert($sanitized['switcher_auto_inject'] === true, 'switcher_auto_inject must coerce truthy strings to bool');
switcherAssert($sanitized['switcher_default_style'] === 'list', 'invalid switcher_default_style must fall back to list');
switcherAssert($sanitized['switcher_flag_style'] === 'rectangle_mat', 'valid flag style passes through');
switcherAssert($sanitized['switcher_label_format'] === 'full_name', 'invalid label format must fall back to full_name');
switcherAssert($sanitized['switcher_language_order'] === ['en', 'de', 'fr'], 'language order must lowercase, dedupe, strip non-ISO entries (got ' . json_encode($sanitized['switcher_language_order']) . ')');
switcherAssert($sanitized['switcher_custom_css'] === '.deepglot-switcher{color:red;}', 'custom CSS must be trimmed');

$sanitizedTwo = $options->sanitize([
    'switcher_default_style' => 'dropdown',
    'switcher_flag_style' => 'circle_glossy',
    'switcher_show_label' => 0,
    'switcher_label_format' => 'iso_code',
    'switcher_language_order' => ['EN', 'de'],
]);
switcherAssert($sanitizedTwo['switcher_default_style'] === 'dropdown', 'dropdown style passes through');
switcherAssert($sanitizedTwo['switcher_flag_style'] === 'circle_glossy', 'circle_glossy flag style passes through');
switcherAssert($sanitizedTwo['switcher_show_label'] === false, 'switcher_show_label coerces 0 to false');
switcherAssert($sanitizedTwo['switcher_label_format'] === 'iso_code', 'iso_code label format passes through');
switcherAssert($sanitizedTwo['switcher_language_order'] === ['en', 'de'], 'array language order is lowercased + deduped');

// 3. Invalid flag styles fall back to the documented default, not to an
// unsafe value the renderer would not recognise.
$badFlag = $options->sanitize(['switcher_flag_style' => 'not_a_flag']);
switcherAssert($badFlag['switcher_flag_style'] === 'rectangle_mat', 'unknown flag style falls back to rectangle_mat');

// 4. Public accessors expose typed values so the renderer never has to
// re-read $GLOBALS or coerce types itself.
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'switcher_auto_inject' => true,
    'switcher_default_style' => 'dropdown',
    'switcher_flag_style' => 'none',
    'switcher_show_label' => false,
    'switcher_label_format' => 'iso_code',
    'switcher_language_order' => ['en', 'de', 'fr'],
    'switcher_custom_css' => '.x{color:blue}',
]));

switcherAssert($options->shouldAutoInjectSwitcher() === true, 'shouldAutoInjectSwitcher accessor missing or wrong');
switcherAssert($options->getSwitcherDefaultStyle() === 'dropdown', 'getSwitcherDefaultStyle accessor missing or wrong');
switcherAssert($options->getSwitcherFlagStyle() === 'none', 'getSwitcherFlagStyle accessor missing or wrong');
switcherAssert($options->shouldShowSwitcherLabel() === false, 'shouldShowSwitcherLabel accessor missing or wrong');
switcherAssert($options->getSwitcherLabelFormat() === 'iso_code', 'getSwitcherLabelFormat accessor missing or wrong');
switcherAssert($options->getSwitcherLanguageOrder() === ['en', 'de', 'fr'], 'getSwitcherLanguageOrder accessor missing or wrong');
switcherAssert($options->getSwitcherCustomCss() === '.x{color:blue}', 'getSwitcherCustomCss accessor missing or wrong');

// 5. Runtime config from SaaS can override switcher fields, mirroring how
// runtime exclusions already work. Future-proof for two-way sync without
// rewriting the WP admin form contract.
$options->applyRuntimeConfig([
    'switcher' => [
        'autoInject' => false,
        'defaultStyle' => 'list',
        'flagStyle' => 'circle_mat',
        'showLabel' => true,
        'labelFormat' => 'full_name',
        'languageOrder' => ['fr', 'en'],
        'customCss' => '.from-saas{color:green}',
    ],
]);

switcherAssert($options->shouldAutoInjectSwitcher() === false, 'runtime config overrides autoInject');
switcherAssert($options->getSwitcherFlagStyle() === 'circle_mat', 'runtime config overrides flagStyle');
switcherAssert($options->getSwitcherLanguageOrder() === ['fr', 'en'], 'runtime config overrides languageOrder');
switcherAssert($options->getSwitcherCustomCss() === '.from-saas{color:green}', 'runtime config overrides customCss');

fwrite(STDOUT, "SwitcherSettingsTest: OK\n");
