<?php

require_once dirname(__DIR__) . '/includes/Support/UrlLanguageResolver.php';

use Deepglot\Support\UrlLanguageResolver;

function assertSameValue($expected, $actual, string $message): void
{
    if ($expected !== $actual) {
        fwrite(STDERR, $message . PHP_EOL);
        fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
        fwrite(STDERR, 'Actual:   ' . var_export($actual, true) . PHP_EOL);
        exit(1);
    }
}

$resolver = new UrlLanguageResolver('de', ['en', 'fr', 'it']);

assertSameValue(null, $resolver->detectLanguageFromPath('/'), 'Root path should not detect a language.');
assertSameValue('en', $resolver->detectLanguageFromPath('/en/about/'), 'Language prefix should be detected.');
assertSameValue('/about/', $resolver->stripLanguageFromPath('/en/about/'), 'Language prefix should be stripped.');
assertSameValue('/about/', $resolver->withLanguage('/en/about/', 'de'), 'Source language should not keep a prefix.');
assertSameValue('/fr/about/', $resolver->withLanguage('/about/', 'fr'), 'Target language should be added to the path.');

fwrite(STDOUT, "UrlLanguageResolverTest: OK\n");
