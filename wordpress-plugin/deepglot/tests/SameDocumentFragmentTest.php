<?php

/** Regression for recipe jump links becoming language-root URLs. */
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/LinkRewriter.php';
require_once __DIR__ . '/../includes/Frontend/DynamicUrlLocalizer.php';

use Deepglot\Frontend\DynamicUrlLocalizer;
use Deepglot\Frontend\LinkRewriter;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

foreach (['PATH_PREFIX', 'SUBDOMAIN'] as $mode) {
    $routing = new SiteRouting(
        new UrlLanguageResolver('de', ['en']),
        'https://example.com',
        $mode,
        ['en' => 'en.example.com']
    );
    $fragments = ['#zutaten', '#zubereitung', '#', '#tipps%20und%20Tricks', " \n#zubereitung", "\t\n\f\r #", '#zutaten '];
    foreach ($fragments as $fragment) {
        $actual = $routing->rewriteUrl($fragment, 'en');
        if ($actual !== $fragment) {
            throw new RuntimeException("{$mode}: same-document {$fragment} became {$actual}");
        }
    }

    $doc = new DOMDocument('1.0', 'UTF-8');
    $doc->loadHTML('<html><body><a id="ingredients" href="#zutaten">Ingredients</a>'
        . '<a id="preparation" href=" &#10;#zubereitung">Preparation</a>'
        . '<div id="zutaten"></div><div id="zubereitung"></div>'
        . '<a id="control" href="/recipe/#zutaten">Other recipe</a></body></html>');
    (new LinkRewriter($routing))->rewrite($doc, 'en');
    if ($doc->getElementById('ingredients')->getAttribute('href') !== '#zutaten') {
        throw new RuntimeException("{$mode}: rendered ingredient link left the current document");
    }
    if ($doc->getElementById('preparation')->getAttribute('href') !== " \n#zubereitung") {
        throw new RuntimeException("{$mode}: whitespace-prefixed fragment was not preserved");
    }
    $expected = $mode === 'PATH_PREFIX' ? '/en/recipe/#zutaten' : 'https://en.example.com/recipe/#zutaten';
    if ($doc->getElementById('control')->getAttribute('href') !== $expected) {
        throw new RuntimeException("{$mode}: ordinary page links must still be localized");
    }

    $dynamic = (new DynamicUrlLocalizer($routing))->localize(array_merge($fragments, ['/recipe/#zutaten']), 'en');
    if ($dynamic !== ['from_urls' => ['/recipe/#zutaten'], 'to_urls' => [$expected]]) {
        throw new RuntimeException("{$mode}: dynamic localization must preserve fragments and localize ordinary page links");
    }
    echo "PASS {$mode} static/dynamic same-document fragments and page-link control\n";
}
