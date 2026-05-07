<?php

/**
 * Reproduces three head-metadata translation gaps observed on
 * https://www.meinhaushalt.at/en/ on 2026-05-07:
 *   - <title> text remained in the source language
 *   - <meta name="description" content="..."> remained in the source language
 *   - <meta property="og:title" / og:description / twitter:*"> remained untranslated
 *   - <html lang="de"> was not switched to lang="en"
 *
 * Run standalone: php tests/MetadataTranslationTest.php
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
require_once __DIR__ . '/../includes/Frontend/JsonLdTranslator.php';
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Support\TranslationCache;

class DeepglotMetadataFakeClient extends Client
{
    public array $sentTexts = [];

    public function __construct()
    {
    }

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '')
    {
        foreach ($texts as $text) {
            $this->sentTexts[] = $text;
        }

        return [
            'from_words' => $texts,
            'to_words' => array_map(static fn(string $text) => '[en] ' . $text, $texts),
        ];
    }
}

class DeepglotMetadataNullCache extends TranslationCache
{
    public function getMany(array $texts, string $from, string $to): array
    {
        return [];
    }

    public function setMany(array $translations, string $from, string $to): void
    {
    }
}

function dgAssert(bool $condition, string $message): void
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

$client = new DeepglotMetadataFakeClient();
$translator = new HtmlTranslator($client, $options, new DeepglotMetadataNullCache());

$html = '<!DOCTYPE html>'
    . '<html lang="de">'
    . '<head>'
    . '<meta charset="utf-8">'
    . '<title>Gesundheit ist wichtig</title>'
    . '<meta name="description" content="Tipps für ein gesundes Leben">'
    . '<meta name="keywords" content="Gesundheit, Tipps">'
    . '<meta property="og:title" content="Gesundheit – Mein Haushalt">'
    . '<meta property="og:description" content="Ratgeber für gesundes Leben">'
    . '<meta property="og:site_name" content="Mein Haushalt">'
    . '<meta property="og:image:alt" content="Frisches Gemüse">'
    . '<meta name="twitter:title" content="Gesundheit – Mein Haushalt">'
    . '<meta name="twitter:description" content="Ratgeber">'
    . '<meta name="robots" content="index, follow">'
    . '<link rel="stylesheet" href="/style.css">'
    . '<script>console.log("Mein Haushalt");</script>'
    . '<style>body{color:red}</style>'
    . '</head>'
    . '<body>'
    . '<h1>Hallo Welt</h1>'
    . '</body></html>';

$translated = $translator->translate($html, 'en');

// PHP DOMDocument::saveHTML() encodes high-byte UTF-8 characters as entities;
// decode for assertion convenience so the markup matcher works for umlauts.
$decoded = html_entity_decode($translated, ENT_QUOTES | ENT_HTML5, 'UTF-8');

// 1. Title text is sent for translation and replaced.
dgAssert(in_array('Gesundheit ist wichtig', $client->sentTexts, true), 'Title text must be sent for translation');
dgAssert(str_contains($decoded, '<title>[en] Gesundheit ist wichtig</title>'), 'Title element should contain translated text, got: ' . $decoded);

// 2. Meta description content gets translated.
dgAssert(in_array('Tipps für ein gesundes Leben', $client->sentTexts, true), 'Meta description content must be sent for translation');
dgAssert(str_contains($decoded, '"[en] Tipps für ein gesundes Leben"'), 'Meta description should contain translated text');

// 3. og:title and og:description content get translated.
dgAssert(in_array('Gesundheit – Mein Haushalt', $client->sentTexts, true), 'og:title content must be sent for translation');
dgAssert(in_array('Ratgeber für gesundes Leben', $client->sentTexts, true), 'og:description content must be sent for translation');
dgAssert(str_contains($decoded, '"[en] Gesundheit – Mein Haushalt"'), 'og:title should contain translated text');
dgAssert(str_contains($decoded, '"[en] Ratgeber für gesundes Leben"'), 'og:description should contain translated text');

// 4. og:image:alt and og:site_name get translated.
dgAssert(in_array('Frisches Gemüse', $client->sentTexts, true), 'og:image:alt must be sent for translation');
dgAssert(in_array('Mein Haushalt', $client->sentTexts, true), 'og:site_name must be sent for translation');

// 5. twitter:title and twitter:description get translated.
dgAssert(str_contains($decoded, '"[en] Gesundheit – Mein Haushalt"'), 'twitter:title should be translated (deduped with og:title)');

// 6. robots/keywords meta content must NOT be translated.
dgAssert(!in_array('index, follow', $client->sentTexts, true), 'robots meta content must not be translated');
dgAssert(!in_array('Gesundheit, Tipps', $client->sentTexts, true), 'keywords meta content must not be translated');

// 7. Script and style content must NOT be translated even though head is now allowed.
foreach ($client->sentTexts as $sent) {
    dgAssert(!str_contains($sent, 'console.log'), 'Script content must not be translated, got: ' . $sent);
    dgAssert(!str_contains($sent, 'color:red'), 'Style content must not be translated, got: ' . $sent);
}

// 8. Body H1 still translates as before.
dgAssert(in_array('Hallo Welt', $client->sentTexts, true), 'Body text must still be translated');
dgAssert(str_contains($translated, '[en] Hallo Welt'), 'H1 text must be translated in body');

// 9. Editor mode: head text nodes (title) get translated but never wrapped in
// the editor span — wrapping inside <title> would produce invalid markup like
// <title><span>...</span></title> that breaks title rendering. Body text still
// gets the wrapping treatment so the visual editor can target it.
$editorClient = new DeepglotMetadataFakeClient();
$editorTranslator = new HtmlTranslator($editorClient, $options, new DeepglotMetadataNullCache());
$editorHtml = '<!DOCTYPE html><html><head>'
    . '<title>Hallo</title>'
    . '<meta name="description" content="Beschreibung">'
    . '</head><body><h1>Hallo Welt</h1></body></html>';
$editorResult = $editorTranslator->translateForEditor($editorHtml, 'en');
$editorDecoded = html_entity_decode($editorResult['html'], ENT_QUOTES | ENT_HTML5, 'UTF-8');

dgAssert(str_contains($editorDecoded, '<title>[en] Hallo</title>'), 'Editor mode must translate <title> text without span wrapping, got: ' . $editorDecoded);
dgAssert(!preg_match('/<title>[^<]*<span/u', $editorDecoded), 'Editor mode must NOT wrap <title> children in segment spans: ' . $editorDecoded);
dgAssert(str_contains($editorDecoded, '"[en] Beschreibung"'), 'Editor mode must still translate meta description content');
dgAssert(preg_match('/<h1>\s*<span[^>]*data-deepglot-segment-id/u', $editorDecoded) === 1, 'Editor mode must still wrap body text nodes in segment spans, got: ' . $editorDecoded);

// Editor segments list must not include the title text node.
foreach ($editorResult['segments'] as $segment) {
    dgAssert($segment['originalText'] !== 'Hallo', 'Title text node must not be exposed as an editor segment');
}

fwrite(STDOUT, "MetadataTranslationTest: OK\n");
