<?php

/**
 * Reproduces the html lang regression observed on https://www.meinhaushalt.at/en/
 * on 2026-05-07 where translated pages still announced lang="de".
 *
 * The OutputBuffer pipeline must rewrite the <html lang> attribute to the
 * active target language, so screen readers, browser translators and search
 * engines treat the response as the translated language.
 *
 * Run standalone: php tests/HtmlLangSwitchTest.php
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }
}

if (!function_exists('home_url')) {
    function home_url($path = '/') {
        return 'https://example.com' . $path;
    }
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

if (!function_exists('headers_sent')) {
    function headers_sent() { return false; }
}

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_options'] = [];

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_options'][$key] ?? $default;
    }

    function update_option($key, $value) {
        $GLOBALS['_deepglot_options'][$key] = $value;
        return true;
    }

    function get_transient($key) {
        return false;
    }

    function set_transient($key, $value, $ttl = 0) {
        return true;
    }

    function is_wp_error($value) {
        return false;
    }

    function wp_parse_args($args, $defaults = []) {
        return array_merge($defaults, is_array($args) ? $args : []);
    }

    function sanitize_text_field($value) {
        return trim((string) $value);
    }

    function sanitize_textarea_field($value) {
        return trim((string) $value);
    }

    function esc_url_raw($value) {
        return (string) $value;
    }

    function untrailingslashit($value) {
        return rtrim((string) $value, '/');
    }

    function get_site_url() {
        return 'https://example.com';
    }

    if (!defined('DAY_IN_SECONDS')) {
        define('DAY_IN_SECONDS', 86400);
    }

    if (!defined('YEAR_IN_SECONDS')) {
        define('YEAR_IN_SECONDS', 31536000);
    }
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

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HreflangInjector;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Frontend\LinkRewriter;
use Deepglot\Frontend\OutputBuffer;
use Deepglot\Frontend\RequestRouter;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\UrlLanguageResolver;

class DeepglotLangFakeClient extends Client
{
    public function __construct() {}

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0)
    {
        return [
            'from_words' => $texts,
            'to_words' => array_map(static fn(string $text) => '[' . $langTo . '] ' . $text, $texts),
        ];
    }
}

class DeepglotLangNullCache extends TranslationCache
{
    public function getMany(array $texts, string $from, string $to): array
    {
        return [];
    }

    public function setMany(array $translations, string $from, string $to): void
    {
    }
}

function dgLangAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

$options = new Options();
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));

$resolver = new UrlLanguageResolver('de', ['en']);
$routing = new SiteRouting($resolver, 'https://example.com', 'PATH_PREFIX', []);
$client = new DeepglotLangFakeClient();
$translator = new HtmlTranslator($client, $options, new DeepglotLangNullCache());
$linkRewriter = new LinkRewriter($resolver, 'https://example.com');
$hreflang = new HreflangInjector($options, $routing);
$router = new RequestRouter($options, $routing);

$_SERVER['REQUEST_URI'] = '/blog/';
$_SERVER['HTTP_HOST'] = 'example.com';

$buffer = new OutputBuffer($options, $resolver, $translator, $linkRewriter, $hreflang, $router, $routing);

$html = '<!DOCTYPE html>'
    . '<html class="avada-html" lang="de" xml:lang="de">'
    . '<head><title>Hallo</title></head>'
    . '<body><h1>Hallo Welt</h1></body></html>';

$processed = $buffer->process($html, 'en');

dgLangAssert(
    str_contains($processed, 'lang="en"'),
    'Translated page must announce lang="en" on the <html> element, got: ' . substr($processed, 0, 200)
);
dgLangAssert(
    !preg_match('/<html[^>]*\\blang="de"/', $processed),
    'Translated page must NOT keep lang="de" on the <html> element, got: ' . substr($processed, 0, 200)
);
dgLangAssert(
    str_contains($processed, 'translate="no"'),
    'Translated page should still keep translate="no" so browser auto-translators do not double translate.'
);
dgLangAssert(
    str_contains($processed, 'class="avada-html"'),
    'Existing class attribute should be preserved.'
);
dgLangAssert(
    !preg_match('/xml:lang="de"/', $processed),
    'xml:lang attribute should also be switched if present, got: ' . substr($processed, 0, 200)
);
dgLangAssert(
    str_contains($processed, '[en] Hallo'),
    'Title text should be translated, got: ' . substr($processed, 0, 400)
);

fwrite(STDOUT, "HtmlLangSwitchTest: OK\n");
