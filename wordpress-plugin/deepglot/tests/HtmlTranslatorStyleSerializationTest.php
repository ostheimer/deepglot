<?php

/**
 * Regression coverage for #223: DOMDocument serialization must not turn
 * non-ASCII CSS string contents into HTML entities on translated pages.
 *
 * Run standalone: php tests/HtmlTranslatorStyleSerializationTest.php
 */

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
require_once __DIR__ . '/../includes/Support/BotDetector.php';
require_once __DIR__ . '/../includes/Frontend/JsonLdTranslator.php';
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Support\TranslationCache;

class DeepglotStyleSerializationFakeClient extends Client
{
    public function __construct()
    {
    }

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0)
    {
        return [
            'from_words' => $texts,
            'to_words' => array_map(static fn(string $text) => '[' . $langTo . '] ' . $text, $texts),
        ];
    }
}

class DeepglotStyleSerializationNullCache extends TranslationCache
{
    public function getMany(array $texts, string $from, string $to): array
    {
        return [];
    }

    public function setMany(array $translations, string $from, string $to): void
    {
    }
}

function styleSerializationAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

$options = new Options();
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));

$translator = new HtmlTranslator(
    new DeepglotStyleSerializationFakeClient(),
    $options,
    new DeepglotStyleSerializationNullCache()
);

$styleCss = '.deepglot-switcher__custom-flags .deepglot-flag--en::before{content:"🇺🇸"}'
    . '.theme-icon::before{content:"✓ Über"}';
$html = '<main><style class="deepglot-switcher__custom-flags">' . $styleCss . '</style><p>Hallo Welt</p></main>';

$translated = $translator->translate($html, 'en');

styleSerializationAssert(
    str_contains($translated, '[en] Hallo Welt'),
    'Visible body text must still be translated so the DOM serialization path is exercised: ' . $translated
);
styleSerializationAssert(
    preg_match('/<style class="deepglot-switcher__custom-flags">(.*?)<\/style>/s', $translated, $styleMatch) === 1,
    'Translated HTML must still contain the style block: ' . $translated
);
styleSerializationAssert(
    ($styleMatch[1] ?? '') === $styleCss,
    'Style contents must be byte-identical after translation. Expected ' . $styleCss . ' got ' . ($styleMatch[1] ?? '')
);
styleSerializationAssert(
    !str_contains($styleMatch[1] ?? '', '&#'),
    'Style contents must not contain HTML entities, because CSS renders them as literal text: ' . ($styleMatch[1] ?? '')
);

fwrite(STDOUT, "HtmlTranslatorStyleSerializationTest: OK\n");
