<?php

require_once dirname(__DIR__) . '/includes/Support/UrlLanguageResolver.php';
require_once dirname(__DIR__) . '/includes/Support/SiteRouting.php';

use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function assertSameRouting($expected, $actual, string $message): void
{
    if ($expected !== $actual) {
        fwrite(STDERR, $message . PHP_EOL);
        fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
        fwrite(STDERR, 'Actual:   ' . var_export($actual, true) . PHP_EOL);
        exit(1);
    }
}

$resolver = new UrlLanguageResolver('de', ['en', 'fr']);
$pathRouting = new SiteRouting(
    $resolver,
    'https://example.com',
    'PATH_PREFIX',
    []
);

assertSameRouting('en', $pathRouting->detectLanguage('/en/about/', 'example.com'), 'Path-prefix routing should detect the language from the path.');
assertSameRouting('https://example.com/en/about/', $pathRouting->buildUrlForLanguage('/about/', 'en'), 'Path-prefix routing should build prefixed URLs.');

$subdomainRouting = new SiteRouting(
    $resolver,
    'https://example.com',
    'SUBDOMAIN',
    [
        'en' => 'en.example.com',
        'fr' => 'fr.example.com',
    ]
);

assertSameRouting('en', $subdomainRouting->detectLanguage('/about/', 'en.example.com'), 'Subdomain routing should detect the language from the host.');
assertSameRouting('https://en.example.com/about/', $subdomainRouting->buildUrlForLanguage('/about/', 'en'), 'Subdomain routing should build host-based URLs.');
assertSameRouting(true, $subdomainRouting->isInternalHost('fr.example.com'), 'Mapped subdomain hosts should count as internal hosts.');
assertSameRouting('https://example.com/about/?ref=nav#intro', $subdomainRouting->buildUrlForLanguage('/fr/about/?ref=nav#intro', 'de'), 'Source-language URLs in subdomain mode should use the canonical source host without a locale prefix.');
assertSameRouting('https://en.example.com/offers/?coupon=1#details', $subdomainRouting->rewriteUrl('https://fr.example.com/fr/offers/?coupon=1#details', 'en'), 'Mapped subdomain URLs should rewrite across localized hosts and strip stale path prefixes.');
assertSameRouting('https://partner.example.net/offers/', $subdomainRouting->rewriteUrl('https://partner.example.net/offers/', 'en'), 'External hosts should not be rewritten in subdomain mode.');
assertSameRouting('//cdn.example.com/image.jpg', $subdomainRouting->rewriteUrl('//cdn.example.com/image.jpg', 'en'), 'Protocol-relative URLs should not be rewritten.');

$subdomainWithoutMappings = new SiteRouting(
    $resolver,
    'https://example.com',
    'SUBDOMAIN',
    []
);

assertSameRouting(false, $subdomainWithoutMappings->usesSubdomains(), 'Subdomain mode without mappings should safely fall back to path-prefix routing.');
assertSameRouting('https://example.com/en/about/', $subdomainWithoutMappings->buildUrlForLanguage('/about/', 'en'), 'Missing subdomain mappings should not produce incomplete host URLs.');

fwrite(STDOUT, "SiteRoutingTest: OK\n");
