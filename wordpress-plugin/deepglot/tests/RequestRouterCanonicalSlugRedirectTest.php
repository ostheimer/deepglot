<?php

/**
 * Regression coverage for canonical redirects from stale source-language slugs
 * below a target-language route.
 */

$GLOBALS['_deepglot_canonical_redirect_actions'] = [];
$GLOBALS['_deepglot_canonical_redirect_filters'] = [];
$GLOBALS['_deepglot_canonical_redirect'] = null;
$GLOBALS['_deepglot_canonical_redirect_is_404'] = false;
$GLOBALS['_deepglot_canonical_redirect_failures'] = 0;

if (!function_exists('add_action')) {
    function add_action($hook, $callback, $priority = 10, $acceptedArgs = 1): void
    {
        $GLOBALS['_deepglot_canonical_redirect_actions'][$hook][$priority][] = $callback;
    }
}

if (!function_exists('add_filter')) {
    function add_filter($hook, $callback, $priority = 10, $acceptedArgs = 1): void
    {
        $GLOBALS['_deepglot_canonical_redirect_filters'][$hook][$priority][] = [
            'callback' => $callback,
            'accepted_args' => $acceptedArgs,
        ];
    }
}

if (!function_exists('remove_action')) {
    function remove_action($hook, $callback, $priority = 10): void
    {
    }
}

if (!function_exists('add_rewrite_rule')) {
    function add_rewrite_rule($regex, $query, $after = 'bottom'): void
    {
    }
}

if (!function_exists('add_rewrite_tag')) {
    function add_rewrite_tag($tag, $regex, $query = ''): void
    {
    }
}

if (!function_exists('flush_rewrite_rules')) {
    function flush_rewrite_rules(): void
    {
    }
}

if (!function_exists('get_site_url')) {
    function get_site_url(): string
    {
        return 'https://example.com';
    }
}

if (!function_exists('wp_safe_redirect')) {
    function wp_safe_redirect($location, $status = 302, $xRedirectBy = 'WordPress'): bool
    {
        $GLOBALS['_deepglot_canonical_redirect'] = [
            'location' => $location,
            'status' => $status,
            'by' => $xRedirectBy,
        ];

        // Returning false keeps the test process alive. WordPress returns the
        // result of wp_redirect(), and production exits only after success.
        return false;
    }
}

if (!function_exists('is_404')) {
    function is_404(): bool
    {
        return (bool) $GLOBALS['_deepglot_canonical_redirect_is_404'];
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/RequestRouter.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\RequestRouter;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

class CanonicalSlugRedirectOptions extends Options
{
    public function isEnabled(): bool
    {
        return true;
    }

    public function isConfigured(): bool
    {
        return true;
    }

    public function getTargetLanguages(): array
    {
        return ['en'];
    }
}

function canonicalSlugRedirectAssert($expected, $actual, string $message): void
{
    if ($expected !== $actual) {
        $GLOBALS['_deepglot_canonical_redirect_failures']++;
        fwrite(STDERR, $message . PHP_EOL);
        fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
        fwrite(STDERR, 'Actual:   ' . var_export($actual, true) . PHP_EOL);
    }
}

function canonicalSlugRedirectApplyFilter(string $hook, $value, ...$args)
{
    $callbacksByPriority = $GLOBALS['_deepglot_canonical_redirect_filters'][$hook] ?? [];
    ksort($callbacksByPriority);

    foreach ($callbacksByPriority as $callbacks) {
        foreach ($callbacks as $registered) {
            $filterArgs = array_slice([$value, ...$args], 0, $registered['accepted_args']);
            $value = $registered['callback'](...$filterArgs);
        }
    }

    return $value;
}

/**
 * @return array{location: string, status: int, by: string}|null
 */
function canonicalSlugRedirectRun(
    RequestRouter $router,
    string $uri,
    string $host,
    string $method = 'GET',
    bool $is404 = false
): ?array
{
    $GLOBALS['_deepglot_canonical_redirect_actions'] = [];
    $GLOBALS['_deepglot_canonical_redirect'] = null;
    $_SERVER['REQUEST_URI'] = $uri;
    $_SERVER['HTTP_HOST'] = $host;
    $_SERVER['REQUEST_METHOD'] = $method;
    $GLOBALS['_deepglot_canonical_redirect_is_404'] = $is404;

    $router->register();

    foreach ($GLOBALS['_deepglot_canonical_redirect_actions']['plugins_loaded'][1] ?? [] as $callback) {
        $callback();
    }

    $templateCallbacks = $GLOBALS['_deepglot_canonical_redirect_actions']['template_redirect'] ?? [];
    ksort($templateCallbacks);
    foreach ($templateCallbacks as $callbacks) {
        foreach ($callbacks as $callback) {
            $callback();
        }
    }

    return $GLOBALS['_deepglot_canonical_redirect'];
}

$resolver = new UrlLanguageResolver('de', ['en']);
$options = new CanonicalSlugRedirectOptions();
$pathRouter = new RequestRouter(
    $options,
    new SiteRouting(
        $resolver,
        'https://example.com',
        'PATH_PREFIX',
        [],
        [
            'en' => [
                'zahnbehandlungen' => 'treatments',
                'geraete' => 'high-tech-devices',
                '3d-zahnroentgen' => '3d-x-ray-machine',
            ],
        ]
    )
);

canonicalSlugRedirectAssert(
    [
        'location' => 'https://example.com/en/treatments/?ref=nav&next=https%3A%2F%2Fevil.test%2F',
        'status' => 301,
        'by' => 'Deepglot',
    ],
    canonicalSlugRedirectRun(
        $pathRouter,
        '/en/zahnbehandlungen/?ref=nav&next=https%3A%2F%2Fevil.test%2F',
        'example.com'
    ),
    'A stale source slug below the English prefix must redirect permanently to the mapped canonical URL without interpreting its query string.'
);

canonicalSlugRedirectAssert(
    [
        'location' => 'https://example.com/en/high-tech-devices/3d-x-ray-machine/?campaign=0',
        'status' => 301,
        'by' => 'Deepglot',
    ],
    canonicalSlugRedirectRun(
        $pathRouter,
        '/en/geraete/3d-zahnroentgen/?campaign=0',
        'example.com'
    ),
    'Nested stale source slugs must redirect in one hop while preserving a query string equal to zero.'
);

canonicalSlugRedirectAssert(
    null,
    canonicalSlugRedirectRun($pathRouter, '/en/treatments/?ref=nav', 'example.com'),
    'The translated canonical URL must not redirect to itself.'
);

canonicalSlugRedirectAssert(
    null,
    canonicalSlugRedirectRun($pathRouter, '/zahnbehandlungen/?ref=nav', 'example.com'),
    'A source-language URL must remain untouched.'
);

$subdirectoryRouter = new RequestRouter(
    $options,
    new SiteRouting(
        $resolver,
        'https://example.com/blog',
        'PATH_PREFIX',
        [],
        ['en' => ['zahnbehandlungen' => 'treatments']]
    )
);

canonicalSlugRedirectAssert(
    [
        'location' => 'https://example.com/blog/en/treatments/?campaign=0',
        'status' => 301,
        'by' => 'Deepglot',
    ],
    canonicalSlugRedirectRun(
        $subdirectoryRouter,
        '/blog/en/zahnbehandlungen/?campaign=0',
        'example.com'
    ),
    'A PATH_PREFIX site below a WordPress subdirectory must not duplicate that site path in its canonical redirect.'
);

foreach (['POST', 'PUT'] as $unsafeMethod) {
    canonicalSlugRedirectAssert(
        null,
        canonicalSlugRedirectRun(
            $pathRouter,
            '/en/zahnbehandlungen/?operation=save',
            'example.com',
            $unsafeMethod
        ),
        $unsafeMethod . ' requests must never be converted into a permanent GET redirect.'
    );
}

canonicalSlugRedirectAssert(
    [
        'location' => 'https://example.com/en/treatments/?operation=inspect',
        'status' => 301,
        'by' => 'Deepglot',
    ],
    canonicalSlugRedirectRun(
        $pathRouter,
        '/en/zahnbehandlungen/?operation=inspect',
        'example.com',
        'HEAD'
    ),
    'HEAD requests may use the same permanent canonical redirect as GET.'
);

canonicalSlugRedirectAssert(
    null,
    canonicalSlugRedirectRun(
        $pathRouter,
        '/en/zahnbehandlungen/?missing=1',
        'example.com',
        'GET',
        true
    ),
    'A mapped slug that WordPress resolves as 404 must not redirect to another 404 URL.'
);

$subdomainRouter = new RequestRouter(
    $options,
    new SiteRouting(
        $resolver,
        'https://example.com',
        'SUBDOMAIN',
        ['en' => 'en.example.com'],
        ['en' => ['ueber-uns' => 'about-us']]
    )
);

canonicalSlugRedirectAssert(
    [
        'location' => 'https://en.example.com/about-us/?campaign=summer',
        'status' => 301,
        'by' => 'Deepglot',
    ],
    canonicalSlugRedirectRun($subdomainRouter, '/ueber-uns/?campaign=summer', 'en.example.com'),
    'A stale source slug on a mapped language host must redirect to the translated slug on that same trusted host.'
);

canonicalSlugRedirectAssert(
    null,
    canonicalSlugRedirectRun($subdomainRouter, '/about-us/?campaign=summer', 'en.example.com'),
    'A canonical translated slug on a mapped host must not loop.'
);

$subdirectorySubdomainRouter = new RequestRouter(
    $options,
    new SiteRouting(
        $resolver,
        'https://example.com/blog',
        'SUBDOMAIN',
        ['en' => 'en.example.com'],
        ['en' => ['ueber-uns' => 'about-us']]
    )
);
canonicalSlugRedirectAssert(
    [
        'location' => 'https://en.example.com/blog/about-us/?campaign=summer',
        'status' => 301,
        'by' => 'Deepglot',
    ],
    canonicalSlugRedirectRun(
        $subdirectorySubdomainRouter,
        '/blog/ueber-uns/?campaign=summer',
        'en.example.com'
    ),
    'A mapped subdomain must retain the configured WordPress subdirectory exactly once.'
);

$_SERVER['REQUEST_URI'] = '/about-us/';
$_SERVER['HTTP_HOST'] = 'EN.EXAMPLE.COM:443';
$_SERVER['REQUEST_METHOD'] = 'GET';
$subdomainRouter->rewriteRequestUri();
canonicalSlugRedirectAssert(
    'https://en.example.com/about-us/',
    $subdomainRouter->preventLanguageStrippingRedirect('https://en.example.com/about-us/'),
    'A legitimate subdomain redirect must not be blocked only because HTTP_HOST contains different case or a port.'
);

canonicalSlugRedirectAssert(
    ['example.com', 'en.example.com'],
    $subdomainRouter->allowInternalRedirectHost(['example.com'], 'en.example.com'),
    'The configured target-language host must be accepted by wp_safe_redirect().'
);

canonicalSlugRedirectAssert(
    ['example.com'],
    $subdomainRouter->allowInternalRedirectHost(['example.com'], 'evil.example'),
    'An unconfigured host must never be admitted as a safe redirect target.'
);

$GLOBALS['_deepglot_canonical_redirect_filters'] = [];
$redirectionPluginRouter = new RequestRouter(
    $options,
    new SiteRouting($resolver, 'https://example.com', 'PATH_PREFIX', [])
);
$redirectionPluginRouter->register();

$_SERVER['REQUEST_URI'] = '/en/kinesiotaping-gegen-schmerzen/';
$_SERVER['HTTP_HOST'] = 'example.com';
$redirectionPluginRouter->rewriteRequestUri();
canonicalSlugRedirectAssert(
    'https://example.com/en/kinesiotaping-wien/',
    canonicalSlugRedirectApplyFilter(
        'redirection_url_target',
        'https://example.com/kinesiotaping-wien/',
        '/kinesiotaping-gegen-schmerzen/'
    ),
    'Redirection-plugin aliases matched after PATH_PREFIX routing must keep the active target-language prefix.'
);

canonicalSlugRedirectAssert(
    'https://external.example/kinesiotaping-wien/',
    canonicalSlugRedirectApplyFilter(
        'redirection_url_target',
        'https://external.example/kinesiotaping-wien/',
        '/kinesiotaping-gegen-schmerzen/'
    ),
    'External Redirection-plugin targets must never be rewritten.'
);

canonicalSlugRedirectAssert(
    'mailto:ordination@example.com',
    canonicalSlugRedirectApplyFilter(
        'redirection_url_target',
        'mailto:ordination@example.com',
        '/kinesiotaping-gegen-schmerzen/'
    ),
    'Non-HTTP Redirection-plugin targets must never be converted into internal URLs.'
);

$_SERVER['REQUEST_URI'] = '/kinesiotaping-gegen-schmerzen/';
$redirectionPluginRouter->rewriteRequestUri();
canonicalSlugRedirectAssert(
    'https://example.com/kinesiotaping-wien/',
    canonicalSlugRedirectApplyFilter(
        'redirection_url_target',
        'https://example.com/kinesiotaping-wien/',
        '/kinesiotaping-gegen-schmerzen/'
    ),
    'Source-language Redirection-plugin aliases must remain unchanged.'
);

if ($GLOBALS['_deepglot_canonical_redirect_failures'] > 0) {
    exit(1);
}

fwrite(STDOUT, "RequestRouterCanonicalSlugRedirectTest: OK\n");
