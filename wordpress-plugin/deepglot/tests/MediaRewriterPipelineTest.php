<?php

declare(strict_types=1);

if (!defined('DAY_IN_SECONDS')) {
    define('DAY_IN_SECONDS', 86400);
}

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_media_pipeline_options'] = [];

    function get_option($key, $default = false)
    {
        return $GLOBALS['_deepglot_media_pipeline_options'][$key] ?? $default;
    }

    function update_option($key, $value): bool
    {
        $GLOBALS['_deepglot_media_pipeline_options'][$key] = $value;

        return true;
    }
}

if (!function_exists('wp_parse_args')) {
    function wp_parse_args($args, $defaults = []): array
    {
        return array_merge($defaults, is_array($args) ? $args : []);
    }
}

if (!function_exists('get_site_url')) {
    function get_site_url(): string
    {
        return 'https://example.com';
    }
}

if (!function_exists('home_url')) {
    function home_url($path = '/'): string
    {
        return 'https://example.com' . $path;
    }
}

require_once __DIR__ . '/../includes/Autoloader.php';

(new Deepglot\Autoloader(__DIR__ . '/../includes'))->register();

use Deepglot\Config\Options;
use Deepglot\Container;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Frontend\MediaRewriter;
use Deepglot\Frontend\OutputBuffer;
use Deepglot\Plugin;

final class MediaPipelineTranslator extends HtmlTranslator
{
    public function __construct()
    {
    }

    public function translate(string $html, string $targetLanguage, string $requestUrl = '', int $bot = 0): string
    {
        return $html;
    }
}

function assertMediaPipeline(bool $condition, string $message): void
{
    if ($condition) {
        return;
    }

    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function mediaPipelineDocument(string $html): DOMDocument
{
    $document = new DOMDocument('1.0', 'UTF-8');
    $previous = libxml_use_internal_errors(true);
    $document->loadHTML($html);
    libxml_clear_errors();
    libxml_use_internal_errors($previous);

    return $document;
}

function mediaPipelineAttribute(DOMDocument $document, string $id, string $attribute): string
{
    $element = $document->getElementById($id);
    assertMediaPipeline($element instanceof DOMElement, "Pipeline element {$id} exists");

    return $element->getAttribute($attribute);
}

update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_media_pipeline',
    'source_language' => 'de',
    'target_languages' => ['en', 'fr'],
]));
update_option(Options::MEDIA_REPLACEMENTS_OPTION_KEY, [
    'en' => [
        '/wp-content/uploads/cover.png' => '/wp-content/uploads/cover-en.png',
        '/wp-content/uploads/cover-800.png' => '/wp-content/uploads/cover-en-800.png',
        '/wp-content/uploads/cover.png?crop=10,20' => '/wp-content/uploads/cover-en.png?crop=30,40',
    ],
    'fr' => [
        '/wp-content/uploads/cover.png' => '/wp-content/uploads/cover-fr.png',
    ],
]);

$_SERVER['REQUEST_URI'] = '/en/blog/';
$_SERVER['HTTP_HOST'] = 'example.com';
$_SERVER['HTTP_USER_AGENT'] = 'MediaRewriterPipelineTest';

$plugin = new Plugin();
$containerProperty = new ReflectionProperty(Plugin::class, 'container');
$container = $containerProperty->getValue($plugin);
assertMediaPipeline($container instanceof Container, 'Plugin exposes its production service container');

// Keep the real Plugin factory, Options, routing, links and hreflang services;
// only provider translation is replaced so this regression never calls SaaS.
$container->singleton(HtmlTranslator::class, static function (): HtmlTranslator {
    return new MediaPipelineTranslator();
});

$buffer = $container->get(OutputBuffer::class);
assertMediaPipeline($buffer instanceof OutputBuffer, 'Plugin constructs the production output buffer');

$mediaProperty = new ReflectionProperty(OutputBuffer::class, 'mediaRewriter');
assertMediaPipeline(
    $mediaProperty->getValue($buffer) === $container->get(MediaRewriter::class),
    'Production Plugin factory injects its MediaRewriter singleton into OutputBuffer'
);

$html = '<!DOCTYPE html><html lang="de"><head><title>Hallo</title></head><body>'
    . '<a id="page-link" href="/angebote/">Angebote</a>'
    . '<a id="media-link" href="/wp-content/uploads/cover.png">Download</a>'
    . '<img id="cover" src="/wp-content/uploads/cover.png" alt="Bildbeschreibung" width="640" height="480">'
    . '<img id="absolute" src="https://example.com/wp-content/uploads/cover.png">'
    . '<img id="comma-lazy" data-srcset="  /wp-content/uploads/cover.png?crop=10,20 1x,  /wp-content/uploads/cover-800.png 2x ">'
    . '<picture><source id="responsive" srcset="/wp-content/uploads/cover.png 400w, /wp-content/uploads/cover-800.png 800w" data-srcset="/wp-content/uploads/cover.png?crop=10,20 400w, /wp-content/uploads/cover-800.png 800w">'
    . '<img id="fallback" src="/wp-content/uploads/cover.png"></picture>'
    . '</body></html>';

$translated = mediaPipelineDocument($buffer->process($html, 'en'));

assertMediaPipeline(mediaPipelineAttribute($translated, 'cover', 'src') === '/wp-content/uploads/cover-en.png', 'Translated response rewrites the mapped image');
assertMediaPipeline(mediaPipelineAttribute($translated, 'absolute', 'src') === 'https://example.com/wp-content/uploads/cover-en.png', 'Translated response preserves absolute same-origin URLs');
assertMediaPipeline(mediaPipelineAttribute($translated, 'responsive', 'srcset') === '/wp-content/uploads/cover-en.png 400w, /wp-content/uploads/cover-en-800.png 800w', 'Translated response rewrites responsive picture candidates');
assertMediaPipeline(mediaPipelineAttribute($translated, 'comma-lazy', 'data-srcset') === '  /wp-content/uploads/cover-en.png?crop=30,40 1x,  /wp-content/uploads/cover-en-800.png 2x ', 'Translated response preserves lazy query commas and exact candidate spacing');
assertMediaPipeline(mediaPipelineAttribute($translated, 'responsive', 'data-srcset') === '/wp-content/uploads/cover-en.png?crop=30,40 400w, /wp-content/uploads/cover-en-800.png 800w', 'Translated picture sources preserve lazy responsive query commas');
assertMediaPipeline(mediaPipelineAttribute($translated, 'fallback', 'src') === '/wp-content/uploads/cover-en.png', 'Translated response rewrites picture fallback images');
assertMediaPipeline(mediaPipelineAttribute($translated, 'cover', 'alt') === 'Bildbeschreibung', 'Existing image alternative text remains intact');
assertMediaPipeline(mediaPipelineAttribute($translated, 'cover', 'width') === '640' && mediaPipelineAttribute($translated, 'cover', 'height') === '480', 'Existing image dimensions remain intact');
assertMediaPipeline(mediaPipelineAttribute($translated, 'page-link', 'href') === '/en/angebote/', 'Existing page-link localization remains intact');
assertMediaPipeline(mediaPipelineAttribute($translated, 'media-link', 'href') === '/wp-content/uploads/cover.png', 'Media download links are not language-prefixed or replaced');

$xpath = new DOMXPath($translated);
assertMediaPipeline($xpath->query('//link[@rel="alternate" and @hreflang="de"]')->length === 1, 'Source-language hreflang remains intact');
assertMediaPipeline($xpath->query('//link[@rel="alternate" and @hreflang="en"]')->length === 1, 'English hreflang remains intact');
assertMediaPipeline($xpath->query('//link[@rel="alternate" and @hreflang="fr"]')->length === 1, 'French hreflang remains intact');

$_SERVER['REQUEST_URI'] = '/blog/';
$source = mediaPipelineDocument($buffer->processSource($html));
assertMediaPipeline(mediaPipelineAttribute($source, 'cover', 'src') === '/wp-content/uploads/cover.png', 'Source-language response does not rewrite mapped images');
assertMediaPipeline(mediaPipelineAttribute($source, 'comma-lazy', 'data-srcset') === '  /wp-content/uploads/cover.png?crop=10,20 1x,  /wp-content/uploads/cover-800.png 2x ', 'Source-language response does not rewrite responsive image queries containing commas');
assertMediaPipeline(mediaPipelineAttribute($source, 'page-link', 'href') === '/angebote/', 'Source-language response does not localize page links');

fwrite(STDOUT, "MediaRewriterPipelineTest: OK\n");
