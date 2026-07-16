<?php

if (!function_exists('wp_parse_url')) {
    function wp_parse_url($url, $component = -1)
    {
        return parse_url($url, $component);
    }
}

/**
 * Pins the contract of the classic WP_Widget for the Deepglot language
 * switcher. Many real-world themes (Twenty Twenty-One, Astra free, the
 * pre-FSE generation of Avada/Divi) still rely on widget areas, so a
 * Block-only integration leaves them out.
 *
 * Requirements:
 *   1. SwitcherWidget extends WP_Widget with the deepglot_switcher id.
 *   2. widget($args, $instance) prints before/after wrappers, optional
 *      title, and the LanguageSwitcher HTML in between.
 *   3. form() prints a sanitised title input.
 *   4. update() sanitises new instance values (no raw HTML leakage).
 *   5. SwitcherWidget::register() wires register_widget on widgets_init.
 *
 * Run standalone: php tests/WidgetRenderTest.php
 */

if (!function_exists('__')) {
    function __($text, $domain = null) { return $text; }
}
if (!function_exists('esc_attr')) {
    function esc_attr($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
    function esc_attr__($text, $domain = null) { return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8'); }
    function esc_html($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
    function esc_html__($text, $domain = null) { return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8'); }
    function esc_html_e($text, $domain = null) { echo htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8'); }
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
if (!function_exists('apply_filters')) {
    function apply_filters($hook, $value) { return $value; }
}
if (!function_exists('register_widget')) {
    $GLOBALS['_deepglot_registered_widgets'] = [];
    function register_widget($class) {
        $GLOBALS['_deepglot_registered_widgets'][] = $class;
    }
}
if (!function_exists('wp_register_style')) {
    function wp_register_style(...$args) { return true; }
    function wp_enqueue_style(...$args) { return true; }
    function wp_register_script(...$args) { return true; }
    function wp_enqueue_script(...$args) { return true; }
}
if (!class_exists('WP_Widget')) {
    /**
     * Minimal stand-in for WordPress' WP_Widget base class so we can
     * instantiate SwitcherWidget outside WP. Only the methods our
     * widget actually overrides need to exist on the parent.
     */
    abstract class WP_Widget
    {
        public string $id_base   = '';
        public string $name      = '';
        public array  $widget_options = [];
        public array  $control_options = [];

        public function __construct(string $id_base, string $name, array $widget_options = [], array $control_options = [])
        {
            $this->id_base         = $id_base;
            $this->name            = $name;
            $this->widget_options  = $widget_options;
            $this->control_options = $control_options;
        }

        public function get_field_id(string $field): string   { return 'widget-deepglot-' . $field; }
        public function get_field_name(string $field): string { return 'widget-deepglot[' . $field . ']'; }

        abstract public function widget($args, $instance);
        public function form($instance) {}
        public function update($new_instance, $old_instance) { return $new_instance; }
    }
}

if (!defined('DEEPGLOT_PLUGIN_URL')) {
    define('DEEPGLOT_PLUGIN_URL', 'https://example.com/wp-content/plugins/deepglot/');
}
if (!defined('DEEPGLOT_PLUGIN_VERSION')) {
    define('DEEPGLOT_PLUGIN_VERSION', '0.5.0');
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
    function esc_url_raw($value) { return (string) $value; }
    function untrailingslashit($value) { return rtrim((string) $value, '/'); }
    function wp_strip_all_tags($value) {
        // Match wp-includes/formatting.php behaviour: strip script/style
        // body BEFORE strip_tags so the contained code disappears too.
        $text = preg_replace('@<(script|style)[^>]*?>.*?</\\1>@si', '', (string) $value);
        return strip_tags((string) $text);
    }
    if (!defined('DAY_IN_SECONDS')) { define('DAY_IN_SECONDS', 86400); }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/LanguageSwitcher.php';
require_once __DIR__ . '/../includes/Frontend/SwitcherWidget.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\LanguageSwitcher;
use Deepglot\Frontend\SwitcherWidget;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function widgetAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

function makeWidgetEnv(array $overrides = []): LanguageSwitcher
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

// 1. SwitcherWidget extends WP_Widget with the deepglot_switcher id.
$switcher = makeWidgetEnv();
SwitcherWidget::bind($switcher);
$widget = new SwitcherWidget();
widgetAssert($widget instanceof WP_Widget, 'SwitcherWidget extends WP_Widget');
widgetAssert($widget->id_base === 'deepglot_switcher', 'Widget id_base is deepglot_switcher, got ' . $widget->id_base);

// 2. widget($args, $instance) prints before_widget + (title) + switcher
// + after_widget when a title is supplied.
$widgetArgs = [
    'before_widget' => '<aside class="widget-wrap">',
    'after_widget'  => '</aside>',
    'before_title'  => '<h3 class="widget-title">',
    'after_title'   => '</h3>',
];

ob_start();
$widget->widget($widgetArgs, ['title' => 'Sprache wählen']);
$output = ob_get_clean();

widgetAssert(str_starts_with($output, '<aside class="widget-wrap">'), 'before_widget rendered first: ' . substr($output, 0, 100));
widgetAssert(str_contains($output, '<h3 class="widget-title">Sprache wählen</h3>'), 'Title wrapped in before/after_title: ' . substr($output, 0, 200));
widgetAssert(str_contains($output, '<aside class="deepglot-switcher'), 'LanguageSwitcher HTML embedded in widget body');
widgetAssert(str_ends_with(rtrim($output), '</aside>'), 'after_widget rendered last');

// 3. Empty title → no title markup leaks through.
ob_start();
$widget->widget($widgetArgs, ['title' => '']);
$noTitleOutput = ob_get_clean();
widgetAssert(!str_contains($noTitleOutput, 'widget-title'), 'Empty title suppresses before/after_title markup');
widgetAssert(str_contains($noTitleOutput, '<aside class="deepglot-switcher'), 'Switcher body still renders without title');

// 4. update() strips HTML tags from the title (defense against admin
// pasting raw markup).
$clean = $widget->update(['title' => '<script>alert(1)</script>Sprachen'], []);
widgetAssert($clean['title'] === 'Sprachen', 'update() strips HTML from title, got ' . var_export($clean['title'], true));

// 5. form() prints a labelled input for the title.
ob_start();
$widget->form(['title' => 'Sprachschalter']);
$formOutput = ob_get_clean();
widgetAssert(str_contains($formOutput, 'name="widget-deepglot[title]"'), 'form() emits name attribute via get_field_name');
widgetAssert(str_contains($formOutput, 'value="Sprachschalter"'), 'form() pre-fills existing title');

// 6. register() wires register_widget on widgets_init.
$GLOBALS['_deepglot_actions']          = [];
$GLOBALS['_deepglot_registered_widgets'] = [];
SwitcherWidget::register();
$widgetsInit = $GLOBALS['_deepglot_actions']['widgets_init'] ?? [];
widgetAssert(count($widgetsInit) === 1, 'register() adds exactly one widgets_init hook');
$widgetsInit[0]();
widgetAssert(
    in_array(SwitcherWidget::class, $GLOBALS['_deepglot_registered_widgets'], true),
    'widgets_init callback calls register_widget(SwitcherWidget::class)'
);

// 7. Disabled plugin → widget prints before/after_widget but the body
// stays empty (no orphan markup).
SwitcherWidget::bind(makeWidgetEnv(['enabled' => false]));
$widgetOff = new SwitcherWidget();
ob_start();
$widgetOff->widget($widgetArgs, ['title' => '']);
$offOutput = ob_get_clean();
widgetAssert(!str_contains($offOutput, '<aside class="deepglot-switcher'), 'Disabled plugin: widget body is empty');

// 8. Issue #57: each widget stores and renders an independent switcher
// instance instead of silently falling back to the global appearance.
SwitcherWidget::bind(makeWidgetEnv([
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
            'id' => 'sidebar-dropdown', 'name' => 'Sidebar', 'enabled' => true,
            'auto_inject' => false, 'style' => 'dropdown', 'flag_style' => 'none',
            'show_label' => true, 'label_format' => 'iso_code', 'language_order' => [],
            'custom_css' => '', 'position' => 'inline', 'responsive_hide' => 'none',
            'responsive_breakpoint' => 768, 'custom_flags' => [], 'selector' => '',
        ],
    ],
]));
$instanceWidget = new SwitcherWidget();
ob_start();
$instanceWidget->widget($widgetArgs, ['title' => '', 'instance_id' => 'sidebar-dropdown']);
$instanceWidgetOutput = ob_get_clean();
widgetAssert(str_contains($instanceWidgetOutput, 'data-deepglot-instance="sidebar-dropdown"'), 'Widget instance_id selects the saved instance');
widgetAssert(str_contains($instanceWidgetOutput, 'deepglot-switcher--dropdown'), 'Widget instance keeps independent dropdown style');
$updatedInstance = $instanceWidget->update(['title' => '', 'instance_id' => 'sidebar-dropdown<script>'], []);
widgetAssert(($updatedInstance['instance_id'] ?? null) === 'sidebar-dropdownscript', 'Widget instance id is sanitized');
ob_start();
$instanceWidget->form(['title' => '', 'instance_id' => 'sidebar-dropdown']);
$instanceForm = ob_get_clean();
widgetAssert(str_contains($instanceForm, 'instance_id'), 'Widget form exposes an instance selector');

fwrite(STDOUT, "WidgetRenderTest: OK\n");
