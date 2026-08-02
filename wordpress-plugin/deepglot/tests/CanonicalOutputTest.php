<?php

/**
 * Canonical SEO regression coverage for the output-buffer pipeline.
 *
 * Deepglot must provide one absolute self-canonical when WordPress/its SEO
 * plugins do not render one. An existing SEO-plugin canonical remains the
 * owner of that element and must be localized without adding a duplicate.
 */

function canonicalOutputAssert(bool $condition, string $message): void
{
    if (!$condition) {
        $GLOBALS['_canonical_output_failures'][] = $message;
    }
}

$GLOBALS['_canonical_output_failures'] = [];

if (!function_exists('__')) {
    function __($text, $domain = null) { return $text; }
}
if (!function_exists('home_url')) {
    function home_url($path = '/') { return 'https://example.com' . $path; }
}
if (!function_exists('add_query_arg')) {
    function add_query_arg() {
        $args = func_get_args();
        $url = end($args);
        return is_string($url) ? $url : '/';
    }
}
if (!function_exists('wp_doing_ajax')) {
    function wp_doing_ajax() { return false; }
}
if (!function_exists('wp_is_json_request')) {
    function wp_is_json_request() { return false; }
}
if (!function_exists('is_admin')) {
    function is_admin() { return false; }
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
    if (!defined('YEAR_IN_SECONDS')) define('YEAR_IN_SECONDS', 31536000);
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Support/BotDetector.php';
require_once __DIR__ . '/../includes/Frontend/JsonLdTranslator.php';
require_once __DIR__ . '/../includes/Support/HtmlDocument.php';
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';
require_once __DIR__ . '/../includes/Frontend/LinkRewriter.php';
require_once __DIR__ . '/../includes/Frontend/HreflangInjector.php';
require_once __DIR__ . '/../includes/Frontend/RequestRouter.php';
require_once __DIR__ . '/../includes/Frontend/OutputBuffer.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\HreflangInjector;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Frontend\LinkRewriter;
use Deepglot\Frontend\OutputBuffer;
use Deepglot\Frontend\RequestRouter;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

class CanonicalOutputTranslator extends HtmlTranslator
{
    public function __construct() {}

    public function translate(string $html, string $targetLanguage, string $requestUrl = '', int $bot = 0): string
    {
        return $html;
    }
}

/** @return DOMElement[] */
function canonicalOutputLinks(string $html): array
{
    $doc = new DOMDocument();
    libxml_use_internal_errors(true);
    $doc->loadHTML($html, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOWARNING | LIBXML_NOERROR);
    libxml_clear_errors();

    $canonicals = [];
    foreach ($doc->getElementsByTagName('link') as $link) {
        if (!$link instanceof DOMElement) {
            continue;
        }

        $tokens = preg_split('/\s+/u', strtolower(trim($link->getAttribute('rel')))) ?: [];
        if (in_array('canonical', $tokens, true)) {
            $canonicals[] = $link;
        }
    }

    return $canonicals;
}

update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));

$options = new Options();
$resolver = new UrlLanguageResolver('de', ['en']);
$routing = new SiteRouting(
    $resolver,
    'https://example.com',
    'PATH_PREFIX',
    [],
    ['en' => ['produkte' => 'products']]
);
$buffer = new OutputBuffer(
    $options,
    $resolver,
    new CanonicalOutputTranslator(),
    new LinkRewriter($routing),
    new HreflangInjector($options, $routing),
    new RequestRouter($options, $routing),
    $routing
);

$withoutCanonical = '<!doctype html><html lang="de"><head><title>Produkte</title></head><body></body></html>';

$_SERVER['HTTP_HOST'] = 'example.com';
$_SERVER['REQUEST_URI'] = '/produkte/';
$source = $buffer->processSource($withoutCanonical);
$sourceCanonicals = canonicalOutputLinks($source);
canonicalOutputAssert(count($sourceCanonicals) === 1, 'Source output must contain exactly one canonical link when no SEO plugin emits one.');
canonicalOutputAssert(
    $sourceCanonicals[0]->getAttribute('href') === 'https://example.com/produkte/',
    'Source output canonical must point to the absolute source URL.'
);

$_SERVER['REQUEST_URI'] = '/en/products/';
$target = $buffer->process($withoutCanonical, 'en');
$targetCanonicals = canonicalOutputLinks($target);
canonicalOutputAssert(count($targetCanonicals) === 1, 'Target output must contain exactly one canonical link when no SEO plugin emits one.');
canonicalOutputAssert(
    $targetCanonicals[0]->getAttribute('href') === 'https://example.com/en/products/',
    'Target output canonical must include the active language and translated URL slug.'
);

$withSeoCanonical = '<!doctype html><html lang="de"><head>'
    . '<link rel="  CANONICAL  " href="https://example.com/produkte/" data-seo-provider="yoast">'
    . '<title>Produkte</title></head><body></body></html>';
$localizedSeoOutput = $buffer->process($withSeoCanonical, 'en');
$localizedSeoCanonicals = canonicalOutputLinks($localizedSeoOutput);
canonicalOutputAssert(count($localizedSeoCanonicals) === 1, 'Deepglot must not duplicate an existing SEO-plugin canonical.');
canonicalOutputAssert(
    $localizedSeoCanonicals[0]->getAttribute('href') === 'https://example.com/en/products/',
    'Existing internal SEO-plugin canonical must be localized to the active target URL.'
);
canonicalOutputAssert(
    $localizedSeoCanonicals[0]->getAttribute('data-seo-provider') === 'yoast',
    'Deepglot must preserve the existing SEO-plugin canonical element.'
);

$combinedCanonical = '<!doctype html><html lang="de"><head>'
    . '<link rel="canonical alternate" hreflang="en" href="https://example.com/produkte/" data-seo-provider="combined">'
    . '<title>Produkte</title></head><body></body></html>';
$_SERVER['REQUEST_URI'] = '/produkte/';
$cleanedCombinedOutput = $buffer->processSource($combinedCanonical);
$cleanedCombinedCanonicals = canonicalOutputLinks($cleanedCombinedOutput);
canonicalOutputAssert(
    count($cleanedCombinedCanonicals) === 1,
    'Removing stale hreflang metadata must not remove a canonical relation carried by the same link element.'
);
if (isset($cleanedCombinedCanonicals[0])) {
    $combinedTokens = preg_split(
        '/\s+/u',
        strtolower(trim($cleanedCombinedCanonicals[0]->getAttribute('rel')))
    ) ?: [];
    canonicalOutputAssert(
        $cleanedCombinedCanonicals[0]->getAttribute('data-seo-provider') === 'combined',
        'Combined SEO metadata must retain ownership of its canonical element.'
    );
    canonicalOutputAssert(
        !in_array('alternate', $combinedTokens, true)
        && !$cleanedCombinedCanonicals[0]->hasAttribute('hreflang'),
        'Stale alternate/hreflang metadata must be removed while preserving the canonical relation.'
    );
}

http_response_code(404);
$_SERVER['REQUEST_URI'] = '/nicht-vorhanden/';
$missingSource = $buffer->processSource($withoutCanonical);
canonicalOutputAssert(
    canonicalOutputLinks($missingSource) === [],
    'A 404 source response must not receive a fallback self-canonical.'
);

http_response_code(500);
$_SERVER['REQUEST_URI'] = '/en/products/';
$failedTarget = $buffer->process($withoutCanonical, 'en');
canonicalOutputAssert(
    canonicalOutputLinks($failedTarget) === [],
    'A 5xx target response must not receive a fallback self-canonical.'
);

http_response_code(302);
$_SERVER['REQUEST_URI'] = '/weiterleitung/';
$redirectSource = $buffer->processSource($withoutCanonical);
canonicalOutputAssert(
    canonicalOutputLinks($redirectSource) === [],
    'A redirect response must not receive a fallback self-canonical; the fallback is limited to 2xx documents.'
);

http_response_code(500);
$_SERVER['REQUEST_URI'] = '/en/products/';
$existingErrorCanonical = $buffer->process($withSeoCanonical, 'en');
$existingErrorCanonicals = canonicalOutputLinks($existingErrorCanonical);
canonicalOutputAssert(
    count($existingErrorCanonicals) === 1
    && $existingErrorCanonicals[0]->getAttribute('data-seo-provider') === 'yoast',
    'Suppressing the fallback on an error response must not remove an existing SEO-plugin canonical.'
);
http_response_code(200);

if ($GLOBALS['_canonical_output_failures'] !== []) {
    foreach ($GLOBALS['_canonical_output_failures'] as $failure) {
        fwrite(STDERR, '✗ ' . $failure . PHP_EOL);
    }
    exit(1);
}

fwrite(STDOUT, "CanonicalOutputTest: OK\n");
