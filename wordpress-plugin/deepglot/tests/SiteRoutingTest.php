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
assertSameRouting(
    '/en/about/',
    $pathRouting->getCanonicalPath('/en/en/about/', 'en'),
    'Canonical routing must remove only the structural language prefix and preserve an identical content segment.'
);
assertSameRouting(
    '/index.php/about/',
    $pathRouting->getCanonicalPath('/index.php/en/about/', 'en'),
    'Canonical routing must strip a language prefix that follows the root front controller.'
);
assertSameRouting(
    '/about/',
    $pathRouting->getCanonicalPath('/%65n/about/', 'en'),
    'Canonical routing must strip a percent-encoded structural language prefix exactly once.'
);

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
assertSameRouting('https://en.example.com/offers/?coupon=1#details', $subdomainRouting->rewriteUrl('https://fr.example.com/offers/?coupon=1#details', 'en'), 'Mapped subdomain URLs should rewrite across localized hosts.');
assertSameRouting('https://partner.example.net/offers/', $subdomainRouting->rewriteUrl('https://partner.example.net/offers/', 'en'), 'External hosts should not be rewritten in subdomain mode.');
assertSameRouting('//cdn.example.com/image.jpg', $subdomainRouting->rewriteUrl('//cdn.example.com/image.jpg', 'en'), 'Protocol-relative URLs should not be rewritten.');

// Runtime target removal must deactivate, not destroy, WordPress-owned domain
// mappings. A stale mapping may become active again if the target is re-added,
// but it must not route requests or extend the internal-host allow-list now.
$routingWithStaleMapping = new SiteRouting(
    new UrlLanguageResolver('de', ['fr']),
    'https://example.com',
    'SUBDOMAIN',
    [
        'en' => 'en.example.com',
        'fr' => 'fr.example.com',
    ]
);
assertSameRouting(
    null,
    $routingWithStaleMapping->detectLanguage('/about/', 'en.example.com'),
    'A domain mapping for a removed target language must no longer detect that language.'
);
assertSameRouting(
    false,
    $routingWithStaleMapping->isInternalHost('en.example.com'),
    'A removed target language mapping must not remain in the internal-host allow-list.'
);
assertSameRouting(
    'fr',
    $routingWithStaleMapping->detectLanguage('/about/', 'fr.example.com'),
    'Removing one target must preserve routing for mappings of still-active targets.'
);

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
assertSameRouting(
    '/en/about-us/?q=0',
    $translatedSlugRouting->buildHrefForLanguage('/ueber-uns/?q=0', 'en'),
    'Root PATH_PREFIX href generation must remain unchanged.'
);

$subdirectoryTranslatedPathRouting = new SiteRouting(
    $resolver,
    'https://example.com/blog',
    'PATH_PREFIX',
    [],
    ['en' => ['ueber-uns' => 'about-us']]
);
assertSameRouting(
    '/blog/en/about-us/?q=0',
    $subdirectoryTranslatedPathRouting->buildHrefForLanguage('/blog/ueber-uns/?q=0', 'en'),
    'PATH_PREFIX href generation must place the language below the configured WordPress subdirectory without duplicating it.'
);
assertSameRouting(
    '/blog/en/about-us/?q=relative',
    $subdirectoryTranslatedPathRouting->buildHrefForLanguage('/ueber-uns/?q=relative', 'en'),
    'A site-relative PATH_PREFIX href input must receive the configured WordPress subdirectory exactly once.'
);
assertSameRouting(
    '/blog/en/about-us/?q=rewrite-absolute',
    $subdirectoryTranslatedPathRouting->rewriteUrl('/blog/ueber-uns/?q=rewrite-absolute', 'en'),
    'Relative URL rewriting must normalize a site-root-absolute path before adding the language prefix.'
);
assertSameRouting(
    '/blog/en/about-us/?q=rewrite-relative',
    $subdirectoryTranslatedPathRouting->rewriteUrl('/ueber-uns/?q=rewrite-relative', 'en'),
    'Relative URL rewriting must add the WordPress subdirectory to site-relative input exactly once.'
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

$subdirectoryTranslatedSubdomainRouting = new SiteRouting(
    $resolver,
    'https://example.com/blog',
    'SUBDOMAIN',
    ['en' => 'en.example.com'],
    ['en' => ['ueber-uns' => 'about-us']]
);
assertSameRouting(
    'https://en.example.com/blog/about-us/?ref=absolute',
    $subdirectoryTranslatedSubdomainRouting->buildUrlForLanguage('/blog/ueber-uns/?ref=absolute', 'en'),
    'Subdomain URL generation must normalize an absolute site-root path before adding the configured WordPress subdirectory.'
);
assertSameRouting(
    'https://en.example.com/blog/about-us/?ref=relative',
    $subdirectoryTranslatedSubdomainRouting->buildUrlForLanguage('/ueber-uns/?ref=relative', 'en'),
    'Subdomain URL generation must add the configured WordPress subdirectory to a site-relative path exactly once.'
);
assertSameRouting(
    'https://en.example.com/blog/about-us/?ref=href',
    $subdirectoryTranslatedSubdomainRouting->buildHrefForLanguage('/blog/ueber-uns/?ref=href', 'en'),
    'SUBDOMAIN href generation must continue returning an absolute localized URL.'
);
assertSameRouting(
    'https://en.example.com/blog/about-us/?ref=source',
    $subdirectoryTranslatedSubdomainRouting->rewriteUrl(
        'https://example.com/blog/ueber-uns/?ref=source',
        'en'
    ),
    'Rewriting an absolute source URL to a mapped subdomain must not duplicate the WordPress subdirectory.'
);
assertSameRouting(
    'https://example.com/blog/ueber-uns/?ref=target',
    $subdirectoryTranslatedSubdomainRouting->rewriteUrl(
        'https://en.example.com/blog/about-us/?ref=target',
        'de'
    ),
    'Rewriting an absolute target URL back to the source host must not duplicate the WordPress subdirectory.'
);

$languageNamedSlugRouting = new SiteRouting(
    $resolver,
    'https://example.com',
    'SUBDOMAIN',
    ['en' => 'en.example.com'],
    ['en' => ['source-page' => 'en']]
);
assertSameRouting(
    'https://en.example.com/en/',
    $languageNamedSlugRouting->buildUrlForLanguage('/source-page/', 'en'),
    'A mapped subdomain may use its language code as an ordinary translated content slug.'
);
assertSameRouting(
    '/source-page/',
    $languageNamedSlugRouting->getCanonicalPath('/en/', 'en'),
    'A language-named content slug on a mapped host must be reversed instead of stripped as a path prefix.'
);
assertSameRouting(
    null,
    $languageNamedSlugRouting->detectLanguage('/en/', 'example.com'),
    'A mapped language must not be re-detected as a path-prefix fallback on the source host.'
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
    'https://en.example.com/rest-source/',
    $infrastructureRouting->buildUrlForLanguage('/rest-source/', 'en'),
    'Forward routing must not turn a content slug into the reserved wp-json REST segment.'
);
assertSameRouting(
    '/wp-json/deepglot/v1/',
    $infrastructureRouting->getCanonicalPath('/wp-json/deepglot/v1/', 'en'),
    'Translated slug reversal must not rewrite WordPress REST infrastructure paths.'
);
assertSameRouting(
    'https://en.example.com/wp-json/deepglot/v1/',
    $infrastructureRouting->buildUrlForLanguage('/wp-json/deepglot/v1/', 'en'),
    'Forward URL generation must not rewrite segments inside WordPress REST infrastructure paths.'
);
assertSameRouting(
    'https://example.com/wp-admin/admin-ajax.php/',
    $infrastructureRouting->rewriteUrl('https://en.example.com/wp-admin/admin-ajax.php', 'de'),
    'Translated slug reversal must not rewrite WordPress admin infrastructure paths on mapped hosts.'
);

$reservedInfrastructureSegments = [
    'wp-json',
    'wp-admin',
    'wp-content',
    'wp-includes',
    'wp-login.php',
    'wp-cron.php',
    'xmlrpc.php',
    'wp-comments-post.php',
    'wp-mail.php',
    'wp-trackback.php',
    'wp-signup.php',
    'wp-activate.php',
    'wp-links-opml.php',
    'robots.txt',
    'wp-sitemap.xml',
    'deepglot-sitemap.xml',
    'index.php',
    'favicon.ico',
];
$reservedInfrastructureMappings = [
    'wp-json-guide' => 'api-guide',
    'content-tools' => 'wp-content-tools',
];
foreach ($reservedInfrastructureSegments as $index => $reservedSegment) {
    $reservedInfrastructureMappings['reserved-target-' . $index] = $reservedSegment;
    $reservedInfrastructureMappings[$reservedSegment] = 'reserved-source-' . $index;
}

$reservedInfrastructureRouting = new SiteRouting(
    $resolver,
    'https://example.com',
    'PATH_PREFIX',
    [],
    ['en' => $reservedInfrastructureMappings]
);

foreach ($reservedInfrastructureSegments as $index => $reservedSegment) {
    assertSameRouting(
        'https://example.com/en/reserved-target-' . $index . '/',
        $reservedInfrastructureRouting->buildUrlForLanguage('/reserved-target-' . $index . '/', 'en'),
        'Forward routing must not emit the reserved WordPress segment ' . $reservedSegment . '.'
    );
    assertSameRouting(
        'https://example.com/en/' . $reservedSegment . '/',
        $reservedInfrastructureRouting->buildUrlForLanguage('/' . $reservedSegment . '/', 'en'),
        'Forward routing must not translate the reserved WordPress original ' . $reservedSegment . '.'
    );
    assertSameRouting(
        '/reserved-source-' . $index . '/',
        $reservedInfrastructureRouting->getCanonicalPath('/en/reserved-source-' . $index . '/'),
        'Reverse routing must not resolve a safe target to the reserved WordPress original ' . $reservedSegment . '.'
    );
}

assertSameRouting(
    'https://example.com/en/api-guide/',
    $reservedInfrastructureRouting->buildUrlForLanguage('/wp-json-guide/', 'en'),
    'Exact infrastructure guards must not block ordinary content slugs that merely start with wp-json.'
);
assertSameRouting(
    '/content-tools/',
    $reservedInfrastructureRouting->getCanonicalPath('/en/wp-content-tools/'),
    'Exact infrastructure guards must not block ordinary translated slugs that merely start with wp-content.'
);

$reservedTargetShadowRouting = new SiteRouting(
    $resolver,
    'https://example.com',
    'PATH_PREFIX',
    [],
    [
        'en' => [
            'foo' => 'wp-json',
            'bar' => 'foo',
            'safe-page' => 'safe-target',
        ],
    ]
);
assertSameRouting(
    'https://example.com/en/bar/',
    $reservedTargetShadowRouting->buildUrlForLanguage('/bar/', 'en'),
    'A mapping with a rejected reserved target must still reserve its source slug against forward shadowing.'
);
assertSameRouting(
    'https://example.com/en/safe-target/',
    $reservedTargetShadowRouting->buildUrlForLanguage('/safe-page/', 'en'),
    'Rejecting reserved mappings must preserve unrelated safe mappings.'
);

$subdirectoryInfrastructureRouting = new SiteRouting(
    $resolver,
    'https://example.com/blog',
    'SUBDOMAIN',
    ['en' => 'en.example.com'],
    [
        'en' => [
            'rest-source' => 'wp-json',
            'language-source' => 'en',
            'page-source' => 'page',
            'plugin-source' => 'deepglot',
            'version-source' => 'v1',
        ],
    ]
);
assertSameRouting(
    '/blog/wp-json/deepglot/v1/',
    $subdirectoryInfrastructureRouting->getCanonicalPath('/blog/wp-json/deepglot/v1/', 'en'),
    'Infrastructure prefixes below the configured WordPress subdirectory must bypass translated slug reversal.'
);
assertSameRouting(
    '/blog/language-source/page-source/',
    $subdirectoryInfrastructureRouting->getCanonicalPath('/blog/en/page/', 'en'),
    'Subdomain routing must treat a leading language-like segment after the site path as ordinary content.'
);
assertSameRouting(
    '/blog/language-source/wp-json/plugin-source/version-source/',
    $subdirectoryInfrastructureRouting->getCanonicalPath('/blog/en/wp-json/deepglot/v1/', 'en'),
    'A nested wp-json segment in subdomain content must not be mistaken for the root REST prefix.'
);

$partialSubdomainRouting = new SiteRouting(
    $resolver,
    'https://example.com/blog',
    'SUBDOMAIN',
    ['en' => 'en.example.com'],
    [
        'fr' => [
            'language-source' => 'fr',
            'page-source' => 'page',
            'plugin-source' => 'deepglot',
            'version-source' => 'v1',
        ],
    ]
);
assertSameRouting(
    'https://example.com/blog/fr/page/',
    $partialSubdomainRouting->buildUrlForLanguage('/page-source/', 'fr'),
    'A target language without its own host must use the path-prefix fallback.'
);
assertSameRouting(
    'fr',
    $partialSubdomainRouting->detectLanguage('/blog/fr/page/', 'example.com'),
    'A path-prefix fallback language must be detected relative to the configured WordPress subdirectory.'
);
assertSameRouting(
    '/blog/page-source/',
    $partialSubdomainRouting->getCanonicalPath('/blog/fr/page/', 'fr'),
    'The path-prefix fallback language segment must be stripped before WordPress routing.'
);
assertSameRouting(
    '/blog/wp-json/deepglot/v1/',
    $partialSubdomainRouting->getCanonicalPath('/blog/fr/wp-json/deepglot/v1/', 'fr'),
    'Infrastructure below a fallback language prefix must strip the locale and bypass slug reversal.'
);

$emptySubdomainHostRouting = new SiteRouting(
    $resolver,
    'https://example.com/blog',
    'SUBDOMAIN',
    ['en' => 'en.example.com', 'fr' => ''],
    ['fr' => ['language-source' => 'fr', 'page-source' => 'page']]
);
assertSameRouting(
    '/blog/page-source/',
    $emptySubdomainHostRouting->getCanonicalPath('/blog/fr/page/', 'fr'),
    'An explicitly empty language host must use the same path-prefix structure fallback.'
);

$zeroSubdomainHostRouting = new SiteRouting(
    $resolver,
    'https://example.com/blog',
    'SUBDOMAIN',
    ['en' => 'en.example.com', 'fr' => '0'],
    ['fr' => ['language-source' => 'fr', 'page-source' => 'page']]
);
assertSameRouting(
    'https://example.com/blog/fr/page/',
    $zeroSubdomainHostRouting->buildUrlForLanguage('/page-source/', 'fr'),
    'A falsey normalized language host must use the path-prefix fallback when building URLs.'
);
assertSameRouting(
    '/blog/page-source/',
    $zeroSubdomainHostRouting->getCanonicalPath('/blog/fr/page/', 'fr'),
    'A falsey normalized language host must use the same path-prefix fallback during reversal.'
);
assertSameRouting(
    null,
    $zeroSubdomainHostRouting->detectLanguage('/page/', '0'),
    'A falsey language host must not be detected as a configured subdomain.'
);
assertSameRouting(
    false,
    $zeroSubdomainHostRouting->isInternalHost('0'),
    'A falsey language host must not be accepted as an internal subdomain.'
);

$subdirectoryPathPrefixRouting = new SiteRouting(
    $resolver,
    'https://example.com/blog',
    'PATH_PREFIX',
    [],
    [
        'en' => [
            'site-source' => 'blog',
            'language-source' => 'en',
            'front-controller-source' => 'index.php',
            'page-source' => 'page',
            'plugin-source' => 'deepglot',
            'version-source' => 'v1',
        ],
    ]
);
assertSameRouting(
    'en',
    $subdirectoryPathPrefixRouting->detectLanguage('/blog/en/content/', 'example.com'),
    'Path-prefix routing must detect a language relative to the configured WordPress subdirectory.'
);
assertSameRouting(
    '/blog/wp-json/deepglot/v1/',
    $subdirectoryPathPrefixRouting->getCanonicalPath('/blog/en/wp-json/deepglot/v1/', 'en'),
    'Infrastructure prefixes must strip the language below the WordPress subdirectory and bypass reversal.'
);
assertSameRouting(
    '/blog/index.php/wp-json/deepglot/v1/',
    $subdirectoryPathPrefixRouting->getCanonicalPath('/blog/en/index.php/wp-json/deepglot/v1/', 'en'),
    'Language before index.php must be stripped while preserving the WordPress front controller.'
);
assertSameRouting(
    '/blog/index.php/wp-json/deepglot/v1/',
    $subdirectoryPathPrefixRouting->getCanonicalPath('/blog/index.php/en/wp-json/deepglot/v1/', 'en'),
    'Language after index.php must be stripped while preserving the WordPress front controller.'
);
assertSameRouting(
    '/blog/content/',
    $subdirectoryPathPrefixRouting->getCanonicalPath('/blog/en/content/', 'en'),
    'The configured WordPress subdirectory must remain while the language prefix is stripped.'
);
assertSameRouting(
    '/blog/page-source/',
    $subdirectoryPathPrefixRouting->getCanonicalPath('/blog/en/page/', 'en'),
    'The language structure segment must be stripped while later content slugs are reversed.'
);
assertSameRouting(
    '/blog/index.php/page-source/',
    $subdirectoryPathPrefixRouting->getCanonicalPath('/blog/en/index.php/page/', 'en'),
    'Language must be stripped and index.php preserved before reversing later content slugs.'
);
assertSameRouting(
    '/blog/index.php/page-source/',
    $subdirectoryPathPrefixRouting->getCanonicalPath('/blog/index.php/en/page/', 'en'),
    'Language must be stripped after index.php before reversing later content slugs.'
);
assertSameRouting(
    '/blogger/language-source/wp-json/plugin-source/version-source/',
    $subdirectoryPathPrefixRouting->getCanonicalPath('/blogger/en/wp-json/deepglot/v1/', 'en'),
    'A longer content segment must not be mistaken for the configured WordPress subdirectory prefix or protect later content slugs.'
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
