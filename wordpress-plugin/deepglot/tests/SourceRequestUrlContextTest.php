<?php

/** Source URL exclusions must survive ordinary and signed localized requests. */
require __DIR__ . '/SourceHreflangOutputTest.php';
require_once __DIR__ . '/../includes/Support/UrlTranslationSync.php';
require_once __DIR__ . '/../includes/Support/TranslationWarmer.php';
require_once __DIR__ . '/../includes/Frontend/MultilingualSitemap.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HreflangInjector;
use Deepglot\Frontend\LinkRewriter;
use Deepglot\Frontend\MultilingualSitemap;
use Deepglot\Frontend\OutputBuffer;
use Deepglot\Frontend\RequestRouter;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\TranslationWarmer;
use Deepglot\Support\UrlTranslationSync;

$sync = new UrlTranslationSync(
    $options, $routing, new MultilingualSitemap($options, $routing),
    new TranslationWarmer(new Client($options), $options, new TranslationCache())
);
$sourceContextRouter = new RequestRouter($options, $routing);
$sourceContextBuffer = new OutputBuffer(
    $options, $resolver, $translator, new LinkRewriter($routing),
    new HreflangInjector($options, $routing), $sourceContextRouter, $routing, $sync
);
set_error_handler(static function ($severity, $message, $file, $line) {
    throw new ErrorException($message, 0, $severity, $file, $line);
});
try {
    $sourceMethod = new ReflectionMethod($sourceContextBuffer, 'sourceRequestUrl');
    $currentMethod = new ReflectionMethod($sourceContextBuffer, 'currentRequestUrl');
    $query = 'tag=a&tag=b&encoded=%2Fkeep%2F';
    $sourceUri = '/produkte/zahnbehandlung/?' . $query;
    $localizedUri = '/en/products/dental-treatment/?' . $query;

    // A normal source request leaves the router's original URI null. Merely
    // wiring URL sync must not emit a warning or alter its ordinary query.
    $_GET = [];
    $_SERVER['REQUEST_URI'] = $sourceUri;
    $sourceContextRouter->rewriteRequestUri();
    sourceHreflangAssert($sourceContextRouter->getOriginalRequestUri() === null, 'Source requests have no stored localized URI.');
    sourceHreflangAssert($sourceMethod->invoke($sourceContextBuffer) === 'https://example.com' . $sourceUri, 'Source URL must remain intact with URL sync configured.');
    sourceHreflangAssert($currentMethod->invoke($sourceContextBuffer) === 'https://example.com' . $sourceUri, 'Current source URL must remain intact.');
    $sourceCalls = $translator->calls;
    ob_start();
    $sourceContextBuffer->startBuffer();
    echo $html;
    ob_end_flush();
    $sourceOutput = ob_get_clean();
    sourceHreflangAssert($translator->calls === $sourceCalls, 'Wiring URL sync must not translate ordinary source output.');
    sourceHreflangAssert(str_contains($sourceOutput, '>Behandlung<'), 'Ordinary source output must preserve its original copy.');
    sourceHreflangAssert(substr_count($sourceOutput, 'hreflang="en"') === 1, 'Ordinary source output must keep its target hreflang with URL sync configured.');

    // The actual router rewrites the locale and translated slugs. Exclusions
    // use the source URL; ordinary analytics and cache purges use the public URL.
    $_SERVER['REQUEST_URI'] = $localizedUri;
    $sourceContextRouter->rewriteRequestUri();
    sourceHreflangAssert($_SERVER['REQUEST_URI'] === $sourceUri, 'Fixture must exercise the real localized-to-source rewrite.');
    sourceHreflangAssert($sourceMethod->invoke($sourceContextBuffer) === 'https://example.com' . $sourceUri, 'Localized requests must retain the canonical source URL for exclusions.');
    sourceHreflangAssert($currentMethod->invoke($sourceContextBuffer) === 'https://example.com' . $localizedUri, 'Ordinary analytics and purge URLs must stay localized.');

    // Real HMAC validation binds the token to the original localized URL.
    // Authenticating against rewritten REQUEST_URI would reject a valid sync;
    // substituting the original URL after validation would bypass exclusions.
    $jobId = 'source-context-test';
    $secret = 'source-context-test-only-signing-key';
    update_option(UrlTranslationSync::JOB_OPTION, [
        'id' => $jobId, 'status' => 'running', 'request_secret' => $secret,
    ]);
    $payload = implode('.', [
        $jobId, (string) (time() + 120), 'en', '0123456789abcdef',
        hash('sha256', 'example.com' . $localizedUri),
    ]);
    $token = $payload . '.' . hash_hmac('sha256', $payload, $secret);
    $controlQuery = '&' . UrlTranslationSync::QUERY_ARG . '=' . $token;
    $_GET[UrlTranslationSync::QUERY_ARG] = $token;
    $_SERVER['REQUEST_URI'] = $localizedUri . $controlQuery;
    $sourceContextRouter->rewriteRequestUri();
    sourceHreflangAssert(!$sync->isCurrentRequest(), 'Rewritten source URI alone must not validate the localized token.');
    sourceHreflangAssert($sync->isCurrentRequest($sourceContextRouter->getOriginalRequestUri()), 'Signed sync must validate the original localized URI.');
    sourceHreflangAssert($sourceMethod->invoke($sourceContextBuffer) === 'https://example.com' . $sourceUri, 'Signed sync must remove only its control query from the canonical source URL.');

    $savedOptions = get_option(Options::OPTION_KEY);
    update_option(Options::OPTION_KEY, array_merge($savedOptions, ['exclude_urls' => '/produkte/zahnbehandlung']));
    $bufferLevel = ob_get_level();
    $sourceContextBuffer->startBuffer();
    $excluded = ob_get_level() === $bufferLevel;
    while (ob_get_level() > $bufferLevel) {
        ob_end_clean();
    }
    sourceHreflangAssert($excluded, 'Signed localized sync must still respect source URL exclusions before buffering or translation.');
    update_option(Options::OPTION_KEY, $savedOptions);

    // A copied token for another path is not sync context. The helper must
    // neither strip its query nor substitute the router's localized URI.
    $_SERVER['REQUEST_URI'] = '/en/products/?' . $query . $controlQuery;
    $sourceContextRouter->rewriteRequestUri();
    sourceHreflangAssert(!$sync->isCurrentRequest($sourceContextRouter->getOriginalRequestUri()), 'A valid token copied to another path must fail URL binding.');
    sourceHreflangAssert($sourceMethod->invoke($sourceContextBuffer) === 'https://example.com/produkte/?' . $query . $controlQuery, 'Unsigned context must preserve the current source URL and ordinary query bytes.');
} finally {
    restore_error_handler();
}

fwrite(STDOUT, "SourceRequestUrlContextTest: OK\n");
