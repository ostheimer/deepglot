<?php

/**
 * Guard the documented local Plugin Check workflow against scanning test stubs.
 */

function pluginCheckDocAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

$compose = file_get_contents(__DIR__ . '/../../docker-compose.yml');

pluginCheckDocAssert(is_string($compose), 'wordpress-plugin/docker-compose.yml must be readable');
pluginCheckDocAssert(
    preg_match_all('/^\s*#\s*(docker compose run --rm cli wp plugin check deepglot[^\r\n]*)$/m', $compose, $matches) > 0,
    'docker-compose.yml must document the Plugin Check command'
);

foreach ($matches[1] as $command) {
    pluginCheckDocAssert(
        str_contains($command, '--exclude-directories=tests'),
        'Plugin Check command must exclude test fixtures: ' . $command
    );
}

fwrite(STDOUT, "PluginCheckCommandDocumentationTest: OK\n");
