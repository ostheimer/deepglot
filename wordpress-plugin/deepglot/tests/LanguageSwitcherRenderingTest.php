<?php

/**
 * Pins how the language switcher renders once the admin can drive every
 * appearance knob from the WP plugin settings (introduced 2026-05-12, see
 * SwitcherSettingsTest.php). The renderer must read every value from
 * Options instead of relying on shortcode atts so the SaaS Switcher panel
 * (which writes to runtime config) mirrors the actual on-page output.
 *
 * Covers:
 *   - default list rendering with rectangle_mat flags and full names
 *   - dropdown style switch
 *   - flag style modifier class + opting out via flag_style="none"
 *   - label format iso_code shows uppercase ISO instead of native label
 *   - show_label=false hides label text from sighted users but keeps it
 *     in the DOM for screen readers (visually-hidden span)
 *   - language order overrides the default [source, ...targets] order and
 *     ignores languages that are not configured
 *   - custom CSS is emitted in a scoped <style> block before the nav
 *   - auto-inject toggles register a wp_footer hook
 *
 * Run standalone: php tests/LanguageSwitcherRenderingTest.php
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }
}

if (!function_exists('esc_attr')) {
    function esc_attr($value) {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }

    function esc_attr__($text, $domain = null) {
        return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
    }

    function esc_html($value) {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }
}

if (!function_exists('add_shortcode')) {
    $GLOBALS['_deepglot_shortcodes'] = [];
    function add_shortcode($tag, $callback) {
        $GLOBALS['_deepglot_shortcodes'][$tag] = $callback;
    }
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
    function wp_add_inline_style(...$args) {
        $GLOBALS['_deepglot_inline_styles'][] = $args;
        return true;
    }
}

if (!defined('DEEPGLOT_PLUGIN_URL')) {
    define('DEEPGLOT_PLUGIN_URL', 'https://example.com/wp-content/plugins/deepglot/');
}
if (!defined('DEEPGLOT_PLUGIN_VERSION')) {
    define('DEEPGLOT_PLUGIN_VERSION', 'test');
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
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/LanguageSwitcher.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\LanguageSwitcher;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function switcherRenderAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

function makeSwitcher(array $overrides = []): LanguageSwitcher
{
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), array_merge([
        'enabled' => true,
        'api_key' => 'dg_test_key',
        'source_language' => 'de',
        'target_languages' => ['en', 'fr'],
    ], $overrides)));

    $options = new Options();
    $resolver = new UrlLanguageResolver(
        $options->getSourceLanguage(),
        $options->getTargetLanguages()
    );
    $routing = new SiteRouting($resolver, 'https://example.com', 'PATH_PREFIX', []);

    $_SERVER['REQUEST_URI'] = '/';
    $_SERVER['HTTP_HOST'] = 'example.com';

    return new LanguageSwitcher($options, $routing);
}

// 1. Default render uses list style, rectangle_mat flags, full names, and
// emits source-then-targets in the default order.
$switcher = makeSwitcher();
$html = $switcher->renderShortcode([]);

switcherRenderAssert(str_contains($html, 'deepglot-switcher--list'), 'Default render must be list style: ' . $html);
switcherRenderAssert(str_contains($html, 'deepglot-switcher--flag-rectangle_mat'), 'Default flag style must be rectangle_mat: ' . $html);
switcherRenderAssert(str_contains($html, 'class="deepglot-flag deepglot-flag--de"'), 'Flag span for de must render');
switcherRenderAssert(str_contains($html, 'class="deepglot-flag deepglot-flag--en"'), 'Flag span for en must render');
switcherRenderAssert(str_contains($html, '>Deutsch<'), 'Full label German rendered by default');
switcherRenderAssert(str_contains($html, '>English<'), 'Full label English rendered by default');
$posDe = strpos($html, 'hreflang="de"');
$posEn = strpos($html, 'hreflang="en"');
$posFr = strpos($html, 'hreflang="fr"');
switcherRenderAssert($posDe !== false && $posEn !== false && $posFr !== false, 'All hreflang links present');
switcherRenderAssert($posDe < $posEn && $posEn < $posFr, 'Default order is source first then targets in config order');

// 2. switcher_default_style=dropdown produces dropdown wrapper class even
// without a shortcode att override.
$dropdown = makeSwitcher(['switcher_default_style' => 'dropdown']);
$dropHtml = $dropdown->renderShortcode([]);
switcherRenderAssert(str_contains($dropHtml, 'deepglot-switcher--dropdown'), 'Dropdown style applies from option: ' . $dropHtml);
switcherRenderAssert(!str_contains($dropHtml, 'deepglot-switcher--list'), 'Dropdown style must not also be list');

// 3. flag_style=none removes flag spans and uses the "none" modifier class.
$noFlags = makeSwitcher(['switcher_flag_style' => 'none']);
$noFlagsHtml = $noFlags->renderShortcode([]);
switcherRenderAssert(str_contains($noFlagsHtml, 'deepglot-switcher--flag-none'), 'flag_style=none modifier class present');
switcherRenderAssert(!str_contains($noFlagsHtml, 'deepglot-flag deepglot-flag--'), 'No flag spans rendered when flag_style=none: ' . $noFlagsHtml);

// 4. flag_style=circle_glossy passes through to wrapper modifier class.
$circle = makeSwitcher(['switcher_flag_style' => 'circle_glossy']);
$circleHtml = $circle->renderShortcode([]);
switcherRenderAssert(str_contains($circleHtml, 'deepglot-switcher--flag-circle_glossy'), 'circle_glossy modifier renders');

// 5. switcher_label_format=iso_code shows uppercase ISO code instead of
// native name.
$iso = makeSwitcher(['switcher_label_format' => 'iso_code']);
$isoHtml = $iso->renderShortcode([]);
switcherRenderAssert(str_contains($isoHtml, '>DE<'), 'ISO label DE rendered');
switcherRenderAssert(str_contains($isoHtml, '>EN<'), 'ISO label EN rendered');
switcherRenderAssert(!str_contains($isoHtml, '>Deutsch<'), 'Native label suppressed when ISO mode active: ' . $isoHtml);

// 6. switcher_show_label=false keeps a screen-reader-only label so the
// link still has accessible text, but visible label is hidden.
$noLabel = makeSwitcher(['switcher_show_label' => false]);
$noLabelHtml = $noLabel->renderShortcode([]);
switcherRenderAssert(str_contains($noLabelHtml, 'deepglot-switcher--no-label'), 'show_label=false adds wrapper modifier');
switcherRenderAssert(str_contains($noLabelHtml, 'deepglot-label--sr-only'), 'show_label=false marks labels visually-hidden');
switcherRenderAssert(str_contains($noLabelHtml, '>Deutsch<'), 'Label text still present for screen readers');

// 7. switcher_language_order overrides the default order and silently
// drops languages that are not configured.
$ordered = makeSwitcher(['switcher_language_order' => ['fr', 'de', 'en', 'zz']]);
$orderedHtml = $ordered->renderShortcode([]);
$posFr2 = strpos($orderedHtml, 'hreflang="fr"');
$posDe2 = strpos($orderedHtml, 'hreflang="de"');
$posEn2 = strpos($orderedHtml, 'hreflang="en"');
switcherRenderAssert($posFr2 !== false && $posDe2 !== false && $posEn2 !== false, 'All configured languages still render');
switcherRenderAssert($posFr2 < $posDe2 && $posDe2 < $posEn2, 'Order follows switcher_language_order: ' . $orderedHtml);
switcherRenderAssert(!str_contains($orderedHtml, 'hreflang="zz"'), 'Unconfigured language is not rendered');

// 8. Custom CSS is emitted in a scoped <style> tag immediately before the
// nav so the cascade overrides default switcher.css rules.
$css = ".deepglot-switcher{background:hotpink}";
$customCss = makeSwitcher(['switcher_custom_css' => $css]);
$cssHtml = $customCss->renderShortcode([]);
switcherRenderAssert(str_contains($cssHtml, '<style'), 'Custom CSS wrapper present: ' . $cssHtml);
switcherRenderAssert(str_contains($cssHtml, $css), 'Custom CSS contents preserved verbatim');
$cssStylePos = strpos($cssHtml, '<style');
$cssNavPos   = strpos($cssHtml, '<aside');
switcherRenderAssert($cssStylePos !== false && $cssNavPos !== false && $cssStylePos < $cssNavPos, 'Custom CSS emitted before switcher wrapper');

// Custom CSS must NOT break out of its <style> tag. A malicious admin
// submission with a closing tag should be neutralised. The renderer must
// either escape the closing tag or strip it — empty output for the broken
// CSS would silently drop user intent, so prefer escaping.
$xssCss = ".x{}</style><script>alert(1)</script>";
$xssSwitcher = makeSwitcher(['switcher_custom_css' => $xssCss]);
$xssHtml = $xssSwitcher->renderShortcode([]);
switcherRenderAssert(!str_contains($xssHtml, '<script>alert(1)</script>'), 'Custom CSS must not allow <script> breakout');

// 9. Auto-inject toggle registers a wp_footer action; toggle off omits it.
$GLOBALS['_deepglot_actions'] = [];
$auto = makeSwitcher(['switcher_auto_inject' => true]);
$auto->register();
$footerCallbacks = $GLOBALS['_deepglot_actions']['wp_footer'] ?? [];
switcherRenderAssert(count($footerCallbacks) === 1, 'Auto-inject registers exactly one wp_footer hook');

$GLOBALS['_deepglot_actions'] = [];
$manual = makeSwitcher(['switcher_auto_inject' => false]);
$manual->register();
$footerCallbacksOff = $GLOBALS['_deepglot_actions']['wp_footer'] ?? [];
switcherRenderAssert(count($footerCallbacksOff) === 0, 'Auto-inject off must not register wp_footer hook');

// 10. Shortcode `style="dropdown"` att still wins over the saved option so
// templates that embed `[deepglot_switcher style="dropdown"]` keep working
// after the upgrade.
$override = makeSwitcher(['switcher_default_style' => 'list']);
$overrideHtml = $override->renderShortcode(['style' => 'dropdown']);
switcherRenderAssert(str_contains($overrideHtml, 'deepglot-switcher--dropdown'), 'Shortcode att overrides saved option');

fwrite(STDOUT, "LanguageSwitcherRenderingTest: OK\n");
