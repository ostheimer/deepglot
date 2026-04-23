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

fwrite(STDOUT, "SiteRoutingTest: OK\n");
