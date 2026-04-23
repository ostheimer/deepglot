<?php

require_once dirname(__DIR__) . '/includes/Support/UrlLanguageResolver.php';
require_once dirname(__DIR__) . '/includes/Support/SiteRouting.php';
require_once dirname(__DIR__) . '/includes/Frontend/BrowserRedirector.php';

use Deepglot\Frontend\BrowserRedirector;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function assertSameRedirect($expected, $actual, string $message): void
{
    if ($expected !== $actual) {
        fwrite(STDERR, $message . PHP_EOL);
        fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
        fwrite(STDERR, 'Actual:   ' . var_export($actual, true) . PHP_EOL);
        exit(1);
    }
}

$routing = new SiteRouting(
    new UrlLanguageResolver('de', ['en', 'fr']),
    'https://example.com',
    'PATH_PREFIX',
    []
);

$redirector = new BrowserRedirector($routing, 'deepglot_preferred_language');

assertSameRedirect(
    'en',
    $redirector->pickPreferredLanguage('en-US,en;q=0.9,de;q=0.8'),
    'The best supported target language should be selected from Accept-Language.'
);
assertSameRedirect(
    null,
    $redirector->pickPreferredLanguage('de-DE,de;q=0.9'),
    'The source language alone should not trigger a redirect.'
);
assertSameRedirect(
    true,
    $redirector->shouldSkipRedirect([
        'hasLocaleCookie' => true,
        'isBot' => false,
        'isAdmin' => false,
        'isAjax' => false,
        'isRest' => false,
        'isFeed' => false,
        'isPreview' => false,
        'isCheckout' => false,
        'isOrderPay' => false,
        'isEditorMode' => false,
        'isLocalizedRequest' => false,
    ]),
    'An explicit preference cookie should suppress auto redirects.'
);
assertSameRedirect(
    true,
    $redirector->shouldSkipRedirect([
        'hasLocaleCookie' => false,
        'isBot' => true,
        'isAdmin' => false,
        'isAjax' => false,
        'isRest' => false,
        'isFeed' => false,
        'isPreview' => false,
        'isCheckout' => false,
        'isOrderPay' => false,
        'isEditorMode' => false,
        'isLocalizedRequest' => false,
    ]),
    'Bots should not be auto redirected.'
);

fwrite(STDOUT, "BrowserRedirectorTest: OK\n");
