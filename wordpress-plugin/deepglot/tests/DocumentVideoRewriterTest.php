<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Frontend/MediaRewriter.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\MediaRewriter;

final class DocumentVideoOptions extends Options
{
    public function getSourceLanguage(): string { return 'de'; }
    public function getTargetLanguages(): array { return ['en', 'fr']; }
    public function getExcludedSelectors(): array { return ['.excluded']; }
    public function getMediaReplacements(string $targetLanguage): array
    {
        if ($targetLanguage !== 'en') return [];
        return [
            '/uploads/guide.pdf' => '/uploads/guide-en.pdf',
            '/uploads/sheet.xlsx' => '/uploads/sheet-en.xlsx',
            '/uploads/clip.mp4' => '/uploads/clip-en.mp4',
            '/uploads/movie.webm' => '/uploads/movie-en.webm',
            'https://www.youtube-nocookie.com/embed/abcdefghijk' => 'https://www.youtube-nocookie.com/embed/lmnopqrstuv',
            'https://player.vimeo.com/video/123' => 'https://player.vimeo.com/video/456',
            '/uploads/unsafe.pdf' => 'https://other.example/unsafe.pdf',
            '/uploads/wrong.pdf' => '/uploads/wrong.docx',
            'https://www.youtube.com/embed/abcdefghijk' => 'https://www.youtube-nocookie.com/embed/lmnopqrstuv',
        ];
    }
}

function documentVideoRender(string $html, string $language): DOMDocument
{
    $document = new DOMDocument('1.0', 'UTF-8');
    $previous = libxml_use_internal_errors(true);
    $document->loadHTML('<!DOCTYPE html><html><body>' . $html . '</body></html>');
    libxml_clear_errors();
    libxml_use_internal_errors($previous);
    (new MediaRewriter(new DocumentVideoOptions(), 'https://example.com'))->rewrite($document, $language);
    return $document;
}

function documentVideoAssert(DOMDocument $document, string $id, string $attribute, string $expected): void
{
    $element = $document->getElementById($id);
    if (!$element instanceof DOMElement || $element->getAttribute($attribute) !== $expected) {
        fwrite(STDERR, "FAIL: {$id}[{$attribute}]\n");
        exit(1);
    }
}

$html = <<<'HTML'
<a id="pdf" href="/uploads/guide.pdf" download aria-label="Guide">PDF</a>
<a id="absolute" href="https://example.com/uploads/sheet.xlsx">XLSX</a>
<a id="fallback" href="/uploads/other.pdf">Other</a>
<a id="unsafe" href="/uploads/unsafe.pdf">Unsafe</a>
<a id="wrong" href="/uploads/wrong.pdf">Wrong format</a>
<div translate="no"><a id="no-translate" href="/uploads/guide.pdf">PDF</a></div>
<div class="excluded"><a id="excluded" href="/uploads/guide.pdf">PDF</a></div>
<video id="video" src="/uploads/clip.mp4" poster="/uploads/poster.jpg" controls></video>
<video><source id="source" src="/uploads/movie.webm" type="video/webm"></video>
<iframe id="youtube" src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="Video"></iframe>
<iframe id="vimeo" data-src="https://player.vimeo.com/video/123"></iframe>
<iframe id="provider-change" src="https://www.youtube.com/embed/abcdefghijk"></iframe>
<iframe id="unknown" src="https://evil.example/embed/abcdefghijk"></iframe>
HTML;

$english = documentVideoRender($html, 'en');
documentVideoAssert($english, 'pdf', 'href', '/uploads/guide-en.pdf');
documentVideoAssert($english, 'pdf', 'aria-label', 'Guide');
documentVideoAssert($english, 'absolute', 'href', 'https://example.com/uploads/sheet-en.xlsx');
documentVideoAssert($english, 'fallback', 'href', '/uploads/other.pdf');
documentVideoAssert($english, 'unsafe', 'href', '/uploads/unsafe.pdf');
documentVideoAssert($english, 'wrong', 'href', '/uploads/wrong.pdf');
documentVideoAssert($english, 'no-translate', 'href', '/uploads/guide.pdf');
documentVideoAssert($english, 'excluded', 'href', '/uploads/guide.pdf');
documentVideoAssert($english, 'video', 'src', '/uploads/clip-en.mp4');
documentVideoAssert($english, 'video', 'poster', '/uploads/poster.jpg');
documentVideoAssert($english, 'source', 'src', '/uploads/movie-en.webm');
documentVideoAssert($english, 'source', 'type', 'video/webm');
documentVideoAssert($english, 'youtube', 'src', 'https://www.youtube-nocookie.com/embed/lmnopqrstuv');
documentVideoAssert($english, 'youtube', 'title', 'Video');
documentVideoAssert($english, 'vimeo', 'data-src', 'https://player.vimeo.com/video/456');
documentVideoAssert($english, 'provider-change', 'src', 'https://www.youtube.com/embed/abcdefghijk');
documentVideoAssert($english, 'unknown', 'src', 'https://evil.example/embed/abcdefghijk');

$source = documentVideoRender($html, 'de');
documentVideoAssert($source, 'pdf', 'href', '/uploads/guide.pdf');
$unmappedLanguage = documentVideoRender($html, 'fr');
documentVideoAssert($unmappedLanguage, 'youtube', 'src', 'https://www.youtube-nocookie.com/embed/abcdefghijk');

fwrite(STDOUT, "OK: document and video media replacements\n");
