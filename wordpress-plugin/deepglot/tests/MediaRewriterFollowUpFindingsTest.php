<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Frontend/MediaRewriter.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\MediaRewriter;

final class MediaRewriterFollowUpFindingsOptions extends Options
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
            '/uploads/hero.png' => '/uploads/hero-en.webp',
            '/uploads/a.png' => '/uploads/a-en.png',
        ];
    }

    /**
     * @return list<string>
     */
    public function getExcludedSelectors(): array
    {
        return [];
    }
}

/** @var list<string> $failures */
$failures = [];

function assertMediaFollowUpFinding(bool $condition, string $message): void
{
    global $failures;

    if (!$condition) {
        $failures[] = $message;
    }
}

function mediaFollowUpFindingAttribute(DOMDocument $document, string $id, string $attribute): string
{
    $element = $document->getElementById($id);
    assertMediaFollowUpFinding($element instanceof DOMElement, "Element {$id} exists");

    return $element instanceof DOMElement ? $element->getAttribute($attribute) : '';
}

// Finding: percent-encoded hosts, such as `https://%65xample.com/...`, must
// canonicalize to the same host the SaaS WHATWG parser stores (`example.com`)
// before origin comparison, or an accepted absolute mapping never applies.
$encodedHostDocument = new DOMDocument('1.0', 'UTF-8');
$previous = libxml_use_internal_errors(true);
$encodedHostDocument->loadHTML(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>'
    . '<img id="encoded-host" src="https://%65xample.com/uploads/hero.png">'
    . '</body></html>'
);
libxml_clear_errors();
libxml_use_internal_errors($previous);

(new MediaRewriter(new MediaRewriterFollowUpFindingsOptions(), 'https://example.com'))
    ->rewrite($encodedHostDocument, 'en');

assertMediaFollowUpFinding(
    mediaFollowUpFindingAttribute($encodedHostDocument, 'encoded-host', 'src')
        === 'https://%65xample.com/uploads/hero-en.webp',
    'A percent-encoded host equivalent to the site origin is rewritten, keeping the rendered spelling'
);

// Finding: a typed <picture><source> whose unmapped candidate uses an
// encoded-but-equivalent extension, such as `/fallback.%70ng`, must still be
// recognized as PNG for the MIME-consistency check, or the entire source
// (including its mapped sibling candidate) is left untouched.
$typedSourceDocument = new DOMDocument('1.0', 'UTF-8');
$previous = libxml_use_internal_errors(true);
$typedSourceDocument->loadHTML(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>'
    . '<picture><source id="encoded-extension-source" type="image/png" '
    . 'srcset="/uploads/a.png 1x, /fallback.%70ng 2x"><img src="/uploads/a.png"></picture>'
    . '</body></html>'
);
libxml_clear_errors();
libxml_use_internal_errors($previous);

(new MediaRewriter(new MediaRewriterFollowUpFindingsOptions(), 'https://example.com'))
    ->rewrite($typedSourceDocument, 'en');

assertMediaFollowUpFinding(
    mediaFollowUpFindingAttribute($typedSourceDocument, 'encoded-extension-source', 'srcset')
        === '/uploads/a-en.png 1x, /fallback.%70ng 2x',
    'A typed picture source keeps rewriting its mapped candidate when an unmapped sibling uses an encoded extension'
);
assertMediaFollowUpFinding(
    mediaFollowUpFindingAttribute($typedSourceDocument, 'encoded-extension-source', 'type') === 'image/png',
    'The MIME hint is retained once the encoded-extension candidate is recognized as the same PNG format'
);

if ($failures !== []) {
    foreach ($failures as $failure) {
        fwrite(STDERR, "FAIL: {$failure}\n");
    }
    exit(1);
}

fwrite(STDOUT, "MediaRewriterFollowUpFindingsTest: OK\n");
