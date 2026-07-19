<?php

if (!function_exists('wp_parse_url')) {
    function wp_parse_url($url, $component = -1)
    {
        return parse_url($url, $component);
    }
}

/**
 * Regression contract for issue #57 A/C: independently configured switcher
 * instances, legacy migration, and a versioned template registry.
 *
 * Run standalone: php tests/SwitcherInstancesTest.php
 */

function instanceAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

if (!function_exists('__')) {
    function __($text, $domain = null) { return $text; }
}
if (!function_exists('esc_attr')) {
    function esc_attr($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
    function esc_html($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
}
if (!function_exists('add_shortcode')) {
    $GLOBALS['_deepglot_shortcodes'] = [];
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
if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_options'] = [];
    function get_option($key, $default = false) { return $GLOBALS['_deepglot_options'][$key] ?? $default; }
    function update_option($key, $value) { $GLOBALS['_deepglot_options'][$key] = $value; return true; }
    function get_transient($key) { return false; }
    function set_transient($key, $value, $ttl = 0) { return true; }
    function is_wp_error($value) { return false; }
    function wp_parse_args($args, $defaults = []) { return array_merge($defaults, is_array($args) ? $args : []); }
    function sanitize_text_field($value) { return trim(strip_tags((string) $value)); }
    function sanitize_textarea_field($value) { return trim((string) $value); }
    function sanitize_key($value) { return trim(strtolower((string) preg_replace('/[^a-z0-9_-]/i', '', (string) $value)), '_-'); }
    function esc_url_raw($value) { return (string) $value; }
    function untrailingslashit($value) { return rtrim((string) $value, '/'); }
    if (!defined('DAY_IN_SECONDS')) { define('DAY_IN_SECONDS', 86400); }
}

if (!defined('DEEPGLOT_PLUGIN_URL')) {
    define('DEEPGLOT_PLUGIN_URL', 'https://example.com/wp-content/plugins/deepglot/');
}
if (!defined('DEEPGLOT_PLUGIN_VERSION')) {
    define('DEEPGLOT_PLUGIN_VERSION', 'test');
}

$templatePath = __DIR__ . '/../includes/Config/SwitcherTemplates.php';
instanceAssert(file_exists($templatePath), 'Issue #57 requires Config/SwitcherTemplates.php');

require_once __DIR__ . '/../includes/Config/Options.php';
require_once $templatePath;
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/LanguageSwitcher.php';

use Deepglot\Config\Options;
use Deepglot\Config\SwitcherTemplates;
use Deepglot\Frontend\LanguageSwitcher;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function buildInstanceSwitcher(array $stored): LanguageSwitcher
{
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => 'dg_test_key',
        'source_language' => 'de',
        'target_languages' => ['en', 'fr'],
    ], $stored));

    $options = new Options();
    $routing = new SiteRouting(
        new UrlLanguageResolver($options->getSourceLanguage(), $options->getTargetLanguages()),
        'https://example.com',
        'PATH_PREFIX',
        []
    );
    $_SERVER['REQUEST_URI'] = '/';
    $_SERVER['HTTP_HOST'] = 'example.com';
    return new LanguageSwitcher($options, $routing);
}

// A1. A site upgraded from the global switcher fields receives one persisted
// default instance with exactly the old visual and auto-inject settings.
$legacy = array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
    'switcher_auto_inject' => true,
    'switcher_default_style' => 'dropdown',
    'switcher_flag_style' => 'circle_mat',
]);
unset($legacy['switcher_instances'], $legacy['switcher_instances_version']);
update_option(Options::OPTION_KEY, $legacy);

$legacyOptions = new Options();
$migrated = $legacyOptions->getSwitcherInstances();
instanceAssert(count($migrated) === 1, 'Legacy settings must migrate to one default instance');
instanceAssert(($migrated[0]['id'] ?? null) === 'default', 'Migrated instance id must be default');
instanceAssert(($migrated[0]['style'] ?? null) === 'dropdown', 'Migration keeps the global style');
instanceAssert(($migrated[0]['flag_style'] ?? null) === 'circle_mat', 'Migration keeps the global flag style');
instanceAssert(($migrated[0]['auto_inject'] ?? null) === true, 'Migration keeps global auto injection');
$persisted = get_option(Options::OPTION_KEY, []);
instanceAssert(($persisted['switcher_instances_version'] ?? null) === 1, 'Migration is persisted with schema version 1');

// A2/B1. Nested instance settings are independently sanitized. DOM selectors
// deliberately accept only the conservative selector subset generated by the
// visual editor; selector lists, attributes and scriptable text are rejected.
$sanitized = (new Options())->sanitize(array_merge($legacy, [
    'switcher_instances' => [
        [
            'id' => 'header-main',
            'name' => '<b>Kopfzeile</b>',
            'enabled' => '1',
            'auto_inject' => '1',
            'style' => 'dropdown',
            'flag_style' => 'circle_glossy',
            'show_label' => '1',
            'label_format' => 'iso_code',
            'language_order' => ['fr', 'de', 'en'],
            'position' => 'inline',
            'responsive_hide' => 'mobile',
            'responsive_breakpoint' => '900',
            'selector' => 'header.site-header > nav.primary-nav',
        ],
        [
            'id' => 'footer',
            'name' => 'Footer',
            'enabled' => '1',
            'style' => 'list',
            'selector' => 'body,script',
        ],
    ],
]));
$instances = $sanitized['switcher_instances'];
$header = array_values(array_filter($instances, static fn (array $item): bool => ($item['id'] ?? '') === 'header-main'))[0] ?? null;
$footer = array_values(array_filter($instances, static fn (array $item): bool => ($item['id'] ?? '') === 'footer'))[0] ?? null;
instanceAssert(is_array($header), 'Sanitized header instance exists');
instanceAssert($header['name'] === 'Kopfzeile', 'Instance name strips markup');
instanceAssert($header['style'] === 'dropdown' && $header['flag_style'] === 'circle_glossy', 'Independent appearance survives sanitize');
instanceAssert($header['selector'] === 'header.site-header > nav.primary-nav', 'Safe generated selector survives sanitize');
instanceAssert(($footer['selector'] ?? null) === '', 'Unsafe selector list is rejected to the footer fallback');
instanceAssert((new Options())->sanitizeSwitcherSelector('#target[onclick]') === '', 'Attribute selectors are rejected');
instanceAssert((new Options())->sanitizeSwitcherSelector('script') === '', 'Script elements cannot be visual placement targets');

// C1. Templates have an explicit registry version and produce a fresh,
// editable instance config rather than returning shared registry state.
instanceAssert(SwitcherTemplates::VERSION === 1, 'Template registry version must start at 1');
$registry = SwitcherTemplates::registry();
instanceAssert(count($registry) >= 3, 'At least three pre-made switcher templates are available');
$template = SwitcherTemplates::createInstance('minimal-code', 'mobile-nav', 'Mobile Navigation');
instanceAssert(($template['id'] ?? null) === 'mobile-nav', 'Template creates the requested instance id');
instanceAssert(($template['template'] ?? null) === 'minimal-code', 'Template provenance is stored');
instanceAssert(($template['template_version'] ?? null) === 1, 'Template version is stored on created configs');
$template['style'] = 'dropdown';
instanceAssert(($registry['minimal-code']['config']['style'] ?? null) !== 'dropdown', 'Created template configs are editable copies');

// A3. Shortcode instances render their own independent settings and target.
$switcher = buildInstanceSwitcher([
    'switcher_instances_version' => 1,
    'switcher_instances' => [
        SwitcherTemplates::createInstance('classic-dropdown', 'default', 'Standard'),
        array_merge(
            SwitcherTemplates::createInstance('minimal-code', 'header-main', 'Kopfzeile'),
            [
                'enabled' => true,
                'auto_inject' => true,
                'style' => 'dropdown',
                'flag_style' => 'circle_glossy',
                'custom_css' => '.deepglot-switcher{color:red}',
                'selector' => 'header.site-header > nav.primary-nav',
            ]
        ),
    ],
]);
$defaultHtml = $switcher->renderShortcode([]);
$headerHtml = $switcher->renderShortcode(['instance' => 'header-main']);
instanceAssert(str_contains($defaultHtml, 'data-deepglot-instance="default"'), 'Legacy shortcode resolves to default instance');
instanceAssert(str_contains($headerHtml, 'data-deepglot-instance="header-main"'), 'Shortcode instance attribute selects named instance');
instanceAssert(str_contains($headerHtml, 'deepglot-switcher--dropdown'), 'Named instance uses its own style');
instanceAssert(str_contains($headerHtml, 'deepglot-switcher--flag-circle_glossy'), 'Named instance uses its own flag style');
instanceAssert(str_contains($headerHtml, '.deepglot-switcher[data-deepglot-instance="header-main"]{color:red}'), 'Named instance custom CSS is scoped to that instance');
instanceAssert(!str_contains($headerHtml, 'data-deepglot-target'), 'Explicit shortcode placement is not moved by an auto-placement selector');
preg_match('/<input\s+id="([^"]+)"/', $defaultHtml, $defaultId);
preg_match('/<input\s+id="([^"]+)"/', $headerHtml, $headerId);
instanceAssert(($defaultId[1] ?? '') !== ($headerId[1] ?? ''), 'Different instances retain unique ARIA control ids');

// A4. Each enabled auto-inject instance registers an independent footer
// render. A missing visual selector is safe: markup stays in the footer.
$GLOBALS['_deepglot_actions'] = [];
$switcher->register();
$footerCallbacks = $GLOBALS['_deepglot_actions']['wp_footer'] ?? [];
instanceAssert(count($footerCallbacks) === 1, 'Only the auto-inject header instance registers a footer render');
ob_start();
$footerCallbacks[0]();
$autoHtml = ob_get_clean();
instanceAssert(str_contains($autoHtml, 'data-deepglot-instance="header-main"'), 'Auto placement renders the configured instance');
instanceAssert(str_contains($autoHtml, 'data-deepglot-target="header.site-header &gt; nav.primary-nav"'), 'Auto placement emits the sanitized visual target');

// A5. SaaS runtime sync still updates the migrated default instance while
// preserving locally managed extra instances.
$runtimeOptions = new Options();
$runtimeOptions->applyRuntimeConfig([
    'switcher' => [
        'defaultStyle' => 'list',
        'flagStyle' => 'none',
    ],
]);
$runtimeDefault = $runtimeOptions->getSwitcherInstance('default');
$runtimeHeader = $runtimeOptions->getSwitcherInstance('header-main');
instanceAssert($runtimeDefault['style'] === 'list' && $runtimeDefault['flag_style'] === 'none', 'Runtime sync refreshes the default instance');
instanceAssert($runtimeHeader['style'] === 'dropdown' && $runtimeHeader['flag_style'] === 'circle_glossy', 'Runtime sync preserves independent local instances');

fwrite(STDOUT, "SwitcherInstancesTest: OK\n");
