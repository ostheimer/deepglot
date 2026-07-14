<?php

/**
 * Pins the contract of the Gutenberg "Deepglot Sprachschalter" block.
 *
 * The block is intentionally dynamic / server-rendered so the HTML
 * stays in lockstep with shortcode and auto-inject output — there is
 * no second copy of the switcher markup to drift over time.
 *
 * Requirements:
 *   1. `deepglot/switcher` block is registered with register_block_type
 *      using the bundled block.json metadata.
 *   2. The render callback returns the same HTML LanguageSwitcher emits
 *      for the same options, so a block placed in a page renders byte-
 *      identical to a shortcode in that page.
 *   3. The editor script handle ships with the same plugin version so
 *      cache busting works across releases.
 *
 * Run standalone: php tests/BlockRenderTest.php
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
    function wp_register_script(...$args) {
        $GLOBALS['_deepglot_registered_scripts'][$args[0]] = $args;
        return true;
    }
    function wp_enqueue_script(...$args) { return true; }
}
if (!function_exists('register_block_type')) {
    $GLOBALS['_deepglot_block_registrations'] = [];
    function register_block_type($name_or_path, $args = []) {
        $GLOBALS['_deepglot_block_registrations'][] = [
            'name_or_path' => $name_or_path,
            'args'         => $args,
        ];
        return true;
    }
}
if (!defined('DEEPGLOT_PLUGIN_URL')) {
    define('DEEPGLOT_PLUGIN_URL', 'https://example.com/wp-content/plugins/deepglot/');
}
if (!defined('DEEPGLOT_PLUGIN_VERSION')) {
    define('DEEPGLOT_PLUGIN_VERSION', '0.5.0');
}
if (!defined('DEEPGLOT_PLUGIN_DIR')) {
    define('DEEPGLOT_PLUGIN_DIR', __DIR__ . '/../');
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
require_once __DIR__ . '/../includes/Frontend/SwitcherBlock.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\LanguageSwitcher;
use Deepglot\Frontend\SwitcherBlock;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function blockAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

function makeBlockEnv(array $overrides = []): array
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

    $switcher = new LanguageSwitcher($options, $routing);

    return [$switcher, new SwitcherBlock($switcher)];
}

// 1. register() wires the WP `init` action so register_block_type runs
// at the proper hook (too early = block not yet registered when editor
// loads; too late = REST API misses it).
$GLOBALS['_deepglot_actions'] = [];
[$switcher, $block] = makeBlockEnv();
$block->register();
$initHooks = $GLOBALS['_deepglot_actions']['init'] ?? [];
blockAssert(count($initHooks) === 1, 'Block must register exactly one init hook, got ' . count($initHooks));

// 2. Calling the registered hook triggers register_block_type with the
// `deepglot/switcher` name and a render_callback that points at the
// block's render() method.
$GLOBALS['_deepglot_block_registrations'] = [];
$initHooks[0]();
$registrations = $GLOBALS['_deepglot_block_registrations'];
blockAssert(count($registrations) === 1, 'Exactly one block must be registered, got ' . count($registrations));

$registration = $registrations[0];
$nameOrPath   = $registration['name_or_path'];
$args         = $registration['args'];

// Block can be registered via either (a) a block.json directory path,
// or (b) an explicit `deepglot/switcher` namespace string. Both are
// acceptable WP patterns; we keep the test flexible so a future refactor
// to block.json doesn't fail the contract test.
$registeredOk = (is_string($nameOrPath) && (
    $nameOrPath === 'deepglot/switcher'
    || (is_dir($nameOrPath) && file_exists($nameOrPath . '/block.json'))
));
blockAssert($registeredOk, 'Block registered as "deepglot/switcher" or via block.json path, got ' . var_export($nameOrPath, true));

// 3. A render_callback is provided either inline or via block.json. We
// directly exercise the block's render() to verify it produces the same
// switcher markup as the shortcode (per-render uniqids differ — strip
// them before comparing, since the structure is what matters).
$normalise = static function (string $html): string {
    return preg_replace('/dg[a-f0-9.]+/', 'dgUNIQ', $html);
};
$expected = $normalise($switcher->renderShortcode([]));
$actual   = $normalise($block->render());
blockAssert($expected === $actual, 'Block render() must produce the same markup as renderShortcode() (structure-equal, uniqids normalised)');
blockAssert(str_contains($block->render(), '<aside '), 'Block render() emits the <aside> wrapper');
blockAssert(str_contains($block->render(), 'data-deepglot-no-translate'), 'Block render() carries data-deepglot-no-translate');

// 4. Disabled plugin → block render returns empty string (don't leak
// orphan markup into a page).
$GLOBALS['_deepglot_block_registrations'] = [];
[$switcherOff, $blockOff] = makeBlockEnv(['enabled' => false]);
blockAssert($blockOff->render() === '', 'Disabled plugin: block render returns empty');

// 5. The editor script is registered with the plugin version so cache
// busts across releases.
$GLOBALS['_deepglot_registered_scripts'] = [];
$blockOff->register();
($GLOBALS['_deepglot_actions']['init'][1] ?? null) && ($GLOBALS['_deepglot_actions']['init'][1])();
$blockEditorReg = $GLOBALS['_deepglot_registered_scripts']['deepglot-switcher-block'] ?? null;
if ($blockEditorReg !== null) {
    blockAssert($blockEditorReg[3] === DEEPGLOT_PLUGIN_VERSION, 'Editor script registered with plugin version');
}

// 6. Block honours the alignment attribute (codex P2 from PR #48):
// because we advertise `supports.align`, the editor's left/center/right
// choice must reach the frontend as an `align<value>` wrapper class.
[$_, $alignBlock] = makeBlockEnv();

$plain      = $alignBlock->render([]);
$leftAlign  = $alignBlock->render(['align' => 'left']);
$centerAlgn = $alignBlock->render(['align' => 'center']);
$rightAlgn  = $alignBlock->render(['align' => 'right']);

blockAssert(!str_contains($plain, 'alignleft') && !str_contains($plain, 'aligncenter') && !str_contains($plain, 'alignright'), 'No align attribute → no align class leaks into output');
blockAssert(str_contains($leftAlign, 'class="wp-block-deepglot-switcher alignleft"'), 'align=left wraps in alignleft class: ' . substr($leftAlign, 0, 200));
blockAssert(str_contains($centerAlgn, 'aligncenter'), 'align=center adds aligncenter class');
blockAssert(str_contains($rightAlgn, 'alignright'), 'align=right adds alignright class');
blockAssert(str_contains($leftAlign, '<aside '), 'Aligned output still contains the switcher <aside>');

// Unknown alignment values are dropped (defense-in-depth against an
// attacker manipulating the block JSON in a saved post).
$bogus = $alignBlock->render(['align' => 'underneath" onclick="alert(1)']);
blockAssert(!str_contains($bogus, 'onclick'), 'Unknown align value is rejected, not echoed into the class attribute');

// 7. Issue #57: a dynamic block can select an independent saved switcher
// instance while retaining the existing alignment wrapper contract.
[$_, $instanceBlock] = makeBlockEnv([
    'switcher_instances_version' => 1,
    'switcher_instances' => [
        [
            'id' => 'default', 'name' => 'Standard', 'enabled' => true,
            'auto_inject' => false, 'style' => 'list', 'flag_style' => 'rectangle_mat',
            'show_label' => true, 'label_format' => 'full_name', 'language_order' => [],
            'custom_css' => '', 'position' => 'inline', 'responsive_hide' => 'none',
            'responsive_breakpoint' => 768, 'custom_flags' => [], 'selector' => '',
        ],
        [
            'id' => 'block-dropdown', 'name' => 'Block Dropdown', 'enabled' => true,
            'auto_inject' => false, 'style' => 'dropdown', 'flag_style' => 'none',
            'show_label' => true, 'label_format' => 'iso_code', 'language_order' => [],
            'custom_css' => '', 'position' => 'inline', 'responsive_hide' => 'none',
            'responsive_breakpoint' => 768, 'custom_flags' => [], 'selector' => '',
        ],
    ],
]);
$instanceBlockHtml = $instanceBlock->render(['instanceId' => 'block-dropdown', 'align' => 'center']);
blockAssert(str_contains($instanceBlockHtml, 'data-deepglot-instance="block-dropdown"'), 'Block instanceId selects the saved instance');
blockAssert(str_contains($instanceBlockHtml, 'deepglot-switcher--dropdown'), 'Block instance keeps independent dropdown style');
blockAssert(str_contains($instanceBlockHtml, 'aligncenter'), 'Block instance keeps alignment support');

fwrite(STDOUT, "BlockRenderTest: OK\n");
