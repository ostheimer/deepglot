<?php

/**
 * Regression contract for issue #58 AMP support. The admin toggle must gate
 * actual output buffering for AMP endpoints without disabling ordinary pages,
 * and bot traffic must still flow through the standard cache-safe bot path.
 */

if (!function_exists('__')) {
    function __($text, $domain = null) { return $text; }
}
if (!function_exists('add_filter')) {
    $GLOBALS['_deepglot_amp_filters'] = [];
    function add_filter($hook, $callback, $priority = 10, $accepted_args = 1) {
        $GLOBALS['_deepglot_amp_filters'][$hook][] = [$callback, $priority, $accepted_args];
    }
}
if (!function_exists('wp_start_template_enhancement_output_buffer')) {
    function wp_start_template_enhancement_output_buffer(): bool { return true; }
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
if (!function_exists('is_amp_endpoint')) {
    function is_amp_endpoint() { return !empty($GLOBALS['_deepglot_is_amp_endpoint']); }
}
if (!function_exists('get_query_var')) {
    function get_query_var($key, $default = '') { return $GLOBALS['_deepglot_amp_query_vars'][$key] ?? $default; }
}
if (!function_exists('home_url')) {
    function home_url($path = '/') { return 'https://example.com' . $path; }
}
if (!function_exists('add_query_arg')) {
    function add_query_arg() { $args = func_get_args(); return (string) end($args); }
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
    function get_site_url() { return 'https://example.com'; }
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
use Deepglot\Support\BotDetector;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function ampAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

class AmpPipelineTranslator extends HtmlTranslator
{
    /** @var array<int,array{language:string,url:string,bot:int}> */
    public array $calls = [];

    public function __construct() {}

    public function translate(string $html, string $targetLanguage, string $requestUrl = '', int $bot = 0): string
    {
        $this->calls[] = ['language' => $targetLanguage, 'url' => $requestUrl, 'bot' => $bot];
        return str_replace('Hallo AMP', 'Hello AMP', $html);
    }

    public function translateForEditor(string $html, string $targetLanguage, string $requestUrl = ''): array
    {
        return ['html' => $this->translate($html, $targetLanguage, $requestUrl), 'segments' => []];
    }
}

class AmpPipelineRouter extends RequestRouter
{
    public function __construct() {}
    public function getCurrentLanguage(): ?string { return 'en'; }
}

function makeAmpBuffer(bool $translateAmp, AmpPipelineTranslator $translator): OutputBuffer
{
    $settings = array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => 'dg_test_key',
        'source_language' => 'de',
        'target_languages' => ['en'],
        'translate_amp' => $translateAmp,
        'runtime_config_synced_at' => time(),
    ]);
    update_option(Options::OPTION_KEY, $settings);

    $options = new Options();
    $resolver = new UrlLanguageResolver('de', ['en']);
    $routing = new SiteRouting($resolver, 'https://example.com', 'PATH_PREFIX', []);

    return new OutputBuffer(
        $options,
        $resolver,
        $translator,
        new LinkRewriter($routing),
        new HreflangInjector($options, $routing),
        new AmpPipelineRouter(),
        $routing
    );
}

function filterAmpOutput(OutputBuffer $buffer, string $html): string
{
    $buffer->register();
    $callbacks = $GLOBALS['_deepglot_amp_filters']['wp_template_enhancement_output_buffer'] ?? [];
    $registered = end($callbacks);
    ampAssert(is_array($registered), 'WordPress 6.9+ must register the template enhancement filter');
    ampAssert(($registered[2] ?? null) === 2, 'The core output filter must accept both documented arguments');
    ampAssert(!isset($GLOBALS['_deepglot_amp_filters']['template_include']), 'WordPress 6.9+ must not register the legacy template wrapper');

    $bufferLevel = ob_get_level();
    $output = ($registered[0])($html, $html);
    ampAssert(ob_get_level() === $bufferLevel, 'The Deepglot Core filter must not open its own output buffer');

    return $output;
}

$html = '<!doctype html><html lang="de"><head><title>Hallo AMP</title></head><body><p>Hallo AMP</p></body></html>';
$_SERVER['HTTP_HOST'] = 'example.com';
$_SERVER['HTTP_USER_AGENT'] = 'Googlebot/2.1';

// 1. Official AMP endpoint detection + option OFF: no buffer and therefore no
// translator/cache request at all.
$GLOBALS['_deepglot_is_amp_endpoint'] = true;
$GLOBALS['_deepglot_amp_query_vars'] = [];
$_SERVER['REQUEST_URI'] = '/en/story/amp/';
$offTranslator = new AmpPipelineTranslator();
$offBuffer = makeAmpBuffer(false, $offTranslator);
$untranslatedAmp = filterAmpOutput($offBuffer, $html);
ampAssert($untranslatedAmp === $html, 'AMP toggle off must leave the core output buffer unchanged');
ampAssert($offTranslator->calls === [], 'AMP toggle off must not call translation/cache code');

// 2. Toggle ON: same AMP request is translated and Googlebot stays marked as
// bot=2 so HtmlTranslator keeps its existing cache-only/identity guard.
$onTranslator = new AmpPipelineTranslator();
$onBuffer = makeAmpBuffer(true, $onTranslator);
$translatedAmp = filterAmpOutput($onBuffer, $html);
ampAssert(str_contains($translatedAmp, 'Hello AMP'), 'Enabled AMP output passes through translation');
ampAssert(($onTranslator->calls[0]['bot'] ?? null) === BotDetector::GOOGLE, 'AMP bots retain the standard cache-safe bot code');
ampAssert(str_contains((string) ($onTranslator->calls[0]['url'] ?? ''), '/en/story/amp/'), 'AMP request URL reaches translation analytics/cache contract');

// 3. Fallback path detection still gates AMP when the optional AMP plugin
// helper is absent/false.
$GLOBALS['_deepglot_is_amp_endpoint'] = false;
$_SERVER['REQUEST_URI'] = '/en/story/amp/?ref=feed';
$pathTranslator = new AmpPipelineTranslator();
$pathBuffer = makeAmpBuffer(false, $pathTranslator);
$pathOutput = filterAmpOutput($pathBuffer, $html);
ampAssert($pathOutput === $html, 'Canonical /amp/ endpoint is gated even without the AMP plugin helper');

// 4. Query-var AMP detection is also gated.
$_SERVER['REQUEST_URI'] = '/en/story/?amp=1';
$GLOBALS['_deepglot_amp_query_vars'] = ['amp' => '1'];
$queryTranslator = new AmpPipelineTranslator();
$queryBuffer = makeAmpBuffer(false, $queryTranslator);
$queryOutput = filterAmpOutput($queryBuffer, $html);
ampAssert($queryOutput === $html, 'AMP query-var endpoint is gated when the option is off');

// 5. Ordinary translated pages continue to use the output pipeline even when
// AMP translation is disabled.
$GLOBALS['_deepglot_amp_query_vars'] = [];
$_SERVER['REQUEST_URI'] = '/en/story/';
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0';
$ordinaryTranslator = new AmpPipelineTranslator();
$ordinaryBuffer = makeAmpBuffer(false, $ordinaryTranslator);
$ordinaryOutput = filterAmpOutput($ordinaryBuffer, $html);
ampAssert(str_contains($ordinaryOutput, 'Hello AMP'), 'AMP toggle must not disable ordinary translated pages');
ampAssert(($ordinaryTranslator->calls[0]['bot'] ?? null) === BotDetector::HUMAN, 'Ordinary human request remains bot=0');

fwrite(STDOUT, "AmpOutputPipelineTest: OK\n");
