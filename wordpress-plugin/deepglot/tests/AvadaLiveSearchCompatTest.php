<?php

/**
 * Avada live-search compatibility contract.
 *
 * Avada's public AJAX live search is source-language only. On a Deepglot
 * target page it therefore exposes German titles and source URLs. Until a
 * language-aware, quota-bounded AJAX integration exists, target pages must
 * disable only the live suggestions and keep the normal localized search
 * form available.
 *
 * Run standalone: php tests/AvadaLiveSearchCompatTest.php
 */

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}

if (!function_exists('add_filter')) {
    $GLOBALS['_deepglot_avada_filters'] = [];
    function add_filter($hook, $callback, $priority = 10, $acceptedArgs = 1) {
        $GLOBALS['_deepglot_avada_filters'][$hook][] = [
            'callback' => $callback,
            'priority' => $priority,
            'accepted_args' => $acceptedArgs,
        ];
        return true;
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Frontend/RequestRouter.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\AvadaLiveSearchCompat;
use Deepglot\Frontend\RequestRouter;

function avadaCompatAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

$compatFile = __DIR__ . '/../includes/Frontend/AvadaLiveSearchCompat.php';
avadaCompatAssert(is_file($compatFile), 'AvadaLiveSearchCompat implementation is missing.');
require_once $compatFile;

final class AvadaCompatOptions extends Options
{
    public function __construct(
        private bool $enabled,
        private bool $configured,
        private array $targets = ['en']
    ) {}

    public function isEnabled(): bool { return $this->enabled; }
    public function isConfigured(): bool { return $this->configured; }
    public function getTargetLanguages(): array { return $this->targets; }
}

final class AvadaCompatRouter extends RequestRouter
{
    public function __construct(private ?string $language) {}
    public function getCurrentLanguage(): ?string { return $this->language; }
}

function avadaCompatScripts(): array
{
    return [
        ['avada-menu', 'avadaMenuVars', ['site_layout' => 'wide']],
        [
            'avada-live-search',
            'avadaLiveSearchVars',
            [
                'live_search' => true,
                'ajaxurl' => 'https://example.test/wp-admin/admin-ajax.php',
                'min_char_count' => '4',
                'per_page' => '5',
            ],
        ],
    ];
}

// The official Avada filter is registered with its one-argument contract.
$registered = new AvadaLiveSearchCompat(
    new AvadaCompatOptions(true, true),
    new AvadaCompatRouter('en')
);
$registered->register();
$hooks = $GLOBALS['_deepglot_avada_filters']['awb_localize_theme_scripts'] ?? [];
avadaCompatAssert(count($hooks) === 1, 'The Avada localization filter must be registered once.');
avadaCompatAssert($hooks[0]['priority'] === 10, 'The Avada filter must use the default priority.');
avadaCompatAssert($hooks[0]['accepted_args'] === 1, 'The Avada filter accepts exactly one argument.');

// Target language: disable only live suggestions and preserve every other
// script tuple and setting exactly.
$input = avadaCompatScripts();
$expected = $input;
$expected[1][2]['live_search'] = false;
$result = $registered->filterLocalizedScripts($input);
avadaCompatAssert($result === $expected, 'English target pages must disable only Avada live search.');

// Source, unsupported and unsafe plugin states are strict no-ops.
$noOpCases = [
    new AvadaLiveSearchCompat(new AvadaCompatOptions(true, true), new AvadaCompatRouter(null)),
    new AvadaLiveSearchCompat(new AvadaCompatOptions(true, true), new AvadaCompatRouter('fr')),
    new AvadaLiveSearchCompat(new AvadaCompatOptions(false, true), new AvadaCompatRouter('en')),
    new AvadaLiveSearchCompat(new AvadaCompatOptions(true, false), new AvadaCompatRouter('en')),
];
foreach ($noOpCases as $index => $compat) {
    avadaCompatAssert(
        $compat->filterLocalizedScripts($input) === $input,
        'No-op case ' . $index . ' must preserve the complete payload.'
    );
}

// Unknown payload shapes must survive untouched instead of producing an
// invalid tuple for Fusion_Dynamic_JS::localize_script().
$malformed = [
    ['avada-live-search', 'avadaLiveSearchVars', 'not-an-array'],
    ['avada-live-search'],
    'not-a-script-tuple',
];
avadaCompatAssert(
    $registered->filterLocalizedScripts($malformed) === $malformed,
    'Malformed Avada tuples must remain unchanged.'
);
avadaCompatAssert(
    $registered->filterLocalizedScripts('not-an-array') === 'not-an-array',
    'A non-array filter payload must remain unchanged.'
);

// Plugin wiring is part of the contract; a standalone class is not enough.
$pluginSource = file_get_contents(__DIR__ . '/../includes/Plugin.php');
avadaCompatAssert(
    is_string($pluginSource) && substr_count($pluginSource, 'AvadaLiveSearchCompat') >= 3,
    'Plugin.php must import, register and construct AvadaLiveSearchCompat.'
);

fwrite(STDOUT, "AvadaLiveSearchCompatTest: OK\n");
