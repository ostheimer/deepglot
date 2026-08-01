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

// Regression: the SaaS stores translated URL slugs, but the WordPress runtime
// previously ignored them. That changed an established WPML URL such as
// /en/about-us/ into /en/ueber-uns/ during a Deepglot migration and made the
// former URL resolve against a non-existent source-language WordPress path.
$translatedSlugRouting = new SiteRouting(
    $resolver,
    'https://example.com',
    'PATH_PREFIX',
    [],
    [
        'en' => [
            'ueber-uns' => 'about-us',
            'unser-team' => 'our-team',
            'zahnbehandlungen' => 'treatments',
        ],
    ]
);

assertSameRouting(
    'https://example.com/en/about-us/our-team/?ref=nav#staff',
    $translatedSlugRouting->buildUrlForLanguage('/ueber-uns/unser-team/?ref=nav#staff', 'en'),
    'Target-language URLs must use the configured translated slug segments while preserving query strings and fragments.'
);
assertSameRouting(
    '/ueber-uns/unser-team/',
    $translatedSlugRouting->getCanonicalPath('/en/about-us/our-team/'),
    'Translated target-language request paths must resolve back to the canonical WordPress source path.'
);
assertSameRouting(
    'https://example.com/ueber-uns/unser-team/',
    $translatedSlugRouting->buildUrlForLanguage('/en/about-us/our-team/', 'de'),
    'Switching from a translated target URL back to the source language must restore canonical source slugs.'
);

$translatedSubdomainRouting = new SiteRouting(
    $resolver,
    'https://example.com',
    'SUBDOMAIN',
    [
        'en' => 'en.example.com',
        'fr' => 'fr.example.com',
    ],
    [
        'en' => [
            'ueber-uns' => 'about-us',
        ],
    ]
);

assertSameRouting(
    'https://en.example.com/about-us/',
    $translatedSubdomainRouting->buildUrlForLanguage('/ueber-uns/', 'en'),
    'Subdomain routing must apply the same translated slug mapping.'
);
assertSameRouting(
    '/ueber-uns/',
    $translatedSubdomainRouting->getCanonicalPath('/about-us/', 'en'),
    'Subdomain requests must be able to reverse translated slugs using the detected target language.'
);

$infrastructureRouting = new SiteRouting(
    $resolver,
    'https://example.com',
    'SUBDOMAIN',
    [
        'en' => 'en.example.com',
    ],
    [
        'en' => [
            'rest-source' => 'wp-json',
            'plugin-source' => 'deepglot',
            'version-source' => 'v1',
            'admin-source' => 'wp-admin',
        ],
    ]
);

assertSameRouting(
    '/wp-json/deepglot/v1/',
    $infrastructureRouting->getCanonicalPath('/wp-json/deepglot/v1/', 'en'),
    'Translated slug reversal must not rewrite WordPress REST infrastructure paths.'
);
assertSameRouting(
    'https://example.com/wp-admin/admin-ajax.php/',
    $infrastructureRouting->rewriteUrl('https://en.example.com/wp-admin/admin-ajax.php', 'de'),
    'Translated slug reversal must not rewrite WordPress admin infrastructure paths on mapped hosts.'
);

$crossLanguageRouting = new SiteRouting(
    $resolver,
    'https://example.com',
    'PATH_PREFIX',
    [],
    [
        'en' => ['ueber-uns' => 'about-us'],
        'fr' => ['ueber-uns' => 'a-propos'],
    ]
);

assertSameRouting(
    'https://example.com/fr/a-propos/?ref=alternate#intro',
    $crossLanguageRouting->rewriteUrl('https://example.com/en/about-us/?ref=alternate#intro', 'fr'),
    'Cross-language rewrites must reverse the current target slug before applying the destination mapping.'
);

$collisionRouting = new SiteRouting(
    $resolver,
    'https://example.com',
    'PATH_PREFIX',
    [],
    [
        'en' => [
            'kontakt' => 'contact',
            'kontaktieren' => 'contact',
            'Foo' => 'first',
            'foo' => 'second',
        ],
    ]
);

assertSameRouting(
    'https://example.com/en/kontakt/',
    $collisionRouting->buildUrlForLanguage('/kontakt/', 'en'),
    'Ambiguous translated slugs must be omitted instead of using the last reverse mapping.'
);
assertSameRouting(
    'https://example.com/en/foo/',
    $collisionRouting->buildUrlForLanguage('/foo/', 'en'),
    'Original slugs that normalize to the same segment must be omitted deterministically.'
);

$safeSlugRouting = new SiteRouting(
    $resolver,
    'https://example.com',
    'PATH_PREFIX',
    [],
    [
        'en' => [
            'aerzte' => 'ärzte',
            'traversal' => '../wp-admin',
            'encoded-slash' => 'foo%2Fbar',
            'query' => 'foo?admin=1',
            'fragment' => 'foo#admin',
            'backslash' => 'foo\\bar',
            'control' => "foo\0bar",
            'literal-percent-slash' => 'foo%252Fbar',
            'literal-percent-dot' => '%252E%252E',
        ],
    ]
);

assertSameRouting(
    'https://example.com/en/%C3%A4rzte/',
    $safeSlugRouting->buildUrlForLanguage('/aerzte/', 'en'),
    'Unicode target slugs must be emitted with one canonical percent encoding.'
);
assertSameRouting(
    '/aerzte/',
    $safeSlugRouting->getCanonicalPath('/en/%C3%A4rzte/'),
    'Canonical percent-encoded Unicode slugs must reverse to their source segment.'
);

foreach (['traversal', 'encoded-slash', 'query', 'fragment', 'backslash', 'control'] as $unsafeSource) {
    assertSameRouting(
        'https://example.com/en/' . $unsafeSource . '/',
        $safeSlugRouting->buildUrlForLanguage('/' . $unsafeSource . '/', 'en'),
        'Unsafe decoded slug delimiters and controls must be rejected for ' . $unsafeSource . '.'
    );
}

assertSameRouting(
    'https://example.com/en/foo%252Fbar/',
    $safeSlugRouting->buildUrlForLanguage('/literal-percent-slash/', 'en'),
    'A double-encoded slash must remain a literal percent sequence after one canonical decode/encode cycle.'
);
assertSameRouting(
    'https://example.com/en/%252E%252E/',
    $safeSlugRouting->buildUrlForLanguage('/literal-percent-dot/', 'en'),
    'A double-encoded dot segment must never become a path traversal segment.'
);

$languageSegmentRouting = new SiteRouting(
    $resolver,
    'https://example.com',
    'PATH_PREFIX',
    [],
    ['en' => ['en' => 'english']]
);
assertSameRouting(
    'https://example.com/en/products/english/',
    $languageSegmentRouting->buildUrlForLanguage('/products/en/', 'en'),
    'Slug mapping must never rewrite the technical path-prefix language segment.'
);

fwrite(STDOUT, "SiteRoutingTest: OK\n");
