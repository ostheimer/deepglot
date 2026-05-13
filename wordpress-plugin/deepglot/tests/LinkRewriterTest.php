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

/**
 * Regression: when the language switcher renders its own per-language
 * <a> tags (e.g. href="/" for the source language), LinkRewriter used
 * to prefix them with the *current* active language too, so the German
 * link on the English page ended up as /en/. Every <a> nested inside an
 * ancestor carrying data-deepglot-no-translate must be skipped so the
 * switcher's hand-built hreflang links survive the rewrite pass.
 */
function test_skips_links_inside_deepglot_no_translate_subtree(): void
{
    $html = '<aside data-deepglot-no-translate>'
          . '<a href="/" hreflang="de">Deutsch</a>'
          . '<a href="/en/" hreflang="en">English</a>'
          . '</aside>'
          . '<a href="/blog/">Blog</a>'; // control: outside the subtree, gets prefixed

    $out = rewriteHtml($html, 'en');
    assert(strpos($out, 'href="/"') !== false, "Switcher's source-language href '/' must NOT be rewritten: {$out}");
    assert(strpos($out, 'href="/en/"') !== false && substr_count($out, 'href="/en/en/') === 0, "Switcher's already-prefixed href must survive untouched: {$out}");
    assert(strpos($out, 'href="/en/blog/"') !== false, "Control link outside subtree still gets prefix: {$out}");
}

function test_skips_nested_links_inside_no_translate_ancestor(): void
{
    // The marker is on an outer ancestor, not the immediate parent.
    $html = '<div data-deepglot-no-translate><nav><ul><li><a href="/about/">About</a></li></ul></nav></div>';
    $out  = rewriteHtml($html, 'en');
    assert(strpos($out, 'href="/about/"') !== false && strpos($out, '/en/about/') === false, "Deeply nested <a> inside data-deepglot-no-translate must NOT be rewritten: {$out}");
}

// ---------------------------------------------------------------------------

$tests = [
    'test_rewrites_relative_link',
    'test_does_not_rewrite_already_prefixed_link',
    'test_does_not_rewrite_external_link',
    'test_rewrites_internal_absolute_link',
    'test_skips_links_inside_deepglot_no_translate_subtree',
    'test_skips_nested_links_inside_no_translate_ancestor',
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
