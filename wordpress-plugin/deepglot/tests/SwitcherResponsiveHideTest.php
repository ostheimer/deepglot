<?php

/**
 * Pins the new responsive-hide options that let a site owner show the
 * switcher only on desktop or only on mobile (Weglot-parity: their
 * per-switcher `display_device` + `pixel_cutoff` controls). The
 * renderer emits a scoped <style> block with @media rules so no JS is
 * needed — pure CSS toggle.
 *
 * Contract:
 *   - new option `switcher_responsive_hide` enum: 'none' (default),
 *     'mobile', 'desktop'.
 *   - new option `switcher_responsive_breakpoint` int (px),
 *     default 768, clamped to [320, 1920] so a fat-fingered admin
 *     entry can't break layouts.
 *   - With hide=mobile, the emitted CSS hides the switcher BELOW the
 *     breakpoint (max-width media query).
 *   - With hide=desktop, the CSS hides ABOVE the breakpoint
 *     (min-width media query at breakpoint+1px).
 *   - With hide=none, no @media block is emitted.
 *   - Hidden via `display:none` so the switcher is not just
 *     visually clipped but also removed from focus order and
 *     screen-reader output.
 *
 * Run standalone: php tests/SwitcherResponsiveHideTest.php
 */

if (!function_exists('__')) {
    function __($text, $domain = null) { return $text; }
}
if (!function_exists('esc_attr')) {
    function esc_attr($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
    function esc_attr__($text, $domain = null) { return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8'); }
    function esc_html($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
}
if (!function_exists('add_shortcode')) {
    function add_shortcode($tag, $callback) { $GLOBALS['_deepglot_shortcodes'][$tag] = $callback; }
}
if (!function_exists('add_action')) {
    $GLOBALS['_deepglot_actions'] = [];
    function add_action($hook, $callback, $priority = 10, $accepted_args = 1) {
        $GLOBALS['_deepglot_actions'][$hook][] = $callback;
    }
}
if (!function_exists('wp_register_style')) {
    function wp_register_style(...$args) { return true; }
    function wp_enqueue_style(...$args) { return true; }
    function wp_register_script(...$args) { return true; }
    function wp_enqueue_script(...$args) { return true; }
}

if (!defined('DEEPGLOT_PLUGIN_URL')) {
    define('DEEPGLOT_PLUGIN_URL', 'https://example.com/wp-content/plugins/deepglot/');
}
if (!defined('DEEPGLOT_PLUGIN_VERSION')) {
    define('DEEPGLOT_PLUGIN_VERSION', '0.6.0');
}

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_options'] = [];
    function get_option($key, $default = false) { return $GLOBALS['_deepglot_options'][$key] ?? $default; }
    function update_option($key, $value) { $GLOBALS['_deepglot_options'][$key] = $value; return true; }
    function get_transient($key) { return false; }
    function set_transient($key, $value, $ttl = 0) { return true; }
    function is_wp_error($value) { return false; }
    function wp_parse_args($args, $defaults = []) { return array_merge($defaults, is_array($args) ? $args : []); }
    function sanitize_text_field($value) { return trim((string) $value); }
    function sanitize_textarea_field($value) { return trim((string) $value); }
    function esc_url_raw($value) { return (string) $value; }
    function untrailingslashit($value) { return rtrim((string) $value, '/'); }
    if (!defined('DAY_IN_SECONDS')) { define('DAY_IN_SECONDS', 86400); }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/LanguageSwitcher.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\LanguageSwitcher;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function rhAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

function makeRhSwitcher(array $overrides = []): LanguageSwitcher
{
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), array_merge([
        'enabled' => true,
        'api_key' => 'dg_test_key',
        'source_language' => 'de',
        'target_languages' => ['en', 'fr'],
    ], $overrides)));

    $options  = new Options();
    $resolver = new UrlLanguageResolver(
        $options->getSourceLanguage(),
        $options->getTargetLanguages()
    );
    $routing = new SiteRouting($resolver, 'https://example.com', 'PATH_PREFIX', []);

    if (!isset($_SERVER['REQUEST_URI'])) { $_SERVER['REQUEST_URI'] = '/'; }
    if (!isset($_SERVER['HTTP_HOST']))  { $_SERVER['HTTP_HOST']  = 'example.com'; }

    return new LanguageSwitcher($options, $routing);
}

// 1. New defaults present + sensible.
$defaults = Options::defaults();
rhAssert(array_key_exists('switcher_responsive_hide', $defaults), 'switcher_responsive_hide default missing');
rhAssert(array_key_exists('switcher_responsive_breakpoint', $defaults), 'switcher_responsive_breakpoint default missing');
rhAssert($defaults['switcher_responsive_hide'] === 'none', 'Default hide value must be "none" (no surprise hiding for existing sites)');
rhAssert($defaults['switcher_responsive_breakpoint'] === 768, 'Default breakpoint is 768px (industry-standard tablet cutoff)');

// 2. Sanitization clamps invalid enum to "none".
$opts = new Options();
$bad = $opts->sanitize(['switcher_responsive_hide' => 'gigantic-tablet']);
rhAssert($bad['switcher_responsive_hide'] === 'none', 'Unknown hide value falls back to "none"');

// 3. Breakpoint accepts valid range, clamps outliers.
$tooLow  = $opts->sanitize(['switcher_responsive_breakpoint' => 100]);
$tooHigh = $opts->sanitize(['switcher_responsive_breakpoint' => 9999]);
$valid   = $opts->sanitize(['switcher_responsive_breakpoint' => 1024]);
rhAssert($tooLow['switcher_responsive_breakpoint'] === 320, 'Breakpoint below 320 clamps to 320');
rhAssert($tooHigh['switcher_responsive_breakpoint'] === 1920, 'Breakpoint above 1920 clamps to 1920');
rhAssert($valid['switcher_responsive_breakpoint'] === 1024, 'Valid breakpoint 1024 passes through');

// 4. Non-numeric breakpoint falls back to default.
$nan = $opts->sanitize(['switcher_responsive_breakpoint' => 'medium']);
rhAssert($nan['switcher_responsive_breakpoint'] === 768, 'Non-numeric breakpoint falls back to default 768');

// 5. Accessor returns sanitised values.
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'switcher_responsive_hide' => 'mobile',
    'switcher_responsive_breakpoint' => 600,
]));
$opts2 = new Options();
rhAssert($opts2->getSwitcherResponsiveHide() === 'mobile', 'Accessor returns saved hide value');
rhAssert($opts2->getSwitcherResponsiveBreakpoint() === 600, 'Accessor returns saved breakpoint');

// 6. hide=none → no @media block in output.
$noneHtml = (makeRhSwitcher(['switcher_responsive_hide' => 'none']))->renderShortcode([]);
rhAssert(!str_contains($noneHtml, '@media'), 'hide=none: no @media rule in output');

// 7. hide=mobile → max-width @media block with display:none.
$mobileHtml = (makeRhSwitcher([
    'switcher_responsive_hide' => 'mobile',
    'switcher_responsive_breakpoint' => 600,
]))->renderShortcode([]);
rhAssert(str_contains($mobileHtml, '@media'), 'hide=mobile: @media block present');
rhAssert(
    preg_match('/@media[^{]*max-width:\s*600px[^{]*\{[^}]*display\s*:\s*none/i', $mobileHtml) === 1,
    'hide=mobile: @media (max-width: 600px) { display: none } emitted: ' . substr($mobileHtml, 0, 400)
);

// 8. hide=desktop → min-width @media block at breakpoint+1px so 768
// is treated as the last mobile width.
$desktopHtml = (makeRhSwitcher([
    'switcher_responsive_hide' => 'desktop',
    'switcher_responsive_breakpoint' => 768,
]))->renderShortcode([]);
rhAssert(
    preg_match('/@media[^{]*min-width:\s*769px/i', $desktopHtml) === 1,
    'hide=desktop: @media (min-width: 769px) — breakpoint+1 so 768 is the last mobile width: ' . substr($desktopHtml, 0, 400)
);
rhAssert(
    preg_match('/min-width:\s*769px[^{]*\{[^}]*display\s*:\s*none/i', $desktopHtml) === 1,
    'hide=desktop: @media min-width:769 block ends with display:none rule'
);

// 9. The @media rule is scoped to .deepglot-switcher (not html or
// body) so it can't accidentally hide unrelated content.
rhAssert(
    preg_match('/\.deepglot-switcher\s*\{?[^}]*display\s*:\s*none/i', $mobileHtml) === 1,
    '@media rule targets .deepglot-switcher only'
);

// 10. Runtime config can override responsive hide via SaaS sync.
$opts3 = new Options();
$opts3->applyRuntimeConfig([
    'switcher' => [
        'responsiveHide' => 'desktop',
        'responsiveBreakpoint' => 1100,
    ],
]);
rhAssert($opts3->getSwitcherResponsiveHide() === 'desktop', 'Runtime config overrides responsive hide');
rhAssert($opts3->getSwitcherResponsiveBreakpoint() === 1100, 'Runtime config overrides breakpoint');

// 11. Bad runtime values are still clamped/rejected.
$opts4 = new Options();
$opts4->applyRuntimeConfig([
    'switcher' => [
        'responsiveHide' => 'foldable',
        'responsiveBreakpoint' => 50,
    ],
]);
rhAssert($opts4->getSwitcherResponsiveHide() === 'none', 'Invalid runtime hide → none');
rhAssert($opts4->getSwitcherResponsiveBreakpoint() === 320, 'Invalid runtime breakpoint clamped to 320');

fwrite(STDOUT, "SwitcherResponsiveHideTest: OK\n");
