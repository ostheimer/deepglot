<?php

/**
 * Pins the per-language custom flag override (Weglot-parity: their
 * `custom_flag` field per language in the dashboard).
 *
 * Why this exists: the default flag mapping picks one canonical flag
 * per ISO 639-1 language code (e.g. `en` → 🇬🇧 GB), but real audiences
 * often need a different one (`en` → 🇺🇸 US for an American storefront,
 * `pt` → 🇧🇷 BR for a Brazilian site, `es` → 🇲🇽 MX for a Mexican site).
 *
 * Contract:
 *   - new option `switcher_custom_flags` assoc array<lang, value>
 *     where value is either an emoji string OR a URL to an image.
 *   - sanitization preserves only configured languages (drops orphans
 *     that no longer match source/target), enforces a length cap, and
 *     rejects `<`, `"` and other class/attr breakouts.
 *   - renderer emits a scoped <style> block BEFORE <aside> with one
 *     rule per overridden language:
 *       .deepglot-flag--{lang}::before { content: "🇺🇸"; }
 *     or for URL values:
 *       .deepglot-flag--{lang} { background-image: url("…"); }
 *       .deepglot-flag--{lang}::before { content: ""; }
 *   - runtime config can drive the map from SaaS.
 *
 * Run standalone: php tests/SwitcherCustomFlagsTest.php
 */

if (!function_exists('__')) { function __($t, $d=null){return $t;} }
if (!function_exists('esc_attr')) {
    function esc_attr($v){return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');}
    function esc_attr__($t, $d=null){return htmlspecialchars((string)$t, ENT_QUOTES, 'UTF-8');}
    function esc_html($v){return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');}
}
if (!function_exists('add_shortcode')) { function add_shortcode($t,$c){$GLOBALS['_deepglot_shortcodes'][$t]=$c;} }
if (!function_exists('add_action')) {
    $GLOBALS['_deepglot_actions'] = [];
    function add_action($h,$c,$p=10,$a=1){$GLOBALS['_deepglot_actions'][$h][] = $c;}
}
if (!function_exists('wp_register_style')) {
    function wp_register_style(...$a){return true;}
    function wp_enqueue_style(...$a){return true;}
    function wp_register_script(...$a){return true;}
    function wp_enqueue_script(...$a){return true;}
}
if (!defined('DEEPGLOT_PLUGIN_URL'))     { define('DEEPGLOT_PLUGIN_URL', 'https://example.com/wp-content/plugins/deepglot/'); }
if (!defined('DEEPGLOT_PLUGIN_VERSION')) { define('DEEPGLOT_PLUGIN_VERSION', '0.7.0'); }

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

use Deepglot\Config\Options;
use Deepglot\Frontend\LanguageSwitcher;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function cfAssert(bool $c, string $m): void {
    if (!$c) { fwrite(STDERR, '✗ ' . $m . PHP_EOL); exit(1); }
}

function makeCfSwitcher(array $overrides = []): LanguageSwitcher {
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), array_merge([
        'enabled' => true,
        'api_key' => 'dg_test_key',
        'source_language' => 'de',
        'target_languages' => ['en', 'fr', 'es'],
    ], $overrides)));

    $options  = new Options();
    $resolver = new UrlLanguageResolver($options->getSourceLanguage(), $options->getTargetLanguages());
    $routing  = new SiteRouting($resolver, 'https://example.com', 'PATH_PREFIX', []);
    if (!isset($_SERVER['REQUEST_URI'])) $_SERVER['REQUEST_URI'] = '/';
    if (!isset($_SERVER['HTTP_HOST']))   $_SERVER['HTTP_HOST']   = 'example.com';
    return new LanguageSwitcher($options, $routing);
}

// 1. Default exists, empty by default (no per-language overrides for
// existing sites).
$defaults = Options::defaults();
cfAssert(array_key_exists('switcher_custom_flags', $defaults), 'switcher_custom_flags default missing');
cfAssert($defaults['switcher_custom_flags'] === [], 'Default is empty assoc array (no overrides)');

// 2. Sanitization filters down to configured languages only (drops
// orphans that aren't source / not in target_languages) so a stale DB
// row from a removed language doesn't keep injecting CSS.
$opts = new Options();
$out = $opts->sanitize([
    'source_language'  => 'de',
    'target_languages' => ['en', 'fr'],
    'switcher_custom_flags' => [
        'en' => '🇺🇸',
        'fr' => '🇫🇷',
        'zz' => '🏴',          // not configured → drop
        'de' => '',             // empty → drop
    ],
]);
cfAssert(isset($out['switcher_custom_flags']['en']) && $out['switcher_custom_flags']['en'] === '🇺🇸', 'en override survives');
cfAssert(isset($out['switcher_custom_flags']['fr']) && $out['switcher_custom_flags']['fr'] === '🇫🇷', 'fr override survives');
cfAssert(!isset($out['switcher_custom_flags']['zz']), 'unconfigured zz dropped');
cfAssert(!isset($out['switcher_custom_flags']['de']), 'empty value dropped (no point overriding to empty)');

// 3. Sanitization rejects dangerous characters that could break out of
// the CSS string/url() context.
$xssOut = $opts->sanitize([
    'source_language'  => 'de',
    'target_languages' => ['en'],
    'switcher_custom_flags' => [
        'en' => '"; } body { display: none } /*',
    ],
]);
cfAssert(
    !isset($xssOut['switcher_custom_flags']['en'])
        || (strpos($xssOut['switcher_custom_flags']['en'], '"') === false
            && strpos($xssOut['switcher_custom_flags']['en'], '}') === false),
    'XSS-ish CSS break-out characters are stripped from custom flag values'
);

// 4. Length cap so a 10 KB paste doesn't render-blow the head.
$bigOut = $opts->sanitize([
    'source_language'  => 'de',
    'target_languages' => ['en'],
    'switcher_custom_flags' => [
        'en' => str_repeat('a', 5000),
    ],
]);
cfAssert(
    !isset($bigOut['switcher_custom_flags']['en'])
        || mb_strlen($bigOut['switcher_custom_flags']['en']) <= 256,
    'Custom flag value capped at 256 chars to keep the inline CSS small'
);

// 5. Accessor returns the assoc array.
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'source_language' => 'de',
    'target_languages' => ['en', 'fr'],
    'switcher_custom_flags' => ['en' => '🇺🇸', 'fr' => '🇨🇦'],
]));
$opts2 = new Options();
cfAssert($opts2->getSwitcherCustomFlags() === ['en' => '🇺🇸', 'fr' => '🇨🇦'], 'getSwitcherCustomFlags accessor returns saved map');

// 6. Renderer with NO overrides emits no extra <style> block beyond the
// (optional) custom_css and responsive_css.
$plainHtml = (makeCfSwitcher())->renderShortcode([]);
cfAssert(
    strpos($plainHtml, '.deepglot-flag--') === false
        || substr_count($plainHtml, '.deepglot-flag--') === 0,
    'No flag overrides emitted when switcher_custom_flags is empty: ' . substr($plainHtml, 0, 200)
);

// 7. Renderer with one emoji override emits a single ::before rule for
// the overridden language only.
$cfHtml = (makeCfSwitcher([
    'switcher_custom_flags' => ['en' => '🇺🇸'],
]))->renderShortcode([]);
cfAssert(
    preg_match('/\.deepglot-flag--en::before\s*\{[^}]*content\s*:\s*["\']🇺🇸["\']/u', $cfHtml) === 1,
    'en override emits .deepglot-flag--en::before { content: "🇺🇸" }: ' . substr($cfHtml, 0, 400)
);
cfAssert(
    strpos($cfHtml, '.deepglot-flag--de::before') === false,
    'Non-overridden languages do not get a rule (de stays on default flag)'
);

// 8. URL values get emitted as background-image with content reset.
$urlHtml = (makeCfSwitcher([
    'switcher_custom_flags' => [
        'en' => 'https://example.com/flags/us.svg',
    ],
]))->renderShortcode([]);
cfAssert(
    preg_match('/\.deepglot-flag--en\s*\{[^}]*background-image\s*:\s*url\(["\']?https:\/\/example\.com\/flags\/us\.svg["\']?\)/i', $urlHtml) === 1,
    'URL custom flag emitted as background-image: ' . substr($urlHtml, 0, 400)
);
cfAssert(
    preg_match('/\.deepglot-flag--en::before\s*\{[^}]*content\s*:\s*["\']{2}/', $urlHtml) === 1
        || preg_match('/\.deepglot-flag--en::before\s*\{[^}]*content\s*:\s*\'\'/', $urlHtml) === 1,
    'URL override also resets ::before content so the default emoji does not stack on top'
);

// 9. The override <style> is emitted BEFORE the <aside> so its rules
// land in cascade order before the generic switcher.css.
$cfStylePos = strpos($cfHtml, '<style class="deepglot-switcher__custom-flags">');
$asidePos   = strpos($cfHtml, '<aside ');
cfAssert($cfStylePos !== false, 'A scoped <style class="deepglot-switcher__custom-flags"> block is emitted');
cfAssert($cfStylePos < $asidePos, 'Custom-flag <style> sits before the <aside>');

// 10. Runtime config sub-object can drive the map from SaaS.
$opts3 = new Options();
$opts3->applyRuntimeConfig([
    'switcher' => [
        'customFlags' => ['en' => '🇺🇸', 'fr' => '🇨🇦'],
    ],
]);
cfAssert(
    $opts3->getSwitcherCustomFlags() === ['en' => '🇺🇸', 'fr' => '🇨🇦'],
    'Runtime config can drive switcher.customFlags'
);

fwrite(STDOUT, "SwitcherCustomFlagsTest: OK\n");
