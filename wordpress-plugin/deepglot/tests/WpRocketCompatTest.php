<?php

if (!function_exists('wp_parse_url')) {
    function wp_parse_url($url, $component = -1)
    {
        return parse_url($url, $component);
    }
}

/**
 * WP Rocket "Remove Unused CSS" compatibility contract.
 *
 * Observed live on meinhaushalt.at (2026-07-16): WP Rocket's RUCSS strips
 * assets/css/switcher.css from the page and re-inlines the "used" rules
 * into <style id="wpr-usedcss"> — with the emoji flag glyphs re-encoded
 * as HTML entities (`content: "&#127465;&#127466;"`). HTML entities are
 * invalid inside CSS strings, so browsers rendered the literal entity
 * text instead of flags on every translated page. Clearing the used-css
 * cache only hides the bug until WP Rocket regenerates it.
 *
 * Contract (Frontend\WpRocketCompat):
 *   - rocket_rucss_external_exclusions gains a pattern matching the
 *     switcher.css URL so RUCSS keeps the original <link> tag.
 *   - rocket_exclude_css gains the rooted stylesheet path so WP Rocket's
 *     minify/combine stage does not rewrite the file either.
 *   - rocket_rucss_inline_atts_exclusions gains a pattern matching the
 *     class attribute of EVERY inline <style> block LanguageSwitcher
 *     emits (custom CSS / responsive hide / custom flags) so RUCSS
 *     preserves the per-instance overrides too.
 *   - rocket_rucss_inline_content_exclusions gains a content pattern as
 *     belt-and-braces for the flag override rules.
 *   - Callbacks preserve pre-existing entries, never duplicate their own
 *     pattern, and normalize a non-array filter payload.
 *   - Plugin.php wires the compat layer up.
 *
 * Run standalone: php tests/WpRocketCompatTest.php
 */

if (!function_exists('__')) { function __($t, $d=null){return $t;} }
if (!function_exists('esc_attr')) {
    function esc_attr($v){return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');}
    function esc_html($v){return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');}
}
if (!function_exists('add_shortcode')) { function add_shortcode($t,$c){$GLOBALS['_deepglot_shortcodes'][$t]=$c;} }
if (!function_exists('add_action')) {
    $GLOBALS['_deepglot_actions'] = [];
    function add_action($h,$c,$p=10,$a=1){$GLOBALS['_deepglot_actions'][$h][] = $c;}
}
if (!function_exists('add_filter')) {
    $GLOBALS['_deepglot_filters'] = [];
    function add_filter($h,$c,$p=10,$a=1){$GLOBALS['_deepglot_filters'][$h][] = $c; return true;}
}
if (!function_exists('wp_register_style')) {
    function wp_register_style(...$a){return true;}
    function wp_enqueue_style(...$a){return true;}
    function wp_register_script(...$a){return true;}
    function wp_enqueue_script(...$a){return true;}
}
if (!defined('DEEPGLOT_PLUGIN_URL'))     { define('DEEPGLOT_PLUGIN_URL', 'https://example.com/wp-content/plugins/deepglot/'); }
if (!defined('DEEPGLOT_PLUGIN_VERSION')) { define('DEEPGLOT_PLUGIN_VERSION', '0.10.0'); }

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_options'] = [];
    function get_option($k,$d=false){return $GLOBALS['_deepglot_options'][$k]??$d;}
    function update_option($k,$v){$GLOBALS['_deepglot_options'][$k]=$v;return true;}
    function get_transient($k){return false;}
    function set_transient($k,$v,$t=0){return true;}
    function is_wp_error($v){return false;}
    function wp_parse_args($a,$d=[]){return array_merge($d, is_array($a)?$a:[]);}
    function sanitize_text_field($v){return trim((string)$v);}
    function sanitize_textarea_field($v){return trim((string)$v);}
    function esc_url_raw($v){return (string)$v;}
    function untrailingslashit($v){return rtrim((string)$v, '/');}
    if (!defined('DAY_IN_SECONDS')) define('DAY_IN_SECONDS', 86400);
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/LanguageSwitcher.php';
require_once __DIR__ . '/../includes/Frontend/WpRocketCompat.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\LanguageSwitcher;
use Deepglot\Frontend\WpRocketCompat;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function wprAssert(bool $c, string $m): void {
    if (!$c) { fwrite(STDERR, '✗ ' . $m . PHP_EOL); exit(1); }
}

/** Run every callback registered for a filter hook, like apply_filters(). */
function wprApply(string $hook, $value) {
    foreach ($GLOBALS['_deepglot_filters'][$hook] ?? [] as $cb) {
        $value = $cb($value);
    }
    return $value;
}

// -----------------------------------------------------------------------
// 1. register() hooks all four WP Rocket filters.
// -----------------------------------------------------------------------
(new WpRocketCompat())->register();

$hooks = [
    'rocket_rucss_external_exclusions',
    'rocket_exclude_css',
    'rocket_rucss_inline_atts_exclusions',
    'rocket_rucss_inline_content_exclusions',
];
foreach ($hooks as $hook) {
    wprAssert(!empty($GLOBALS['_deepglot_filters'][$hook]), "register() hooks {$hook}");
}

// -----------------------------------------------------------------------
// 2. RUCSS external exclusion matches the real switcher.css URL and keeps
//    pre-existing third-party entries intact.
// -----------------------------------------------------------------------
$external = wprApply('rocket_rucss_external_exclusions', ['some-other-plugin.css']);
wprAssert(is_array($external), 'External exclusions stay an array');
wprAssert(in_array('some-other-plugin.css', $external, true), 'Pre-existing external exclusions survive');

$switcherUrl = DEEPGLOT_PLUGIN_URL . 'assets/css/switcher.css';
$externalHit = false;
foreach ($external as $pattern) {
    if (is_string($pattern) && $pattern !== '' && strpos($switcherUrl, $pattern) !== false) {
        $externalHit = true;
    }
}
wprAssert($externalHit, 'An external exclusion pattern substring-matches the switcher.css URL: ' . json_encode($external));

// -----------------------------------------------------------------------
// 3. Minify exclusion is a rooted path derived from DEEPGLOT_PLUGIN_URL
//    (subdirectory installs keep their prefix).
// -----------------------------------------------------------------------
$minify = wprApply('rocket_exclude_css', ['/wp-content/themes/x/legacy.css']);
wprAssert(in_array('/wp-content/themes/x/legacy.css', $minify, true), 'Pre-existing minify exclusions survive');
wprAssert(
    in_array('/wp-content/plugins/deepglot/assets/css/switcher.css', $minify, true),
    'Minify exclusion contains the rooted switcher.css path: ' . json_encode($minify)
);

// -----------------------------------------------------------------------
// 4. Every inline <style> block the switcher can emit is covered by an
//    inline-attribute exclusion pattern (RUCSS matches these substrings
//    against the style tag's attributes).
// -----------------------------------------------------------------------
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en', 'fr'],
    'switcher_custom_css' => '.deepglot-switcher { color: red; }',
    'switcher_responsive_hide' => 'mobile',
    'switcher_custom_flags' => ['en' => '🇺🇸'],
]));
$options  = new Options();
$resolver = new UrlLanguageResolver($options->getSourceLanguage(), $options->getTargetLanguages());
$routing  = new SiteRouting($resolver, 'https://example.com', 'PATH_PREFIX', []);
if (!isset($_SERVER['REQUEST_URI'])) $_SERVER['REQUEST_URI'] = '/';
if (!isset($_SERVER['HTTP_HOST']))   $_SERVER['HTTP_HOST']   = 'example.com';
$html = (new LanguageSwitcher($options, $routing))->renderShortcode([]);

preg_match_all('/<style\b[^>]*>/', $html, $styleTags);
wprAssert(count($styleTags[0]) === 3, 'Fixture renders all three inline style blocks (custom css, responsive, flags), got: ' . $html);

$attsPatterns = wprApply('rocket_rucss_inline_atts_exclusions', []);
wprAssert(is_array($attsPatterns) && $attsPatterns !== [], 'Inline attribute exclusions are contributed');

foreach ($styleTags[0] as $openingTag) {
    $covered = false;
    foreach ($attsPatterns as $pattern) {
        if (is_string($pattern) && $pattern !== '' && strpos($openingTag, $pattern) !== false) {
            $covered = true;
        }
    }
    wprAssert($covered, "Inline style tag is covered by an attribute exclusion: {$openingTag} vs " . json_encode($attsPatterns));
}

// -----------------------------------------------------------------------
// 5. Content exclusion (belt-and-braces) matches the emitted flag rules.
// -----------------------------------------------------------------------
$contentPatterns = wprApply('rocket_rucss_inline_content_exclusions', ['.wp-container-']);
wprAssert(in_array('.wp-container-', $contentPatterns, true), 'Pre-existing content exclusions survive');

preg_match('/<style class="deepglot-switcher__custom-flags">(.*?)<\/style>/s', $html, $flagsMatch);
wprAssert(isset($flagsMatch[1]), 'Fixture emits the custom-flags style block');
$contentHit = false;
foreach ($contentPatterns as $pattern) {
    if (is_string($pattern) && $pattern !== '' && strpos($flagsMatch[1], $pattern) !== false) {
        $contentHit = true;
    }
}
wprAssert($contentHit, 'A content exclusion pattern matches the flag override CSS: ' . json_encode($contentPatterns));

// -----------------------------------------------------------------------
// 6. Callbacks are idempotent: applying the filter chain twice must not
//    duplicate the Deepglot patterns (WP Rocket may run them per-request
//    AND per-cron regeneration).
// -----------------------------------------------------------------------
$twice = wprApply('rocket_exclude_css', wprApply('rocket_exclude_css', []));
wprAssert(
    count($twice) === count(array_unique($twice)),
    'Applying rocket_exclude_css twice must not duplicate entries: ' . json_encode($twice)
);

// -----------------------------------------------------------------------
// 7. A hostile/broken third-party filter may hand over a non-array; the
//    callbacks normalize instead of fataling.
// -----------------------------------------------------------------------
$fromJunk = wprApply('rocket_rucss_external_exclusions', false);
wprAssert(is_array($fromJunk) && $fromJunk !== [], 'Non-array filter payload is normalized to an array with our pattern');

// -----------------------------------------------------------------------
// 8. Plugin.php actually wires the compat layer (import + registration).
// -----------------------------------------------------------------------
$pluginSource = file_get_contents(__DIR__ . '/../includes/Plugin.php');
wprAssert(
    is_string($pluginSource) && substr_count($pluginSource, 'WpRocketCompat') >= 2,
    'Plugin.php imports and registers WpRocketCompat'
);

fwrite(STDOUT, "WpRocketCompatTest: OK\n");
