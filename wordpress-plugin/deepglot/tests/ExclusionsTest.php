<?php

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }
}

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_options'] = [];

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_options'][$key] ?? $default;
    }

    function update_option($key, $value) {
        $GLOBALS['_deepglot_options'][$key] = $value;
        return true;
    }

    function get_transient($key) {
        return false;
    }

    function set_transient($key, $value, $ttl = 0) {
        return true;
    }

    function is_wp_error($value) {
        return false;
    }

    function wp_parse_args($args, $defaults = []) {
        return array_merge($defaults, is_array($args) ? $args : []);
    }

    function sanitize_text_field($value) {
        return trim((string) $value);
    }

    function sanitize_textarea_field($value) {
        return trim((string) $value);
    }

    function esc_url_raw($value) {
        return (string) $value;
    }

    function untrailingslashit($value) {
        return rtrim((string) $value, '/');
    }

    if (!defined('DAY_IN_SECONDS')) {
        define('DAY_IN_SECONDS', 86400);
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Support\TranslationCache;

function assertSameExclusions($expected, $actual, string $message): void
{
    if ($expected !== $actual) {
        fwrite(STDERR, $message . PHP_EOL);
        fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
        fwrite(STDERR, 'Actual:   ' . var_export($actual, true) . PHP_EOL);
        exit(1);
    }
}

$options = new Options();

update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'exclude_urls' => "/kontakt\n/products/*",
    'exclude_regexes' => "[\n^/checkout",
    'exclude_selectors' => ".no-translate\n#hero",
]));

assertSameExclusions(true, $options->isUrlExcluded('https://example.com/en/kontakt'), 'URL contains exclusions should match full URLs.');
assertSameExclusions(true, $options->isUrlExcluded('/en/products/sale'), 'Wildcard URL exclusions should match paths.');
assertSameExclusions(true, $options->isUrlExcluded('/checkout'), 'Valid regex exclusions should match paths.');
assertSameExclusions(false, $options->isUrlExcluded('/blog'), 'Invalid regex exclusions must be ignored safely.');
assertSameExclusions(['.no-translate', '#hero'], $options->getExcludedSelectors(), 'Selectors should be returned as normalized lines.');

$options->applyRuntimeConfig([
    'exclusions' => [
        'urls' => ['/dashboard-only'],
        'regexes' => ['^/private'],
        'selectors' => ['.skip-me', '#app'],
    ],
]);

assertSameExclusions(true, $options->isUrlExcluded('/dashboard-only'), 'Runtime config should overwrite URL exclusions.');
assertSameExclusions(false, $options->isUrlExcluded('/kontakt'), 'Runtime config should remove stale plugin-local URL exclusions.');
assertSameExclusions(['.skip-me', '#app'], $options->getExcludedSelectors(), 'Runtime config should overwrite selectors.');

class DeepglotExclusionsFakeClient extends Client
{
    public array $lastTexts = [];

    public function __construct()
    {
    }

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '')
    {
        $this->lastTexts = $texts;

        return [
            'from_words' => $texts,
            'to_words' => array_map(static fn($text) => '[en] ' . $text, $texts),
        ];
    }
}

class DeepglotExclusionsNullCache extends TranslationCache
{
    public function getMany(array $texts, string $from, string $to): array
    {
        return [];
    }

    public function setMany(array $translations, string $from, string $to): void
    {
    }
}

update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'exclude_selectors' => ".no-translate\n#hero",
]));

$client = new DeepglotExclusionsFakeClient();
$translator = new HtmlTranslator($client, $options, new DeepglotExclusionsNullCache());
$html = '<main><p>Hello world</p><p class="no-translate">Do not change</p><section id="hero">Keep hero</section></main>';
$translated = $translator->translate($html, 'en');

assertSameExclusions(true, str_contains($translated, '[en] Hello world'), 'Normal text should be translated.');
assertSameExclusions(true, str_contains($translated, 'Do not change'), 'Excluded class text should remain unchanged.');
assertSameExclusions(false, str_contains($translated, '[en] Do not change'), 'Excluded class text should not be sent to translation.');
assertSameExclusions(false, in_array('Keep hero', $client->lastTexts, true), 'Excluded ID text should not be sent to translation.');

fwrite(STDOUT, "ExclusionsTest: OK\n");
