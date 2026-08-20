<?php

/**
 * Dynamic widgets are created after the server-side LinkRewriter pass. Their
 * links must still follow the active language without sending URLs to the
 * translation provider.
 */

require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';

$localizerFile = __DIR__ . '/../includes/Frontend/DynamicUrlLocalizer.php';
if (is_file($localizerFile)) {
    require_once $localizerFile;
}

use Deepglot\Frontend\DynamicUrlLocalizer;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function dynamicUrlAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

dynamicUrlAssert(
    class_exists(DynamicUrlLocalizer::class),
    'Dynamic widgets need a server-side URL localizer that reuses SiteRouting semantics.'
);

$routing = new SiteRouting(
    new UrlLanguageResolver('de', ['en', 'fr']),
    'https://example.com',
    'PATH_PREFIX',
    [],
    [
        'en' => [
            'datenschutzerklaerung' => 'privacy-policy',
            'impressum' => 'legal-notice',
        ],
        'fr' => [
            'datenschutzerklaerung' => 'confidentialite',
        ],
    ]
);
$localizer = new DynamicUrlLocalizer($routing);

$result = $localizer->localize([
    'https://example.com/datenschutzerklaerung/?from=modal#privacy',
    '/impressum/',
    '/en/datenschutzerklaerung/',
    '/fr/confidentialite/',
    'https://outside.example/legal/',
    'https://example.com:8443/alternate-service/',
    'mailto:privacy@example.com',
    '//cdn.example.com/policy.pdf',
    '/wp-content/uploads/privacy.pdf',
], 'en');

dynamicUrlAssert(
    $result === [
        'from_urls' => [
            'https://example.com/datenschutzerklaerung/?from=modal#privacy',
            '/impressum/',
            '/en/datenschutzerklaerung/',
        ],
        'to_urls' => [
            'https://example.com/en/privacy-policy/?from=modal#privacy',
            '/en/legal-notice/',
            '/en/privacy-policy/',
        ],
    ],
    'Only internal page links in the active language may be localized; external, special, infrastructure, and explicit cross-language links stay untouched.'
);

$tooMany = [];
for ($index = 0; $index < 200; $index++) {
    $tooMany[] = 'https://outside-' . $index . '.example/legal/';
}
$tooMany[] = '/impressum/';
dynamicUrlAssert(
    $localizer->localize($tooMany, 'en') === ['from_urls' => [], 'to_urls' => []],
    'The input-attempt limit must apply before filtering so an attacker cannot force an unbounded URL scan.'
);

$invalidLanguage = $localizer->localize(['/impressum/'], 'it');
dynamicUrlAssert(
    $invalidLanguage === ['from_urls' => [], 'to_urls' => []],
    'An unconfigured target language must never rewrite a dynamic URL.'
);

fwrite(STDOUT, "DynamicUrlLocalizationTest: OK\n");
