<?php

/**
 * Regression coverage for resolving SaaS-provided translated slugs before
 * WordPress parses REQUEST_URI.
 */

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/RequestRouter.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\RequestRouter;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

class RequestRouterSlugOptions extends Options
{
    public function isEnabled(): bool
    {
        return true;
    }

    public function isConfigured(): bool
    {
        return true;
    }
}

function requestRouterSlugAssert(string $expected, string $actual, string $message): void
{
    if ($expected !== $actual) {
        fwrite(STDERR, $message . PHP_EOL);
        fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
        fwrite(STDERR, 'Actual:   ' . var_export($actual, true) . PHP_EOL);
        exit(1);
    }
}

$resolver = new UrlLanguageResolver('de', ['en']);
$options = new RequestRouterSlugOptions();

$_SERVER['REQUEST_URI'] = '/en/about-us/?0';
$_SERVER['HTTP_HOST'] = 'example.com';
$pathRouter = new RequestRouter(
    $options,
    new SiteRouting(
        $resolver,
        'https://example.com',
        'PATH_PREFIX',
        [],
        ['en' => ['ueber-uns' => 'about-us']]
    )
);
$pathRouter->rewriteRequestUri();
requestRouterSlugAssert(
    '/ueber-uns/?0',
    (string) $_SERVER['REQUEST_URI'],
    'Path-prefix requests must reverse translated slugs and preserve a query string equal to zero.'
);

$_SERVER['REQUEST_URI'] = '/about-us/?0';
$_SERVER['HTTP_HOST'] = 'en.example.com';
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
$subdomainRouter->rewriteRequestUri();
requestRouterSlugAssert(
    '/ueber-uns/?0',
    (string) $_SERVER['REQUEST_URI'],
    'Subdomain requests must pass the detected language when reversing translated slugs.'
);

$_SERVER['REQUEST_URI'] = '/en/?0';
$_SERVER['HTTP_HOST'] = 'en.example.com';
$languageNamedSlugRouter = new RequestRouter(
    $options,
    new SiteRouting(
        $resolver,
        'https://example.com',
        'SUBDOMAIN',
        ['en' => 'en.example.com'],
        ['en' => ['source-page' => 'en']]
    )
);
$languageNamedSlugRouter->rewriteRequestUri();
requestRouterSlugAssert(
    '/source-page/?0',
    (string) $_SERVER['REQUEST_URI'],
    'Mapped subdomain requests must preserve a language-named content slug for reverse mapping.'
);

$_SERVER['REQUEST_URI'] = '/en/?0';
$_SERVER['HTTP_HOST'] = 'example.com';
$languageNamedSlugRouter->rewriteRequestUri();
requestRouterSlugAssert(
    '/en/?0',
    (string) $_SERVER['REQUEST_URI'],
    'The source host must not activate a language that has its own mapped subdomain.'
);

$_SERVER['REQUEST_URI'] = '/blog/fr/page/?0';
$_SERVER['HTTP_HOST'] = 'example.com';
$fallbackRouter = new RequestRouter(
    $options,
    new SiteRouting(
        new UrlLanguageResolver('de', ['en', 'fr']),
        'https://example.com/blog',
        'SUBDOMAIN',
        ['en' => 'en.example.com'],
        ['fr' => ['page-source' => 'page']]
    )
);
$fallbackRouter->rewriteRequestUri();
requestRouterSlugAssert(
    '/blog/page-source/?0',
    (string) $_SERVER['REQUEST_URI'],
    'Path-prefix fallback requests below a WordPress subdirectory must strip the locale and reverse translated slugs.'
);

fwrite(STDOUT, "RequestRouterSlugTest: OK\n");
