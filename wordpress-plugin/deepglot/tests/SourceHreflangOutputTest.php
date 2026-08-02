<?php

/**
 * Source-language pages need the same reciprocal hreflang set as translated
 * pages. The source response must not be translated or have its links rewritten.
 */

function sourceHreflangAssert(bool $condition, string $message): void
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

class SourceHreflangTranslator extends HtmlTranslator
{
    public int $calls = 0;

    public function __construct() {}

    public function translate(string $html, string $targetLanguage, string $requestUrl = '', int $bot = 0): string
    {
        $this->calls++;
        return '[translated]' . $html;
    }

    public function translateForEditor(string $html, string $targetLanguage, string $requestUrl = ''): array
    {
        $this->calls++;
        return ['html' => '[translated]' . $html, 'segments' => []];
    }
}

class SourceHreflangRouter extends RequestRouter
{
    public function __construct() {}
    public function getCurrentLanguage(): ?string { return null; }
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
    ['en' => ['produkte' => 'products', 'zahnbehandlung' => 'dental-treatment']]
);
$translator = new SourceHreflangTranslator();
$buffer = new OutputBuffer(
    $options,
    $resolver,
    $translator,
    new LinkRewriter($routing),
    new HreflangInjector($options, $routing),
    new SourceHreflangRouter(),
    $routing
);

$_SERVER['REQUEST_URI'] = '/produkte/zahnbehandlung/';
$_SERVER['HTTP_HOST'] = 'example.com';
$html = '<!doctype html><html lang="de"><head><title>Behandlung</title></head>'
    . '<body><a href="/kontakt/">Kontakt</a></body></html>';

$initialLevel = ob_get_level();
ob_start();
$buffer->startBuffer();
sourceHreflangAssert(
    ob_get_level() === $initialLevel + 2,
    'A configured source-language request must start the metadata output buffer.'
);
echo $html;
ob_end_flush();
$processed = ob_get_clean();

sourceHreflangAssert($translator->calls === 0, 'Source-language output must never call the translator.');
sourceHreflangAssert(str_contains($processed, '>Behandlung<'), 'Source-language copy must remain untouched.');
sourceHreflangAssert(str_contains($processed, 'href="/kontakt/"'), 'Source-language links must not be rewritten.');
sourceHreflangAssert(substr_count($processed, 'hreflang="de"') === 1, 'Source response must contain one de hreflang.');
sourceHreflangAssert(substr_count($processed, 'hreflang="en"') === 1, 'Source response must contain one en hreflang.');
sourceHreflangAssert(substr_count($processed, 'hreflang="x-default"') === 1, 'Source response must contain one x-default hreflang.');
sourceHreflangAssert(
    str_contains($processed, 'href="https://example.com/en/products/dental-treatment/"'),
    'Source response target hreflang must use translated slugs.'
);

fwrite(STDOUT, "SourceHreflangOutputTest: OK\n");
