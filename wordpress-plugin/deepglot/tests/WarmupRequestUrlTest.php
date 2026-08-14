<?php

/**
 * Regression coverage for #278: RequestRouter removes the language prefix
 * before OutputBuffer sends cold-page work to TranslationWarmer. The request
 * URL attached to that work must still identify the localized page, otherwise
 * a completed warmup purges the source URL while a partially translated
 * full-page cache remains live at the localized URL.
 */

if (!function_exists('__')) {
    function __($text, $domain = null) { return $text; }
}

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_options'] = [];
    function get_option($key, $default = false) { return $GLOBALS['_deepglot_options'][$key] ?? $default; }
    function update_option($key, $value) { $GLOBALS['_deepglot_options'][$key] = $value; return true; }
}

if (!function_exists('home_url')) {
    function home_url($path = '/') { return 'https://example.com' . $path; }
}

if (!function_exists('sanitize_text_field')) {
    function sanitize_text_field($value) { return trim((string) $value); }
}

if (!function_exists('esc_url_raw')) {
    function esc_url_raw($value) { return (string) $value; }
}

if (!function_exists('wp_parse_args')) {
    function wp_parse_args($args, $defaults = []) {
        return array_merge($defaults, is_array($args) ? $args : []);
    }
}

if (!function_exists('is_admin')) {
    function is_admin() { return false; }
}

if (!function_exists('wp_doing_ajax')) {
    function wp_doing_ajax() { return false; }
}

if (!function_exists('wp_is_json_request')) {
    function wp_is_json_request() { return false; }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Support/BotDetector.php';
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

class WarmupRequestUrlTranslator extends HtmlTranslator
{
    public string $requestUrl = '';

    public function __construct() {}

    public function translate(string $html, string $targetLanguage, string $requestUrl = '', int $bot = 0): string
    {
        $this->requestUrl = $requestUrl;
        return $html;
    }
}

class WarmupRequestUrlHreflangInjector extends HreflangInjector
{
    public function __construct() {}

    public function inject(
        DOMDocument $doc,
        string $currentPath,
        ?string $currentLanguage = null,
        bool $allowFallbackCanonical = true
    ): void {
    }
}

class WarmupRequestUrlRouter extends RequestRouter
{
    private ?string $language;

    public function __construct(?string $language = 'en')
    {
        $this->language = $language;
    }

    public function getCurrentLanguage(): ?string { return $this->language; }
}

function warmupRequestUrlAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
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
    ['en' => ['beitrag' => 'article']]
);
$router = new WarmupRequestUrlRouter('en');
$translator = new WarmupRequestUrlTranslator();
$buffer = new OutputBuffer(
    $options,
    $resolver,
    $translator,
    new LinkRewriter($routing),
    new WarmupRequestUrlHreflangInjector(),
    $router,
    $routing
);

// Simulate RequestRouter having already rewritten /en/article/ to /beitrag/.
$_SERVER['HTTP_HOST'] = 'example.com';
$_SERVER['REQUEST_URI'] = '/beitrag/?preview=1&utm_source=warmup';

$method = new ReflectionMethod(OutputBuffer::class, 'currentRequestUrl');
$requestUrl = $method->invoke($buffer);

warmupRequestUrlAssert(
    $requestUrl === 'https://example.com/en/article/?preview=1&utm_source=warmup',
    'PATH_PREFIX warmup/cache-purge URL must restore its locale and translated slug while preserving the query; got ' . $requestUrl
);

// Exclusion rules are stored against the canonical source URL. The public
// analytics/purge URL above must not replace that security and quota boundary
// when the localized slug differs from the source slug.
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
    'exclude_urls' => '/beitrag',
]));
$bufferLevel = ob_get_level();
$buffer->startBuffer();
warmupRequestUrlAssert(
    ob_get_level() === $bufferLevel,
    'A canonical /beitrag exclusion must still block the rewritten /en/article request before translation or quota spend.'
);
while (ob_get_level() > $bufferLevel) {
    ob_end_clean();
}

update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));

// OutputBuffer hands the same URL to HtmlTranslator, which forwards it to API
// analytics and TranslationWarmer. This protects all downstream consumers,
// not only the private URL helper in isolation.
$buffer->process('<!doctype html><html lang="de"><head><title>Beitrag</title></head><body></body></html>', 'en');
warmupRequestUrlAssert(
    $translator->requestUrl === $requestUrl,
    'Translation analytics and warmup must receive the localized request URL.'
);

// The same canonical source path must be rebuilt on the configured language
// host in SUBDOMAIN mode, without inventing a path prefix.
$subdomainRouting = new SiteRouting(
    $resolver,
    'https://example.com',
    'SUBDOMAIN',
    ['en' => 'en.example.com'],
    ['en' => ['beitrag' => 'article']]
);
$subdomainBuffer = new OutputBuffer(
    $options,
    $resolver,
    new WarmupRequestUrlTranslator(),
    new LinkRewriter($subdomainRouting),
    new WarmupRequestUrlHreflangInjector(),
    new WarmupRequestUrlRouter('en'),
    $subdomainRouting
);
$_SERVER['HTTP_HOST'] = 'en.example.com';
$_SERVER['REQUEST_URI'] = '/beitrag/?preview=1';
$subdomainRequestUrl = $method->invoke($subdomainBuffer);
warmupRequestUrlAssert(
    $subdomainRequestUrl === 'https://en.example.com/article/?preview=1',
    'SUBDOMAIN warmup/cache-purge URL must retain the mapped host, translated slug and query; got ' . $subdomainRequestUrl
);

// Source-language requests have not been rewritten and keep the existing
// home_url() behavior.
$sourceBuffer = new OutputBuffer(
    $options,
    $resolver,
    new WarmupRequestUrlTranslator(),
    new LinkRewriter($routing),
    new WarmupRequestUrlHreflangInjector(),
    new WarmupRequestUrlRouter(null),
    $routing
);
$_SERVER['HTTP_HOST'] = 'example.com';
$_SERVER['REQUEST_URI'] = '/beitrag/?preview=1';
$sourceRequestUrl = $method->invoke($sourceBuffer);
warmupRequestUrlAssert(
    $sourceRequestUrl === 'https://example.com/beitrag/?preview=1',
    'Source-language URLs must remain unchanged; got ' . $sourceRequestUrl
);

fwrite(STDOUT, "WarmupRequestUrlTest: OK\n");
