<?php

/**
 * Brings the WP Nav Menu integration up to Weglot parity. A site owner
 * adds a single "Sprachschalter" placeholder under Appearance → Menus
 * and the frontend expands it into one menu item per configured
 * language, optionally as a dropdown (active language is the parent,
 * alternatives are children) and optionally hiding the current
 * language from the list.
 *
 * Test-first: pins the expansion contract that NavMenuSwitcher must
 * honour so a theme renderer (Walker_Nav_Menu, FSE Navigation block,
 * Avada/Divi/Astra megamenu) all get the same shape.
 *
 * Run standalone: php tests/NavMenuSwitcherTest.php
 */

if (!function_exists('__')) {
    function __($text, $domain = null) { return $text; }
}
if (!function_exists('esc_attr')) {
    function esc_attr($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
    function esc_attr__($text, $domain = null) { return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8'); }
    function esc_html($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
    function esc_url($value) { return (string) $value; }
}
if (!function_exists('add_shortcode')) {
    function add_shortcode($tag, $callback) { $GLOBALS['_deepglot_shortcodes'][$tag] = $callback; }
}
if (!function_exists('add_filter')) {
    $GLOBALS['_deepglot_filters'] = [];
    function add_filter($hook, $callback, $priority = 10, $accepted_args = 1) {
        $GLOBALS['_deepglot_filters'][$hook][] = $callback;
    }
}
if (!function_exists('add_action')) {
    $GLOBALS['_deepglot_actions'] = [];
    function add_action($hook, $callback, $priority = 10, $accepted_args = 1) {
        $GLOBALS['_deepglot_actions'][$hook][] = $callback;
    }
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
require_once __DIR__ . '/../includes/Frontend/NavMenuSwitcher.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\NavMenuSwitcher;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function navAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

/**
 * Build a stand-in for a WP nav menu item — WP passes plain stdClass
 * objects through wp_get_nav_menu_items, so the filter must work
 * against those (not WP_Post instances).
 */
function navItem(int $id, string $title, string $url, array $extra = []): object
{
    $item = (object) array_merge([
        'ID'         => $id,
        'db_id'      => $id,
        'menu_item_parent' => 0,
        'menu_order' => $id,
        'title'      => $title,
        'url'        => $url,
        'type'       => 'custom',
        'object'     => 'custom',
        'post_name'  => '',
        'classes'    => [],
        'xfn'        => '',
        'description' => '',
        'attr_title' => '',
        'target'     => '',
    ], $extra);

    return $item;
}

function navMakeSwitcher(array $overrides = []): NavMenuSwitcher
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

    if (!isset($_SERVER['REQUEST_URI'])) {
        $_SERVER['REQUEST_URI'] = '/';
    }
    if (!isset($_SERVER['HTTP_HOST'])) {
        $_SERVER['HTTP_HOST'] = 'example.com';
    }

    return new NavMenuSwitcher($options, $routing);
}

// 1. The marker item is recognised. NavMenuSwitcher looks for items
// whose post_name (or url anchor) contains "deepglot-switcher".
$switcher = navMakeSwitcher();
$items    = [
    navItem(1, 'Home', '/'),
    navItem(99, 'Sprachschalter', '#deepglot-switcher', ['post_name' => 'deepglot-switcher']),
    navItem(2, 'Contact', '/contact/'),
];
$expanded = $switcher->expand($items);

navAssert(count($expanded) === 5, 'List mode: 1 Home + 3 langs + 1 Contact = 5 items, got ' . count($expanded));
$titles = array_map(fn($i) => $i->title, $expanded);
navAssert($titles[0] === 'Home', 'Home item kept');
navAssert($titles[count($expanded) - 1] === 'Contact', 'Trailing item kept');
$middle = array_slice($titles, 1, 3);
navAssert(in_array('Deutsch', $middle, true), 'Source language Deutsch expanded into menu');
navAssert(in_array('English', $middle, true), 'Target language English expanded');
navAssert(in_array('Français', $middle, true), 'Target language Français expanded');

// 2. Expanded items get proper classes for theme styling.
foreach ($expanded as $item) {
    if (in_array($item->title, ['Deutsch', 'English', 'Français'], true)) {
        navAssert(in_array('menu-item-deepglot', $item->classes, true), 'Expanded item has menu-item-deepglot class: ' . $item->title);
        navAssert(in_array('deepglot-lang', $item->classes, true), 'Expanded item has deepglot-lang class: ' . $item->title);
    }
}

// 3. Active language gets the current-menu-item class so existing themes
// highlight it just like a normal active page.
$_SERVER['REQUEST_URI'] = '/en/';
$switcher2 = navMakeSwitcher();
$expanded2 = $switcher2->expand([
    navItem(1, 'Sprachschalter', '#deepglot-switcher', ['post_name' => 'deepglot-switcher']),
]);
$activeItem = null;
foreach ($expanded2 as $item) {
    if (in_array('current-menu-item', $item->classes, true)) {
        $activeItem = $item;
    }
}
navAssert($activeItem !== null, 'Active language must get current-menu-item class');
navAssert($activeItem->title === 'English', 'Active language is English when REQUEST_URI is /en/');

// 4. Dropdown mode wraps alternatives under the active language as
// children (menu_item_parent matches the marker id).
$_SERVER['REQUEST_URI'] = '/';
$switcher3 = navMakeSwitcher();
$items3    = [
    navItem(50, 'Sprachschalter', '#deepglot-switcher', [
        'post_name' => 'deepglot-switcher',
        'classes'   => ['deepglot-mode-dropdown'],
    ]),
];
$expanded3 = $switcher3->expand($items3);
$parents   = array_filter($expanded3, fn($i) => (int) $i->menu_item_parent === 0);
$children  = array_filter($expanded3, fn($i) => (int) $i->menu_item_parent === 50);
navAssert(count($parents) === 1, 'Dropdown mode: exactly one top-level item (the active language)');
navAssert(count($children) === 2, 'Dropdown mode: alternatives become children, got ' . count($children));
$parent = array_values($parents)[0];
navAssert($parent->title === 'Deutsch', 'Dropdown parent is the active language (Deutsch on /)');

// 5. hide_current mode drops the active language from the list entirely
// — useful when the switcher only shows alternatives.
$switcher4 = navMakeSwitcher();
$items4    = [
    navItem(60, 'Sprachschalter', '#deepglot-switcher', [
        'post_name' => 'deepglot-switcher',
        'classes'   => ['deepglot-hide-current'],
    ]),
];
$expanded4 = $switcher4->expand($items4);
navAssert(count($expanded4) === 2, 'hide_current: only non-active langs render, got ' . count($expanded4));
$expandedTitles4 = array_map(fn($i) => $i->title, $expanded4);
navAssert(!in_array('Deutsch', $expandedTitles4, true), 'Active language Deutsch hidden');
navAssert(in_array('English', $expandedTitles4, true), 'Alternative English shown');
navAssert(in_array('Français', $expandedTitles4, true), 'Alternative Français shown');

// 6. Both flags together: hide_current + dropdown means the top-level is
// "Sprache wählen" (or similar) and children are the alternatives.
$switcher5 = navMakeSwitcher();
$items5    = [
    navItem(70, 'Sprachschalter', '#deepglot-switcher', [
        'post_name' => 'deepglot-switcher',
        'classes'   => ['deepglot-mode-dropdown', 'deepglot-hide-current'],
    ]),
];
$expanded5 = $switcher5->expand($items5);
$parents5  = array_filter($expanded5, fn($i) => (int) $i->menu_item_parent === 0);
$children5 = array_filter($expanded5, fn($i) => (int) $i->menu_item_parent === 70);
navAssert(count($parents5) === 1, 'hide_current+dropdown still produces exactly one parent');
navAssert(count($children5) === 2, 'hide_current+dropdown: 2 children (alternatives only)');

// 7. URL is rewritten to the language-prefixed canonical path.
$switcher6 = navMakeSwitcher();
$expanded6 = $switcher6->expand([
    navItem(80, 'Sprachschalter', '#deepglot-switcher', ['post_name' => 'deepglot-switcher']),
]);
foreach ($expanded6 as $item) {
    if ($item->title === 'English') {
        navAssert(strpos($item->url, '/en/') === 0 || str_contains($item->url, '/en/'), 'English URL has /en/ prefix: ' . $item->url);
    }
    if ($item->title === 'Français') {
        navAssert(strpos($item->url, '/fr/') === 0 || str_contains($item->url, '/fr/'), 'Français URL has /fr/ prefix: ' . $item->url);
    }
    if ($item->title === 'Deutsch') {
        navAssert(strpos($item->url, '/de/') === false, 'Source language Deutsch has no /de/ prefix: ' . $item->url);
    }
}

// 8. auto_redirect on → links get the ?deepglot-explicit=1 marker so
// BrowserRedirector knows the user picked the language explicitly.
$switcher7 = navMakeSwitcher(['auto_redirect' => true]);
$expanded7 = $switcher7->expand([
    navItem(90, 'Sprachschalter', '#deepglot-switcher', ['post_name' => 'deepglot-switcher']),
]);
$langItems = array_filter($expanded7, fn($i) => in_array('deepglot-lang', $i->classes, true));
foreach ($langItems as $item) {
    navAssert(strpos($item->url, 'deepglot-explicit=1') !== false, 'auto_redirect: url has explicit marker: ' . $item->url);
}

// 9. Non-marker items pass through untouched.
$untouched = $switcher->expand([
    navItem(1, 'About', '/about/'),
    navItem(2, 'Contact', '/contact/'),
]);
navAssert(count($untouched) === 2, 'No marker items → list unchanged');
navAssert($untouched[0]->title === 'About', 'Non-marker item About kept');
navAssert($untouched[1]->title === 'Contact', 'Non-marker item Contact kept');

// 10. Marker recognition is robust: URL ending with #deepglot-switcher is
// enough, even if post_name is empty (covers items added via Custom Link
// since WP can omit post_name for those).
$switcher8 = navMakeSwitcher();
$expanded8 = $switcher8->expand([
    navItem(100, 'Sprachschalter', '#deepglot-switcher'),
]);
navAssert(count($expanded8) === 3, 'URL-anchor marker also triggers expansion (3 langs, got ' . count($expanded8) . ')');

// 11. Disabled plugin → marker passes through untouched (don't surface
// orphan placeholder to visitors).
$switcher9 = navMakeSwitcher(['enabled' => false]);
$expanded9 = $switcher9->expand([
    navItem(110, 'Sprachschalter', '#deepglot-switcher', ['post_name' => 'deepglot-switcher']),
]);
navAssert(count($expanded9) === 0, 'Disabled plugin: marker item is removed (no orphan placeholder visible to visitors)');

fwrite(STDOUT, "NavMenuSwitcherTest: OK\n");
