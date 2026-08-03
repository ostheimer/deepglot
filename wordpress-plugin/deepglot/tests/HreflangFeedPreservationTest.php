<?php

/**
 * Regression coverage for source-page hreflang replacement.
 *
 * Existing language alternates may come from WPML and should be replaced by
 * Deepglot, while unrelated RSS/Atom discovery links must remain in <head>.
 */

function hreflangFeedAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

if (!function_exists('__')) {
    function __($text, $domain = null) { return $text; }
}
if (!function_exists('home_url')) {
    function home_url($path = '/') { return 'https://example.com' . $path; }
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
    if (!defined('DAY_IN_SECONDS')) define('DAY_IN_SECONDS', 86400);
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/HreflangInjector.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\HreflangInjector;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));

$routing = new SiteRouting(
    new UrlLanguageResolver('de', ['en']),
    'https://example.com',
    'PATH_PREFIX',
    [],
    ['en' => ['produkte' => 'products']]
);
$injector = new HreflangInjector(new Options(), $routing);
$doc = new DOMDocument();
$doc->loadHTML(
    '<!doctype html><html><head>'
    . '<link rel="alternate" type="application/rss+xml" title="News Feed" href="https://example.com/feed/">'
    . '<link rel="alternate" type="application/rss+xml" hreflang="en" title="English News Feed" href="https://example.com/en/feed/">'
    . '<link rel="alternate\tsearch" type="application/atom+xml; charset=UTF-8" hreflang="de" title="Atom Feed" href="https://example.com/atom.xml">'
    . '<link rel="alternate" hreflang="de" href="https://example.com/legacy-source/">'
    . '<link rel="ALTERNATE" hreflang="en" href="https://example.com/en/legacy-target/">'
    . '<link rel="next  ALTERNATE" hreflang="it" href="https://example.com/legacy-token-target/">'
    . '</head><body></body></html>',
    LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
);

$injector->inject($doc, '/produkte/');
$html = $doc->saveHTML();

hreflangFeedAssert(
    str_contains($html, 'title="News Feed"') && str_contains($html, 'href="https://example.com/feed/"'),
    'RSS/feed rel=alternate links without hreflang must survive Deepglot injection.'
);
hreflangFeedAssert(
    str_contains($html, 'title="English News Feed"') && str_contains($html, 'href="https://example.com/en/feed/"'),
    'Localized RSS discovery links must survive even when they carry hreflang.'
);
hreflangFeedAssert(
    str_contains($html, 'title="Atom Feed"') && str_contains($html, 'href="https://example.com/atom.xml"'),
    'Atom discovery links with rel token whitespace/case and hreflang must survive.'
);
hreflangFeedAssert(substr_count($html, 'hreflang="x-default"') === 1, 'x-default must be emitted exactly once.');
hreflangFeedAssert(str_contains($html, 'href="https://example.com/produkte/"'), 'Replacement source hreflang must be emitted.');
hreflangFeedAssert(str_contains($html, 'href="https://example.com/en/products/"'), 'Replacement hreflang must include translated target slugs.');
hreflangFeedAssert(
    !str_contains($html, 'legacy-source')
    && !str_contains($html, 'legacy-target')
    && !str_contains($html, 'legacy-token-target'),
    'Only stale page-language alternates are removed, including mixed-case rel token lists.'
);

fwrite(STDOUT, "HreflangFeedPreservationTest: OK\n");
