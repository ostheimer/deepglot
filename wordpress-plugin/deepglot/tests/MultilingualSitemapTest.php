<?php

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
if (!function_exists('nocache_headers')) {
    $GLOBALS['_deepglot_sitemap_nocache_calls'] = 0;
    function nocache_headers() { $GLOBALS['_deepglot_sitemap_nocache_calls']++; }
}
if (!function_exists('get_query_var')) {
    function get_query_var($key, $default = '') { return $GLOBALS['_deepglot_sitemap_query'][$key] ?? $default; }
}
if (!function_exists('get_post_types')) {
    $GLOBALS['_deepglot_sitemap_post_type_queries'] = [];
    $GLOBALS['_deepglot_sitemap_taxonomy_queries'] = [];
    $GLOBALS['_deepglot_sitemap_post_queries'] = [];
    $GLOBALS['_deepglot_sitemap_term_queries'] = [];

    function get_post_types($args = [], $output = 'names') {
        $GLOBALS['_deepglot_sitemap_post_type_queries'][] = $args;
        $types = [
            'post' => ['public' => true, 'publicly_queryable' => true],
            'page' => ['public' => true, 'publicly_queryable' => true],
            'attachment' => ['public' => true, 'publicly_queryable' => true],
            'builder-template' => ['public' => true, 'publicly_queryable' => false],
        ];

        return array_keys(array_filter($types, static function (array $properties) use ($args): bool {
            foreach ($args as $property => $expected) {
                if (($properties[$property] ?? null) !== $expected) {
                    return false;
                }
            }

            return true;
        }));
    }

    function get_posts($args = []) {
        $GLOBALS['_deepglot_sitemap_post_queries'][] = $args['post_type'] ?? '';

        return [11, 12, 13];
    }
    function get_permalink($postId) {
        if ($postId === 12) return 'https://evil.example/phishing/';
        if ($postId === 13) return 'javascript:alert(1)';
        return 'https://example.com/news/?topic=a&sort=1';
    }
    function get_post_modified_time($format, $gmt, $postId) { return '2026-07-13T08:00:00+00:00'; }
    function get_taxonomies($args = [], $output = 'names') {
        $GLOBALS['_deepglot_sitemap_taxonomy_queries'][] = $args;
        $taxonomies = [
            'category' => ['public' => true, 'publicly_queryable' => true],
            'element_category' => ['public' => true, 'publicly_queryable' => false],
            'slide-page' => ['public' => true, 'publicly_queryable' => false],
        ];

        return array_keys(array_filter($taxonomies, static function (array $properties) use ($args): bool {
            foreach ($args as $property => $expected) {
                if (($properties[$property] ?? null) !== $expected) {
                    return false;
                }
            }

            return true;
        }));
    }

    function get_terms($args = []) {
        $GLOBALS['_deepglot_sitemap_term_queries'][] = $args['taxonomy'] ?? '';
        if (($args['taxonomy'] ?? '') === 'element_category') return [(object) ['term_id' => 23]];
        if (($args['taxonomy'] ?? '') === 'slide-page') return [(object) ['term_id' => 24]];
        return [(object) ['term_id' => 21], (object) ['term_id' => 22]];
    }
    function get_term_link($term) {
        if ($term->term_id === 21) return 'https://example.com/category/tipps/';
        if ($term->term_id === 23) return 'https://example.com/element_category/sections/';
        if ($term->term_id === 24) return 'https://example.com/slide-page/juvenis-infoscreen/';
        return 'https://tracker.example/category/ads/';
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

function makeSitemap(string $mode = 'PATH_PREFIX', array $mappings = [], array $slugMappings = []): MultilingualSitemap
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
    $routing = new SiteRouting(new UrlLanguageResolver('de', ['en', 'fr']), 'https://example.com', $mode, $mappings, $slugMappings);
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
sitemapAssert(
    ($GLOBALS['_deepglot_sitemap_filters']['robots_txt'][0][1] ?? 0) > 99999,
    'Sitemap discovery runs after late robots.txt renderers such as Yoast SEO'
);
$pathSitemap->addRewriteRules();
sitemapAssert(($GLOBALS['_deepglot_sitemap_rewrites'][0][0] ?? '') === '^deepglot-sitemap\.xml$', 'Dedicated sitemap rewrite is exact');
$robots = $pathSitemap->filterRobotsTxt("User-agent: *\n", true);
sitemapAssert(
    ($GLOBALS['_deepglot_sitemap_nocache_calls'] ?? 0) === 1,
    'robots.txt disables intermediary caching so plugin updates cannot leave a stale discovery response live'
);
sitemapAssert(substr_count($robots, 'Sitemap: https://example.com/deepglot-sitemap.xml') === 1, 'robots.txt advertises the sitemap exactly once');
sitemapAssert(substr_count($pathSitemap->filterRobotsTxt($robots, true), 'deepglot-sitemap.xml') === 1, 'robots.txt filter does not duplicate an existing line');

// 2. Collection admits only real internal WordPress URLs; filter-manipulated
// external or script URLs never enter the source set.
$collected = $pathSitemap->collectSourceEntries();
$collectedJson = json_encode($collected, JSON_UNESCAPED_SLASHES);
sitemapAssert(str_contains($collectedJson, 'example.com/news'), 'Published internal permalink is collected');
sitemapAssert(str_contains($collectedJson, 'example.com/category/tipps'), 'Internal public taxonomy term is collected');
sitemapAssert(!str_contains($collectedJson, '/slide-page/'), 'Builder-internal slide pages are excluded from the multilingual sitemap');
sitemapAssert(!str_contains($collectedJson, '/element_category/'), 'Builder-internal element categories are excluded from the multilingual sitemap');
sitemapAssert(
    $GLOBALS['_deepglot_sitemap_post_type_queries'][0] === ['public' => true, 'publicly_queryable' => true],
    'Discovery requires public and publicly queryable post types.'
);
sitemapAssert(
    $GLOBALS['_deepglot_sitemap_taxonomy_queries'][0] === ['public' => true, 'publicly_queryable' => true],
    'Discovery requires public and publicly queryable taxonomies.'
);
sitemapAssert(
    in_array('post', $GLOBALS['_deepglot_sitemap_post_queries'], true)
        && !in_array('builder-template', $GLOBALS['_deepglot_sitemap_post_queries'], true),
    'Non-queryable public post types are never queried while ordinary posts remain discoverable.'
);
sitemapAssert(
    in_array('category', $GLOBALS['_deepglot_sitemap_term_queries'], true)
        && !in_array('element_category', $GLOBALS['_deepglot_sitemap_term_queries'], true)
        && !in_array('slide-page', $GLOBALS['_deepglot_sitemap_term_queries'], true),
    'Non-queryable public taxonomies are never queried while ordinary categories remain discoverable.'
);
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

// 3b. Search engines need one <url><loc> entry per language version. Every
// version must publish the exact same reciprocal alternate set, including
// translated slugs, so no page is left out of the cluster.
$translatedSitemap = makeSitemap('PATH_PREFIX', [], [
    'en' => ['produkte' => 'products', 'zahnbehandlung' => 'dental-treatment'],
    'fr' => ['produkte' => 'produits', 'zahnbehandlung' => 'soins-dentaires'],
]);
$translatedXml = $translatedSitemap->buildXml([
    ['loc' => 'https://example.com/produkte/zahnbehandlung/', 'lastmod' => '2026-07-13'],
    // A still-published, paired WPML target object must collapse into the
    // same Deepglot cluster instead of duplicating all localized entries.
    ['loc' => 'https://example.com/en/products/dental-treatment/', 'lastmod' => '2026-07-13'],
]);
$translatedDoc = new DOMDocument();
sitemapAssert($translatedDoc->loadXML($translatedXml) === true, 'Translated-slug sitemap is well-formed XML');
$translatedXpath = new DOMXPath($translatedDoc);
$translatedXpath->registerNamespace('s', 'http://www.sitemaps.org/schemas/sitemap/0.9');
$translatedXpath->registerNamespace('xhtml', 'http://www.w3.org/1999/xhtml');
$urlNodes = $translatedXpath->query('//s:url');
sitemapAssert($urlNodes !== false && $urlNodes->length === 3, 'Sitemap emits a separate <url> entry for source and every target language.');

$expectedLocs = [
    'https://example.com/produkte/zahnbehandlung/',
    'https://example.com/en/products/dental-treatment/',
    'https://example.com/fr/produits/soins-dentaires/',
];
$expectedAlternates = [
    'de' => 'https://example.com/produkte/zahnbehandlung/',
    'en' => 'https://example.com/en/products/dental-treatment/',
    'fr' => 'https://example.com/fr/produits/soins-dentaires/',
    'x-default' => 'https://example.com/produkte/zahnbehandlung/',
];
$actualLocs = [];
foreach ($urlNodes as $urlNode) {
    $locNode = $translatedXpath->query('./s:loc', $urlNode)?->item(0);
    $actualLocs[] = $locNode?->textContent ?? '';
    $alternateSet = [];
    $alternateNodes = $translatedXpath->query('./xhtml:link[@rel="alternate"]', $urlNode);
    foreach ($alternateNodes ?: [] as $alternateNode) {
        if ($alternateNode instanceof DOMElement) {
            $alternateSet[$alternateNode->getAttribute('hreflang')] = $alternateNode->getAttribute('href');
        }
    }
    sitemapAssert($alternateSet === $expectedAlternates, 'Every localized <url> entry has an identical reciprocal alternate set.');
}
sort($actualLocs);
sort($expectedLocs);
sitemapAssert($actualLocs === $expectedLocs, 'Localized <loc> entries include every translated slug exactly once.');

// 4. Subdomain routing uses only configured language hosts. A target without
// a mapping follows SiteRouting's safe path-prefix fallback on the source host.
$subdomainSitemap = makeSitemap('SUBDOMAIN', ['en' => 'en.example.com']);
$subdomainXml = $subdomainSitemap->buildXml([['loc' => 'https://example.com/angebote/']]);
sitemapAssert(str_contains($subdomainXml, 'href="https://en.example.com/angebote/"'), 'Mapped target uses its configured subdomain');
sitemapAssert(str_contains($subdomainXml, 'href="https://example.com/fr/angebote/"'), 'Unmapped active target uses safe path-prefix fallback');
sitemapAssert(!str_contains($subdomainXml, 'example.com/en/angebote/'), 'Mapped subdomain is not also path-prefixed');

// 4b. A target-subdomain entry may arrive before its source counterpart (for
// example from a legacy WPML inventory). Host-based language detection must
// happen before canonicalizing translated slugs, otherwise /products/ is
// incorrectly published as a new source cluster and suppresses /produkte/.
$targetFirstSubdomainSitemap = makeSitemap(
    'SUBDOMAIN',
    ['en' => 'en.example.com'],
    ['en' => ['produkte' => 'products']]
);
$targetFirstSubdomainXml = $targetFirstSubdomainSitemap->buildXml([
    ['loc' => 'https://en.example.com/products/'],
    ['loc' => 'https://example.com/produkte/'],
]);
$targetFirstDoc = new DOMDocument();
sitemapAssert($targetFirstDoc->loadXML($targetFirstSubdomainXml) === true, 'Target-first subdomain sitemap is well-formed XML');
$targetFirstXpath = new DOMXPath($targetFirstDoc);
$targetFirstXpath->registerNamespace('s', 'http://www.sitemaps.org/schemas/sitemap/0.9');
$targetFirstLocNodes = $targetFirstXpath->query('//s:url/s:loc');
$targetFirstLocs = [];
foreach ($targetFirstLocNodes ?: [] as $targetFirstLocNode) {
    $targetFirstLocs[] = $targetFirstLocNode->textContent;
}
$expectedTargetFirstLocs = [
    'https://example.com/produkte/',
    'https://en.example.com/products/',
    'https://example.com/fr/produkte/',
];
sort($targetFirstLocs);
sort($expectedTargetFirstLocs);
sitemapAssert(
    $targetFirstLocs === $expectedTargetFirstLocs,
    'Target-first subdomain entries canonicalize through their host language into one correct localized cluster.'
);
sitemapAssert(
    !str_contains($targetFirstSubdomainXml, 'https://example.com/products/'),
    'Translated target slugs must never leak onto the source host.'
);

fwrite(STDOUT, "MultilingualSitemapTest: OK\n");
