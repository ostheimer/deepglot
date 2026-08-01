<?php

/**
 * Keep visible WordPress admin branding aligned with the public Deepglot brand.
 */

function brandingAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

$pluginRoot = realpath(__DIR__ . '/..');
brandingAssert(is_string($pluginRoot), 'Plugin root must resolve');

$settingsPath = $pluginRoot . '/includes/Admin/SettingsPage.php';
$settings = file_get_contents($settingsPath);
brandingAssert(is_string($settings), 'Settings page must be readable');

brandingAssert(
    !str_contains($settings, 'deepglot.app'),
    'Settings page must not reference the retired deepglot.app domain'
);
brandingAssert(
    str_contains($settings, "assets/images/deepglot-mark.png"),
    'Settings page must render the packaged Deepglot mark'
);
brandingAssert(
    !str_contains($settings, '<span class="dg-logo">D</span>'),
    'Settings page must not use a text glyph as the brand mark'
);

$markPath = $pluginRoot . '/assets/images/deepglot-mark.png';
brandingAssert(is_file($markPath), 'Packaged Deepglot mark must exist');
$mark = file_get_contents($markPath);
brandingAssert(
    is_string($mark) && str_starts_with($mark, "\x89PNG\r\n\x1a\n"),
    'Packaged Deepglot mark must be a valid PNG asset'
);

$languageFiles = glob($pluginRoot . '/languages/*.{po,pot,mo}', GLOB_BRACE);
brandingAssert(is_array($languageFiles) && $languageFiles !== [], 'Translation files must exist');
foreach ($languageFiles as $languageFile) {
    $contents = file_get_contents($languageFile);
    brandingAssert(is_string($contents), basename($languageFile) . ' must be readable');
    brandingAssert(
        !str_contains($contents, 'deepglot.app'),
        basename($languageFile) . ' must not reference the retired deepglot.app domain'
    );
}

fwrite(STDOUT, "AdminBrandingTest: OK\n");
