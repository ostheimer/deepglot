<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Frontend/MediaRewriter.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\MediaRewriter;

final class MediaRewriterReviewFindingsOptions extends Options
{
    public function getSourceLanguage(): string
    {
        return 'de';
    }

    /**
     * @return list<string>
     */
    public function getTargetLanguages(): array
    {
        return ['en'];
    }

    /**
     * @return array<string, string>
     */
    public function getMediaReplacements(string $targetLanguage): array
    {
        if ($targetLanguage !== 'en') {
            return [];
        }

        return [
            '/uploads/caf%c3%a9.png' => '/uploads/coffee.webp',
            '/uploads/cover.jpg' => '/uploads/cover-en.jpg',
            '/uploads/a.png' => '/uploads/a-en.avif',
            '/uploads/b.png' => '/uploads/b-en.avif',
            '/uploads/trailing-dot.png' => '/uploads/trailing-dot-en.webp',
        ];
    }

    /**
     * @return list<string>
     */
    public function getExcludedSelectors(): array
    {
        return ['.skip-media', '#blocked-media'];
    }
}

/** @var list<string> $failures */
$failures = [];

function assertMediaReviewFinding(bool $condition, string $message): void
{
    global $failures;

    if (!$condition) {
        $failures[] = $message;
    }
}

function mediaReviewFindingAttribute(DOMDocument $document, string $id, string $attribute): string
{
    $element = $document->getElementById($id);
    assertMediaReviewFinding($element instanceof DOMElement, "Element {$id} exists");

    return $element instanceof DOMElement ? $element->getAttribute($attribute) : '';
}

$document = new DOMDocument('1.0', 'UTF-8');
$previous = libxml_use_internal_errors(true);
$document->loadHTML(<<<'HTML'
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head><body>
<img id="lowercase-escape" src="/uploads/café.png">
<img id="paired-descriptors" srcset="/uploads/cover.jpg 400w 300h">
<div class="skip-media"><img id="class-excluded" src="/uploads/cover.jpg"></div>
<div id="blocked-media"><img id="id-excluded" src="/uploads/cover.jpg"></div>
<picture><source id="typed-source" type="image/png" srcset="/uploads/a.png 1x, /uploads/b.png 2x"><img src="/uploads/a.png"></picture>
<img id="trailing-dot-host" src="https://example.com./uploads/trailing-dot.png">
</body></html>
HTML);
libxml_clear_errors();
libxml_use_internal_errors($previous);

(new MediaRewriter(new MediaRewriterReviewFindingsOptions(), 'https://example.com'))->rewrite($document, 'en');

assertMediaReviewFinding(
    mediaReviewFindingAttribute($document, 'lowercase-escape', 'src') === '/uploads/coffee.webp',
    'Percent-escape casing is normalized before mapping lookup'
);
assertMediaReviewFinding(
    mediaReviewFindingAttribute($document, 'paired-descriptors', 'srcset') === '/uploads/cover-en.jpg 400w 300h',
    'A valid paired width and height srcset descriptor is rewritten'
);
assertMediaReviewFinding(
    mediaReviewFindingAttribute($document, 'class-excluded', 'src') === '/uploads/cover.jpg',
    'A CSS_CLASS-excluded subtree is not rewritten'
);
assertMediaReviewFinding(
    mediaReviewFindingAttribute($document, 'id-excluded', 'src') === '/uploads/cover.jpg',
    'A CSS_ID-excluded subtree is not rewritten'
);
assertMediaReviewFinding(
    mediaReviewFindingAttribute($document, 'typed-source', 'srcset') === '/uploads/a-en.avif 1x, /uploads/b-en.avif 2x',
    'All candidates of a typed picture source are rewritten'
);
assertMediaReviewFinding(
    mediaReviewFindingAttribute($document, 'typed-source', 'type') === 'image/avif',
    'A typed picture source MIME hint follows a shared replacement format'
);
assertMediaReviewFinding(
    mediaReviewFindingAttribute($document, 'trailing-dot-host', 'src') === 'https://example.com./uploads/trailing-dot-en.webp',
    'A valid absolute same-origin host with a trailing dot matches the canonical site host'
);

if ($failures !== []) {
    foreach ($failures as $failure) {
        fwrite(STDERR, "FAIL: {$failure}\n");
    }
    exit(1);
}

fwrite(STDOUT, "MediaRewriterReviewFindingsTest: OK\n");
