<?php

/** Regression for #366: English must work without loading an en_US catalogue. */

$root = dirname(__DIR__);
$main = file_get_contents($root . '/deepglot.php');
$settings = file_get_contents($root . '/includes/Admin/SettingsPage.php');
$block = file_get_contents($root . '/assets/js/block-switcher.js');
$swedish = file_get_contents($root . '/languages/deepglot-sv_SE.po');
$readme = file_get_contents($root . '/readme.txt');

foreach ([$main, $settings, $block, $swedish, $readme] as $content) {
    if (!is_string($content)) {
        throw new RuntimeException('Plugin localization source is unreadable.');
    }
}

$checks = [
    [str_contains($main, 'Description: Translates WordPress content'), 'English plugin metadata'],
    [str_contains($settings, "esc_html_e('Configure languages', 'deepglot')"), 'English settings default'],
    [str_contains($block, "__( 'Deepglot language switcher', 'deepglot' )"), 'English block editor default'],
    [str_contains($swedish, "msgid \"Language switcher\"\nmsgstr \"Språkväljare\""), 'Swedish switcher meaning'],
    [!str_contains($swedish, 'Flagge/Reihenfolge'), 'Swedish block copy contains no German remainder'],
    [!str_contains($readme, 'API-Key ungültig'), 'English readme quotation'],
];

foreach ($checks as [$passed, $label]) {
    if (!$passed) {
        fwrite(STDERR, "EnglishSourceAndSwedishCopyTest: FAIL ($label)\n");
        exit(1);
    }
}

echo "EnglishSourceAndSwedishCopyTest: OK\n";
