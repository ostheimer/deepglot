<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Frontend/MediaRewriter.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\MediaRewriter;

final class MediaRewriterTestOptions extends Options
{
    /** @var array<string, array<string, string>> */
    private array $replacements;

    /**
     * @param array<string, array<string, string>> $replacements
     */
    public function __construct(array $replacements)
    {
        $this->replacements = $replacements;
    }

    public function getSourceLanguage(): string
    {
        return 'de';
    }

    /**
     * @return list<string>
     */
    public function getTargetLanguages(): array
    {
        return ['en', 'fr'];
    }

    /**
     * @return array<string, string>
     */
    public function getMediaReplacements(string $targetLanguage): array
    {
        return $this->replacements[$targetLanguage] ?? [];
    }
}

function assertMediaRewrite(bool $condition, string $message): void
{
    if ($condition) {
        return;
    }

    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function makeMediaDocument(string $body): DOMDocument
{
    $document = new DOMDocument('1.0', 'UTF-8');
    $previous = libxml_use_internal_errors(true);
    $document->loadHTML('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' . $body . '</body></html>');
    libxml_clear_errors();
    libxml_use_internal_errors($previous);

    return $document;
}

function mediaAttribute(DOMDocument $document, string $id, string $attribute): string
{
    $element = $document->getElementById($id);
    assertMediaRewrite($element instanceof DOMElement, "Element {$id} exists");

    return $element->getAttribute($attribute);
}

$options = new MediaRewriterTestOptions([
    'en' => [
        '/wp-content/uploads/cover.jpg' => '/wp-content/uploads/cover-en.jpg',
        '/wp-content/uploads/cover-400.jpg' => '/wp-content/uploads/cover-en-400.jpg',
        '/wp-content/uploads/wide.jpg?size=800' => '/wp-content/uploads/wide-en.jpg?size=800',
        '/wp-content/uploads/unsafe.jpg' => 'javascript:alert(1)',
        '/wp-content/uploads/foreign-destination.jpg' => 'https://outside.example/replacement.jpg',
        '/wp-content/uploads/wrong-port.jpg' => 'https://example.com:8443/replacement.jpg',
        '/wp-content/uploads/encoded-traversal.jpg' => '/wp-content/uploads/%2e%2e/private.jpg',
        '/wp-content/uploads/encoded-slash.jpg' => '/wp-content/uploads/private%2fasset.jpg',
        '/wp-content/uploads/encoded-control.jpg' => '/wp-content/uploads/private%0aasset.jpg',
        '/wp-content/uploads/fragment-destination.jpg' => '/wp-content/uploads/replacement.jpg#view',
        '/wp-content/uploads/fragment-original.jpg#view' => '/wp-content/uploads/replacement.jpg',
        'https://outside.example/original.jpg' => '/wp-content/uploads/foreign-original-en.jpg',
        '//outside.example/original.jpg' => '/wp-content/uploads/protocol-relative-en.jpg',
    ],
    'fr' => [
        '/wp-content/uploads/cover.jpg' => '/wp-content/uploads/cover-fr.jpg',
    ],
    'de' => [
        '/wp-content/uploads/cover.jpg' => '/wp-content/uploads/should-not-rewrite-source.jpg',
    ],
    'it' => [
        '/wp-content/uploads/cover.jpg' => '/wp-content/uploads/should-not-rewrite-inactive.jpg',
    ],
]);

$rewriter = new MediaRewriter($options, 'https://example.com');

$english = makeMediaDocument(<<<'HTML'
<img id="relative" src="/wp-content/uploads/cover.jpg" alt="Übersetzte Beschreibung" width="640" height="480" loading="lazy">
<img id="absolute" src="https://example.com/wp-content/uploads/cover.jpg">
<img id="lazy" data-src="/wp-content/uploads/cover.jpg">
<img id="query" src="/wp-content/uploads/wide.jpg?size=800">
<img id="unmatched" src="/wp-content/uploads/cover.jpg.backup">
<img id="suffix" src="/wp-content/uploads/cover.jpg?other=1">
<img id="foreign" src="https://outside.example/wp-content/uploads/cover.jpg">
<img id="protocol-relative" src="//outside.example/wp-content/uploads/cover.jpg">
<img id="wrong-scheme" src="http://example.com/wp-content/uploads/cover.jpg">
<img id="userinfo" src="https://example.com@outside.example/wp-content/uploads/cover.jpg">
<img id="same-origin-userinfo" src="https://attacker@example.com/wp-content/uploads/cover.jpg">
<img id="unsafe" src="/wp-content/uploads/unsafe.jpg">
<img id="foreign-destination" src="/wp-content/uploads/foreign-destination.jpg">
<img id="wrong-port" src="/wp-content/uploads/wrong-port.jpg">
<img id="encoded-traversal" src="/wp-content/uploads/encoded-traversal.jpg">
<img id="encoded-slash" src="/wp-content/uploads/encoded-slash.jpg">
<img id="encoded-control" src="/wp-content/uploads/encoded-control.jpg">
<img id="fragment-destination" src="/wp-content/uploads/fragment-destination.jpg">
<img id="fragment-original" src="/wp-content/uploads/fragment-original.jpg#view">
<img id="responsive" srcset="  /wp-content/uploads/cover.jpg 1x,   /wp-content/uploads/cover-400.jpg 2x  ">
<img id="lazy-responsive" data-srcset="/wp-content/uploads/cover.jpg 400w, https://example.com/wp-content/uploads/wide.jpg?size=800 800w">
<img id="malformed-empty" srcset="/wp-content/uploads/cover.jpg 1x,, /wp-content/uploads/cover-400.jpg 2x">
<img id="malformed-descriptor" srcset="/wp-content/uploads/cover.jpg 1x 2x, /wp-content/uploads/cover-400.jpg 2x">
<img id="malformed-density" srcset="/wp-content/uploads/cover.jpg 0x, /wp-content/uploads/cover-400.jpg 2x">
<img id="malformed-data" srcset="data:image/svg+xml,unsafe 1x, /wp-content/uploads/cover-400.jpg 2x">
<picture>
    <source id="picture-source" srcset="/wp-content/uploads/cover.jpg 400w, /wp-content/uploads/cover-400.jpg 800w" data-srcset="/wp-content/uploads/cover.jpg 1x">
    <img id="picture-image" src="/wp-content/uploads/cover.jpg">
</picture>
<video id="video" poster="/wp-content/uploads/cover.jpg"><source id="video-source" src="/wp-content/uploads/cover.jpg" srcset="/wp-content/uploads/cover.jpg 1x"></video>
<a id="link" href="/wp-content/uploads/cover.jpg">Download</a>
<iframe id="frame" src="/wp-content/uploads/cover.jpg"></iframe>
<div translate="no"><img id="excluded" src="/wp-content/uploads/cover.jpg"></div>
<div data-deepglot-no-translate><img id="deepglot-excluded" src="/wp-content/uploads/cover.jpg"></div>
HTML);

$responsiveBefore = mediaAttribute($english, 'responsive', 'srcset');
$malformedEmptyBefore = mediaAttribute($english, 'malformed-empty', 'srcset');
$malformedDescriptorBefore = mediaAttribute($english, 'malformed-descriptor', 'srcset');
$malformedDensityBefore = mediaAttribute($english, 'malformed-density', 'srcset');
$malformedDataBefore = mediaAttribute($english, 'malformed-data', 'srcset');

$rewriter->rewrite($english, 'en');

assertMediaRewrite(mediaAttribute($english, 'relative', 'src') === '/wp-content/uploads/cover-en.jpg', 'Root-relative image is replaced');
assertMediaRewrite(mediaAttribute($english, 'absolute', 'src') === 'https://example.com/wp-content/uploads/cover-en.jpg', 'Absolute same-origin image preserves absolute URL style');
assertMediaRewrite(mediaAttribute($english, 'lazy', 'data-src') === '/wp-content/uploads/cover-en.jpg', 'Lazy image data-src is replaced');
assertMediaRewrite(mediaAttribute($english, 'query', 'src') === '/wp-content/uploads/wide-en.jpg?size=800', 'Mapped query strings require an exact match');
assertMediaRewrite(mediaAttribute($english, 'unmatched', 'src') === '/wp-content/uploads/cover.jpg.backup', 'A matching path prefix alone never replaces an image');
assertMediaRewrite(mediaAttribute($english, 'suffix', 'src') === '/wp-content/uploads/cover.jpg?other=1', 'An unmatched query never replaces an image');
assertMediaRewrite(mediaAttribute($english, 'foreign', 'src') === 'https://outside.example/wp-content/uploads/cover.jpg', 'Foreign source URLs remain unchanged');
assertMediaRewrite(mediaAttribute($english, 'protocol-relative', 'src') === '//outside.example/wp-content/uploads/cover.jpg', 'Protocol-relative source URLs remain unchanged');
assertMediaRewrite(mediaAttribute($english, 'wrong-scheme', 'src') === 'http://example.com/wp-content/uploads/cover.jpg', 'A different URL scheme is not the same origin');
assertMediaRewrite(mediaAttribute($english, 'userinfo', 'src') === 'https://example.com@outside.example/wp-content/uploads/cover.jpg', 'URLs with userinfo remain unchanged');
assertMediaRewrite(mediaAttribute($english, 'same-origin-userinfo', 'src') === 'https://attacker@example.com/wp-content/uploads/cover.jpg', 'Even same-origin URLs with embedded credentials remain unchanged');
assertMediaRewrite(mediaAttribute($english, 'unsafe', 'src') === '/wp-content/uploads/unsafe.jpg', 'Dangerous replacement protocols are rejected');
assertMediaRewrite(mediaAttribute($english, 'foreign-destination', 'src') === '/wp-content/uploads/foreign-destination.jpg', 'Foreign replacement origins are rejected');
assertMediaRewrite(mediaAttribute($english, 'wrong-port', 'src') === '/wp-content/uploads/wrong-port.jpg', 'Foreign replacement ports are rejected');
assertMediaRewrite(mediaAttribute($english, 'encoded-traversal', 'src') === '/wp-content/uploads/encoded-traversal.jpg', 'Encoded traversal in replacements is rejected');
assertMediaRewrite(mediaAttribute($english, 'encoded-slash', 'src') === '/wp-content/uploads/encoded-slash.jpg', 'Encoded path separators in replacements are rejected');
assertMediaRewrite(mediaAttribute($english, 'encoded-control', 'src') === '/wp-content/uploads/encoded-control.jpg', 'Encoded control characters in replacements are rejected');
assertMediaRewrite(mediaAttribute($english, 'fragment-destination', 'src') === '/wp-content/uploads/fragment-destination.jpg', 'Replacement URL fragments are rejected');
assertMediaRewrite(mediaAttribute($english, 'fragment-original', 'src') === '/wp-content/uploads/fragment-original.jpg#view', 'Original image URL fragments are rejected');
assertMediaRewrite(mediaAttribute($english, 'responsive', 'srcset') === str_replace(['/cover.jpg', '/cover-400.jpg'], ['/cover-en.jpg', '/cover-en-400.jpg'], $responsiveBefore), 'Responsive descriptors and all surrounding whitespace are preserved');
assertMediaRewrite(mediaAttribute($english, 'lazy-responsive', 'data-srcset') === '/wp-content/uploads/cover-en.jpg 400w, https://example.com/wp-content/uploads/wide-en.jpg?size=800 800w', 'Lazy responsive images preserve absolute candidates and width descriptors');
assertMediaRewrite(mediaAttribute($english, 'malformed-empty', 'srcset') === $malformedEmptyBefore, 'An empty srcset candidate fails closed');
assertMediaRewrite(mediaAttribute($english, 'malformed-descriptor', 'srcset') === $malformedDescriptorBefore, 'Multiple srcset descriptors fail closed');
assertMediaRewrite(mediaAttribute($english, 'malformed-density', 'srcset') === $malformedDensityBefore, 'A zero-density srcset descriptor fails closed');
assertMediaRewrite(mediaAttribute($english, 'malformed-data', 'srcset') === $malformedDataBefore, 'A data URL srcset fails closed');
assertMediaRewrite(mediaAttribute($english, 'picture-source', 'srcset') === '/wp-content/uploads/cover-en.jpg 400w, /wp-content/uploads/cover-en-400.jpg 800w', 'Direct picture source srcsets are replaced');
assertMediaRewrite(mediaAttribute($english, 'picture-source', 'data-srcset') === '/wp-content/uploads/cover-en.jpg 1x', 'Direct picture source lazy srcsets are replaced');
assertMediaRewrite(mediaAttribute($english, 'picture-image', 'src') === '/wp-content/uploads/cover-en.jpg', 'Picture fallback images are replaced');
assertMediaRewrite(mediaAttribute($english, 'video-source', 'src') === '/wp-content/uploads/cover.jpg', 'Video source URLs are untouched');
assertMediaRewrite(mediaAttribute($english, 'video-source', 'srcset') === '/wp-content/uploads/cover.jpg 1x', 'Video source srcsets are untouched');
assertMediaRewrite(mediaAttribute($english, 'video', 'poster') === '/wp-content/uploads/cover.jpg', 'Video poster URLs are untouched');
assertMediaRewrite(mediaAttribute($english, 'link', 'href') === '/wp-content/uploads/cover.jpg', 'Document and image download links are untouched');
assertMediaRewrite(mediaAttribute($english, 'frame', 'src') === '/wp-content/uploads/cover.jpg', 'Iframe URLs are untouched');
assertMediaRewrite(mediaAttribute($english, 'excluded', 'src') === '/wp-content/uploads/cover.jpg', 'translate=no subtrees are untouched');
assertMediaRewrite(mediaAttribute($english, 'deepglot-excluded', 'src') === '/wp-content/uploads/cover.jpg', 'Deepglot no-translate subtrees are untouched');
assertMediaRewrite(mediaAttribute($english, 'relative', 'alt') === 'Übersetzte Beschreibung', 'Accessible alternative text is preserved');
assertMediaRewrite(mediaAttribute($english, 'relative', 'width') === '640' && mediaAttribute($english, 'relative', 'height') === '480', 'Image dimensions are preserved');

$french = makeMediaDocument('<img id="image" src="/wp-content/uploads/cover.jpg">');
$rewriter->rewrite($french, 'fr');
assertMediaRewrite(mediaAttribute($french, 'image', 'src') === '/wp-content/uploads/cover-fr.jpg', 'French mappings are isolated from English mappings');

$source = makeMediaDocument('<img id="image" src="/wp-content/uploads/cover.jpg">');
$rewriter->rewrite($source, 'de');
assertMediaRewrite(mediaAttribute($source, 'image', 'src') === '/wp-content/uploads/cover.jpg', 'Source-language output is never rewritten');

$inactive = makeMediaDocument('<img id="image" src="/wp-content/uploads/cover.jpg">');
$rewriter->rewrite($inactive, 'it');
assertMediaRewrite(mediaAttribute($inactive, 'image', 'src') === '/wp-content/uploads/cover.jpg', 'Inactive target-language output is never rewritten');

$invalidSite = makeMediaDocument('<img id="image" src="/wp-content/uploads/cover.jpg">');
(new MediaRewriter($options, 'javascript:alert(1)'))->rewrite($invalidSite, 'en');
assertMediaRewrite(mediaAttribute($invalidSite, 'image', 'src') === '/wp-content/uploads/cover.jpg', 'Invalid site origins fail closed');

$credentialSite = makeMediaDocument('<img id="image" src="/wp-content/uploads/cover.jpg">');
(new MediaRewriter($options, 'https://attacker@example.com'))->rewrite($credentialSite, 'en');
assertMediaRewrite(mediaAttribute($credentialSite, 'image', 'src') === '/wp-content/uploads/cover.jpg', 'Site origins with embedded credentials fail closed');

$querySite = makeMediaDocument('<img id="image" src="/wp-content/uploads/cover.jpg">');
(new MediaRewriter($options, 'https://example.com?unsafe=1'))->rewrite($querySite, 'en');
assertMediaRewrite(mediaAttribute($querySite, 'image', 'src') === '/wp-content/uploads/cover.jpg', 'Site origins with query strings fail closed');

$fragmentSite = makeMediaDocument('<img id="image" src="/wp-content/uploads/cover.jpg">');
(new MediaRewriter($options, 'https://example.com#unsafe'))->rewrite($fragmentSite, 'en');
assertMediaRewrite(mediaAttribute($fragmentSite, 'image', 'src') === '/wp-content/uploads/cover.jpg', 'Site origins with fragments fail closed');

fwrite(STDOUT, "OK: MediaRewriter locale isolation, responsive images, exclusions, and URL safety\n");
