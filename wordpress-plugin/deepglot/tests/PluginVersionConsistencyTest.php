<?php

/**
 * Keep the distributable plugin header, runtime asset version, and README in
 * lockstep. A mismatch can leave WordPress serving stale switcher/AMP assets.
 */

function versionAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

$plugin = file_get_contents(__DIR__ . '/../deepglot.php');
$readme = file_get_contents(__DIR__ . '/../README.md');

versionAssert(is_string($plugin), 'Plugin bootstrap must be readable');
versionAssert(is_string($readme), 'Plugin README must be readable');
versionAssert(
    preg_match('/^ \* Version:\s*([^\s]+)$/m', $plugin, $headerMatch) === 1,
    'Plugin header version is missing'
);
versionAssert(
    preg_match("/define\('DEEPGLOT_PLUGIN_VERSION',\s*'([^']+)'\)/", $plugin, $constantMatch) === 1,
    'Runtime plugin version constant is missing'
);

$headerVersion = $headerMatch[1] ?? '';
$constantVersion = $constantMatch[1] ?? '';

versionAssert($headerVersion === $constantVersion, 'Header and runtime versions must match');
versionAssert(
    str_contains($readme, '(**v' . $headerVersion . '**)'),
    'README version must match the plugin bootstrap'
);

$readmeTxt = file_get_contents(__DIR__ . '/../readme.txt');

versionAssert(is_string($readmeTxt), 'wordpress.org readme.txt must be readable');
versionAssert(
    preg_match('/^Stable tag:\s*([^\s]+)$/m', $readmeTxt, $stableTagMatch) === 1,
    'readme.txt Stable tag is missing'
);
versionAssert(
    ($stableTagMatch[1] ?? '') === $headerVersion,
    'readme.txt Stable tag must match the plugin header version'
);
versionAssert(
    preg_match('/^ \* License:\s*GPL/m', $plugin) === 1,
    'Plugin header must declare a GPL-compatible license for wordpress.org'
);

fwrite(STDOUT, "PluginVersionConsistencyTest: OK\n");
