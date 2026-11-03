<?php

/** Regression for a 301 without Location on duplicate language prefixes. */

$GLOBALS['_deepglot_double_prefix_redirect'] = null;
$GLOBALS['_deepglot_double_prefix_router'] = null;
$GLOBALS['_deepglot_double_prefix_failures'] = 0;

function get_site_url(): string
{
    return 'https://example.com';
}

function is_404(): bool
{
    return false;
}

function wp_safe_redirect($location, $status = 302, $xRedirectBy = 'WordPress'): bool
{
    $location = $GLOBALS['_deepglot_double_prefix_router']->preventLanguageStrippingRedirect($location);
    $GLOBALS['_deepglot_double_prefix_redirect'] = [
        'status' => $status,
        'location' => $location,
    ];

    // RequestRouter exits only after a successful redirect. Keep the test alive.
    return false;
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/RequestRouter.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\RequestRouter;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

class DoublePrefixOptions extends Options
{
    public function isEnabled(): bool { return true; }
    public function isConfigured(): bool { return true; }
}

function assertDoublePrefixSame($expected, $actual, string $message): void
{
    if ($expected !== $actual) {
        $GLOBALS['_deepglot_double_prefix_failures']++;
        fwrite(STDERR, $message . PHP_EOL);
        fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
        fwrite(STDERR, 'Actual:   ' . var_export($actual, true) . PHP_EOL);
    }
}

$routing = new SiteRouting(
    new UrlLanguageResolver('de', ['en', 'fr']),
    'https://example.com',
    'PATH_PREFIX',
    []
);
$router = new RequestRouter(new DoublePrefixOptions(), $routing);
$GLOBALS['_deepglot_double_prefix_router'] = $router;
$_SERVER['HTTP_HOST'] = 'example.com';
$_SERVER['REQUEST_METHOD'] = 'GET';

foreach ([
    ['/en/en/impressum/', 'https://example.com/en/impressum/'],
    ['/en/en/impressum/?ref=nav&x=1', 'https://example.com/en/impressum/?ref=nav&x=1'],
    ['/fr/fr/contact/?ref=nav', 'https://example.com/fr/contact/?ref=nav'],
] as [$requestUri, $expectedLocation]) {
    $_SERVER['REQUEST_URI'] = $requestUri;
    $GLOBALS['_deepglot_double_prefix_redirect'] = null;
    $router->rewriteRequestUri();
    $router->redirectCanonicalSlug();

    assertDoublePrefixSame(
        ['status' => 301, 'location' => $expectedLocation],
        $GLOBALS['_deepglot_double_prefix_redirect'],
        "Duplicate prefix {$requestUri} must produce a 301 with one-prefix Location."
    );
}

$_SERVER['REQUEST_URI'] = '/en/impressum/?ref=nav';
$GLOBALS['_deepglot_double_prefix_redirect'] = null;
$router->rewriteRequestUri();
$router->redirectCanonicalSlug();
assertDoublePrefixSame(null, $GLOBALS['_deepglot_double_prefix_redirect'], 'Canonical single-prefix URL must not redirect.');
assertDoublePrefixSame(
    false,
    $router->preventLanguageStrippingRedirect('https://example.com/impressum/?ref=nav'),
    'A canonical single-prefix request must still block a redirect to the source-language URL.'
);

if ($GLOBALS['_deepglot_double_prefix_failures'] > 0) {
    exit(1);
}

fwrite(STDOUT, "RequestRouterDoublePrefixRedirectTest: OK\n");
