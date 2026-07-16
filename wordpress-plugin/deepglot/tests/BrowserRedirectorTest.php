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
    'fr',
    $redirector->pickPreferredLanguage('es-ES,fr-FR;q=0.5,en-US;q=0.4,fr;q=0.9'),
    'Unsupported languages should be ignored and duplicate supported languages should keep the highest quality.'
);
assertSameRedirect(
    'en',
    $redirector->pickPreferredLanguage('de-DE,de;q=1.0,en;q=0.3'),
    'A lower-ranked supported target should still be selected when the source language is preferred.'
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

$baseFlags = [
    'hasLocaleCookie' => false,
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
];

assertSameRedirect(false, $redirector->shouldSkipRedirect($baseFlags), 'A first source-page hit without operational context should be redirectable.');

foreach (['isCheckout', 'isOrderPay', 'isEditorMode', 'isLocalizedRequest', 'isRest', 'isPreview'] as $flag) {
    $flags = $baseFlags;
    $flags[$flag] = true;

    assertSameRedirect(true, $redirector->shouldSkipRedirect($flags), $flag . ' should suppress browser-language redirects.');
}

$subdomainRedirectRouting = new SiteRouting(
    new UrlLanguageResolver('de', ['en', 'fr']),
    'https://example.com',
    'SUBDOMAIN',
    [
        'en' => 'en.example.com',
        'fr' => 'fr.example.com',
    ]
);

assertSameRedirect(
    'https://fr.example.com/angebote/?utm=mail',
    $subdomainRedirectRouting->buildUrlForLanguage('/angebote/?utm=mail', 'fr'),
    'Auto redirect targets should use mapped hosts in subdomain mode.'
);


// Performance-Messwerkzeuge dürfen nicht sprachumgeleitet werden, sonst messen
// Lighthouse/PageSpeed & Co. die übersetzte Seite statt der Original-Seite.
$isBotRequest = new ReflectionMethod(BrowserRedirector::class, 'isBotRequest');
if (PHP_VERSION_ID < 80100) {
    // Vor PHP 8.1 ist setAccessible() für private Methoden Pflicht (Requires PHP: 7.4).
    $isBotRequest->setAccessible(true);
}

$botAgents = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' => 'Googlebot',
    'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse' => 'Lighthouse (PageSpeed Insights)',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36' => 'Headless Chrome (lokale Audits)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0 Safari/537.36 GTmetrix' => 'GTmetrix',
    'Mozilla/5.0 (X11; Linux x86_64; PTST/240301.140921) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' => 'WebPageTest (PTST)',
];

foreach ($botAgents as $userAgent => $label) {
    assertSameRedirect(
        true,
        $isBotRequest->invoke($redirector, $userAgent),
        $label . ' must be treated as a bot so measurements hit the source-language page.'
    );
}

assertSameRedirect(
    false,
    $isBotRequest->invoke($redirector, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'),
    'Regular browsers must not be classified as bots.'
);

fwrite(STDOUT, "BrowserRedirectorTest: OK\n");
