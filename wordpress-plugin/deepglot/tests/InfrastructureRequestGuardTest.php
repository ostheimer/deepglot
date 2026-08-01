<?php

/**
 * Runtime configuration is needed only for routable frontend pages. Core
 * infrastructure endpoints must remain independent of SaaS availability.
 */

require_once __DIR__ . '/../includes/Support/WordPressInfrastructure.php';
require_once __DIR__ . '/../includes/Plugin.php';

use Deepglot\Plugin;

$GLOBALS['_deepglot_infrastructure_guard_failures'] = [];

function infrastructureGuardAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        $GLOBALS['_deepglot_infrastructure_guard_failures'][] = $message;
    }
}

$reflection = new ReflectionClass(Plugin::class);
$plugin = $reflection->newInstanceWithoutConstructor();
$guard = $reflection->getMethod('isWordPressInfrastructureRequest');
if (PHP_VERSION_ID < 80100) {
    $guard->setAccessible(true);
}

$_GET = [];
$infrastructurePaths = [
    '/wp-admin/',
    '/wp-login.php?action=login',
    '/xmlrpc.php',
    '/wp-cron.php?doing_wp_cron=1',
    '/wp-comments-post.php',
    '/wp-mail.php',
    '/wp-trackback.php',
    '/wp-signup.php',
    '/wp-activate.php',
    '/wp-links-opml.php',
    '/wp-content/cache/missing.css',
    '/wp-includes/js/missing.js',
    '/wp-json/deepglot/v1/settings',
    '/index.php/wp-json/deepglot/v1/settings',
    '/subdirectory/wp-login.php',
    '/robots.txt',
    '/wp-sitemap.xml',
    '/deepglot-sitemap.xml',
    '/index.php',
    '/favicon.ico',
];

foreach ($infrastructurePaths as $requestUri) {
    $_SERVER['REQUEST_URI'] = $requestUri;
    infrastructureGuardAssert(
        $guard->invoke($plugin) === true,
        $requestUri . ' must not trigger a runtime configuration refresh.'
    );
}

foreach ([
    '/',
    '/en/services/',
    '/en/wp-content-marketing/',
    '/index.php/en/services/',
    '/blog/index.php/en/services/',
] as $requestUri) {
    $_SERVER['REQUEST_URI'] = $requestUri;
    infrastructureGuardAssert(
        $guard->invoke($plugin) === false,
        $requestUri . ' must remain eligible for frontend routing refresh.'
    );
}

$_SERVER['REQUEST_URI'] = '/';
$_GET['rest_route'] = '/deepglot/v1/settings';
infrastructureGuardAssert(
    $guard->invoke($plugin) === true,
    'REST requests using the rest_route query parameter must not trigger a refresh.'
);

unset($_GET['rest_route']);
$_SERVER['REQUEST_URI'] = '';
if (!defined('WP_CLI')) {
    define('WP_CLI', true);
}
infrastructureGuardAssert(
    $guard->invoke($plugin) === true,
    'WP-CLI bootstraps with an empty request URI must not trigger a refresh.'
);

if ($GLOBALS['_deepglot_infrastructure_guard_failures'] !== []) {
    exit(1);
}

fwrite(STDOUT, "InfrastructureRequestGuardTest: OK\n");
