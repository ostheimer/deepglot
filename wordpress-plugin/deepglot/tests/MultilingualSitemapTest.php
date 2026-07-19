<?php

if (!function_exists('wp_parse_url')) {
    function wp_parse_url($url, $component = -1)
    {
        return parse_url($url, $component);
    }
}

/**
 * Regression contract for issue #58 multilingual sitemap support.
 */

function sitemapAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

if (!function_exists('__')) {
    function __($text, $domain = null) { return $text; }
}
if (!function_exists('add_action')) {
    $GLOBALS['_deepglot_sitemap_actions'] = [];
    $GLOBALS['_deepglot_sitemap_filters'] = [];
    function add_action($hook, $callback, $priority = 10, $accepted_args = 1) { $GLOBALS['_deepglot_sitemap_actions'][$hook][] = [$callback, $priority, $accepted_args]; }
    function add_filter($hook, $callback, $priority = 10, $accepted_args = 1) { $GLOBALS['_deepglot_sitemap_filters'][$hook][] = [$callback, $priority, $accepted_args]; }
}
if (!function_exists('apply_filters')) {
    function apply_filters($hook, $value) {
        if ($hook !== 'deepglot_multilingual_sitemap_entries') return $value;
        return array_merge((array) $value, (array) ($GLOBALS['_deepglot_sitemap_injected_entries'] ?? []));
    }
}
if (!function_exists('add_rewrite_rule')) {
    $GLOBALS['_deepglot_sitemap_rewrites'] = [];
    function add_rewrite_rule($regex, $query, $after = 'bottom') { $GLOBALS['_deepglot_sitemap_rewrites'][] = [$regex, $query, $after]; }
    function add_rewrite_tag($tag, $regex) { $GLOBALS['_deepglot_sitemap_rewrites'][] = [$tag, $regex, 'tag']; }
}
if (!function_exists('home_url')) {
    function home_url($path = '/') { return 'https://example.com' . $path; }
}
if (!function_exists('get_query_var')) {
    function get_query_var($key, $default = '') { return $GLOBALS['_deepglot_sitemap_query'][$key] ?? $default; }
}
if (!function_exists('get_post_types')) {
    function get_post_types($args = [], $output = 'names') { return ['post', 'page', 'attachment']; }
    function get_posts($args = []) { return [11, 12, 13]; }
    function get_permalink($postId) {
        if ($postId === 12) return 'https://evil.example/phishing/';
        if ($postId === 13) return 'javascript:alert(1)';
        return 'https://example.com/news/?topic=a&sort=1';
    }
    function get_post_modified_time($format, $gmt, $postId) { return '2026-07-13T08:00:00+00:00'; }
    function get_taxonomies($args = [], $output = 'names') { return ['category']; }
    function get_terms($args = []) { return [(object) ['term_id' => 21], (object) ['term_id' => 22]]; }
    function get_term_link($term) { return $term->term_id === 21 ? 'https://example.com/category/tipps/' : 'https://tracker.example/category/ads/'; }
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

$sitemapPath = __DIR__ . '/../includes/Frontend/MultilingualSitemap.php';
sitemapAssert(file_exists($sitemapPath), 'Issue #58 requires Frontend/MultilingualSitemap.php');

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once $sitemapPath;

use Deepglot\Config\Options;
use Deepglot\Frontend\MultilingualSitemap;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function makeSitemap(string $mode = 'PATH_PREFIX', array $mappings = []): MultilingualSitemap
{
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => 'dg_test_key',
        'source_language' => 'de',
        'target_languages' => ['en', 'fr'],
        'routing_mode' => $mode,
        'domain_mappings' => $mappings,
    ]));
    $options = new Options();
    $routing = new SiteRouting(new UrlLanguageResolver('de', ['en', 'fr']), 'https://example.com', $mode, $mappings);
    return new MultilingualSitemap($options, $routing);
}

// 1. Registration exposes a dedicated endpoint before the HTML buffer and a
// robots.txt discovery line.
$pathSitemap = makeSitemap();
$pathSitemap->register();
sitemapAssert(isset($GLOBALS['_deepglot_sitemap_actions']['init']), 'Sitemap registers its rewrite endpoint');
sitemapAssert(($GLOBALS['_deepglot_sitemap_actions']['template_redirect'][0][1] ?? 0) < 0, 'Sitemap renders before the HTML OutputBuffer');
sitemapAssert(isset($GLOBALS['_deepglot_sitemap_filters']['query_vars']), 'Sitemap registers its query var');
sitemapAssert(isset($GLOBALS['_deepglot_sitemap_filters']['robots_txt']), 'Sitemap is discoverable from robots.txt');
$pathSitemap->addRewriteRules();
sitemapAssert(($GLOBALS['_deepglot_sitemap_rewrites'][0][0] ?? '') === '^deepglot-sitemap\.xml$', 'Dedicated sitemap rewrite is exact');
$robots = $pathSitemap->filterRobotsTxt("User-agent: *\n", true);
sitemapAssert(substr_count($robots, 'Sitemap: https://example.com/deepglot-sitemap.xml') === 1, 'robots.txt advertises the sitemap exactly once');
sitemapAssert(substr_count($pathSitemap->filterRobotsTxt($robots, true), 'deepglot-sitemap.xml') === 1, 'robots.txt filter does not duplicate an existing line');

// 2. Collection admits only real internal WordPress URLs; filter-manipulated
// external or script URLs never enter the source set.
$collected = $pathSitemap->collectSourceEntries();
$collectedJson = json_encode($collected, JSON_UNESCAPED_SLASHES);
sitemapAssert(str_contains($collectedJson, 'example.com/news'), 'Published internal permalink is collected');
sitemapAssert(str_contains($collectedJson, 'example.com/category/tipps'), 'Internal public taxonomy term is collected');
sitemapAssert(!str_contains($collectedJson, 'evil.example'), 'External filtered permalink is rejected');
sitemapAssert(!str_contains($collectedJson, 'tracker.example'), 'External filtered term link is rejected');
sitemapAssert(!str_contains($collectedJson, 'javascript:'), 'Non-HTTP URLs are rejected');

// 2b. Third-party filters can add internal entries, but cannot smuggle an
// external URL or a relative/free-form value into the sitemap lastmod field.
$GLOBALS['_deepglot_sitemap_injected_entries'] = [
    ['loc' => 'https://example.com/filter-relative/', 'lastmod' => 'tomorrow'],
    ['loc' => 'https://example.com/filter-garbage/', 'lastmod' => 'not-a-date'],
    ['loc' => 'https://example.com/filter-date/', 'lastmod' => '2026-07-13'],
    ['loc' => 'https://external.example/filter/', 'lastmod' => '2026-07-13'],
];
$filteredEntries = $pathSitemap->collectSourceEntries();
$filteredXml = $pathSitemap->buildXml($filteredEntries);
sitemapAssert(str_contains($filteredXml, 'filter-relative') && str_contains($filteredXml, 'filter-garbage'), 'Internal filter-injected URLs remain eligible');
sitemapAssert(!str_contains($filteredXml, '<lastmod>tomorrow</lastmod>'), 'Relative lastmod values are rejected');
sitemapAssert(!str_contains($filteredXml, '<lastmod>not-a-date</lastmod>'), 'Malformed lastmod values are rejected');
sitemapAssert(str_contains($filteredXml, '<lastmod>2026-07-13</lastmod>'), 'W3C date-only lastmod remains valid');
sitemapAssert(!str_contains($filteredXml, 'external.example'), 'Filter injection cannot add an external URL');
$GLOBALS['_deepglot_sitemap_injected_entries'] = [];

// 2c. URLs intentionally excluded from translation must not advertise
// translated alternates that the output pipeline will never produce.
$excludedSettings = $GLOBALS['_deepglot_options'][Options::OPTION_KEY];
$excludedSettings['exclude_urls'] = '/private/*';
update_option(Options::OPTION_KEY, $excludedSettings);
$excludedXml = $pathSitemap->buildXml([
    ['loc' => 'https://example.com/private/account/'],
    ['loc' => 'https://example.com/public/about/'],
]);
sitemapAssert(!str_contains($excludedXml, '/private/account/'), 'Translation-excluded URLs are omitted from the multilingual sitemap');
sitemapAssert(str_contains($excludedXml, '/public/about/'), 'Non-excluded internal URLs remain in the multilingual sitemap');
$excludedSettings['exclude_urls'] = '';
update_option(Options::OPTION_KEY, $excludedSettings);

// 3. Path-prefix mode emits source, each active target and x-default. Query
// strings are retained and XML-escaped exactly once.
$xml = $pathSitemap->buildXml([
    ['loc' => 'https://example.com/news/?topic=a&sort=1', 'lastmod' => '2026-07-13T08:00:00+00:00'],
    ['loc' => 'https://evil.example/injected/'],
    ['loc' => 'javascript:alert(1)'],
]);
sitemapAssert(str_contains($xml, 'xmlns:xhtml="http://www.w3.org/1999/xhtml"'), 'Sitemap declares the XHTML alternate-link namespace');
sitemapAssert(str_contains($xml, 'https://example.com/en/news/?topic=a&amp;sort=1'), 'Path-prefix English alternate is valid and XML escaped');
sitemapAssert(str_contains($xml, 'https://example.com/fr/news/?topic=a&amp;sort=1'), 'Path-prefix French alternate is valid and XML escaped');
sitemapAssert(str_contains($xml, 'hreflang="de"'), 'Source-language alternate is present');
sitemapAssert(str_contains($xml, 'hreflang="x-default"'), 'x-default points at the source URL');
sitemapAssert(!str_contains($xml, 'evil.example') && !str_contains($xml, 'javascript:'), 'Unsafe source URLs cannot leak into XML');
$doc = new DOMDocument();
sitemapAssert($doc->loadXML($xml) === true, 'Generated sitemap is well-formed XML');

// 4. Subdomain routing uses only configured language hosts. A target without
// a mapping follows SiteRouting's safe path-prefix fallback on the source host.
$subdomainSitemap = makeSitemap('SUBDOMAIN', ['en' => 'en.example.com']);
$subdomainXml = $subdomainSitemap->buildXml([['loc' => 'https://example.com/angebote/']]);
sitemapAssert(str_contains($subdomainXml, 'href="https://en.example.com/angebote/"'), 'Mapped target uses its configured subdomain');
sitemapAssert(str_contains($subdomainXml, 'href="https://example.com/fr/angebote/"'), 'Unmapped active target uses safe path-prefix fallback');
sitemapAssert(!str_contains($subdomainXml, 'example.com/en/angebote/'), 'Mapped subdomain is not also path-prefixed');

fwrite(STDOUT, "MultilingualSitemapTest: OK\n");
