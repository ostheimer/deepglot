<?php

/**
 * Unit tests for LinkRewriter.
 * Run standalone: php tests/LinkRewriterTest.php
 */

require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/LinkRewriter.php';

use Deepglot\Frontend\LinkRewriter;
use Deepglot\Support\UrlLanguageResolver;

function rewriteHtml(string $html, string $lang): string
{
    $resolver = new UrlLanguageResolver('de', ['en', 'fr']);
    $rewriter = new LinkRewriter($resolver, 'https://example.com');

    $doc = new DOMDocument('1.0', 'UTF-8');
    libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOWARNING | LIBXML_NOERROR);
    libxml_clear_errors();

    $rewriter->rewrite($doc, $lang);

    $result = $doc->saveHTML();
    return str_replace('<?xml encoding="UTF-8">', '', (string) $result);
}

// ---------------------------------------------------------------------------

function test_rewrites_relative_link(): void
{
    $html = '<a href="/blog/">Blog</a>';
    $out  = rewriteHtml($html, 'en');
    assert(strpos($out, 'href="/en/blog/"') !== false, "Expected /en/blog/ in: {$out}");
}

function test_does_not_rewrite_already_prefixed_link(): void
{
    $html = '<a href="/en/blog/">Blog EN</a>';
    $out  = rewriteHtml($html, 'en');
    // Should still be /en/blog/, not /en/en/blog/
    assert(strpos($out, '/en/en/') === false, "Must not double-prefix: {$out}");
}

function test_does_not_rewrite_external_link(): void
{
    $html = '<a href="https://other.com/page/">External</a>';
    $out  = rewriteHtml($html, 'en');
    assert(strpos($out, 'href="https://other.com/page/"') !== false, "External link must be unchanged: {$out}");
}

function test_rewrites_internal_absolute_link(): void
{
    $html = '<a href="https://example.com/services/">Services</a>';
    $out  = rewriteHtml($html, 'en');
    assert(strpos($out, '/en/services/') !== false, "Absolute internal link must be rewritten: {$out}");
}

// ---------------------------------------------------------------------------

$tests = [
    'test_rewrites_relative_link',
    'test_does_not_rewrite_already_prefixed_link',
    'test_does_not_rewrite_external_link',
    'test_rewrites_internal_absolute_link',
];

$passed = 0;
$failed = 0;

foreach ($tests as $test) {
    try {
        $test();
        echo "✓ {$test}\n";
        $passed++;
    } catch (\Throwable $e) {
        echo "✗ {$test}: {$e->getMessage()}\n";
        $failed++;
    }
}

echo "\n{$passed} passed, {$failed} failed\n";

exit($failed > 0 ? 1 : 0);
