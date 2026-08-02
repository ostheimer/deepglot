<?php

/**
 * Unit tests for LinkRewriter.
 * Run standalone: php tests/LinkRewriterTest.php
 */

require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/LinkRewriter.php';

use Deepglot\Frontend\LinkRewriter;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function rewriteHtml(string $html, string $lang, array $urlSlugMappings = []): string
{
    $resolver = new UrlLanguageResolver('de', ['en', 'fr']);
    $routing = new SiteRouting($resolver, 'https://example.com', 'PATH_PREFIX', [], $urlSlugMappings);
    return rewriteHtmlUsingRouting($html, $lang, $routing);
}

function rewriteHtmlUsingRouting(string $html, string $lang, SiteRouting $routing): string
{
    $doc = rewriteDocumentUsingRouting($html, $lang, $routing);

    $result = $doc->saveHTML();
    return str_replace('<?xml encoding="UTF-8">', '', (string) $result);
}

function rewriteDocumentUsingRouting(string $html, string $lang, SiteRouting $routing): DOMDocument
{
    $rewriter = new LinkRewriter($routing);

    $doc = new DOMDocument('1.0', 'UTF-8');
    libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOWARNING | LIBXML_NOERROR);
    libxml_clear_errors();

    $rewriter->rewrite($doc, $lang);

    return $doc;
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

function test_does_not_rewrite_mailto_or_tel_links(): void
{
    $html = '<a href="mailto:empfang@example.com">E-mail</a>'
          . '<a href="tel:+4312363020">Phone</a>'
          . '<a href="/kontakt/">Contact</a>';
    $out = rewriteHtml($html, 'en');
    assert(strpos($out, 'href="mailto:empfang@example.com"') !== false, "mailto: links must remain actionable and unchanged: {$out}");
    assert(strpos($out, 'href="tel:+4312363020"') !== false, "tel: links must remain actionable and unchanged: {$out}");
    assert(strpos($out, 'href="/en/kontakt/"') !== false, "Ordinary relative links must still be rewritten: {$out}");
}

function test_does_not_rewrite_special_links_with_leading_whitespace(): void
{
    $resolver = new UrlLanguageResolver('de', ['en', 'fr']);
    $routing = new SiteRouting($resolver, 'https://example.com', 'PATH_PREFIX', []);
    $doc = rewriteDocumentUsingRouting(
        '<a id="email" href=" mailto:empfang@example.com">E-mail</a>'
        . '<a id="phone" href="' . "\n" . 'tel:+4312363020">Phone</a>'
        . '<a id="contact" href="/kontakt/">Contact</a>',
        'en',
        $routing
    );

    $email = $doc->getElementById('email');
    $phone = $doc->getElementById('phone');
    $contact = $doc->getElementById('contact');

    assert($email instanceof DOMElement, 'Expected email link in rewritten DOM');
    assert($phone instanceof DOMElement, 'Expected phone link in rewritten DOM');
    assert($contact instanceof DOMElement, 'Expected contact link in rewritten DOM');
    assert($email->getAttribute('href') === ' mailto:empfang@example.com', 'Whitespace-prefixed mailto: href must remain untouched');
    assert($phone->getAttribute('href') === "\n" . 'tel:+4312363020', 'Whitespace-prefixed tel: href must remain untouched');
    assert($contact->getAttribute('href') === '/en/kontakt/', 'Control relative href must still be rewritten');
}

function test_rewrites_internal_absolute_link(): void
{
    $html = '<a href="https://example.com/services/">Services</a>';
    $out  = rewriteHtml($html, 'en');
    assert(strpos($out, '/en/services/') !== false, "Absolute internal link must be rewritten: {$out}");
}

function test_rewrites_configured_url_slugs_and_preserves_suffixes(): void
{
    $html = '<a href="/ueber-uns/?ref=nav#team">About</a>';
    $out = rewriteHtml($html, 'en', [
        'en' => ['ueber-uns' => 'about-us'],
    ]);
    assert(strpos($out, 'href="/en/about-us/?ref=nav#team"') !== false, "Configured target slugs, query strings, and fragments must be reflected in internal links: {$out}");
}

function test_canonicalizes_stale_same_language_prefixed_slugs(): void
{
    $html = '<a href="/en/ueber-uns/?ref=legacy#team">Legacy EN</a>'
          . '<a href="/fr/a-propos/?ref=manual#team">Explicit FR</a>';
    $out = rewriteHtml($html, 'en', [
        'en' => ['ueber-uns' => 'about-us'],
        'fr' => ['ueber-uns' => 'a-propos'],
    ]);
    assert(strpos($out, 'href="/en/about-us/?ref=legacy#team"') !== false, "Same-language prefixed links must be canonicalized through the configured slug map: {$out}");
    assert(strpos($out, 'href="/fr/a-propos/?ref=manual#team"') !== false, "Explicit links to another language must remain untouched: {$out}");
}

function test_respects_absolute_subdomain_languages_while_canonicalizing_current_links(): void
{
    $resolver = new UrlLanguageResolver('de', ['en', 'fr']);
    $routing = new SiteRouting(
        $resolver,
        'https://example.com',
        'SUBDOMAIN',
        ['en' => 'en.example.com', 'fr' => 'fr.example.com'],
        [
            'en' => ['ueber-uns' => 'about-us'],
            'fr' => ['ueber-uns' => 'a-propos'],
        ]
    );
    $html = '<a href="https://fr.example.com/a-propos/?ref=manual#team">Explicit FR</a>'
          . '<a href="https://en.example.com/ueber-uns/?ref=legacy#team">Legacy EN</a>';
    $out = rewriteHtmlUsingRouting($html, 'en', $routing);

    assert(strpos($out, 'href="https://fr.example.com/a-propos/?ref=manual#team"') !== false, "An explicit absolute link to another mapped subdomain language must remain untouched: {$out}");
    assert(strpos($out, 'href="https://en.example.com/about-us/?ref=legacy#team"') !== false, "A stale absolute link on the current language subdomain must be canonicalized: {$out}");
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

function test_skips_links_inside_deepglot_nav_menu_item(): void
{
    $html = '<nav><ul>'
          . '<li class="menu-item menu-item-deepglot deepglot-lang-de"><a href="/">Deutsch</a></li>'
          . '<li class="ubermenu-item ubermenu-item-deepglot ubermenu-deepglot-lang-en"><a href="/">Deutsch via UberMenu</a></li>'
          . '<li class="menu-item"><a href="/kontakt/">Kontakt</a></li>'
          . '</ul></nav>';

    $out = rewriteHtml($html, 'en');
    assert(strpos($out, '<a href="/">Deutsch</a>') !== false, "Nav switcher's source-language href '/' must NOT be rewritten: {$out}");
    assert(strpos($out, '<a href="/">Deutsch via UberMenu</a>') !== false, "Theme-prefixed nav switcher classes must protect the source-language href: {$out}");
    assert(strpos($out, 'href="/en/kontakt/"') !== false, "Ordinary nav links must still receive the active-language prefix: {$out}");
}

// ---------------------------------------------------------------------------

$tests = [
    'test_rewrites_relative_link',
    'test_does_not_rewrite_already_prefixed_link',
    'test_does_not_rewrite_external_link',
    'test_does_not_rewrite_mailto_or_tel_links',
    'test_does_not_rewrite_special_links_with_leading_whitespace',
    'test_rewrites_internal_absolute_link',
    'test_rewrites_configured_url_slugs_and_preserves_suffixes',
    'test_canonicalizes_stale_same_language_prefixed_slugs',
    'test_respects_absolute_subdomain_languages_while_canonicalizing_current_links',
    'test_skips_links_inside_deepglot_no_translate_subtree',
    'test_skips_nested_links_inside_no_translate_ancestor',
    'test_skips_links_inside_deepglot_nav_menu_item',
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
